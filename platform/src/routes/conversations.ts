import {waitForConversation} from '../services/conversation-events.js';
import {Router,type Router as RouterType} from 'express';
import {authenticate} from '../middleware/auth.js';
import type {AuthRequest} from '../types.js';
import {projectRole} from '../services/projects.js';
import {requirement} from '../services/requirement-runtime.js';
import {conversationSession,readConversationForRole,conversations} from '../services/conversations.js';
import {workspaceAttachments,readAttachmentBody,sendAttachment,AttachmentError} from '../services/workspace-attachments.js';
const router:RouterType=Router({mergeParams:true});router.use(authenticate);
router.use((req:AuthRequest,res,next)=>{
 try{const r=requirement(String(req.params.requirementId));const role=projectRole(r.project_id,req.user!.userId);
  if(r.project_id!==req.params.id || !role){res.status(404).json({error:'需求不存在或无权访问'});return;}
  if(role==='viewer'){res.status(403).json({error:'预览成员不能参与群聊'});return;}next();
 }catch{res.status(404).json({error:'需求不存在或无权访问'});}
});
router.get('/',async(req:AuthRequest,res)=>{
 try{
 const after=Number(req.query.after || 0),eventAfter=Number(req.query.eventAfter || 0);
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(eventAfter)||eventAfter<0){res.status(400).json({error:'消息游标无效'});return;}
 const id=String(req.params.requirementId),sessionId=conversationSession(id);
 if(req.query.wait==='1')await waitForConversation(sessionId,res,()=>{
  const role=projectRole(String(req.params.id),req.user!.userId);if(!role)return true;
  const value=readConversationForRole(id,role,after,eventAfter);return value.next_message_cursor>after||value.next_event_cursor>eventAfter||(typeof req.query.liveAfter==='string'&&value.next_live_cursor!==req.query.liveAfter);
 });
 if(res.destroyed)return;
 const role=projectRole(String(req.params.id),req.user!.userId);if(!role){res.status(403).json({error:'项目权限已变更'});return;}
 res.json(readConversationForRole(id,role,after,eventAfter));
 }catch{if(!res.destroyed)res.status(409).json({error:'需求会话不可用，请重新打开需求。'});}
});
router.post('/attachments',async(req:AuthRequest,res)=>{
 try{const attachment=await workspaceAttachments.upload(String(req.params.requirementId),req.user!.userId,decodeURIComponent(String(req.headers['x-attachment-name']||'')),String(req.headers['x-attachment-type']||'application/octet-stream'),await readAttachmentBody(req));res.status(201).json({attachment});}
 catch(error){res.status(error instanceof AttachmentError?error.status:503).json({error:(error as Error).message});}
});
router.get('/attachments/:attachmentId',async(req:AuthRequest,res)=>{
 try{const result=await workspaceAttachments.download(String(req.params.requirementId),req.user!.userId,String(req.params.attachmentId));sendAttachment(res,result.attachment.name,result.content);}
 catch(error){res.status(error instanceof AttachmentError?error.status:503).json({error:(error as Error).message});}
});
router.delete('/attachments/:attachmentId',async(req:AuthRequest,res)=>{
 try{await workspaceAttachments.remove(String(req.params.requirementId),req.user!.userId,String(req.params.attachmentId));res.json({success:true});}
 catch(error){res.status(error instanceof AttachmentError?error.status:503).json({error:(error as Error).message});}
});
router.post('/messages',async(req:AuthRequest,res)=>{
 const {message,requestId}=req.body || {};
 if(typeof message!=='string'||typeof requestId!=='string'){res.status(400).json({error:'消息或请求标识无效'});return;}
 try{const attachments=await workspaceAttachments.resolve(String(req.params.requirementId),req.user!.userId,req.body.attachmentIds,requestId);res.status(202).json(conversations.submit(String(req.params.requirementId),req.user!.userId,message,requestId,req.body.clientContext,attachments));}
 catch(e){res.status(e instanceof AttachmentError?e.status:409).json({error:(e as Error).message});}
});
router.post('/runs/:runId/cancel',async(req:AuthRequest,res)=>{
 try{await conversations.cancel(String(req.params.requirementId),String(req.params.runId));res.json({message:'取消请求已发送，正在等待 Agent 停止'});}
 catch(e){res.status(409).json({error:(e as Error).message});}
});
export default router;
