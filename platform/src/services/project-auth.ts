import crypto from 'node:crypto';
import type Docker from 'dockerode';
import type {Duplex} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import type WebSocket from 'ws';
import {containerEngine} from './container-engine.js';
import {projectConfig,projectRole,type ProjectConfig} from './projects.js';
import {findUserById,getDb} from './db.js';
import {buildAgentEnvironment} from './agent-runtime.js';
import {projectAuthVolume,subscriptionLoginCommand,subscriptionProvider,withProjectAuthGate,type SubscriptionProvider} from './project-auth-storage.js';

interface Session {
 kind?:'probe';
 id:string;projectId:string;userId:string;provider:SubscriptionProvider;fingerprint:string;ticket:string;expires:number;
 container?:Docker.Container;stream?:Duplex;socket?:WebSocket;timer?:ReturnType<typeof setTimeout>;closing?:Promise<void>;
}
export interface LoginStatus {status:'not_logged_in'|'logged_in'|'logging_in';provider:SubscriptionProvider}
const statusCommand=(provider:SubscriptionProvider)=>provider==='codex'?['codex','login','status']:provider==='claude'?['claude','auth','status']:['node','-e',`const fs=require('fs'),path=require('path');try{const value=JSON.parse(fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME,'glm-acp-agent/credentials.json'),'utf8'));process.exit(typeof value.z_ai_api_key==='string'&&value.z_ai_api_key.trim()?0:1)}catch{process.exit(1)}`];
const signature=(config:ProjectConfig)=>JSON.stringify([config.model.provider,config.model.authMode,config.model.proxyUrl||'',config.model.baseUrl]);

export function createProjectAuthService(dependencies:{
 engine?:(timeoutMs?:number)=>Docker;config?:(id:string)=>Promise<ProjectConfig>;role?:(id:string,user:string)=>Promise<string|undefined>;
 userExists?:(user:string)=>Promise<boolean>;active?:(projectId:string)=>Promise<boolean>;
}={}){
 const engine=dependencies.engine||containerEngine,config=dependencies.config||projectConfig,role=dependencies.role||projectRole;
 const userExists=dependencies.userExists||(async id=>!!await findUserById(id));
 const active=dependencies.active||(async id=>!!await getDb().prepare("SELECT 1 FROM conversation_runs c JOIN requirements r ON r.id=c.requirement_id WHERE r.project_id=? AND c.status IN ('queued','running','cancelling','interrupted') LIMIT 1").get(id));
 const sessions=new Map<string,Session>(),locks=new Map<string,string>();
 async function access(projectId:string,userId:string){
  if(!await userExists(userId)||await role(projectId,userId)!=='admin')throw Error('仅项目管理员可以管理订阅登录');
  const value=await config(projectId);
  if(value.model.authMode!=='subscription')throw Error('请先保存订阅模式配置');
  return {value,provider:subscriptionProvider(value.model.provider)};
 }
 async function checkCurrent(session:Session){
  const current=await access(session.projectId,session.userId);
  if(signature(current.value)!==session.fingerprint)throw Error('项目认证配置已更改，请重新打开登录终端');
 }
 async function reserve(projectId:string,userId:string){
  return withProjectAuthGate(projectId,async()=>{
  const {value,provider}=await access(projectId,userId);
  const closing=sessions.get(locks.get(projectId)||'')?.closing;if(closing)await closing;
  if(locks.has(projectId))throw Error('项目登录操作正在进行，请先关闭已有终端');
  const session:Session={id:crypto.randomUUID(),projectId,userId,provider,fingerprint:signature(value),ticket:crypto.randomBytes(32).toString('hex'),expires:Date.now()+60000};
  locks.set(projectId,session.id);sessions.set(session.id,session);
  try{if(await active(projectId))throw Error('项目有未结束的 Agent 任务，请先结束任务再管理登录');}
  catch(error){await close(session);throw error;}
  return {session,value};
  });
 }
 async function close(session:Session){
  if(session.closing)return session.closing;
  session.closing=Promise.resolve().then(async()=>{
   clearTimeout(session.timer);session.stream?.destroy();session.socket?.close();
   if(session.container)try{await session.container.remove({force:true});}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw Error('授权容器清理失败，请重试关闭登录终端');}
   sessions.delete(session.id);if(locks.get(session.projectId)===session.id)locks.delete(session.projectId);
  });
  try{await session.closing;}catch(error){session.closing=undefined;throw error;}
 }
 async function helper(session:Session,value:ProjectConfig){
  const docker=engine(),volume=projectAuthVolume(session.projectId);
  await docker.createVolume({Name:volume,Labels:{'prism.project':session.projectId,'prism.purpose':'project-auth','prism.mode':process.env.PRISM_MODE||'dev'}});
  const container=await docker.createContainer({name:`${volume}-login-${session.id}`,Image:process.env.PRISM_WORKSPACE_IMAGE||'prism-workspace:latest',
   User:'prism',Entrypoint:['node','-e','setInterval(()=>{},3600000)'],WorkingDir:'/tmp',
   Env:[...buildAgentEnvironment({provider:session.provider,authMode:'subscription',apiKey:'',baseUrl:value.model.baseUrl,model:value.model.model,proxyUrl:value.model.proxyUrl}),'TERM=xterm-256color','COLORTERM=truecolor'],
   Labels:{'prism.project-auth-helper':'true','prism.project':session.projectId,'prism.mode':process.env.PRISM_MODE||'dev'},
   HostConfig:{Binds:[`${volume}:/project-auth`],Memory:512*1024*1024,NanoCpus:1e9,PidsLimit:128,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],LogConfig:{Type:'none',Config:{}}},
  });
  session.container=container;
  if(session.closing){await container.remove({force:true});throw Error('登录会话已关闭');}
  await container.start();
  if(session.closing)throw Error('登录会话已关闭');
  return container;
 }
 async function execute(container:Docker.Container,command:string[]){
  const exec=await container.exec({Cmd:command,AttachStdout:true,AttachStderr:true});
  const stream=await exec.start({Detach:false,Tty:false});stream.resume();
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('授权命令响应超时')),20000);
   stream.once('end',()=>{clearTimeout(timer);resolve();});stream.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  return (await exec.inspect()).ExitCode;
 }
 async function status(projectId:string,userId:string):Promise<LoginStatus>{
  return withProjectAuthGate(projectId,async()=>{
  const {value,provider}=await access(projectId,userId);
  const closing=sessions.get(locks.get(projectId)||'')?.closing;if(closing)await closing;
  if(locks.has(projectId))return {provider,status:'logging_in'};
  // Read-only status probes are serialized with login/logout, but may run while
  // requirements execute. They never return credential contents.
  const session:Session={id:crypto.randomUUID(),projectId,userId,provider,fingerprint:signature(value),ticket:'',expires:0,kind:'probe'};
  locks.set(projectId,session.id);sessions.set(session.id,session);
  try{
   try{await engine().getVolume(projectAuthVolume(projectId)).inspect();}catch(error){if((error as {statusCode?:number}).statusCode===404)return {provider,status:'not_logged_in'};throw error;}
   return {provider,status:await execute(await helper(session,value),statusCommand(provider))===0?'logged_in':'not_logged_in'};
  }
  finally{await close(session);}
  });
 }
 async function start(projectId:string,userId:string){
  const {session,value}=await reserve(projectId,userId);
  try{
   await helper(session,value);session.expires=Date.now()+60000;
   session.timer=setTimeout(()=>void close(session).catch(()=>{}),60000);session.timer.unref();
   return {id:session.id,ticket:session.ticket,provider:session.provider,command:subscriptionLoginCommand(session.provider).join(' ')};
  }catch(error){await close(session);throw error;}
 }
 async function attach(projectId:string,id:string,ticket:string,socket:WebSocket){
  const session=sessions.get(id);
  if(!session||session.projectId!==projectId||session.expires<Date.now()||!ticket||session.ticket!==ticket||session.socket)throw Error('登录终端连接已过期，请重新打开');
  session.ticket='';session.socket=socket;
  socket.once('close',()=>{void close(session).catch(()=>{});});
  try{await checkCurrent(session);}catch(error){await close(session);throw error;}
  if(socket.readyState!==1){await close(session);return;}clearTimeout(session.timer);
  session.timer=setTimeout(()=>void close(session).catch(()=>{}),20*60*1000);session.timer.unref();
  const send=(value:unknown)=>{if(socket.readyState===1)socket.send(JSON.stringify(value));};
  const exec=await engine(0).getContainer(session.container!.id).exec({Cmd:subscriptionLoginCommand(session.provider),Tty:true,AttachStdin:true,AttachStdout:true,AttachStderr:true,Env:['TERM=xterm-256color']});
  const stream=await exec.start({hijack:true,stdin:true,Tty:true}) as Duplex;session.stream=stream;
  if(session.closing||socket.readyState!==1){stream.destroy();return;}
  const decoder=new StringDecoder('utf8');
  let ended=false,input=Promise.resolve();
  const cleanup=()=>{clearInterval(watch);void close(session).catch(()=>send({type:'error',message:'授权容器清理失败，请重试关闭终端'}));};
  const watch=setInterval(()=>void checkCurrent(session).catch(()=>{send({type:'error',message:'权限或认证配置已变化，终端已关闭'});cleanup();}),5000);watch.unref();
  socket.once('close',cleanup);socket.once('error',cleanup);
  socket.on('message',raw=>{
   input=input.then(async()=>{
    await checkCurrent(session);if(ended||session.closing)return;
    const message=JSON.parse(String(raw));
    if(message.type==='input'&&typeof message.data==='string'&&message.data.length<=16384)stream.write(message.data);
    else if(message.type==='resize'&&Number.isInteger(message.cols)&&Number.isInteger(message.rows)){
     // Some Podman versions reject an early exec resize while the PTY is
     // starting. Resizing must not terminate an otherwise usable login.
     await exec.resize({w:Math.max(20,Math.min(300,message.cols)),h:Math.max(5,Math.min(100,message.rows))}).catch(()=>{});
    }
   }).catch(()=>{send({type:'error',message:'终端输入无效或权限已变化'});cleanup();});
  });
  stream.on('data',(chunk:Buffer)=>{
   if(socket.bufferedAmount>1024*1024){send({type:'error',message:'终端输出过多，连接已关闭'});cleanup();return;}
   send({type:'output',data:decoder.write(chunk)});
  });
  stream.once('error',()=>{send({type:'error',message:'登录终端连接中断，请重新打开'});cleanup();});
  stream.once('end',()=>{void(async()=>{
   if(ended||session.closing)return;ended=true;
   const tail=decoder.end();if(tail)send({type:'output',data:tail});
   const result=await exec.inspect();
   const logged=result.ExitCode===0&&await execute(session.container!,statusCommand(session.provider))===0;
   send({type:'exit',success:logged,message:logged?'项目订阅登录成功':'登录未完成，可重新打开终端重试'});cleanup();
  })().catch(()=>{send({type:'error',message:'无法确认登录结果，请刷新登录状态'});cleanup();});});
  send({type:'ready'});
 }
 async function stop(projectId:string,id:string,userId:string){
  await access(projectId,userId);const session=sessions.get(id);
  if(session&&session.projectId===projectId&&session.userId===userId)await close(session);
 }
 async function logout(projectId:string,userId:string){
  const {session,value}=await reserve(projectId,userId);
  try{
   const container=await helper(session,value);
   if(session.provider==='codex')await execute(container,['codex','logout']);
   if(session.provider==='claude')await execute(container,['claude','auth','logout']);
   const folder=`/project-auth/${session.provider}`;
   const code=await execute(container,['node','-e',`const fs=require('fs');fs.rmSync(process.argv[1],{recursive:true,force:true});fs.mkdirSync(process.argv[1],{recursive:true,mode:0o700});`,folder]);
   if(code!==0)throw Error('退出登录失败，请检查授权目录权限');
   return {status:'not_logged_in' as const,provider:session.provider};
  }finally{await close(session);}
 }
 async function recover(){
  const docker=engine(),containers=await docker.listContainers({all:true,filters:JSON.stringify({label:['prism.project-auth-helper=true',`prism.mode=${process.env.PRISM_MODE||'dev'}`]})});
  for(const item of containers)await docker.getContainer(item.Id).remove({force:true});
 }
 return {status,start,attach,stop,logout,recover,isBusy:(projectId:string)=>{const id=locks.get(projectId);return !!id&&sessions.get(id)?.kind!=='probe';},closeAll:async()=>{await Promise.all([...sessions.values()].map(close));}};
}
export const projectAuth=createProjectAuthService();
