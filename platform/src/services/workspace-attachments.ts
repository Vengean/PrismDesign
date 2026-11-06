import crypto from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {containerEngine,requirement} from './requirement-runtime.js';
import {getDb} from './db.js';
import {projectRole} from './projects.js';

export const MAX_ATTACHMENT_SIZE=5*1024*1024,MAX_ATTACHMENT_TOTAL=20*1024*1024,MAX_ATTACHMENTS=5;
export interface WorkspaceAttachment {id:string;name:string;mimeType:string;size:number;workspacePath:string;sha256:string}
interface StoredAttachment extends WorkspaceAttachment {userId:string;sessionId:string;createdAt:string}
export class AttachmentError extends Error {constructor(message:string,readonly status=400){super(message);}}

// The helper mounts only the existing requirement volume. No attachment data is
// retained by the platform or a second volume; stopped workspaces work as well.
export const attachmentFileProgram=String.raw`
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const input=JSON.parse(process.argv[1]),root=input.root||'/workspace',base=path.join(root,'.prism','attachments');
function directory(target,create=false){
 const relative=path.relative(root,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('附件路径无效');
 let current=root;
 for(const part of relative.split(path.sep).filter(Boolean)){
  current=path.join(current,part);
  if(!fs.existsSync(current)){if(!create)throw Error('附件已清理或不存在');fs.mkdirSync(current,{mode:0o700});}
  const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('附件目录不可用');
 }
}
function file(target){const stat=fs.lstatSync(target);if(stat.isSymbolicLink()||!stat.isFile())throw Error('附件文件不可用');return stat;}
function metadata(id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw Error('附件标识无效');
 const dir=path.join(base,id);directory(dir);const manifest=path.join(dir,'manifest.json');if(file(manifest).size>16384)throw Error('附件信息无效');
 const meta=JSON.parse(fs.readFileSync(manifest,'utf8'));
 if(!Number.isSafeInteger(meta.size)||meta.size<1||meta.size>5*1024*1024)throw Error('附件大小无效');
 if(meta.id!==id||meta.sessionId!==input.sessionId||typeof meta.name!=='string'||path.basename(meta.name)!==meta.name||/[\\\x00-\x1f]/.test(meta.name))throw Error('附件归属无效');
 directory(path.join(dir,'file'));const target=path.join(dir,'file',meta.name);
 if(meta.workspacePath!=='.prism/attachments/'+id+'/file/'+meta.name||file(target).size!==meta.size)throw Error('附件已更改或清理');
 return {meta,target,dir};
}
(async()=>{
 if(input.action==='upload'){
  directory(base,true);const id=input.id,dir=path.join(base,id),staging=path.join(base,'.upload-'+id);
  if(!/^[a-f0-9-]{36}$/.test(id)||path.basename(input.name)!==input.name||/[\\\x00-\x1f]/.test(input.name))throw Error('附件名称无效');
  fs.mkdirSync(staging,{mode:0o700});
  try{
   fs.mkdirSync(path.join(staging,'file'),{mode:0o700});
   const content=fs.readFileSync(input.payload||'/tmp/payload.bin');
   if(!content.length||content.length>5*1024*1024)throw Error('附件大小无效');
   const meta={id,name:input.name,mimeType:input.mimeType,size:content.length,userId:input.userId,sessionId:input.sessionId,createdAt:input.createdAt,sha256:crypto.createHash('sha256').update(content).digest('hex'),workspacePath:'.prism/attachments/'+id+'/file/'+input.name};
   fs.writeFileSync(path.join(staging,'file',input.name),content,{flag:'wx',mode:0o600});
   fs.writeFileSync(path.join(staging,'manifest.json'),JSON.stringify(meta),{flag:'wx',mode:0o600});
   fs.renameSync(staging,dir);process.stdout.write(JSON.stringify(meta));
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
 }else if(input.action==='metadata'){
  process.stdout.write(JSON.stringify(input.ids.map(id=>metadata(id).meta)));
 }else if(input.action==='download'){
  const {meta,target}=metadata(input.id);if(meta.size>5*1024*1024)throw Error('附件大小无效');
  const content=fs.readFileSync(target);if(crypto.createHash('sha256').update(content).digest('hex')!==meta.sha256)throw Error('附件已修改，无法下载原文件');
  fs.writeFileSync(input.payload||'/tmp/payload.bin',content,{mode:0o600});process.stdout.write(JSON.stringify(meta));
 }else if(input.action==='remove'){
  const {meta,dir}=metadata(input.id);if(meta.userId!==input.userId)throw Error('不能删除其他成员的附件');
  fs.rmSync(dir,{recursive:true});process.stdout.write('{}');
 }else throw Error('不支持的附件操作');
})().catch(error=>{process.stderr.write(JSON.stringify({error:error.code==='ENOENT'?'附件已清理或不存在':error.message}));process.exitCode=1;});
`;

// A single fixed-name tar member is enough for Docker's archive API. User names
// are never archive paths, and received archives are read in memory, not extracted.
export function attachmentArchive(content:Buffer){
 const header=Buffer.alloc(512);header.write('payload.bin');
 const octal=(offset:number,length:number,value:number)=>header.write(value.toString(8).padStart(length-1,'0')+'\0',offset,length,'ascii');
 octal(100,8,0o644);octal(108,8,0);octal(116,8,0);octal(124,12,content.length);octal(136,12,0);
 header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write('00',263);
 header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
 return Buffer.concat([header,content,Buffer.alloc((512-content.length%512)%512+1024)]);
}
export function readAttachmentArchive(archive:Buffer){
 let offset=0;
 while(offset+512<=archive.length){
  const header=archive.subarray(offset,offset+512),name=header.subarray(0,100).toString().replace(/\0.*$/s,'');
  if(!name)break;
  const size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim(),8);
  if(!Number.isSafeInteger(size)||size<0||offset+512+size>archive.length)throw new AttachmentError('附件传输格式无效');
  const type=header[156];
  if(name==='payload.bin'&&(type===0||type===48))return archive.subarray(offset+512,offset+512+size);
  offset+=512+Math.ceil(size/512)*512;
 }
 throw new AttachmentError('附件读取失败');
}
async function boundedStream(stream:NodeJS.ReadableStream,limit:number){
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of stream){const data=Buffer.from(chunk);size+=data.length;if(size>limit)throw new AttachmentError('附件超过大小限制',413);chunks.push(data);}
 return Buffer.concat(chunks);
}
function helperLog(buffer:Buffer){
 let offset=0,text='';
 while(offset+8<=buffer.length){const size=buffer.readUInt32BE(offset+4);if(offset+8+size>buffer.length)break;text+=buffer.subarray(offset+8,offset+8+size).toString();offset+=8+size;}
 return text||buffer.toString();
}
export type AttachmentRunner=(id:string,input:Record<string,unknown>,content?:Buffer)=>Promise<{value:unknown;content?:Buffer}>;
const runDockerAttachment:AttachmentRunner=async(id,input,content)=>{
 const engine=containerEngine(60000),volume=`prism-req-code-${id}`;
 try{await engine.getVolume(volume).inspect();}catch(error){if((error as {statusCode?:number}).statusCode===404)throw new AttachmentError('workspace 已清理或尚未创建',404);throw error;}
 const write=input.action==='upload'||input.action==='remove';
 const helper=await engine.createContainer({Image:process.env.PRISM_WORKSPACE_IMAGE||'prism-workspace:latest',Entrypoint:['node'],Cmd:['-e',attachmentFileProgram,JSON.stringify(input)],WorkingDir:'/tmp',Labels:{'prism.attachment-helper':id},
  HostConfig:{Binds:[`${volume}:/workspace${write?'':':ro'}`],NetworkMode:'none',Memory:128*1024*1024,PidsLimit:32,CapDrop:['ALL'],SecurityOpt:['no-new-privileges']}});
 const timer=setTimeout(()=>{void helper.remove({force:true}).catch(()=>{});},45000);timer.unref();
 try{
  if(content)await helper.putArchive(attachmentArchive(content),{path:'/tmp'});
  await helper.start();const result=await helper.wait();
  const text=helperLog(await helper.logs({stdout:true,stderr:true,tail:20}) as Buffer);
  let value:any;try{value=JSON.parse(text);}catch{throw new AttachmentError('附件工作区操作失败，请检查环境',503);}
  if(result.StatusCode!==0)throw new AttachmentError(value.error||'附件操作失败',404);
  if(input.action==='download')return {value,content:readAttachmentArchive(await boundedStream(await helper.getArchive({path:'/tmp/payload.bin'}),MAX_ATTACHMENT_SIZE+64*1024))};
  return {value};
 }finally{clearTimeout(timer);await helper.remove({force:true}).catch(()=>{});}
};
export const runAttachmentHelper:AttachmentRunner=async(id,input,content)=>{
 try{return await runDockerAttachment(id,input,content);}catch(error){
  if(error instanceof AttachmentError)throw error;
  console.warn('[Prism Studio] Workspace attachment operation failed',{action:input.action,error:(error as Error).message});
  throw new AttachmentError('无法访问需求 workspace，请确认容器服务可用后重试',503);
 }
};
function session(id:string){const row=getDb().prepare('SELECT id FROM project_sessions WHERE requirement_id=?').get(id) as {id:string}|undefined;if(!row)throw new AttachmentError('需求会话不存在',404);return row.id;}
function access(id:string,userId:string){const role=projectRole(requirement(id).project_id,userId);if(!role||role==='viewer')throw new AttachmentError('只有项目编辑成员可以访问附件',403);return session(id);}
function attachmentIds(value:unknown):string[]{if(value===undefined)return [];if(!Array.isArray(value)||value.length>MAX_ATTACHMENTS||value.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))||new Set(value).size!==value.length)throw new AttachmentError('附件列表无效');return value;}
function published(sessionId:string,id:string){return !!getDb().prepare(`SELECT 1 FROM conversation_messages m,json_each(CASE WHEN json_valid(m.client_context) THEN m.client_context ELSE '{}' END,'$.attachments') a WHERE m.session_id=? AND json_extract(a.value,'$.id')=? LIMIT 1`).get(sessionId,id);}
function publicMeta(value:StoredAttachment):WorkspaceAttachment {const {id,name,mimeType,size,workspacePath,sha256}=value;return {id,name,mimeType,size,workspacePath,sha256};}
export function createWorkspaceAttachments(run:AttachmentRunner=runAttachmentHelper){
 return {
  async upload(id:string,userId:string,name:string,mimeType:string,content:Buffer){
   const sessionId=access(id,userId);
   name=name.replace(/\\/g,'/').split('/').at(-1)!.replace(/[\x00-\x1f\x7f]/g,'').trim();
   if(!name||name==='.'||name==='..'||Buffer.byteLength(name)>180)throw new AttachmentError('文件名无效或过长');
   if(!content.length||content.length>MAX_ATTACHMENT_SIZE)throw new AttachmentError('单个附件需大于 0 且不超过 5 MB',413);
   const result=await run(id,{action:'upload',id:crypto.randomUUID(),sessionId,userId,name,mimeType:mimeType.slice(0,120)||'application/octet-stream',createdAt:new Date().toISOString()},content);
   access(id,userId);return publicMeta(result.value as StoredAttachment);
  },
  async resolve(id:string,userId:string,value:unknown,requestId?:string){
   const sessionId=access(id,userId),ids=attachmentIds(value);if(!ids.length)return [];
   // A retry of an already accepted message remains idempotent after files are
   // moved/cleaned: the existing durable message is the authoritative metadata.
   if(requestId){const old=getDb().prepare(`SELECT client_context FROM conversation_messages WHERE session_id=? AND user_id=? AND request_id=? AND role='user'`).get(sessionId,userId,requestId) as {client_context:string}|undefined;
    if(old){const saved=JSON.parse(old.client_context||'{}').attachments||[];if(JSON.stringify(saved.map((item:WorkspaceAttachment)=>item.id))!==JSON.stringify(ids))throw new AttachmentError('相同请求标识不能用于不同附件');return saved as WorkspaceAttachment[];}}
   const result=await run(id,{action:'metadata',ids,sessionId});
   const records=result.value as StoredAttachment[];
   for(const record of records)if(record.userId!==userId&&!published(sessionId,record.id))throw new AttachmentError('附件不存在或无权访问',404);
   if(records.reduce((sum,item)=>sum+item.size,0)>MAX_ATTACHMENT_TOTAL)throw new AttachmentError('每条消息的附件总计不能超过 20 MB',413);
   access(id,userId);return records.map(publicMeta);
  },
  async download(id:string,userId:string,attachmentId:string){
   const sessionId=access(id,userId);attachmentIds([attachmentId]);
   const result=await run(id,{action:'download',id:attachmentId,sessionId}),meta=result.value as StoredAttachment;
   if(meta.userId!==userId&&!published(sessionId,attachmentId))throw new AttachmentError('附件不存在或无权访问',404);
   access(id,userId);return {attachment:publicMeta(meta),content:result.content!};
  },
  async remove(id:string,userId:string,attachmentId:string){
   const sessionId=access(id,userId);attachmentIds([attachmentId]);
   if(published(sessionId,attachmentId))throw new AttachmentError('已发送的附件随 workspace 保留，不能单独删除',409);
   await run(id,{action:'remove',id:attachmentId,sessionId,userId});
  },
 };
}
export const workspaceAttachments=createWorkspaceAttachments();
export async function readAttachmentBody(req:IncomingMessage){if(Number(req.headers['content-length'])>MAX_ATTACHMENT_SIZE){req.resume();throw new AttachmentError('单个附件不能超过 5 MB',413);}return boundedStream(req,MAX_ATTACHMENT_SIZE);}
export function sendAttachment(res:ServerResponse,name:string,content:Buffer){
 res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':content.length,'Content-Disposition':`attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase())}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
}
