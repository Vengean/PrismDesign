import {PlatformPanel} from './components/PlatformPanel';
import {isPlatformContext,type PlatformContext} from '../../../widget/src/platform-client.js';
import {useEffect,useState} from 'react';
import {Button} from './components/ui/button';

export function App(){
 const [retryKey,setRetryKey]=useState(0);
 const [binding,setBinding]=useState<{tabId:number;context?:PlatformContext;error?:string}|null|undefined>(undefined);
  // Side panel lifecycle
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let unmounted = false;

    function connectPort() {
      if (unmounted) return;
      try {
        port = chrome.runtime.connect({ name: "prism-sidepanel" });
        port.onDisconnect.addListener(() => {
          port = null;
          if (!unmounted) setTimeout(connectPort, 500);
        });
      } catch {
        // Extension context gone
      }
    }
    connectPort();

    return () => {
      unmounted = true;
      port?.disconnect();
    };
  }, []);


 useEffect(()=>{
  let active=true,busy=false,generation=0,observedTab:number|undefined,observedWindow:number|undefined;
  async function refresh(){if(busy)return;busy=true;const expected=generation;try{
   const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
   if(!tab?.id){if(active&&expected===generation)setBinding(previous=>previous?.context?previous:null);return;}
   observedTab=tab.id;observedWindow=tab.windowId;
   let response;try{response=await chrome.tabs.sendMessage(tab.id,{type:'PRISM_PLATFORM_REQUEST',path:'/context'});}catch(e){if(active&&expected===generation)setBinding(previous=>previous?.tabId===tab.id&&previous?.context?{...previous,error:`/context: ${e instanceof Error?e.message:String(e)}`} :null);return;}
   if(response?.platform&&!response.error&&!isPlatformContext(response.data))response.error='平台上下文无效，请刷新预览';
   if(active&&expected===generation){const next=response?.platform?{tabId:tab.id,context:response.error?undefined:response.data,error:response.error}:null;setBinding(previous=>{
    if(previous?.tabId===tab.id&&previous?.context){
     // Context probes report connectivity; only a confirmed new session replaces history.
     if(!next?.context){
      const error=response?.error?`/context${response.status?` HTTP ${response.status}`:''}: ${response.error}`:response?.platform===false?'/context: 当前页面未检测到平台标记（prism-platform）':'/context: 页面未返回平台响应';
      return previous.error===error?previous:{...previous,error};
     }
     if(JSON.stringify(previous.context)===JSON.stringify(next.context))return previous.error?{...previous,error:undefined}:previous;
    }
    return next;
   });}
  }catch{if(active&&expected===generation)setBinding(previous=>previous?.context?{...previous,error:"无法识别当前页面，正在重试…"}:{tabId:observedTab??-1,error:"无法识别当前页面，请重试"});}finally{busy=false;}}
  const switchTab=(info?:chrome.tabs.TabActiveInfo)=>{if(info&&observedWindow!==undefined&&info.windowId!==observedWindow)return;generation++;if(info&&info.tabId!==observedTab)setBinding(undefined);void refresh();};
  chrome.tabs.onActivated.addListener(switchTab);
  const navigate=(_id:number,change:chrome.tabs.TabChangeInfo)=>{if(_id===observedTab&&(change.url||change.status==='complete'))switchTab();};
  chrome.tabs.onUpdated.addListener(navigate);
  void refresh();const timer=setInterval(refresh,1000);return()=>{active=false;clearInterval(timer);chrome.tabs.onActivated.removeListener(switchTab);chrome.tabs.onUpdated.removeListener(navigate);};
 },[retryKey]);
 const retry=()=>{setRetryKey(key=>key+1);};
 if(binding===undefined)return <div className="p-4 text-sm text-muted-foreground">正在识别当前页面…</div>;
 if(binding?.context?.role==='viewer')return <div className="p-4 text-xs text-muted-foreground">当前账号仅可预览页面，群聊仅向编辑成员开放。</div>;
 if(binding?.context)return <PlatformPanel key={`${binding.tabId}:${binding.context.sessionId}`} tabId={binding.tabId} context={binding.context} contextError={binding.error}/>;
 return <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center"><img src="/icons/icon-48.png" alt="" className="h-10 w-10"/><h1 className="text-sm font-semibold">Prism Studio</h1><p role={binding?.error?'alert':undefined} className="text-xs leading-5 text-muted-foreground">{binding?.error||'请打开平台中的项目预览页面，插件会自动连接当前需求。'}</p><Button size="sm" variant="outline" onClick={retry}>重试</Button></div>;
}
