export interface AttachmentMeta {id:string;name:string;mimeType:string;size:number;workspacePath?:string;sha256?:string}
export interface AttachmentClient {
 upload:(file:File,signal:AbortSignal,onProgress:(percent:number)=>void)=>Promise<AttachmentMeta>;
 remove:(id:string)=>Promise<void>;
 download:(file:AttachmentMeta)=>Promise<void>;
}
export const MAX_ATTACHMENT_SIZE=5*1024*1024,MAX_ATTACHMENT_TOTAL=20*1024*1024,MAX_ATTACHMENTS=5;
export function bytesToBase64(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
export function base64ToBytes(value:string){const text=atob(value);return Uint8Array.from(text,char=>char.charCodeAt(0));}
export function saveAttachment(blob:Blob,name:string){const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.style.display='none';document.documentElement.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function attachmentUrl(sessionId:string,id?:string){return '/__prism_platform__/attachments'+(id?'/'+encodeURIComponent(id):'')+'?sessionId='+encodeURIComponent(sessionId);}
async function errorMessage(response:Response){try{return (await response.json()).error||'附件操作失败';}catch{return `附件请求失败 (${response.status})`;}}
export async function fetchAttachment(sessionId:string,id:string){const response=await fetch(attachmentUrl(sessionId,id),{credentials:'same-origin',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(await errorMessage(response));const blob=await response.blob();if(blob.size>MAX_ATTACHMENT_SIZE)throw Error('附件超过大小限制');return blob;}
export function pageAttachmentClient(sessionId:string):AttachmentClient{
 return {
  upload(file,signal,onProgress){return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(new DOMException('上传已取消','AbortError'));return;}
   const xhr=new XMLHttpRequest(),abort=()=>xhr.abort();signal.addEventListener('abort',abort,{once:true});
   const finish=(error?:Error,value?:AttachmentMeta)=>{signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
   xhr.open('POST',attachmentUrl(sessionId));xhr.withCredentials=true;xhr.timeout=60000;
   xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('x-attachment-name',encodeURIComponent(file.name));xhr.setRequestHeader('x-attachment-type',file.type||'application/octet-stream');
   xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(99,Math.round(event.loaded/event.total*100)));};
   xhr.onload=()=>{try{const result=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw Error(result.error||'附件上传失败');onProgress(100);finish(undefined,result.attachment);}catch(error){finish(error as Error);}};
   xhr.onerror=()=>finish(Error('附件上传失败，请检查网络后重试'));xhr.ontimeout=()=>finish(Error('附件上传超时，请重试'));xhr.onabort=()=>finish(new DOMException('上传已取消','AbortError'));xhr.send(file);
  });},
  async remove(id){const response=await fetch(attachmentUrl(sessionId,id),{method:'DELETE',credentials:'same-origin',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(await errorMessage(response));},
  async download(file){saveAttachment(await fetchAttachment(sessionId,file.id),file.name);},
 };
}
