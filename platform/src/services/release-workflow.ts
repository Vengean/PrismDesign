import crypto from 'node:crypto';
import {getDb} from './db.js';
import {projectConfig,projectRole} from './projects.js';
import {withGitOperation,removeWorkspaceResources} from './requirement-runtime.js';
import {runReleaseGit,type ReleaseGitRunner} from './release-git.js';
import {operateRequirementGit} from './requirement-git.js';
import {workspaceEvents} from './workspace-lock.js';
import {conversationEvents} from './conversation-events.js';
export interface ReleaseRow {id:string;project_id:string;name:string;status:string;branch_name:string;branch_status:string;branch_error:string;frozen_manifest:string;operation_token:string|null}
export interface RequirementRow {id:string;project_id:string;release_id:string|null;title:string;status:string;branch_name:string;branch_status:string;branch_error:string}
interface RepoRow {repo_name:string;url:string;base_sha:string|null;head_sha:string|null;branch_status:string;source_ref?:string}
interface Source {repo:string;url:string;sha:string}
export interface MergeRequestRow {id:string;requirement_id:string;release_id:string;submitted_by:string;approved_by:string|null;status:string;manifest:string;results:string;reason:string}
export type WorkspaceGit=(id:string,repo:string,action:'status'|'push'|'sync-release',releaseBranch?:string)=>Promise<{success:boolean;message?:string;commit?:string;dirty?:boolean;baseSha?:string;beforeSha?:string;changed?:boolean}>;
const prefix=()=>process.env.PRISM_MODE==='sit'?'prism/sit/':'prism/';
const requirementRef=(row:RequirementRow)=>row.branch_name||`prism/requirement-${row.id}`;
function validRef(ref:unknown):ref is string{return typeof ref==='string'&&ref.length>0&&ref.length<=200&&!ref.startsWith('-')&&!/[\s\x00-\x1f~^:?*\[\\]/.test(ref);}
export function createReleaseWorkflow({git=runReleaseGit,workspace=async(id,repo,action,branch)=>operateRequirementGit(id,repo,action,undefined,branch,true),removeWorkspace=removeWorkspaceResources}:{git?:ReleaseGitRunner;workspace?:WorkspaceGit;removeWorkspace?:(id:string)=>Promise<void>}={}){
 const jobs=new Map<string,Promise<void>>();
 const db=()=>getDb();
 async function hasUnread(id:string){
  if(!await db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_messages'").get())return false;
  return !!await db().prepare("SELECT 1 FROM project_sessions s JOIN conversation_messages m ON m.session_id=s.id LEFT JOIN conversation_agent_state a ON a.session_id=s.id WHERE s.requirement_id=? AND m.role='user' AND m.seq>COALESCE(a.read_cursor,0) LIMIT 1").get(id);
 }
 async function assertMessagesHandled(id:string){if(await hasUnread(id))throw Error('群聊还有未处理消息，请处理完成后再申请或同意合入');}
 async function role(projectId:string,userId:string,admin=false){const value=await projectRole(projectId,userId);if(!value||(admin?value!=='admin':value==='viewer'))throw Error(admin?'仅项目管理员可以执行此操作':'仅项目编辑成员可以执行此操作');}
 async function release(id:string){const row=await db().prepare('SELECT * FROM releases WHERE id=?').get(id) as ReleaseRow|undefined;if(!row)throw Error('发布不存在');return row;}
 async function demand(id:string){const row=await db().prepare('SELECT * FROM requirements WHERE id=?').get(id) as RequirementRow|undefined;if(!row)throw Error('需求不存在');return row;}
 async function repos(id:string,kind:'release'|'requirement'='release'){return await db().prepare(`SELECT * FROM ${kind}_repositories WHERE ${kind}_id=? ORDER BY repo_name`).all(id) as RepoRow[];}
 async function audit(id:string,userId:string,type:string,data:unknown){await db().prepare('INSERT INTO release_events(id,release_id,user_id,type,data) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),id,userId,type,JSON.stringify(data));}
 async function exclusive<T>(id:string,kind:string,work:(row:ReleaseRow)=>Promise<T>):Promise<T>{
  const token=crypto.randomUUID();const lock=await db().prepare("UPDATE releases SET operation_token=?,operation_kind=? WHERE id=? AND operation_token IS NULL").run(token,kind,id);
  if(!lock.changes)throw Error('发布操作进行中，请稍后重试');
  try{return await work(await release(id));}finally{await db().prepare("UPDATE releases SET operation_token=NULL,operation_kind='' WHERE id=? AND operation_token=?").run(id,token);}
 }
 function launch(id:string,work:()=>Promise<void>){if(jobs.has(id))return;const job=Promise.resolve().then(work).catch(async error=>{for(const table of ['requirements','releases'])await db().prepare(`UPDATE ${table} SET branch_status='failed',branch_error=? WHERE id=? AND branch_status='preparing'`).run((error as Error).message,id);}).finally(()=>jobs.delete(id));jobs.set(id,job);}
 async function provisionRelease(id:string,userId:string){
  await exclusive(id,'branches',async row=>{
   if(row.status!=='integrating')throw Error('发布已冻结或归档');
   await db().prepare("UPDATE releases SET branch_status='preparing',branch_error='' WHERE id=?").run(id);
   let current='';try{
    const items=await repos(id);if(!items.length)throw Error('请先为项目配置代码仓库');
    for(const item of items){current=item.repo_name;if(item.branch_status==='ready')continue;
     let sha=item.base_sha;if(!sha){sha=(await git(row.project_id,{action:'resolve',url:item.url,branch:row.branch_name,source:item.source_ref})).sha;await db().prepare('UPDATE release_repositories SET base_sha=? WHERE release_id=? AND repo_name=?').run(sha,id,item.repo_name);}
     const created=await git(row.project_id,{action:'create',url:item.url,branch:row.branch_name,sha});
     await db().prepare("UPDATE release_repositories SET head_sha=?,branch_status='ready',error='' WHERE release_id=? AND repo_name=?").run(created.sha,id,item.repo_name);
    }
    await db().prepare("UPDATE releases SET branch_status='ready',branch_error='' WHERE id=?").run(id);await audit(id,userId,'branches.ready',{});
   }catch(error){const message=(error as Error).message;await db().prepare("UPDATE releases SET branch_status='failed',branch_error=? WHERE id=?").run(message,id);if(current)await db().prepare("UPDATE release_repositories SET branch_status='failed',error=? WHERE release_id=? AND repo_name=?").run(message,id,current);throw error;}
  });
 }
 async function provisionRequirement(id:string,userId:string){const req=await demand(id);if(!req.release_id)throw Error('需求尚未归属发布');
  await exclusive(req.release_id,'branches',async row=>{
   await db().prepare("UPDATE requirements SET branch_status='preparing',branch_error='' WHERE id=?").run(id);
   let current='';try{
    if(row.status!=='integrating'||row.branch_status!=='ready')throw Error('发布尚未就绪或已经冻结');
    for(const item of await repos(id,'requirement')){current=item.repo_name;if(item.branch_status==='ready')continue;
     const result=await git(row.project_id,{action:'create',url:item.url,branch:requirementRef(req),sha:item.base_sha!});
     await db().prepare("UPDATE requirement_repositories SET head_sha=?,branch_status='ready',error='' WHERE requirement_id=? AND repo_name=?").run(result.sha,id,current);
    }
    await db().prepare("UPDATE requirements SET branch_status='ready',branch_error='' WHERE id=?").run(id);await audit(row.id,userId,'requirement.ready',{requirementId:id});
   }catch(error){const message=(error as Error).message;await db().prepare("UPDATE requirements SET branch_status='failed',branch_error=? WHERE id=?").run(message,id);if(current)await db().prepare("UPDATE requirement_repositories SET branch_status='failed',error=? WHERE requirement_id=? AND repo_name=?").run(message,id,current);throw error;}
  });
 }
 async function repositoryBranches(projectId:string,userId:string,name:string){
  await role(projectId,userId);const config=await projectConfig(projectId),repo=config.repos.find(item=>item.name===name);
  if(!repo)throw Error('仓库不存在');
  const result=await git(projectId,{action:'branches',url:repo.url,branch:repo.branch});
  if(!Array.isArray(result.branches))throw Error('无法读取远端分支列表，请重试');
  return {branches:result.branches};
 }
 async function createRelease(projectId:string,userId:string,input:{name:string;description?:string;baseRefs?:Record<string,string>}){
  await role(projectId,userId);if(input.description!==undefined&&(typeof input.description!=='string'||input.description.length>20000))throw Error('发布说明无效');const config=await projectConfig(projectId);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>120)throw Error('请填写发布名称');if(!config.repos.length)throw Error('请先在项目设置中配置仓库');
  const id=crypto.randomUUID();
  await db().transaction(async()=>{
   await db().prepare("INSERT INTO releases(id,project_id,name,description,created_by,branch_name,branch_status) VALUES(?,?,?,?,?,?,'preparing')").run(id,projectId,input.name.trim(),input.description||'',userId,prefix()+'release-'+id);
   for(const repo of config.repos){const ref=input.baseRefs?.[repo.name]||repo.branch;if(!validRef(ref))throw Error('代码基线无效');await db().prepare('INSERT INTO release_repositories(release_id,repo_name,url,source_ref) VALUES(?,?,?,?)').run(id,repo.name,repo.url,ref);}
  })();launch(id,()=>provisionRelease(id,userId));return {id,branch_status:'preparing'};
 }
 async function createRequirement(projectId:string,releaseId:string,userId:string,input:{title:string;description?:string;acceptance?:string}){
  await role(projectId,userId);for(const text of [input.description,input.acceptance])if(text!==undefined&&(typeof text!=='string'||text.length>20000))throw Error('需求内容无效');if(typeof input.title!=='string'||!input.title.trim()||input.title.length>200)throw Error('请填写需求标题');
  return exclusive(releaseId,'new-requirement',async row=>{
   if(row.project_id!==projectId)throw Error('发布不属于当前项目');if(row.status!=='integrating'||row.branch_status!=='ready')throw Error('发布尚未就绪或已冻结，不能新建需求');
   const baseline:(RepoRow & {sha:string})[]=[];for(const item of await repos(releaseId))baseline.push({...item,sha:(await git(projectId,{action:'head',url:item.url,branch:row.branch_name})).sha});
   const id=crypto.randomUUID(),sessionId=crypto.randomUUID();
   await db().transaction(async()=>{
    await db().prepare("INSERT INTO requirements(id,project_id,release_id,title,description,acceptance,created_by,branch_name,branch_status) VALUES(?,?,?,?,?,?,?,?,'preparing')").run(id,projectId,releaseId,input.title.trim(),input.description||'',input.acceptance||'',userId,prefix()+'requirement-'+id);
    await db().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(sessionId,id);
    for(const item of baseline)await db().prepare('INSERT INTO requirement_repositories(requirement_id,repo_name,url,base_sha) VALUES(?,?,?,?)').run(id,item.repo_name,item.url,item.sha);
    await audit(releaseId,userId,'requirement.created',{requirementId:id});
   })();
   // The release operation token is released before provisioning acquires it.
   setTimeout(()=>launch(id,()=>provisionRequirement(id,userId)),0);return {id,session_id:sessionId,branch_status:'preparing',environment_status:'pending'};
  });
 }
 async function writable(id:string,userId:string){const req=await demand(id);await role(req.project_id,userId);if(!req.release_id)throw Error('历史需求尚未归属发布，请先由管理员关联');if(['merged','closed'].includes(req.status))throw Error('已合入或关闭的需求只读，请新建需求');if(req.branch_status!=='ready')throw Error('需求分支尚未准备完成');return req;}
 async function syncRelease(id:string,userId:string){const req=await writable(id,userId);
  return exclusive(req.release_id!,'sync',async row=>withGitOperation(id,async()=>{
   await writable(id,userId);if(row.status==='archived')throw Error('发布已归档');
   const items=await repos(id,'requirement'),before=new Map<string,string>();if(!items.length)throw Error('需求仓库尚未准备完成');
   for(const item of items){const status=await workspace(id,item.repo_name,'status');if(!status.success)throw Error(status.message||'无法读取工作区状态');if(status.dirty)throw Error(`${item.repo_name} 有未提交修改，请先提交后同步`);if(!status.commit)throw Error('无法核对同步前的提交');before.set(item.repo_name,status.commit);}
   const results:{repo:string;before:string;commit:string;releaseCommit:string;changed:boolean}[]=[];let invalidated=false;
   for(const item of items){
    try{
     const result=await workspace(id,item.repo_name,'sync-release',row.branch_name);if(!result.success)throw Error(result.message||'同步失败');if(!result.commit||!result.baseSha)throw Error('无法核对同步结果，请重新检查工作区');
     const changed=result.commit!==before.get(item.repo_name);results.push({repo:item.repo_name,before:before.get(item.repo_name)!,commit:result.commit,releaseCommit:result.baseSha,changed});
     if(changed&&!invalidated){await invalidate(id,'同步发布分支后需要重新申请');invalidated=true;}
     await db().prepare('UPDATE requirement_repositories SET head_sha=? WHERE requirement_id=? AND repo_name=?').run(result.commit,id,item.repo_name);
     await db().prepare('UPDATE release_repositories SET head_sha=? WHERE release_id=? AND repo_name=?').run(result.baseSha,row.id,item.repo_name);
    }catch(error){
     if(!invalidated){let clean=false;try{const status=await workspace(id,item.repo_name,'status');clean=status.success&&!status.dirty&&status.commit===before.get(item.repo_name);}catch{}if(!clean)await invalidate(id,'同步发布分支未完成，请检查工作区后重新申请');}
     const message=`${item.repo_name}：${(error as Error).message}${results.some(result=>result.changed)?'；已有仓库同步成功，修改保留在工作区':''}`;
     await audit(row.id,userId,'requirement.sync_failed',{requirementId:id,releaseBranch:row.branch_name,results,error:message});throw Error(message);
    }
   }
   const changed=results.some(result=>result.changed);await audit(row.id,userId,changed?'requirement.synced':'requirement.sync_checked',{requirementId:id,releaseBranch:row.branch_name,results});
   return {changed,releaseBranch:row.branch_name,results,message:changed?'已将发布分支更新合入需求工作区，尚未 Push':'当前需求已包含所属发布分支的全部提交，无需更新'};
  }));
 }
 async function invalidate(id:string,reason:string){await db().prepare("UPDATE merge_requests SET status='stale',reason=?,updated_at=datetime('now') WHERE requirement_id=? AND status IN ('submitted','approved','conflict','partial')").run(reason,id);await db().prepare("UPDATE requirements SET status='developing' WHERE id=? AND status NOT IN ('merged','closed')").run(id);}
 async function requestMerge(id:string,userId:string){const req=await writable(id,userId);
  return exclusive(req.release_id!,'submit',async row=>withGitOperation(id,async()=>{
   await writable(id,userId);await assertMessagesHandled(id);if(row.status!=='integrating')throw Error('发布已冻结或归档，不能申请合入');
   const items=await repos(id,'requirement'),manifest:Source[]=[];if(!items.length)throw Error('需求仓库尚未准备完成');
   // Validate ALL worktrees before pushing the first repository. No auto-commit.
   for(const item of items){const status=await workspace(id,item.repo_name,'status');if(!status.success)throw Error(status.message||'无法读取工作区状态');if(status.dirty)throw Error('请先提交当前修改后再申请合入');if(!status.commit)throw Error('无法读取需求提交');manifest.push({repo:item.repo_name,url:item.url,sha:status.commit});}
   for(const item of items){const pushed=await workspace(id,item.repo_name,'push');if(!pushed.success)throw Error(pushed.message||'Push 失败，未创建合入申请');}
   for(const item of manifest){const head=await git(req.project_id,{action:'head',url:item.url,branch:requirementRef(req)});if(head.sha!==item.sha)throw Error('远端需求版本已变化，请确认后重新申请');}
   const old=await db().prepare("SELECT * FROM merge_requests WHERE requirement_id=? ORDER BY created_at DESC,id DESC LIMIT 1").get(id) as MergeRequestRow|undefined;
   if(old&&['submitted','approved','partial'].includes(old.status)&&old.manifest===JSON.stringify(manifest))return {id:old.id,replayed:true};

   const requestId=crypto.randomUUID();await db().transaction(async()=>{
    await invalidate(id,'已有新的合入申请');
    await db().prepare('INSERT INTO merge_requests(id,requirement_id,release_id,submitted_by,manifest,results) VALUES(?,?,?,?,?,?)').run(requestId,id,row.id,userId,JSON.stringify(manifest),'{}');
    await db().prepare("UPDATE requirements SET status='pending_merge' WHERE id=?").run(id);await audit(row.id,userId,'merge.requested',{requestId,requirementId:id});
   })();
   try{await refreshRequestUnlocked(requestId,userId);}catch{return {id:requestId,replayed:false,message:'代码已 Push，申请已创建；远端合入状态暂未核对，请稍后同步远端状态'};}return {id:requestId,replayed:false};
  }));
 }
 async function getRequest(id:string){const row=await db().prepare('SELECT * FROM merge_requests WHERE id=?').get(id) as MergeRequestRow|undefined;if(!row)throw Error('合入申请不存在');return row;}
 async function refreshRequestUnlocked(id:string,userId:string){const request=await getRequest(id),req=await demand(request.requirement_id),row=await release(request.release_id);await role(req.project_id,userId);
  const results:Record<string,any>=JSON.parse(request.results);let all=true;
  for(const item of JSON.parse(request.manifest) as Source[]){
   const previous=results[item.repo],result=await git(req.project_id,{action:'contains',url:item.url,branch:row.branch_name,sha:item.sha});
   let merged=result.alreadyMerged===true;
   // Manual Squash/Rebase confirmation is anchored to its recorded release
   // commit, rather than repeatedly searching for the original source SHA.
   const confirmedTarget=previous?.manual?(previous.confirmedTarget||previous.target):undefined;
   if(!merged&&confirmedTarget)merged=(await git(req.project_id,{action:'contains',url:item.url,branch:row.branch_name,sha:confirmedTarget})).alreadyMerged===true;
   results[item.repo]={...previous,target:result.sha,merged,...(confirmedTarget?{confirmedTarget}:{})};await db().prepare('UPDATE release_repositories SET head_sha=? WHERE release_id=? AND repo_name=?').run(result.sha,row.id,item.repo);if(!merged)all=false;
  }
  await db().prepare('UPDATE merge_requests SET results=?,updated_at=datetime(\'now\') WHERE id=?').run(JSON.stringify(results),id);
  if(all&&!['merged','external'].includes(request.status)){
   let newer=await hasUnread(req.id);for(const item of JSON.parse(request.manifest) as Source[]){try{if((await git(req.project_id,{action:'head',url:item.url,branch:requirementRef(req)})).sha!==item.sha)newer=true;}catch{/* A merged remote source branch may have been deleted. */}try{const local=await workspace(req.id,item.repo,'status');if(!local.success||local.dirty||local.commit!==item.sha)newer=true;}catch{newer=true;/* Do not close a workspace whose local changes cannot be inspected. */}}
   await db().transaction(async()=>{await db().prepare("UPDATE merge_requests SET status='external',reason='检测到申请提交已在远端合入',updated_at=datetime('now') WHERE id=?").run(id);await db().prepare('UPDATE requirements SET status=? WHERE id=?').run(newer?'developing':'merged',req.id);await audit(row.id,userId,'merge.external',{requestId:id,newerChanges:newer});})();
  }
  if(!all&&['merged','external'].includes(request.status)){await db().prepare("UPDATE merge_requests SET status='needs_confirmation',reason='远端提交历史发生变化，请核对合入结果' WHERE id=?").run(id);}
  return {...await getRequest(id),results:JSON.stringify(results)};
 }
 async function refreshRequest(id:string,userId:string){const request=await getRequest(id),req=await demand(request.requirement_id);await role(req.project_id,userId);return exclusive(request.release_id,'refresh',()=>withGitOperation(req.id,()=>refreshRequestUnlocked(id,userId)));}
 async function approve(id:string,userId:string){const request=await getRequest(id),req=await demand(request.requirement_id);await role(req.project_id,userId,true);
  return exclusive(request.release_id,'merge',async row=>withGitOperation(req.id,async()=>{
   if(row.status!=='integrating')throw Error('发布已冻结或归档');
   await assertMessagesHandled(req.id);const current=await refreshRequestUnlocked(id,userId);if(['merged','external'].includes(current.status))return {message:'申请提交已在远端合入，状态已同步'};
   if(!['submitted','approved','partial','conflict'].includes(current.status))throw Error('申请已失效，请重新申请');
   const manifest=JSON.parse(current.manifest) as Source[],results=JSON.parse(current.results);let completed=0;
   await db().prepare("UPDATE merge_requests SET status='approved',approved_by=? WHERE id=?").run(userId,id);
   try{
    // Inspect every source, including repositories completed by an earlier
    // partial attempt, before any additional merge can close the requirement.
    for(const item of manifest){
     const local=await workspace(req.id,item.repo,'status');if(!local.success||local.dirty||local.commit!==item.sha)throw Error('需求代码已修改，请重新申请合入');
     try{if((await git(req.project_id,{action:'head',url:item.url,branch:requirementRef(req)})).sha!==item.sha)throw Error('需求分支已更新，请重新申请合入');}
     catch(error){if(!results[item.repo]?.merged||!(error as Error).message.includes('远端分支不存在'))throw error;}
    }
    for(const item of manifest){if(results[item.repo]?.merged){completed++;continue;}
     const local=await workspace(req.id,item.repo,'status');if(!local.success||local.dirty||local.commit!==item.sha)throw Error('需求代码已修改，请重新申请合入');
     const merged=await git(req.project_id,{action:'merge',url:item.url,branch:row.branch_name,sourceBranch:requirementRef(req),sha:item.sha,expectedTarget:results[item.repo].target,message:`Merge requirement ${req.id}: ${req.title}`});
     if(merged.conflict){results[item.repo]={...results[item.repo],conflicts:merged.conflicts};throw Error('存在代码冲突，请在需求环境同步发布分支并处理后重新申请');}
     results[item.repo]={target:merged.sha,merged:true};completed++;await db().prepare('UPDATE merge_requests SET results=? WHERE id=?').run(JSON.stringify(results),id);
     await db().prepare('UPDATE release_repositories SET head_sha=? WHERE release_id=? AND repo_name=?').run(merged.sha,row.id,item.repo);
    }
    await db().transaction(async()=>{await db().prepare("UPDATE merge_requests SET status='merged',reason='',updated_at=datetime('now') WHERE id=?").run(id);await db().prepare("UPDATE requirements SET status='merged' WHERE id=?").run(req.id);await audit(row.id,userId,'merge.completed',{requestId:id});})();
    return {message:'需求已合入所属发布分支'};
   }catch(error){const reason=(error as Error).message;await db().prepare("UPDATE merge_requests SET status=?,results=?,reason=?,updated_at=datetime('now') WHERE id=?").run(completed||Object.values(results).some((result:any)=>result.merged)?'partial':reason.includes('冲突')?'conflict':'stale',JSON.stringify(results),reason,id);throw error;}
  }));
 }
 async function reject(id:string,userId:string,reason:string){const request=await getRequest(id),req=await demand(request.requirement_id);await role(req.project_id,userId,true);if(!reason?.trim())throw Error('请填写退回说明');
  return exclusive(request.release_id,'reject',async()=>{if(!['submitted','conflict','stale'].includes((await getRequest(id)).status))throw Error('当前申请不能退回');await db().prepare("UPDATE merge_requests SET status='rejected',reason=?,updated_at=datetime('now') WHERE id=?").run(reason.trim().slice(0,2000),id);await db().prepare("UPDATE requirements SET status='developing' WHERE id=?").run(req.id);await audit(request.release_id,userId,'merge.rejected',{requestId:id,reason});return {message:'已退回修改'};});
 }
 async function confirmExternal(id:string,userId:string,reason:string){const request=await getRequest(id),req=await demand(request.requirement_id);await role(req.project_id,userId,true);if(!reason?.trim())throw Error('请填写外部合入确认依据');
  return exclusive(request.release_id,'confirm',async row=>withGitOperation(req.id,async()=>{
   await assertMessagesHandled(req.id);if(!['submitted','partial','conflict','needs_confirmation'].includes((await getRequest(id)).status))throw Error('当前申请不能确认');const results:Record<string,any>={};
   for(const item of JSON.parse(request.manifest) as Source[]){const local=await workspace(req.id,item.repo,'status');if(!local.success||local.dirty||local.commit!==item.sha)throw Error('需求仍有新修改，不能确认旧版本为完成');try{if((await git(req.project_id,{action:'head',url:item.url,branch:requirementRef(req)})).sha!==item.sha)throw Error('远端需求已有新提交，不能确认旧版本为完成');}catch(error){if(!(error as Error).message.includes('远端分支不存在'))throw error;}results[item.repo]={target:(await git(req.project_id,{action:'head',url:item.url,branch:row.branch_name})).sha,merged:true,manual:true};}
   await db().transaction(async()=>{await db().prepare("UPDATE merge_requests SET status='external',approved_by=?,reason=?,results=? WHERE id=?").run(userId,reason.trim().slice(0,2000),JSON.stringify(results),id);await db().prepare("UPDATE requirements SET status='merged' WHERE id=?").run(req.id);await audit(row.id,userId,'merge.confirmed',{requestId:id,reason,results});})();return {message:'已记录管理员确认的外部合入'};
  }));
 }
 async function freeze(id:string,userId:string,frozen:boolean){const row=await release(id);await role(row.project_id,userId,true);return exclusive(id,'freeze',async current=>{
  if(current.status==='archived'||current.branch_status!=='ready')throw Error('发布尚未就绪或已归档');
  if(frozen&&await db().prepare("SELECT 1 FROM merge_requests WHERE release_id=? AND status IN ('submitted','approved','partial','conflict')").get(id))throw Error('请先处理待合入或部分合入的申请');
  const manifest:Record<string,string>={};if(frozen)for(const item of await repos(id))manifest[item.repo_name]=(await git(current.project_id,{action:'head',url:item.url,branch:current.branch_name})).sha;
  await db().transaction(async()=>{await db().prepare('UPDATE releases SET status=?,frozen_manifest=? WHERE id=?').run(frozen?'frozen':'integrating',JSON.stringify(manifest),id);await audit(id,userId,frozen?'release.frozen':'release.unfrozen',manifest);})();return {message:frozen?'发布已冻结':'发布已解冻'};
 });}
 async function detail(id:string,userId:string){const row=await release(id);const value=await projectRole(row.project_id,userId);if(!value)throw Error('无权访问发布');
  const requirements=await db().prepare('SELECT r.*,s.id AS session_id FROM requirements r JOIN project_sessions s ON s.requirement_id=r.id WHERE r.release_id=? ORDER BY r.created_at DESC,r.id').all(id);
  const requests=value==='viewer'?[]:await db().prepare('SELECT * FROM merge_requests WHERE release_id=? ORDER BY created_at DESC,id DESC').all(id);
  const repositories=await repos(id);return {...row,operation_token:undefined,repositories:value==='viewer'?[]:repositories,requirements,requests};
 }
 async function syncRemote(id:string,userId:string){const row=await release(id);await role(row.project_id,userId);return exclusive(id,'refresh',async current=>{
  if(current.branch_status!=='ready')throw Error('发布分支尚未就绪');const frozen=JSON.parse(current.frozen_manifest||'{}'),changed:string[]=[];
  for(const item of await repos(id)){const head=await git(current.project_id,{action:'head',url:item.url,branch:current.branch_name});await db().prepare('UPDATE release_repositories SET head_sha=? WHERE release_id=? AND repo_name=?').run(head.sha,id,item.repo_name);if(current.status==='frozen'&&frozen[item.repo_name]!==head.sha)changed.push(item.repo_name);}
  for(const request of await db().prepare("SELECT id FROM merge_requests WHERE release_id=? AND status IN ('submitted','approved','partial','conflict','merged','external')").all(id))await withGitOperation((await getRequest(request.id)).requirement_id,()=>refreshRequestUnlocked(request.id,userId));
  const warning=changed.length?'远端版本与冻结版本不一致：'+changed.join('、'):'';await db().prepare('UPDATE releases SET branch_error=? WHERE id=?').run(warning,id);return {message:warning||'远端状态已同步'};
 });}
 async function retryRelease(id:string,userId:string){const row=await release(id);await role(row.project_id,userId,true);
  if(row.branch_status==='legacy'){
   const config=await projectConfig(row.project_id);if(!config.repos.length)throw Error('请先配置仓库');
   await db().transaction(async()=>{await db().prepare('UPDATE releases SET branch_name=? WHERE id=?').run(prefix()+'release-'+id,id);for(const repo of config.repos)await db().prepare('INSERT INTO release_repositories(release_id,repo_name,url,source_ref) VALUES(?,?,?,?)').run(id,repo.name,repo.url,repo.branch);})();
  }
  if(!['legacy','failed'].includes(row.branch_status))throw Error('发布无需重试');launch(id,()=>provisionRelease(id,userId));return {message:'已提交分支初始化'};
 }
 async function retryRequirement(id:string,userId:string){const req=await demand(id);await role(req.project_id,userId);if(req.branch_status!=='failed')throw Error('需求无需重试');launch(id,()=>provisionRequirement(id,userId));return {message:'已提交分支重试'};}
 async function adoptLegacy(id:string,releaseId:string,userId:string){const req=await demand(id);await role(req.project_id,userId,true);if(['merged','closed'].includes(req.status))throw Error('已完成需求不能关联发布');if(req.release_id)throw Error('已有归属的需求不能更换发布');
  return exclusive(releaseId,'adopt',async row=>withGitOperation(id,async()=>{
   if((await demand(id)).release_id)throw Error('需求已有关联发布');if(row.project_id!==req.project_id||row.status!=='integrating'||row.branch_status!=='ready')throw Error('请选择当前项目内可用的发布');
   const config=await projectConfig(req.project_id),items=await repos(releaseId);if(items.length!==config.repos.length||items.some(item=>!config.repos.some(repo=>repo.name===item.repo_name&&repo.url===item.url)))throw Error('仓库配置不一致，不能直接关联历史需求');
   for(const item of items){const status=await workspace(id,item.repo_name,'status');if(!status.success||status.dirty)throw Error('请先提交历史需求修改');}
   const bases:(RepoRow & {base:string;head?:string})[]=[];for(const item of items){const synced=await workspace(id,item.repo_name,'sync-release',row.branch_name);if(!synced.success)throw Error(synced.message||'同步发布基线失败');bases.push({...item,base:synced.baseSha||(await git(req.project_id,{action:'head',url:item.url,branch:row.branch_name})).sha,head:synced.commit});}
   await db().transaction(async()=>{await db().prepare("UPDATE requirements SET release_id=?,branch_status='ready',branch_name=? WHERE id=? AND release_id IS NULL").run(releaseId,requirementRef(req),id);for(const item of bases)await db().prepare("INSERT INTO requirement_repositories(requirement_id,repo_name,url,base_sha,head_sha,branch_status) VALUES(?,?,?,?,?,'ready')").run(id,item.repo_name,item.url,item.base,item.head||null);await audit(releaseId,userId,'requirement.adopted',{requirementId:id});})();return {message:'历史需求已同步发布基线并关联，原分支及文件保留'};
  }));
 }
 async function removeRequirements(rows:RequirementRow[],userId:string,releaseId?:string){
  // Reserve every workspace before removing any resource, so an active task in a
  // later requirement cannot cause a partially deleted release.
  async function locked(index:number):Promise<{message:string}>{
   if(index<rows.length){const row=rows[index];return withGitOperation(row.id,()=>locked(index+1)).catch(error=>{throw Error(`${row.title}：${(error as Error).message}`);});}
   for(const row of rows){
    const current=await demand(row.id);
    if(current.release_id!==row.release_id)throw Error(`需求“${row.title}”的所属发布已变化，请刷新后重试`);
    if(jobs.has(row.id)||current.branch_status==='preparing')throw Error(`需求“${row.title}”的分支正在准备中，请完成后再删除`);
   }
   for(const row of rows)await removeWorkspace(row.id);
   const sessions:string[]=[];
   await db().transaction(async()=>{
    for(const row of rows){
     const session=await db().prepare('SELECT id FROM project_sessions WHERE requirement_id=?'+(db().dialect==='mysql'?' FOR UPDATE':'')).get(row.id);
     if(session){
      sessions.push(session.id);
      for(const table of ['conversation_events','conversation_messages','conversation_agent_state','conversation_runs']){
       if(await db().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))await db().prepare(`DELETE FROM ${table} WHERE session_id=?`).run(session.id);
      }
     }
     await db().prepare('DELETE FROM merge_requests WHERE requirement_id=?').run(row.id);
     await db().prepare('DELETE FROM requirement_repositories WHERE requirement_id=?').run(row.id);
     await db().prepare('DELETE FROM requirements WHERE id=?').run(row.id);
     if(row.release_id&&!releaseId)await audit(row.release_id,userId,'requirement.deleted',{requirementId:row.id,title:row.title});
    }
    if(releaseId){
     await db().prepare('DELETE FROM merge_requests WHERE release_id=?').run(releaseId);
     await db().prepare('DELETE FROM release_events WHERE release_id=?').run(releaseId);
     await db().prepare('DELETE FROM release_repositories WHERE release_id=?').run(releaseId);
     await db().prepare('DELETE FROM releases WHERE id=?').run(releaseId);
    }
   })();
   for(const row of rows)workspaceEvents.emit('deleted',row.id);
   for(const session of sessions)conversationEvents.emit(session);
   return {message:releaseId?'发布、关联需求及工作区已删除，远端 Git 分支保留':'需求及工作区已删除，远端 Git 分支保留'};
  }
  return locked(0);
 }
 async function deleteRequirement(id:string,userId:string){
  const req=await demand(id);await role(req.project_id,userId,true);
  const remove=()=>removeRequirements([req],userId);
  return req.release_id?exclusive(req.release_id,'delete-requirement',()=>remove()):remove();
 }
 async function deleteRelease(id:string,userId:string){
  const row=await release(id);await role(row.project_id,userId,true);
  if(jobs.has(id))throw Error('发布操作进行中，请稍后重试');
  return exclusive(id,'delete',async current=>{
   if(current.branch_status==='preparing')throw Error('发布分支正在准备中，请完成后再删除');
   const requirements=await db().prepare('SELECT * FROM requirements WHERE release_id=? ORDER BY id').all(id) as RequirementRow[];
   return removeRequirements(requirements,userId,id);
  });
 }
 async function recover(){await db().prepare("UPDATE releases SET operation_token=NULL,operation_kind='',branch_status=CASE WHEN branch_status='preparing' THEN 'failed' ELSE branch_status END,branch_error=CASE WHEN branch_status='preparing' THEN '平台重启，请重试分支初始化' ELSE branch_error END").run();await db().prepare("UPDATE requirements SET branch_status='failed',branch_error='平台重启，请重试分支初始化' WHERE branch_status='preparing'").run();}
 return {repositoryBranches,createRelease,createRequirement,deleteRequirement,deleteRelease,detail,syncRemote,retryRelease,retryRequirement,syncRelease,requestMerge,refreshRequest,approve,reject,confirmExternal,freeze,adoptLegacy,recover,async wait(id:string){await new Promise(resolve=>setTimeout(resolve,5));await jobs.get(id);}};
}
export const releaseWorkflow=createReleaseWorkflow();
