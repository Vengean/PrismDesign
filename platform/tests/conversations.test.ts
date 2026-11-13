import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
const directory=mkdtempSync(path.join(os.tmpdir(),'prism-conversation-test-'));
process.env.PRISM_DATA_DIR=directory;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='test-password';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initConversationTables,createConversationService,readConversation,interruptPreviousRuns}=await import('../src/services/conversations.js');
const {activeWorkspaceRun,assertRuntimeChangeAllowed,releaseInterruptedRun}=await import('../src/services/workspace-lock.js');
const {initRuntimeTables,startRuntime,stopRuntime,withGitOperation,runtimeOperationActive}=await import('../src/services/requirement-runtime.js');
const {issueRuntimeLink}=await import('../src/services/preview-gateway.js');
const {default:router}=await import('../src/routes/conversations.js');
const {default:environmentRouter}=await import('../src/routes/environments.js');
const {signToken}=await import('../src/middleware/auth.js');
(await initProjectTables());(await initRuntimeTables());(await initConversationTables());(await initConversationTables());
for(const user of ['editor','viewer','stranger'])(await createUser(user,'unused'));
const project=(await createProject('Fixture','','owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],{...emptyConfig}));
async function demand(){const id=crypto.randomUUID();(await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner'));(await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(crypto.randomUUID(),id));return id;}
let done:()=>void=()=>{};let send:(type:string,data:Record<string,unknown>)=>void=()=>{};let input:{runId:string;message:string};let cancelled=false;
const service=createConversationService({async run(_id,value,onEvent){input=value;assert.ok((await readConversation(_id)).messages.length);send=(type,data)=>onEvent({type,data});send('bridge.ready',{cancelSupported:true});send('bridge.dispatch',{});send('run.started',{runId:value.runId});await new Promise<void>(resolve=>{done=resolve;});send('bridge.result',{success:true,message:cancelled?'cancelled':'fixture answer',cancelled});},async cancel(){cancelled=true;}});
const app=express();app.use(express.json());app.use('/api/projects/:id/requirements/:requirementId/conversation',router);
app.use('/api/projects/:id/requirements/:requirementId/environment',environmentRouter);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
async function call(id:string,user:string,method='GET',suffix='',body?:unknown){return fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${project}/requirements/${id}/conversation${suffix}`,{method,headers:{Authorization:`Bearer ${signToken({userId:user,role:user==='owner'?'admin':'user'})}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));(await getDb().close());rmSync(directory,{recursive:true,force:true});});
async function ready(id:string){const deadline=Date.now()+2000;while(!await (async()=>{const snapshot=await readConversation(id);return snapshot.runs.some((run:any)=>run.id===snapshot.active_run?.id&&run.cancel_supported);})()){assert.ok(Date.now()<deadline,'fixture did not start');await new Promise(resolve=>setTimeout(resolve,2));}}
test('persists messages before execution, preserves workspace lock and replays request IDs once',async()=>{
 const id=(await demand());const result=(await service.submit(id,'editor','first request','request-0001'));await ready(id);
 assert.equal((await activeWorkspaceRun(id))?.id,result.runId);
 assert.equal((await service.submit(id,'editor','first request','request-0001')).messageId,result.messageId);await assert.rejects(async ()=>(await service.submit(id,'editor','different','request-0001')),/不同消息/);
 await assert.rejects(startRuntime(id),/Agent/);await assert.rejects(stopRuntime(id),/Agent/);
 await send('message.delta',{runId:result.runId!,delta:'partial'});await send('tool.started',{runId:result.runId!,label:'读取文件'});
 assert.equal(((await readConversation(id)).current_messages as {body:string;role:string}[]).find(m=>m.role==='assistant')!.body,'partial');
 const editor=await (await call(id,'editor')).json();assert.ok(editor.messages.some((m:any)=>m.body==='first request'));assert.ok(editor.events.some((e:any)=>e.type==='tool.started'));
 assert.equal((await call(id,'viewer')).status,403);
 assert.equal((await call(id,'viewer','POST','/messages',{message:'denied',requestId:'request-0003'})).status,403);assert.equal((await call(id,'stranger')).status,404);
 done();await service.wait(result.runId!);assert.equal((await activeWorkspaceRun(id)),undefined);assert.ok(((await readConversation(id)).messages as {body:string}[]).some(m=>m.body==='fixture answer'));
 const next=(await service.submit(id,'editor','follow up','request-0004'));await ready(id);assert.match(input.message,/first request/);assert.match(input.message,/fixture answer/);assert.match(input.message,/follow up/);done();await service.wait(next.id);
});
test('cancellation acknowledgement retains lock until Agent execution actually finishes',async()=>{
 const id=(await demand());const result=(await service.submit(id,'editor','cancel request','cancel-0001'));await ready(id);await service.cancel(id,result.runId!);
 assert.equal((await activeWorkspaceRun(id))?.status,'cancelling');await assert.rejects(async ()=>(await assertRuntimeChangeAllowed(id)),/Agent/);done();await service.wait(result.runId!);assert.equal((await activeWorkspaceRun(id)),undefined);
 assert.equal(((await readConversation(id)).runs as {status:string}[])[0].status,'cancelled');cancelled=false;
});
test('uncertain bridge disconnect and platform restart keep exclusive lock until environment termination',async()=>{
 const id=(await demand());const failed=createConversationService({async run(_id,input,onEvent){onEvent({type:'bridge.dispatch',data:{}});onEvent({type:'message.delta',data:{runId:input.runId,delta:'已读取项目文件'}});throw Error('socket lost');},async cancel(){}});
 const result=(await failed.submit(id,'owner','test','disconnect-01'));await failed.wait(result.runId!);assert.equal((await activeWorkspaceRun(id))?.status,'interrupted');assert.match(((await readConversation(id)).current_messages as {body:string;role:string}[]).find(m=>m.role==='assistant')!.body,/重启需求环境/);assert.ok(!((await readConversation(id)).current_messages as {body:string;role:string}[]).find(m=>m.role==='assistant')!.body.includes('已读取项目文件'));assert.ok((await failed.submit(id,'owner','retry','disconnect-02')).messageId);
 await assert.doesNotReject(async ()=>(await assertRuntimeChangeAllowed(id)));(await releaseInterruptedRun(id));assert.equal((await activeWorkspaceRun(id)),undefined);
 const next=(await service.submit(id,'owner','test restart','restart-001'));await ready(id);(await interruptPreviousRuns());assert.equal((await activeWorkspaceRun(id))?.status,'interrupted');done();await service.wait(next.id);
});
test('early transport failure is durable and does not strand a lock',async()=>{
 const id=(await demand());const failing=createConversationService({async run(){throw Error('请先启动需求环境');},async cancel(){}});const result=(await failing.submit(id,'owner','hello','startup-0001'));await failing.wait(result.runId!);
 assert.equal((await activeWorkspaceRun(id)),undefined);assert.equal(((await readConversation(id)).runs as {status:string}[])[0].status,'failed');
 assert.ok((await readConversation(id)).next_event_cursor>0);const cursor=(await readConversation(id)).next_event_cursor;assert.equal((await readConversation(id,0,cursor)).events.length,0);
});

test('element comments persist with UI text, retain idempotency and stay private from viewers',async()=>{
 const id=(await demand());const metadata={text:'修改颜色',comments:[{element:{domPath:'body > button',tagName:'BUTTON',textContent:'提交',component:{name:'Submit',sourceFile:'src/Button.tsx',sourceLine:12}},comment:'改成蓝色'}],contextOrder:['comments']};
 const result=(await service.submit(id,'editor','Element: BUTTON body > button\n改成蓝色','comment-0001',metadata));
 const stored=((await readConversation(id)).messages as any[]).find(message=>message.role==='user');
 assert.equal(JSON.parse(stored.client_context).text,'修改颜色');assert.equal(JSON.parse(stored.client_context).comments[0].element.component.sourceFile,'src/Button.tsx');
 assert.equal((await service.submit(id,'editor','Element: BUTTON body > button\n改成蓝色','comment-0001',metadata)).replayed,true);
 await assert.rejects(async ()=>(await service.submit(id,'editor','Element: BUTTON body > button\n改成蓝色','comment-0001',{...metadata,text:'different'})),/不同消息/);
 assert.equal((await call(id,'viewer')).status,403);
 await ready(id);done();await service.wait(result.runId!);
 await assert.rejects(async ()=>(await service.submit(id,'editor','test','comment-0002',{text:'test',comments:[{element:{domPath:'body',tagName:'BODY',textContent:{}},comment:'test'}]})),/上下文无效/);
 await assert.rejects(async ()=>(await service.submit(id,'editor','test','comment-0003',{text:'test',comments:[{element:{domPath:'body',tagName:'BODY',textContent:'a'.repeat(65000)},comment:'test'}]})),/上下文过大/);
});

test('Git operations exclude Agent/start/stop and release their lock after failure',async()=>{
 const id=(await demand());let release:()=>void=()=>{};
 const work=withGitOperation(id,()=>new Promise<void>(resolve=>{release=resolve;}));
 const waitUntil=Date.now()+2000;while(!runtimeOperationActive(id)){assert.ok(Date.now()<waitUntil);await new Promise(resolve=>setTimeout(resolve,2));}
 assert.equal(runtimeOperationActive(id),true);
 assert.ok((await service.submit(id,'owner','test','git-locked-001')).messageId);
 await assert.rejects(startRuntime(id),/Git 操作/);await assert.rejects(stopRuntime(id),/环境操作/);
 await assert.rejects(withGitOperation(id,async()=>{}),/操作进行中/);
 release();await work;assert.equal(runtimeOperationActive(id),false);
 await assert.rejects(withGitOperation(id,async()=>{throw Error('fixture failure');}),/fixture failure/);assert.equal(runtimeOperationActive(id),false);
 const run=(await service.submit(id,'owner','test','git-agent-001'));await ready(id);
 await assert.rejects(withGitOperation(id,async()=>{}),/Agent/);done();await service.wait(run.id);
});
test('Git configuration and actions are unavailable to viewers and cross-project callers',async()=>{
 const id=(await demand());
 async function gitCall(user:string,method='GET',projectId=project,action='push'){return fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${projectId}/requirements/${id}/environment/git${method==='POST'?'/'+action:''}`,{method,headers:{Authorization:`Bearer ${signToken({userId:user,role:'user'})}`,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({repo:'app'})}:{})});}
 assert.equal((await gitCall('viewer')).status,403);assert.equal((await gitCall('viewer','POST')).status,403);assert.equal((await gitCall('viewer','POST',project,'commit')).status,403);
 assert.equal((await gitCall('editor','GET','other-project')).status,404);
 const response=await gitCall('editor');assert.equal(response.status,200);const value=await response.json();assert.deepEqual(value.repos,[]);assert.equal(value.branch,`prism/requirement-${id}`);
 assert.equal((await gitCall('editor','POST')).status,409);
});

test('live reads wake on tool/text events and close their subscriptions without waiting for a polling tick',async()=>{
 const {conversationEvents}=await import('../src/services/conversation-events.js');
 const id=(await demand()),session=((await readConversation(id))).session_id;
 const result=(await service.submit(id,'editor','live request','live-request-0001'));await ready(id);
 async function subscribed(){const until=Date.now()+3000;while(!conversationEvents.listenerCount(session)){assert.ok(Date.now()<until,'live read did not subscribe');await new Promise(r=>setTimeout(r,5));}}
 try{
  let snapshot=(await readConversation(id));
  const waiting=call(id,'editor','GET',`?after=${snapshot.next_message_cursor}&eventAfter=${snapshot.next_event_cursor}&liveAfter=${encodeURIComponent(snapshot.next_live_cursor || '')}&wait=1`);
  await subscribed();
  await send('tool.started',{runId:result.runId!,toolCallId:'read-1',tool:'Read',label:'读取 package.json'});
  const tools=await (await waiting).json();assert.ok(tools.events.some((event:any)=>event.data.label==='读取 package.json'));assert.equal(conversationEvents.listenerCount(session),0);
  const text=call(id,'editor','GET',`?after=${tools.next_message_cursor}&eventAfter=${tools.next_event_cursor}&liveAfter=${encodeURIComponent(tools.next_live_cursor || '')}&wait=1`);
  await subscribed();await send('message.delta',{runId:result.runId!,delta:'已找到配置'});
  const partial=await (await text).json();assert.ok(partial.current_messages.some((message:any)=>message.body==='已找到配置'));assert.equal(partial.active_run.id,result.runId);
  // Catch-up data is returned immediately instead of sleeping until another event.
  const catchup=await (await call(id,'editor','GET','?wait=1')).json();assert.ok(catchup.events.length);assert.equal(conversationEvents.listenerCount(session),0);
  snapshot=(await readConversation(id));
  const abort=new AbortController();const disconnected=fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${project}/requirements/${id}/conversation?after=${snapshot.next_message_cursor}&eventAfter=${snapshot.next_event_cursor}&liveAfter=${encodeURIComponent(snapshot.next_live_cursor || '')}&wait=1`,{signal:abort.signal,headers:{Authorization:`Bearer ${signToken({userId:'editor',role:'user'})}`}}).catch(()=>undefined);
  await subscribed();abort.abort();await disconnected;
  const until=Date.now()+3000;while(conversationEvents.listenerCount(session)){assert.ok(Date.now()<until,'disconnected listener was not removed');await new Promise(r=>setTimeout(r,5));}
 }finally{done();await service.wait(result.runId!);}
});
