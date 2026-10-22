import { Router, type Router as RouterType } from 'express';
import {assertRuntimeChangeAllowed,activeWorkspaceRun} from '../services/workspace-lock.js';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types.js';
import {operateRequirementGit} from '../services/requirement-git.js';
import {projectConfig} from '../services/projects.js';
import {runtimeOperationActive} from '../services/requirement-runtime.js';
import { projectRole } from '../services/projects.js';
import { requirement, startRuntime, stopRuntime, runtimeStatus, runtimeLogs } from '../services/requirement-runtime.js';
import { issueRuntimeLink } from '../services/preview-gateway.js';

const router:RouterType=Router({mergeParams:true});
router.use(authenticate);
router.use((req:AuthRequest,res,next)=>{
  const id=String(req.params.requirementId);
  try {
    const r=requirement(id);const role=projectRole(r.project_id,req.user!.userId);
    if(r.project_id!==req.params.id || !role){res.status(404).json({error:'需求不存在或无权访问'});return;}
    const edit=req.method!=='GET' && req.path!=='/open-preview';
    // Logs can include source paths and configuration, only editors may inspect them.
    if(role==='viewer' && (edit || (req.path==='/logs'||req.path.startsWith('/git')))){res.status(403).json({error:'项目权限不足'});return;}
    next();
  }catch{res.status(404).json({error:'需求不存在或无权访问'});}
});
router.get('/',async(req:AuthRequest,res)=>{try{res.json(await runtimeStatus(String(req.params.requirementId)));}catch{res.status(503).json({error:'无法获取环境状态'});}});
router.get('/logs',async(req:AuthRequest,res)=>{try{res.json({logs:await runtimeLogs(String(req.params.requirementId))});}catch{res.status(503).json({error:'容器引擎不可用，无法读取日志'});}});
router.get('/git',(req:AuthRequest,res)=>{const r=requirement(String(req.params.requirementId));res.json({repos:projectConfig(r.project_id).repos.map(repo=>({name:repo.name})),branch:`prism/requirement-${r.id}`});});
router.get('/git/status',async(req:AuthRequest,res)=>{if(typeof req.query.repo!=='string'){res.status(400).json({error:'请选择仓库'});return;}try{const result=await operateRequirementGit(String(req.params.requirementId),req.query.repo,'status');res.status(result.success?200:409).json(result.success?result:{error:result.message});}catch(e){res.status(409).json({error:(e as Error).message});}});
router.post('/git/:action',async(req:AuthRequest,res)=>{
 const action=String(req.params.action);if(!['pull','push','commit'].includes(action)||typeof req.body?.repo!=='string'){res.status(400).json({error:'Git 操作参数无效'});return;}
 try{const result=await operateRequirementGit(String(req.params.requirementId),req.body.repo,action as 'pull'|'push'|'commit',req.body?.message);res.status(result.success?200:409).json(result.success?result:{error:result.message});}
 catch(e){res.status(409).json({error:(e as Error).message});}
});
router.post('/start',(req:AuthRequest,res)=>{
  const id=String(req.params.requirementId);
  try{assertRuntimeChangeAllowed(id);}catch(e){res.status(409).json({error:(e as Error).message});return;}
  // Preparation is asynchronous; status and failure details are persisted and polled by the UI.
  void startRuntime(id).catch(()=>{});
  res.status(202).json({message:'环境启动任务已提交'});
});
router.post('/stop',async(req:AuthRequest,res)=>{try{await stopRuntime(String(req.params.requirementId));res.json({message:'环境已停止'});}catch{res.status(409).json({error:'环境操作进行中或容器引擎不可用，请稍后重试'});}});
for(const kind of ['preview','ide'] as const)router.post(`/open-${kind}`,async(req:AuthRequest,res)=>{
  if(kind==='ide' && (activeWorkspaceRun(String(req.params.requirementId))||runtimeOperationActive(String(req.params.requirementId)))){res.status(423).json({error:activeWorkspaceRun(String(req.params.requirementId))?.status==='interrupted'?'任务已中断，请重启需求环境后重新打开 IDE':'工作区操作进行中，结束后可重新打开 IDE'});return;}
  try{const platformOrigin=new URL(req.headers.origin||req.headers.referer||`${req.protocol}://${req.headers.host}`).origin;res.json({url:await issueRuntimeLink(String(req.params.requirementId),req.user!.userId,kind,req.hostname,req.body?.port,platformOrigin)});}catch{res.status(409).json({error:'环境尚未运行，请先启动环境并查看日志'});}
});
export default router;
