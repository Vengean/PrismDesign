import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../packages/agent/package.json',import.meta.url));
const {chromium}=require('playwright');
const platformRequire=createRequire(new URL('../package.json',import.meta.url));
const {WebSocketServer,WebSocket}=platformRequire('ws');
const dist=fileURLToPath(new URL('../../packages/chrome-ext/dist/',import.meta.url));
const contextData={protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'Project',title:'History stability',userId:'u',role:'editor'};
const messages=Array.from({length:40},(_,i)=>({id:`m${i}`,seq:i+1,run_id:`r${Math.floor(i/2)}`,role:i%2?'assistant':'user',body:`History ${i}\n\nSaved paragraph.`,user_id:'u'}));
const comments=[
 {element:{tagName:'BUTTON',domPath:'body > main > section.checkout-summary > div.actions > button.primary-action',component:{name:'PrimaryActionButton',sourceFile:'src/components/checkout/CheckoutSummary/PrimaryActionButton.tsx',sourceLine:128,sourceColumn:9},componentChain:'CheckoutPage > CheckoutSummary > ActionGroup > PrimaryActionButton',pagePath:'/checkout/order/preview',id:'submit-order',className:'inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-medium',role:'button',ariaLabel:'提交订单',textContent:'确认提交订单'},comment:'按钮文字与左侧输入框保持垂直居中。\n上下间距统一为 12px，避免说明文字换行后挤压操作区。'},
 {element:{tagName:'P',domPath:'body > main > section.checkout-summary > p.description',pagePath:'/checkout/order/preview',textContent:'提交后将保留当前配置，并进入下一步确认。'},comment:'说明文字与标题左对齐，行距保持一致。'},
];
messages[38].client_context=JSON.stringify({text:'请调整这两处内容的排版。',comments,contextOrder:['comments']});
let activeRun=null,runRows=[];
const sockets=new Map();let reads=0,connections=0,heartbeats=0,contextFailure=false;
const snapshot=after=>({session_id:'s',restricted:false,messages:messages.filter(m=>m.seq>after),current_messages:[...messages.slice(-2),...messages.filter(m=>m.role==='assistant'&&m.run_id==='collaboration-run')],participants:[{id:'u',name:'u'},{id:'alice',name:'alice'},{id:'bob',name:'bob'}],active_run:activeRun,runs:runRows,events:[],next_message_cursor:messages.at(-1)?.seq||after,next_event_cursor:0,next_live_cursor:''});
const attachedFiles=new Map();let failUpload=true,uploadRequests=0,deletedFiles=0;
const app=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/__prism_platform__/widget.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(readFileSync(new URL('../web/public/prism-widget.js',import.meta.url)));return;}
 res.setHeader('Content-Type','application/json');
 if(url.pathname==='/__prism_platform__/context'){
  if(contextFailure){res.writeHead(401);res.end(JSON.stringify({error:'登录状态已过期'}));return;}
  res.end(JSON.stringify(contextData));return;
 }
 if(url.pathname==='/__prism_platform__/attachments'&&req.method==='POST'){
  uploadRequests++;const name=decodeURIComponent(req.headers['x-attachment-name']);const chunks=[];for await(const chunk of req)chunks.push(chunk);const content=Buffer.concat(chunks);
  if(name==='retry.txt'&&failUpload){failUpload=false;res.writeHead(503);res.end(JSON.stringify({error:'测试上传失败，请重试'}));return;}
  if(name==='cancel.dat')await new Promise(resolve=>setTimeout(resolve,1000));
  const id=crypto.randomUUID(),meta={id,name,mimeType:req.headers['x-attachment-type'],size:content.length,workspacePath:'.prism/attachments/'+id+'/file/'+name};
  attachedFiles.set(id,{meta,content});res.writeHead(201);res.end(JSON.stringify({attachment:meta}));return;
 }
 const match=url.pathname.match(/^\/__prism_platform__\/attachments\/([a-f0-9-]+)$/);
 if(match){
  const file=attachedFiles.get(match[1]);if(!file){res.writeHead(404);res.end(JSON.stringify({error:'附件已清理或不存在'}));return;}
  if(req.method==='DELETE'){attachedFiles.delete(match[1]);deletedFiles++;res.end('{"success":true}');return;}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.meta.name)}`});res.end(file.content);return;
 }
 if(url.pathname==='/__prism_platform__/cancel'&&req.method==='POST'){
  activeRun={...activeRun,status:'cancelling'};runRows=[{...runRows[0],status:'cancelling'}];res.end('{"success":true}');for(const ws of sockets.keys())ws.push();return;
 }
 if(url.pathname==='/__prism_platform__/messages'&&req.method==='POST'){
  let text='';for await(const chunk of req)text+=chunk.toString();const body=JSON.parse(text),run=crypto.randomUUID();
  const meta={...body.clientContext,attachments:(body.attachmentIds||[]).map(id=>attachedFiles.get(id).meta)};
  const postId=crypto.randomUUID();
  messages.push({id:postId,request_id:body.requestId,seq:messages.at(-1).seq+1,run_id:activeRun?null:run,role:'user',body:body.message,client_context:JSON.stringify(meta),user_id:'u'});
  if(activeRun){res.writeHead(202);res.end(JSON.stringify({id:postId,messageId:postId,runId:null}));setTimeout(()=>{for(const ws of sockets.keys())ws.push();},20);return;}
  messages.push({id:crypto.randomUUID(),seq:messages.at(-1).seq+1,run_id:run,role:'assistant',body:'已收到附件。',user_id:'u'});
  res.writeHead(202);res.end(JSON.stringify({id:run}));setTimeout(()=>{for(const ws of sockets.keys())ws.push();},20);return;
 }
 if(url.pathname==='/__prism_platform__/conversation'){
  reads++;assert.equal(url.searchParams.get('wait'),null,'Conversation HTTP requests must never long poll');
  res.end(JSON.stringify(snapshot(Number(url.searchParams.get('after')||0))));return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Set-Cookie','prism_fixture=ok; HttpOnly; SameSite=Lax; Path=/');
 res.end('<!doctype html><html><head><meta name="prism-platform" content="1">'+(url.searchParams.has('widget')?'<script src="/__prism_platform__/widget.js" defer></script>':'')+'</head><body><h1>Preview fixture</h1></body></html>');
});
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${app.address().port}`;
const wss=new WebSocketServer({noServer:true});
app.on('upgrade',(req,socket,head)=>{
 if(req.headers.origin!==base||!req.headers.cookie?.includes('prism_fixture=ok')){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
 const url=new URL(req.url,base);assert.equal(url.pathname,'/__prism_platform__/conversation/live');
 wss.handleUpgrade(req,socket,head,ws=>{
  connections++;sockets.set(ws,Number(url.searchParams.get('after')||0));
  const push=()=>{if(ws.readyState!==WebSocket.OPEN)return;const value=snapshot(sockets.get(ws));ws.send(JSON.stringify({type:'snapshot',value}));sockets.set(ws,value.next_message_cursor);};
  ws.push=push;ws.once('close',()=>sockets.delete(ws));push();
 });
});
const heartbeat=setInterval(()=>{for(const ws of sockets.keys())if(ws.readyState===WebSocket.OPEN){heartbeats++;ws.send(JSON.stringify({type:'heartbeat'}));ws.ping();}},20000);
let browser;
try {
 browser=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],viewport:{width:420,height:800}});
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 const extensionId=new URL(worker.url()).host;
 const preview=await browser.newPage();await preview.goto(base);
 const previewTabId=await worker.evaluate(async base=>(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(base)).id,base);
 const page=await browser.newPage();const errors=[],debugLogs=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',entry=>{if(entry.text().startsWith('[Prism Studio] Connection '))debugLogs.push(Promise.all(entry.args().map(arg=>arg.jsonValue())).then(args=>({type:entry.type(),args})));});
 // A side panel normally targets the active preview tab. In headless Chrome the
 // panel is a regular extension tab, so keep only that tab selection deterministic.
 await page.addInitScript(tabId=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async options=>options.active?(await query({})).filter(tab=>tab.id===tabId):query(options);},previewTabId);
 await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
 await page.locator('[data-message-id="m0"]').waitFor();
 await page.waitForFunction(()=>document.querySelector('[role="status"]')?.textContent?.includes('已连接平台'));
 if(process.argv.includes('--collaboration')){
  const push=()=>{for(const ws of sockets.keys())ws.push();};
  activeRun={id:'collaboration-run',status:'running',user_id:'alice'};runRows=[{...activeRun,title:'调整按钮样式',cancel_supported:1}];
  messages.push({id:'group-task',seq:messages.at(-1).seq+1,run_id:activeRun.id,role:'assistant',body:'正在修改按钮',user_id:null});
  messages.push({id:'group-alice',seq:messages.at(-1).seq+1,run_id:null,role:'user',body:'补充：按钮保持蓝色',user_id:'alice'});push();
  const task=page.locator('[data-message-id="group-task"]');await task.getByRole('button',{name:'取消运行',exact:true}).waitFor();await task.getByText('调整按钮样式',{exact:true}).waitFor();await page.screenshot({path:'/tmp/prism-group-running.png'});
  assert.equal(await page.locator('[data-message-id="group-alice"] .message-author').innerText(),'alice');assert.equal(await page.locator('[data-message-id] img, [data-message-id] time').count(),0);assert.equal(await page.locator('[data-message-id="m38"] .message-author').count(),0);assert.equal(await task.getByRole('button',{name:'取消运行',exact:true}).innerText(),'');const titleSize=await task.locator('.message-task-title').evaluate(el=>getComputedStyle(el).fontSize);assert.equal(titleSize,await page.locator('[data-message-id="group-alice"] .chat-markdown').evaluate(el=>getComputedStyle(el).fontSize));
  const input=page.locator('textarea');await input.fill('运行中继续发消息');const send=page.getByRole('button',{name:/^(发送|Send)$/});assert.equal(await send.isEnabled(),true);await send.click();await page.waitForFunction(()=>!document.querySelector('textarea').value);
  await page.waitForTimeout(100);assert.equal(messages.filter(m=>m.body==='运行中继续发消息').length,1);assert.equal(await page.getByRole('button',{name:'取消运行',exact:true}).count(),1);
  await page.evaluate(()=>{window.taskNode=document.querySelector('[data-message-id="group-task"]');const list=document.querySelector('[data-chat-viewport]>div');list.scrollTop=300;window.groupScroll=list.scrollTop;});await page.waitForTimeout(100);
  const row=messages.find(m=>m.id==='group-task');row.body='已完成修改。\n\n@u 请确认按钮颜色。';row.mentions=JSON.stringify(['u']);activeRun=null;runRows=[{id:'collaboration-run',status:'succeeded',user_id:'alice',cancel_supported:1}];push();
  await task.getByText('已完成修改。',{exact:true}).waitFor();assert.equal(await task.getByRole('button',{name:'取消运行',exact:true}).count(),0);assert.equal(await task.locator('[data-mention-user="u"]').count(),1);
  assert.deepEqual(await page.evaluate(()=>({same:window.taskNode===document.querySelector('[data-message-id="group-task"]'),scroll:document.querySelector('[data-chat-viewport]>div').scrollTop===window.groupScroll})),{same:true,scroll:true});
  const reminder=page.getByRole('button',{name:'有人 @ 了你 · 查看消息'});await reminder.waitFor();
  // Reading by scrolling is enough; no reminder click is required.
  await task.locator('[data-mention-user="u"]').scrollIntoViewIfNeeded();await reminder.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>Number(localStorage.getItem('prism-mention-seen:s:u'))),row.seq);
  push();await page.waitForTimeout(100);assert.equal(await reminder.count(),0);
  await page.screenshot({path:'/tmp/prism-group-completed.png'});
  await page.evaluate(()=>{const list=document.querySelector('[data-chat-viewport]>div');list.scrollTop=list.scrollHeight;});await page.waitForTimeout(100);
  const visibleMention={id:'visible-mention',seq:messages.at(-1).seq+1,run_id:'visible',role:'assistant',body:'@u 已经在可视区域的新消息。',mentions:JSON.stringify(['u']),user_id:null};messages.push(visibleMention);push();
  await page.waitForFunction(seq=>Number(localStorage.getItem('prism-mention-seen:s:u'))===seq,visibleMention.seq);assert.equal(await reminder.count(),0);
  // The next running turn owns its cancellation control; cancelling keeps sending enabled.
  activeRun={id:'collaboration-run',status:'running',user_id:'bob'};runRows=[{...activeRun,title:'调整按钮样式',cancel_supported:1}];row.body='正在执行下一轮';push();await task.getByRole('button',{name:'取消运行',exact:true}).click();await page.waitForTimeout(100);assert.equal(activeRun.status,'cancelling');assert.equal(await task.getByRole('button',{name:'取消运行',exact:true}).count(),0);await input.fill('取消期间也能继续讨论');assert.equal(await send.isEnabled(),true);await input.fill('');
  activeRun=null;runRows=[{id:'collaboration-run',status:'cancelled',user_id:'bob'}];row.body='任务已取消。';push();await task.getByText('任务已取消。',{exact:true}).waitFor();
  const widget=await browser.newPage();await widget.addInitScript(()=>localStorage.setItem('prism-panel-visible','1'));await widget.goto(base+'/?widget=1');const root=widget.locator('#prism-studio-widget');await root.locator('[data-message-id="group-task"]').waitFor();assert.equal(await root.locator('[data-message-id="group-alice"] .message-author').innerText(),'alice');assert.equal(await root.locator('[data-message-id] img, [data-message-id] time').count(),0);
  await root.getByRole('button',{name:'关闭面板',exact:true}).click();
  const hiddenMention={id:'hidden-mention',seq:messages.at(-1).seq+1,run_id:'hidden',role:'assistant',body:'@u 关闭面板时收到的消息。',mentions:JSON.stringify(['u']),user_id:null};messages.push(hiddenMention);push();
  await root.locator('[data-message-id="hidden-mention"]').waitFor({state:'attached'});await widget.waitForTimeout(100);assert.ok(await widget.evaluate(seq=>Number(localStorage.getItem('prism-mention-seen:s:u'))<seq,hiddenMention.seq));
  await root.locator('.prism-fab').click();await widget.waitForFunction(seq=>Number(localStorage.getItem('prism-mention-seen:s:u'))===seq,hiddenMention.seq);
  await widget.reload();await root.locator('[data-message-id="hidden-mention"]').waitFor();assert.equal(await root.getByRole('button',{name:'有人 @ 了你 · 查看消息'}).count(),0);
  contextData.role='viewer';await widget.reload();await widget.waitForTimeout(300);assert.equal(await widget.locator('#prism-studio-widget').count(),0);await page.reload();await page.getByText('当前账号仅可预览页面，群聊仅向编辑成员开放。',{exact:true}).waitFor();assert.equal(await page.locator('textarea').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: real extension and widget nickname-only headers, consistent task font, stop icons, sending during runs, inline cancellation, in-place completion, stable scroll, visibility-based mention read receipts, hidden-panel unread state, reload persistence and viewer exclusion.');
 }else if(process.argv.includes('--attachments')){
  const input=page.locator('input[type="file"]'),popover=page.locator('.attachment-popover');
  const doc=Buffer.from('# 需求文档\n请实现一个保存按钮。'),resource=Buffer.from([0,255,1,2,13,10,0]);
  await input.setInputFiles([{name:'需求文档.md',mimeType:'text/markdown',buffer:doc},{name:'logo.png',mimeType:'image/png',buffer:resource}]);
  await page.getByRole('button',{name:'2 个附件',exact:true}).hover();await popover.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role="progressbar"]'));
  assert.equal(attachedFiles.size,2);assert.deepEqual([...attachedFiles.values()].find(file=>file.meta.name==='logo.png').content,resource);
  await page.screenshot({path:'/tmp/prism-attachment-upload.png'});
  await popover.getByTitle('删除附件 logo.png',{exact:true}).click();
  await page.waitForTimeout(100);assert.equal(deletedFiles,1);
  await page.getByRole('button',{name:'1 个附件',exact:true}).hover();
  const send=page.getByRole('button',{name:/^(发送|Send)$/});assert.equal(await send.isEnabled(),true);await send.click();
  await page.waitForFunction(()=>document.body.textContent.includes('已收到附件。'));
  assert.equal(JSON.parse(messages.find(message=>message.role==='user'&&message.body==='').client_context).attachments.length,1);
  await page.getByRole('button',{name:'1 个附件',exact:true}).hover();await popover.waitFor();
  let downloadEvent=page.waitForEvent('download');await popover.getByTitle('下载 需求文档.md',{exact:true}).click();let download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'需求文档.md');assert.deepEqual(readFileSync(await download.path()),doc);
  await page.reload();await page.getByRole('button',{name:'1 个附件',exact:true}).waitFor();
  await page.getByRole('button',{name:'1 个附件',exact:true}).hover();await popover.waitFor();
  downloadEvent=page.waitForEvent('download');await popover.getByTitle('下载 需求文档.md',{exact:true}).click();download=await downloadEvent;assert.deepEqual(readFileSync(await download.path()),doc);
  const docId=[...attachedFiles.keys()][0];attachedFiles.delete(docId);
  await popover.getByTitle('下载 需求文档.md',{exact:true}).click();await popover.getByText('附件已清理或不存在',{exact:true}).waitFor();
  await page.mouse.move(0,0);await page.waitForTimeout(400);
  await input.setInputFiles({name:'retry.txt',mimeType:'text/plain',buffer:Buffer.from('retry upload')});
  await page.getByRole('button',{name:'1 个附件',exact:true}).last().hover();await popover.getByTitle('重试上传 retry.txt',{exact:true}).waitFor();
  await popover.getByTitle('重试上传 retry.txt',{exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role="progressbar"]'));
  assert.ok([...attachedFiles.values()].some(file=>file.meta.name==='retry.txt'));
  await popover.getByTitle('删除附件 retry.txt',{exact:true}).click();await page.mouse.move(0,0);await page.waitForTimeout(400);
  await input.setInputFiles({name:'cancel.dat',mimeType:'application/octet-stream',buffer:Buffer.alloc(1024)});
  await page.getByRole('button',{name:'1 个附件',exact:true}).last().hover();await popover.getByTitle('删除附件 cancel.dat',{exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'1 个附件',exact:true}).count(),1);
  const requests=uploadRequests;await input.setInputFiles({name:'too-large.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(5*1024*1024+1)});
  await page.getByRole('alert').filter({hasText:'不超过 5 MB'}).waitFor();assert.equal(uploadRequests,requests);
  assert.deepEqual(errors,[]);console.log('PASS: real extension binary upload, attachment-only send, removal, retry, cancellation, limits, history reload, download and cleaned-file errors.');
  await page.close();
  const widget=await browser.newPage();await widget.addInitScript(()=>localStorage.setItem('prism-panel-visible','1'));await widget.goto(base+'/?widget=1');
  const root=widget.locator('#prism-studio-widget');await root.locator('textarea').waitFor();
  await widget.waitForFunction(()=>!document.querySelector('#prism-studio-widget').shadowRoot.querySelector('textarea').disabled);
  await root.locator('input[type="file"]').setInputFiles({name:'widget-resource.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')});
  await widget.waitForTimeout(200);await widget.screenshot({path:'/tmp/prism-widget-upload.png'});
  await root.getByRole('button',{name:'1 个附件',exact:true}).last().hover();
  await widget.waitForFunction(()=>!document.querySelector('#prism-studio-widget').shadowRoot.querySelector('[role="progressbar"]'));
  await root.locator('textarea').fill('根据 Widget 附件调整资源');await root.getByRole('button',{name:/^(发送|Send)$/}).click();
  await widget.waitForFunction(()=>{const shadow=document.querySelector('#prism-studio-widget').shadowRoot;return !shadow.querySelector('textarea').value&&shadow.textContent.includes('根据 Widget 附件调整资源');});
  await root.getByRole('button',{name:'1 个附件',exact:true}).last().hover();
  const widgetDownload=widget.waitForEvent('download');await root.locator('.attachment-popover').getByTitle('下载 widget-resource.svg',{exact:true}).click();
  assert.equal((await widgetDownload).suggestedFilename(),'widget-resource.svg');console.log('PASS: embedded widget upload, send and authenticated download.');

 }else{
 if(process.argv.includes('--comments')){
  const tag=page.getByRole('button',{name:'2 条评论',exact:true});await tag.hover();
  const popover=page.locator('.comment-popover');await popover.waitFor();
  await page.screenshot({path:'/tmp/prism-comments-compact.png'});
  const aligned=await popover.locator('.comment-item').evaluateAll(items=>items.map(item=>({title:item.querySelector('.comment-node-title').getBoundingClientRect().x,body:item.querySelector('.comment-body').getBoundingClientRect().x})));
  assert.ok(aligned.every(item=>Math.abs(item.title-item.body)<1));
  await popover.locator('summary').first().click();
  await page.waitForTimeout(450);
  assert.ok(await popover.locator('details').first().getAttribute('open')!==null);
  const columns=await popover.locator('dl').first().evaluate(dl=>Array.from(dl.children).map(el=>({tag:el.tagName,x:el.getBoundingClientRect().x})));
  for(const tagName of ['DT','DD'])assert.ok(new Set(columns.filter(item=>item.tag===tagName).map(item=>item.x)).size===1);
  let bounds=await popover.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=800);
  await page.screenshot({path:'/tmp/prism-comments-details.png'});
  await page.setViewportSize({width:320,height:700});await tag.hover();await page.waitForTimeout(150);
  bounds=await popover.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=320&&bounds.y>=0&&bounds.y+bounds.height<=700);
  assert.equal(await popover.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:'/tmp/prism-comments-narrow.png'});
  await page.locator('textarea').last().focus();await page.mouse.move(0,0);await page.waitForTimeout(400);await page.setViewportSize({width:420,height:800});
  await page.getByTitle('评论元素',{exact:true}).click();await preview.locator('h1').click();
  const draftTag=page.getByRole('button',{name:'1 条评论',exact:true});await draftTag.hover();await popover.waitFor();
  await popover.getByTitle('编辑评论',{exact:true}).click();
  await popover.getByRole('textbox',{name:'编辑第 1 条评论'}).fill('标题和正文统一左对齐，操作按钮保持在右侧。');
  await popover.getByRole('textbox',{name:'编辑第 1 条评论'}).press('Control+Enter');
  assert.match(await popover.locator('.comment-body').innerText(),/统一左对齐/);
  await page.screenshot({path:'/tmp/prism-comments-editable.png'});
  await popover.getByTitle('删除评论',{exact:true}).click();assert.equal(await draftTag.count(),0);
  console.log('PASS: compact and expanded comments align; narrow layout stays within bounds; editing and removal work.');
 }
 const before=await page.evaluate(async()=>{
  const list=document.querySelector('[data-chat-viewport] > div');list.scrollTop=400;await new Promise(requestAnimationFrame);
  window.historyNode=document.querySelector('[data-message-id="m0"]');window.historyChanges=0;
  new MutationObserver(records=>window.historyChanges+=records.length).observe(window.historyNode,{subtree:true,childList:true,characterData:true,attributes:true});
  const rect=list.getBoundingClientRect();return {y:rect.y,height:rect.height,scroll:list.scrollTop};
 });
 const geometry=()=>page.evaluate(()=>{const list=document.querySelector('[data-chat-viewport] > div'),rect=list.getBoundingClientRect();return {y:rect.y,height:rect.height,scroll:list.scrollTop};});
 assert.equal(connections,1);assert.equal(reads,1);
 // Miss a message while disconnected, then verify HTTP cursor catch-up and a
 // fresh WebSocket subscription without replacing any existing history nodes.
 for(const ws of sockets.keys())ws.terminate();
 messages.push({id:'m40',seq:41,run_id:'new',role:'assistant',body:'Message during disconnect',user_id:'u'});
 await page.locator('[data-message-id="m40"]').waitFor();
 const deadline=Date.now()+10000;while(connections<2){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(reads,2);assert.deepEqual(await geometry(),before);
 assert.deepEqual(await page.evaluate(()=>({same:window.historyNode===document.querySelector('[data-message-id="m0"]'),mutations:window.historyChanges})),{same:true,mutations:0});
 messages.push({id:'m41',seq:42,run_id:'new',role:'assistant',body:'Live pushed message',user_id:'u'});for(const ws of sockets.keys())ws.push();
 await page.locator('[data-message-id="m41"]').waitFor();assert.equal(reads,2);
 assert.equal(await page.getByRole('button',{name:'查看连接记录'}).count(),0);
 assert.equal(await page.getByRole('dialog',{name:'连接记录'}).count(),0);
 const logs=await Promise.all(debugLogs);
 const failure=logs.find(entry=>entry.args[0]==='[Prism Studio] Connection failed'),recovered=logs.find(entry=>entry.args[0]==='[Prism Studio] Connection restored');
 assert.equal(failure?.type,'warning');assert.equal(failure.args[1].source,'realtime');assert.match(failure.args[1].message,/WebSocket/);assert.equal(typeof failure.args[1].durationMs,'number');
 assert.equal(recovered?.type,'info');assert.match(recovered.args[1].previousError,/WebSocket/);assert.equal(typeof recovered.args[1].recoveryMs,'number');
 assert.deepEqual(await geometry(),before);
 const idleMs=Number(process.env.PRISM_HISTORY_IDLE_MS||(process.argv.includes('--quick')?2000:65000));
 console.log(`Checking real Chrome extension heartbeat for ${idleMs/1000}s; reads=${reads}, sockets=${connections}`);
 for(let elapsed=0;elapsed<idleMs;elapsed+=10000){await page.waitForTimeout(Math.min(10000,idleMs-elapsed));assert.equal(reads,2,'Unexpected periodic HTTP conversation read');assert.equal(connections,2,'Healthy WebSocket unexpectedly reconnected');assert.equal(await page.getByText('连接中断 · 重试',{exact:true}).count(),0);console.log(`Heartbeat stable: ${Math.min(elapsed+10000,idleMs)/1000}s`);}
 assert.ok(idleMs<40000||heartbeats>=2);assert.deepEqual(await geometry(),before);
 contextFailure=true;await page.getByText('连接中断 · 重试',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-message-id="m0"]').count(),1);assert.equal(await page.locator('textarea').isDisabled(),true);assert.deepEqual(await geometry(),before);
 assert.deepEqual(errors,[]);
 // The embedded widget uses the same stream controller directly, without the
 // extension port. Exercise its built artifact as a second real browser entry.
 contextFailure=false;await page.close();
 const socketDeadline=Date.now()+5000;while(sockets.size){assert.ok(Date.now()<socketDeadline,'Panel socket was not cleaned up');await new Promise(resolve=>setTimeout(resolve,10));}
 const widget=await browser.newPage();await widget.goto(base+'/?widget=1');
 const history=widget.locator('#prism-studio-widget').locator('[data-message-id="m0"]');await history.waitFor({state:'attached'});
 const expectedReads=reads,expectedConnections=connections;
 messages.push({id:'m42',seq:43,run_id:'new',role:'assistant',body:'Widget pushed message',user_id:'u'});for(const ws of sockets.keys())ws.push();
 await widget.locator('#prism-studio-widget').locator('[data-message-id="m42"]').waitFor({state:'attached'});
 assert.equal(reads,expectedReads);assert.equal(connections,expectedConnections);
 console.log('PASS: embedded widget receives WebSocket updates without polling.');

 console.log('PASS: real extension tab port, cookie-authenticated WebSocket, HTTP history catch-up, push, heartbeat, DevTools console diagnostics and stable history DOM.');
 }
} finally {
 clearInterval(heartbeat);await browser?.close();for(const ws of sockets.keys())ws.terminate();wss.close();app.closeAllConnections();await new Promise(resolve=>app.close(resolve));
}
