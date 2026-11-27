import type {ExtensionRelease} from './extension-compatibility.js';
export const PLATFORM_PREFIX='/__prism_platform__';
export interface PlatformContext {extension?:ExtensionRelease;protocol:1;projectId:string;requirementId:string;sessionId:string;projectName:string;title:string;userId:string;role:'viewer'|'editor'|'admin';}
export function isPlatformContext(value:unknown):value is PlatformContext {const v=value as PlatformContext;return !!v&&v.protocol===1&&['projectId','requirementId','sessionId','projectName','title','userId'].every(key=>typeof (v as unknown as Record<string,unknown>)[key]==='string')&&['viewer','editor','admin'].includes(v.role);}
export interface PlatformMessage {id:string;seq:number;run_id:string|null;request_id?:string;mentions?:string;role:'user'|'assistant';body:string;client_context?:string;created_at?:string;user_id:string|null;}
export interface PlatformConversation {agent_pending_message?:{id:string;seq:number}|null;has_more_history?:boolean;oldest_message_cursor?:number;latest_mention?:{id:string;seq:number}|null;participants?:{id:string;name:string}[];agent_read_cursor?:number;pending_questions?:{id:string;userId:string;question:string;messageIds:string[]}[];agent_paused?:boolean;session_id:string;restricted:boolean;messages:PlatformMessage[];current_messages:PlatformMessage[];active_run:{id:string;status:string;user_id:string}|null;runs:{id:string;status:string;title?:string;user_id?:string;error?:string;cancel_supported?:number}[];events:{seq:number;transient?:boolean;type:string;data:Record<string,unknown>}[];next_message_cursor:number;next_event_cursor:number;next_live_cursor?:string;}
export type PlatformRequest=<T>(path:string,method?:'GET'|'POST',body?:unknown)=>Promise<T>;
export const requestId=():string=>globalThis.crypto.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
export const pagePlatformRequest:PlatformRequest=async<T>(path:string,method='GET',body?:unknown)=>{
 const res=await fetch(PLATFORM_PREFIX+path,{signal:AbortSignal.timeout(path.includes('wait=1')?30000:10000),method,credentials:'same-origin',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await res.json();if(!res.ok)throw new Error(data.error || `平台请求失败 (${res.status})`);return data as T;
};
export class PlatformClient {
 private syncing:Promise<PlatformConversation>|undefined;
 private events=new Map<string,PlatformConversation['events'][number]>();
 private liveAfter='';private initialized=false;private latest?:PlatformConversation;private older:Promise<PlatformConversation>|undefined;private accessVersion=0;
 private unloadedUpdates=new Map<string,PlatformMessage>();
 private browsingHistory=false;
 private windowOldest=0;
 private messages=new Map<string,PlatformMessage>();private after=0;private eventAfter=0;
 constructor(readonly context:PlatformContext,private request:PlatformRequest=pagePlatformRequest){}
 private bound<T>(path:string,method:'GET'|'POST'='GET',body?:unknown){return this.request<T>(path+(path.includes('?')?'&':'?')+'sessionId='+encodeURIComponent(this.context.sessionId),method,body);}
 sync(wait=false):Promise<PlatformConversation>{
  if(!this.syncing)this.syncing=this.read(wait).finally(()=>{this.syncing=undefined;});
  return this.syncing;
 }
 private async read(wait:boolean){
  const value=await this.bound<PlatformConversation>(`/conversation?after=${this.after}&eventAfter=${this.eventAfter}&liveAfter=${encodeURIComponent(this.liveAfter)}${!this.initialized?'&latest=1':''}${wait&&this.initialized?'&wait=1':''}`);
  return this.apply(value);
 }
 cursor(){return {sessionId:this.context.sessionId,after:this.after,eventAfter:this.eventAfter,liveAfter:this.liveAfter};}
 apply(value:PlatformConversation):PlatformConversation{
  if(value.session_id!==this.context.sessionId)throw new Error('会话归属已变化，请重新打开预览');
  this.after=Math.max(this.after,value.next_message_cursor);this.eventAfter=Math.max(this.eventAfter,value.next_event_cursor);this.liveAfter=value.next_live_cursor || '';
  if(value.restricted){this.accessVersion++;this.initialized=false;this.browsingHistory=false;this.windowOldest=0;this.messages.clear();this.unloadedUpdates.clear();this.events.clear();this.after=0;this.eventAfter=0;}else{
   const boundary=value.oldest_message_cursor??this.latest?.oldest_message_cursor??0;
   for(const message of value.messages)this.messages.set(message.id,message);
   for(const message of value.current_messages){if(!boundary||message.seq>=boundary||this.messages.has(message.id))this.messages.set(message.id,message);else this.unloadedUpdates.set(message.id,message);}
   while(this.unloadedUpdates.size>200)this.unloadedUpdates.delete(this.unloadedUpdates.keys().next().value!);
   // An idle, long-lived panel keeps a recent window. Older messages remain
   // available through pagination; explicitly loaded history is not evicted.
   if(!this.browsingHistory&&this.messages.size>200){
    const ordered=[...this.messages.values()].sort((a,b)=>a.seq-b.seq);
    for(const message of ordered.slice(0,-200))this.messages.delete(message.id);
    this.windowOldest=ordered[ordered.length-200].seq;
   }
   this.initialized=true;
  }
  for(const [key,event] of this.events)if(event.transient)this.events.delete(key);
  if(!value.restricted){
   for(const event of value.events){
    if(event.type==='message.delta')for(const [seq,old] of this.events)if(old.type==='message.delta'&&old.data.runId===event.data.runId)this.events.delete(seq);
    this.events.set(`${event.transient?'live':'db'}:${event.seq}`,event);
   }
   while(this.events.size>400)this.events.delete(this.events.keys().next().value!);
  }
  const runIds=new Set(value.runs.map(run=>run.id));
  const retainedRuns=new Set([...this.messages.values(),...this.unloadedUpdates.values()].map(message=>message.run_id));retainedRuns.add(value.active_run?.id||null);
  const runs=[...value.runs,...(value.restricted?[]:this.latest?.runs||[]).filter(run=>!runIds.has(run.id)&&retainedRuns.has(run.id))];
  return this.latest={...value,runs,has_more_history:value.restricted?false:!!this.windowOldest||!!(value.has_more_history??this.latest?.has_more_history),oldest_message_cursor:value.restricted?0:(this.windowOldest||value.oldest_message_cursor)??this.latest?.oldest_message_cursor??0,latest_mention:value.restricted?null:value.latest_mention===undefined?this.latest?.latest_mention:value.latest_mention,events:[...this.events.values()].sort((a,b)=>a.seq-b.seq),messages:[...this.messages.values()].sort((a,b)=>a.seq-b.seq)};
 }
 snapshot(){return this.latest;}
 loadOlder():Promise<PlatformConversation>{
  if(this.older)return this.older;
  const current=this.latest;if(!current) return Promise.reject(Error('会话尚未加载'));
  if(!current.has_more_history||!current.oldest_message_cursor||current.restricted)return Promise.resolve(current);
  const version=this.accessVersion,before=current.oldest_message_cursor;
  this.older=(async()=>{
   const page=await this.bound<PlatformConversation>(`/conversation?before=${before}`);
   if(page.session_id!==this.context.sessionId)throw Error('会话归属已变化，请重新打开预览');
   if(version!==this.accessVersion)return this.latest!;
   if(page.restricted)return this.apply(page);
   if(page.has_more_history&&(!page.oldest_message_cursor||page.oldest_message_cursor>=before))throw Error('历史消息游标未前进，请重试');
   this.browsingHistory=true;
   this.windowOldest=0;
   for(const message of page.messages)if(!this.messages.has(message.id)){this.messages.set(message.id,this.unloadedUpdates.get(message.id)||message);this.unloadedUpdates.delete(message.id);}
   const latest=this.latest!;
   const runIds=new Set(latest.runs.map(run=>run.id));
   const runs=[...latest.runs,...page.runs.filter(run=>!runIds.has(run.id))];
   return this.latest={...latest,runs,has_more_history:page.has_more_history??false,oldest_message_cursor:page.oldest_message_cursor??0,messages:[...this.messages.values()].sort((a,b)=>a.seq-b.seq)};
  })().finally(()=>{this.older=undefined;});return this.older;
 }
 send(message:string,id:string=requestId(),clientContext?:unknown,attachmentIds:string[]=[],browserBindingId?:string){return this.bound<{id:string;messageId?:string;runId?:string|null}>('/messages','POST',{message,requestId:id,...(clientContext===undefined?{}:{clientContext}),...(attachmentIds.length?{attachmentIds}:{}),...(browserBindingId?{browserBindingId}:{})});}
 cancel(runId:string){return this.bound('/cancel','POST',{runId});}
}
