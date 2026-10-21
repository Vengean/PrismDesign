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
const {initRuntimeTables,startRuntime,runtimeStatus,redactRuntimeText}=await import('../src/services/requirement-runtime.js');
const {canOpenRuntime}=await import('../src/services/preview-gateway.js');
const {default:routes}=await import('../src/routes/environments.js');
const {signToken}=await import('../src/middleware/auth.js');
initProjectTables();initRuntimeTables();initRuntimeTables();
for(const id of ['editor','viewer','stranger'])createUser(id,'test-hash');
const project=createProject('runtime','', 'owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],{
 ...emptyConfig,gitAuth:{mode:'token',sshPort:22,token:'secret-git-token'},
 model:{provider:'claude',baseUrl:'https://example.com',model:'fixture',apiKey:'secret-model-key'}
});
const id=crypto.randomUUID();
getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');
const app=express();app.use(express.json());app.use('/api/projects/:id/requirements/:requirementId/environment',routes);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/projects/${project}/requirements/${id}/environment`;
async function call(user:string,method:string,suffix=''){
 return fetch(base+suffix,{method,headers:{Authorization:`Bearer ${signToken({userId:user,role:'user'})}`}});
}
after(async()=>{await new Promise<void>(r=>server.close(()=>r()));getDb().close();rmSync(dir,{recursive:true,force:true});});
test('viewers may preview but cannot see source, logs, start or stop environments',async()=>{
 assert.equal(canOpenRuntime(id,'viewer','preview'),true);assert.equal(canOpenRuntime(id,'viewer','ide'),false);
 assert.equal(canOpenRuntime(id,'editor','ide'),true);assert.equal(canOpenRuntime(id,'stranger','preview'),false);
 for(const [method,suffix] of [['GET','/logs'],['POST','/start'],['POST','/stop'],['POST','/open-ide']])assert.equal((await call('viewer',method,suffix)).status,403);
 assert.equal((await call('stranger','GET')).status,404);
 const wrong=await fetch(base.replace(project,'unrelated'),{headers:{Authorization:`Bearer ${signToken({userId:'owner',role:'admin'})}`}});assert.equal(wrong.status,404);
});
test('incomplete pinned configuration fails visibly without creating a container',async()=>{
 await assert.rejects(startRuntime(id),/未包含仓库/);
 const row=getDb().prepare('SELECT environment_status FROM requirements WHERE id=?').get(id) as {environment_status:string};assert.equal(row.environment_status,'failed');
 const result=getDb().prepare('SELECT error,container_id FROM requirement_environments WHERE requirement_id=?').get(id) as {error:string;container_id:null};assert.match(result.error,/未包含仓库/);assert.equal(result.container_id,null);
});
test('runtime output removes pinned model and Git credentials',()=>{
 assert.equal(redactRuntimeText(id,'secret-git-token secret-model-key'), '[REDACTED] [REDACTED]');
});

test('project configuration is overwritten and is independent of environment creation',()=>{
 const updated={...projectConfig(project),startupScript:'pnpm dev'};
 getDb().prepare('UPDATE project_configs SET config=? WHERE project_id=?').run(JSON.stringify(updated),project);
 assert.equal(projectConfig(project).startupScript,'pnpm dev');
 getDb().prepare('UPDATE requirement_environments SET container_id=? WHERE requirement_id=?').run('provisioned-fixture',id);
 getDb().prepare('UPDATE project_configs SET config=? WHERE project_id=?').run(JSON.stringify({...updated,startupScript:'new command'}),project);
 assert.equal(projectConfig(project).startupScript,'new command');
 assert.equal((getDb().prepare('SELECT count(*) AS n FROM project_configs WHERE project_id=?').get(project) as {n:number}).n,1);
});
