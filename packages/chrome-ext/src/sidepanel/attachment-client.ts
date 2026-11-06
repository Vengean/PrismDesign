import {base64ToBytes,bytesToBase64,saveAttachment,MAX_ATTACHMENT_SIZE,type AttachmentClient,type AttachmentMeta} from '../../../ui/src/studio/attachment-client.js';
import {requestId} from '../../../ui/src/studio/platform-client.js';
export function tabAttachmentClient(tabId:number,sessionId:string):AttachmentClient{
 async function call<T>(message:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)throw new DOMException('上传已取消','AbortError');
  return new Promise((resolve,reject)=>{
   let settled=false;
   const abort=()=>{settled=true;void chrome.tabs.sendMessage(tabId,{type:'PRISM_ATTACHMENT_ABORT',requestId:message.requestId}).catch(()=>{});reject(new DOMException('上传已取消','AbortError'));};
   signal?.addEventListener('abort',abort,{once:true});
   chrome.tabs.sendMessage(tabId,{...message,sessionId}).then(result=>{
    signal?.removeEventListener('abort',abort);
    if(settled){if(result?.attachment)void client.remove(result.attachment.id).catch(()=>{});return;}
    settled=true;if(!result?.success)reject(Error(result?.error||'页面通信中断，请重新打开预览'));else resolve(result as T);
   }).catch(error=>{signal?.removeEventListener('abort',abort);if(!settled){settled=true;reject(error);}});
  });
 }
 const client:AttachmentClient={
  async upload(file,signal,onProgress){
   if(!file.size||file.size>MAX_ATTACHMENT_SIZE)throw Error('单个附件需大于 0 且不超过 5 MB');
   const id=requestId(),data=bytesToBase64(new Uint8Array(await file.arrayBuffer()));
   const progress=(message:any,sender:chrome.runtime.MessageSender)=>{if(sender.tab?.id===tabId&&message.type==='PRISM_ATTACHMENT_PROGRESS'&&message.requestId===id)onProgress(message.progress);};
   chrome.runtime.onMessage.addListener(progress);
   try{const result=await call<{attachment:AttachmentMeta}>({type:'PRISM_ATTACHMENT_UPLOAD',requestId:id,name:file.name,mimeType:file.type,size:file.size,data},signal);return result.attachment;}
   finally{chrome.runtime.onMessage.removeListener(progress);}
  },
  async remove(id){await call({type:'PRISM_ATTACHMENT_REMOVE',id});},
  async download(file){const result=await call<{data:string}>({type:'PRISM_ATTACHMENT_DOWNLOAD',id:file.id});saveAttachment(new Blob([base64ToBytes(result.data)]),file.name);},
 };
 return client;
}
