import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Codex's JSON exec protocol currently omits native imagegen results. Its
// thread rollout retains the completed event and the actual image bytes.
export function persistCodexImages(projectRoot:string,threadId:string|null,runId:string,home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')):string[]{
 if(!threadId||!/^[a-zA-Z0-9_-]+$/.test(threadId)||!/^[a-zA-Z0-9_-]+$/.test(runId))return [];
 const sessions=path.join(home,'sessions');
 function locate(dir:string,depth=0):string|undefined{
  if(depth>4||!fs.existsSync(dir))return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   if(entry.isSymbolicLink())continue;
   const target=path.join(dir,entry.name);
   if(entry.isFile()&&entry.name.endsWith(`-${threadId}.jsonl`))return target;
   if(entry.isDirectory()){const found=locate(target,depth+1);if(found)return found;}
  }
 }
 const rollout=locate(sessions);if(!rollout)return [];
 if(fs.statSync(rollout).size>64*1024*1024)throw Error('Codex 图片会话记录过大，无法安全提取产物');
 const images=new Map<string,Buffer>();
 for(const line of fs.readFileSync(rollout,'utf8').split('\n')){
  let record;try{record=JSON.parse(line);}catch{continue;}
  const event=record.payload;
  if(record.type!=='event_msg'||event?.type!=='image_generation_end'||event.status!=='completed')continue;
  if(typeof event.result!=='string'||!event.result||event.result.length>28*1024*1024)throw Error('图片已生成，但图片数据缺失或超过保存限制');
  const bytes=Buffer.from(event.result,'base64');
  const extension=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':undefined;
  if(!extension)throw Error('图片已生成，但返回的图片格式无法识别');
  const name=crypto.createHash('sha256').update(bytes).digest('hex')+'.'+extension;
  images.set(name,bytes);if(images.size>20)throw Error('单次生成图片数量超过保存限制');
 }
 if(!images.size)return [];
 // Keep artifacts in the requirement source volume, independently of auth and
 // ephemeral /tmp. Never follow a repository-provided output-directory symlink.
 const root=fs.realpathSync(projectRoot);let directory=root;
 for(const part of ['prism-artifacts',runId]){
  directory=path.join(directory,part);
  try{fs.mkdirSync(directory,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  if(!fs.lstatSync(directory).isDirectory()||fs.lstatSync(directory).isSymbolicLink())throw Error('图片产物目录无效');
 }
 return [...images].map(([name,bytes])=>{
  const target=path.join(directory,name);
  try{fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||!fs.lstatSync(target).isFile()||fs.lstatSync(target).isSymbolicLink()||!fs.readFileSync(target).equals(bytes))throw error;}
  return path.relative(root,target).split(path.sep).join('/');
 });
}
