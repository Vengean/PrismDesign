import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('Chrome content bridge uses same-origin credentials, restricts operations and opens panel only on a real Widget click',async()=>{
 let listener:any;const windowEvents=new Map<string,Function>();const domEvents=new Map<string,Function>();const calls:any[]=[];const sent:any[]=[];const posts:any[]=[];let isPlatform=true;
 class Element {id='';dataset:Record<string,string>={};}
 const window:any={addEventListener:(type:string,fn:Function)=>windowEvents.set(type,fn),postMessage:(message:any)=>posts.push(message)};
 const context={AbortSignal,exports:{},require:()=>({isContextInvalidated:()=>false}),chrome:{runtime:{onMessage:{addListener:(fn:any)=>listener=fn},sendMessage:async(m:any)=>{sent.push(m);return {success:true};}}},window,location:{origin:'http://preview.fixture'},document:{querySelector:()=>isPlatform?{}:null,addEventListener:(type:string,fn:Function)=>domEvents.set(type,fn)},HTMLElement:Element,fetch:async(url:string,options:any)=>{calls.push({url,options});return new Response(JSON.stringify({protocol:1,sessionId:'s'}));}};
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/content/platform.ts',import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,context);
 const result:any=await new Promise(r=>listener({type:'PRISM_PLATFORM_REQUEST',path:'/context'},{},r));assert.equal(result.platform,true);assert.equal(calls[0].url,'/__prism_platform__/context');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.headers.Authorization,undefined);
 const denied:any=await new Promise(r=>listener({type:'PRISM_PLATFORM_REQUEST',path:'/api/status'},{},r));assert.match(denied.error,/不支持/);assert.equal(calls.length,1);
 const host=new Element();host.id='prism-studio-widget';const button=new Element();button.dataset.prismOpen='true';const click=domEvents.get('click')!;
 click({isTrusted:false,composedPath:()=>[button,host]});assert.equal(sent.length,0);click({isTrusted:true,composedPath:()=>[button,host]});await Promise.resolve();assert.equal(sent[0].type,'PRISM_PLATFORM_OPEN');assert.ok(posts.some(p=>p.type==='PRISM_EXTENSION_OPEN_RESULT'&&p.success));
 windowEvents.get('message')!({source:window,origin:'http://preview.fixture',data:{type:'PRISM_EXTENSION_PING',nonce:'test'}});assert.ok(posts.some(p=>p.type==='PRISM_EXTENSION_PONG'&&p.nonce==='test'));
 isPlatform=false;const ordinary:any=await new Promise(r=>listener({type:'PRISM_PLATFORM_REQUEST',path:'/context'},{},r));assert.equal(ordinary.platform,false);assert.equal(calls.length,1);
});

test('platform-only background opens panels without Agent connections and cleans up comment mode',async()=>{
 const listeners=new Map<string,Function>();const calls:any[]=[];
 const event=(name:string)=>({addListener:(handler:Function)=>listeners.set(name,handler)});
 const chrome={
  runtime:{onInstalled:event('installed'),onStartup:event('startup'),onConnect:event('connect'),onMessage:event('message')},
  storage:{local:{remove:async(keys:string[])=>calls.push({remove:keys})}},
  tabs:{onRemoved:event('removed'),onActivated:event('activated'),onUpdated:event('updated'),query:async()=>[{id:7,url:'https://preview.fixture',active:true}],get:async(id:number)=>({id,url:'https://preview.fixture'}),sendMessage:async(tabId:number,message:any)=>{calls.push({tabId,message});return {active:false};}},
  action:{onClicked:event('click')},sidePanel:{open:async(input:any)=>{calls.push({open:input});}},scripting:{executeScript:async()=>{throw Error('already injected');}},
 };
 const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/background/index.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},chrome,fetch:()=>{throw Error('must never connect directly to Agent');}});
 await listeners.get('installed')!();assert.ok(calls.some(call=>call.remove?.includes('agentToken')));
 listeners.get('click')!({id:7,url:'https://ordinary.fixture'});assert.equal(calls.find(call=>call.open)?.open.tabId,7);
 let disconnected:Function|undefined;const port={name:'prism-sidepanel',onDisconnect:{addListener:(handler:Function)=>disconnected=handler}};
 listeners.get('connect')!(port);await new Promise(resolve=>setTimeout(resolve,0));
 const count=calls.length;assert.equal(listeners.get('message')!({type:'AGENT_CONNECT',payload:{url:'http://localhost:9527',token:'obsolete'}},{},()=>{throw Error('obsolete connection responded');}),undefined);assert.equal(calls.length,count);
 disconnected!();await Promise.resolve();assert.ok(calls.some(call=>call.tabId===7&&call.message?.type==='STOP_COMMENT_MODE'));
});

test('comment toolbar has no visual-change or drag entry and retains comment mode',()=>{
 const elements=new Map<string,any>();let removed=0;
 function element(){const buttons=new Map<string,any>();return {id:'',textContent:'',innerHTML:'',classList:{toggle(){}},remove(){removed++;},querySelector(selector:string){if(!this.innerHTML.includes(`id="${selector.slice(1)}"`))return null;if(!buttons.has(selector))buttons.set(selector,{addEventListener(){},classList:{toggle(){}}});return buttons.get(selector);}};}
 const document={getElementById:(id:string)=>elements.get(id),createElement:()=>element(),head:{appendChild:(el:any)=>elements.set(el.id,el)},body:{appendChild:(el:any)=>elements.set(el.id,el)}};
 const exports:any={};const source=fs.readFileSync(new URL('../../packages/chrome-ext/src/content/toolbar.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,document,navigator:{platform:'Mac'},require:()=>({t:(key:string)=>key})});
 const modes:any[]=[];exports.createToolbar({onModeChange:(mode:any)=>modes.push(mode)});
 const toolbar=elements.get('prism-studio-toolbar');assert.ok(toolbar.innerHTML.includes('pd-tb-comment'));assert.ok(!toolbar.innerHTML.includes('pd-tb-drag'));assert.ok(!toolbar.innerHTML.includes('pd-tb-select'));
 exports.triggerMode('comment');exports.triggerMode('comment');assert.deepEqual(modes,['comment',null]);exports.destroyToolbar();assert.equal(removed,2);
});
