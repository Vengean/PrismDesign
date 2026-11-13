import {PlatformClient,type PlatformRequest} from '../../../../packages/ui/src/studio/platform-client';
import {captureChatAnchor,restoreChatAnchor,type ChatScrollAnchor} from '../../../../packages/ui/src/studio/chat-history';
import {toast} from '@/components/ui/toast';
import {observeMentionVisibility,scrollToMention} from '../../../../packages/ui/src/studio/mention-visibility';
import {RunControl} from '../../../../packages/ui/src/studio/RunControl';
import {TestRunDetails} from '../../../../packages/ui/src/studio/ChatPanel';
import type {ChatMessage} from '../../../../packages/ui/src/studio/types';
import {MessageMarkdown} from '../../../../packages/ui/src/studio/MessageMarkdown';
import {useAuth} from '@/hooks/use-auth';
import {conversationProgress} from '../../../../packages/ui/src/studio/conversation-progress';
import {useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {MessageSquare,Send,Loader2} from 'lucide-react';
import {isRunWorking,runMessageBody,connectionMessage} from '../../../../packages/ui/src/studio/run-state';
import {api,type Conversation,type ConversationMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import WorkspaceFiles from './WorkspaceFiles';
import {saveAttachment} from '../../../../packages/ui/src/studio/attachment-client';
const createRequestId=()=>globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
const statusLabels:Record<string,string>={queued:'等待开始',running:'正在处理',cancelling:'正在取消',succeeded:'已完成',failed:'执行失败',cancelled:'已取消',interrupted:'任务已中断'};
export default function RequirementConversation({projectId,requirementId,sessionId,title,editor,readOnly=false}:{projectId:string;requirementId:string;sessionId:string;title:string;editor:boolean;readOnly?:boolean}){
 const {user}=useAuth();
 const following=useRef(true),viewport=useRef<HTMLDivElement>(null);
 const [mentionTarget,setMentionTarget]=useState<{id:string;seq:number}>();
 const mentionKey=`prism-mention-seen:${requirementId}:${user?.id}`;
 const [open,setOpen]=useState(false),[value,setValue]=useState<Conversation>();
 const [messages,setMessages]=useState<ConversationMessage[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');
 const [connectionError,setConnectionError]=useState(''),[recovering,setRecovering]=useState(false),[loadingHistory,setLoadingHistory]=useState(false),[historyError,setHistoryError]=useState('');
 const historyClient=useRef<PlatformClient|undefined>(undefined),historyRequested=useRef(false),historyAnchor=useRef<ChatScrollAnchor|undefined>(undefined),pendingMention=useRef<string|undefined>(undefined);
 const refreshNow=useRef<()=>void>(()=>{});
 const request=useRef<{message:string;id:string}|undefined>(undefined);
 const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open||!editor)return;let active=true,fetching=false;
  following.current=true;historyRequested.current=false;historyAnchor.current=undefined;pendingMention.current=undefined;setLoadingHistory(false);setHistoryError('');
  const request:PlatformRequest=async<T,>(path:string)=>{const query=new URL(path,'http://platform').searchParams;return await api.getConversation(projectId,requirementId,Number(query.get('after')||0),Number(query.get('eventAfter')||0),query.get('wait')==='1',query.get('liveAfter')||'',{latest:query.get('latest')==='1',before:query.has('before')?Number(query.get('before')):undefined,sessionId}) as T;};
  const current=new PlatformClient({protocol:1,projectId,requirementId,sessionId,projectName:'',title,userId:user?.id||'',role:'editor'},request);historyClient.current=current;
  setValue(undefined);setConnectionError('');setMessages([]);setProgress('');setError('');
  async function refresh(wait=false){if(fetching)return;fetching=true;try{
   const result=await current.sync(wait);if(!active)return;
   setValue(result);setMessages(result.messages);setProgress(conversationProgress(result).label);setConnectionError('');
  }catch(e){if(active)setConnectionError('无法连接平台服务，任务状态暂时无法确认。请检查网络后重试。');await new Promise(resolve=>setTimeout(resolve,1000));}finally{fetching=false;}}
  refreshNow.current=()=>{void refresh();};
  void (async()=>{await refresh();while(active)await refresh(true);})();return()=>{active=false;if(historyClient.current===current)historyClient.current=undefined;};
 },[open,editor,projectId,requirementId,sessionId,user?.id,title]);
 useLayoutEffect(()=>{if(!viewport.current)return;if(historyAnchor.current&&restoreChatAnchor(viewport.current,historyAnchor.current))historyAnchor.current=undefined;if(pendingMention.current&&messages.some(message=>message.id===pendingMention.current)){scrollToMention(viewport.current,pendingMention.current,user?.id);pendingMention.current=undefined;}},[messages,user?.id]);
 async function loadHistory(){
  const current=historyClient.current;if(!current||historyRequested.current)return false;
  historyRequested.current=true;following.current=false;if(viewport.current)historyAnchor.current=captureChatAnchor(viewport.current);setLoadingHistory(true);setHistoryError('');
  try{const snapshot=await current.loadOlder();if(historyClient.current!==current)return false;setValue(snapshot);setMessages(snapshot.messages);return true;}
  catch(error){if(historyClient.current===current){setHistoryError((error as Error).message);historyAnchor.current=undefined;}return false;}
  finally{if(historyClient.current===current){historyRequested.current=false;setLoadingHistory(false);}}
 }
 async function jumpToMention(){
  const current=historyClient.current,target=mentionTarget;if(!current||!target||!viewport.current)return;following.current=false;
  if(messages.some(message=>message.id===target.id)){scrollToMention(viewport.current,target.id,user?.id);return;}
  pendingMention.current=target.id;
  while(historyClient.current===current&&!current.snapshot()?.messages.some(message=>message.id===target.id)){
   const previous=current.snapshot()?.oldest_message_cursor;if(!current.snapshot()?.has_more_history||!await loadHistory()||previous===current.snapshot()?.oldest_message_cursor)break;
  }
 }
 useEffect(()=>{if(open&&following.current&&viewport.current)viewport.current.scrollTop=viewport.current.scrollHeight;},[messages.at(-1)?.id,messages.at(-1)?.body,open]);
 useEffect(()=>{let seen=0;try{seen=Number(localStorage.getItem(mentionKey)||0);}catch{}const loaded=[...messages,...(value?.current_messages||[])].filter(message=>{try{return message.seq>seen&&JSON.parse(message.mentions||'[]').includes(user?.id);}catch{return false;}}).sort((a,b)=>a.seq-b.seq).at(-1);const latest=value?.latest_mention,last=latest&&latest.seq>seen&&(!loaded||latest.seq>loaded.seq)?latest:loaded;setMentionTarget(last?{id:last.id,seq:last.seq}:undefined);},[messages,value?.latest_mention,value?.current_messages,mentionKey,user?.id]);
 useEffect(()=>{
  if(!open||!mentionTarget||!viewport.current)return;
  return observeMentionVisibility(viewport.current,mentionTarget.id,user?.id,()=>{try{localStorage.setItem(mentionKey,String(mentionTarget.seq));}catch{}setMentionTarget(undefined);});
 },[open,mentionTarget,mentionKey,user?.id,messages]);
 async function send(e:FormEvent){e.preventDefault();if(!draft.trim()||busy||!value||connectionError||recovering)return;setBusy(true);setError('');
  try{if(request.current?.message!==draft)request.current={message:draft,id:createRequestId()};await api.sendConversation(projectId,requirementId,draft,request.current.id);request.current=undefined;setDraft(current=>current===draft?'':current);refreshNow.current();}catch(e){toast.error(connectionMessage(e));}finally{setBusy(false);}}
 async function download(path:string){setError('');try{saveAttachment(await api.downloadWorkspaceFile(projectId,requirementId,path),path.split('/').at(-1)||'download');}catch(error){toast.error((error as Error).message);}}
 async function cancel(){const run=value?.active_run;if(!run)return;setBusy(true);setError('');try{await api.cancelConversation(projectId,requirementId,run.id);}catch(e){toast.error(connectionMessage(e));}finally{setBusy(false);}}
 useEffect(()=>{
  if(!recovering||!open)return;let active=true,fetching=false;
  async function check(){if(fetching)return;fetching=true;try{const environment=await api.getEnvironment(projectId,requirementId);if(!active)return;
   if(environment.status==='running'){setRecovering(false);toast.success('环境已恢复，可以重新发送消息。');refreshNow.current();}
   else if(environment.status==='failed'){setRecovering(false);setError(environment.error||'环境重启失败，请检查启动日志后重试。');}
  }catch{if(active){setRecovering(false);setError('无法获取环境恢复状态，请检查网络后重试。');}}finally{fetching=false;}}
  const timer=setInterval(check,1000);return()=>{active=false;clearInterval(timer);};
 },[recovering,open,projectId,requirementId]);
 async function recover(){if(recovering)return;setError('');setRecovering(true);try{await api.environmentAction(projectId,requirementId,'start');}catch(e){setRecovering(false);setError(connectionMessage(e));}}
 const active=value?.active_run,run=value?.runs.find(r=>r.id===active?.id),latestRun=value?.runs[0];
 if(!editor)return null;
 return <>
  <Button size="sm" aria-label="与 Agent 对话" onClick={()=>setOpen(true)}><MessageSquare size={14}/>{editor?'Agent 对话':'协作状态'}</Button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>对话与执行记录保存在需求会话中，关闭窗口后任务继续运行。</DialogDescription></DialogHeader>
   <div data-conversation-viewport ref={viewport} onWheel={event=>{if(event.deltaY<0&&event.currentTarget.scrollTop<40&&value?.has_more_history&&!historyError)void loadHistory();}} onScroll={event=>{const el=event.currentTarget;following.current=el.scrollHeight-el.clientHeight-el.scrollTop<48;if(el.scrollTop<40&&value?.has_more_history&&!loadingHistory&&!historyError)void loadHistory();}} className="min-h-48 flex-1 space-y-4 overflow-y-auto p-1">
    {(value?.has_more_history||loadingHistory||historyError)&&<div className="flex min-h-8 items-center justify-center text-xs text-muted-foreground"><button type="button" className="px-2 py-1 hover:text-foreground disabled:opacity-60" disabled={loadingHistory} onClick={()=>{void loadHistory();}}>{loadingHistory?'正在加载更早消息…':historyError?'历史消息加载失败，点击重试':'加载更早消息'}</button></div>}
    {value?.restricted?<p className="text-sm text-muted-foreground">当前可查看协作状态，完整对话可能包含源码，仅编辑成员可见。</p>:messages.length?messages.map(m=>{const messageRun=value?.runs.find(item=>item.id===m.run_id);const processing=m.run_id===active?.id&&isRunWorking(active?.status)&&!connectionError&&!recovering;
     let testing:Pick<ChatMessage,'testRun'|'verification'>={};if(m.role==='assistant'){try{testing=JSON.parse((m as typeof m&{client_context?:string}).client_context||'{}');}catch{}}
     const own=m.role==='user'&&m.user_id===user?.id;let ids:string[]=[];try{ids=JSON.parse(m.mentions||'[]');}catch{}
     return <div key={m.id} data-message-id={m.id} className={`flex items-start gap-2 ${own?'justify-end':''}`}>
      <div className="min-w-0 max-w-[85%]">{!own&&<div className="message-author mb-1 text-xs leading-5 text-muted-foreground">{m.user_id||'Agent'}</div>}
      <div className={`rounded-xl px-3 py-2 ${m.role==='user'?'bg-muted':'bg-background'}`}>
       {m.role==='assistant'&&processing&&run?.title&&<p className="message-task-title mb-1 text-sm font-normal leading-7">{run.title}</p>}
       {m.role==='assistant'&&processing?<div className="flex items-start gap-2 text-sm leading-7 text-muted-foreground"><RunControl canStop={run?.cancel_supported===1&&active?.status==='running'} onStop={cancel} disabled={busy} className="mt-0.5"/><span className="flex-1">{progress||'Agent 正在处理…'}</span></div>:<div className="chat-markdown text-sm leading-7 [overflow-wrap:anywhere]"><MessageMarkdown onWorkspaceDownload={path=>{void download(path);}} mentions={JSON.stringify(ids)} currentUserId={user?.id} content={(m.role==='assistant'?runMessageBody(m.body,messageRun):m.body)||(m.run_id===active?.id&&active.status==='interrupted'?'任务已中断，请重启环境后继续。':'本轮未返回文本')}/></div>}
      {testing.testRun&&<div className="mt-3 text-xs"><TestRunDetails run={testing.testRun}/></div>}
      </div></div></div>}):<p className="py-12 text-center text-sm text-muted-foreground">描述这个需求需要修改的内容，开始协作。</p>}
    {active?.status==='interrupted'&&editor&&!readOnly&&!connectionError&&!recovering&&<div className="pl-4"><Button size="sm" variant="outline" onClick={recover}>重启需求环境</Button></div>}
    <div ref={bottom}/>
   </div>
   <div className="space-y-3 border-t pt-3">
    <WorkspaceFiles projectId={projectId} requirementId={requirementId}/>
    {mentionTarget&&<button type="button" className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-900" onClick={()=>{void jumpToMention();}}>有人 @ 了你 · 查看消息</button>}
    {active&&!connectionError&&!recovering?<div role="status" className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1.5">{isRunWorking(active.status)&&<Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true"/>}{statusLabels[active.status] || active.status}{active.user_id&&` · ${active.user_id}`} {active.status==='running'&&progress&&` · ${progress}`}</span>{isRunWorking(active.status)&&!messages.some(message=>message.role==='assistant'&&message.run_id===active.id)&&<RunControl canStop={active.status==='running'&&run?.cancel_supported===1} onStop={cancel} disabled={busy}/>}</div>:!connectionError&&!recovering&&latestRun&&<p className="text-xs text-muted-foreground">上次任务{statusLabels[latestRun.status]}</p>}
    {recovering&&<p role="status" className="text-xs text-muted-foreground">正在重启需求环境，源码和历史对话会保留，请稍候…</p>}
    {connectionError&&<div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive"><span>{connectionError}</span><Button size="sm" variant="outline" onClick={()=>refreshNow.current()}>重试连接</Button></div>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    {editor&&!readOnly&&<form onSubmit={send} className="flex items-end gap-2"><textarea aria-label="发送给 Agent 的消息" className="min-h-24 flex-1 resize-none rounded-xl border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder={recovering?'环境恢复中，可先编辑消息…':connectionError?'连接异常，可先保留消息草稿…':active?.status==='interrupted'?'任务已中断，可先发送消息，恢复环境后处理…':active?'Agent 处理中，仍可发送消息…':'描述你想完成的修改…'} maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="submit" disabled={busy||!value||!!connectionError||recovering||!draft.trim()} aria-label="发送消息"><Send size={16}/></Button></form>}
   </div>
  </DialogContent></Dialog>
 </>;
}
