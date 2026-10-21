import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthRequest } from '../types.js';
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
    if(role==='viewer' && (edit || req.path==='/logs')){res.status(403).json({error:'项目权限不足'});return;}
    next();
  }catch{res.status(404).json({error:'需求不存在或无权访问'});}
});
router.get('/',async(req:AuthRequest,res)=>{try{res.json(await runtimeStatus(String(req.params.requirementId)));}catch{res.status(503).json({error:'无法获取环境状态'});}});
router.get('/logs',async(req:AuthRequest,res)=>{try{res.json({logs:await runtimeLogs(String(req.params.requirementId))});}catch{res.status(503).json({error:'容器引擎不可用，无法读取日志'});}});
router.post('/start',(req:AuthRequest,res)=>{
  const id=String(req.params.requirementId);
  // Preparation is asynchronous; status and failure details are persisted and polled by the UI.
  void startRuntime(id).catch(()=>{});
  res.status(202).json({message:'环境启动任务已提交'});
});
router.post('/stop',async(req:AuthRequest,res)=>{try{await stopRuntime(String(req.params.requirementId));res.json({message:'环境已停止'});}catch{res.status(409).json({error:'环境操作进行中或容器引擎不可用，请稍后重试'});}});
for(const kind of ['preview','ide'] as const)router.post(`/open-${kind}`,async(req:AuthRequest,res)=>{
  try{res.json({url:await issueRuntimeLink(String(req.params.requirementId),req.user!.userId,kind,req.hostname,req.body?.port)});}catch{res.status(409).json({error:'环境尚未运行，请先启动环境并查看日志'});}
});
export default router;
