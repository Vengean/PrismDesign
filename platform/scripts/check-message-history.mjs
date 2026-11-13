import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const workspace=fileURLToPath(new URL('../../',import.meta.url)),root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-history-ui-'));
process.env.PRISM_DATA_DIR=root;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb}=await import('../src/services/db.ts');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.ts');
const {initConversationTables,readConversationForRole}=await import('../src/services/conversations.ts');
const {handlePreviewClient}=await import('../src/services/preview-client.ts');
const {acceptConversationSocket}=await import('../src/services/conversation-socket.ts');
const {conversationEvents}=await import('../src/services/conversation-events.ts');
const {default:conversationRoutes}=await import('../src/routes/conversations.ts');
const {signToken}=await import('../src/middleware/auth.ts');
await initProjectTables();await initConversationTables();
const projectId=await createProject('History project','','owner',[],emptyConfig),id=crypto.randomUUID(),sessionId=crypto.randomUUID();
await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by,branch_status) VALUES(?,?,?,?,?,?,?)').run(id,projectId,'历史分页验证','','','owner','ready');
await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sessionId,id);
let count=0;
async function append(body,mentions=[]){count++;await getDb().prepare("INSERT INTO conversation_messages(id,session_id,role,body,mentions) VALUES(?,?,'assistant',?,?)").run('m'+count,sessionId,body||`History ${count}\n\n消息说明。`,JSON.stringify(mentions));conversationEvents.emit(sessionId);}
await getDb().transaction(async()=>{for(let i=1;i<=205;i++)await append(i===10?'@owner 较早的提醒。':undefined,i===10?['owner']:[]);})();
const item={id,title:'历史分页验证',description:'',session_id:sessionId,release_id:'release',status:'developing',branch_name:'fixture',branch_status:'ready',branch_error:'',environment_status:'stopped',created_by:'owner'},release={id:'release',name:'History release',description:'',status:'integrating',branch_status:'ready',branch_name:'fixture',requirements:[item],requests:[],repositories:[],frozen_manifest:'{}'};
const project={id:projectId,name:'History project',access_role:'admin',config:emptyConfig,members:[],requirements:[item],releases:[release]};
const app=express();app.use(express.json());app.use('/api/projects/:id/requirements/:requirementId/conversation',conversationRoutes);
app.get('/api/projects/:id',(req,res)=>res.json(project));app.get('/api/projects/:id/releases/:releaseId',(req,res)=>res.json(release));
app.get('/api/projects/:id/requirements/:requirementId/environment',(req,res)=>res.json({status:'stopped',ports:[],services:[],agentReady:true,phase:'stopped',elapsedSeconds:0,error:''}));
app.use((req,res)=>{const asset=path.join(workspace,'platform/web/dist',req.path);res.sendFile(fs.existsSync(asset)&&fs.statSync(asset).isFile()?asset:path.join(workspace,'platform/web/dist/index.html'));});
const requests=[],managementWaits=new Set();let failOlder=false;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname.endsWith('/conversation')){if(!url.searchParams.has('notification'))requests.push({surface:url.pathname.startsWith('/api/')?'management':'preview',query:url.searchParams.toString()});if(url.pathname.startsWith('/api/')&&url.searchParams.get('wait')==='1'){managementWaits.add(res);res.once('close',()=>managementWaits.delete(res));}if(url.searchParams.has('before')){if(failOlder){failOlder=false;res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"暂时无法加载历史消息"}');return;}await new Promise(resolve=>setTimeout(resolve,180));}}
 if(url.pathname==='/__prism_platform__/widget.js'){res.setHeader('content-type','application/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(workspace,'platform/web/public/prism-widget.js')));return;}
 if(url.pathname.startsWith('/__prism_platform__/')){await handlePreviewClient(req,res,id,'owner');return;}
 if(url.pathname==='/preview'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="prism-platform" content="1">'+(url.searchParams.has('widget')?'<script src="/__prism_platform__/widget.js" defer></script>':'')+'<h1>Preview</h1>');return;}
 app(req,res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const sockets=new Set();server.on('upgrade',(req,socket,head)=>{void acceptConversationSocket(req,socket,head,{sessionId,read:(after,eventAfter)=>readConversationForRole(id,'admin',after,eventAfter)});sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
const require=createRequire(path.join(workspace,'packages/agent/package.json')),{chromium}=require('playwright');let browser,activePage,activeSurface;
try{
 const dist=path.join(workspace,'packages/chrome-ext/dist');browser=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],viewport:{width:480,height:900}});
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),extensionId=new URL(worker.url()).host;
 const preview=await browser.newPage();await preview.goto(base+'/preview');const tabId=await worker.evaluate(async base=>(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(base)).id,base);
 for(const surface of ['extension','widget','management']){
  const page=await browser.newPage(),errors=[];activePage=page;activeSurface=surface;page.on('pageerror',error=>errors.push(error.message));requests.length=0;
  if(surface==='extension'){await page.addInitScript(tabId=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async options=>options.active?(await query({})).filter(tab=>tab.id===tabId):query(options);},tabId);await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);}
  if(surface==='widget'){await page.addInitScript(()=>localStorage.setItem('prism-panel-visible','1'));await page.goto(base+'/preview?widget=1');}
  if(surface==='management'){await page.addInitScript(({token})=>{localStorage.setItem('user',JSON.stringify({id:'owner',role:'admin'}));localStorage.setItem('token',token);},{token:signToken({userId:'owner',role:'admin'})});await page.goto(base+`/projects/${projectId}/releases/release`);await page.getByRole('button',{name:'与 Agent 对话',exact:true}).click();}
  const rootLocator=surface==='widget'?page.locator('#prism-studio-widget'):surface==='management'?page.getByRole('dialog'):page.locator('body');
  const viewport=surface==='management'?rootLocator.locator('[data-conversation-viewport]'):rootLocator.locator('[data-chat-viewport]>div');
  const latest=count,oldest=latest-49;await rootLocator.locator(`[data-message-id="m${latest}"]`).waitFor();await page.waitForTimeout(200);
  assert.equal(await rootLocator.locator('[data-message-id]').count(),50,`${surface}: only the newest page is rendered`);assert.equal(await rootLocator.locator('[data-message-id="m1"]').count(),0);assert.ok(requests[0].query.includes('latest=1'));assert.equal(requests.filter(request=>request.query.includes('before=')).length,0);
  await viewport.evaluate((element,id)=>{const node=element.querySelector(`[data-message-id="${id}"]`);element.scrollTop=0;window.historyAnchor={node,top:node.getBoundingClientRect().top};},'m'+oldest);
  const historyDeadline=Date.now()+5000;while(!requests.some(request=>request.query.includes('before='))){assert.ok(Date.now()<historyDeadline,'History request did not start');await new Promise(resolve=>setTimeout(resolve,5));}
  await append('New message during history load');
  await rootLocator.locator(`[data-message-id="m${oldest-50}"]`).waitFor();await rootLocator.locator(`[data-message-id="m${count}"]`).waitFor();await page.waitForTimeout(250);
  assert.equal(await rootLocator.locator('[data-message-id]').count(),101);assert.equal(requests.filter(request=>request.query.includes('before=')).length,1);
  assert.ok(await viewport.evaluate(element=>{const anchor=window.historyAnchor;return element.contains(anchor.node)&&Math.abs(anchor.node.getBoundingClientRect().top-anchor.top)<3;}),`${surface}: prepending history preserves the visible message`);
  // A broken live connection resumes after the latest message, never from history.
  const resumeAt=count;for(const socket of sockets)socket.destroy();if(surface==='management')for(const response of managementWaits)response.destroy();await append('Message sent while disconnected');
  await rootLocator.locator(`[data-message-id="m${count}"]`).waitFor({timeout:10000});assert.ok(requests.some(request=>new URLSearchParams(request.query).get('after')===String(resumeAt)&&!request.query.includes('latest=1')));
  failOlder=true;await viewport.evaluate(element=>{element.scrollTop=0;});await rootLocator.getByRole('button',{name:'历史消息加载失败，点击重试',exact:true}).waitFor();
  await rootLocator.getByRole('button',{name:'历史消息加载失败，点击重试',exact:true}).click();await rootLocator.locator(`[data-message-id="m${oldest-100}"]`).waitFor();
  // Consume the remaining pages only in response to upward scrolling or a click.
  while(await rootLocator.getByRole('button',{name:'加载更早消息',exact:true}).count()){
   const previous=await rootLocator.locator('[data-message-id]').count();await viewport.evaluate(element=>{element.scrollTop=0;element.dispatchEvent(new Event('scroll'));});const deadline=Date.now()+5000;while(await rootLocator.locator('[data-message-id]').count()===previous){assert.ok(Date.now()<deadline,'Older page did not arrive');await new Promise(resolve=>setTimeout(resolve,10));}
  }
  await rootLocator.locator('[data-message-id="m1"]').waitFor();assert.equal(await rootLocator.locator('[data-message-id]').count(),count);assert.equal(await rootLocator.locator('[data-message-id]').evaluateAll(nodes=>new Set(nodes.map(node=>node.dataset.messageId)).size),count);
  assert.deepEqual(errors,[]);console.log(`PASS ${surface}: latest 50 only, scroll-to-load, stable anchor, concurrent new messages, reconnect cursor, retry and complete history without duplicates.`);await page.close();
 }
}catch(error){console.log('History diagnostics',activeSurface,JSON.stringify(requests.slice(-12)));if(activePage){console.log('List state',await activePage.locator('[data-chat-viewport]>div,[data-conversation-viewport]').evaluateAll(nodes=>nodes.map(node=>({top:node.scrollTop,height:node.scrollHeight,view:node.clientHeight,text:node.innerText.slice(0,260)}))));console.log('Controls',await activePage.getByRole('button').allTextContents());}throw error;}finally{await browser?.close();for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await getDb().close();fs.rmSync(root,{recursive:true,force:true});}
