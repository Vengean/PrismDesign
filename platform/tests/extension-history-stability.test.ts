import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('side panel retains the same conversation through reloads and probe failures',async()=>{
 const states:any[]=[];let cursor=0,mounted=false;const effects:Function[]=[];let poll:Function=()=>{};
 const listeners=new Map<string,Function>();const event=(name:string)=>({addListener:(fn:Function)=>listeners.set(name,fn),removeListener:()=>{}});
 const tab={id:7,windowId:1,status:'complete'};let response:any={platform:true,data:{sessionId:'s'}},failure=false;
 const Panel=()=>null;
 const react={useState:(initial:any)=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],(next:any)=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(fn:Function)=>{if(!mounted)effects.push(fn);}};
 const jsx=(type:any,props:any,key:any)=>({type,props,key});
 const exports:any={};
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/sidepanel/App.tsx',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,require:(name:string)=>name==='react'?react:name.includes('jsx-runtime')?{jsx,jsxs:jsx}:name.includes('platform-client')?{isPlatformContext:(value:any)=>!!value?.sessionId}:name.includes('PlatformPanel')?{PlatformPanel:Panel}:{Button:()=>null},
  chrome:{runtime:{connect:()=>({onDisconnect:event('disconnect'),disconnect(){}})},tabs:{query:async()=>[tab],sendMessage:async()=>{if(failure)throw Error('Disconnected');return response;},onActivated:event('activated'),onUpdated:event('updated')}},
  setInterval:(fn:Function)=>{poll=fn;return 1;},clearInterval(){},setTimeout(){},
 });
 const render=()=>{cursor=0;return exports.App();};
 render();effects.forEach(fn=>fn());mounted=true;await new Promise(resolve=>setImmediate(resolve));
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
});
