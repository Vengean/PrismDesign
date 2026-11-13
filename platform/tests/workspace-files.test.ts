import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-files-test-'));
process.env.PRISM_DATA_DIR=path.join(root,'db');process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initRuntimeTables}=await import('../src/services/requirement-runtime.js');
const {workspaceFiles,createWorkspaceFiles,workspaceFileProgram,MAX_WORKSPACE_FILE_SIZE}=await import('../src/services/workspace-files.js');
const {AttachmentError,runWorkspaceProgram}=await import('../src/services/workspace-attachments.js');
const {workspaceFilePath}=await import('../../packages/ui/src/studio/workspace-file-path.js');
await initProjectTables();await initRuntimeTables();await createUser('editor','fixture');await createUser('viewer','fixture');await createUser('other','fixture');
const project=await createProject('Files','','owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],emptyConfig),id=crypto.randomUUID(),sid=crypto.randomUUID(),directory=path.join(root,'workspace');
await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Files','','','owner');
await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sid,id);
fs.mkdirSync(path.join(directory,'reports'),{recursive:true});fs.mkdirSync(path.join(directory,'.git'));fs.mkdirSync(path.join(directory,'node_modules'));fs.mkdirSync(path.join(directory,'.prism'));
const bytes=Buffer.from([0,255,13,10,128,0,42]);fs.writeFileSync(path.join(directory,'reports','结果.bin'),bytes);fs.writeFileSync(path.join(directory,'reports','empty.txt'),'');
let operations=0;
const run=async(_id:string,input:Record<string,unknown>)=>{
 operations++;const payload=path.join(root,'payload.bin');const result=spawnSync(process.execPath,['-e',workspaceFileProgram,JSON.stringify({...input,root:directory,payload})],{encoding:'utf8'});
 if(result.status)throw new AttachmentError(JSON.parse(result.stderr).error,404);
 return {value:JSON.parse(result.stdout),...(input.action==='download'?{content:fs.readFileSync(payload)}:{})};
};
const files=createWorkspaceFiles(run);
after(async()=>{await getDb().close();fs.rmSync(root,{recursive:true,force:true});});

test('generated workspace files are browsable and download preserves binary and empty files while stopped',async()=>{
 const listing=await files.list(id,'editor','') as any;assert.deepEqual(listing.items.map((item:any)=>item.name),['reports']);
 const nested=await files.list(id,'owner','reports') as any;assert.equal(nested.items.length,2);
 assert.deepEqual((await files.download(id,'editor','reports/结果.bin')).content,bytes);
 assert.equal((await files.download(id,'owner','reports/empty.txt')).content.length,0);
 await getDb().prepare("UPDATE requirements SET status='merged',environment_status='stopped' WHERE id=?").run(id);
 assert.deepEqual((await files.download(id,'editor','reports/结果.bin')).content,bytes);
 await getDb().prepare("UPDATE requirements SET status='developing' WHERE id=?").run(id);
});
test('file reads reject viewer/non-member access, traversal, symlinks, missing files and oversize files',async()=>{
 const before=operations;for(const user of ['viewer','other'])await assert.rejects(()=>files.download(id,user,'reports/结果.bin'),/编辑成员/);assert.equal(operations,before);
 for(const input of ['../outside','/etc/passwd','reports/../../secret','.git/config','.prism/key','reports\\secret',[],null])await assert.rejects(()=>files.download(id,'owner',input),/路径无效/);
 fs.symlinkSync('/etc/passwd',path.join(directory,'link'));fs.symlinkSync(root,path.join(directory,'escape'));
 await assert.rejects(()=>files.download(id,'owner','link'),/符号链接/);await assert.rejects(()=>files.list(id,'owner','escape'),/符号链接/);
 await assert.rejects(()=>files.download(id,'owner','missing'),/不存在/);
 const large=path.join(directory,'large.bin'),fd=fs.openSync(large,'w');fs.ftruncateSync(fd,MAX_WORKSPACE_FILE_SIZE+1);fs.closeSync(fd);
 await assert.rejects(()=>files.download(id,'owner','large.bin'),/50 MB/);
});
test('Agent workspace links map to safe downloadable paths without enabling other URL schemes',()=>{
 assert.equal(workspaceFilePath('/workspace/reports/%E7%BB%93%E6%9E%9C.bin'),'reports/结果.bin');assert.equal(workspaceFilePath('sandbox:/workspace/reports/x.zip'),'reports/x.zip');
 for(const input of ['javascript:alert(1)','https://example.test/x','/workspace/../secret','/workspace/%2e%2e/x','/workspace/.git/config'])assert.equal(workspaceFilePath(input),undefined);
});
test('platform and preview file routes enforce project/session ownership and return binary downloads',async()=>{
 const express=(await import('express')).default,http=await import('node:http');
 const routes=(await import('../src/routes/environments.js')).default,{handlePreviewClient}=await import('../src/services/preview-client.js'),{signToken}=await import('../src/middleware/auth.js');
 const original={...workspaceFiles};Object.assign(workspaceFiles,files);
 const app=express();app.use('/api/projects/:id/requirements/:requirementId/environment',routes);
 const server=http.createServer((req,res)=>{if(req.url?.startsWith('/__prism_platform__/'))void handlePreviewClient(req,res,id,req.headers['x-test-user'] as string||'owner');else app(req,res);});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`,prefix=`/api/projects/${project}/requirements/${id}/environment/files`,headers=(user:string)=>({Authorization:'Bearer '+signToken({userId:user,role:'user'})});
 try{
  assert.equal((await fetch(base+prefix,{headers:headers('editor')})).status,200);
  const downloaded=await fetch(base+prefix+'/download?path='+encodeURIComponent('reports/结果.bin'),{headers:headers('editor')});assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);assert.match(downloaded.headers.get('content-disposition')!,/attachment/);
  assert.equal((await fetch(base+prefix,{headers:headers('viewer')})).status,403);assert.equal((await fetch(base+prefix.replace(project,'wrong'),{headers:headers('owner')})).status,404);
  const preview='/__prism_platform__/files/download?sessionId='+sid+'&path='+encodeURIComponent('reports/结果.bin');
  assert.deepEqual(Buffer.from(await (await fetch(base+preview)).arrayBuffer()),bytes);
  assert.equal((await fetch(base+preview.replace(sid,'wrong'))).status,409);assert.equal((await fetch(base+preview,{headers:{'x-test-user':'viewer'}})).status,403);
 }finally{Object.assign(workspaceFiles,original);await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('real volume files download without a running requirement container',{skip:process.env.PRISM_TEST_FILES!=='1',timeout:60000},async()=>{
 const {containerEngine}=await import('../src/services/requirement-runtime.js'),{runtimeResourceNames}=await import('../src/services/runtime-identity.js');const engine=containerEngine(),name=runtimeResourceNames(id).volume;await engine.createVolume({Name:name});
 try{
  await runWorkspaceProgram(id,{action:'upload'},undefined,"const fs=require('fs');fs.mkdirSync('/workspace/output',{recursive:true});fs.writeFileSync('/workspace/output/result.txt','generated file');process.stdout.write('{}');");
  const listing=await workspaceFiles.list(id,'editor','output') as any;assert.equal(listing.items[0].name,'result.txt');
  assert.equal((await workspaceFiles.download(id,'editor','output/result.txt')).content.toString(),'generated file');
 }finally{await engine.getVolume(name).remove();}
});
