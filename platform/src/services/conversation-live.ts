import crypto from 'node:crypto';
import {conversationEvents} from './conversation-events.js';
interface LiveEvent {seq:number;type:string;transient:true;data:Record<string,unknown>}
interface LiveTurn {runId:string;text:string;events:LiveEvent[];cursor:string;sequence:number;generation:string}
const turns=new Map<string,LiveTurn>();
// Operational chatter exists only while a turn is active; it is never chat history.
export function appendLiveEvent(sessionId:string,runId:string,type:string,data:Record<string,unknown>){
 let turn=turns.get(sessionId);
 if(!turn||turn.runId!==runId){turn={runId,text:'',events:[],cursor:'',sequence:0,generation:crypto.randomUUID()};turns.set(sessionId,turn);}
 if(type==='message.delta'&&typeof data.delta==='string'){
  turn.text=(turn.text+data.delta).slice(0,100000);
  turn.events=turn.events.filter(event=>event.type!=='message.delta');
 }
 const seq=++turn.sequence;
 turn.cursor=`${turn.generation}:${seq}`;
 turn.events.push({seq,type,transient:true,data:{...data,runId,at:Date.now()}});
 if(turn.events.length>100)turn.events.splice(0,turn.events.length-100);
 conversationEvents.emit(sessionId);
}
export function liveConversation(sessionId:string){return turns.get(sessionId);}
export function clearLiveConversation(sessionId:string,runId:string){if(turns.get(sessionId)?.runId===runId)turns.delete(sessionId);}
