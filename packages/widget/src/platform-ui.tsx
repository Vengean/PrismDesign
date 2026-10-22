import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {PlatformPanel} from '../../ui/src/studio/PlatformPanel';
import {STUDIO_LOGO,STUDIO_NAME} from '../../ui/src/studio/brand';
import {Button} from '../../ui/src/studio/button';
import studioCss from '../../ui/src/studio/studio.css?inline';
import {PLATFORM_SHELL_CSS} from './platform-shell.js';
import {createPanel} from './panel.js';
import {createPageAnnotations} from './platform-annotations.js';
import {pagePlatformRequest,requestId,isPlatformContext,type PlatformContext} from './platform-client.js';

export function mountPlatformWidget(nonce=''){
 if(document.getElementById('prism-studio-widget'))return;
 const host=document.createElement('div');host.id='prism-studio-widget';
 // Escape body layout/transform and use the browser top layer when available.
 if(typeof host.showPopover==='function')host.setAttribute('popover','manual');
 document.documentElement.appendChild(host);
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');if(nonce)style.nonce=nonce;
 style.textContent=studioCss.replace(/:root\b/g,':host')+'\n'+PLATFORM_SHELL_CSS;
 shadow.appendChild(style);
 if(host.hasAttribute('popover')){try{host.showPopover();}catch{host.removeAttribute('popover');}}
 let extension=false,nonceId=requestId(),fallback:ReturnType<typeof setTimeout>|undefined;
 const panel=createPanel(shadow,'bottom-right',()=>{if(!extension)return false;fallback=setTimeout(()=>panel.show(),1200);return true;},true);
 shadow.querySelectorAll('.prism-fab').forEach(el=>{el.innerHTML=`<img src="${STUDIO_LOGO}" width="28" height="28" alt="${STUDIO_NAME}"/>`;el.setAttribute('aria-label','打开 '+STUDIO_NAME);(el as HTMLElement).dataset.prismOpen='true';});
 shadow.querySelector('.prism-header')?.remove();
 const onMessage=(event:MessageEvent)=>{if(event.source!==window||event.origin!==location.origin)return;if(event.data?.type==='PRISM_EXTENSION_PONG'&&event.data.nonce===nonceId){extension=true;}if(event.data?.type==='PRISM_EXTENSION_OPEN_RESULT'){if(fallback)clearTimeout(fallback);if(event.data.success)panel.hide();else panel.show();}};
 window.addEventListener('message',onMessage);
 function ping(){extension=false;nonceId=requestId();window.postMessage({type:'PRISM_EXTENSION_PING',nonce:nonceId},location.origin);}
 ping();const timer=setInterval(ping,5000);
 const annotations=createPageAnnotations(host,nonce);
 const body=panel.getBody();body.className='prism-studio-root';
 const root=createRoot(body);
 function WidgetConversation(){
  const [context,setContext]=useState<PlatformContext>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;pagePlatformRequest<PlatformContext>('/context').then(value=>{if(!isPlatformContext(value))throw Error('平台上下文无效，请重新打开需求预览');if(active){setContext(value);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
  const close=<button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="关闭面板" title="关闭面板" onClick={()=>panel.hide()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>;
  if(!context)return <div className="flex h-full flex-col"><header className="flex items-center gap-2 border-b p-2"><img src={STUDIO_LOGO} alt="" className="h-7 w-7"/><strong className="flex-1 text-xs">{STUDIO_NAME}</strong>{close}</header><div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-xs"><p role={error?'alert':'status'}>{error||'正在连接平台…'}</p>{error&&<Button size="sm" variant="outline" onClick={()=>{setError('');setRetry(value=>value+1);}}>重试</Button>}</div></div>;
  return <PlatformPanel surface="widget" context={context} request={pagePlatformRequest} annotations={annotations} actions={close}/>;
 }
 root.render(<WidgetConversation/>);
 panel.onVisibilityChange(visible=>{if(!visible)void annotations.stop();});
 const observer=new MutationObserver(()=>{if(!host.isConnected){clearInterval(timer);if(fallback)clearTimeout(fallback);window.removeEventListener('message',onMessage);void annotations.stop();root.unmount();panel.destroy();observer.disconnect();}});observer.observe(document.documentElement,{childList:true});
}
