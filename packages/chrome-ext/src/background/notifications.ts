import {isPlatformContext,type PlatformContext,type PlatformConversation} from '../../../ui/src/studio/platform-client.js';
import {collectNotifications,type NotificationCheckpoint} from './notification-state.js';
import type {ConversationStreamEvent} from '../../../ui/src/studio/conversation-stream.js';

export const NOTIFICATION_STATE='prism-notification-state-v1';
export const NOTIFICATION_ENABLED='prism-notifications-enabled';
const ROUTES='prism-notification-routes-v1';
type Binding={tab:chrome.tabs.Tab;context:PlatformContext;scope:string};
type Watcher={binding:Binding;stopped:boolean;attempt:number;port?:chrome.runtime.Port;timer?:ReturnType<typeof setTimeout>;queue:Promise<void>};
type Route={tabId:number;windowId:number;url:string;scope:string};
const scopeOf=(tab:chrome.tabs.Tab,context:PlatformContext)=>JSON.stringify([new URL(tab.url!).origin,context.sessionId,context.userId]);

// Only preview-page cookies authenticate requests. Durable state contains cursors
// and IDs, never Agent credentials or message bodies.
export function createNotificationService(api:typeof chrome){
 const bindings=new Map<number,Binding>(),watchers=new Map<string,Watcher>();
 const presence=new Map<chrome.runtime.Port,{tabId:number;sessionId:string;userId:string;visible:boolean}>();
 const generations=new Map<number,number>();
 let checkpoints:Record<string,NotificationCheckpoint>={},routes:Record<string,Route>={},enabled=true,saveQueue=Promise.resolve();
 const ready=api.storage.local.get([NOTIFICATION_STATE,NOTIFICATION_ENABLED,ROUTES]).then(data=>{checkpoints=data[NOTIFICATION_STATE]||{};routes=data[ROUTES]||{};enabled=data[NOTIFICATION_ENABLED]!==false;});
 function save(){
  checkpoints=Object.fromEntries(Object.entries(checkpoints).sort((a,b)=>b[1].updatedAt-a[1].updatedAt).slice(0,50));
  routes=Object.fromEntries(Object.entries(routes).slice(-100));
  const state=structuredClone({[NOTIFICATION_STATE]:checkpoints,[ROUTES]:routes});
  saveQueue=saveQueue.catch(()=>{}).then(()=>api.storage.local.set(state));return saveQueue;
 }
 async function request<T>(tabId:number,path:string):Promise<T>{
  const result=await api.tabs.sendMessage(tabId,{type:'PRISM_PLATFORM_REQUEST',path,method:'GET'});
  if(!result?.platform||result.error)throw Error(result?.error||'Preview unavailable');
  return result.data;
 }
 async function isReading(scope:string){
  const windows=await api.windows.getAll();
  const focused=new Set(windows.filter(window=>window.focused).map(window=>window.id));
  for(const binding of bindings.values()){
   if(binding.scope!==scope)continue;
   const tab=await api.tabs.get(binding.tab.id!).catch(()=>undefined);
   if(!tab?.active||!focused.has(tab.windowId))continue;
   if([...presence.values()].some(value=>value.visible&&value.tabId===tab.id&&value.sessionId===binding.context.sessionId&&value.userId===binding.context.userId))return true;
   const state=await api.tabs.sendMessage(tab.id!,{type:'PRISM_NOTIFICATION_PAGE_STATE'}).catch(()=>null);
   if(state?.reading)return true;
  }
  return false;
 }
 async function consume(watcher:Watcher,value:PlatformConversation){
  if(watcher.stopped||value.session_id!==watcher.binding.context.sessionId||value.restricted)return;
  const {checkpoint,candidates}=collectNotifications(watcher.binding.context,value,checkpoints[watcher.binding.scope]);
  checkpoints[watcher.binding.scope]=checkpoint;
  await save();
  if(watcher.stopped||!enabled||!candidates.length||await isReading(watcher.binding.scope))return;
  if(await new Promise<string>(resolve=>api.notifications.getPermissionLevel(resolve))!=='granted')return;
  for(const candidate of candidates){
   if(watcher.stopped||!enabled)return;
   const {tab,context,scope}=watcher.binding;
   const id=`prism:${tab.id}:${tab.windowId}:${crypto.randomUUID()}`;
   const url=new URL(tab.url!);url.search='';url.hash='';url.username='';url.password='';
   routes[id]={tabId:tab.id!,windowId:tab.windowId,url:url.href,scope};await save();
   await new Promise<void>(resolve=>api.notifications.create(id,{type:'basic',iconUrl:api.runtime.getURL('icons/icon-128.png'),title:candidate.title,message:candidate.message,contextMessage:`${context.projectName} · ${context.title}`},()=>{void api.runtime.lastError;resolve();}));
  }
 }
 function stop(watcher:Watcher){watcher.stopped=true;clearTimeout(watcher.timer);watcher.port?.disconnect();watchers.delete(watcher.binding.scope);}
 function detach(tabId:number){
  const binding=bindings.get(tabId);bindings.delete(tabId);if(!binding)return;
  const watcher=watchers.get(binding.scope);
  if(watcher?.binding.tab.id!==tabId)return;
  stop(watcher);const alternate=[...bindings.values()].find(item=>item.scope===binding.scope);if(alternate)start(alternate);
 }
 async function connect(watcher:Watcher){
  if(watcher.stopped)return;
  const retry=()=>{
   if(watcher.stopped)return;
   const old=watcher.port;watcher.port=undefined;old?.disconnect();
   clearTimeout(watcher.timer);watcher.timer=setTimeout(()=>void connect(watcher),Math.min(30000,1000*2**Math.min(watcher.attempt++,5)));
  };
  try{
   await watcher.queue; if(watcher.stopped)return;
   const {binding}=watcher,tabId=binding.tab.id!;
   const context=await request<PlatformContext>(tabId,'/context');
   if(!isPlatformContext(context)||context.role==='viewer'||scopeOf(binding.tab,context)!==binding.scope){detach(tabId);return;}
   const checkpoint=checkpoints[binding.scope];
   const query=new URLSearchParams({sessionId:context.sessionId,notification:'1',...(checkpoint?{after:String(checkpoint.after),eventAfter:String(checkpoint.eventAfter)}:{latest:'1'})});
   const snapshot=await request<PlatformConversation>(tabId,'/conversation?'+query);
   await consume(watcher,snapshot);if(watcher.stopped)return;
   const port=api.tabs.connect(tabId,{name:'prism-platform-live',frameId:0});watcher.port=port;
   port.onMessage.addListener((event:ConversationStreamEvent)=>{
    if(watcher.stopped||watcher.port!==port)return;
    if(event.type==='closed'){retry();return;}
    watcher.attempt=0;
    if(event.type==='snapshot')watcher.queue=watcher.queue.then(()=>consume(watcher,event.value)).catch(()=>retry());
   });
   port.onDisconnect.addListener(()=>{if(watcher.port===port)retry();});
   const cursor=checkpoints[binding.scope];
   port.postMessage({sessionId:context.sessionId,after:cursor.after,eventAfter:cursor.eventAfter,liveAfter:snapshot.next_live_cursor||'',notification:'1'});
  }catch{retry();}
 }
 function start(binding:Binding){
  if(watchers.has(binding.scope))return;
  const watcher:Watcher={binding,stopped:false,attempt:0,queue:Promise.resolve()};watchers.set(binding.scope,watcher);void connect(watcher);
 }
 async function discover(tabId:number){
  const generation=(generations.get(tabId)||0)+1;generations.set(tabId,generation);
  try{
   await ready;const tab=await api.tabs.get(tabId);
   if(!tab.url||!/^https?:/.test(tab.url))return;
   const context=await request<PlatformContext>(tabId,'/context');
   if(generations.get(tabId)!==generation)return;
   if(!isPlatformContext(context)||context.role==='viewer'){detach(tabId);return;}
   const scope=scopeOf(tab,context),old=bindings.get(tabId);
   if(old&&old.scope!==scope)detach(tabId);
   const binding={tab,context,scope};bindings.set(tabId,binding);start(binding);
  }catch{if(generations.get(tabId)===generation)detach(tabId);}
 }
 function click(id:string){
  const match=/^prism:(\d+):(\d+):/.exec(id);if(!match)return;
  const tabId=Number(match[1]),windowId=Number(match[2]);
  // Keep open() synchronous inside Chrome's notification user gesture.
  const routeAtClick=routes[id];
  const opened=api.sidePanel.open({tabId}).catch(()=>api.tabs.sendMessage(tabId,{type:'PRISM_NOTIFICATION_OPEN_CHAT'}).catch(()=>{}));
  void api.windows.update(windowId,{focused:true}).catch(()=>{});
  void api.tabs.update(tabId,{active:true}).then(async tab=>{
   await ready;const route=routeAtClick||routes[id];if(!route)return;
   const url=new URL(tab.url||route.url);url.search='';url.hash='';
   if(url.href!==route.url)await api.tabs.update(tabId,{url:route.url});
  }).catch(async()=>{
   await ready;const route=routeAtClick||routes[id];if(!route||!/^https?:/.test(route.url))return;
   const tab=await api.tabs.create({url:route.url,active:true});if(tab.id!==undefined)pendingOpen.add(tab.id);
  });
  void opened;void api.notifications.clear(id);
 }
 const pendingOpen=new Set<number>();
 function install(){
  api.runtime.onMessage.addListener((message,sender)=>{if(message?.type==='PRISM_NOTIFICATION_DISCOVER'&&sender.tab?.id!==undefined)void discover(sender.tab.id);});
  api.runtime.onConnect.addListener(port=>{
   if(port.name!=='prism-notification-presence'||!port.sender?.url?.startsWith(api.runtime.getURL('sidepanel.html')))return;
   port.onMessage.addListener(value=>{
    if(Number.isInteger(value?.tabId)&&typeof value.sessionId==='string'&&typeof value.userId==='string')presence.set(port,{tabId:value.tabId,sessionId:value.sessionId,userId:value.userId,visible:value.visible===true});
   });port.onDisconnect.addListener(()=>presence.delete(port));
  });
  api.tabs.onRemoved.addListener(tabId=>{generations.set(tabId,(generations.get(tabId)||0)+1);detach(tabId);pendingOpen.delete(tabId);});
  api.tabs.onUpdated.addListener((tabId,change)=>{
   if(change.status==='loading'){generations.set(tabId,(generations.get(tabId)||0)+1);detach(tabId);}
   if(change.status==='complete'){
    void discover(tabId);
    if(pendingOpen.delete(tabId))void api.tabs.sendMessage(tabId,{type:'PRISM_NOTIFICATION_OPEN_CHAT'}).catch(()=>{});
   }
  });
  api.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[NOTIFICATION_ENABLED])enabled=changes[NOTIFICATION_ENABLED].newValue!==false;});
  api.notifications.onClicked.addListener(click);
  api.notifications.onClosed.addListener(id=>{delete routes[id];void ready.then(save).catch(()=>{});});
  void ready.then(()=>api.tabs.query({url:['http://*/*','https://*/*']})).then(tabs=>Promise.all(tabs.map(tab=>tab.id===undefined?undefined:discover(tab.id)))).catch(()=>{});
 }
 return {install,discover,click,ready,close(){for(const watcher of watchers.values())stop(watcher);}};
}
export function installNotifications(){createNotificationService(chrome).install();}
