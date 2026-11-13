import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-browser-e2e-'));
process.env.PRISM_DATA_DIR=root;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb}=await import('../src/services/db.ts');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.ts');
const {initConversationTables,conversations,createConversationService,readConversation}=await import('../src/services/conversations.ts');
const {platformBrowser}=await import('../src/services/platform-browser.ts');
const {handlePreviewClient}=await import('../src/services/preview-client.ts');
const {acceptConversationSocket}=await import('../src/services/conversation-socket.ts');
const {TestRunStore}=await import('../../packages/agent/src/testing/test-run-store.ts');
const {normalizeBrowserEvidence}=await import('../../packages/agent/src/testing/evidence.ts');
await initProjectTables();await initConversationTables();
const projectId=await createProject('Browser e2e','','owner',[],emptyConfig),id=crypto.randomUUID(),sessionId=crypto.randomUUID();
await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,projectId,'保存数据验证','','','owner');await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sessionId,id);
let fail=false,fixed=false,cancelTurn,holdResolve,attachedResolve;
const attached=new Promise(resolve=>{attachedResolve=resolve;}),held=new Promise(resolve=>{holdResolve=resolve;});
let gate=true,screenshots=0,saved=0;
const service=createConversationService({async run(_id,input,emit){
 if(process.env.PRISM_BROWSER_DEBUG&&input.browser){const execute=input.browser.execute;input.browser.execute=async command=>{console.log('Browser command',command.action);try{const value=await execute(command);console.log('Browser completed',command.action);return value;}catch(error){console.log('Browser error',command.action,error.message);throw error;}};}
 await emit({type:'bridge.ready',data:{cancelSupported:true}});await emit({type:'bridge.dispatch',data:{}});await emit({type:'run.started',data:{runId:input.runId}});
 const currentMessage=JSON.parse(input.message.split('[本批未读消息]\n').at(-1)).at(-1).text;
 const verification={id:crypto.randomUUID(),goal:'保存数据验证',proposedChecks:['保存后显示结果'],status:'running',failureCategory:'code_defect',fixSuggestion:'修复保存反馈'};
 if(!input.browser?.verifyOnly){const repair=currentMessage.includes('请根据测试结果修复问题');if(repair)fixed=true;if(currentMessage.includes('取消验证'))verification.goal='取消验证';await emit({type:'bridge.result',data:{success:true,message:repair?'已修复，等待复测确认。':verification.goal==='取消验证'?'已提出取消验证的测试方案。':'保存功能已完成，等待测试确认。',verification:{...verification,status:'awaiting_confirmation'}}});return;}
 const store=new TestRunStore({timeoutMs:30000,onChange:value=>{void emit({type:'test-run.updated',data:value});}}),run=store.create({verificationId:verification.id,clientId:input.clientId,agentRunId:input.runId,proposedChecks:verification.proposedChecks});
 store.registerCleanup(run.id,{id:'browser',label:'detach',cleanup:async()=>{await input.browser.execute({action:'detach'});}});
 store.markRunning(run.id);await emit({type:'verification.updated',data:verification});
 try{
  await input.browser.execute({action:'attach'});attachedResolve();if(gate){gate=false;await held;}
  if(currentMessage.includes('取消验证')){
   const waiting=input.browser.execute({action:'wait',condition:{kind:'text',value:'NEVER_APPEARS',timeoutMs:10000}});
   await new Promise(resolve=>setTimeout(resolve,100));cancelTurn=()=>store.finish(run.id,'cancelled');await waiting;
  }
  await input.browser.execute({action:'navigate',url:'/second'});
  await input.browser.execute({action:'fill',target:{label:'名称'},value:'verified'});await input.browser.execute({action:'click',target:{role:'button',name:'保存'}});await input.browser.execute({action:'wait',condition:{kind:'text',value:'保存成功'}});
  const screenshot=await input.browser.execute({action:'screenshot'});assert.ok(screenshot.data);screenshots++;
  const captured=await input.browser.execute({action:'evidence'});const request=captured.network.find(item=>item.url.endsWith('/api/save'));
  assert.ok(request.requestHandle);const response=await input.browser.execute({action:'responseBody',responseRequestId:request.requestHandle});assert.equal(response.preview.saved,true);
  const evidence=store.recordEvidence(verification.id,normalizeBrowserEvidence(captured));
  const status=fail&&!fixed?'failed':'passed';store.updateCase(verification.id,'case-1',{status,evidenceSummary:'观察到保存成功并捕获网络响应',failureReason:status==='failed'?'演示失败反馈':undefined,evidenceIds:evidence.map(item=>item.id)});store.validateCompletion(verification.id,status);await store.finish(run.id,status);
  await emit({type:'bridge.result',data:{success:true,message:status==='passed'?'已通过实际页面保存验证。':'发现保存反馈问题。',verification:{...verification,status}}});
 }catch(error){if(!currentMessage.includes('取消验证'))console.log('Browser fixture failed:',error.message);await store.finish(run.id,'cancelled');await emit({type:'bridge.result',data:{success:false,cancelled:true,message:'测试已取消',verification:{...verification,status:'cancelled'}}});}
},async cancel(){await cancelTurn?.();}});
const original=conversations.submit;conversations.submit=service.submit;
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/__prism_platform__/')){await handlePreviewClient(req,res,id,'owner');return;}
 if(req.url==='/api/save'){saved++;res.writeHead(201,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"saved":true}');return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="prism-platform" content="1"><label>名称<input aria-label="名称"></label><button onclick="fetch(\'/api/save\').then(response=>response.json()).then(()=>document.getElementById(\'result\').textContent=\'保存成功\')">保存</button><div id="result"></div>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
server.on('upgrade',(req,socket,head)=>{void acceptConversationSocket(req,socket,head,{sessionId,read:(after,eventAfter)=>readConversation(id,after,eventAfter).then(value=>({...value,restricted:false}))});});
const require=createRequire(new URL('../../packages/agent/package.json',import.meta.url)),{chromium}=require('playwright');let browser;
try{
 const dist=fileURLToPath(new URL('../../packages/chrome-ext/dist/',import.meta.url));
 browser=await chromium.launchPersistentContext('',{headless:true,channel:'chromium',args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],viewport:{width:500,height:900}});
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'),extensionId=new URL(worker.url()).host;
 const preview=await browser.newPage();preview.on('response',async response=>{if(response.status()>=400){const text=await response.text().catch(()=>'');if(text)console.log('Preview request failed',new URL(response.url()).pathname,text);}});await preview.goto(base);
 const tabId=await worker.evaluate(async base=>(await chrome.tabs.query({})).find(tab=>tab.url?.startsWith(base)).id,base);
 const panel=await browser.newPage(),errors=[];panel.on('pageerror',error=>errors.push(error.message));
 await panel.addInitScript(tabId=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async options=>options.active?(await query({})).filter(tab=>tab.id===tabId):query(options);},tabId);
 await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);await panel.getByRole('button',{name:'发送',exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'自动测试',exact:true}).count(),0);
 assert.equal(await panel.getByRole('button',{name:'测试',exact:true}).count(),0);
 await panel.locator('textarea').fill('实现保存功能');await panel.getByRole('button',{name:'发送',exact:true}).click();await panel.getByText('保存功能已完成，等待测试确认。',{exact:true}).waitFor();assert.equal(saved,0);assert.equal(screenshots,0);
 await panel.getByRole('button',{name:'测试',exact:true}).last().click();await panel.getByText('是否开始测试？',{exact:true}).waitFor();await panel.getByText('保存后显示结果',{exact:true}).waitFor();assert.equal(saved,0);await panel.getByRole('button',{name:'开始',exact:true}).click();await attached;
 const other=await browser.newPage();await other.goto(base+'/other');await other.bringToFront();holdResolve();
 await panel.getByText('已通过实际页面保存验证。',{exact:true}).waitFor();await panel.getByRole('button',{name:'测试结果',exact:true}).last().click();await panel.getByText('测试通过',{exact:true}).waitFor();assert.equal(await preview.getByLabel('名称').inputValue(),'verified');assert.equal(await other.getByLabel('名称').inputValue(),'');assert.equal(saved,1);assert.equal(screenshots,1);
 await panel.reload();await panel.getByRole('button',{name:'测试结果',exact:true}).last().click();await panel.getByText('测试通过',{exact:true}).waitFor();await panel.getByText('查看运行证据',{exact:false}).click();await panel.getByText('Network',{exact:true}).first().waitFor();
 fail=true;await panel.getByRole('button',{name:'重新测试',exact:true}).first().click();await panel.getByText('发现保存反馈问题。',{exact:true}).waitFor();await panel.getByRole('button',{name:'测试结果',exact:true}).last().click();await panel.getByText('测试未通过',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'修改',exact:true}).first().click();await panel.getByText('是否允许修改代码？',{exact:true}).waitFor();await panel.locator('[data-chat-overlay]').getByRole('button',{name:'修改',exact:true}).click();await panel.getByText('已修复，等待复测确认。',{exact:true}).waitFor();assert.equal(fixed,true);
 await panel.getByRole('button',{name:'测试',exact:true}).last().click();await panel.getByRole('button',{name:'开始',exact:true}).click();await panel.getByText('已通过实际页面保存验证。',{exact:true}).nth(1).waitFor();
 await panel.locator('textarea').fill('提出取消验证的测试方案');await panel.getByRole('button',{name:'发送',exact:true}).click();await panel.getByText('已提出取消验证的测试方案。',{exact:true}).waitFor();await panel.getByRole('button',{name:'测试',exact:true}).last().click();await panel.getByRole('button',{name:'开始',exact:true}).click();
 const deadline=Date.now()+5000;while(!cancelTurn){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
 const cancelStarted=Date.now();await service.cancel(id,(await readConversation(id)).active_run.id);await panel.getByText('测试已取消',{exact:true}).waitFor();assert.ok(Date.now()-cancelStarted<3000,'Cancel must detach while a browser wait is in flight');
 assert.deepEqual(errors,[]);console.log('PASS: Agent-proposed in-chat test confirmation without a header entry, no browser execution before consent, real Chrome CDP, fixed target tab, click/fill/wait/screenshot/network, durable results after reload, failed-case repair/retest and cancellation.');
}catch(error){
 const snapshot=await readConversation(id);console.log('Browser test diagnostic',JSON.stringify({runs:snapshot.runs,messages:snapshot.messages.map(message=>({role:message.role,body:message.body}))}));const panel=browser?.pages().find(page=>page.url().startsWith('chrome-extension:'));if(panel)console.log('Panel state',await panel.locator('body').innerText());throw error;
}finally{
 conversations.submit=original;service.close();platformBrowser.close();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await getDb().close();fs.rmSync(root,{recursive:true,force:true});
}
