import {useEffect,useRef,useState,type FormEvent} from 'react';
import {MessageSquare,Send,Square} from 'lucide-react';
import {isRunWorking,runMessageBody,connectionMessage} from '../../../../packages/ui/src/studio/run-state';
import {api,type Conversation,type ConversationMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
const createRequestId=()=>globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
const statusLabels:Record<string,string>={queued:'等待开始',running:'正在处理',cancelling:'正在取消',succeeded:'已完成',failed:'执行失败',cancelled:'已取消',interrupted:'任务已中断'};
export default function RequirementConversation({projectId,requirementId,title,editor}:{projectId:string;requirementId:string;title:string;editor:boolean}){
 const [open,setOpen]=useState(false),[value,setValue]=useState<Conversation>();
 const [messages,setMessages]=useState<ConversationMessage[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('');
 const [connectionError,setConnectionError]=useState(''),[recovering,setRecovering]=useState(false),[recovered,setRecovered]=useState(false);
 const refreshNow=useRef<()=>void>(()=>{});
 const request=useRef<{message:string;id:string}|undefined>(undefined);
 const cursors=useRef({message:0,event:0});const bottom=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  if(!open)return;let active=true,fetching=false;
  cursors.current={message:0,event:0};setValue(undefined);setConnectionError('');setMessages([]);setProgress('');setError('');
  async function refresh(){if(fetching)return;fetching=true;try{
   const result=await api.getConversation(projectId,requirementId,cursors.current.message,cursors.current.event);
   if(!active)return;
   cursors.current={message:result.next_message_cursor,event:result.next_event_cursor};setValue(result);setConnectionError('');
   if(result.active_run?.status!=='running')setProgress('');
   if(result.restricted){setMessages([]);setProgress('');return;}
   setMessages(previous=>{const map=new Map(previous.map(m=>[m.id,m]));for(const m of [...result.messages,...result.current_messages])map.set(m.id,m);return [...map.values()].sort((a,b)=>a.seq-b.seq);});
   const latest=[...result.events].reverse().find(e=>e.type==='tool.started'&&e.data.runId===result.active_run?.id);if(latest)setProgress(String(latest.data.label || '正在执行工具'));
  }catch(e){if(active)setConnectionError('无法连接平台服务，任务状态暂时无法确认。请检查网络后重试。');}finally{fetching=false;}}
  refreshNow.current=()=>{void refresh();};
  void refresh();const timer=setInterval(refresh,1000);return()=>{active=false;clearInterval(timer);};
 },[open,projectId,requirementId]);
 useEffect(()=>{if(open)bottom.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages.at(-1)?.id,messages.at(-1)?.body,open]);
 async function send(e:FormEvent){e.preventDefault();if(!draft.trim()||busy||value?.active_run||!value||connectionError||recovering)return;setBusy(true);setError('');setRecovered(false);
  try{if(request.current?.message!==draft)request.current={message:draft,id:createRequestId()};await api.sendConversation(projectId,requirementId,draft,request.current.id);request.current=undefined;setDraft(current=>current===draft?'':current);setProgress('正在准备执行…');setValue(v=>v?{...v,active_run:{id:'pending',status:'queued',user_id:''}}:v);}catch(e){setError(connectionMessage(e));}finally{setBusy(false);}}
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
 return <>
  <Button size="sm" variant="outline" onClick={()=>setOpen(true)}><MessageSquare size={14}/>{editor?'与 Agent 对话':'协作状态'}</Button>
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>对话与执行记录保存在需求会话中，关闭窗口后任务继续运行。</DialogDescription></DialogHeader>
   <div className="min-h-48 flex-1 space-y-4 overflow-y-auto p-1" aria-live="polite">
    {value?.restricted?<p className="text-sm text-muted-foreground">当前可查看协作状态，完整对话可能包含源码，仅编辑成员可见。</p>:messages.length?messages.map(m=>{const messageRun=value?.runs.find(item=>item.id===m.run_id);const processing=m.run_id===active?.id&&isRunWorking(active?.status)&&!connectionError&&!recovering;return <div key={m.id} className={`max-w-[95%] rounded-2xl px-4 py-3 ${m.role==='user'?'ml-auto bg-muted':'border bg-background'}`}><p className="mb-2 text-[11px] text-muted-foreground">{m.role==='user'?m.user_id:'Agent'}</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{(m.role==='assistant'?runMessageBody(m.body,messageRun):m.body)||(m.run_id===active?.id&&active.status==='interrupted'?'任务已中断，请重启环境后继续。':processing?'正在处理…':connectionError?'服务连接异常，暂时无法获取回复。':'本轮未返回文本')}</p></div>}):<p className="py-12 text-center text-sm text-muted-foreground">描述这个需求需要修改的内容，开始协作。</p>}
    {active?.status==='interrupted'&&editor&&!connectionError&&!recovering&&<div className="pl-4"><Button size="sm" variant="outline" onClick={recover}>重启需求环境</Button></div>}
    <div ref={bottom}/>
   </div>
   <div className="space-y-3 border-t pt-3">
    {active&&!connectionError&&!recovering?<div role="status" className="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>{statusLabels[active.status] || active.status}{active.user_id&&` · ${active.user_id}`}{active.status==='running'&&progress&&` · ${progress}`}</span>{editor&&run?.cancel_supported===1&&active.status==='running'&&<Button size="sm" variant="ghost" disabled={busy} onClick={cancel}><Square size={12}/>取消任务</Button>}</div>:!connectionError&&!recovering&&latestRun&&<p className="text-xs text-muted-foreground">上次任务{statusLabels[latestRun.status]}</p>}
    {recovering&&<p role="status" className="text-xs text-muted-foreground">正在重启需求环境，源码和历史对话会保留，请稍候…</p>}
    {recovered&&<p role="status" className="text-xs text-muted-foreground">环境已恢复，可以重新发送消息。</p>}
    {connectionError&&<div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive"><span>{connectionError}</span><Button size="sm" variant="outline" onClick={()=>refreshNow.current()}>重试连接</Button></div>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    {editor&&<form onSubmit={send} className="flex items-end gap-2"><textarea aria-label="发送给 Agent 的消息" className="min-h-24 flex-1 resize-none rounded-xl border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder={recovering?'环境恢复中，可先编辑消息…':connectionError?'连接异常，可先保留消息草稿…':active?.status==='interrupted'?'任务已中断，恢复环境后可发送…':active?'Agent 处理中，可先编辑下一条消息…':'描述你想完成的修改…'} maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="submit" disabled={busy||!!active||!value||!!connectionError||recovering||!draft.trim()} aria-label="发送消息"><Send size={16}/></Button></form>}
   </div>
  </DialogContent></Dialog>
 </>;
}
