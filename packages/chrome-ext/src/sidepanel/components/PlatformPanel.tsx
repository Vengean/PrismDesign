import {ExtensionUpgradeNotice} from '../../../../ui/src/studio/ExtensionUpgradeNotice';
import {useNotificationPresence,NotificationToggle} from '../notifications';
import {useMemo} from 'react';
import {PlatformPanel as SharedPlatformPanel} from '../../../../ui/src/studio/PlatformPanel';
import type {PlatformContext,PlatformRequest} from '../../../../ui/src/studio/platform-client';
import type {AnnotationAdapter} from '../../../../ui/src/studio/annotations';
import type {PrismMessage} from '../../shared/types';
import {tabConversationLive} from '../platform-live';
import {tabAttachmentClient} from '../attachment-client';
export function PlatformPanel({tabId,context,contextError,onRefreshContext,fitContainer=false}:{tabId:number;context:PlatformContext;contextError?:string;onRefreshContext?:()=>void;fitContainer?:boolean}){
 useNotificationPresence(tabId,context,!contextError);
 const live=useMemo(()=>tabConversationLive(tabId,onRefreshContext),[tabId,context.sessionId,onRefreshContext]);
 const files=useMemo(()=>tabAttachmentClient(tabId,context.sessionId),[tabId,context.sessionId]);
 const request=useMemo<PlatformRequest>(()=>{
 let failed=false;
 return async<T,>(path:string,method='GET',body?:unknown)=>{
 try{
  const result=await chrome.tabs.sendMessage(tabId,{type:'PRISM_PLATFORM_REQUEST',path,method,body});
  if(!result?.platform||result.error){if(result?.status===401||result?.status===403)onRefreshContext?.();throw Error(`${path.split('?')[0]}${result?.status?` HTTP ${result.status}`:''}: ${result?.error||'页面已离开平台预览，请重新打开'}`);}
  if(failed){failed=false;onRefreshContext?.();}return result.data as T;
 }catch(error){failed=true;throw error;}
 };},[tabId,context.sessionId,onRefreshContext]);
 const browser=useMemo(()=>({async prepare(){const result=await chrome.runtime.sendMessage({type:'PRISM_BROWSER_PREPARE',tabId,sessionId:context.sessionId});if(!result?.success)throw Error(result?.error||'无法绑定测试标签页');return result.bindingId as string;}}),[tabId,context.sessionId]);
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
 return <div className={fitContainer?'h-full':'h-screen'}><SharedPlatformPanel surface="extension" headerOverlay={context.extension?<ExtensionUpgradeNotice onOpenExtensions={()=>{void chrome.tabs.create({url:'chrome://extensions/',active:true});}} version={chrome.runtime.getManifest?.().version} release={context.extension}/>:undefined} actions={<NotificationToggle/>} context={context} contextError={contextError} request={request} live={live} files={files} browser={browser} annotations={annotations}/></div>;
}
