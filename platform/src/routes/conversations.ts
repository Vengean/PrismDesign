import {Router,type Router as RouterType} from 'express';
import {authenticate} from '../middleware/auth.js';
import type {AuthRequest} from '../types.js';
import {projectRole} from '../services/projects.js';
import {requirement} from '../services/requirement-runtime.js';
import {readConversationForRole,conversations} from '../services/conversations.js';
const router:RouterType=Router({mergeParams:true});router.use(authenticate);
router.use((req:AuthRequest,res,next)=>{
 try{const r=requirement(String(req.params.requirementId));const role=projectRole(r.project_id,req.user!.userId);
  if(r.project_id!==req.params.id || !role){res.status(404).json({error:'需求不存在或无权访问'});return;}
  if(role==='viewer' && req.method!=='GET'){res.status(403).json({error:'项目权限不足'});return;}next();
 }catch{res.status(404).json({error:'需求不存在或无权访问'});}
});
router.get('/',(req:AuthRequest,res)=>{
 const after=Number(req.query.after || 0),eventAfter=Number(req.query.eventAfter || 0);
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(eventAfter)||eventAfter<0){res.status(400).json({error:'消息游标无效'});return;}
 res.json(readConversationForRole(String(req.params.requirementId),projectRole(String(req.params.id),req.user!.userId)!,after,eventAfter));
});
router.post('/messages',(req:AuthRequest,res)=>{
 const {message,requestId}=req.body || {};
 if(typeof message!=='string'||typeof requestId!=='string'){res.status(400).json({error:'消息或请求标识无效'});return;}
 try{res.status(202).json(conversations.submit(String(req.params.requirementId),req.user!.userId,message,requestId,req.body.clientContext));}
 catch(e){res.status(409).json({error:(e as Error).message});}
});
router.post('/runs/:runId/cancel',async(req:AuthRequest,res)=>{
 try{await conversations.cancel(String(req.params.requirementId),String(req.params.runId));res.json({message:'取消请求已发送，正在等待 Agent 停止'});}
 catch(e){res.status(409).json({error:(e as Error).message});}
});
export default router;
