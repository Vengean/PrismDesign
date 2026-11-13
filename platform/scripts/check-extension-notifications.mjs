import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../packages/agent/package.json',import.meta.url));
const {chromium}=require('playwright');
const {WebSocketServer}=createRequire(new URL('../package.json',import.meta.url))('ws');
const context={protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'P',title:'Notifications',userId:'u',role:'editor'};
const messages=[{id:'old',seq:1,run_id:null,role:'user',user_id:'other',body:'历史 @u',mentions:'["u"]'}];
const sockets=new Set();let run=null,runs=[],questions=[],events=[];
const snapshot=()=>({session_id:'s',restricted:false,messages,current_messages:[],active_run:run,runs,pending_questions:questions,events,next_message_cursor:messages.length,next_event_cursor:events.length,next_live_cursor:''});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');res.setHeader('content-type','application/json');
 if(url.pathname.endsWith('/context'))res.end(JSON.stringify(context));
 else if(url.pathname.endsWith('/conversation'))res.end(JSON.stringify(snapshot()));
 else {res.setHeader('content-type','text/html');res.end('<!doctype html><meta name="prism-platform" content="1"><h1>Preview</h1>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const wss=new WebSocketServer({server});wss.on('connection',ws=>{sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.send(JSON.stringify({type:'snapshot',value:snapshot()}));});
const beat=setInterval(()=>{for(const ws of sockets)ws.send(JSON.stringify({type:'heartbeat'}));},10000);
let browser;
const until=async(fn)=>{const end=Date.now()+10000;while(!await fn()){assert.ok(Date.now()<end,'condition timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
const push=()=>{for(const ws of sockets)ws.send(JSON.stringify({type:'snapshot',value:snapshot()}));};
try{
 const dist=fileURLToPath(new URL('../../packages/chrome-ext/dist/',import.meta.url));
 browser=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`]});
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 await worker.evaluate(()=>{
  globalThis.alerts=[];const create=chrome.notifications.create.bind(chrome.notifications);
  chrome.notifications.create=(id,options,cb)=>{globalThis.alerts.push({id,options});return create(id,options,cb);};
 });
 const page=await browser.newPage();await page.goto(base);await until(()=>sockets.size===1);
 const alerts=()=>worker.evaluate(()=>globalThis.alerts);
 await new Promise(resolve=>setTimeout(resolve,100));assert.equal((await alerts()).length,0,'No historical notification');
 const duplicate=await browser.newPage();await duplicate.goto(base);await new Promise(resolve=>setTimeout(resolve,200));assert.equal(sockets.size,1,'One stream per conversation/user/origin');
 const mention=()=>{const seq=messages.length+1;messages.push({id:'m'+seq,seq,run_id:null,role:'user',user_id:'other',body:'@u 新消息 '+seq,mentions:'["u"]'});push();};
 mention();await until(async()=>(await alerts()).length===1);assert.equal((await alerts())[0].options.title,'有人 @ 了你');
 const ids=await worker.evaluate(()=>new Promise(resolve=>chrome.notifications.getAll(resolve)));assert.equal(Object.keys(ids).length,1,'Real Chrome notifications API holds the notification');
 await worker.evaluate(()=>chrome.storage.local.set({'prism-notifications-enabled':false}));mention();await new Promise(resolve=>setTimeout(resolve,250));assert.equal((await alerts()).length,1);
 await worker.evaluate(()=>chrome.storage.local.set({'prism-notifications-enabled':true}));push();await new Promise(resolve=>setTimeout(resolve,200));assert.equal((await alerts()).length,1,'Muted events are not replayed');
 // Real shadow-root geometry reports reading; hidden conversation no longer suppresses.
 await duplicate.evaluate(()=>{const host=document.createElement('div');host.id='prism-studio-widget';const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<div data-chat-viewport style="width:300px;height:200px">Reading</div>';document.body.append(host);});
 mention();await new Promise(resolve=>setTimeout(resolve,250));assert.equal((await alerts()).length,1,'Visible Widget suppresses alert');
 await duplicate.evaluate(()=>document.getElementById('prism-studio-widget').style.display='none');mention();await until(async()=>(await alerts()).length===2);
 run={id:'run',status:'running',user_id:'u'};push();await new Promise(resolve=>setTimeout(resolve,100));run=null;runs=[{id:'run',status:'succeeded',user_id:'u',title:'实现完成'}];events=[{seq:1,type:'run.finished',data:{runId:'run'}}];push();await until(async()=>(await alerts()).length===3);assert.equal((await alerts()).at(-1).options.title,'Agent 已完成任务');
 questions=[{id:'q',userId:'u',question:'请确认方案',messageIds:[]}];push();await until(async()=>(await alerts()).length===4);assert.equal((await alerts()).at(-1).options.title,'Agent 需要你确认');
 for(const ws of sockets)ws.terminate();await until(()=>sockets.size===1);await new Promise(resolve=>setTimeout(resolve,200));assert.equal((await alerts()).length,4,'Reconnect does not replay alerts');
 await page.close();await until(()=>sockets.size===1);mention();await until(async()=>(await alerts()).length===5);await duplicate.close();await until(()=>sockets.size===0);
 console.log('PASS real Chrome: panel closed delivery, native API, duplicate tabs, mute, visible Widget, own completion, confirmation, reconnect and tab failover.');
}finally{clearInterval(beat);await browser?.close();for(const ws of sockets)ws.terminate();wss.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
