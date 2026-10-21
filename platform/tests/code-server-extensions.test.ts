import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const {fixExtensions}=createRequire(import.meta.url)('../docker/fix-code-server-extensions.cjs');
test('missing built-in browser bundles use available Node hosts, valid bundles remain intact',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'prism-extension-test-'));
 try {
  for(const [name,main] of [['git-base','./dist/extension.js'],['merge-conflict','./dist/mergeConflictMain']]){
   const dir=path.join(root,name);mkdirSync(path.join(dir,'dist'),{recursive:true});
   writeFileSync(path.join(dir,'package.json'),JSON.stringify({name,main,browser:'./dist/browser/extension.js',contributes:{commands:[{command:'fixture'}]}}));
   writeFileSync(path.join(dir,main.endsWith('.js')?main:`${main}.js`),'module.exports.activate=()=>{};');
  }
  const merge=path.join(root,'merge-conflict');mkdirSync(path.join(merge,'dist/browser'));writeFileSync(path.join(merge,'dist/browser/extension.js'),'export function activate(){}');
  assert.deepEqual(fixExtensions(root),['git-base']);
  const git=JSON.parse(readFileSync(path.join(root,'git-base/package.json'),'utf8'));assert.equal(git.browser,undefined);assert.equal(git.main,'./dist/extension.js');assert.equal(git.contributes.commands[0].command,'fixture');
  assert.equal(JSON.parse(readFileSync(path.join(merge,'package.json'),'utf8')).browser,'./dist/browser/extension.js');
  assert.deepEqual(fixExtensions(root),[]);
  writeFileSync(path.join(root,'git-base/package.json'),JSON.stringify({main:'missing.js',browser:'missing-browser.js'}));assert.throws(()=>fixExtensions(root),/neither browser nor server entry/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
