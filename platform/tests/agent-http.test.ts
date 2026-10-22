import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import {agentChatRequest} from '../src/services/agent-transport.js';

test('Agent HTTP waits for a delayed final result without fetch and remains cancellable',async()=>{
 const server=http.createServer((req,res)=>{req.resume();if(req.url==='/bad'){res.end('invalid');return;}setTimeout(()=>res.end(JSON.stringify({success:true,message:'finished'})),150);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 let path='/chat';const options:any[]=[];
 const request=vm.runInNewContext(agentChatRequest+';requestAgentChat',{Buffer,require:()=>({request:(_url:string,opts:any,callback:any)=>{options.push(opts);return http.request(`http://127.0.0.1:${(server.address() as {port:number}).port}${path}`,opts,callback);}}),fetch:()=>{throw Error('long turns must not use fetch');}});
 try{
  const result=await request({},'{}',new AbortController().signal);assert.equal(result.result.message,'finished');assert.equal(result.httpOk,true);assert.equal(options[0].timeout,0);assert.equal(options[0].agent,false);
  const controller=new AbortController();const pending=request({},'{}',controller.signal);controller.abort(Error('explicit cancellation'));await assert.rejects(pending,/explicit cancellation/);
  path='/bad';await assert.rejects(request({},'{}',new AbortController().signal),/最终响应格式无效/);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
