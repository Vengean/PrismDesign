import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture(){
 let click:()=>boolean=()=>false,message:(event:any)=>void=()=>{},shown=0,hidden=0,restore:boolean|undefined;
 let nonce='',next=0;const timers=new Map<number,Function>();const exports:any={};
 const shadow={appendChild(){},querySelectorAll:()=>[],querySelector:()=>null};
 const window:any={addEventListener:(type:string,fn:any)=>{if(type==='message')message=fn;},postMessage:(value:any)=>{nonce=value.nonce;}};
 const source=fs.readFileSync(new URL('../../packages/widget/src/platform-ui.tsx',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,window,location:{origin:'https://preview.fixture'},document:{getElementById:()=>null,createElement:()=>({id:'',attachShadow:()=>shadow,hasAttribute:()=>false}),documentElement:{appendChild(){}}},
  setTimeout:(fn:Function)=>{timers.set(++next,fn);return next;},clearTimeout:(id:number)=>timers.delete(id),setInterval:()=>assert.fail('installation detection must not poll'),
  MutationObserver:class{observe(){}},
  require:(name:string)=>{
   if(name==='react-dom/client')return {createRoot:()=>({render(){}})};
   if(name.includes('jsx-runtime'))return {jsx:()=>({})};
   if(name.includes('studio.css'))return {default:''};
   if(name.includes('platform-shell'))return {PLATFORM_SHELL_CSS:''};
   if(name.includes('panel.js'))return {createPanel:(_shadow:any,_position:any,onClick:()=>boolean,restoreVisibility:boolean)=>{click=onClick;restore=restoreVisibility;return {show(){shown++;},hide(){hidden++;},getBody:()=>({}),onVisibilityChange(){}};}};
   if(name.includes('platform-annotations'))return {createPageAnnotations:()=>({})};
   if(name.includes('platform-client'))return {requestId:()=>String(++next)};
   return {};
  },
 });
 exports.mountPlatformWidget();
 return {click,stats:()=>({shown,hidden,restore,timers:timers.size}),flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());},pong(version?:string){message({source:window,origin:'https://preview.fixture',data:{type:'PRISM_EXTENSION_PONG',nonce,version}});},opened(success:boolean){message({source:window,origin:'https://preview.fixture',data:{type:'PRISM_EXTENSION_OPEN_RESULT',success}});}};
}

test('Widget remains closed on mount and routes every installed extension version without flashing open',()=>{
 for(const version of ['0.1.0','0.7.2',undefined]){
  const f=fixture();assert.deepEqual(f.stats(),{shown:0,hidden:0,restore:false,timers:0});
  assert.equal(f.click(),true);f.pong(version);f.flush();assert.equal(f.stats().shown,0,'installation alone cancels the Widget fallback');
  f.opened(true);assert.equal(f.stats().shown,0);assert.equal(f.stats().hidden,1);
 }
});
test('Widget opens only when no extension responds or Chrome explicitly rejects opening',()=>{
 const absent=fixture();absent.click();assert.equal(absent.stats().shown,0);absent.flush();assert.equal(absent.stats().shown,1);
 const failed=fixture();failed.click();failed.pong('0.1.0');failed.opened(false);failed.flush();assert.equal(failed.stats().shown,1);
});
