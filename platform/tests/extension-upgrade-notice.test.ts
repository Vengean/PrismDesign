import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import {extensionCompatibility} from '../../packages/ui/src/studio/extension-compatibility.js';
function notice(storage=new Map<string,string>()){
 const exports:any={},states:any[]=[];let cursor=0;
 const react={useState:(initial:any)=>{const index=cursor++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],(value:any)=>states[index]=value];}};
 const jsx=(type:any,props:any)=>({type,props});
 const source=fs.readFileSync(new URL('../../packages/ui/src/studio/ExtensionUpgradeNotice.tsx',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:(name:string)=>name==='react'?react:name.includes('jsx-runtime')?{jsx,jsxs:jsx}:{extensionCompatibility},localStorage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)}});
 return {storage,render(release:any,version='0.7.2'){cursor=0;return exports.ExtensionUpgradeNotice({version,release});}};
}
function closeButton(tree:any):any{if(!tree)return;return tree.type==='button'?tree:(Array.isArray(tree.props?.children)?tree.props.children:[tree.props?.children]).map(closeButton).find(Boolean);}
test('compatible upgrade floats, can be dismissed across remounts, and reappears for a new release',()=>{
 const release={latestVersion:'0.7.3',minVersion:'0.7.0',downloadUrl:'/download'},n=notice();
 const first=n.render(release);assert.match(first.props.className,/absolute.*top-full/);assert.equal(first.props.role,'status');assert.ok(closeButton(first));
 closeButton(first).props.onClick();assert.equal(n.render(release),null);assert.equal(notice(n.storage).render(release),null);
 assert.ok(n.render({...release,latestVersion:'0.7.4'}));
 assert.equal(n.render({...release,latestVersion:'0.7.2'}),null);
});
test('required upgrades cannot be dismissed even when that release was previously hidden',()=>{
 const release={latestVersion:'0.7.3',minVersion:'0.7.0',downloadUrl:'/download'},n=notice();closeButton(n.render(release)).props.onClick();
 const mandatory=n.render({...release,minVersion:'0.7.3'});assert.equal(mandatory.props.role,'alert');assert.equal(closeButton(mandatory),undefined);
});
