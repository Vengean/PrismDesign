import {getDb} from '../services/db.js';
import {asyncHandler} from '../async-handler.js';
import { Router, type Router as RouterType } from 'express';
import {assertRuntimeChangeAllowed} from '../services/workspace-lock.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types.js';
import {operateRequirementGit} from '../services/requirement-git.js';
import {projectConfig} from '../services/projects.js';
import { projectRole } from '../services/projects.js';
import { requirement, startRuntime, stopRuntime, runtimeStatus, runtimeLogs } from '../services/requirement-runtime.js';
import { issueRuntimeLink } from '../services/preview-gateway.js';
import {workspaceFiles} from '../services/workspace-files.js';
import {AttachmentError,sendAttachment} from '../services/workspace-attachments.js';

const router:RouterType=Router({mergeParams:true});
router.use(authenticate);
router.use(asyncHandler(async (req:AuthRequest,res,next)=>{
  const id=String(req.params.requirementId);
  try {
    const r=(await requirement(id));const role=(await projectRole(r.project_id,req.user!.userId));
    if(r.project_id!==req.params.id || !role){res.status(404).json({error:'需求不存在或无权访问'});return;}
    if(req.path==='/start'&&r.release_id&&r.branch_status!=='ready'){res.status(409).json({error:'需求分支尚未就绪'});return;}
    if(req.path==='/open-ide'&&role!=='admin'){res.status(403).json({error:'仅开发者 / 管理员可以进入 VS Code'});return;}
    const edit=req.method!=='GET' && req.path!=='/open-preview';
    // Logs can include source paths and configuration, only editors may inspect them.
    if(edit&&['merged','closed'].includes(r.status)&&req.path!=='/stop'){res.status(409).json({error:'已合入或关闭的需求只读'});return;}
    if(role==='viewer' && (edit || (req.path==='/logs'||req.path.startsWith('/git')))){res.status(403).json({error:'项目权限不足'});return;}
    next();
  }catch{res.status(404).json({error:'需求不存在或无权访问'});}
}));
router.get('/',asyncHandler(async(req:AuthRequest,res)=>{try{res.json(await runtimeStatus(String(req.params.requirementId)));}catch{res.status(503).json({error:'无法获取环境状态'});}}));
router.get('/logs',asyncHandler(async(req:AuthRequest,res)=>{try{res.json({logs:await runtimeLogs(String(req.params.requirementId))});}catch{res.status(503).json({error:'容器引擎不可用，无法读取日志'});}}));
router.get('/files',asyncHandler(async(req:AuthRequest,res)=>{
 try{res.json(await workspaceFiles.list(String(req.params.requirementId),req.user!.userId,req.query.path??''));}
 catch(error){res.status(error instanceof AttachmentError?error.status:503).json({error:(error as Error).message});}
}));
router.get('/files/download',asyncHandler(async(req:AuthRequest,res)=>{
 try{const result=await workspaceFiles.download(String(req.params.requirementId),req.user!.userId,req.query.path);sendAttachment(res,result.name,result.content);}
 catch(error){res.status(error instanceof AttachmentError?error.status:503).json({error:(error as Error).message});}
}));
router.get('/git',asyncHandler(async(req:AuthRequest,res)=>{
 const r=await requirement(String(req.params.requirementId));
 const repos=r.release_id?await getDb().prepare('SELECT repo_name AS name FROM requirement_repositories WHERE requirement_id=?').all(r.id):(await projectConfig(r.project_id)).repos.map(repo=>({name:repo.name}));
 const release=r.release_id?await getDb().prepare('SELECT name,branch_name FROM releases WHERE id=?').get(r.release_id):undefined;
 res.json({repos,branch:r.branch_name||`prism/requirement-${r.id}`,release:release?{name:release.name,branch:release.branch_name}:undefined});
}));
router.get('/git/status',asyncHandler(async(req:AuthRequest,res)=>{if(typeof req.query.repo!=='string'){res.status(400).json({error:'请选择仓库'});return;}try{const result=await operateRequirementGit(String(req.params.requirementId),req.query.repo,'status');res.status(result.success?200:409).json(result.success?result:{error:result.message});}catch(e){res.status(409).json({error:(e as Error).message});}}));
router.post('/git/:action',asyncHandler(async(req:AuthRequest,res)=>{
 const action=String(req.params.action);if(!['pull','push','commit'].includes(action)||typeof req.body?.repo!=='string'){res.status(400).json({error:'Git 操作参数无效'});return;}
 try{const result=await operateRequirementGit(String(req.params.requirementId),req.body.repo,action as 'pull'|'push'|'commit',req.body?.message);res.status(result.success?200:409).json(result.success?result:{error:result.message});}
 catch(e){res.status(409).json({error:(e as Error).message});}
}));
router.post('/start',asyncHandler(async (req:AuthRequest,res)=>{
  const id=String(req.params.requirementId);
  try{(await assertRuntimeChangeAllowed(id));}catch(e){res.status(409).json({error:(e as Error).message});return;}
  // Preparation is asynchronous; status and failure details are persisted and polled by the UI.
  void startRuntime(id).catch(()=>{});
  res.status(202).json({message:'环境启动任务已提交'});
}));
router.post('/stop',asyncHandler(async(req:AuthRequest,res)=>{try{await stopRuntime(String(req.params.requirementId));res.json({message:'环境已停止'});}catch{res.status(409).json({error:'环境操作进行中或容器引擎不可用，请稍后重试'});}}));
for(const kind of ['preview','ide'] as const)router.post(`/open-${kind}`,asyncHandler(async(req:AuthRequest,res)=>{
  try{const platformOrigin=new URL(req.headers.origin||req.headers.referer||`${req.protocol}://${req.headers.host}`).origin;res.json({url:await issueRuntimeLink(String(req.params.requirementId),req.user!.userId,kind,req.hostname,req.body?.port,platformOrigin)});}catch(e){res.status(409).json({error:(e as Error).message || '环境尚未运行，请先启动环境并查看日志'});}
}));
export default router;
