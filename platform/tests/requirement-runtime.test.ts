import vm from 'node:vm';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import crypto from 'node:crypto';
const dir=mkdtempSync(path.join(os.tmpdir(),'prism-runtime-test-'));
process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='test-password';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig,projectConfig}=await import('../src/services/projects.js');
const {initRuntimeTables,startRuntime,runtimeStatus,redactRuntimeText,runtimeHealthFresh,readRuntimeHealthProgram}=await import('../src/services/requirement-runtime.js');
const {canOpenRuntime}=await import('../src/services/preview-gateway.js');
const {default:routes}=await import('../src/routes/environments.js');
const {signToken}=await import('../src/middleware/auth.js');
(await initProjectTables());(await initRuntimeTables());(await initRuntimeTables());
for(const id of ['editor','viewer','stranger'])(await createUser(id,'test-hash'));
const project=(await createProject('runtime','', 'owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],{
 ...emptyConfig,gitAuth:{mode:'token',sshPort:22,token:'secret-git-token'},
 model:{provider:'claude',baseUrl:'https://example.com',model:'fixture',apiKey:'secret-model-key'}
}));
const id=crypto.randomUUID();
(await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner'));
const app=express();app.use(express.json());app.use('/api/projects/:id/requirements/:requirementId/environment',routes);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${project}/requirements/${id}/environment`;
async function call(user:string,method:string,suffix=''){
 return fetch(base+suffix,{method,headers:{Authorization:`Bearer ${signToken({userId:user,role:'user'})}`}});
}
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));(await getDb().close());rmSync(dir,{recursive:true,force:true});});
test('viewers may preview but cannot see source, logs, start or stop environments',async()=>{
 assert.equal((await canOpenRuntime(id,'viewer','preview')),true);assert.equal((await canOpenRuntime(id,'viewer','ide')),false);
 assert.equal((await canOpenRuntime(id,'editor','ide')),false);assert.equal((await canOpenRuntime(id,'stranger','preview')),false);
 for(const [method,suffix] of [['GET','/logs'],['POST','/start'],['POST','/stop'],['POST','/open-ide']])assert.equal((await call('viewer',method,suffix)).status,403);
 assert.equal((await call('stranger','GET')).status,404);
 const wrong=await fetch(base.replace(project,'unrelated'),{headers:{Authorization:`Bearer ${signToken({userId:'owner',role:'admin'})}`}});assert.equal(wrong.status,404);
});
test('only project administrators may enter IDE, independent of business service status',async()=>{
 for(const status of ['pending','preparing','starting','running','stopped','failed']){
  await getDb().prepare('UPDATE requirements SET environment_status=? WHERE id=?').run(status,id);
  assert.equal(await canOpenRuntime(id,'owner','ide'),true);
  for(const user of ['editor','viewer','stranger'])assert.equal(await canOpenRuntime(id,user,'ide'),false);
  for(const user of ['editor','viewer'])assert.equal((await call(user,'POST','/open-ide')).status,403);
 }
 for(const status of ['merged','closed']){
  await getDb().prepare('UPDATE requirements SET status=? WHERE id=?').run(status,id);
  assert.equal(await canOpenRuntime(id,'owner','ide'),false);
 }
 await getDb().prepare("UPDATE requirements SET status='developing',environment_status='pending' WHERE id=?").run(id);
});
test('incomplete pinned configuration fails visibly without creating a container',async()=>{
 await assert.rejects(startRuntime(id),/未包含仓库/);
 const row=(await getDb().prepare('SELECT environment_status FROM requirements WHERE id=?').get(id)) as {environment_status:string};assert.equal(row.environment_status,'failed');
 const result=(await getDb().prepare('SELECT error,container_id FROM requirement_environments WHERE requirement_id=?').get(id)) as {error:string;container_id:null};assert.match(result.error,/未包含仓库/);assert.equal(result.container_id,null);
});
test('runtime output removes pinned model and Git credentials',async ()=>{
 assert.equal((await redactRuntimeText(id,'secret-git-token secret-model-key')), '[REDACTED] [REDACTED]');
});

test('project configuration is overwritten and is independent of environment creation',async ()=>{
 const updated={...(await projectConfig(project)),startupScript:'pnpm dev'};
 (await getDb().prepare('UPDATE project_configs SET config=? WHERE project_id=?').run(JSON.stringify(updated),project));
 assert.equal((await projectConfig(project)).startupScript,'pnpm dev');
 (await getDb().prepare('UPDATE requirement_environments SET container_id=? WHERE requirement_id=?').run('provisioned-fixture',id));
 (await getDb().prepare('UPDATE project_configs SET config=? WHERE project_id=?').run(JSON.stringify({...updated,startupScript:'new command'}),project));
 assert.equal((await projectConfig(project)).startupScript,'new command');
 assert.equal(((await getDb().prepare('SELECT count(*) AS n FROM project_configs WHERE project_id=?').get(project)) as {n:number}).n,1);
});

test('health freshness uses the container clock for host/VM skew in both directions',()=>{
 for(const offset of [-245000,245000]){
  const observedAt=Date.now()+offset,health={checkedAt:observedAt-2000,observedAt};
  assert.equal(runtimeHealthFresh(health),true);
  assert.equal(runtimeHealthFresh({...health,checkedAt:observedAt-15000}),false);
  assert.equal(runtimeHealthFresh({...health,checkedAt:observedAt+1000}),false);
 }
 assert.equal(runtimeHealthFresh({}),false);assert.equal(runtimeHealthFresh({checkedAt:Date.now()}),false);
});
test('container health reader samples its own clock while preserving old or missing heartbeats',()=>{
 const now=500000;let output='';
 const read=(value:string|Error)=>{
  vm.runInNewContext(readRuntimeHealthProgram,{require:()=>({readFileSync(){if(value instanceof Error)throw value;return value;}}),Date:{now:()=>now},process:{stdout:{write(value:string){output=value;}}}});
  return JSON.parse(output);
 };
 const healthy=read(JSON.stringify({checkedAt:now-2000,status:'running',agentReady:true}));
 assert.equal(healthy.observedAt,now);assert.equal(healthy.status,'running');assert.equal(runtimeHealthFresh(healthy),true);
 assert.equal(runtimeHealthFresh(read(JSON.stringify({checkedAt:now-20000,status:'running'}))),false);
 for(const missing of [Error('ENOENT'),'invalid JSON']){const health=read(missing);assert.equal(health.observedAt,now);assert.equal(health.checkedAt,undefined);assert.equal(runtimeHealthFresh(health),false);}
});
