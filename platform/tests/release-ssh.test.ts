import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {releaseGitProgram} from '../src/services/release-git.js';

test('Git helper accepts pasted SSH keys without final newline or with CRLF and explains invalid keys',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prism-ssh-regression-'));
 const run=(command:string,args:string[])=>execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 try{
  const repository=path.join(directory,'repo.git'),bin=path.join(directory,'bin'),key=path.join(directory,'identity');fs.mkdirSync(repository);fs.mkdirSync(bin);
  run('git',['init','--bare',repository]);run('ssh-keygen',['-q','-t','ed25519','-N','','-f',key]);const privateKey=fs.readFileSync(key,'utf8');
  // Use a local Git upload-pack transport. It invokes the real ssh-keygen to
  // parse the exact key file written by the production helper, without a server.
  fs.writeFileSync(path.join(bin,'ssh'),`#!/bin/sh
while [ "$#" -gt 0 ]; do
 if [ "$1" = "-i" ]; then shift; identity="$1"; fi
 shift
done
ssh-keygen -y -P '' -f "$identity" >/dev/null || exit 255
exec git-upload-pack "$PRISM_TEST_SSH_REPO"
`,{mode:0o700});
  const helper=(secret:string)=>{let output:string;try{output=execFileSync(process.execPath,['-e',releaseGitProgram,JSON.stringify({action:'branches',url:'git@fixture.test:repo.git',branch:'main'})],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,GIT_ACCESS_TOKEN:'',GIT_SSH_KEY:secret,PRISM_TEST_SSH_REPO:repository},stdio:['ignore','pipe','pipe'],timeout:10000});}catch(error){output=String((error as any).stdout);}return JSON.parse(output.trim());};
  for(const pasted of [privateKey.trimEnd(),privateKey.replace(/\n/g,'\r\n'),`\n${privateKey}\n`])assert.deepEqual(helper(pasted),{success:true,sha:'',branches:[]});
  const invalid=helper('invalid private key');assert.equal(invalid.success,false);assert.match(invalid.error,/私钥格式/);
  const protectedKey=path.join(directory,'protected');run('ssh-keygen',['-q','-t','ed25519','-N','fixture-passphrase','-f',protectedKey]);const encrypted=helper(fs.readFileSync(protectedKey,'utf8'));assert.equal(encrypted.success,false);assert.match(encrypted.error,/口令/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
