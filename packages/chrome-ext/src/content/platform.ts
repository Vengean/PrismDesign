import {isContextInvalidated} from "./runtime.js";
import {pageConversationLive,type ConversationCursor} from '../../../ui/src/studio/conversation-stream.js';
import {pageAttachmentClient,fetchAttachment,base64ToBytes,bytesToBase64,MAX_ATTACHMENT_SIZE} from '../../../ui/src/studio/attachment-client.js';
const prefix='/__prism_platform__';
function platformPage(){return !!document.querySelector('meta[name="prism-platform"]');}
const uploads=new Map<string,AbortController>();
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
 if(!['PRISM_ATTACHMENT_UPLOAD','PRISM_ATTACHMENT_DOWNLOAD','PRISM_ATTACHMENT_REMOVE','PRISM_ATTACHMENT_ABORT'].includes(message?.type))return;
 if(message.type==='PRISM_ATTACHMENT_ABORT'){uploads.get(message.requestId)?.abort();respond({success:true});return false;}
 if(!platformPage()||typeof message.sessionId!=='string'){respond({success:false,error:'当前页面或会话不可用'});return false;}
 void(async()=>{
  const client=pageAttachmentClient(message.sessionId);
  if(message.type==='PRISM_ATTACHMENT_UPLOAD'){
   if(typeof message.requestId!=='string'||typeof message.name!=='string'||typeof message.data!=='string'||message.data.length>Math.ceil(MAX_ATTACHMENT_SIZE/3)*4||!Number.isSafeInteger(message.size)||message.size<1||message.size>MAX_ATTACHMENT_SIZE)throw Error('附件大小或参数无效');
   const data=base64ToBytes(message.data);if(data.length!==message.size)throw Error('附件传输不完整');
   const controller=new AbortController();uploads.set(message.requestId,controller);
   try{const attachment=await client.upload(new File([data],message.name,{type:String(message.mimeType||'application/octet-stream')}),controller.signal,progress=>{void chrome.runtime.sendMessage({type:'PRISM_ATTACHMENT_PROGRESS',requestId:message.requestId,progress}).catch(()=>{});});respond({success:true,attachment});}
   finally{uploads.delete(message.requestId);}
  }else{
   if(typeof message.id!=='string'||!/^[a-f0-9-]{36}$/.test(message.id))throw Error('附件标识无效');
   if(message.type==='PRISM_ATTACHMENT_REMOVE'){await client.remove(message.id);respond({success:true});}
   else{const blob=await fetchAttachment(message.sessionId,message.id);respond({success:true,data:bytesToBase64(new Uint8Array(await blob.arrayBuffer()))});}
  }
 })().catch(error=>respond({success:false,error:(error as Error).message}));return true;
});
chrome.runtime.onConnect.addListener(port=>{
 if(port.name!=='prism-platform-live')return;
 let close:(()=>void)|undefined,stopped=false,subscribed=false;
 const post=(event:unknown)=>{if(!stopped)try{port.postMessage(event);}catch{stopped=true;close?.();}};
 port.onDisconnect.addListener(()=>{stopped=true;close?.();});
 port.onMessage.addListener((cursor:ConversationCursor)=>{
  if(stopped||subscribed)return;subscribed=true;
  if(!platformPage()||!cursor||typeof cursor.sessionId!=='string'||!Number.isSafeInteger(cursor.after)||cursor.after<0||!Number.isSafeInteger(cursor.eventAfter)||cursor.eventAfter<0||typeof cursor.liveAfter!=='string'){
   post({type:'closed',message:'页面或会话订阅参数无效，请重新打开预览'});return;
  }
  try{close=pageConversationLive(cursor,post);}catch(error){post({type:'closed',message:(error as Error).message});}
 });
});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
 if(message?.type!=='PRISM_PLATFORM_REQUEST')return;
 if(!platformPage()){respond({platform:false});return false;}
 const path=String(message.path || ''),method=message.method || 'GET';
 if(!((method==='GET' && /^\/(context|conversation)(\?|$)/.test(path))||(method==='POST'&&/^\/(messages|cancel)(\?|$)/.test(path)))){respond({platform:true,error:'不支持的平台操作'});return false;}
 void fetch(prefix+path,{signal:AbortSignal.timeout(path.includes('wait=1')?30000:10000),method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(message.body===undefined?{}:{body:JSON.stringify(message.body)})}).then(async res=>{let data;try{data=await res.json();}catch{throw Error('平台接口返回了无效数据，请从平台重新打开预览');}respond({platform:true,status:res.status,data,error:res.ok?undefined:data.error || '平台鉴权失败'});}).catch(e=>respond({platform:true,error:e.message}));return true;
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
