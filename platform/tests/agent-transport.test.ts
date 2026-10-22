import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {agentBridge} from '../src/services/agent-transport.js';
async function runBridge(readLog:()=>string,action?:string,drop=false){
 const events:{type:string;data:Record<string,unknown>}[]=[],requests:{url:string;options:any}[]=[];
 const process={argv:['node',JSON.stringify({runId:'run-1',clientId:'client-1',message:'hello',action})],exitCode:0};
 let socket:FakeSocket|undefined;
 class FakeSocket {
  listeners=new Map<string,Function>();closed=false;
  constructor(_url:string,protocols:string[]){assert.deepEqual(Array.from(protocols),['fixture-agent-private-token']);socket=this;}
  addEventListener(type:string,handler:Function){this.listeners.set(type,handler);if(type==='open')queueMicrotask(()=>handler());}
  close(){this.closed=true;}
 }
 await vm.runInNewContext(agentBridge,{
  require:(name:string)=>{
   if(name==='node:fs')return {readFileSync:readLog};
   assert.equal(name,'node:http');return {request:(url:string,options:any,callback:Function)=>{
    requests.push({url,options});assert.equal(options.timeout,0);assert.equal(options.agent,false);assert.equal(options.headers.Authorization,'Bearer fixture-agent-private-token');
    const req=new EventEmitter() as EventEmitter&{end:Function};req.end=()=>queueMicrotask(()=>{
     if(drop){socket?.listeners.get('close')?.();req.emit('error',Error('aborted'));return;}
     for(const event of [{type:'run.started',data:{runId:'run-1'}},{type:'message.delta',data:{runId:'run-1',delta:'你好'}},{type:'message.delta',data:{runId:'other',delta:'ignore'}}])socket?.listeners.get('message')?.({data:JSON.stringify(event)});
     const res=Object.assign(new PassThrough(),{statusCode:200});callback(res);res.end(JSON.stringify({success:true,message:'done'}));
    });return req;
   }};
  },
  process,console:{log:(line:string)=>events.push(JSON.parse(line))},WebSocket:FakeSocket,AbortSignal,AbortController,Buffer,
  setTimeout:(fn:()=>void,ms:number)=>setTimeout(fn,ms===250?0:ms),clearTimeout,
  fetch:async(url:string,options:any)=>{
   requests.push({url,options});assert.equal(options.headers.Authorization,'Bearer fixture-agent-private-token');
   if(url.endsWith('/api/status'))return {ok:true,json:async()=>({agent:{capabilities:{cancel:true}}})};

   return {ok:true};
  },
 });
 return {events,requests,process,socket};
}
test('real bridge script reads the full token and forwards only the requested run’s events',async()=>{
 const result=await runBridge(()=> '[Server] listening\n__PRISM_AGENT_TOKEN__=fixture-agent-private-token\nNext startup line\n');
 assert.equal(result.process.exitCode,0);assert.equal(result.socket?.closed,true);
 assert.deepEqual(result.events.map(event=>event.type),['bridge.ready','bridge.dispatch','run.started','message.delta','bridge.result']);
 assert.equal(result.events.find(event=>event.type==='message.delta')?.data.delta,'你好');assert.equal(result.requests.length,3);assert.ok(!JSON.stringify(result.events).includes('fixture-agent-private-token'));
});
test('bridge waits for log creation and cancellation uses authenticated run endpoint',async()=>{
 let reads=0;const result=await runBridge(()=>{if(++reads===1)throw Object.assign(Error('missing'),{code:'ENOENT'});return '__PRISM_AGENT_TOKEN__=fixture-agent-private-token\r\n';},'cancel');
 assert.equal(reads,2);assert.equal(result.process.exitCode,0);assert.equal(result.socket,undefined);assert.equal(result.requests[1].url,'http://127.0.0.1:9527/api/runs/run-1');
});
test('missing dependency becomes a structured startup error without stack or credentials',async()=>{
 const result=await runBridge(()=>`Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@openai/agents' imported from /prism-agent/dist/cli.js\nsecret-config-value`);
 assert.equal(result.process.exitCode,1);assert.equal(result.requests.length,0);assert.match(String(result.events[0].data.message),/缺少运行依赖 @openai\/agents/);assert.ok(!JSON.stringify(result.events).includes('secret-config-value'));
});

test('lost Agent event connection aborts the pending chat request and returns a readable error',async()=>{
 const result=await runBridge(()=>'__PRISM_AGENT_TOKEN__=fixture-agent-private-token\n',undefined,true);
 assert.equal(result.process.exitCode,1);assert.equal(result.socket?.closed,true);assert.ok(result.events.some(event=>event.type==='bridge.error'&&String(event.data.message).includes('事件连接中断')));assert.ok(!result.events.some(event=>event.type==='bridge.result'));
});
