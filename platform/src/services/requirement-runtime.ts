import {assertRuntimeChangeAllowed,assertWorkspaceIdle,workspaceEvents,releaseInterruptedRun} from './workspace-lock.js';
import Docker from 'dockerode';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { getDb } from './db.js';
import { projectConfig, resolveProjectAgentRuntime, resolveProjectGitCredential } from './projects.js';
import { buildAgentEnvironment } from './agent-runtime.js';

export function containerEngine(timeoutMs=15000) {
  const candidates=[process.env.CONTAINER_SOCKET,path.join(os.homedir(),'.local/share/containers/podman/machine/podman.sock'),path.join(os.homedir(),'.config/containers/podman/machine/podman.sock'),process.env.XDG_RUNTIME_DIR && `${process.env.XDG_RUNTIME_DIR}/podman/podman.sock`,'/run/podman/podman.sock','/var/run/docker.sock'];
  return new Docker({socketPath:candidates.find(p=>p && fs.existsSync(p)) || '/var/run/docker.sock',timeout:timeoutMs});
}
export function initRuntimeTables() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS requirement_environments (
    requirement_id TEXT PRIMARY KEY REFERENCES requirements(id) ON DELETE CASCADE,
    container_id TEXT, error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}
export function requirement(id:string) {
  const row=getDb().prepare('SELECT * FROM requirements WHERE id=?').get(id) as {id:string;project_id:string;environment_status:string}|undefined;
  if(!row)throw new Error('需求不存在');return row;
}
function configFor(id:string) {
  const r=requirement(id);
  return {r,config:projectConfig(r.project_id)};
}
export function redactRuntimeText(id:string,value:string,extraSecrets:string[] = []) {
  const {r,config}=configFor(id);
  const secrets:string[]=[...extraSecrets];
  if(config.gitAuth.credentialRef)secrets.push(resolveProjectGitCredential(r.project_id,config.gitAuth.credentialRef).secret);
  try{secrets.push(resolveProjectAgentRuntime(r.project_id).apiKey);}catch{}
  for(const secret of secrets.filter(Boolean))value=value.split(secret).join('[REDACTED]').split(encodeURIComponent(secret)).join('[REDACTED]');
  return value.replace(/(__PRISM_AGENT_TOKEN__=)[^\r\n]+/g,'$1[REDACTED]').replace(/(访问 Token:\s*)[a-f0-9]{32,}/g,'$1[REDACTED]');
}
function state(id:string,status:string,error='') {
  getDb().prepare('UPDATE requirements SET environment_status=? WHERE id=?').run(status,id);
  getDb().prepare(`INSERT INTO requirement_environments(requirement_id,error) VALUES(?,?) ON CONFLICT(requirement_id) DO UPDATE SET error=excluded.error,updated_at=datetime('now')`).run(id,error);
}
export function runtimeContainer(id:string,timeoutMs=15000) {requirement(id);return containerEngine(timeoutMs).getContainer(`prism-req-${id}`);}
export async function execRuntime(id:string,cmd:string[],timeoutMs=15000) {
  const exec=await runtimeContainer(id,timeoutMs).exec({Cmd:cmd,AttachStdout:true,AttachStderr:true});
  const stream=await exec.start({Detach:false,Tty:false});
  const out=new PassThrough();const chunks:Buffer[]=[];let size=0;
  out.on('data',(b:Buffer)=>{size+=b.length;if(size<=2*1024*1024)chunks.push(b);});
  containerEngine().modem.demuxStream(stream,out,out);
  await new Promise<void>((resolve,reject)=>{stream.on('end',resolve);stream.on('error',reject);});
  const result=await exec.inspect();return {code:result.ExitCode,text:Buffer.concat(chunks).toString('utf8')};
}
const gitOperations=new Set<string>();
export async function withGitOperation<T>(id:string,work:()=>Promise<T>):Promise<T>{
 assertWorkspaceIdle(id);if(runtimeOperationActive(id))throw Error("环境或 Git 操作进行中，请稍后重试");
 gitOperations.add(id);workspaceEvents.emit("locked",id);
 try{return await work();}finally{gitOperations.delete(id);workspaceEvents.emit("changed",id);}
}
const operations=new Map<string,Promise<void>>();
export function runtimeOperationActive(id:string){return operations.has(id)||gitOperations.has(id);}
export function startRuntime(id:string):Promise<void> {
  try{assertRuntimeChangeAllowed(id);if(gitOperations.has(id))throw Error("Git 操作进行中，请稍后重试");}catch(e){return Promise.reject(e);}
  const existing=operations.get(id);if(existing)return existing;
  const work=prepareRuntime(id).finally(()=>operations.delete(id));operations.set(id,work);return work;
}
async function prepareRuntime(id:string) {
  const {r,config}=configFor(id);
  try {
    if(!config.repos.length)throw new Error('需求环境配置未包含仓库，请先在项目设置中配置仓库');
    if(!config.startupScript.trim())throw new Error('需求环境配置未包含启动脚本，请先在项目设置中配置启动脚本');
    if(config.gitAuth.requiresUpdate || !config.gitAuth.credentialRef)throw new Error('需求环境配置缺少 Git 凭证，请先检查项目设置');
    if(config.repos.some(repo=>!/^[a-zA-Z0-9_-]+$/.test(repo.name)||/[\r\n]/.test(repo.url+repo.branch)||repo.branch.startsWith('-')))throw new Error('仓库配置无效');
    const git=resolveProjectGitCredential(r.project_id,config.gitAuth.credentialRef);
    const agent=resolveProjectAgentRuntime(r.project_id);
    state(id,'preparing');
    const engine=containerEngine();const name=`prism-req-${id}`;
    let container=engine.getContainer(name);
    try {
      const info=await container.inspect();
      // Environment variables and credentials are immutable in Docker: recreate the
      // process container on every explicit start, keeping the source/dependency volume.
      if(info.State.Running)await container.stop({t:10});
      await container.remove();
      getDb().prepare('UPDATE requirement_environments SET container_id=NULL WHERE requirement_id=?').run(id);
    } catch(e) {if((e as {statusCode?:number}).statusCode!==404)throw e;}
    releaseInterruptedRun(id);
    // Named volumes survive stop/start and platform restarts; unrelated resources are never removed.
    const volume=`prism-req-code-${id}`;
    await engine.createVolume({Name:volume,Labels:{'prism.requirement':id}});
    container=await engine.createContainer({name,Image:process.env.PRISM_WORKSPACE_IMAGE || 'prism-workspace:latest',
      Entrypoint:['/project-entrypoint.sh'],WorkingDir:'/workspace',
      Env:[...buildAgentEnvironment(agent),'PRISM_PERMISSION_FILESYSTEM=workspace-write','PRISM_PERMISSION_COMMANDS=workspace','PRISM_PERMISSION_BROWSER=false',`PRISM_REPOS=${JSON.stringify(config.repos)}`,`PRISM_BRANCH=prism/requirement-${id}`,
        `GIT_ACCESS_TOKEN=${git.mode==='token'?git.secret:''}`,`GIT_SSH_KEY=${git.mode==='ssh'?git.secret:''}`,`GIT_SSH_PORT=${config.gitAuth.sshPort}`,
        `INIT_SCRIPT=${config.initScript}`,`STARTUP_SCRIPT=${config.startupScript}`,`CLAUDE_MD=${config.guidance}`],
      Labels:{'prism.requirement':id,'prism.project':r.project_id},ExposedPorts:{'8090/tcp':{},'8080/tcp':{}},
      HostConfig:{Binds:[`${volume}:/workspace`],PortBindings:{'8090/tcp':[{HostIp:'127.0.0.1',HostPort:''}],'8080/tcp':[{HostIp:'127.0.0.1',HostPort:''}]},
        Memory:4*1024*1024*1024,NanoCpus:2e9,PidsLimit:512,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],LogConfig:{Type:'json-file',Config:{'max-size':'10m','max-file':'3'}}}});
    getDb().prepare('UPDATE requirement_environments SET container_id=? WHERE requirement_id=?').run(container.id,id);
    await container.start();
  }catch(e){state(id,'failed',redactRuntimeText(id,(e as Error).message));throw e;}
}
export function stopRuntime(id:string):Promise<void> {
  try{assertRuntimeChangeAllowed(id);if(runtimeOperationActive(id))throw new Error('环境操作进行中，请稍后重试');}catch(e){return Promise.reject(e);}
  const work=performStopRuntime(id).finally(()=>operations.delete(id));operations.set(id,work);return work;
}
async function performStopRuntime(id:string){
  try{await runtimeContainer(id).stop({t:10});}catch(e){if(![304,404].includes((e as {statusCode:number}).statusCode))throw e;}
  releaseInterruptedRun(id);
  state(id,'stopped');
}
export async function runtimeServicePorts(id:string):Promise<number[]> {
  const result=await execRuntime(id,['node','-e',`const fs=require('fs');const ports=new Set();for(const file of ['/proc/net/tcp','/proc/net/tcp6'])for(const line of fs.readFileSync(file,'utf8').trim().split('\\n').slice(1)){const c=line.trim().split(/\\s+/);const p=parseInt(c[1].split(':')[1],16);if(c[3]==='0A'&&p>1024&&![8080,8090,9527].includes(p))ports.add(p)}console.log(JSON.stringify([...ports].sort((a,b)=>a-b)))`]);
  return JSON.parse(result.text);
}
export async function runtimeStatus(id:string) {
  const r=requirement(id);
  if(operations.has(id))return {status:'preparing',ports:[] as number[],error:'',branch:`prism/requirement-${id}`};
  let status=r.environment_status;let ports:number[]=[];let engineError='';
  try {
    const info=await runtimeContainer(id).inspect();
    if(!info.State.Running)status=info.State.ExitCode && status!=='stopped'?'failed':'stopped';
    else {
      const result=await execRuntime(id,['node','-e',`const fs=require('fs');let s='preparing';try{s=fs.readFileSync('/var/log/prism/state','utf8')}catch{};if(s==='starting'){const text=fs.readFileSync('/proc/net/tcp','utf8')+fs.readFileSync('/proc/net/tcp6','utf8');if(text.split('\\n').some(l=>{const c=l.trim().split(/\\s+/);const p=parseInt(c[1]?.split(':')[1],16);return c[3]==='0A'&&p>1024&&![8080,8090,9527].includes(p)}))s='running'}process.stdout.write(s)`]);
      if(['preparing','starting','running','failed'].includes(result.text))status=result.text;
      if(status==='running')ports=await runtimeServicePorts(id);
    }
  }catch(e){if((e as {statusCode?:number}).statusCode===404){if(!operations.has(id) && ['preparing','starting','running'].includes(status))status='failed';}else engineError='容器引擎暂时不可用，请稍后重试';}
  if(status!==r.environment_status)state(id,status);
  const row=getDb().prepare('SELECT error FROM requirement_environments WHERE requirement_id=?').get(id) as {error:string}|undefined;
  return {status,ports,error:engineError || row?.error || '',branch:`prism/requirement-${id}`};
}
export async function runtimeLogs(id:string) {
  let value='';const runtimeSecrets:string[]=[];
  try {
    const raw=await runtimeContainer(id).logs({stdout:true,stderr:true,tail:300});
    // Docker multiplexed frames, not a TTY stream.
    const b=Buffer.isBuffer(raw)?raw:Buffer.from(raw as unknown as string);let offset=0;
    while(offset+8<=b.length){const length=b.readUInt32BE(offset+4);if(offset+8+length>b.length)break;value+=b.subarray(offset+8,offset+8+length).toString();offset+=8+length;}
    const info=await runtimeContainer(id).inspect();
    for(const entry of info.Config.Env || [])if(/^(GIT_ACCESS_TOKEN|GIT_SSH_KEY|ANTHROPIC_API_KEY)=/.test(entry))runtimeSecrets.push(entry.slice(entry.indexOf('=')+1));
    if(info.State.Running){const app=await execRuntime(id,['sh','-c','tail -n 200 /var/log/prism/startup.log /var/log/prism/agent.log /var/log/prism/code-server.log 2>/dev/null']);value+='\n'+app.text;}
  }catch(e){if((e as {statusCode?:number}).statusCode!==404)throw e;}
  return redactRuntimeText(id,value,runtimeSecrets).slice(-100000);
}
export async function runtimePort(id:string,kind:'preview'|'ide') {
  const info=await runtimeContainer(id).inspect();
  if(!info.State.Running)throw new Error('环境未运行');
  const port=info.NetworkSettings.Ports[kind==='ide'?'8080/tcp':'8090/tcp']?.[0]?.HostPort;
  if(!port)throw new Error('服务端口尚未就绪');return Number(port);
}
