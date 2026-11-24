import {useCallback,useEffect,useRef,useState} from 'react';
import {api,type SubscriptionStatus,type SubscriptionSession} from '@/lib/api';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import '@xterm/xterm/css/xterm.css';

export default function SubscriptionLogin({projectId,dirty=false}:{projectId:string;dirty?:boolean}){
 const [status,setStatus]=useState<SubscriptionStatus>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[session,setSession]=useState<SubscriptionSession>();
 const [opening,setOpening]=useState(false),[links,setLinks]=useState<string[]>([]),[result,setResult]=useState('');
 const host=useRef<HTMLDivElement>(null),alive=useRef(true),owner=useRef<string|undefined>(undefined),version=useRef(0);
 const statusVersion=useRef(0),changing=useRef(false);
 const refresh=useCallback(async()=>{if(changing.current)return;const generation=++statusVersion.current;try{const value=await api.subscriptionStatus(projectId);if(alive.current&&generation===statusVersion.current&&!changing.current){setStatus(value);setError('');}}catch(error){if(alive.current&&generation===statusVersion.current&&!changing.current)setError((error as Error).message);}},[projectId]);
 useEffect(()=>{alive.current=true;if(!dirty)void refresh();return()=>{alive.current=false;version.current++;const id=owner.current;if(id)void api.closeSubscriptionTerminal(projectId,id).catch(()=>{});};},[projectId,refresh,dirty]);
 async function open(){
  if(busy||dirty)return;const requestVersion=++version.current;statusVersion.current++;changing.current=true;setBusy(true);setOpening(true);setResult('');setLinks([]);setError('');
  try{const value=await api.openSubscriptionTerminal(projectId);owner.current=value.id;
   if(alive.current&&requestVersion===version.current){setSession(value);setStatus({provider:value.provider as SubscriptionStatus['provider'],status:'logging_in'});}
   else await api.closeSubscriptionTerminal(projectId,value.id);
  }catch(error){if(alive.current){setError((error as Error).message);setOpening(false);}}finally{changing.current=false;if(alive.current)setBusy(false);}
 }
 const close=useCallback(()=>{
  version.current++;statusVersion.current++;const id=owner.current;owner.current=undefined;setOpening(false);setSession(undefined);
  if(id){setBusy(true);void api.closeSubscriptionTerminal(projectId,id).then(refresh).catch(error=>setError((error as Error).message)).finally(()=>{if(alive.current)setBusy(false);});}
 },[projectId,refresh]);
 useEffect(()=>{
  if(!session||!host.current)return;
  let disposed=false,socket:WebSocket|undefined,terminal:import('@xterm/xterm').Terminal|undefined,observer:ResizeObserver|undefined;
  void(async()=>{
   const [{Terminal},{FitAddon}]=await Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit')]);
   if(disposed||!host.current)return;
   terminal=new Terminal({cursorBlink:true,convertEol:true,fontSize:13,scrollback:1500,theme:{background:'#111827',foreground:'#e5e7eb'}});
   const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(host.current);fit.fit();terminal.focus();
   const url=new URL(`/api/projects/${encodeURIComponent(projectId)}/subscription/sessions/${session.id}/terminal`,window.location.href);
   url.protocol=window.location.protocol==='https:'?'wss:':'ws:';url.searchParams.set('ticket',session.ticket);
   socket=new WebSocket(url);
   const send=(value:unknown)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));};
   terminal.onData(data=>send({type:'input',data}));terminal.onResize(size=>send({type:'resize',...size}));
   observer=new ResizeObserver(()=>{if(!disposed){try{fit.fit();}catch{}}});observer.observe(host.current);
   let tail='';
   socket.onmessage=event=>{
    if(disposed)return;
    try{const message=JSON.parse(event.data);
     if(message.type==='ready')send({type:'resize',cols:terminal!.cols,rows:terminal!.rows});
     if(message.type==='output'){
      terminal!.write(message.data);
      tail=(tail+String(message.data).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g,'')).slice(-8192);
      const urls=[...tail.matchAll(/https:\/\/[^\s\x1b<>"']+/g)].map(match=>match[0].replace(/[),.;]+$/,''));
      if(urls.length)setLinks(previous=>[...new Set([...previous,...urls])].slice(-6));
     }
     if(message.type==='exit'||message.type==='error'){setResult(message.message);terminal!.options.disableStdin=true;if(message.type==='exit'){statusVersion.current++;setStatus({provider:session.provider as SubscriptionStatus['provider'],status:message.success?'logged_in':'not_logged_in'});}}
    }catch{setResult('终端响应格式错误，请重新打开');}
   };
   socket.onerror=()=>{if(!disposed)setResult('终端连接失败，请关闭后重新打开');};
   socket.onclose=()=>{if(!disposed){terminal!.options.disableStdin=true;setResult(previous=>previous||'终端连接已关闭，可刷新登录状态');}};
  })().catch(error=>{if(!disposed)setResult((error as Error).message);});
  return()=>{disposed=true;observer?.disconnect();socket?.close();terminal?.dispose();};
 },[session,projectId,refresh]);
 async function logout(){
  statusVersion.current++;changing.current=true;setBusy(true);setError('');try{setStatus(await api.logoutSubscription(projectId));}catch(error){setError((error as Error).message);}finally{changing.current=false;setBusy(false);}
 }
 return <div className="mt-4 rounded-lg border bg-muted/20 p-4">
  <div className="flex flex-wrap items-center gap-3"><span className="text-sm font-medium">项目订阅登录</span><span role="status" className="text-xs text-muted-foreground">{status?.status==='logged_in'?'已登录':status?.status==='logging_in'?'登录操作进行中':status?'未登录':'正在检查'}</span>
   <Button type="button" variant="outline" size="sm" disabled={busy||dirty||opening} onClick={()=>void open()}>{busy?'处理中…':status?.status==='logged_in'?'重新登录':'打开登录终端'}</Button>
   <Button type="button" variant="ghost" size="sm" disabled={busy||dirty||opening} onClick={()=>void refresh()}>刷新状态</Button>
   {status?.status==='logged_in'&&<Button type="button" variant="ghost" size="sm" disabled={busy||dirty||opening} onClick={()=>void logout()}>退出登录</Button>}
  </div>
  <p className="mt-2 text-xs leading-5 text-muted-foreground">{dirty?'请先保存项目配置，再打开登录终端。':'登录态由本项目的需求共享；关闭终端会保留已保存的授权。首次切换项目共享登录后，已有需求需重启环境。'}</p>
  {error&&<p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  <Dialog open={opening} onOpenChange={value=>{if(!value)close();}}><DialogContent className="max-h-[92vh] w-[94vw] max-w-4xl overflow-y-auto" onInteractOutside={event=>event.preventDefault()}>
   <DialogHeader><DialogTitle>项目订阅登录终端</DialogTitle><DialogDescription>{session?`正在执行 ${session.command}。需要浏览器授权时，请在自己的电脑或手机打开链接完成登录。`:'正在准备独立授权容器…'}</DialogDescription></DialogHeader>
   {session&&<div ref={host} className="h-[min(55vh,440px)] min-h-64 overflow-hidden rounded-md bg-gray-900 p-3" aria-label="订阅登录交互终端"/>}
   {!!links.length&&<div className="flex flex-col gap-1 text-xs">{links.map(link=><a key={link} href={link} target="_blank" rel="noopener noreferrer" className="break-all text-blue-600 underline">{link}</a>)}</div>}
   {result&&<p role="status" className="text-sm">{result}</p>}
   <div className="flex justify-end"><Button type="button" variant="outline" onClick={close}>关闭终端</Button></div>
  </DialogContent></Dialog>
 </div>;
}
