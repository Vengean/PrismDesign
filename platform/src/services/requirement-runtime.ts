import {workspaceEditorEntrypoint,editorReadyProgram} from './workspace-editor.js';
import {runtimeResourceNames} from './runtime-identity.js';
import {assertRuntimeChangeAllowed,assertWorkspaceIdle,workspaceEvents,releaseInterruptedRun,withWorkspaceGate} from './workspace-lock.js';
import {containerEngine} from './container-engine.js';
export {containerEngine} from './container-engine.js';
import {projectAuthVolume} from './project-auth-storage.js';
import {projectAuth} from './project-auth.js';
import { PassThrough } from 'node:stream';
import { getDb } from './db.js';
import { projectConfig, resolveProjectAgentRuntime, resolveProjectGitCredential } from './projects.js';
import { buildAgentEnvironment } from './agent-runtime.js';
import {prepareProjectKnowledge} from './project-knowledge.js';

export function workspaceSecurityOptions(provider?:string){
 const options=['no-new-privileges'];
 const type=process.env.PRISM_CODEX_SELINUX_TYPE?.trim();
 if(provider==='codex'&&type){
  if(!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(type))throw Error('PRISM_CODEX_SELINUX_TYPE 无效');
  options.push(`label=type:${type}`);
 }
 return options;
}

export async function initRuntimeTables() {
 if(getDb().dialect==='mysql'){await getDb().ready();return;}
  (await getDb().exec(`CREATE TABLE IF NOT EXISTS requirement_environments (
    requirement_id TEXT PRIMARY KEY REFERENCES requirements(id) ON DELETE CASCADE,
    container_id TEXT, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`));
}
export async function requirement(id:string) {
  const row=(await getDb().prepare('SELECT * FROM requirements WHERE id=?').get(id)) as {id:string;project_id:string;environment_status:string;status:string;release_id:string|null;branch_name:string;branch_status:string}|undefined;
  if(!row)throw new Error('需求不存在');return row;
}
async function configFor(id:string) {
  const r=(await requirement(id));
  return {r,config:(await projectConfig(r.project_id))};
}
export async function redactRuntimeText(id:string,value:string,extraSecrets:string[] = []) {
  const {r,config}=(await configFor(id));
  const secrets:string[]=[...extraSecrets];
  if(config.gitAuth.credentialRef)secrets.push((await resolveProjectGitCredential(r.project_id,config.gitAuth.credentialRef)).secret);
  try{secrets.push((await resolveProjectAgentRuntime(r.project_id)).apiKey);}catch{}
  for(const secret of secrets.filter(Boolean))value=value.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
  return value.replace(/(__PRISM_AGENT_TOKEN__=)[^\r\n]+/g,'$1[REDACTED]').replace(/(访问 Token:\s*)[a-f0-9]{32,}/g,'$1[REDACTED]');
}
async function state(id:string,status:string,error='') {
  (await getDb().prepare('UPDATE requirements SET environment_status=? WHERE id=?').run(status,id));
  (await getDb().prepare(`INSERT INTO requirement_environments(requirement_id,error) VALUES(?,?) ON CONFLICT(requirement_id) DO UPDATE SET error=excluded.error,updated_at=datetime('now')`).run(id,error));
}
export async function runtimeContainer(id:string,timeoutMs=15000) {(await requirement(id));return containerEngine(timeoutMs).getContainer(runtimeResourceNames(id).container);}
export async function execRuntime(id:string,cmd:string[],timeoutMs=15000) {
  const exec=await (await runtimeContainer(id,timeoutMs)).exec({Cmd:cmd,AttachStdout:true,AttachStderr:true});
  const stream=await exec.start({Detach:false,Tty:false});
  const out=new PassThrough();const chunks:Buffer[]=[];let size=0;
  out.on('data',(b:Buffer)=>{size+=b.length;if(size<=2*1024*1024)chunks.push(b);});
  containerEngine().modem.demuxStream(stream,out,out);
  await new Promise<void>((resolve,reject)=>{stream.on('end',resolve);stream.on('error',reject);});
  const result=await exec.inspect();return {code:result.ExitCode,text:Buffer.concat(chunks).toString('utf8')};
}
const gitOperations=new Set<string>();
export async function withGitOperation<T>(id:string,work:()=>Promise<T>):Promise<T>{
 await withWorkspaceGate(id,async()=>{await assertWorkspaceIdle(id);if(runtimeOperationActive(id))throw Error("环境或 Git 操作进行中，请稍后重试");gitOperations.add(id);workspaceEvents.emit("locked",id);});
 try{return await work();}finally{gitOperations.delete(id);workspaceEvents.emit("changed",id);}
}
const operations=new Map<string,Promise<void>>();
export function runtimeOperationActive(id:string){return operations.has(id)||gitOperations.has(id);}
// Caller holds the workspace operation lock; only this requirement's exact resources are removed.
export async function removeWorkspaceResources(id:string,engine=containerEngine()){
 const names=runtimeResourceNames(id);
 try{await engine.getContainer(names.container).remove({force:true});}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw Error('清理需求容器失败，请检查容器引擎后重试');}
 try{await engine.getVolume(names.volume).remove();}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw Error('清理需求源码卷失败，请检查是否被占用后重试');}
 try{await engine.getVolume(`${names.volume}-codex`).remove();}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw Error('清理 Codex 登录卷失败，请检查是否被占用后重试');}
 try{await engine.getVolume(`${names.volume}-claude`).remove();}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw Error('清理 Claude 登录卷失败，请检查是否被占用后重试');}
}
export async function startRuntime(id:string):Promise<void> {
  const {work}=await withWorkspaceGate(id,async()=>{
   const row=await requirement(id);if(['merged','closed'].includes(row.status))throw Error('已合入或关闭的需求只读');if(row.release_id&&row.branch_status!=='ready')throw Error('需求分支尚未就绪');
   await assertRuntimeChangeAllowed(id);if(gitOperations.has(id))throw Error('Git 操作进行中，请稍后重试');
   const existing=operations.get(id);if(existing)return {work:existing};
   workspaceEvents.emit('locked',id);const work=prepareRuntime(id).finally(()=>{operations.delete(id);workspaceEvents.emit('changed',id);});operations.set(id,work);return {work};
  });return work;
}
async function prepareRuntime(id:string,editing=false) {
  const {r,config}=(await configFor(id));
  if(projectAuth.isBusy(r.project_id))throw Error('项目登录操作正在进行，请先关闭登录终端');
  const sourceRepos=r.release_id?(await getDb().prepare('SELECT repo_name AS name,url FROM requirement_repositories WHERE requirement_id=?').all(id)).map(item=>({...item,branch:r.branch_name})):config.repos;
  try {
    if(!sourceRepos.length)throw new Error('需求环境配置未包含仓库，请先在项目设置中配置仓库');
    if(!editing&&!config.startupScript.trim())throw new Error('需求环境配置未包含启动脚本，请先在项目设置中配置启动脚本');
    if(config.gitAuth.requiresUpdate || !config.gitAuth.credentialRef)throw new Error('需求环境配置缺少 Git 凭证，请先检查项目设置');
    if(sourceRepos.some(repo=>!/^[a-zA-Z0-9_-]+$/.test(repo.name)||/[\r\n]/.test(repo.url+repo.branch)||repo.branch.startsWith('-')))throw new Error('仓库配置无效');
    const git=(await resolveProjectGitCredential(r.project_id,config.gitAuth.credentialRef));
    let agent;try{agent=await resolveProjectAgentRuntime(r.project_id);}catch(error){if(!editing)throw error;}
    const securityOptions=workspaceSecurityOptions(agent?.provider);
    (await state(id,editing?'stopped':'preparing'));
    const engine=containerEngine();const name=runtimeResourceNames(id).container;
    const knowledge=await prepareProjectKnowledge(engine,r.project_id,config.guidance,config.knowledge);
    let container=engine.getContainer(name);
    try {
      const info=await container.inspect();
      // Environment variables and credentials are immutable in Docker: recreate the
      // process container on every explicit start, keeping the source/dependency volume.
      if(info.State.Running)await container.stop({t:10});
      await container.remove();
      (await getDb().prepare('UPDATE requirement_environments SET container_id=NULL WHERE requirement_id=?').run(id));
    } catch(e) {if((e as {statusCode?:number}).statusCode!==404)throw e;}
    (await releaseInterruptedRun(id));
    // Named volumes survive stop/start and platform restarts; unrelated resources are never removed.
    const volume=runtimeResourceNames(id).volume;
    await engine.createVolume({Name:volume,Labels:{'prism.requirement':id}});
    const binds=[`${volume}:/workspace`];
    binds.push(`${knowledge}:/workspace/.global:ro`);
    if(agent?.authMode==='subscription'){
      const authVolume=projectAuthVolume(r.project_id);
      await engine.createVolume({Name:authVolume,Labels:{'prism.project':r.project_id,'prism.purpose':'project-auth','prism.mode':process.env.PRISM_MODE||'dev'}});
      binds.push(`${authVolume}:/project-auth`);
    }
    container=await engine.createContainer({name,Image:process.env.PRISM_WORKSPACE_IMAGE || 'prism-workspace:latest',
      Entrypoint:editing?['bash','-c',workspaceEditorEntrypoint]:['/project-entrypoint.sh'],WorkingDir:'/workspace',
      Env:[...(agent?buildAgentEnvironment(agent,{proxyScope:'agent'}):[]),'PRISM_RUNTIME_CONTAINER=true','PRISM_PERMISSION_FILESYSTEM=workspace-write','PRISM_PERMISSION_COMMANDS=workspace','PRISM_PERMISSION_NETWORK=true','PRISM_PERMISSION_BROWSER=true','PRISM_PERMISSION_MCP=true',`PRISM_REPOS=${JSON.stringify(sourceRepos)}`,`PRISM_BRANCH=${r.branch_name||`prism/requirement-${id}`}`,
        `GIT_ACCESS_TOKEN=${git.mode==='token'?git.secret:''}`,`GIT_SSH_KEY=${git.mode==='ssh'?git.secret:''}`,`GIT_SSH_PORT=${config.gitAuth.sshPort}`,
        `INIT_SCRIPT=${config.initScript}`,`STARTUP_SCRIPT=${config.startupScript}`,'PRISM_PLATFORM_TOOLS=true','PRISM_PROJECT_GLOBAL=/workspace/.global/current',`PRISM_PREPARE_TIMEOUT=${process.env.PRISM_PREPARE_TIMEOUT || 1800}`,`PRISM_STARTUP_TIMEOUT=${process.env.PRISM_STARTUP_TIMEOUT || 120}`],
      Labels:{'prism.requirement':id,'prism.project':r.project_id,'prism.runtime-mode':editing?'edit':'service'},ExposedPorts:{'8090/tcp':{},'8080/tcp':{}},
      HostConfig:{Binds:binds,PortBindings:{'8090/tcp':[{HostIp:'127.0.0.1',HostPort:''}],'8080/tcp':[{HostIp:'127.0.0.1',HostPort:''}]},
        Memory:4*1024*1024*1024,NanoCpus:2e9,PidsLimit:512,CapDrop:['ALL'],SecurityOpt:securityOptions,LogConfig:{Type:'json-file',Config:{'max-size':'10m','max-file':'3'}}}});
    (await getDb().prepare('UPDATE requirement_environments SET container_id=? WHERE requirement_id=?').run(container.id,id));
    await container.start();
  }catch(e){(await state(id,'failed',(await redactRuntimeText(id,(e as Error).message))));throw e;}
}
// Caller holds the workspace operation lock. Reuse the persistent source volume.
export async function ensureWorkspaceRuntimeLocked(id:string){
 const row=await requirement(id);if(['merged','closed'].includes(row.status))throw Error('已合入或关闭的需求只读');if(row.release_id&&row.branch_status!=='ready')throw Error('需求分支尚未就绪');
 let running=false;try{const info=await (await runtimeContainer(id)).inspect();running=info.State.Running;}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw error;}
 if(!running)await prepareRuntime(id,true);
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){const info=await (await runtimeContainer(id)).inspect();if(!info.State.Running)throw Error('源码工作区准备失败，请查看运行日志');
  if(info.Config.Labels?.['prism.runtime-mode']!=='edit')return;
  if((await execRuntime(id,['node','-e',editorReadyProgram],5000)).code===0){await state(id,'stopped');return;}
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 throw Error('源码工作区准备超时，请查看运行日志后重试');
}
export async function ensureEditorRuntime(id:string){
 // Opening an existing editor does not mutate the workspace or interrupt Agent work.
 const row=await requirement(id);if(['merged','closed'].includes(row.status))throw Error('已合入或关闭的需求只读');
 try{if((await (await runtimeContainer(id)).inspect()).State.Running)return;}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw error;}
 return withGitOperation(id,()=>ensureWorkspaceRuntimeLocked(id));
}
export async function stopRuntime(id:string):Promise<void> {
  const {work}=await withWorkspaceGate(id,async()=>{
   await assertRuntimeChangeAllowed(id);if(runtimeOperationActive(id))throw Error('环境操作进行中，请稍后重试');
   const work=performStopRuntime(id).finally(()=>{operations.delete(id);workspaceEvents.emit('changed',id);});operations.set(id,work);return {work};
  });return work;
}
async function performStopRuntime(id:string){
  try{await (await runtimeContainer(id)).stop({t:10});}catch(e){if(![304,404].includes((e as {statusCode:number}).statusCode))throw e;}
  (await releaseInterruptedRun(id));
  (await state(id,'stopped'));
}
export interface RuntimeService {port:number;protocol:'http'|'non-http'|'timeout'|'unavailable';ready:boolean;page?:boolean;statusCode?:number;contentType?:string}
export interface RuntimeHealth {status:string;phase:string;startedAt:number;checkedAt:number;observedAt?:number;agentReady:boolean;services:RuntimeService[];defaultPort?:number;error:string}
// Compare timestamps within the container clock, which can drift from the host
// after a Podman VM sleeps. Reading must not make an old heartbeat fresh.
export const readRuntimeHealthProgram=`const fs=require('fs');let health={};try{health=JSON.parse(fs.readFileSync('/var/log/prism/health.json','utf8'))}catch{}process.stdout.write(JSON.stringify({...health,observedAt:Date.now()}));`;
export function runtimeHealthFresh(health:Partial<RuntimeHealth>){
  const age=(health.observedAt??NaN)-(health.checkedAt??NaN);
  return Number.isFinite(age)&&age>=0&&age<15000;
}
async function runtimeHealth(id:string):Promise<RuntimeHealth> {
  const result=await execRuntime(id,['node','-e',readRuntimeHealthProgram]);
  if(result.code!==0)throw Error('无法读取环境健康状态');
  return JSON.parse(result.text);
}
export async function runtimeServices(id:string) {const health=await runtimeHealth(id);return runtimeHealthFresh(health)?health.services || []:[];}
export async function runtimeServicePorts(id:string):Promise<number[]> {
  return (await runtimeServices(id)).filter(s=>s.protocol==='http'&&s.ready).map(s=>s.port);
}
export async function runtimeStatus(id:string) {
  const r=(await requirement(id));
  let status=r.environment_status,health:Partial<RuntimeHealth>={},engineError='';
  if(operations.has(id))return {status:'preparing',ports:[] as number[],services:[] as RuntimeService[],agentReady:false,phase:'preparing',elapsedSeconds:0,error:'',branch:r.branch_name||`prism/requirement-${id}`};
  try {
    const info=await (await runtimeContainer(id)).inspect();
    if(!info.State.Running) {
      status=info.State.ExitCode && status!=='stopped'?'failed':'stopped';
      if(status==='failed'){
        const raw=await (await runtimeContainer(id)).logs({stdout:true,stderr:true,tail:20});
        const text=Buffer.isBuffer(raw)?raw.toString('utf8'):String(raw);
        engineError=[...text.matchAll(/__PRISM_RUNTIME_ERROR__=([^\r\n]+)/g)].at(-1)?.[1] || '环境进程已退出，请查看运行日志后重试。';
      }
    } else {
      if(info.Config.Labels?.['prism.runtime-mode']==='edit'){const ready=await execRuntime(id,['node','-e',editorReadyProgram],5000);status='stopped';health.phase=ready.code===0?'editing':'preparing-workspace';}
      else {health=await runtimeHealth(id);
      if(runtimeHealthFresh(health))status=health.status || 'preparing';
      else {
        status='starting';
        const age=(health.observedAt??NaN)-new Date(info.State.StartedAt).getTime();
        if(age>20000){status='failed';engineError=health.checkedAt?'环境健康检查已停止更新，请检查监控日志并重启环境。':'环境健康检查未生成状态，请检查环境日志及需求镜像版本。';}
      }
      }
    }
  }catch(e){if((e as {statusCode?:number}).statusCode===404){if(['preparing','starting','running'].includes(status))status='failed';}else engineError='容器引擎暂时不可用，请稍后重试';}
  if(status!==r.environment_status)(await state(id,status));
  const row=(await getDb().prepare('SELECT error FROM requirement_environments WHERE requirement_id=?').get(id)) as {error:string}|undefined;
  const services=['starting','running'].includes(status)?health.services || []:[];
  return {status,ports:services.filter(s=>s.protocol==='http'&&s.ready).map(s=>s.port),services,
    agentReady:health.agentReady===true&&['starting','running'].includes(status),phase:health.phase || status,
    defaultPort:health.defaultPort,elapsedSeconds:health.startedAt?Math.max(0,Math.floor(((health.observedAt??health.startedAt)-health.startedAt)/1000)):0,
    error:(await redactRuntimeText(id,engineError || health.error || row?.error || '')),branch:r.branch_name||`prism/requirement-${id}`};
}
export async function runtimeLogs(id:string) {
  let value='';const runtimeSecrets:string[]=[];
  try {
    const raw=await (await runtimeContainer(id)).logs({stdout:true,stderr:true,tail:300});
    // Docker multiplexed frames, not a TTY stream.
    const b=Buffer.isBuffer(raw)?raw:Buffer.from(raw as unknown as string);let offset=0;
    while(offset+8<=b.length){const length=b.readUInt32BE(offset+4);if(offset+8+length>b.length)break;value+=b.subarray(offset+8,offset+8+length).toString();offset+=8+length;}
    const info=await (await runtimeContainer(id)).inspect();
    for(const entry of info.Config.Env || [])if(/^(GIT_ACCESS_TOKEN|GIT_SSH_KEY|ANTHROPIC_API_KEY)=/.test(entry))runtimeSecrets.push(entry.slice(entry.indexOf('=')+1));
    if(info.State.Running){const app=await execRuntime(id,['sh','-c','tail -n 200 /var/log/prism/startup.log /var/log/prism/agent.log /var/log/prism/code-server.log /var/log/prism/proxy.log 2>/dev/null']);value+='\n'+app.text;}
  }catch(e){if((e as {statusCode?:number}).statusCode!==404)throw e;}
  return (await redactRuntimeText(id,value,runtimeSecrets)).slice(-100000);
}
export async function runtimePort(id:string,kind:'preview'|'ide') {
  const info=await (await runtimeContainer(id)).inspect();
  if(!info.State.Running)throw new Error('环境未运行');
  const port=info.NetworkSettings.Ports[kind==='ide'?'8080/tcp':'8090/tcp']?.[0]?.HostPort;
  if(!port)throw new Error('服务端口尚未就绪');return Number(port);
}
