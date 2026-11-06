import {conversationProgress} from './conversation-progress.js';
import {createConnectionLogger} from './connection-diagnostics.js';
import {pageConversationLive,watchConversation,type ConversationLive} from './conversation-stream.js';
import {pageAttachmentClient,type AttachmentClient} from './attachment-client.js';
import React from 'react';
import {useEffect,useMemo,useRef,useState} from 'react';
import {PlatformClient,requestId,type PlatformContext,type PlatformConversation,type PlatformRequest} from './platform-client.js';
import type {ChatMessage,CommentAnnotation} from './types.js';
import type {ChatState} from './ChatPanel';
import {isRunWorking,runMessageBody,connectionMessage} from './run-state.js';
import {StudioPanel} from './StudioPanel';
import type {AnnotationAdapter} from './annotations.js';
import type {ReactNode} from 'react';

export function PlatformPanel({context,contextError,request,live=pageConversationLive,files,annotations,actions,surface}:{contextError?:string;surface:'widget'|'extension';context:PlatformContext;request:PlatformRequest;live?:ConversationLive;files?:AttachmentClient;annotations:AnnotationAdapter;actions?:ReactNode}){
 const pageFiles=useMemo(()=>pageAttachmentClient(context.sessionId),[context.sessionId]),attachmentClient=files||pageFiles;
 const [value,setValue]=useState<PlatformConversation>(),[error,setError]=useState(''),[posting,setPosting]=useState(false);
 const [connectionError,setConnectionError]=useState('');
 const [liveConnected,setLiveConnected]=useState(false);
 const connectionIssue=contextError||connectionError;
 const connectionLog=useMemo(()=>createConnectionLogger(),[context.sessionId]);
 const [optimistic,setOptimistic]=useState<{id:string;acceptedId?:string;legacyRunId?:string;message:ChatMessage}[]>([]);
 const retry=useRef<()=>void>(()=>{});
 const client=useRef<PlatformClient|undefined>(undefined);
 const pending=useRef<{key:string;id:string}|undefined>(undefined);
 useEffect(()=>{
  let active=true;
  const current=new PlatformClient(context,request);client.current=current;
  setValue(undefined);setOptimistic([]);setPosting(false);pending.current=undefined;setError('');setConnectionError('');setLiveConnected(false);
  function failed(error:unknown,durationMs:number){
   if(!active)return;
   const message=connectionMessage(error);
   setConnectionError(message);
   setLiveConnected(false);
   connectionLog.failed('realtime',message,durationMs);
  }
  function apply(snapshot:PlatformConversation,connected:boolean){
   if(!active)return;
   setValue(previous=>JSON.stringify(previous)===JSON.stringify(snapshot)?previous:snapshot);
   if(connected){setLiveConnected(true);setConnectionError('');connectionLog.recovered('realtime');}
   setOptimistic(previous=>snapshot.restricted?[]:previous.filter(item=>!snapshot.messages.some(message=>message.role==='user'&&message.user_id===context.userId&&(message.id===item.acceptedId||message.request_id===item.id||!!item.legacyRunId&&message.run_id===item.legacyRunId))));

  }
  const subscription=watchConversation(current,live,{snapshot:apply,error:failed});
  retry.current=()=>{setLiveConnected(false);subscription.retry();};
  return()=>{active=false;subscription.close();client.current=undefined;};
 },[request,live,context.sessionId,connectionLog]);
 useEffect(()=>{
  if(contextError)connectionLog.failed('context',contextError);else connectionLog.recovered('context');
 },[contextError,connectionLog]);
 const active=value?.active_run,activeRun=value?.runs.find(run=>run.id===active?.id);
 const messages=useMemo(()=>{const result:ChatMessage[]=(value?.messages||[]).map(message=>{
  let metadata:{text:string;comments:CommentAnnotation[];attachments?:ChatMessage['attachments'];contextOrder?:ChatMessage['contextOrder']}|undefined;
  if(message.role==='user'&&message.client_context){try{metadata=JSON.parse(message.client_context);}catch{/* Older plain messages remain readable. */}}
  const run=value?.runs.find(item=>item.id===message.run_id);
  const working=message.role==='assistant'&&message.run_id===value?.active_run?.id&&isRunWorking(value?.active_run?.status);
  let mentions:string[]=[];try{mentions=JSON.parse(message.mentions||'[]');}catch{}
  return {id:message.id,userId:message.user_id||undefined,authorName:message.role==='user'?(value?.participants?.find(member=>member.id===message.user_id)?.name||message.user_id||'成员'):'Agent',runId:message.run_id||undefined,taskTitle:working?run?.title:undefined,mentions,canCancel:working&&value?.active_run?.status==='running'&&run?.cancel_supported===1,role:message.role==='user'?'user':'ai',content:metadata?.text??((message.role==='assistant'?runMessageBody(message.body,run):message.body)||(working?'⏳ Agent 正在处理…':message.run_id===value?.active_run?.id&&value.active_run.status==='interrupted'?'任务已中断，请重启需求环境后继续。':'')),comments:metadata?.comments,attachments:metadata?.attachments,contextOrder:metadata?.contextOrder,pending:working,timestamp:message.created_at?Date.parse(message.created_at+'Z'):message.seq};
 });
 for(const item of optimistic)if(!value?.messages.some(message=>message.id===item.acceptedId||message.request_id===item.id))result.push(item.message);
 if(error)result.push({role:'ai',content:error,timestamp:0});
 if(value?.restricted)result.push({role:'ai',content:value.active_run?.status==='interrupted'?'任务已中断，请联系项目编辑成员重启环境。':value.active_run?'Agent 正在处理此需求。':'当前仅开放协作状态，完整对话仅编辑成员可见。',timestamp:0});
 return result;},[value,error,optimistic]);
 const progress=useMemo(()=>conversationProgress(value),[value]);
 const blockedReason=active?.status==='interrupted'?'任务已中断，消息仍可发送；恢复需求环境后继续处理。':value?.agent_paused?'Agent 暂停处理，发送新消息或恢复需求环境后可继续。':'';
 const mentionKey=`prism-mention-seen:${context.sessionId}:${context.userId}`;
 const [mentionTarget,setMentionTarget]=useState<{id:string;seq:number}>();
 useEffect(()=>{
  let seen=0;try{seen=Number(localStorage.getItem(mentionKey)||0);}catch{}
  const last=value?.messages.filter(message=>{try{return message.seq>seen&&JSON.parse(message.mentions||'[]').includes(context.userId);}catch{return false;}}).at(-1);
  setMentionTarget(previous=>last?(previous?.id===last.id?previous:{id:last.id,seq:last.seq}):undefined);
 },[value,mentionKey,context.userId]);

 const chat:ChatState={
  uploadAttachment:(file,signal,onProgress)=>attachmentClient.upload(file,signal,onProgress),
  removeAttachment:id=>attachmentClient.remove(id),
  downloadAttachment:file=>attachmentClient.download(file),
  currentUserId:context.userId,collaborative:true,mentionTarget:mentionTarget?.id,onMentionRead(){if(mentionTarget){try{localStorage.setItem(mentionKey,String(mentionTarget.seq));}catch{}setMentionTarget(undefined);}},
  messages,activityText:isRunWorking(active?.status)?value?.messages.find(m=>m.role==='assistant'&&m.run_id===active?.id)?.body:'',progress:progress.label,activity:progress.tools,sending:posting,blocked:posting||!!connectionIssue||!liveConnected,blockedReason,canCancel:active?.status==='running'&&activeRun?.cancel_supported===1,
  async sendMessage(text,attachments=[],comments=[],agentText,contextOrder){
   if(posting||!client.current||connectionIssue||!liveConnected||context.role==='viewer')return false;
   const current=client.current,message=agentText||text,clientContext={text,comments,contextOrder};
   const attachmentIds=attachments.map(file=>file.id),key=JSON.stringify({message,clientContext,attachmentIds});
   if(pending.current?.key!==key)pending.current={key,id:requestId()};
   setPosting(true);setError('');
   const requestKey=pending.current.id;
   setOptimistic(previous=>[...previous,{id:requestKey,message:{id:'optimistic-'+requestKey,role:'user',userId:context.userId,authorName:context.userId,content:text,comments,attachments,contextOrder,timestamp:Date.now()}}]);

   try{
    const accepted=await current.send(message,pending.current.id,clientContext,attachmentIds);
    if(client.current!==current)return true;
    setOptimistic(previous=>previous.map(item=>item.id===requestKey?{...item,acceptedId:accepted.messageId||undefined,legacyRunId:accepted.messageId?undefined:accepted.id}:item));pending.current=undefined;
    // Acceptance clears the composer immediately; the live reader owns message updates.
    return true;
   }
   catch(e){if(client.current===current){setOptimistic(previous=>previous.filter(item=>item.id!==requestKey));setError(connectionMessage(e));}return false;}
   finally{if(client.current===current)setPosting(false);}
  },
  async cancelCurrent(){try{if(client.current&&value?.active_run)await client.current.cancel(value.active_run.id);}catch(e){setError(connectionMessage(e));}},
  clearHistory(){setError('需求会话由平台统一保存，暂不支持清空');},
  deleteMessage(){setError('需求会话由平台统一保存，暂不支持删除');},
  async startVerification(){setError('平台浏览器测试接口尚未接入');},
  fixVerification(){setError('平台浏览器测试接口尚未接入');},
 };
 if(context.role==='viewer'||value?.restricted)return <div className="p-4 text-xs text-muted-foreground">当前账号仅可预览页面，群聊仅向编辑成员开放。</div>;
 return <StudioPanel surface={surface} chat={chat} context={context} annotations={annotations} actions={actions} connection={{connected:liveConnected&&!connectionIssue,error:connectionIssue,retry:()=>retry.current()}}/>;
}
