import {Router,type Router as RouterType} from 'express';
import {authenticate} from '../middleware/auth.js';
import type {AuthRequest} from '../types.js';
import {asyncHandler} from '../async-handler.js';
import {getDb} from '../services/db.js';
import {projectRole} from '../services/projects.js';
import {releaseWorkflow,createReleaseWorkflow} from '../services/release-workflow.js';
export function createReleaseRouter(service:ReturnType<typeof createReleaseWorkflow>=releaseWorkflow){
 const router:RouterType=Router();router.use(authenticate);
 async function access(req:AuthRequest,minimum:'viewer'|'editor'|'admin'='editor'){
  const projectId=String(req.params.id),role=await projectRole(projectId,req.user!.userId);
  if(!role||minimum==='admin'&&role!=='admin'||minimum==='editor'&&role==='viewer')throw Error('项目不存在或权限不足');
  if(req.params.releaseId){const release=await getDb().prepare('SELECT project_id FROM releases WHERE id=?').get(String(req.params.releaseId));if(release?.project_id!==projectId)throw Error('发布不存在或不属于当前项目');}
  if(req.params.requirementId){const demand=await getDb().prepare('SELECT project_id FROM requirements WHERE id=?').get(String(req.params.requirementId));if(demand?.project_id!==projectId)throw Error('需求不存在或不属于当前项目');}
  if(req.params.requestId){const request=await getDb().prepare('SELECT r.project_id FROM merge_requests m JOIN requirements r ON r.id=m.requirement_id WHERE m.id=?').get(String(req.params.requestId));if(request?.project_id!==projectId)throw Error('合入申请不存在或不属于当前项目');}
 }
 const route=(method:'get'|'post'|'delete',path:string,minimum:'viewer'|'editor'|'admin',handler:(req:AuthRequest)=>Promise<unknown>,status=200)=>router[method](path,asyncHandler(async(req:AuthRequest,res)=>{
  try{await access(req,minimum);}catch(error){res.status(403).json({error:(error as Error).message});return;}
  try{res.status(status).json(await handler(req));}catch(error){res.status(409).json({error:(error as Error).message});}
 }));
 route('get','/:id/repository-branches','editor',req=>service.repositoryBranches(String(req.params.id),req.user!.userId,typeof req.query.repo==='string'?req.query.repo:''));
 route('post','/:id/releases','editor',req=>service.createRelease(String(req.params.id),req.user!.userId,req.body),202);
 route('get','/:id/releases/:releaseId','viewer',req=>service.detail(String(req.params.releaseId),req.user!.userId));
 route('delete','/:id/releases/:releaseId','admin',req=>service.deleteRelease(String(req.params.releaseId),req.user!.userId));
 route('post','/:id/releases/:releaseId/requirements','editor',req=>service.createRequirement(String(req.params.id),String(req.params.releaseId),req.user!.userId,req.body),202);
 route('delete','/:id/requirements/:requirementId','admin',req=>service.deleteRequirement(String(req.params.requirementId),req.user!.userId));
 route('post','/:id/releases/:releaseId/retry','admin',req=>service.retryRelease(String(req.params.releaseId),req.user!.userId));
 route('post','/:id/releases/:releaseId/sync','editor',req=>service.syncRemote(String(req.params.releaseId),req.user!.userId));
 route('post','/:id/releases/:releaseId/freeze','admin',req=>service.freeze(String(req.params.releaseId),req.user!.userId,true));
 route('post','/:id/releases/:releaseId/unfreeze','admin',req=>service.freeze(String(req.params.releaseId),req.user!.userId,false));
 route('post','/:id/requirements/:requirementId/branches/retry','editor',req=>service.retryRequirement(String(req.params.requirementId),req.user!.userId));
 route('post','/:id/requirements/:requirementId/sync-release','editor',req=>service.syncRelease(String(req.params.requirementId),req.user!.userId));
 route('post','/:id/requirements/:requirementId/apply','editor',req=>service.requestMerge(String(req.params.requirementId),req.user!.userId),201);
 route('post','/:id/requirements/:requirementId/adopt','admin',req=>service.adoptLegacy(String(req.params.requirementId),String(req.body?.releaseId||''),req.user!.userId));
 route('post','/:id/merge-requests/:requestId/sync','editor',req=>service.refreshRequest(String(req.params.requestId),req.user!.userId));
 route('post','/:id/merge-requests/:requestId/approve','admin',req=>service.approve(String(req.params.requestId),req.user!.userId));
 route('post','/:id/merge-requests/:requestId/reject','admin',req=>service.reject(String(req.params.requestId),req.user!.userId,String(req.body?.reason||'')));
 route('post','/:id/merge-requests/:requestId/confirm-external','admin',req=>service.confirmExternal(String(req.params.requestId),req.user!.userId,String(req.body?.reason||'')));
 return router;
}
export default createReleaseRouter();
