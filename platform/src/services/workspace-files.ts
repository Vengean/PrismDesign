import {requirement} from './requirement-runtime.js';
import {projectRole} from './projects.js';
import {AttachmentError,runWorkspaceProgram,type AttachmentRunner} from './workspace-attachments.js';

export const MAX_WORKSPACE_FILE_SIZE=50*1024*1024;
export const workspaceFileProgram=String.raw`
const fs=require('fs'),path=require('path');
const input=JSON.parse(process.argv[1]),root=input.root||'/workspace';
function target(value){
 if(typeof value!=='string'||value.length>2048||/[\x00-\x1f\\]/.test(value))throw Error('文件路径无效');
 const parts=value.split('/').filter(Boolean);
 if(path.isAbsolute(value)||parts.some(p=>['..','.','.git','.prism'].includes(p)))throw Error('文件路径无效');
 let current=root;
 for(const part of parts){current=path.join(current,part);if(fs.lstatSync(current).isSymbolicLink())throw Error('不支持符号链接');}
 return current;
}
try{
 const filename=target(input.path),stat=fs.lstatSync(filename);
 if(input.action==='list'){
  if(!stat.isDirectory())throw Error('请选择文件夹');
  const entries=fs.readdirSync(filename,{withFileTypes:true}).filter(item=>!['.git','.prism','node_modules'].includes(item.name)&&!item.isSymbolicLink()&&(item.isFile()||item.isDirectory())).sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name));
  const items=entries.slice(0,500).flatMap(item=>{try{const p=path.join(filename,item.name),s=fs.lstatSync(p);if(s.isSymbolicLink())return [];return [{name:item.name,path:path.relative(root,p).split(path.sep).join('/'),kind:s.isDirectory()?'directory':'file',size:s.size,modifiedAt:s.mtime.toISOString()}];}catch{return [];}});
  process.stdout.write(JSON.stringify({path:input.path,items,truncated:entries.length>500}));
 }else if(input.action==='download'){
  if(!stat.isFile())throw Error('只能下载普通文件');
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
   const resolved=fs.realpathSync(process.platform==='linux'?'/proc/self/fd/'+fd:filename),relative=path.relative(fs.realpathSync(root),resolved);
   if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('文件路径无效');
   const current=fs.fstatSync(fd);if(!current.isFile())throw Error('只能下载普通文件');
   if(current.size>50*1024*1024)throw Error('单个文件不能超过 50 MB');
   const content=Buffer.alloc(current.size);let offset=0;
   while(offset<content.length){const n=fs.readSync(fd,content,offset,content.length-offset,offset);if(!n)throw Error('文件正在变化，请稍后重试');offset+=n;}
   const after=fs.fstatSync(fd);if(after.size!==current.size||after.mtimeMs!==current.mtimeMs)throw Error('文件正在变化，请稍后重试');
   fs.writeFileSync(input.payload||'/tmp/payload.bin',content);process.stdout.write(JSON.stringify({name:path.basename(filename),size:content.length}));
  }finally{fs.closeSync(fd);}
 }else throw Error('不支持的文件操作');
}catch(error){process.stderr.write(JSON.stringify({error:error.code==='ENOENT'?'文件或工作区已清理或不存在':error.message}));process.exitCode=1;}
`;
const runFiles:AttachmentRunner=async(id,input)=>{
 try{return await runWorkspaceProgram(id,input,undefined,workspaceFileProgram,MAX_WORKSPACE_FILE_SIZE);}
 catch(error){if(error instanceof AttachmentError)throw error;throw new AttachmentError('无法读取工作区，请确认容器引擎可用后重试',503);}
};
export function createWorkspaceFiles(run:AttachmentRunner=runFiles){
 async function access(id:string,userId:string){const role=await projectRole((await requirement(id)).project_id,userId);if(!role||role==='viewer')throw new AttachmentError('只有项目编辑成员可以读取工作区文件',403);}
 function validate(value:unknown){if(typeof value!=='string'||value.length>2048||value.startsWith('/')||/[\x00-\x1f\\]/.test(value)||value.split('/').some(p=>['..','.','.git','.prism'].includes(p)))throw new AttachmentError('文件路径无效');return value;}
 return {
  async list(id:string,userId:string,path:unknown=''){await access(id,userId);const result=await run(id,{action:'list',path:validate(path)});await access(id,userId);return result.value;},
  async download(id:string,userId:string,path:unknown){await access(id,userId);const result=await run(id,{action:'download',path:validate(path)});await access(id,userId);return {name:(result.value as {name:string}).name,content:result.content!};},
 };
}
export const workspaceFiles=createWorkspaceFiles();
