import {isContextInvalidated} from "./runtime.js";
const prefix='/__prism_platform__';
function platformPage(){return !!document.querySelector('meta[name="prism-platform"]');}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
 if(message?.type!=='PRISM_PLATFORM_REQUEST')return;
 if(!platformPage()){respond({platform:false});return false;}
 const path=String(message.path || ''),method=message.method || 'GET';
 if(!((method==='GET' && /^\/(context|conversation)(\?|$)/.test(path))||(method==='POST'&&/^\/(messages|cancel)(\?|$)/.test(path)))){respond({platform:true,error:'不支持的平台操作'});return false;}
 void fetch(prefix+path,{signal:AbortSignal.timeout(10000),method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(message.body===undefined?{}:{body:JSON.stringify(message.body)})}).then(async res=>{let data;try{data=await res.json();}catch{throw Error('平台接口返回了无效数据，请从平台重新打开预览');}respond({platform:true,status:res.status,data,error:res.ok?undefined:data.error || '平台鉴权失败'});}).catch(e=>respond({platform:true,error:e.message}));return true;
});
window.addEventListener('message',event=>{
 if(isContextInvalidated()||event.source!==window||event.origin!==location.origin||!platformPage())return;
 if(event.data?.type==='PRISM_EXTENSION_PING' && typeof event.data.nonce==='string')window.postMessage({type:'PRISM_EXTENSION_PONG',nonce:event.data.nonce},location.origin);
});
// Capture the real click, before any asynchronous work, to preserve Chrome's
// sidePanel user-gesture requirement. No page message can open the panel alone.
document.addEventListener('click',event=>{
 if(!event.isTrusted||!platformPage())return;
 const path=event.composedPath();if(!path.some(el=>el instanceof HTMLElement&&el.id==='prism-studio-widget')||!path.some(el=>el instanceof HTMLElement&&el.dataset.prismOpen==='true'))return;
 chrome.runtime.sendMessage({type:'PRISM_PLATFORM_OPEN'}).then(result=>window.postMessage({type:'PRISM_EXTENSION_OPEN_RESULT',success:result?.success===true},location.origin)).catch(()=>window.postMessage({type:'PRISM_EXTENSION_OPEN_RESULT',success:false},location.origin));
},true);
