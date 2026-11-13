import type {PlatformContext,PlatformConversation,PlatformMessage} from '../../../ui/src/studio/platform-client.js';
export interface NotificationCheckpoint {after:number;eventAfter:number;known:string[];active:{id:string;userId:string}[];updatedAt:number}
export interface NotificationCandidate {kind:'mention'|'question'|'verification'|'completed'|'failed';title:string;message:string;group:string;priority:number}
const terminal=new Set(['succeeded','failed','interrupted']);
const snippet=(value:string)=>{const text=value.replace(/```[\s\S]*?```/g,'[代码]').replace(/<prism-collaboration>[\s\S]*?<\/prism-collaboration>/g,'').replace(/!?(\[[^\]]*\])\([^)]*\)/g,'$1').replace(/[#*_`>]/g,'').replace(/\s+/g,' ').trim();return Array.from(text).length>140?Array.from(text).slice(0,139).join('').replace(/[，,、；;：:。.!?！？…]+$/u,'')+'…':text;};
export function collectNotifications(context:PlatformContext,value:PlatformConversation,previous?:NotificationCheckpoint){
 const known=new Set(previous?.known||[]),active=new Map((previous?.active||[]).map(run=>[run.id,run.userId]));
 const finished=new Set(value.events.filter(event=>event.type==='run.finished').map(event=>String(event.data.runId||'')));
 const messages=[...new Map([...value.messages,...value.current_messages].map(message=>[message.id,message])).values()];
 const groups=new Map<string,NotificationCandidate>();
 const offer=(key:string,candidate:NotificationCandidate,eligible=true)=>{const seen=known.has(key);known.add(key);if(!previous||seen||!eligible)return;const prior=groups.get(candidate.group);if(!prior||prior.priority<candidate.priority)groups.set(candidate.group,candidate);};
 const related=(message:PlatformMessage)=>!previous||message.seq>previous.after||!!message.run_id&&(active.has(message.run_id)||finished.has(message.run_id));
 for(const message of messages){
  const group=message.run_id?'run:'+message.run_id:'message:'+message.id;
  let mentions:string[]=[];try{mentions=JSON.parse(message.mentions||'[]');}catch{}
  if(message.user_id!==context.userId&&mentions.includes(context.userId))offer('mention:'+message.id,{kind:'mention',title:'有人 @ 了你',message:snippet(message.body)||'有一条消息提到了你。',group,priority:4},related(message));
  if(message.role==='assistant')try{
   const verification=JSON.parse(message.client_context||'{}').verification;
   if(verification?.id&&verification.status==='awaiting_confirmation')offer('verification:'+verification.id,{kind:'verification',title:'Agent 已完成，等待测试确认',message:snippet(String(verification.goal||'请在会话中查看建议用例并确认测试。')),group,priority:3},related(message)&&(!message.run_id||active.get(message.run_id)===context.userId||value.runs.find(run=>run.id===message.run_id)?.user_id===context.userId));
  }catch{}
 }
 for(const question of value.pending_questions||[])if(question.userId===context.userId){
  const reply=messages.filter(message=>message.role==='assistant').at(-1);
  offer('question:'+question.id,{kind:'question',title:'Agent 需要你确认',message:snippet(question.question),group:reply?.run_id?'run:'+reply.run_id:'question:'+question.id,priority:5});
 }
 for(const run of value.runs){
  if(!terminal.has(run.status))continue;
  const owned=run.user_id===context.userId||active.get(run.id)===context.userId;
  const changed=finished.has(run.id)||active.has(run.id)||messages.some(message=>message.run_id===run.id&&!!previous&&message.seq>previous.after);
  const failed=run.status!=='succeeded';
  const reply=messages.find(message=>message.run_id===run.id&&message.role==='assistant');
  offer('run:'+run.id,{kind:failed?'failed':'completed',title:failed?'Agent 任务执行失败':'Agent 已完成任务',message:snippet(failed?run.error||reply?.body||run.title||'请返回会话查看详情。':run.title||reply?.body||'请返回会话查看结果。'),group:'run:'+run.id,priority:failed?6:1},owned&&changed);
 }
 // Cancelled turns are acknowledged silently rather than resurfacing on reconnect.
 for(const run of value.runs)if(run.status==='cancelled')known.add('run:'+run.id);
 const currentActive=value.active_run?[{id:value.active_run.id,userId:value.active_run.user_id}]:[];
 const checkpoint:NotificationCheckpoint={after:Math.max(previous?.after||0,value.next_message_cursor),eventAfter:Math.max(previous?.eventAfter||0,value.next_event_cursor),known:[...known].slice(-400),active:currentActive,updatedAt:Date.now()};
 return {checkpoint,candidates:[...groups.values()]};
}
