import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('long CDP sessions retain bounded evidence and pending requests, and detach releases all tab state',async()=>{
 let event:Function=()=>{},detach:Function=()=>{};
 const exports:any={};
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/background/browser-controller.ts',import.meta.url),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(output+'\nexports.retention=()=>({sessions:sessions.size,refs:refs.size,evidence:evidence.size,log:evidence.get(1)});',{
  exports,URL,TextEncoder,TextDecoder,setTimeout,clearTimeout,
  chrome:{debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_target:unknown,method:string)=>method==='Runtime.evaluate'?{result:{value:[]}}:{},onDetach:{addListener:(fn:Function)=>detach=fn},onEvent:{addListener:(fn:Function)=>event=fn}},tabs:{get:async()=>({url:'https://fixture.test/',title:'Fixture'}),onUpdated:{addListener(){},removeListener(){}}}},
 });
 await exports.executeCurrentTabCommand(1,{action:'attach',requestId:'attach'});
 for(let index=0;index<10000;index++){
  event({tabId:1},'Runtime.consoleAPICalled',{args:[{value:String(index)+'x'.repeat(5000)}]});
  event({tabId:1},'Runtime.exceptionThrown',{exceptionDetails:{text:String(index)+'x'.repeat(5000)}});
  event({tabId:1},'Network.requestWillBeSent',{requestId:'r'+index,request:{method:'GET',url:'https://fixture.test/api/'+index}});
  event({tabId:1},'Network.responseReceived',{requestId:'r'+index,response:{url:'https://fixture.test/api/'+index,status:200,mimeType:'application/json'}});
  event({tabId:1},'Network.requestWillBeSent',{requestId:'pending'+index,request:{method:'GET',url:'https://fixture.test/pending/'+index}});
 }
 const log=exports.retention().log;
 assert.ok(log.console.length<=200);assert.ok(log.pageErrors.length<=200);assert.ok(log.network.length<=200);assert.ok(log.requests.size<=256);
 assert.ok(log.console.every((entry:any)=>entry.text.length<=4096));assert.ok(log.pageErrors.every((entry:string)=>entry.length<=4096));
 assert.match(log.console.at(-1).text,/^9999/);assert.equal(log.network.at(-1).requestId,'r9999');
 event({tabId:1},'Network.responseReceived',{requestId:'internal',response:{url:'https://fixture.test/__prism_platform__/conversation',status:200}});
 assert.equal(log.network.at(-1).requestId,'r9999');
 await assert.rejects(()=>exports.executeCurrentTabCommand(1,{action:'responseBody',requestId:'lookup',responseRequestId:'r0'}),/no longer available/);
 detach({tabId:1});assert.deepEqual(JSON.parse(JSON.stringify(exports.retention())),{sessions:0,refs:0,evidence:0});
});

test('screenshot replay cache is byte-bounded and closing a browser binding releases it',async()=>{
 let message:Function=()=>{},removed:Function=()=>{},nextCommands:((value:unknown)=>void)|undefined;
 const delivered:string[]=[];const exports:any={};let bindingId=0;
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/background/platform-browser.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'\nexports.binding=()=>bindings.get(1);',{
  exports,URL,require:()=>({executeCurrentTabCommand:async()=>({data:'x'.repeat(1024*1024)})}),
  chrome:{tabs:{get:async()=>({url:'https://fixture.test/'}),onRemoved:{addListener:(fn:Function)=>removed=fn},sendMessage:async(_tab:number,input:any)=>{
   if(input.path.startsWith('/browser/register'))return {platform:true,data:{id:'b'+(++bindingId)}};
   if(input.path.startsWith('/browser/commands'))return new Promise(resolve=>{nextCommands=value=>resolve({platform:true,data:{commands:value}});});
   if(input.path.startsWith('/browser/result'))delivered.push(input.body.requestId);
   return {platform:true,data:{}};
  }},runtime:{onMessage:{addListener:(fn:Function)=>message=fn}}},
 });
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 await new Promise<void>(resolve=>message({type:'PRISM_BROWSER_PREPARE',tabId:1,sessionId:'s'},{},()=>resolve()));
 const binding=exports.binding();
 for(let i=0;i<20;i++){
  for(let n=0;!nextCommands&&n<50;n++)await tick();assert.ok(nextCommands);
  const send=nextCommands!;nextCommands=undefined;send([{requestId:'s'+i,command:{requestId:'s'+i,action:'screenshot'}}]);
  for(let n=0;delivered.length<=i&&n<50;n++)await tick();assert.equal(delivered.length,i+1);
  assert.ok(binding.completedBytes<=8*1024*1024);assert.ok(binding.completed.size<=3);
 }
 removed(1);await tick();assert.equal(exports.binding(),undefined);assert.equal(binding.completed.size,0);assert.equal(binding.completedBytes,0);
 nextCommands?.([]);await tick();
});
