import React from 'react';
import {useEffect,useMemo,useRef,useState} from 'react';
import {PlatformClient,requestId,type PlatformContext,type PlatformConversation,type PlatformRequest} from './platform-client.js';
import type {ChatMessage,CommentAnnotation} from './types.js';
import type {ChatState} from './ChatPanel';
import {isRunWorking,runMessageBody,connectionMessage} from './run-state.js';
import {StudioPanel} from './StudioPanel';
import type {AnnotationAdapter} from './annotations.js';
import type {ReactNode} from 'react';

export function PlatformPanel({context,request,annotations,actions,surface}:{surface:'widget'|'extension';context:PlatformContext;request:PlatformRequest;annotations:AnnotationAdapter;actions?:ReactNode}){
 const [value,setValue]=useState<PlatformConversation>(),[error,setError]=useState(''),[posting,setPosting]=useState(false);
 const [connectionError,setConnectionError]=useState('');
 const retry=useRef<()=>void>(()=>{});
 const client=useRef<PlatformClient|undefined>(undefined);
 const pending=useRef<{key:string;id:string}|undefined>(undefined);
 useEffect(()=>{
  let active=true,busy=false;
  const current=new PlatformClient(context,request);client.current=current;
  async function refresh(){if(busy)return;busy=true;try{const snapshot=await current.sync();if(active){setValue(previous=>JSON.stringify(previous)===JSON.stringify(snapshot)?previous:snapshot);setConnectionError('');}}catch(e){if(active)setConnectionError(connectionMessage(e));}finally{busy=false;}}
  retry.current=()=>{void refresh();};
  void refresh();const timer=setInterval(refresh,1000);
  return()=>{active=false;clearInterval(timer);client.current=undefined;};
 },[request,context.sessionId]);
 const active=value?.active_run,activeRun=value?.runs.find(run=>run.id===active?.id);
 const messages=useMemo(()=>{const result:ChatMessage[]=(value?.messages||[]).map(message=>{
  let metadata:{text:string;comments:CommentAnnotation[];contextOrder?:ChatMessage['contextOrder']}|undefined;
  if(message.role==='user'&&message.client_context){try{metadata=JSON.parse(message.client_context);}catch{/* Older plain messages remain readable. */}}
  const run=value?.runs.find(item=>item.id===message.run_id);
  const working=message.role==='assistant'&&message.run_id===value?.active_run?.id&&isRunWorking(value?.active_run?.status)&&!connectionError;
  return {role:message.role==='user'?'user':'ai',content:metadata?.text??((message.role==='assistant'?runMessageBody(message.body,run):message.body)||(working?'⏳ Agent 正在处理…':message.run_id===value?.active_run?.id&&value.active_run.status==='interrupted'?'任务已中断，请重启需求环境后继续。':'')),comments:metadata?.comments,contextOrder:metadata?.contextOrder,pending:working,timestamp:message.created_at?Date.parse(message.created_at+'Z'):message.seq};
 });
 if(error)result.push({role:'ai',content:error,timestamp:0});
 if(value?.restricted)result.push({role:'ai',content:value.active_run?.status==='interrupted'?'任务已中断，请联系项目编辑成员重启环境。':value.active_run?'Agent 正在处理此需求。':'当前仅开放协作状态，完整对话仅编辑成员可见。',timestamp:0});
 return result;},[value,error,connectionError]);
 const chat:ChatState={
  messages,sending:posting||(isRunWorking(active?.status)&&!connectionError),blocked:!!active||!!connectionError,canCancel:active?.status==='running'&&activeRun?.cancel_supported===1,
  async sendMessage(text,attachments=[],comments=[],agentText,contextOrder){
   if(posting||value?.active_run||!client.current||connectionError||context.role==='viewer')return false;
   if(attachments.length){setError('平台附件接口尚未接入');return false;}
   const current=client.current,message=agentText||text,clientContext={text,comments,contextOrder};
   const key=JSON.stringify({message,clientContext});
   if(pending.current?.key!==key)pending.current={key,id:requestId()};
   setPosting(true);setError('');
   try{await current.send(message,pending.current.id,clientContext);pending.current=undefined;try{const snapshot=await current.sync();if(client.current===current)setValue(previous=>JSON.stringify(previous)===JSON.stringify(snapshot)?previous:snapshot);}catch(e){if(client.current===current)setError('消息已发送，正在等待同步：'+(e as Error).message);}return true;}
   catch(e){if(client.current===current)setError(connectionMessage(e));return false;}
   finally{if(client.current===current)setPosting(false);}
  },
  async cancelCurrent(){try{if(client.current&&value?.active_run)await client.current.cancel(value.active_run.id);}catch(e){setError(connectionMessage(e));}},
  clearHistory(){setError('需求会话由平台统一保存，暂不支持清空');},
  deleteMessage(){setError('需求会话由平台统一保存，暂不支持删除');},
  async startVerification(){setError('平台浏览器测试接口尚未接入');},
  fixVerification(){setError('平台浏览器测试接口尚未接入');},
 };
 return <StudioPanel surface={surface} chat={chat} context={context} annotations={annotations} actions={actions} connection={{connected:!!value&&!connectionError,error:connectionError,retry:()=>retry.current()}}/>;
}
