import {useEffect,useState} from 'react';
import {Bell,BellOff} from 'lucide-react';
import type {PlatformContext} from '../../../ui/src/studio/platform-client.js';
const ENABLED='prism-notifications-enabled';
export function useNotificationPresence(tabId:number,context:PlatformContext,available:boolean){
 useEffect(()=>{
  let stopped=false,port:chrome.runtime.Port|undefined,timer:ReturnType<typeof setTimeout>;
  const publish=()=>{try{port?.postMessage({tabId,sessionId:context.sessionId,userId:context.userId,visible:available&&document.visibilityState!=='hidden'});}catch{}};
  const connect=()=>{
   if(stopped)return;
   try{port=chrome.runtime.connect({name:'prism-notification-presence'});publish();port.onDisconnect.addListener(()=>{if(!stopped)timer=setTimeout(connect,1000);});}catch{timer=setTimeout(connect,1000);}
  };
  connect();document.addEventListener('visibilitychange',publish);
  return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',publish);port?.disconnect();};
 },[tabId,context.sessionId,context.userId,available]);
}
export function NotificationToggle(){
 const [enabled,setEnabled]=useState(true),[granted,setGranted]=useState(true);
 useEffect(()=>{
  void chrome.storage.local.get(ENABLED).then(value=>setEnabled(value[ENABLED]!==false));
  chrome.notifications.getPermissionLevel(value=>setGranted(value==='granted'));
  const change=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==='local'&&changes[ENABLED])setEnabled(changes[ENABLED].newValue!==false);};
  chrome.storage.onChanged.addListener(change);return()=>chrome.storage.onChanged.removeListener(change);
 },[]);
 const label=enabled?'关闭系统通知':'开启系统通知',Icon=enabled&&granted?Bell:BellOff;
 return <button type="button" aria-label={label} aria-pressed={enabled} title={granted?label:'系统通知已被禁用，请在 Chrome 或系统设置中开启'} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" onClick={()=>{void chrome.storage.local.set({[ENABLED]:!enabled});}}><Icon size={14}/></button>;
}
