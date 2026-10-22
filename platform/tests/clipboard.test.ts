import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function setup(options:{clipboard?:{writeText:(text:string)=>Promise<void>};copied?:boolean;throws?:boolean}={}){
 let selected=false,removed=false,restored=false,appended='';const dialog={appendChild(){appended='dialog';}};
 const previous={isConnected:true,closest:()=>dialog,focus(){restored=true;}};
 const textarea={value:'',readOnly:false,style:{cssText:''},focus(){assert.equal(appended,'dialog','focus trap permits only nodes inside the dialog');},select(){selected=true;},setSelectionRange(start:number,end:number){assert.equal(start,0);assert.equal(end,textarea.value.length);},remove(){removed=true;}};
 const document={activeElement:previous,body:{appendChild(){appended='body';}},createElement:()=>textarea,execCommand:(command:string)=>{assert.equal(command,'copy');assert.equal(selected,true);if(options.throws)throw Error('denied');return options.copied??false;}};
 const exports:any={};const source=fs.readFileSync(new URL('../web/src/lib/utils.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,navigator:{clipboard:options.clipboard},document,require:()=>({})});
 return {copy:exports.copyToClipboard,dialog,state:()=>({appended,removed,restored})};
}
test('Clipboard API success returns true without creating a fallback input',async()=>{
 let value='';const run=setup({clipboard:{async writeText(text){value=text;}}});assert.equal(await run.copy('account details'),true);assert.equal(value,'account details');assert.equal(run.state().appended,'');
});
test('HTTP fallback selects text inside the dialog focus trap and restores focus',async()=>{
 const run=setup({copied:true});assert.equal(await run.copy('account details',run.dialog),true);assert.deepEqual(run.state(),{appended:'dialog',removed:true,restored:true});
});
test('false or denied copy operations report failure instead of false success',async()=>{
 for(const options of [{copied:false},{throws:true}]){const run=setup(options);assert.equal(await run.copy('account details'),false);assert.equal(run.state().removed,true);assert.equal(run.state().restored,true);}
});
test('Clipboard permission rejection falls back to selection inside the current dialog',async()=>{
 const run=setup({clipboard:{async writeText(){throw Error('permission denied');}},copied:true});assert.equal(await run.copy('account details'),true);assert.equal(run.state().appended,'dialog');
});
