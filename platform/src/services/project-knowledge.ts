import type Docker from 'dockerode';
import crypto from 'node:crypto';
export interface ProjectKnowledge {
 documents:{path:string;content:string}[];
 skills:{name:string;content:string}[];
 mcpServers:Record<string,{type?:'stdio'|'http';command?:string;args?:string[];env?:Record<string,string>;url?:string;headers?:Record<string,string>}>;
}
export function validKnowledge(value:unknown):value is ProjectKnowledge{
 if(!value||typeof value!=='object')return false;
 const k=value as ProjectKnowledge;
 if(Object.keys(k).some(x=>!['documents','skills','mcpServers'].includes(x))||!Array.isArray(k.documents)||!Array.isArray(k.skills)||k.documents.length>30||k.skills.length>30)return false;
 const paths=new Set<string>(),names=new Set<string>();
 for(const d of k.documents){if(!d||typeof d.path!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/.test(d.path)||d.path.length>200||typeof d.content!=='string'||d.content.length>60000||paths.has(d.path))return false;paths.add(d.path);}
 for(const s of k.skills){if(!s||typeof s.name!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.name)||typeof s.content!=='string'||s.content.length>60000||names.has(s.name))return false;names.add(s.name);}
 if(!k.mcpServers||typeof k.mcpServers!=='object'||Array.isArray(k.mcpServers)||Object.keys(k.mcpServers).length>20)return false;
 for(const [name,s] of Object.entries(k.mcpServers)){
  if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(name)||!s||Object.keys(s).some(x=>!['type','command','args','env','url','headers'].includes(x)))return false;
  if(s.type==='http'){
   if(typeof s.url!=='string'||s.url.length>2000||s.command!==undefined||s.args!==undefined||s.env!==undefined)return false;
   try{const url=new URL(s.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return false;}catch{return false;}
   if(s.headers!==undefined&&(!s.headers||typeof s.headers!=='object'||Array.isArray(s.headers)||Object.entries(s.headers).some(([key,value])=>!/^[!#$%&'*+.^_`|~a-zA-Z0-9-]+$/.test(key)||typeof value!=='string'||value.length>4000||/[\r\n\0]/.test(value))))return false;
  }else if(s.type!==undefined&&s.type!=='stdio'||typeof s.command!=='string'||!s.command.trim()||s.command.length>500||s.url!==undefined||s.headers!==undefined)return false;
  if(s.args!==undefined&&(!Array.isArray(s.args)||s.args.length>50||s.args.some(a=>typeof a!=='string'||a.length>4000)))return false;
  if(s.env!==undefined&&(!s.env||typeof s.env!=='object'||Array.isArray(s.env)||Object.entries(s.env).some(([key,v])=>!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)||typeof v!=='string'||v.length>4000)))return false;
 }
 return JSON.stringify(k).length<=500000;
}
export function knowledgeVolume(projectId:string){if(!/^[a-zA-Z0-9_-]+$/.test(projectId))throw Error('项目 ID 无效');return `${process.env.PRISM_MODE==='sit'?'prism-sit':'prism'}-project-${projectId}-knowledge`;}
export function knowledgeFiles(guidance:string,knowledge?:ProjectKnowledge){
 const files:Record<string,string>={'README.md':guidance||'# 项目共享知识\n\n此目录保存平台配置的项目文档和技能。仓库自身说明优先，冲突时明确说明。\n'};
 files['mcp.json']=JSON.stringify({mcpServers:knowledge?.mcpServers||{}},null,2)+'\n';
 for(const d of knowledge?.documents||[])files['docs/'+d.path]=d.content;
 for(const s of knowledge?.skills||[])files[`skills/${s.name}/SKILL.md`]=s.content;
 return files;
}
// This program only runs in an isolated helper with the knowledge volume. Auth
// and source volumes are never attached. Rename a whole generation atomically.
export const writeKnowledgeProgram=String.raw`
const fs=require('fs'),path=require('path');const files=JSON.parse(process.argv[1]),root='/project-global';
const generation='version-'+require('crypto').createHash('sha256').update(JSON.stringify(files)).digest('hex');
const directory=path.join(root,generation);
if(!fs.existsSync(directory)){
 fs.mkdirSync(directory,{mode:0o755});
 try{
  for(const [name,content] of Object.entries(files)){
   if((name!=='mcp.json'&&!/^[a-zA-Z0-9_/-]+\.md$/.test(name))||name.split('/').some(x=>x==='.'||x==='..'))throw Error('共享文件路径无效');
   const p=path.join(directory,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,content,{mode:name==='mcp.json'?0o600:0o644,flag:'wx'});
  }
 }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
const next=path.join(root,'next-'+require('crypto').randomUUID());fs.symlinkSync(generation,next);fs.renameSync(next,path.join(root,'current'));
`;
const pending=new Map<string,Promise<unknown>>();
export async function prepareProjectKnowledge(engine:Docker,projectId:string,guidance:string,knowledge?:ProjectKnowledge){
 const previous=pending.get(projectId)||Promise.resolve();
 const work=previous.catch(()=>{}).then(async()=>{
  const volume=knowledgeVolume(projectId);await engine.createVolume({Name:volume,Labels:{'prism.project':projectId,'prism.purpose':'knowledge'}});
  const helper=await engine.createContainer({name:`${volume}-sync-${crypto.randomUUID()}`,Image:process.env.PRISM_WORKSPACE_IMAGE||'prism-workspace:latest',User:'prism',Entrypoint:['node','-e',writeKnowledgeProgram,JSON.stringify(knowledgeFiles(guidance,knowledge))],HostConfig:{Binds:[`${volume}:/project-global`],NetworkMode:'none',Memory:128*1024*1024,PidsLimit:32,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],LogConfig:{Type:'none',Config:{}}}});
  try{await helper.start();const result=await helper.wait();if(result.StatusCode!==0)throw Error('共享知识卷写入失败，请更新工作区镜像并检查卷权限');}finally{await helper.remove({force:true});}
  return volume;
 });pending.set(projectId,work);try{return await work as string;}finally{if(pending.get(projectId)===work)pending.delete(projectId);}
}
