import {useMemo} from 'react';
import {PlatformPanel as SharedPlatformPanel} from '../../../../ui/src/studio/PlatformPanel';
import type {PlatformContext,PlatformRequest} from '../../../../ui/src/studio/platform-client';
import type {AnnotationAdapter} from '../../../../ui/src/studio/annotations';
import type {PrismMessage} from '../../shared/types';
export function PlatformPanel({tabId,context}:{tabId:number;context:PlatformContext}){
 const request=useMemo<PlatformRequest>(()=>async<T,>(path:string,method='GET',body?:unknown)=>{
  const result=await chrome.tabs.sendMessage(tabId,{type:'PRISM_PLATFORM_REQUEST',path,method,body});
  if(!result?.platform||result.error)throw Error(result?.error||'页面已离开平台预览，请重新打开');return result.data as T;
 },[tabId]);
 const annotations=useMemo<AnnotationAdapter>(()=>({
  async start(){await chrome.tabs.sendMessage(tabId,{type:'START_COMMENT_MODE'});},
  async stop(){await chrome.tabs.sendMessage(tabId,{type:'STOP_COMMENT_MODE'}).catch(()=>{});await chrome.tabs.sendMessage(tabId,{type:'HIDE_TOOLBAR'}).catch(()=>{});},
  subscribe(listener){const handler=(message:PrismMessage,sender:chrome.runtime.MessageSender)=>{
   if(sender.tab?.id!==tabId)return;
   if(message.type==='COMMENT_TARGET_SELECTED')listener({type:'selected',element:message.payload});
   if(message.type==='COMMENT_ADDED')listener({type:'added',annotation:message.payload});
   if(message.type==='COMMENT_CANCELLED')listener({type:'cancelled'});
  };chrome.runtime.onMessage.addListener(handler);return()=>chrome.runtime.onMessage.removeListener(handler);},
 }),[tabId]);
 return <div className="h-screen"><SharedPlatformPanel surface="extension" context={context} request={request} annotations={annotations}/></div>;
}
