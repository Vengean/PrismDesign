import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {StudioPanel} from '../../packages/ui/src/studio/StudioPanel';
import {isRunWorking,runMessageBody,connectionMessage} from '../../packages/ui/src/studio/run-state';
import {STUDIO_LOGO} from '../../packages/ui/src/studio/brand';
const require=createRequire(new URL('../../packages/ui/package.json',import.meta.url));
const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
test('Widget header contains only centered branding and close action; extension header shows demand and status',()=>{
 const props={
  surface:'widget',actions:createElement('button',{'aria-label':'关闭面板'},'×'),
  context:{protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'项目名称',title:'需求名称',role:'editor',userId:'owner'},
  annotations:{start(){},stop(){},subscribe(){return()=>{};}},connection:{connected:false,error:'连接已断开',retry(){}},
  chat:{messages:[{role:'ai',content:'**Markdown answer**',timestamp:1},{role:'user',content:'调整按钮',timestamp:2,comments:[{element:{tagName:'BUTTON',domPath:'body > button'},comment:'改成蓝色'}]}],sending:false,sendMessage(){},cancelCurrent(){},clearHistory(){},deleteMessage(){},startVerification(){},fixVerification(){}},
 };const html=renderToStaticMarkup(createElement(StudioPanel,props));
 const header=html.match(/<header\b[\s\S]*?<\/header>/)![0];
 assert.match(header,/Prism Studio/);assert.match(header,/关闭面板/);assert.match(header,/items-center/);assert.ok(!header.includes('项目名称'));assert.ok(!header.includes('需求名称'));assert.ok(!header.includes('role="status"'));
 const extension=renderToStaticMarkup(createElement(StudioPanel,{...props,surface:'extension',actions:undefined}));const extensionHeader=extension.match(/<header\b[\s\S]*?<\/header>/)![0];
 assert.match(extensionHeader,/需求名称/);assert.match(extensionHeader,/role="status"/);assert.match(extensionHeader,/items-center/);assert.ok(!extensionHeader.includes('<img'));assert.ok(!extensionHeader.includes('Prism Studio'));assert.ok(!extensionHeader.includes('项目名称'));
assert.match(html,/<strong>Markdown answer<\/strong>/);assert.match(html,/条评论/);assert.match(html,/连接已断开/);assert.match(html,/重试/);assert.match(html,/disabled/);
 assert.ok(html.includes(STUDIO_LOGO));assert.ok(!html.includes('type="password"'));assert.ok(!html.includes('断开连接'));assert.ok(!html.includes('始终允许'));
 assert.equal(Buffer.compare(Buffer.from(STUDIO_LOGO.split(',')[1],'base64'),fs.readFileSync(new URL('../../packages/chrome-ext/public/icons/icon-48.png',import.meta.url))),0);
});
test('Widget picker excludes its UI, records the selected element and cleans up on Escape',()=>{
 const handlers=new Map<string,Function>();const selected:any[]=[];let inspected:any;
 class Element {
  id='';style:any={};classList={add(){},remove(){}};
  setAttribute(){}remove(){}getBoundingClientRect(){return {top:1,left:2,width:30,height:40};}
 }
 const host=new Element();
 const document={body:{appendChild(){}},head:{appendChild(){}},documentElement:new Element(),createElement:()=>new Element(),addEventListener:(type:string,fn:Function)=>handlers.set(type,fn),removeEventListener:(type:string)=>handlers.delete(type)};
 const exports:any={};const source=fs.readFileSync(new URL('../../packages/widget/src/platform-annotations.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,document,HTMLElement:Element,require:(name:string)=>name.includes('inspector')?{inspectElement:(el:any)=>{inspected=el;return {tagName:'BUTTON',domPath:'body > button'};}}:{installPageBridge(){}}});
 const picker=exports.createPageAnnotations(host,'nonce');picker.subscribe((event:any)=>selected.push(event));picker.start();
 handlers.get('click')!({target:host,composedPath:()=>[host]});assert.equal(selected.length,0);
 const target=new Element();let prevented=false;
 handlers.get('click')!({target,composedPath:()=>[target],preventDefault(){prevented=true;},stopImmediatePropagation(){}});
 assert.equal(inspected,target);assert.equal(prevented,true);assert.equal(selected[0].type,'selected');assert.equal(selected[0].element.domPath,'body > button');assert.equal(handlers.size,0);
 picker.start();handlers.get('keydown')!({key:'Escape'});assert.equal(selected[1].type,'cancelled');assert.equal(handlers.size,0);
});

test('interrupted tasks display recovery in the assistant message without a permanent alert',()=>{
 assert.equal(isRunWorking('interrupted'),false);assert.equal(isRunWorking('failed'),false);assert.equal(isRunWorking('running'),true);
 const content=runMessageBody('已完成部分修改',{status:'interrupted',error:'任务已中断，请重启需求环境。'});
 assert.equal(runMessageBody(content,{status:'interrupted',error:'任务已中断，请重启需求环境。'}),content);
 const html=renderToStaticMarkup(createElement(StudioPanel,{surface:'extension',context:{title:'需求名称',role:'editor'},annotations:{start(){},stop(){},subscribe(){return()=>{};}},connection:{connected:true,error:'',retry(){}},chat:{messages:[{role:'ai',content,timestamp:1,pending:false}],sending:false,blocked:true,canCancel:false,sendMessage(){},cancelCurrent(){},clearHistory(){},deleteMessage(){},startVerification(){},fixVerification(){}}}));
 assert.ok(!html.includes('role="alert"'));assert.match(html,/已完成部分修改/);assert.match(html,/任务已中断/);assert.match(html,/重启需求环境/);assert.ok(!html.includes('取消运行'));assert.ok(!html.includes('chat.thinking'));
 assert.match(connectionMessage(Error('Failed to fetch')),/检查网络/);assert.equal(connectionMessage(Error('请登录平台')),'请登录平台');
});
