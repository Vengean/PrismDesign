export const PLATFORM_PREFIX='/__prism_platform__';
export interface PlatformContext {protocol:1;projectId:string;requirementId:string;sessionId:string;projectName:string;title:string;userId:string;role:'viewer'|'editor'|'admin';}
export function isPlatformContext(value:unknown):value is PlatformContext {const v=value as PlatformContext;return !!v&&v.protocol===1&&['projectId','requirementId','sessionId','projectName','title','userId'].every(key=>typeof (v as unknown as Record<string,unknown>)[key]==='string')&&['viewer','editor','admin'].includes(v.role);}
export interface PlatformMessage {id:string;seq:number;run_id:string;role:'user'|'assistant';body:string;client_context?:string;created_at?:string;user_id:string|null;}
export interface PlatformConversation {session_id:string;restricted:boolean;messages:PlatformMessage[];current_messages:PlatformMessage[];active_run:{id:string;status:string;user_id:string}|null;runs:{id:string;status:string;error?:string;cancel_supported?:number}[];events:{seq:number;type:string;data:Record<string,unknown>}[];next_message_cursor:number;next_event_cursor:number;}
export type PlatformRequest=<T>(path:string,method?:'GET'|'POST',body?:unknown)=>Promise<T>;
export const requestId=():string=>globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
export const pagePlatformRequest:PlatformRequest=async<T>(path:string,method='GET',body?:unknown)=>{
 const res=await fetch(PLATFORM_PREFIX+path,{signal:AbortSignal.timeout(10000),method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await res.json();if(!res.ok)throw new Error(data.error || `平台请求失败 (${res.status})`);return data as T;
};
export class PlatformClient {
 private syncing:Promise<PlatformConversation>|undefined;
 private messages=new Map<string,PlatformMessage>();private after=0;private eventAfter=0;
 constructor(readonly context:PlatformContext,private request:PlatformRequest=pagePlatformRequest){}
 private bound<T>(path:string,method:'GET'|'POST'='GET',body?:unknown){return this.request<T>(path+(path.includes('?')?'&':'?')+'sessionId='+encodeURIComponent(this.context.sessionId),method,body);}
 sync():Promise<PlatformConversation>{
  if(!this.syncing)this.syncing=this.read().finally(()=>{this.syncing=undefined;});
  return this.syncing;
 }
 private async read(){
  const value=await this.bound<PlatformConversation>(`/conversation?after=${this.after}&eventAfter=${this.eventAfter}`);
  if(value.session_id!==this.context.sessionId)throw new Error('会话归属已变化，请重新打开预览');
  this.after=value.next_message_cursor;this.eventAfter=value.next_event_cursor;
  if(value.restricted){this.messages.clear();this.after=0;this.eventAfter=0;}else for(const message of [...value.messages,...value.current_messages])this.messages.set(message.id,message);
  return {...value,messages:[...this.messages.values()].sort((a,b)=>a.seq-b.seq)};
 }
 send(message:string,id:string=requestId(),clientContext?:unknown){return this.bound<{id:string}>('/messages','POST',{message,requestId:id,...(clientContext===undefined?{}:{clientContext})});}
 cancel(runId:string){return this.bound('/cancel','POST',{runId});}
}
