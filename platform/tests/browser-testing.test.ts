import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-browser-testing-'));
process.env.PRISM_DATA_DIR=root;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initConversationTables,createConversationService,conversations,readConversation}=await import('../src/services/conversations.js');
const {platformBrowser,createPlatformBrowser}=await import('../src/services/platform-browser.js');
const {handlePreviewClient}=await import('../src/services/preview-client.js');
await initProjectTables();await initConversationTables();for(const user of ['editor','viewer'])await createUser(user,'fixture');
const project=await createProject('Browser testing','','owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],emptyConfig);
async function demand(){const id=crypto.randomUUID(),sessionId=crypto.randomUUID();await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Test fixture','','','owner');await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sessionId,id);return {id,sessionId};}
after(async()=>{platformBrowser.close();await getDb().close();fs.rmSync(root,{recursive:true,force:true});});

test('browser leases enforce user/requirement ownership, fixed origin and matching response IDs',async()=>{
 const {id}=await demand(),other=await demand(),relay=createPlatformBrowser({timeoutMs:50});
 try{
  await assert.rejects(()=>relay.register(id,'viewer','https://preview.test/'),/编辑成员/);
  const binding=await relay.register(id,'owner','https://preview.test/app');
  await assert.rejects(()=>relay.get(binding.id,id,'editor'),/无权访问/);await assert.rejects(()=>relay.get(binding.id,other.id,'owner'),/无权访问/);
  await assert.rejects(()=>relay.execute(binding.id,id,'owner',{action:'navigate',url:'https://other.test/'}),/其他需求/);
  const command=relay.execute(binding.id,id,'owner',{action:'observe'}),polled=await relay.poll(binding.id,id,'owner');
  await assert.rejects(()=>relay.result(binding.id,id,'owner','wrong',true,{}),/过期/);
  await relay.result(binding.id,id,'owner',polled.commands[0].requestId,true,{title:'page'});assert.deepEqual(await command,{title:'page'});
  const timed=relay.execute(binding.id,id,'owner',{action:'click'});await assert.rejects(timed,/超时/);
  const disconnected=relay.execute(binding.id,id,'owner',{action:'observe'});const rejected=assert.rejects(disconnected,/断开/);await relay.unregister(binding.id,id,'owner');await rejected;
 }finally{relay.close();}
});

test('confirmed tests use the conversation queue and persist original verification/cases/evidence across refresh',async()=>{
 const {id}=await demand(),binding=await platformBrowser.register(id,'editor','https://preview.test/app');
 const actions:string[]=[];let stopped=false;
 const browser=async()=>{while(!stopped){try{const commands=await platformBrowser.poll(binding.id,id,'editor');for(const item of commands.commands){actions.push(String(item.command.action));await platformBrowser.result(binding.id,id,'editor',item.requestId,true,item.command.action==='evidence'?{network:[{status:200}]}:{title:'fixture'});}}catch{return;}}};
 const poll=browser();
 const service=createConversationService({async run(_id,input,emit){
  assert.ok(input.browser?.verifyOnly);assert.match(input.clientId,/^platform-browser-test-/);assert.match(input.message,/不修改源码/);
  await emit({type:'bridge.ready',data:{cancelSupported:true}});await emit({type:'bridge.dispatch',data:{}});await emit({type:'run.started',data:{runId:input.runId}});
  const verification={id:'verify-fixture',goal:'创建条目',proposedChecks:['创建后可见'],status:'running'};
  await emit({type:'verification.updated',data:verification});await input.browser!.execute({action:'attach'});await input.browser!.execute({action:'click',target:{role:'button',name:'创建'}});await input.browser!.execute({action:'evidence'});
  const snapshot={id:'test-fixture',verificationId:verification.id,status:'passed',cases:[{id:'case-1',title:'创建后可见',assertion:'创建的条目出现在列表',status:'passed',evidenceIds:['ev-1']}],evidence:[{id:'ev-1',type:'network',url:'/api/items',status:200,caseIds:['case-1']}],steps:[],cleanup:[]};
  await emit({type:'test-run.updated',data:{...snapshot,status:'running'}});
  await emit({type:'bridge.result',data:{success:true,message:'已验证创建条目。',verification:{...verification,status:'passed'},testRun:snapshot}});
 },async cancel(){}});
 try{
  const accepted=await service.submit(id,'editor','开始测试：创建条目','browser-request-01',undefined,[],{bindingId:binding.id,verifyOnly:true});await service.wait(accepted.id);
  const value=await readConversation(id),reply=value.messages.find((message:any)=>message.role==='assistant') as any,metadata=JSON.parse(reply.client_context);
  assert.equal(metadata.verification.status,'passed');assert.equal(metadata.testRun.status,'passed');assert.equal(metadata.testRun.cases[0].status,'passed');assert.equal(metadata.testRun.evidence[0].status,200);assert.ok(actions.includes('detach'));assert.equal(value.active_run,null);
  assert.deepEqual(JSON.parse((await getDb().prepare('SELECT client_context FROM conversation_messages WHERE id=?').get(reply.id)).client_context),metadata);
 }finally{service.close();stopped=true;await platformBrowser.unregister(binding.id,id,'editor');await poll;}
});

test('preview test endpoints reject viewer/stale session and bind only the current preview host',async()=>{
 const {id,sessionId}=await demand();const server=http.createServer((req,res)=>{void handlePreviewClient(req,res,id,String(req.headers['x-user']||'editor'));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const post=(route:string,body:unknown,user='editor',session=sessionId)=>fetch(base+'/__prism_platform__'+route+'?sessionId='+session,{method:'POST',headers:{'content-type':'application/json','x-user':user},body:JSON.stringify(body)});
 let bindingId='';const original=conversations.submit;
 try{
  assert.equal((await post('/browser/register',{pageUrl:base+'/app'},'viewer')).status,403);
  assert.equal((await post('/browser/register',{pageUrl:base+'/app'},'editor','stale')).status,409);
  assert.equal((await post('/browser/register',{pageUrl:'https://other.test/app'})).status,409);
  const registered=await post('/browser/register',{pageUrl:base+'/app'});assert.equal(registered.status,201);bindingId=(await registered.json()).id;
  let submitted:any;conversations.submit=async(...args:any[])=>{submitted=args;return {id:'accepted',messageId:'accepted',runId:null,replayed:false};};
  assert.equal((await post('/testing/start',{goal:'验证保存',requestId:'browser-request-02',bindingId})).status,202);assert.equal(submitted[6].bindingId,bindingId);assert.equal(submitted[6].verifyOnly,true);
 }finally{conversations.submit=original;if(bindingId)await platformBrowser.unregister(bindingId,id,'editor');await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
