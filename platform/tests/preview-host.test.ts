import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {previewHostConfig,previewHostname,closePreviewHosts} from '../src/services/preview-host.js';
const dir=mkdtempSync(path.join(os.tmpdir(),'prism-host-test-'));
process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {createGateway}=await import('../src/services/preview-gateway.js');
const {workspaceEvents}=await import('../src/services/workspace-lock.js');
const {initConversationTables,createConversationService,readConversation,conversationSession}=await import('../src/services/conversations.js');
const {conversationEvents}=await import('../src/services/conversation-events.js');
initProjectTables();initConversationTables();createUser('live-editor','unused');createUser('preview-viewer','unused');
const project=createProject('host routing','','owner',[{userId:'live-editor',role:'editor'},{userId:'preview-viewer',role:'viewer'}],emptyConfig),id=crypto.randomUUID();
getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'R','','','owner');
getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(crypto.randomUUID(),id);
after(async()=>{await closePreviewHosts();getDb().close();rmSync(dir,{recursive:true,force:true});});
async function listen(server:net.Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return (server.address() as net.AddressInfo).port;}
function request(port:number,host:string,url='/',headers:Record<string,string>={}){return new Promise<{status:number;headers:http.IncomingHttpHeaders;body:string}>((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path:url,headers:{Host:host,...headers}},res=>{let body='';res.setEncoding('utf8');res.on('data',s=>body+=s);res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body}));}).on('error',reject);});}
test('production gateway config requires a separate HTTPS management origin',()=>{
 process.env.PRISM_PREVIEW_DOMAIN='preview.example.test';process.env.PRISM_PLATFORM_URL='http://studio.example.test';assert.throws(previewHostConfig,/HTTPS/);
 process.env.PRISM_PLATFORM_URL='https://p.preview.example.test';assert.throws(previewHostConfig,/HTTPS/);
 process.env.PRISM_PLATFORM_URL='https://studio.example.test';assert.equal(previewHostConfig()!.domain,'preview.example.test');
 assert.notEqual(previewHostname('r:preview:3000','preview.example.test'),previewHostname('r:ide:default','preview.example.test'));
});
test('one loopback listener handles isolated HTTPS origins, tickets, cookies, HTML, WS and revocation',async()=>{
 const slot=net.createServer(),port=await listen(slot);await new Promise<void>(r=>slot.close(()=>r()));process.env.PRISM_PREVIEW_GATEWAY_PORT=String(port);
 const app=http.createServer((req,res)=>{if(req.url==='/headers'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.headers));return;}res.setHeader('Content-Type','text/html');res.end('<html><head></head><body>App</body></html>');});
 const wss=new WebSocketServer({server:app});wss.on('connection',socket=>socket.send('connected'));
 const appPort=await listen(app);
 try{
  const a=await createGateway(id,'preview',5173,undefined,async()=>appPort),b=await createGateway(id,'preview',3000,undefined,async()=>appPort);
  assert.equal(a.port,b.port);assert.notEqual(a.origin,b.origin);
  const host=new URL(a.origin!).host,other=new URL(b.origin!).host;
  assert.equal((await request(port,'unknown.preview.example.test')).status,404);
  const login=await request(port,host,'/nested?q=1',{Accept:'text/html'});assert.equal(login.status,302);assert.equal(new URL(login.headers.location!).origin,'https://studio.example.test');
  const ticket=a.issue('owner'),open=await request(port,host,'/__prism_open?ticket='+ticket);assert.equal(open.status,302);
  const setCookie=open.headers['set-cookie']![0];assert.match(setCookie,/^__Host-prism_/);assert.match(setCookie,/; Secure/);assert.match(setCookie,/HttpOnly/);assert.ok(!setCookie.includes('Domain='));const cookie=setCookie.split(';')[0];
  assert.equal((await request(port,host,'/__prism_open?ticket='+ticket)).status,403);
  assert.equal((await request(port,other,'/',{Cookie:cookie})).status,401);
  const page=await request(port,host,'/',{Cookie:cookie,Origin:a.origin!});assert.equal(page.status,200);assert.match(page.body,/__prism_platform__\/widget.js/);
  assert.equal((await request(port,host,'/',{Cookie:cookie,Origin:'https://evil.test','x-forwarded-proto':'https'})).status,403);
  const forwarded=JSON.parse((await request(port,host,'/headers',{Cookie:cookie+'; prism_other=secret; app=ok',Authorization:'Bearer secret','x-forwarded-proto':'http'})).body);
  assert.equal(forwarded.authorization,undefined);assert.ok(!forwarded.cookie.includes('prism_'));assert.equal(forwarded['x-forwarded-proto'],'https');
  const socketSession=conversationSession(id),livePath=`/__prism_platform__/conversation/live?sessionId=${socketSession}&after=0&eventAfter=0`;
  const viewerOpen=await request(port,host,'/__prism_open?ticket='+a.issue('preview-viewer'));
  const viewerCookie=viewerOpen.headers['set-cookie']![0].split(';')[0];
  assert.equal((await request(port,host,'/',{Cookie:viewerCookie})).status,200);
  const emptyWidget=await request(port,host,'/__prism_platform__/widget.js',{Cookie:viewerCookie});assert.equal(emptyWidget.status,204);assert.equal(emptyWidget.body,'');
  assert.equal((await request(port,host,`/__prism_platform__/conversation?sessionId=${socketSession}`,{Cookie:viewerCookie})).status,403);
  const deniedViewer=new WebSocket(`ws://127.0.0.1:${port}${livePath}`,{headers:{Host:host,Cookie:viewerCookie,Origin:a.origin!}});
  await assert.rejects(new Promise<void>((resolve,reject)=>{deniedViewer.once('open',resolve);deniedViewer.once('error',reject);}));
  const liveSocket=new WebSocket(`ws://127.0.0.1:${port}${livePath}`,{headers:{Host:host,Cookie:cookie,Origin:a.origin!}});
  const liveFrame=await new Promise<any>((resolve,reject)=>{liveSocket.once('message',data=>resolve(JSON.parse(String(data))));liveSocket.once('error',reject);});
  assert.equal(liveFrame.type,'snapshot');assert.equal(liveFrame.value.session_id,socketSession);
  const liveClosed=new Promise<void>(resolve=>liveSocket.once('close',()=>resolve()));liveSocket.close();await liveClosed;
  for(const headers of [{Host:host,Origin:a.origin!},{Host:host,Cookie:cookie,Origin:'https://evil.test'}]){
   const denied=new WebSocket(`ws://127.0.0.1:${port}${livePath}`,{headers});
   await assert.rejects(new Promise<void>((resolve,reject)=>{denied.once('open',resolve);denied.once('error',reject);}));
  }
  const ws=new WebSocket(`ws://127.0.0.1:${port}/`,{headers:{Host:host,Cookie:cookie,Origin:a.origin!}});
  assert.equal(await new Promise<string>((resolve,reject)=>{ws.once('message',value=>resolve(String(value)));ws.once('error',reject);}), 'connected');const closed=new Promise<void>(r=>ws.once('close',()=>r()));ws.close();await closed;
  const ide=await createGateway(id,'ide',undefined,undefined,async()=>appPort),ideHost=new URL(ide.origin!).host;
  const ideOpen=await request(port,ideHost,'/__prism_open?ticket='+ide.issue('owner'));
  const ideCookie=ideOpen.headers['set-cookie']![0].split(';')[0];
  const ideSocket=new WebSocket(`ws://127.0.0.1:${port}/`,{headers:{Host:ideHost,Cookie:ideCookie,Origin:ide.origin!}});
  await new Promise<void>((resolve,reject)=>{ideSocket.once('open',resolve);ideSocket.once('error',reject);});
  const ideClosed=new Promise<void>(r=>ideSocket.once('close',()=>r()));workspaceEvents.emit('locked',id);await ideClosed;
  const editorOpen=await request(port,host,'/__prism_open?ticket='+a.issue('live-editor'));
  const editorCookie=editorOpen.headers['set-cookie']![0].split(';')[0],session=conversationSession(id);
  let emit:(type:string,data:Record<string,unknown>)=>void=()=>{},finish=()=>{};
  const live=createConversationService({async run(_id,input,onEvent){emit=(type,data)=>onEvent({type,data:{runId:input.runId,...data}});emit('bridge.dispatch',{});emit('run.started',{});await new Promise<void>(r=>{finish=r;});emit('bridge.result',{success:true,message:'done'});},async cancel(){}});
  const task=live.submit(id,'live-editor','preview stream','preview-live-0001');await Promise.resolve();
  const snapshot=readConversation(id),url=`/__prism_platform__/conversation?sessionId=${session}&after=${snapshot.next_message_cursor}&eventAfter=${snapshot.next_event_cursor}&liveAfter=${encodeURIComponent(snapshot.next_live_cursor || '')}&wait=1`;
  async function subscribed(){const deadline=Date.now()+3000;while(!conversationEvents.listenerCount(session)){assert.ok(Date.now()<deadline,'preview did not subscribe');await new Promise(r=>setTimeout(r,5));}}
  try{
   const waiting=request(port,host,url,{Cookie:editorCookie});await subscribed();emit('tool.started',{toolCallId:'read',label:'读取预览配置'});
   const update=await waiting;assert.equal(update.status,200);assert.ok(JSON.parse(update.body).events.some((event:any)=>event.data.label==='读取预览配置'));
   assert.equal((await request(port,host,url.replace(session,'wrong-session'),{Cookie:editorCookie})).status,409);
   const current=readConversation(id),revoked=request(port,host,`/__prism_platform__/conversation?sessionId=${session}&after=${current.next_message_cursor}&eventAfter=${current.next_event_cursor}&liveAfter=${encodeURIComponent(current.next_live_cursor || '')}&wait=1`,{Cookie:editorCookie});await subscribed();
   getDb().prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?').run(project,'live-editor');emit('message.delta',{delta:'private text'});
   const denied=await revoked;assert.equal(denied.status,403);assert.ok(!denied.body.includes('private text'));
  }finally{finish();await live.wait(task.id);}
  for(const table of ['conversation_messages','conversation_events','conversation_runs','conversation_agent_state'])getDb().prepare(`DELETE FROM ${table} WHERE session_id=?`).run(session);
  getDb().prepare('DELETE FROM project_sessions WHERE id=?').run(session);
  getDb().prepare("DELETE FROM requirements WHERE id=?").run(id);
  // Revoking access must return a response rather than reject an async request handler.
  assert.equal((await request(port,host,'/',{Cookie:cookie})).status,401);
 }finally{await closePreviewHosts();app.closeAllConnections();await new Promise<void>(r=>wss.close(()=>r()));await new Promise<void>(r=>app.close(()=>r()));}
});
