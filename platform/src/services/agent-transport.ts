import {StringDecoder} from 'node:string_decoder';
import {PassThrough} from 'node:stream';
import {runtimeContainer,containerEngine,execRuntime} from './requirement-runtime.js';
export type RuntimeEvent={type:string;data:Record<string,unknown>};
// Run inside the container. The Agent stays unexposed on the host; its private
// token is read locally and never sent back to the browser/platform logs.
// Native HTTP has no fetch/Undici response-header deadline. Agent turns return
// their HTTP response only after all reasoning and tools finish.
export const agentChatRequest=String.raw`
function requestAgentChat(headers,body,signal){
 return new Promise((resolve,reject)=>{
  const req=require('node:http').request('http://127.0.0.1:9527/api/chat',{method:'POST',headers,signal,agent:false,timeout:0},res=>{
   let text='',size=0;res.setEncoding('utf8');
   res.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>8*1024*1024){res.destroy(Error('Agent 最终响应过大'));return;}text+=chunk;});
   res.on('error',reject);
   res.on('end',()=>{try{resolve({result:JSON.parse(text),httpOk:res.statusCode>=200&&res.statusCode<300});}catch{reject(Error('Agent 最终响应格式无效'));}});
  });
  req.on('error',error=>reject(signal.aborted?signal.reason:error));
  req.end(body);
 });
}
`;
export const agentBridge=String.raw`
const fs=require('node:fs');
${agentChatRequest}
const input=JSON.parse(process.argv[1]);
const output=(type,data)=>console.log(JSON.stringify({type,data}));
(async()=>{
 const deadline=Date.now()+10000;let token;
 while(!token){
  let log='';try{log=fs.readFileSync('/var/log/prism/agent.log','utf8');}catch(e){if(e.code!=='ENOENT')throw Error('无法读取 Agent 启动状态，请检查环境日志');}
  token=[...log.matchAll(/^__PRISM_AGENT_TOKEN__=([^\r\n]+)$/gm)].at(-1)?.[1]?.trim();
  if(!token){
   const dependency=log.match(/Cannot find package ['"]([@a-zA-Z0-9_./-]+)['"]/);
   if(dependency)throw Error('Agent 启动失败：缺少运行依赖 '+dependency[1]+'，请重新构建工作镜像并重启需求环境');
   if(/ERR_MODULE_NOT_FOUND|启动失败:/.test(log))throw Error('Agent 启动失败，请查看环境日志，修复后重启需求环境');
   if(Date.now()>=deadline)throw Error('Agent 启动超时，请查看环境日志后重试');
   await new Promise(resolve=>setTimeout(resolve,250));
  }
 }
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+token,'x-client-id':input.clientId};
 const status=await fetch('http://127.0.0.1:9527/api/status',{headers,signal:AbortSignal.timeout(5000)});
 if(!status.ok)throw Error('Agent 鉴权失败，请重启环境');
 const health=await status.json();if(health.agent?.capabilities?.cancel!==true)throw Error('当前 Agent 版本不支持安全取消，请重启环境更新后重试');output('bridge.ready',{cancelSupported:health.agent?.capabilities?.cancel===true});
 if(input.action==='cancel'){
  const res=await fetch('http://127.0.0.1:9527/api/runs/'+encodeURIComponent(input.runId),{method:'DELETE',headers,signal:AbortSignal.timeout(10000)});
  if(!res.ok && res.status!==404)throw Error('Agent 取消请求失败');output('bridge.result',{success:true});return;
 }
 const requestController=new AbortController();let finished=false;
 const ws=new WebSocket('ws://127.0.0.1:9527/ws?clientId='+encodeURIComponent(input.clientId),[token]);
 try {
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Agent 事件连接超时')),10000);ws.addEventListener('open',()=>{clearTimeout(timeout);resolve()},{once:true});ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('Agent 事件连接失败'))},{once:true});});
 ws.addEventListener('message',event=>{try{const v=JSON.parse(String(event.data));if(v.data?.runId===input.runId && /^(run\.|message\.|tool\.|file\.)/.test(v.type))output(v.type,v.data);}catch{}});
 ws.addEventListener('close',()=>{if(!finished)requestController.abort(Error('Agent 事件连接中断，当前任务状态无法确认'));});
 ws.addEventListener('error',()=>{if(!finished)requestController.abort(Error('Agent 事件连接异常，当前任务状态无法确认'));});
  output('bridge.dispatch',{});
  const {result,httpOk}=await requestAgentChat(headers,JSON.stringify({message:input.message,runId:input.runId,capabilities:{browserInteraction:false,automatedTesting:false}}),requestController.signal);
  output('bridge.result',{...result,httpOk});
 }finally{
  finished=true;
  await fetch('http://127.0.0.1:9527/api/session',{method:'DELETE',headers,signal:AbortSignal.timeout(5000)}).catch(()=>{});
  ws.close();
 }
})().catch(e=>{output('bridge.error',{message:[e.message,e.cause?.code,e.cause?.message].filter(Boolean).join(' · ')});process.exitCode=1;});
`;
export interface AgentTransport {
 run(requirementId:string,input:{runId:string;clientId:string;message:string},onEvent:(event:RuntimeEvent)=>void):Promise<void>;
 cancel(requirementId:string,runId:string,clientId:string):Promise<void>;
}
export const dockerAgentTransport:AgentTransport={
 async run(id,input,onEvent){
  // Model reasoning and tools can be silent for minutes. Do not apply the
  // short container-management socket inactivity timeout to this event stream.
  const exec=await runtimeContainer(id,0).exec({Cmd:['node','-e',agentBridge,JSON.stringify(input)],AttachStdout:true,AttachStderr:true});
  const stream=await exec.start({Detach:false,Tty:false});
  const stdout=new PassThrough(),stderr=new PassThrough();const decoder=new StringDecoder('utf8');let pending='',error='';
  stdout.on('data',(b:Buffer)=>{
   pending+=decoder.write(b);if(pending.length>2*1024*1024){stream.destroy(new Error('Agent 事件过大'));return;}
   let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);if(!line)continue;try{onEvent(JSON.parse(line));}catch(e){stream.destroy(e as Error);}}
  });stderr.on('data',(b:Buffer)=>{if(error.length<4000)error+=b.toString();});
  containerEngine().modem.demuxStream(stream,stdout,stderr);
  await new Promise<void>((resolve,reject)=>{stream.once('end',resolve);stream.once('error',reject);});
  const result=await exec.inspect();if(result.ExitCode!==0)throw new Error(error || 'Agent 连接执行失败');
 },
 async cancel(id,runId,clientId){
  const result=await execRuntime(id,['node','-e',agentBridge,JSON.stringify({action:'cancel',runId,clientId})]);
  if(result.code!==0)throw new Error('无法确认取消请求，请查看环境日志后重试');
 }
};
