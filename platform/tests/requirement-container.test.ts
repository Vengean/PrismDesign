import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';

test('real container: clone, branch, scripts, authorized HTTP/WebSocket preview, IDE and persistent restart', {skip:process.env.PRISM_TEST_CONTAINERS!=='1',timeout:120000},async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'prism-container-test-'));
 process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture-password';
 process.env.PRISM_WORKSPACE_IMAGE='prism-runtime-fixture:latest';process.env.PRISM_PREVIEW_BIND='127.0.0.1';
 const {getDb,createUser}=await import('../src/services/db.js');
 const {initProjectTables,createProject,emptyConfig,projectConfig}=await import('../src/services/projects.js');
 const {initRuntimeTables,startRuntime,stopRuntime,runtimeStatus,runtimeLogs,execRuntime,containerEngine}=await import('../src/services/requirement-runtime.js');
 const {issueRuntimeLink}=await import('../src/services/preview-gateway.js');
 initProjectTables();initRuntimeTables();createUser('viewer','unused');
 const project=createProject('Container fixture','','owner',[{userId:'viewer',role:'viewer'}],{...emptyConfig,
  repos:[{name:'app',url:'https://fixture.invalid/repo',branch:'main'}],
  gitAuth:{mode:'token',sshPort:22,token:'fixture-secret'},
  model:{provider:'claude',baseUrl:'https://fixture.invalid',model:'fixture-model',apiKey:'fixture-model-secret'},
  initScript:'echo initialized >> /workspace/init-count',startupScript:'cd app\nnode server.cjs'});
 const id=crypto.randomUUID();getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');
 const pause=()=>new Promise(r=>setTimeout(r,1000));
 async function ready(){for(let i=0;i<60;i++){const status=await runtimeStatus(id);if(status.status==='running')return;if(status.status==='failed')throw new Error(await runtimeLogs(id));await pause();}throw new Error('Container did not become ready: '+await runtimeLogs(id));}
 try {
  await startRuntime(id);await ready();
  assert.equal((await execRuntime(id,['git','-C','/workspace/app','branch','--show-current'])).text.trim(),`prism/requirement-${id}`);
  assert.ok((await runtimeStatus(id)).ports.includes(3457));
  await assert.rejects(issueRuntimeLink(id,'viewer','ide','127.0.0.1'),/权限不足/);
  await assert.rejects(issueRuntimeLink(id,'owner','preview','127.0.0.1',9527),/端口无效/);
  const secondLink=await issueRuntimeLink(id,'viewer','preview','127.0.0.1',3457);const secondOpen=await fetch(secondLink,{redirect:'manual'});
  assert.equal(await (await fetch(new URL(secondLink).origin,{headers:{Cookie:secondOpen.headers.get('set-cookie')!.split(';')[0]}})).text(),'second-ipv6-service');
  const link=await issueRuntimeLink(id,'viewer','preview','127.0.0.1');const origin=new URL(link).origin;
  assert.equal((await fetch(origin)).status,401);
  const open=await fetch(link,{redirect:'manual'});assert.equal(open.status,302);const cookie=open.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(link,{redirect:'manual'})).status,403,'ticket is single use');
  const response=await fetch(origin+'/nested?fixture=1',{headers:{Cookie:cookie,Authorization:'Bearer must-not-leak'}});
  assert.equal(response.status,200);const value=await response.json();assert.equal(value.url,'/nested?fixture=1');assert.equal(value.message,'prism-preview-fixture');assert.equal(value.authorization,undefined);assert.ok(!value.cookie.includes('prism_'));
  assert.equal((await fetch(origin,{headers:{Cookie:cookie,Origin:'http://unrelated.invalid'}})).status,403);
  const socket=new WebSocket(origin.replace('http:','ws:'),{headers:{Cookie:cookie,Origin:origin}});
  await new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});socket.terminate();
  const ide=await issueRuntimeLink(id,'owner','ide','127.0.0.1');const ideOpen=await fetch(ide,{redirect:'manual'});assert.equal(ideOpen.status,302);
  let ideReady=false;for(let i=0;i<30;i++){const response=await fetch(new URL(ide).origin,{headers:{Cookie:ideOpen.headers.get('set-cookie')!.split(';')[0]}});if(response.status===200){ideReady=true;break;}await pause();}assert.equal(ideReady,true,'VS Code HTTP endpoint available');
  const ideOrigin=new URL(ide).origin;
  const ideSocket=new WebSocket(ideOrigin.replace('http:','ws:')+'/?reconnectionToken='+crypto.randomUUID()+'&reconnection=false&skipWebSocketFrames=false', {headers:{Cookie:ideOpen.headers.get('set-cookie')!.split(';')[0],Origin:ideOrigin}});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('VS Code WebSocket handshake timed out')),10000);ideSocket.once('open',()=>{clearTimeout(timeout);resolve();});ideSocket.once('error',e=>{clearTimeout(timeout);reject(e);});});
  ideSocket.terminate();
  const manifests=await execRuntime(id,['node','-e',`const fs=require('fs');for(const name of ['git-base','merge-conflict']){const root='/usr/lib/code-server/lib/vscode/extensions/'+name;const m=JSON.parse(fs.readFileSync(root+'/package.json'));if(m.browser)throw Error('Invalid browser entry remains: '+name);if(![m.main,m.main+'.js'].some(p=>fs.existsSync(root+'/'+p)))throw Error('Missing server bundle: '+name)}console.log('extensions-valid')`]);
  assert.equal(manifests.code,0);assert.equal(manifests.text.trim(),'extensions-valid');
  await execRuntime(id,['sh','-c','echo retained > /workspace/app/edit.txt']);
  await stopRuntime(id);assert.equal((await runtimeStatus(id)).status,'stopped');
  const before=(await containerEngine().getContainer(`prism-req-${id}`).inspect()).Id;
  const updated={...projectConfig(project),startupScript:'echo latest-startup > /workspace/startup-value\ncd app\nnode server.cjs',initScript:'echo new-init >> /workspace/init-count'};
  getDb().prepare('UPDATE project_configs SET config=? WHERE project_id=?').run(JSON.stringify(updated),project);
  await startRuntime(id);await ready();
  assert.notEqual((await containerEngine().getContainer(`prism-req-${id}`).inspect()).Id,before);
  assert.equal((await execRuntime(id,['cat','/workspace/startup-value'])).text.trim(),'latest-startup');
  assert.equal((await execRuntime(id,['cat','/workspace/app/edit.txt'])).text.trim(),'retained');assert.equal((await execRuntime(id,['cat','/workspace/init-count'])).text.trim(),'initialized\nnew-init');
  getDb().prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project,'viewer');assert.equal((await fetch(origin,{headers:{Cookie:cookie}})).status,401);
 }finally{
  await containerEngine().getContainer(`prism-req-${id}`).remove({force:true}).catch(()=>{});
  await containerEngine().getVolume(`prism-req-code-${id}`).remove().catch(()=>{});
  getDb().close();rmSync(dir,{recursive:true,force:true});
 }
});
