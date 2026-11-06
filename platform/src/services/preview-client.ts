import {waitForConversation} from './conversation-events.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type http from 'node:http';
import {projectRole} from './projects.js';
import {getDb} from './db.js';
import {requirement} from './requirement-runtime.js';
import {conversationSession,readConversationForRole,conversations} from './conversations.js';
import {workspaceAttachments,readAttachmentBody,sendAttachment,AttachmentError} from './workspace-attachments.js';
export function widgetBundle(){
 const base=path.dirname(fileURLToPath(import.meta.url));
 const candidates=[path.resolve(process.cwd(),'web/public/prism-widget.js'),path.resolve(process.cwd(),'platform/web/public/prism-widget.js'),path.resolve(base,'../web/dist/prism-widget.js'),path.resolve(base,'../../web/public/prism-widget.js')];
 const filename=candidates.find(f=>fs.existsSync(f));if(!filename)throw new Error('Widget 尚未构建，请运行平台 build:widget');return fs.readFileSync(filename);
}
export async function handlePreviewClient(req:http.IncomingMessage,res:http.ServerResponse,id:string,userId:string){
 const url=new URL(req.url || '/', 'http://preview');if(!url.pathname.startsWith('/__prism_platform__/'))return false;
 const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 const r=requirement(id),role=projectRole(r.project_id,userId);if(!role){json(403,{error:'项目权限已变更'});return true;}
 const action=url.pathname.slice('/__prism_platform__'.length);
 try{
  if(req.method==='GET'&&action==='/widget.js'){res.writeHead(role==='viewer'?204:200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(role==='viewer'?undefined:widgetBundle());return true;}
  if(req.method==='GET'&&action==='/context'){
   const info=getDb().prepare('SELECT p.name,r.title FROM projects p JOIN requirements r ON r.project_id=p.id WHERE r.id=?').get(id) as {name:string;title:string};
   json(200,{protocol:1,projectId:r.project_id,requirementId:id,sessionId:conversationSession(id),projectName:info.name,title:info.title,userId,role});return true;
  }
  if((['/conversation','/messages','/cancel'].includes(action)||action.startsWith('/attachments'))&&url.searchParams.get('sessionId')!==conversationSession(id)){json(409,{error:'会话归属已变化，请刷新当前预览'});return true;}
  if(action==='/attachments'&&req.method==='POST'){
   if(role==='viewer'){json(403,{error:'项目权限不足'});return true;}
   const name=decodeURIComponent(String(req.headers['x-attachment-name']||''));
   const attachment=await workspaceAttachments.upload(id,userId,name,String(req.headers['x-attachment-type']||'application/octet-stream'),await readAttachmentBody(req));
   json(201,{attachment});return true;
  }
  const attachmentMatch=action.match(/^\/attachments\/([a-f0-9-]{36})$/);
  if(attachmentMatch&&req.method==='GET'){
   const result=await workspaceAttachments.download(id,userId,attachmentMatch[1]);sendAttachment(res,result.attachment.name,result.content);return true;
  }
  if(attachmentMatch&&req.method==='DELETE'){await workspaceAttachments.remove(id,userId,attachmentMatch[1]);json(200,{success:true});return true;}
  if(req.method==='GET'&&action==='/conversation'){
   if(role==='viewer'){json(403,{error:'预览成员不能参与群聊'});return true;}
   const after=Number(url.searchParams.get('after')||0),eventAfter=Number(url.searchParams.get('eventAfter')||0);if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(eventAfter)||eventAfter<0){json(400,{error:'消息游标无效'});return true;}
   const sessionId=conversationSession(id);
   if(url.searchParams.get('wait')==='1')await waitForConversation(sessionId,res,()=>{
    const value=readConversationForRole(id,role,after,eventAfter);
    return !projectRole(r.project_id,userId)||value.next_message_cursor>after||value.next_event_cursor>eventAfter||(url.searchParams.has('liveAfter')&&value.next_live_cursor!==(url.searchParams.get('liveAfter') || ''));
   });
   if(res.destroyed)return true;
   const currentRole=projectRole(r.project_id,userId);
   if(!currentRole){json(403,{error:'项目权限已变更'});return true;}
   if(url.searchParams.get('sessionId')!==conversationSession(id)){json(409,{error:'会话归属已变化，请刷新当前预览'});return true;}
   json(200,readConversationForRole(id,currentRole,after,eventAfter));return true;
  }
  if(req.method==='POST'&&['/messages','/cancel'].includes(action)){
   if(role==='viewer'){json(403,{error:'项目权限不足'});return true;}
   let body='';for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>128*1024)throw Error('请求体过大');}
   let data;try{data=JSON.parse(body);}catch{json(400,{error:'无效的 JSON 请求'});return true;}
   if(action==='/messages'){if(typeof data.message!=='string'||typeof data.requestId!=='string'){json(400,{error:'消息参数无效'});return true;}const attachments=await workspaceAttachments.resolve(id,userId,data.attachmentIds,data.requestId);json(202,conversations.submit(id,userId,data.message,data.requestId,data.clientContext,attachments));}
   else{if(typeof data.runId!=='string'){json(400,{error:'任务标识无效'});return true;}await conversations.cancel(id,data.runId);json(200,{message:'取消请求已发送'});}return true;
  }
  json(404,{error:'接口不存在'});
 }catch(e){json(e instanceof AttachmentError?e.status:409,{error:(e as Error).message});}return true;
}
