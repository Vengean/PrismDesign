import React from 'react';
import {useEffect,useState} from 'react';
import type {CommentAnnotation} from './types.js';
import type {AnnotationAdapter} from './annotations.js';
import {STUDIO_NAME,STUDIO_LOGO} from './brand.js';
import type {ReactNode} from 'react';
import type {PlatformContext} from './platform-client.js';
import {ChatPanel,type ChatState} from './ChatPanel';

export function StudioPanel({chat,context,annotations,connection,actions,surface}:{surface:'widget'|'extension';chat:ChatState;context:PlatformContext;annotations:AnnotationAdapter;actions?:ReactNode;connection:{connected:boolean;error:string;retry:()=>void}}) {
 const [commentMode,setCommentMode]=useState(false);
 const [pendingComments,setPendingComments]=useState<CommentAnnotation[]>([]);
 const readOnly=context.role==='viewer'||!connection.connected;
 async function stop(){try{await annotations.stop();}finally{setCommentMode(false);}}
 useEffect(()=>{
  const unsubscribe=annotations.subscribe(event=>{
   if(context.role==='viewer')return;
   if(event.type==='selected'){setPendingComments(items=>[...items,{element:event.element,comment:''}]);setCommentMode(false);}
   else if(event.type==='cancelled')setCommentMode(false);
   else if(event.type==='added'){
    setPendingComments(items=>{const index=items.findLastIndex(item=>item.element.domPath===event.annotation.element.domPath&&!item.comment);return index<0?[...items,event.annotation]:items.map((item,i)=>i===index?event.annotation:item);});
    void stop();
   }
  });
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setCommentMode(false);void stop();}};
  document.addEventListener('keydown',escape);
  return()=>{unsubscribe();document.removeEventListener('keydown',escape);void annotations.stop();};
 },[annotations,context.role]);
 useEffect(()=>{if(readOnly)void stop();},[readOnly,annotations]);
 return <div className="prism-studio-chat relative flex h-full min-h-0 flex-col bg-background text-foreground">
  <header className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-2 py-2">
   {surface==='widget'?<><img src={STUDIO_LOGO} alt="" className="h-7 w-7 shrink-0"/><span className="min-w-0 flex-1 truncate text-xs font-semibold">{STUDIO_NAME}</span></>:<>
    <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={context.title}>{context.title}</span>
    {!connection.error&&<span role="status" className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${connection.connected?'bg-primary':'animate-pulse bg-yellow-400'}`}/>{connection.connected?'已连接平台':'正在连接'}</span>}
   </>}
   {connection.error&&<button type="button" role="status" title="重新连接平台" onClick={connection.retry} className="flex h-7 shrink-0 items-center gap-1.5 text-[10px] text-destructive"><span className="h-1.5 w-1.5 rounded-full bg-destructive"/>连接中断 · 重试</button>}
   {actions}
  </header>
  <div className="min-h-0 flex-1"><ChatPanel chat={chat} selection={null} comments={pendingComments} onEditComment={(index,comment)=>setPendingComments(items=>items.map((item,i)=>i===index?{...item,comment}:item))} onRemoveComment={index=>setPendingComments(items=>items.filter((_,i)=>i!==index))} onCommentsSent={()=>setPendingComments([])} readOnly={readOnly} unavailable={{history:'需求会话由平台统一保存，暂不支持清空'}} commentMode={commentMode} onToggleCommentMode={()=>{if(readOnly)return;if(commentMode){void stop();return;}setCommentMode(true);void Promise.resolve(annotations.start()).catch(()=>setCommentMode(false));}} onRestoreMessage={(_text,comments)=>setPendingComments(comments)}/></div>
 </div>;
}
