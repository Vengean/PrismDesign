import {conversationProgress} from './conversation-progress.js';
import {isCancellationNotice,pendingMessageBoundary} from './conversation-presentation.js';
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

export function PlatformPanel({context,contextError,request,live=pageConversationLive,files,annotations,actions,surface,browser,headerOverlay,enabled=true}:{headerOverlay?:ReactNode;enabled?:boolean;contextError?:string;surface:'widget'|'extension';context:PlatformContext;request:PlatformRequest;live?:ConversationLive;files?:AttachmentClient;annotations:AnnotationAdapter;actions?:ReactNode;browser?:{prepare:()=>Promise<string>}}){
 const pageFiles=useMemo(()=>pageAttachmentClient(context.sessionId),[context.sessionId]),attachmentClient=files||pageFiles;
 const [value,setValue]=useState<PlatformConversation>(),[error,setError]=useState(''),[posting,setPosting]=useState(false);
 const [connectionError,setConnectionError]=useState('');
 const [liveConnected,setLiveConnected]=useState(false),[loadingHistory,setLoadingHistory]=useState(false),[historyError,setHistoryError]=useState('');
 const connectionIssue=contextError||connectionError;
 const connectionLog=useMemo(()=>createConnectionLogger(),[context.sessionId]);
 const [optimistic,setOptimistic]=useState<{id:string;acceptedId?:string;legacyRunId?:string;message:ChatMessage}[]>([]);
 const retry=useRef<()=>void>(()=>{});
 const client=useRef<PlatformClient|undefined>(undefined);
 const clientRequest=useRef<PlatformRequest|undefined>(undefined);
 const pending=useRef<{key:string;id:string}|undefined>(undefined);
 const [pageVisible,setPageVisible]=useState(()=>typeof document==='undefined'||document.visibilityState!=='hidden');
 useEffect(()=>{const update=()=>setPageVisible(document.visibilityState!=='hidden');document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 useEffect(()=>()=>{client.current=undefined;clientRequest.current=undefined;},[]);
 useEffect(()=>{
  if(!enabled||!pageVisible){setLiveConnected(false);return;}
  let active=true;
  const previous=client.current;
  const reuse=previous?.context.sessionId===context.sessionId&&previous.context.userId===context.userId&&clientRequest.current===request;
  const current=reuse?previous!:new PlatformClient(context,request);client.current=current;clientRequest.current=request;
  if(!reuse){setValue(undefined);setOptimistic([]);setPosting(false);pending.current=undefined;setError('');setLoadingHistory(false);setHistoryError('');}
  setConnectionError('');setLiveConnected(false);
  function failed(error:unknown,durationMs:number){
   if(!active)return;
   const message=connectionMessage(error);
   setConnectionError(message);
   setLiveConnected(false);
   connectionLog.failed('realtime',message,durationMs);
  }
  function apply(snapshot:PlatformConversation,connected:boolean){
   if(!active)return;
   setValue(snapshot);
   if(connected){setLiveConnected(true);setConnectionError('');connectionLog.recovered('realtime');}
   setOptimistic(previous=>{
    if(!previous.length)return previous;
    const next=snapshot.restricted?[]:previous.filter(item=>!snapshot.messages.some(message=>message.role==='user'&&message.user_id===context.userId&&(message.id===item.acceptedId||message.request_id===item.id||!!item.legacyRunId&&message.run_id===item.legacyRunId)));
    return next.length===previous.length?previous:next;
   });

  }
  const subscription=watchConversation(current,live,{snapshot:apply,error:failed});
  retry.current=()=>{setLiveConnected(false);subscription.retry();};
  return()=>{active=false;subscription.close();};
 },[request,live,context.sessionId,context.userId,connectionLog,enabled,pageVisible]);
 useEffect(()=>{
  if(contextError)connectionLog.failed('context',contextError);else connectionLog.recovered('context');
 },[contextError,connectionLog]);
 const active=value?.active_run,activeRun=value?.runs.find(run=>run.id===active?.id);
 const messages=useMemo(()=>{const result:ChatMessage[]=(value?.messages||[]).map(message=>{
  let metadata:{text:string;comments:CommentAnnotation[];attachments?:ChatMessage['attachments'];contextOrder?:ChatMessage['contextOrder']}|undefined;
  if(message.role==='user'&&message.client_context){try{metadata=JSON.parse(message.client_context);}catch{/* Older plain messages remain readable. */}}
  let testing:Pick<ChatMessage,'verification'|'testRun'>={};if(message.role==='assistant'){try{testing=JSON.parse(message.client_context||'{}');}catch{}}
  const run=value?.runs.find(item=>item.id===message.run_id);
  const working=message.role==='assistant'&&message.run_id===value?.active_run?.id&&isRunWorking(value?.active_run?.status);
  let mentions:string[]=[];try{mentions=JSON.parse(message.mentions||'[]');}catch{}
  return {systemNotice:message.role==='assistant'&&isCancellationNotice(message.client_context),verification:testing.verification,testRun:testing.testRun,id:message.id,userId:message.user_id||undefined,authorName:message.role==='user'?(value?.participants?.find(member=>member.id===message.user_id)?.name||message.user_id||'成员'):'Agent',runId:message.run_id||undefined,taskTitle:working?run?.title:undefined,mentions,canCancel:working&&value?.active_run?.status==='running'&&run?.cancel_supported===1,role:message.role==='user'?'user':'ai',content:metadata?.text??((message.role==='assistant'?runMessageBody(message.body,run):message.body)||(working?'⏳ Agent 正在处理…':message.run_id===value?.active_run?.id&&value.active_run.status==='interrupted'?'任务已中断，请重启需求环境后继续。':'')),comments:metadata?.comments,attachments:metadata?.attachments,contextOrder:metadata?.contextOrder,pending:working,timestamp:message.created_at?Date.parse(message.created_at+'Z'):message.seq};
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
  const loaded=value?[...value.messages,...value.current_messages].filter(message=>{try{return message.seq>seen&&JSON.parse(message.mentions||'[]').includes(context.userId);}catch{return false;}}).sort((a,b)=>a.seq-b.seq).at(-1):undefined;
  const latest=value?.latest_mention;const last=latest&&latest.seq>seen&&(!loaded||latest.seq>loaded.seq)?latest:loaded;
  setMentionTarget(previous=>last?(previous?.id===last.id?previous:{id:last.id,seq:last.seq}):undefined);
 },[value,mentionKey,context.userId]);

 async function loadOlder(){
  const current=client.current;if(!current)return false;
  setLoadingHistory(true);setHistoryError('');
  try{const snapshot=await current.loadOlder();if(client.current!==current)return false;setValue(snapshot);return true;}
  catch(error){if(client.current===current)setHistoryError(connectionMessage(error));return false;}
  finally{if(client.current===current)setLoadingHistory(false);}
 }
 async function loadMention(){
  const current=client.current,target=mentionTarget;if(!current||!target)return;
  while(client.current===current&&!current.snapshot()?.messages.some(message=>message.id===target.id)){
   const previous=current.snapshot()?.oldest_message_cursor;if(!current.snapshot()?.has_more_history||!await loadOlder()||current.snapshot()?.oldest_message_cursor===previous)break;
  }
 }
 async function test(verification:{goal:string;proposedChecks:string[]}){
  if(!browser){setError('请在 Chrome 插件中打开当前需求预览，再开始测试');return;}
  setError('');setPosting(true);try{const bindingId=await browser.prepare();await request('/testing/start?sessionId='+encodeURIComponent(context.sessionId),'POST',{bindingId,goal:verification.goal,proposedChecks:verification.proposedChecks,requestId:requestId()});}catch(error){setError(connectionMessage(error));}finally{setPosting(false);}
 }
 const chat:ChatState={
  waitingMessageId:pendingMessageBoundary(value),
  uploadAttachment:(file,signal,onProgress)=>attachmentClient.upload(file,signal,onProgress),
  removeAttachment:id=>attachmentClient.remove(id),
  downloadAttachment:file=>attachmentClient.download(file),
  downloadWorkspaceFile:attachmentClient.downloadWorkspaceFile?path=>attachmentClient.downloadWorkspaceFile!(path):undefined,
  loadWorkspaceImage:attachmentClient.loadWorkspaceImage,
  hasMoreHistory:value?.has_more_history,loadingHistory,historyError,loadOlder,loadMention,
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
    const browserBindingId=browser?await browser.prepare():undefined;
    const accepted=await current.send(message,pending.current.id,clientContext,attachmentIds,browserBindingId);
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
  async startVerification(verification){await test(verification);},
  fixVerification(verification,testRun){void chat.sendMessage(`请根据测试结果修复问题，修复完成后提出复测，暂不自动测试。\n目标：${verification.goal}\n失败分类：${verification.failureCategory||'unknown'}\n修复建议：${verification.fixSuggestion||''}\n失败用例：${JSON.stringify(testRun?.cases?.filter(item=>item.status==='failed')||[])}`);},
 };
 if(context.role==='viewer'||value?.restricted)return <div className="p-4 text-xs text-muted-foreground">当前账号仅可预览页面，群聊仅向编辑成员开放。</div>;
 return <StudioPanel headerOverlay={headerOverlay} surface={surface} chat={chat} context={context} annotations={annotations} actions={actions} connection={{connected:liveConnected&&!connectionIssue,error:connectionIssue,retry:()=>retry.current()}}/>;
}
