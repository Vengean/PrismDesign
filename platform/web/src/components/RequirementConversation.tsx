import {observeMentionVisibility} from '../../../../packages/ui/src/studio/mention-visibility';
import {MessageMarkdown} from '../../../../packages/ui/src/studio/MessageMarkdown';
import {useAuth} from '@/hooks/use-auth';
import {conversationProgress} from '../../../../packages/ui/src/studio/conversation-progress';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {MessageSquare,Send,Square,Loader2} from 'lucide-react';
import {isRunWorking,runMessageBody,connectionMessage} from '../../../../packages/ui/src/studio/run-state';
import {api,type Conversation,type ConversationMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
const createRequestId=()=>globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
const statusLabels:Record<string,string>={queued:'等待开始',running:'正在处理',cancelling:'正在取消',succeeded:'已完成',failed:'执行失败',cancelled:'已取消',interrupted:'任务已中断'};
export default function RequirementConversation({projectId,requirementId,title,editor}:{projectId:string;requirementId:string;title:string;editor:boolean}){
 const {user}=useAuth();
 const following=useRef(true),viewport=useRef<HTMLDivElement>(null);
 const [mentionTarget,setMentionTarget]=useState<{id:string;seq:number}>();
 const mentionKey=`prism-mention-seen:${requirementId}:${user?.id}`;
 const [open,setOpen]=useState(false),[value,setValue]=useState<Conversation>();
 const [messages,setMessages]=useState<ConversationMessage[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');
 const [connectionError,setConnectionError]=useState(''),[recovering,setRecovering]=useState(false),[recovered,setRecovered]=useState(false);
 const refreshNow=useRef<()=>void>(()=>{});
 const request=useRef<{message:string;id:string}|undefined>(undefined);
 const cursors=useRef({message:0,event:0,live:''});const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open||!editor)return;let active=true,fetching=false;const events=new Map<string,Conversation['events'][number]>();
  cursors.current={message:0,event:0,live:''};setValue(undefined);setConnectionError('');setMessages([]);setProgress('');setError('');
  async function refresh(wait=false){if(fetching)return;fetching=true;try{
   const result=await api.getConversation(projectId,requirementId,cursors.current.message,cursors.current.event,wait,cursors.current.live);
   if(!active)return;
   cursors.current={message:result.next_message_cursor,event:result.next_event_cursor,live:result.next_live_cursor || ''};for(const [key,event] of events)if(event.transient)events.delete(key);if(result.restricted)events.clear();else for(const event of result.events){
    if(event.type==='message.delta')for(const [seq,old] of events)if(old.type==='message.delta'&&old.data.runId===event.data.runId)events.delete(seq);
    events.set(`${event.transient?'live':'db'}:${event.seq}`,event);
   }
   while(events.size>400)events.delete(events.keys().next().value!);
   const snapshot={...result,events:[...events.values()].sort((a,b)=>a.seq-b.seq)};
   setValue(snapshot);setProgress(conversationProgress(snapshot).label);setConnectionError('');
   if(result.active_run?.status!=='running')setProgress('');
   if(result.restricted){setMessages([]);setProgress('');return;}
   setMessages(previous=>{const map=new Map(previous.map(m=>[m.id,m]));for(const m of [...result.messages,...result.current_messages])map.set(m.id,m);return [...map.values()].sort((a,b)=>a.seq-b.seq);});

  }catch(e){if(active)setConnectionError('无法连接平台服务，任务状态暂时无法确认。请检查网络后重试。');await new Promise(resolve=>setTimeout(resolve,1000));}finally{fetching=false;}}
  refreshNow.current=()=>{void refresh();};
  void (async()=>{await refresh();while(active)await refresh(true);})();return()=>{active=false;};
 },[open,editor,projectId,requirementId]);
 useEffect(()=>{if(open&&following.current)bottom.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages.at(-1)?.id,messages.at(-1)?.body,open]);
 useEffect(()=>{let seen=0;try{seen=Number(localStorage.getItem(mentionKey)||0);}catch{}const last=messages.filter(message=>{try{return message.seq>seen&&JSON.parse(message.mentions||'[]').includes(user?.id);}catch{return false;}}).at(-1);setMentionTarget(last?{id:last.id,seq:last.seq}:undefined);},[messages,mentionKey,user?.id]);
 useEffect(()=>{
  if(!open||!mentionTarget||!viewport.current)return;
  return observeMentionVisibility(viewport.current,mentionTarget.id,user?.id,()=>{try{localStorage.setItem(mentionKey,String(mentionTarget.seq));}catch{}setMentionTarget(undefined);});
 },[open,mentionTarget,mentionKey,user?.id,messages]);
 async function send(e:FormEvent){e.preventDefault();if(!draft.trim()||busy||!value||connectionError||recovering)return;setBusy(true);setError('');setRecovered(false);
  try{if(request.current?.message!==draft)request.current={message:draft,id:createRequestId()};await api.sendConversation(projectId,requirementId,draft,request.current.id);request.current=undefined;setDraft(current=>current===draft?'':current);refreshNow.current();}catch(e){setError(connectionMessage(e));}finally{setBusy(false);}}
 async function cancel(){const run=value?.active_run;if(!run)return;setBusy(true);setError('');try{await api.cancelConversation(projectId,requirementId,run.id);}catch(e){setError(connectionMessage(e));}finally{setBusy(false);}}
 useEffect(()=>{
  if(!recovering||!open)return;let active=true,fetching=false;
  async function check(){if(fetching)return;fetching=true;try{const environment=await api.getEnvironment(projectId,requirementId);if(!active)return;
   if(environment.status==='running'){setRecovering(false);setRecovered(true);refreshNow.current();}
   else if(environment.status==='failed'){setRecovering(false);setError(environment.error||'环境重启失败，请检查启动日志后重试。');}
  }catch{if(active){setRecovering(false);setError('无法获取环境恢复状态，请检查网络后重试。');}}finally{fetching=false;}}
  const timer=setInterval(check,1000);return()=>{active=false;clearInterval(timer);};
 },[recovering,open,projectId,requirementId]);
 async function recover(){if(recovering)return;setError('');setRecovered(false);setRecovering(true);try{await api.environmentAction(projectId,requirementId,'start');}catch(e){setRecovering(false);setError(connectionMessage(e));}}
 const active=value?.active_run,run=value?.runs.find(r=>r.id===active?.id),latestRun=value?.runs[0];
 if(!editor)return null;
 return <>
  <Button size="sm" variant="outline" onClick={()=>setOpen(true)}><MessageSquare size={14}/>{editor?'与 Agent 对话':'协作状态'}</Button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>对话与执行记录保存在需求会话中，关闭窗口后任务继续运行。</DialogDescription></DialogHeader>
   <div ref={viewport} onScroll={event=>{const el=event.currentTarget;following.current=el.scrollHeight-el.clientHeight-el.scrollTop<48;}} className="min-h-48 flex-1 space-y-4 overflow-y-auto p-1">
    {value?.restricted?<p className="text-sm text-muted-foreground">当前可查看协作状态，完整对话可能包含源码，仅编辑成员可见。</p>:messages.length?messages.map(m=>{const messageRun=value?.runs.find(item=>item.id===m.run_id);const processing=m.run_id===active?.id&&isRunWorking(active?.status)&&!connectionError&&!recovering;
     const own=m.role==='user'&&m.user_id===user?.id;let ids:string[]=[];try{ids=JSON.parse(m.mentions||'[]');}catch{}
     return <div key={m.id} data-message-id={m.id} className={`flex items-start gap-2 ${own?'justify-end':''}`}>
      <div className="min-w-0 max-w-[85%]">{!own&&<div className="message-author mb-1 text-xs leading-5 text-muted-foreground">{m.user_id||'Agent'}</div>}
      <div className={`rounded-xl px-3 py-2 ${m.role==='user'?'bg-muted':'bg-background'}`}>
       {m.role==='assistant'&&processing&&run?.title&&<p className="message-task-title mb-1 text-sm font-normal leading-7">{run.title}</p>}
       {m.role==='assistant'&&processing?<div className="flex items-start gap-2 text-sm leading-7 text-muted-foreground"><Loader2 size={14} className="mt-1.5 shrink-0 animate-spin"/><span className="flex-1">{progress||'Agent 正在处理…'}</span>{run?.cancel_supported===1&&active?.status==='running'&&<button type="button" disabled={busy} onClick={cancel} aria-label="取消运行" title="取消运行" className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"><Square size={12} className="fill-current" aria-hidden="true"/></button>}</div>:<div className="chat-markdown text-sm leading-7 [overflow-wrap:anywhere]"><MessageMarkdown mentions={JSON.stringify(ids)} currentUserId={user?.id} content={(m.role==='assistant'?runMessageBody(m.body,messageRun):m.body)||(m.run_id===active?.id&&active.status==='interrupted'?'任务已中断，请重启环境后继续。':'本轮未返回文本')}/></div>}
      </div></div></div>}):<p className="py-12 text-center text-sm text-muted-foreground">描述这个需求需要修改的内容，开始协作。</p>}
    {active?.status==='interrupted'&&editor&&!connectionError&&!recovering&&<div className="pl-4"><Button size="sm" variant="outline" onClick={recover}>重启需求环境</Button></div>}
    <div ref={bottom}/>
   </div>
   <div className="space-y-3 border-t pt-3">
    {mentionTarget&&<button type="button" className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-900" onClick={()=>{following.current=false;Array.from(viewport.current?.querySelectorAll<HTMLElement>('[data-message-id]')||[]).find(el=>el.dataset.messageId===mentionTarget.id)?.scrollIntoView({block:'center'});}}>有人 @ 了你 · 查看消息</button>}
    {active&&!connectionError&&!recovering?<div role="status" className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span className="flex items-center gap-1.5">{isRunWorking(active.status)&&<Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true"/>}{statusLabels[active.status] || active.status}{active.user_id&&` · ${active.user_id}`}{active.status==='running'&&progress&&` · ${progress}`}</span></div>:!connectionError&&!recovering&&latestRun&&<p className="text-xs text-muted-foreground">上次任务{statusLabels[latestRun.status]}</p>}
    {recovering&&<p role="status" className="text-xs text-muted-foreground">正在重启需求环境，源码和历史对话会保留，请稍候…</p>}
    {recovered&&<p role="status" className="text-xs text-muted-foreground">环境已恢复，可以重新发送消息。</p>}
    {connectionError&&<div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive"><span>{connectionError}</span><Button size="sm" variant="outline" onClick={()=>refreshNow.current()}>重试连接</Button></div>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    {editor&&<form onSubmit={send} className="flex items-end gap-2"><textarea aria-label="发送给 Agent 的消息" className="min-h-24 flex-1 resize-none rounded-xl border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder={recovering?'环境恢复中，可先编辑消息…':connectionError?'连接异常，可先保留消息草稿…':active?.status==='interrupted'?'任务已中断，可先发送消息，恢复环境后处理…':active?'Agent 处理中，仍可发送消息…':'描述你想完成的修改…'} maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="submit" disabled={busy||!value||!!connectionError||recovering||!draft.trim()} aria-label="发送消息"><Send size={16}/></Button></form>}
   </div>
  </DialogContent></Dialog>
 </>;
}
