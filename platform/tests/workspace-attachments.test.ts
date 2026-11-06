import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir=mkdtempSync(path.join(os.tmpdir(),'prism-attachments-test-'));
process.env.PRISM_DATA_DIR=path.join(dir,'db');process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {attachmentFileProgram,attachmentArchive,readAttachmentArchive,createWorkspaceAttachments,AttachmentError,MAX_ATTACHMENT_SIZE,runAttachmentHelper}=await import('../src/services/workspace-attachments.js');
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initConversationTables,createConversationService,readConversation,messageContext}=await import('../src/services/conversations.js');
initProjectTables();initConversationTables();for(const user of ['editor','viewer','other'])createUser(user,'unused');
const project=createProject('Files','','owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],emptyConfig);
function demand(){const id=crypto.randomUUID(),sessionId=crypto.randomUUID();getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Files','','','owner');getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sessionId,id);return {id,sessionId};}
const roots=new Map<string,string>();let operations=0;
const localRun=async(id:string,input:Record<string,unknown>,content?:Buffer)=>{
 operations++;let root=roots.get(id);if(!root){root=mkdtempSync(path.join(dir,'workspace-'));roots.set(id,root);}
 const payload=path.join(dir,crypto.randomUUID()+'.bin');if(content)writeFileSync(payload,content);
 try{const result=spawnSync(process.execPath,['-e',attachmentFileProgram,JSON.stringify({...input,root,payload})],{encoding:'utf8'});if(result.status)throw new AttachmentError(JSON.parse(result.stderr).error,404);return {value:JSON.parse(result.stdout),...(input.action==='download'?{content:readFileSync(payload)}:{})};}finally{rmSync(payload,{force:true});}
};
const files=createWorkspaceAttachments(localRun);
after(()=>{getDb().close();rmSync(dir,{recursive:true,force:true});});

test('workspace stores original binary files and manifests; authorized download returns identical bytes',async()=>{
 const {id}=demand(),bytes=Buffer.from([0,255,128,13,10,0,42]);
 const file=await files.upload(id,'owner','资源.png','image/png',bytes);
 assert.equal(file.size,bytes.length);assert.match(file.workspacePath,/^\.prism\/attachments\//);
 assert.deepEqual(readFileSync(path.join(roots.get(id)!,file.workspacePath)),bytes);
 assert.deepEqual((await files.download(id,'owner',file.id)).content,bytes);
 await files.remove(id,'owner',file.id);await assert.rejects(files.download(id,'owner',file.id),/清理|不存在/);
});

test('attachments bind to messages, appear in Agent file context and follow-up context, and replay after cleanup',async()=>{
 const {id}=demand(),file=await files.upload(id,'owner','需求说明.md','text/markdown',Buffer.from('# 需求\n新增一个保存按钮'));
 const prompts:string[]=[];const service=createConversationService({async run(_id,input,emit){prompts.push(input.message);emit({type:'bridge.result',data:{success:true,message:'done'}});},async cancel(){}});
 const prepared=await files.resolve(id,'owner',[file.id]);
 const context={text:'',comments:[],contextOrder:['attachments']};
 const run=service.submit(id,'owner','','attachments-0001',context,prepared);await service.wait(run.id);
 const stored=(readConversation(id).messages as any[]).find(message=>message.role==='user');
 assert.equal(JSON.parse(stored.client_context).attachments[0].name,'需求说明.md');assert.ok(prompts[0].includes('/workspace/'+file.workspacePath));
 assert.ok(prompts[0].includes('保留附件原件'));
 const next=service.submit(id,'owner','把刚才附件中的按钮改为蓝色','attachments-0002');await service.wait(next.id);assert.ok(prompts[1].includes(file.workspacePath));
 await assert.rejects(files.remove(id,'owner',file.id),/不能单独删除/);
 assert.deepEqual((await files.download(id,'editor',file.id)).content,Buffer.from('# 需求\n新增一个保存按钮'));
 rmSync(roots.get(id)!,{recursive:true,force:true});
 assert.equal(service.submit(id,'owner','','attachments-0001',context,await files.resolve(id,'owner',[file.id],'attachments-0001')).replayed,true);
 await assert.rejects(files.download(id,'owner',file.id),/清理|不存在/);
});

test('draft ownership, viewer permissions and cross-requirement identifiers are enforced',async()=>{
 const a=demand(),b=demand(),file=await files.upload(a.id,'owner','draft.txt','text/plain',Buffer.from('draft'));
 const before=operations;await assert.rejects(files.download(a.id,'viewer',file.id),/编辑成员/);await assert.rejects(files.upload(a.id,'other','x','',Buffer.from('x')),/编辑成员/);assert.equal(operations,before);
 await assert.rejects(files.download(a.id,'editor',file.id),/无权访问/);await assert.rejects(files.remove(a.id,'editor',file.id),/其他成员/);
 await assert.rejects(files.resolve(b.id,'owner',[file.id]),/清理|不存在/);
 await assert.rejects(files.resolve(a.id,'owner',['../../secret']),/列表无效/);
 await assert.rejects(files.resolve(a.id,'owner',[file.id,file.id]),/列表无效/);
 assert.ok(!messageContext({text:'x',comments:[],attachments:[{...file,workspacePath:'../../secret'}]}).includes('attachments'));
});

test('same-name uploads stay isolated and file limits and missing/modified files report useful errors',async()=>{
 const {id}=demand();const a=await files.upload(id,'owner','asset.svg','image/svg+xml',Buffer.from('<svg/>')),b=await files.upload(id,'owner','asset.svg','image/svg+xml',Buffer.from('<svg>new</svg>'));
 assert.notEqual(a.workspacePath,b.workspacePath);
 await assert.rejects(files.upload(id,'owner','x','',Buffer.alloc(MAX_ATTACHMENT_SIZE+1)),/5 MB/);
 writeFileSync(path.join(roots.get(id)!,a.workspacePath),Buffer.from('edited'));await assert.rejects(files.download(id,'owner',a.id),/更改|修改/);
 rmSync(path.join(roots.get(id)!,b.workspacePath));symlinkSync('/etc/passwd',path.join(roots.get(id)!,b.workspacePath));await assert.rejects(files.download(id,'owner',b.id),/不可用/);
});

test('Docker archive transfer round-trips unmodified arbitrary binary content',()=>{
 const bytes=crypto.randomBytes(65539);assert.deepEqual(readAttachmentArchive(attachmentArchive(bytes)),bytes);
 assert.throws(()=>readAttachmentArchive(Buffer.alloc(1024)),/读取失败/);
});

test('real Docker volume: upload and download work without a running workspace and files disappear with its volume',{skip:process.env.PRISM_TEST_ATTACHMENTS!=='1',timeout:90000},async()=>{
 const {containerEngine}=await import('../src/services/requirement-runtime.js');
 const engine=containerEngine(),id=crypto.randomUUID(),sessionId=crypto.randomUUID(),volume=`prism-req-code-${id}`;
 await engine.createVolume({Name:volume,Labels:{'prism.attachment-test':'true'}});
 try{
  const bytes=crypto.randomBytes(5*1024*1024),fileId=crypto.randomUUID();
  const uploaded=await runAttachmentHelper(id,{action:'upload',id:fileId,sessionId,userId:'owner',name:'资源.dat',mimeType:'application/octet-stream',createdAt:new Date().toISOString()},bytes);
  const result=await runAttachmentHelper(id,{action:'download',id:fileId,sessionId});assert.deepEqual(result.content,bytes);assert.equal((uploaded.value as any).size,bytes.length);
  await engine.getVolume(volume).remove();await assert.rejects(runAttachmentHelper(id,{action:'download',id:fileId,sessionId}),/清理|尚未创建/);
 }finally{await engine.getVolume(volume).remove().catch(()=>{});}
});

test('HTTP upload, attachment-only send, authorized historical downloads and cleared-file errors work through both entry points',async()=>{
 const express=(await import('express')).default,http=await import('node:http');
 const routes=(await import('../src/routes/conversations.js')).default,{signToken}=await import('../src/middleware/auth.js');
 const {workspaceAttachments}=await import('../src/services/workspace-attachments.js'),{conversations}=await import('../src/services/conversations.js');
 const {handlePreviewClient}=await import('../src/services/preview-client.js');
 const original={...workspaceAttachments},originalSubmit=conversations.submit;
 Object.assign(workspaceAttachments,files);
 let delivered='';const service=createConversationService({async run(_id,input,emit){delivered=input.message;emit({type:'bridge.result',data:{success:true,message:'文件已读取'}});},async cancel(){}});conversations.submit=service.submit;
 const {id,sessionId}=demand(),app=express();app.use(express.json());app.use('/api/projects/:id/requirements/:requirementId/conversation',routes);
 const server=http.createServer((req,res)=>{if(req.url?.startsWith('/__prism_platform__/'))void handlePreviewClient(req,res,id,'owner');else app(req,res);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`,prefix=`/api/projects/${project}/requirements/${id}/conversation`;
 const headers=(user:string)=>({Authorization:`Bearer ${signToken({userId:user,role:'user'})}`});
 try{
  const bytes=Buffer.from([0,255,10,13,2,0,128]);
  const uploaded=await fetch(base+prefix+'/attachments',{method:'POST',headers:{...headers('owner'),'Content-Type':'application/octet-stream','x-attachment-name':encodeURIComponent('需求资源.bin')},body:bytes});assert.equal(uploaded.status,201);
  const file=(await uploaded.json()).attachment;
  assert.equal((await fetch(base+prefix+'/attachments/'+file.id,{headers:headers('viewer')})).status,403);
  const body={message:'',requestId:'http-attachments-0001',attachmentIds:[file.id],clientContext:{text:'',comments:[]}};
  const submitted=await fetch(base+prefix+'/messages',{method:'POST',headers:{...headers('owner'),'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(submitted.status,202);await service.wait((await submitted.json()).id);assert.ok(delivered.includes(file.workspacePath));
  const downloaded=await fetch(base+prefix+'/attachments/'+file.id,{headers:headers('editor')});assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition')!,/filename\*=UTF-8/);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
  const preview=await fetch(base+'/__prism_platform__/attachments/'+file.id+'?sessionId='+sessionId);assert.equal(preview.status,200);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),bytes);
  assert.equal((await fetch(base+'/__prism_platform__/attachments/'+file.id+'?sessionId=wrong')).status,409);
  assert.equal((await fetch(base+prefix+'/attachments/'+file.id,{method:'DELETE',headers:headers('owner')})).status,409);
  rmSync(roots.get(id)!,{recursive:true,force:true});const missing=await fetch(base+prefix+'/attachments/'+file.id,{headers:headers('owner')});assert.equal(missing.status,404);assert.match((await missing.json()).error,/清理|不存在/);
 }finally{Object.assign(workspaceAttachments,original);conversations.submit=originalSubmit;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
