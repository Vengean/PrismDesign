import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('side panel retains the same conversation through reloads and probe failures',async()=>{
 const states:any[]=[];let cursor=0,mounted=false;const effects:Function[]=[];let requests=0,heldResponse:Promise<any>|undefined;
 const listeners=new Map<string,Function>();const event=(name:string)=>({addListener:(fn:Function)=>listeners.set(name,fn),removeListener:()=>{}});
 const tab={id:7,windowId:1,status:'complete'};let response:any={platform:true,data:{sessionId:'s'}},failure=false;
 const Panel=()=>null;
 const react={useCallback:(fn:Function)=>fn,useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(fn:Function)=>{if(!mounted)effects.push(fn);}};
 const jsx=(type:any,props:any,key:any)=>({type,props,key});
 const exports:any={};
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/sidepanel/App.tsx',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require:(name:string)=>name==='react'?react:name.includes('jsx-runtime')?{jsx,jsxs:jsx}:name.includes('platform-client')?{isPlatformContext:(value:any)=>!!value?.sessionId}:name.includes('PlatformPanel')?{PlatformPanel:Panel}:{Button:()=>null},
  chrome:{runtime:{connect:()=>({onDisconnect:event('disconnect'),disconnect(){}})},tabs:{query:async()=>[tab],sendMessage:async()=>{requests++;if(heldResponse){const held=heldResponse;heldResponse=undefined;return held;}if(failure)throw Error('Disconnected');return response;},onActivated:event('activated'),onUpdated:event('updated')}},
  setInterval:()=>assert.fail('context must not use fixed polling'),setTimeout(){},
 });
 const render=()=>{cursor=0;return exports.App();};
 render();const cleanups=effects.map(fn=>fn());mounted=true;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1,'mount probes once');
 const poll=async()=>{listeners.get('updated')!(tab.id,{status:'complete'});await new Promise(resolve=>setImmediate(resolve));};
 const original=render();assert.equal(original.type,Panel);
 await poll();assert.equal(render().props.context,original.props.context);
 tab.status='loading';listeners.get('updated')!(7,{url:'https://preview.fixture'});
 assert.equal(render().type,Panel);await new Promise(resolve=>setImmediate(resolve));
 failure=true;await poll();assert.equal(render().props.context,original.props.context);
 failure=false;response=undefined;await poll();assert.equal(render().type,Panel);
 response={platform:true,error:'Network timeout'};tab.status='complete';await poll();assert.equal(render().props.context,original.props.context);
 response={platform:true,error:'Preview restarting',status:404};await poll();assert.equal(render().props.context,original.props.context);
 response={platform:true,data:{sessionId:'s'}};listeners.get('updated')!(7,{status:'complete'});assert.equal(render().type,Panel);await new Promise(resolve=>setImmediate(resolve));assert.equal(render().props.context,original.props.context);
 response={platform:true,data:{sessionId:'new'}};await poll();assert.notEqual(render().key,original.key);
 const currentContext=render().props.context;
 response={platform:false};await poll();assert.equal(render().type,Panel);assert.ok(render().props.contextError);
 response={platform:true,error:'Expired',status:401};await poll();assert.equal(render().props.context,currentContext);assert.equal(render().props.contextError,'/context HTTP 401: Expired');
 // A tab switch during a slow probe must follow up immediately, rather than
 // waiting thirty seconds or accepting the old tab's late response.
 let release!:(value:any)=>void;heldResponse=new Promise(resolve=>{release=resolve;});
 const before=requests,inFlight=poll();await new Promise(resolve=>setImmediate(resolve));
 tab.id=8;response={platform:true,data:{sessionId:'other-tab'}};
 listeners.get('activated')!({tabId:8,windowId:1});
 assert.notEqual(render().type,Panel);
 release({platform:true,data:{sessionId:'stale'}});await inFlight;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,before+2);assert.equal(render().props.tabId,8);assert.equal(render().props.context.sessionId,'other-tab');
 // A burst of navigation events queues one follow-up request, not one per event.
 heldResponse=new Promise(resolve=>{release=resolve;});const burstBefore=requests,slow=poll();await new Promise(resolve=>setImmediate(resolve));
 for(let i=0;i<5;i++)listeners.get('updated')!(8,{status:'complete'});
 release({platform:true,data:{sessionId:'stale'}});await slow;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,burstBefore+2);assert.equal(render().props.context.sessionId,'other-tab');
 cleanups.forEach(cleanup=>cleanup());const afterUnmount=requests;await poll();assert.equal(requests,afterUnmount);
});

test('stream reconnection checks context once without checking every snapshot or heartbeat',()=>{
 const ports:any[]=[];let checks=0;
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/sidepanel/platform-live.ts',import.meta.url),'utf8');
 const exports:any={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,chrome:{runtime:{},tabs:{connect:()=>{
   const listeners=new Map<string,Function>();const event=(name:string)=>({addListener:(fn:Function)=>listeners.set(name,fn),removeListener:()=>listeners.delete(name)});
   const port={listeners,onMessage:event('message'),onDisconnect:event('disconnect'),postMessage(){},disconnect(){}};ports.push(port);return port;
  }}},
 });
 const live=exports.tabConversationLive(7,()=>checks++),cursor={sessionId:'s',after:0,eventAfter:0,liveAfter:''};
 const close=live(cursor,()=>{});
 ports[0].listeners.get('message')({type:'snapshot',value:{}});
 ports[0].listeners.get('message')({type:'heartbeat'});
 ports[0].listeners.get('message')({type:'snapshot',value:{}});
 assert.equal(checks,0,'initial connection already has context');
 ports[0].listeners.get('disconnect')();close();
 const stop=live(cursor,()=>{});
 ports[1].listeners.get('message')({type:'heartbeat'});assert.equal(checks,0);
 ports[1].listeners.get('message')({type:'snapshot',value:{}});
 ports[1].listeners.get('message')({type:'snapshot',value:{}});assert.equal(checks,1);
 stop();
});

test('authorization failures and request recovery recheck context while exposing the original error',async()=>{
 let result:any={platform:true,status:401,error:'登录过期'},checks=0;
 const exports:any={},jsx=(type:any,props:any)=>({type,props});
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/sidepanel/components/PlatformPanel.tsx',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,chrome:{tabs:{sendMessage:async()=>result}},require:(name:string)=>{
   if(name==='react')return {useMemo:(fn:Function)=>fn()};
   if(name.includes('jsx-runtime'))return {jsx,jsxs:jsx};
   if(name.endsWith('/notifications'))return {useNotificationPresence(){},NotificationToggle:()=>null};
   if(name.endsWith('/platform-live'))return {tabConversationLive:()=>()=>{}};
   if(name.endsWith('/attachment-client'))return {tabAttachmentClient:()=>({})};
   return {PlatformPanel:()=>null};
  },
 });
 const panel=exports.PlatformPanel({tabId:7,context:{sessionId:'s'},onRefreshContext:()=>checks++});
 const request=panel.props.children.props.request;
 await assert.rejects(request('/conversation'),/HTTP 401: 登录过期/);assert.equal(checks,1);
 result={platform:true,data:{ok:true}};await request('/conversation');assert.equal(checks,2);
 await request('/conversation');assert.equal(checks,2,'ordinary requests do not check context');
 result={platform:true,status:403,error:'权限已变更'};await assert.rejects(request('/messages'),/HTTP 403: 权限已变更/);assert.equal(checks,3);
});
