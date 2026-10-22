import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gitOperationScript} from '../src/services/requirement-git.js';
test('requirement Pull/Push rejects dirty trees and never overwrites diverged history',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'prism-git-')),workspace=path.join(root,'workspace'),remote=path.join(root,'remote.git'),app=path.join(workspace,'app'),peer=path.join(root,'peer');mkdirSync(workspace);
 const git=(cwd:string,...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const branch='prism/requirement-fixture';
 function operate(action:'pull'|'push'|'status'|'commit',message?:string){
  try{return JSON.parse(execFileSync(process.execPath,['-e',gitOperationScript,JSON.stringify({root:workspace,repo:'app',branch,action,message})],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(e){return JSON.parse((e as {stdout:Buffer}).stdout.toString());}
 }
 function commit(cwd:string,name:string){writeFileSync(path.join(cwd,name),name);git(cwd,'add','--',name);git(cwd,'commit','-m',name);}
 try{
  git(root,'init','--bare',remote);git(workspace,'clone',remote,'app');git(app,'switch','-c','main');commit(app,'initial.txt');git(app,'push','origin','main');const main=git(app,'rev-parse','HEAD');git(app,'switch','-c',branch);git(app,'config','user.name','Fixture');git(app,'config','user.email','fixture@example.test');assert.equal(operate('status').dirty,false);
  assert.match(operate('pull').message,/先 Push/);assert.equal(operate('push').success,true);assert.equal(git(root,'--git-dir',remote,'rev-parse',`refs/heads/${branch}`),main);
  writeFileSync(path.join(app,'dirty.txt'),'pending');assert.match(operate('push').message,/未提交/);assert.match(operate('pull').message,/未提交/);assert.equal(operate('status').dirty,true);
  assert.match(operate('commit',' ').message,/提交说明/);assert.equal(git(app,'diff','--cached','--name-only'),'');
  writeFileSync(path.join(app,'initial.txt'),'updated');const description='提交代码 $(not-a-command)';const committed=operate('commit',description);assert.equal(committed.success,true);assert.equal(git(app,'log','-1','--format=%B'),description);assert.equal(operate('status').dirty,false);assert.equal(git(app,'show','HEAD:dirty.txt'),'pending');assert.equal(git(app,'show','HEAD:initial.txt'),'updated');
  assert.equal(git(root,'--git-dir',remote,'rev-parse',`refs/heads/${branch}`),main,'commit must not push');assert.match(operate('commit','empty').message,/没有需要提交/);assert.equal(operate('push').success,true);
  git(root,'clone','--branch',branch,remote,'peer');commit(peer,'remote.txt');git(peer,'push','origin',branch);assert.equal(operate('pull').success,true);assert.equal(readFileSync(path.join(app,'remote.txt'),'utf8'),'remote.txt');
  commit(app,'local.txt');commit(peer,'other.txt');git(peer,'push','origin',branch);const remoteHead=git(peer,'rev-parse','HEAD');
  assert.match(operate('pull').message,/分叉/);assert.match(operate('push').message,/分叉/);assert.equal(git(root,'--git-dir',remote,'rev-parse',`refs/heads/${branch}`),remoteHead);
  git(app,'switch','main');assert.match(operate('push').message,/不在需求分支/);assert.equal(git(root,'--git-dir',remote,'rev-parse','refs/heads/main'),main);
 }finally{rmSync(root,{recursive:true,force:true});}
});
