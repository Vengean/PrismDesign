import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-release-test-'));
process.env.PRISM_DATA_DIR=path.join(root,'data');process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {createReleaseWorkflow}=await import('../src/services/release-workflow.js');
const {releaseGitProgram}=await import('../src/services/release-git.js');
const {gitOperationScript}=await import('../src/services/requirement-git.js');
const {startRuntime}=await import('../src/services/requirement-runtime.js');
const {canOpenRuntime}=await import('../src/services/preview-gateway.js');
await initProjectTables();await createUser('editor','fixture');await createUser('viewer','fixture');
function git(cwd:string,...args:string[]){return execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.test','-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function remote(name:string){const url=path.join(root,name+'.git'),work=path.join(root,name+'-seed');fs.mkdirSync(url);git(url,'init','--bare');fs.mkdirSync(work);git(work,'init','-b','main');fs.writeFileSync(path.join(work,'base.txt'),'baseline\n');git(work,'add','.');git(work,'commit','-m','baseline');git(work,'tag','v1');git(work,'remote','add','origin',url);git(work,'push','origin','main','--tags');return {url,work,sha:git(work,'rev-parse','HEAD')};}
const first=remote('app'),second=remote('other');
const project=await createProject('Release fixture','','owner',[{userId:'editor',role:'editor'},{userId:'viewer',role:'viewer'}],{...emptyConfig,gitAuth:{mode:'token',sshPort:22,token:'fixture-only'},repos:[{name:'app',url:first.url,branch:'main'}]});
let pushFailure:boolean|string=false,mergeFailure='',cleanupFailure='',calls:string[]=[],removed:string[]=[];
function run(job:unknown){let output:string;try{output=execFileSync(process.execPath,['-e',releaseGitProgram,JSON.stringify(job)],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(e){output=String((e as any).stdout);}const result=JSON.parse(output.trim().split('\n').at(-1)!);if(!result.success)throw Error(result.error);return result;}
async function local(id:string,repo:string){const directory=path.join(root,id),cwd=path.join(directory,repo);if(!fs.existsSync(cwd)){fs.mkdirSync(directory,{recursive:true});const record=await getDb().prepare('SELECT * FROM requirements WHERE id=?').get(id),source=await getDb().prepare('SELECT * FROM requirement_repositories WHERE requirement_id=? AND repo_name=?').get(id,repo);execFileSync('git',['clone','-b',record.branch_name,source.url,cwd],{stdio:'pipe'});git(cwd,'config','user.name','Fixture');git(cwd,'config','user.email','fixture@example.test');}return {directory,cwd};}
const service=createReleaseWorkflow({removeWorkspace:async id=>{if(cleanupFailure===id)throw Error('fixture cleanup failed');removed.push(id);},git:async(_project,job)=>{calls.push(job.action);if(job.action==='merge'&&job.url===mergeFailure)throw Error('fixture remote unavailable');return run(job);},workspace:async(id,repo,action,releaseBranch)=>{calls.push(action);if(action==='push'&&(pushFailure===true||pushFailure===repo))return {success:false,message:'fixture Push failed'};const {directory}=await local(id,repo),record=await getDb().prepare('SELECT branch_name FROM requirements WHERE id=?').get(id);let output:string;try{output=execFileSync(process.execPath,['-e',gitOperationScript,JSON.stringify({root:directory,repo,branch:record.branch_name,action,releaseBranch})],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(e){output=String((e as any).stdout);}return JSON.parse(output.trim());}});
async function release(projectId=project){const result=await service.createRelease(projectId,'owner',{name:'Release',baseRefs:{app:'v1'}});await service.wait(result.id);assert.equal((await service.detail(result.id,'owner')).branch_status,'ready');return result.id;}
async function demand(releaseId:string,projectId=project){const result=await service.createRequirement(projectId,releaseId,'editor',{title:'Feature'});await service.wait(result.id);const row=await getDb().prepare('SELECT * FROM requirements WHERE id=?').get(result.id);assert.equal(row.branch_status,'ready',row.branch_error);return row;}
async function change(id:string,repo='app',file='feature.txt'){const {cwd}=await local(id,repo);fs.writeFileSync(path.join(cwd,file),id+Math.random());git(cwd,'add','.');git(cwd,'commit','-m','feature');return git(cwd,'rev-parse','HEAD');}
after(async()=>{await getDb().close();fs.rmSync(root,{recursive:true,force:true});});

test('lists remote branches and creates a release from the selected branch without tag ambiguity',async()=>{
 git(first.work,'switch','-c','feature/preview',first.sha);fs.writeFileSync(path.join(first.work,'preview.txt'),'selected branch');git(first.work,'add','.');git(first.work,'commit','-m','preview');const selected=git(first.work,'rev-parse','HEAD');git(first.work,'push','origin','refs/heads/feature/preview');
 git(first.work,'tag','feature/preview',first.sha);git(first.work,'push','origin','refs/tags/feature/preview');
 assert.deepEqual((await service.repositoryBranches(project,'owner','app')).branches,['feature/preview','main']);
 await assert.rejects(()=>service.repositoryBranches(project,'viewer','app'),/编辑/);await assert.rejects(()=>service.repositoryBranches(project,'owner','missing'),/仓库不存在/);
 const created=await service.createRelease(project,'owner',{name:'Selected branch',baseRefs:{app:'refs/heads/feature/preview'}});await service.wait(created.id);const detail=await service.detail(created.id,'owner');assert.equal(detail.branch_status,'ready');assert.equal(detail.repositories[0].base_sha,selected);assert.notEqual(selected,first.sha);
});

test('developers create releases using selected branches without gaining administration',async()=>{
 const branches=await service.repositoryBranches(project,'editor','app');assert.ok(branches.branches.includes('main'));
 const result=await service.createRelease(project,'editor',{name:'Developer release',baseRefs:{app:'refs/heads/main'}});await service.wait(result.id);
 const detail=await service.detail(result.id,'editor');assert.equal(detail.branch_status,'ready');assert.equal(detail.created_by,'editor');
 await assert.rejects(()=>service.createRelease(project,'viewer',{name:'Denied'}),/编辑/);
 await assert.rejects(()=>service.deleteRelease(result.id,'editor'),/管理员/);
});

test('deleting an empty release removes platform records and retains remote code',async()=>{
 const id=await release(),detail=await service.detail(id,'owner');
 await assert.rejects(()=>service.deleteRelease(id,'editor'),/管理员/);
 await assert.rejects(()=>service.deleteRelease(id,'viewer'),/管理员/);
 await getDb().prepare("UPDATE releases SET operation_token='busy' WHERE id=?").run(id);
 await assert.rejects(()=>service.deleteRelease(id,'owner'),/进行中/);
 await getDb().prepare("UPDATE releases SET operation_token=NULL,branch_status='preparing' WHERE id=?").run(id);
 await assert.rejects(()=>service.deleteRelease(id,'owner'),/准备中/);
 await getDb().prepare("UPDATE releases SET branch_status='ready' WHERE id=?").run(id);
 await service.deleteRelease(id,'owner');
 for(const [table,column] of [['releases','id'],['release_repositories','release_id'],['release_events','release_id']])assert.equal((await getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column}=?`).get(id)).n,0);
 assert.equal(run({action:'head',url:first.url,branch:detail.branch_name}).sha,first.sha);
 await assert.rejects(()=>service.detail(id,'owner'),/不存在/);
});

test('cascade deletion checks every workspace, cleans related records, and preserves remote branches',async()=>{
 const {initConversationTables}=await import('../src/services/conversations.js');await initConversationTables();
 const {initRuntimeTables,withGitOperation}=await import('../src/services/requirement-runtime.js');await initRuntimeTables();
 const id=await release(),req=await demand(id),second=await demand(id),detail=await service.detail(id,'owner');
 const sid=(await getDb().prepare('SELECT id FROM project_sessions WHERE requirement_id=?').get(second.id)).id;
 await getDb().prepare("INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,status) VALUES('delete-run',?,?,?,'delete-request','running')").run(second.id,sid,'editor');
 await getDb().prepare("INSERT INTO conversation_messages(id,session_id,run_id,role,body) VALUES('delete-message',?,'delete-run','assistant','history')").run(sid);
 await getDb().prepare("INSERT INTO conversation_events(session_id,run_id,type,data) VALUES(?,'delete-run','run.running','{}')").run(sid);
 await getDb().prepare('INSERT INTO conversation_agent_state(session_id) VALUES(?)').run(sid);
 await getDb().prepare('INSERT INTO requirement_environments(requirement_id,container_id) VALUES(?,?)').run(second.id,'fixture-container');
 await getDb().prepare("INSERT INTO merge_requests(id,requirement_id,release_id,submitted_by,manifest,results) VALUES('delete-merge',?,?,?,'[]','{}')").run(second.id,id,'editor');
 const before=removed.length;
 await assert.rejects(()=>service.deleteRelease(id,'owner'),/Agent/);assert.equal(removed.length,before);
 await getDb().prepare("UPDATE conversation_runs SET status='completed' WHERE id='delete-run'").run();
 await withGitOperation(second.id,async()=>{await assert.rejects(()=>service.deleteRelease(id,'owner'),/操作进行中/);});assert.equal(removed.length,before);
 await getDb().prepare("UPDATE requirements SET branch_status='preparing' WHERE id=?").run(second.id);
 await assert.rejects(()=>service.deleteRelease(id,'owner'),/准备中/);assert.equal(removed.length,before);
 await getDb().prepare("UPDATE requirements SET branch_status='ready',status='merged' WHERE id=?").run(second.id);
 cleanupFailure=second.id;await assert.rejects(()=>service.deleteRelease(id,'owner'),/cleanup failed/);cleanupFailure='';
 assert.equal((await service.detail(id,'owner')).requirements.length,2);
 assert.equal((await getDb().prepare('SELECT operation_token FROM releases WHERE id=?').get(id)).operation_token,null);
 await service.deleteRelease(id,'owner');
 for(const target of [req,second]){assert.ok(removed.includes(target.id));assert.equal((await getDb().prepare('SELECT count(*) AS n FROM requirements WHERE id=?').get(target.id)).n,0);assert.equal(run({action:'head',url:first.url,branch:target.branch_name}).sha,first.sha);}
 for(const table of ['conversation_runs','conversation_messages','conversation_events','conversation_agent_state','project_sessions'])assert.equal((await getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table==='project_sessions'?'id':'session_id'}=?`).get(sid)).n,0);
 for(const table of ['requirement_environments','requirement_repositories'])assert.equal((await getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE requirement_id=?`).get(second.id)).n,0);
 assert.equal((await getDb().prepare("SELECT count(*) AS n FROM merge_requests WHERE id='delete-merge'").get()).n,0);
 assert.equal(run({action:'head',url:first.url,branch:detail.branch_name}).sha,first.sha);
 await assert.rejects(()=>service.detail(id,'owner'),/不存在/);
});

test('administrators can delete individual and legacy requirements',async()=>{
 const id=await release(),req=await demand(id);
 await assert.rejects(()=>service.deleteRequirement(req.id,'editor'),/管理员/);
 await assert.rejects(()=>service.deleteRequirement(req.id,'viewer'),/管理员/);
 await service.deleteRequirement(req.id,'owner');assert.equal((await service.detail(id,'owner')).requirements.length,0);
 assert.ok((await getDb().prepare("SELECT 1 FROM release_events WHERE release_id=? AND type='requirement.deleted'").get(id)));
 const legacy=await demand(id);await getDb().prepare('UPDATE requirements SET release_id=NULL WHERE id=?').run(legacy.id);
 await service.deleteRequirement(legacy.id,'owner');assert.ok(removed.includes(legacy.id));
 await service.deleteRelease(id,'owner');
});

test('workspace destruction uses exact mode-specific resources and is retryable',async()=>{
 const {removeWorkspaceResources}=await import('../src/services/requirement-runtime.js');
 const {runtimeResourceNames}=await import('../src/services/runtime-identity.js');
 const names=runtimeResourceNames('fixture-id'),calls:unknown[]=[];
 const engine={getContainer:(name:string)=>({remove:async(options:unknown)=>{calls.push([name,options]);}}),getVolume:(name:string)=>({remove:async()=>{calls.push([name]);}})};
 await removeWorkspaceResources('fixture-id',engine as any);assert.deepEqual(calls,[[names.container,{force:true}],[names.volume],[`${names.volume}-codex`],[`${names.volume}-claude`]]);
 const missing={getContainer:()=>({remove:async()=>{throw {statusCode:404};}}),getVolume:()=>({remove:async()=>{throw {statusCode:404};}})};
 await removeWorkspaceResources('fixture-id',missing as any);
 let volumeTouched=false;
 const failed={getContainer:()=>({remove:async()=>{throw {statusCode:500};}}),getVolume:()=>({remove:async()=>{volumeTouched=true;}})};
 await assert.rejects(()=>removeWorkspaceResources('fixture-id',failed as any),/清理需求容器失败/);assert.equal(volumeTouched,false);
});

test('release workflow uses real Git refs, manual sync and Push-before-application',async t=>{
 const releaseId=await release();const detail=await service.detail(releaseId,'owner');
 await t.test('records immutable source SHAs and creates requirement from the release HEAD',async()=>{assert.equal(detail.repositories[0].base_sha,first.sha);assert.equal(run({action:'head',url:first.url,branch:detail.branch_name}).sha,first.sha);await assert.rejects(()=>service.createRequirement(project,releaseId,'viewer',{title:'Denied'}));await assert.rejects(()=>service.createRelease(project,'viewer',{name:'Denied'}));const req=await demand(releaseId);assert.equal((await getDb().prepare('SELECT base_sha FROM requirement_repositories WHERE requirement_id=?').get(req.id)).base_sha,first.sha);});
 const req=await demand(releaseId);const sha=await change(req.id);
 await t.test('dirty worktree and failed Push never create an application',async()=>{const {cwd}=await local(req.id,'app');fs.writeFileSync(path.join(cwd,'dirty.txt'),'dirty');calls=[];await assert.rejects(()=>service.requestMerge(req.id,'editor'),/提交/);assert.ok(!calls.includes('push'));fs.unlinkSync(path.join(cwd,'dirty.txt'));pushFailure=true;await assert.rejects(()=>service.requestMerge(req.id,'editor'),/Push failed/);pushFailure=false;assert.equal((await getDb().prepare('SELECT count(*) AS n FROM merge_requests').get()).n,0);});
 let requestId='';
 await t.test('Push succeeds before creating the exact-SHA application; retries are idempotent',async()=>{calls=[];const result=await service.requestMerge(req.id,'editor');requestId=result.id;assert.ok(calls.indexOf('push')<calls.indexOf('contains'));const request=await getDb().prepare('SELECT * FROM merge_requests WHERE id=?').get(requestId);assert.equal(JSON.parse(request.manifest)[0].sha,sha);assert.equal(request.status,'submitted');assert.equal(run({action:'head',url:first.url,branch:req.branch_name}).sha,sha);assert.equal((await service.requestMerge(req.id,'editor')).id,requestId);await assert.rejects(()=>service.approve(requestId,'editor'),/管理员/);});
 await t.test('no-op sync reports the exact release commit and preserves a pending application',async()=>{const result=await service.syncRelease(req.id,'editor');assert.equal(result.changed,false);assert.equal(result.results[0].releaseCommit,first.sha);assert.equal((await getDb().prepare('SELECT status FROM merge_requests WHERE id=?').get(requestId)).status,'submitted');assert.match(result.message,/无需更新/);});
 await t.test('manual sync neither Pushes nor creates an application and invalidates the previous request',async()=>{
 git(first.work,'fetch','origin',detail.branch_name);git(first.work,'switch','-C',detail.branch_name,'FETCH_HEAD');fs.writeFileSync(path.join(first.work,'release-only.txt'),'release update');git(first.work,'add','.');git(first.work,'commit','-m','update release');git(first.work,'push','origin','refs/heads/'+detail.branch_name);
 calls=[];const result=await service.syncRelease(req.id,'editor');assert.equal(result.changed,true);assert.ok(fs.existsSync(path.join((await local(req.id,'app')).cwd,'release-only.txt')));assert.equal(run({action:'head',url:first.url,branch:req.branch_name}).sha,sha);assert.equal((await getDb().prepare('SELECT head_sha FROM requirement_repositories WHERE requirement_id=?').get(req.id)).head_sha,result.results[0].commit);assert.ok(calls.includes('sync-release'));assert.ok(!calls.includes('push'));assert.equal((await getDb().prepare('SELECT status FROM merge_requests WHERE id=?').get(requestId)).status,'stale');assert.equal((await getDb().prepare('SELECT count(*) AS n FROM merge_requests').get()).n,1);});
 await t.test('approval merges only into the fixed release and closes write access',async()=>{requestId=(await service.requestMerge(req.id,'editor')).id;await service.approve(requestId,'owner');assert.equal((await getDb().prepare('SELECT status FROM requirements WHERE id=?').get(req.id)).status,'merged');assert.equal(run({action:'contains',url:first.url,branch:detail.branch_name,sha}).alreadyMerged,true);await assert.rejects(()=>service.requestMerge(req.id,'editor'),/只读/);await assert.rejects(()=>startRuntime(req.id),/只读/);assert.equal(await canOpenRuntime(req.id,'editor','ide'),false);assert.equal(await canOpenRuntime(req.id,'viewer','preview'),true);});
 await t.test('subsequent requirements inherit integrated release changes, never the stale main baseline',async()=>{const next=await demand(releaseId);assert.notEqual((await getDb().prepare('SELECT base_sha FROM requirement_repositories WHERE requirement_id=?').get(next.id)).base_sha,first.sha);const {cwd}=await local(next.id,'app');assert.ok(fs.existsSync(path.join(cwd,'feature.txt')));});
 await t.test('freeze records exact remote SHAs and rejects creation and submission until unfreeze',async()=>{await service.freeze(releaseId,'owner',true);const frozen=await service.detail(releaseId,'owner');assert.equal(JSON.parse(frozen.frozen_manifest).app,run({action:'head',url:first.url,branch:detail.branch_name}).sha);await assert.rejects(()=>service.createRequirement(project,releaseId,'editor',{title:'Frozen'}),/冻结/);const open=await getDb().prepare("SELECT id FROM requirements WHERE release_id=? AND status='developing' LIMIT 1").get(releaseId);await assert.rejects(()=>service.requestMerge(open.id,'editor'),/冻结/);await service.freeze(releaseId,'owner',false);});
 await t.test('remote source updates invalidate approval without merging a newer, unreviewed SHA',async()=>{const next=await demand(releaseId),before=run({action:'head',url:first.url,branch:detail.branch_name}).sha;await change(next.id,'app','other.txt');const application=await service.requestMerge(next.id,'editor');await change(next.id,'app','later.txt');const {cwd}=await local(next.id,'app');git(cwd,'push','origin',next.branch_name);await assert.rejects(()=>service.approve(application.id,'owner'),/重新申请/);assert.equal(run({action:'head',url:first.url,branch:detail.branch_name}).sha,before);});
 await t.test('normal external merge is detected even when its source branch was deleted',async()=>{const next=await demand(releaseId);const submitted=await change(next.id,'app','external.txt'),application=await service.requestMerge(next.id,'editor');const target=run({action:'head',url:first.url,branch:detail.branch_name}).sha;run({action:'merge',url:first.url,branch:detail.branch_name,sourceBranch:next.branch_name,sha:submitted,expectedTarget:target});git(first.work,'push','origin',':'+next.branch_name);await service.refreshRequest(application.id,'editor');const row=await getDb().prepare('SELECT * FROM merge_requests WHERE id=?').get(application.id);assert.equal(row.status,'external');assert.equal(row.approved_by,null);assert.equal((await getDb().prepare('SELECT status FROM requirements WHERE id=?').get(next.id)).status,'merged');});
 await t.test('source branch updates are not mistaken for updates to the release branch',async()=>{
 const req=await demand(releaseId);git(first.work,'fetch','origin','main');git(first.work,'switch','-C','main','FETCH_HEAD');fs.writeFileSync(path.join(first.work,'source-only.txt'),'source update');git(first.work,'add','.');git(first.work,'commit','-m','source only');git(first.work,'push','origin','refs/heads/main');
 const result=await service.syncRelease(req.id,'editor');assert.equal(result.changed,false);assert.notEqual(result.results[0].releaseCommit,git(first.work,'rev-parse','HEAD'));assert.ok(!fs.existsSync(path.join((await local(req.id,'app')).cwd,'source-only.txt')));
 });
 await t.test('unhandled group messages prevent closing or applying an incomplete requirement',async()=>{
  const {initConversationTables}=await import('../src/services/conversations.js');await initConversationTables();const req=await demand(releaseId);await change(req.id,'app','unread.txt');
  await getDb().prepare("INSERT INTO conversation_messages(id,session_id,role,user_id,body) VALUES(?,?,'user','editor','Please also update the footer')").run('unread-fixture',req.session_id||((await getDb().prepare('SELECT id FROM project_sessions WHERE requirement_id=?').get(req.id)).id));
  calls=[];await assert.rejects(()=>service.requestMerge(req.id,'editor'),/未处理消息/);assert.ok(!calls.includes('push'));
 });
 await t.test('manual Squash confirmation remains valid when remote status is refreshed',async()=>{
  const req=await demand(releaseId);await change(req.id,'app','squash.txt');const application=await service.requestMerge(req.id,'editor');
  git(first.work,'fetch','origin',detail.branch_name);git(first.work,'switch','-C',detail.branch_name,'FETCH_HEAD');git(first.work,'fetch','origin',req.branch_name);git(first.work,'merge','--squash','FETCH_HEAD');git(first.work,'commit','-m','Externally squash feature');git(first.work,'push','origin',detail.branch_name);
  await service.refreshRequest(application.id,'editor');assert.equal((await getDb().prepare('SELECT status FROM merge_requests WHERE id=?').get(application.id)).status,'submitted');
  await service.confirmExternal(application.id,'owner','已核对远端 Squash 提交与验收结果');await service.refreshRequest(application.id,'editor');assert.equal((await getDb().prepare('SELECT status FROM merge_requests WHERE id=?').get(application.id)).status,'external');
 });
 await t.test('external merge of an older application preserves a requirement with newer source changes',async()=>{
  const req=await demand(releaseId),submitted=await change(req.id,'app','old-version.txt'),application=await service.requestMerge(req.id,'editor');await change(req.id,'app','new-version.txt');const {cwd}=await local(req.id,'app');git(cwd,'push','origin',req.branch_name);
  git(first.work,'fetch','origin',detail.branch_name);git(first.work,'switch','-C',detail.branch_name,'FETCH_HEAD');git(first.work,'fetch','origin',req.branch_name);git(first.work,'merge','--no-ff','-m','Externally merge older request',submitted);git(first.work,'push','origin',detail.branch_name);
  await service.refreshRequest(application.id,'editor');assert.equal((await getDb().prepare('SELECT status FROM merge_requests WHERE id=?').get(application.id)).status,'external');assert.equal((await getDb().prepare('SELECT status FROM requirements WHERE id=?').get(req.id)).status,'developing');
 });
});

test('multi-repository partial merge persists individual results and safely retries',async()=>{
 const projectId=await createProject('Multi','','owner',[{userId:'editor',role:'editor'}],{...emptyConfig,gitAuth:{mode:'token',sshPort:22,token:'fixture-only'},repos:[{name:'app',url:first.url,branch:'main'},{name:'other',url:second.url,branch:'main'}]});
 const releaseId=await release(projectId),req=await demand(releaseId,projectId);await change(req.id,'app','multi.txt');await change(req.id,'other','multi.txt');pushFailure='other';await assert.rejects(()=>service.requestMerge(req.id,'editor'),/Push failed/);assert.equal((await getDb().prepare('SELECT count(*) AS n FROM merge_requests WHERE requirement_id=?').get(req.id)).n,0);pushFailure=false;const request=await service.requestMerge(req.id,'editor');mergeFailure=second.url;await assert.rejects(()=>service.approve(request.id,'owner'),/unavailable/);const partial=await getDb().prepare('SELECT * FROM merge_requests WHERE id=?').get(request.id);assert.equal(partial.status,'partial');assert.equal(JSON.parse(partial.results).app.merged,true);assert.equal((await getDb().prepare('SELECT status FROM requirements WHERE id=?').get(req.id)).status,'pending_merge');mergeFailure='';await service.approve(request.id,'owner');assert.equal((await getDb().prepare('SELECT status FROM merge_requests WHERE id=?').get(request.id)).status,'merged');
});

test('Git compare-and-swap protects remote targets and conflicts do not change the release',async()=>{
 const branch='prism/release-conflict',source='prism/requirement-conflict';run({action:'create',url:second.url,branch,sha:second.sha});run({action:'create',url:second.url,branch:source,sha:second.sha});
 git(second.work,'switch','-C',source,second.sha);fs.writeFileSync(path.join(second.work,'base.txt'),'source change\n');git(second.work,'add','.');git(second.work,'commit','-m','source');const sourceSha=git(second.work,'rev-parse','HEAD');git(second.work,'push','origin',source);
 git(second.work,'switch','-C',branch,second.sha);fs.writeFileSync(path.join(second.work,'base.txt'),'target change\n');git(second.work,'add','.');git(second.work,'commit','-m','target');git(second.work,'push','origin',branch);const target=git(second.work,'rev-parse','HEAD');
 assert.throws(()=>run({action:'merge',url:second.url,branch,sourceBranch:source,sha:sourceSha,expectedTarget:second.sha}),/已更新/);
 const result=run({action:'merge',url:second.url,branch,sourceBranch:source,sha:sourceSha,expectedTarget:target});assert.equal(result.conflict,true);assert.deepEqual(result.conflicts,['base.txt']);assert.equal(run({action:'head',url:second.url,branch}).sha,target);
 assert.throws(()=>run({action:'create',url:second.url,branch,sha:second.sha}),/未覆盖/);
});

test('HTTP permissions bind actions to the URL project and restrict viewer data',async()=>{
 const {default:express}=await import('express'),{createReleaseRouter}=await import('../src/routes/releases.js'),{signToken}=await import('../src/middleware/auth.js');
 const app=express();app.use(express.json());app.use('/api/projects',createReleaseRouter(service));const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 try{const address=server.address() as {port:number},releaseId=(await getDb().prepare('SELECT id FROM releases WHERE project_id=? LIMIT 1').get(project)).id,req=(await getDb().prepare('SELECT id FROM requirements WHERE project_id=? LIMIT 1').get(project)).id,other=(await getDb().prepare('SELECT id FROM projects WHERE id<>? LIMIT 1').get(project)).id;
 const call=(user:string,url:string,method='POST',body:unknown={})=>fetch(`http://127.0.0.1:${address.port}/api/projects/${url}`,{method,headers:{Authorization:'Bearer '+signToken({userId:user,role:user==='owner'?'admin':'user'}),'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 assert.equal((await call('editor',`${project}/repository-branches?repo=app`,'GET')).status,200);
 assert.equal((await call('viewer',`${project}/repository-branches?repo=app`,'GET')).status,403);
 const created=await call('editor',`${project}/releases`,'POST',{name:'HTTP developer release'});assert.equal(created.status,202);await service.wait((await created.json()).id);
 assert.equal((await call('viewer',`${project}/releases`,'POST',{name:'Denied'})).status,403);
 const listed=await call('owner',`${project}/repository-branches?repo=app`,'GET');assert.equal(listed.status,200);assert.ok((await listed.json()).branches.includes('feature/preview'));
 assert.equal((await call('owner',`${project}/repository-branches?repo=unknown`,'GET')).status,409);
 assert.equal((await call('viewer',`${project}/requirements/${req}/apply`)).status,403);
 assert.equal((await call('editor',`${other}/requirements/${req}/apply`)).status,403);
 assert.equal((await call('editor',`${project}/releases/${releaseId}/freeze`)).status,403);
 assert.equal((await call('editor',`${project}/releases/${releaseId}`,'DELETE')).status,403);
 assert.equal((await call('viewer',`${project}/releases/${releaseId}`,'DELETE')).status,403);
 assert.equal((await call('owner',`${other}/releases/${releaseId}`,'DELETE')).status,403);
 const empty=await release();
 assert.equal((await call('owner',`${project}/releases/${empty}`,'DELETE')).status,200);
 assert.equal((await call('owner',`${project}/releases/${empty}`,'GET')).status,403);
 assert.equal((await call('editor',`${project}/requirements/${req}`,'DELETE')).status,403);
 assert.equal((await call('viewer',`${project}/requirements/${req}`,'DELETE')).status,403);
 assert.equal((await call('owner',`${other}/requirements/${req}`,'DELETE')).status,403);
 const disposable=await release(),child=await demand(disposable);
 assert.equal((await call('owner',`${project}/requirements/${child.id}`,'DELETE')).status,200);
 const cascade=await demand(disposable);assert.equal((await call('owner',`${project}/releases/${disposable}`,'DELETE')).status,200);
 assert.equal((await getDb().prepare('SELECT count(*) AS n FROM requirements WHERE id=?').get(cascade.id)).n,0);
 const view=await call('viewer',`${project}/releases/${releaseId}`,'GET');assert.equal(view.status,200);const data=await view.json();assert.deepEqual(data.requests,[]);assert.deepEqual(data.repositories,[]);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
