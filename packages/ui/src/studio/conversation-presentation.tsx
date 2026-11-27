import React from 'react';
import type {PlatformConversation} from './platform-client.js';
import {isRunWorking} from './run-state.js';
export function messageBubbleClass(role:string,own:boolean){
 if(role!=='user')return '';
 return own?'bg-[#dbeafe] text-[#2563eb] rounded-br-sm':'bg-[#f1f5f9] text-[#334155] rounded-bl-sm';
}
export function isCancellationNotice(metadata?:string){try{return JSON.parse(metadata||'{}').systemNotice?.type==='run.cancelled';}catch{return false;}}
export function pendingMessageBoundary(value?:PlatformConversation){
 if(!value||value.restricted||!isRunWorking(value.active_run?.status))return undefined;
 if(value.agent_pending_message===null)return undefined;
 const first=value.agent_pending_message;
 const candidates=value.messages.filter(m=>m.role==='user'&&!m.run_id&&m.seq>=(first?.seq??((value.agent_read_cursor||0)+1))).sort((a,b)=>a.seq-b.seq);
 return candidates[0]?.id;
}
export function PendingMessagesDivider(){return <div data-agent-waiting role="status" className="my-3 flex items-center gap-2 text-center text-[11px] text-muted-foreground"><span className="min-w-3 flex-1 border-t"/><span>当前任务结束后处理新消息</span><span className="min-w-3 flex-1 border-t"/></div>;}
