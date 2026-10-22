import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import {PlatformClient,type PlatformContext,type PlatformRequest} from '../../packages/widget/src/platform-client.js';

test('real container: clone, branch, scripts, authorized HTTP/WebSocket preview, IDE and persistent restart', {skip:process.env.PRISM_TEST_CONTAINERS!=='1',timeout:120000},async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'prism-container-test-'));
 process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture-password';
 process.env.PRISM_WORKSPACE_IMAGE='prism-runtime-fixture:latest';process.env.PRISM_PREVIEW_BIND='127.0.0.1';
 const {getDb,createUser}=await import('../src/services/db.js');
 const {initProjectTables,createProject,emptyConfig,projectConfig}=await import('../src/services/projects.js');
 const {initRuntimeTables,startRuntime,stopRuntime,runtimeStatus,runtimeLogs,execRuntime,containerEngine}=await import('../src/services/requirement-runtime.js');
 const {initConversationTables,conversations,readConversation}=await import('../src/services/conversations.js');
 const {activeWorkspaceRun}=await import('../src/services/workspace-lock.js');
 const {issueRuntimeLink}=await import('../src/services/preview-gateway.js');
 initProjectTables();initRuntimeTables();initConversationTables();createUser('viewer','unused');
 const project=createProject('Container fixture','','owner',[{userId:'viewer',role:'viewer'}],{...emptyConfig,
  repos:[{name:'app',url:'https://fixture.invalid/repo',branch:'main'}],
  gitAuth:{mode:'token',sshPort:22,token:'fixture-secret'},
  model:{provider:'claude',baseUrl:'https://fixture.invalid',model:'fixture-model',apiKey:'fixture-model-secret'},
  initScript:'echo initialized >> /workspace/init-count',startupScript:'cd app\nnode server.cjs'});
 const id=crypto.randomUUID();getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(crypto.randomUUID(),id);
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
  const link=await issueRuntimeLink(id,'viewer','preview','127.0.0.1',undefined,'http://127.0.0.1:5173');const origin=new URL(link).origin;
  assert.equal((await fetch(origin)).status,401);
  const anonymousPage=await fetch(origin+'/nested?q=1',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(anonymousPage.status,302);
  const login=new URL(anonymousPage.headers.get('location')!);assert.equal(login.origin,'http://127.0.0.1:5173');assert.equal(login.pathname,'/login');
  const next=new URL(login.searchParams.get('next')!,'http://platform');assert.equal(next.searchParams.get('requirement'),id);assert.equal(next.searchParams.get('path'),'/nested?q=1');
  const unauthorizedApi=await fetch(origin+'/__prism_platform__/context',{headers:{Accept:'text/html'},redirect:'manual'});assert.equal(unauthorizedApi.status,401);assert.match((await unauthorizedApi.json()).error,/请登录/);
  const resume=await issueRuntimeLink(id,'owner','preview','127.0.0.1');const target=new URL(resume);target.searchParams.set('path','/nested?resumed=1');
  const resumed=await fetch(target,{redirect:'manual'});assert.equal(resumed.status,302);assert.equal(resumed.headers.get('location'),'/nested?resumed=1');assert.ok(resumed.headers.get('set-cookie'));
  const unsafe=new URL(await issueRuntimeLink(id,'owner','preview','127.0.0.1'));unsafe.searchParams.set('path','//evil.example');assert.equal((await fetch(unsafe,{redirect:'manual'})).headers.get('location'),'/');

  const open=await fetch(link,{redirect:'manual'});assert.equal(open.status,302);const cookie=open.headers.get('set-cookie')!.split(';')[0];assert.notEqual(cookie.split('=')[0],secondOpen.headers.get('set-cookie')!.split('=')[0]);
  assert.equal((await fetch(link,{redirect:'manual'})).status,403,'ticket is single use');
  const response=await fetch(origin+'/nested?fixture=1',{headers:{Cookie:cookie,Authorization:'Bearer must-not-leak'}});
  assert.equal(response.status,200);const value=await response.json();assert.equal(value.url,'/nested?fixture=1');assert.equal(value.message,'prism-preview-fixture');assert.equal(value.authorization,undefined);assert.ok(!value.cookie.includes('prism_'));
  assert.equal((await fetch(origin,{headers:{Cookie:cookie,Origin:'http://unrelated.invalid'}})).status,403);
  const socket=new WebSocket(origin.replace('http:','ws:'),{headers:{Cookie:cookie,Origin:origin}});
  await new Promise<void>((resolve,reject)=>{socket.once('open',()=>resolve());socket.once('error',reject);});socket.terminate();

  const html=await fetch(origin+'/html',{headers:{Cookie:cookie}});assert.equal(html.headers.get('x-prism-widget'),'injected');assert.match(await html.text(),/__prism_platform__\/widget.js/);
  assert.equal((await fetch(origin+'/__prism_platform__/widget.js',{headers:{Cookie:cookie}})).status,200);
  const viewerContext=await (await fetch(origin+'/__prism_platform__/context',{headers:{Cookie:cookie}})).json() as PlatformContext;assert.equal(viewerContext.requirementId,id);assert.equal(viewerContext.role,'viewer');
  const ownerPreview=await issueRuntimeLink(id,'owner','preview','127.0.0.1');const ownerOpen=await fetch(ownerPreview,{redirect:'manual'});const ownerCookie=ownerOpen.headers.get('set-cookie')!.split(';')[0];
  const request:PlatformRequest=async<T>(path,method='GET',body)=>{const response=await fetch(origin+'/__prism_platform__'+path,{method,headers:{Cookie:ownerCookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(data.error);return data as T;};
  const ownerContext=await request<PlatformContext>('/context');const widget=new PlatformClient(ownerContext,request),plugin=new PlatformClient(ownerContext,request);assert.equal(ownerContext.sessionId,viewerContext.sessionId);
  const mismatch=await fetch(origin+'/__prism_platform__/messages?sessionId=wrong',{method:'POST',headers:{Cookie:ownerCookie,'Content-Type':'application/json'},body:JSON.stringify({message:'must not run',requestId:'mismatch-request'})});assert.equal(mismatch.status,409);
  const viewerPost=await fetch(origin+'/__prism_platform__/messages?sessionId='+viewerContext.sessionId,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({message:'denied',requestId:'viewer-request-01'})});assert.equal(viewerPost.status,403);
  const fromWidget=await widget.send('widget entry request','widget-entry-request');await conversations.wait(fromWidget.id);assert.ok((await plugin.sync()).messages.some(m=>m.body==='widget entry request'));
  const fromPlugin=await plugin.send('plugin entry request','plugin-entry-request');await conversations.wait(fromPlugin.id);assert.ok((await widget.sync()).messages.some(m=>m.body==='plugin entry request'));
  const ide=await issueRuntimeLink(id,'owner','ide','127.0.0.1');const ideOpen=await fetch(ide,{redirect:'manual'});assert.equal(ideOpen.status,302);
  let ideReady=false;for(let i=0;i<30;i++){const response=await fetch(new URL(ide).origin,{headers:{Cookie:ideOpen.headers.get('set-cookie')!.split(';')[0]}});if(response.status===200){ideReady=true;break;}await pause();}assert.equal(ideReady,true,'VS Code HTTP endpoint available');
  const ideOrigin=new URL(ide).origin;
  const ideSocket=new WebSocket(ideOrigin.replace('http:','ws:')+'/?reconnectionToken='+crypto.randomUUID()+'&reconnection=false&skipWebSocketFrames=false', {headers:{Cookie:ideOpen.headers.get('set-cookie')!.split(';')[0],Origin:ideOrigin}});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('VS Code WebSocket handshake timed out')),10000);ideSocket.once('open',()=>{clearTimeout(timeout);resolve();});ideSocket.once('error',e=>{clearTimeout(timeout);reject(e);});});
  const ideClosed=new Promise<void>(resolve=>ideSocket.once('close',()=>resolve()));
  const held=conversations.submit(id,'owner','fixture-hold-run','fixture-hold-001');
  await ideClosed;
  assert.equal((await fetch(ideOrigin,{headers:{Cookie:ideOpen.headers.get('set-cookie')!.split(';')[0]}})).status,423);
  await assert.rejects(startRuntime(id),/Agent/);
  for(let i=0;i<15;i++){if((readConversation(id).runs as {cancel_supported:number}[])[0].cancel_supported)break;await pause();}
  assert.equal((readConversation(id).runs as {cancel_supported:number}[])[0].cancel_supported,1,JSON.stringify(readConversation(id).runs));
  await conversations.cancel(id,held.id);await conversations.wait(held.id);assert.equal(activeWorkspaceRun(id),undefined);
  const normal=conversations.submit(id,'owner','fixture edit request','fixture-normal-01');await conversations.wait(normal.id);
  assert.equal((readConversation(id).runs as {status:string}[])[0].status,'succeeded');
  assert.ok((readConversation(id).current_messages as {body:string}[]).some(m=>m.body==='处理完成 ✅'));
  assert.equal((await execRuntime(id,['cat','/workspace/app/agent-edit.txt'])).text,'fixture source edit');
  const manifests=await execRuntime(id,['node','-e',`const fs=require('fs');for(const name of ['git-base','merge-conflict']){const root='/usr/lib/code-server/lib/vscode/extensions/'+name;const m=JSON.parse(fs.readFileSync(root+'/package.json'));if(m.browser)throw Error('Invalid browser entry remains: '+name);if(![m.main,m.main+'.js'].some(p=>fs.existsSync(root+'/'+p)))throw Error('Missing server bundle: '+name)}console.log('extensions-valid')`]);
  assert.equal(manifests.code,0);assert.equal(manifests.text.trim(),'extensions-valid');
  await execRuntime(id,['sh','-c','echo retained > /workspace/app/edit.txt']);
  const historyBeforeRestart=readConversation(id);
  await stopRuntime(id);assert.equal((await runtimeStatus(id)).status,'stopped');
  const before=(await containerEngine().getContainer(`prism-req-${id}`).inspect()).Id;
  const updated={...projectConfig(project),startupScript:'echo latest-startup > /workspace/startup-value\ncd app\nnode server.cjs',initScript:'echo new-init >> /workspace/init-count'};
  getDb().prepare('UPDATE project_configs SET config=? WHERE project_id=?').run(JSON.stringify(updated),project);
  await startRuntime(id);await ready();
  assert.notEqual((await containerEngine().getContainer(`prism-req-${id}`).inspect()).Id,before);
  assert.equal(readConversation(id).session_id,historyBeforeRestart.session_id);assert.deepEqual(readConversation(id).messages,historyBeforeRestart.messages);
  assert.equal((await execRuntime(id,['cat','/workspace/startup-value'])).text.trim(),'latest-startup');
  assert.equal((await execRuntime(id,['cat','/workspace/app/edit.txt'])).text.trim(),'retained');assert.equal((await execRuntime(id,['cat','/workspace/init-count'])).text.trim(),'initialized\nnew-init');
  getDb().prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project,'viewer');assert.equal((await fetch(origin,{headers:{Cookie:cookie}})).status,401);
 }finally{
  await containerEngine().getContainer(`prism-req-${id}`).remove({force:true}).catch(()=>{});
  await containerEngine().getVolume(`prism-req-code-${id}`).remove().catch(()=>{});
  getDb().close();rmSync(dir,{recursive:true,force:true});
 }
});
