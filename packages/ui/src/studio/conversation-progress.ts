import type {PlatformConversation} from './platform-client.js';
export interface ToolActivity {id:string;label:string;status:'running'|'completed'|'failed'|'reported';durationMs?:number}
export function conversationProgress(value?:PlatformConversation):{label:string;tools:ToolActivity[]}{
 const active=value?.active_run;
 if(!active||!['queued','running','cancelling'].includes(active.status))return {label:'',tools:[]};
 const runId=active.id,working=true;
 const tools=new Map<string,ToolActivity & {startedAt?:number;legacy?:boolean}>();let responding=false,finishing=false;
 for(const event of value?.events || []){
  const data=event.data;if(data.runId!==runId)continue;
  if(['run.completed','run.failed','run.cancelled'].includes(event.type)){finishing=true;continue;}
  if(event.type==='message.delta'){
   responding=true;
   for(const tool of tools.values())if(tool.legacy&&tool.status==='running')tool.status='reported';
   continue;
  }
  if(!['tool.started','tool.completed'].includes(event.type))continue;
  const id=String(data.toolCallId || `event-${event.seq}`),previous=tools.get(id);
  if(event.type==='tool.started'){
   responding=false;
   if(data.tool==='legacy')for(const tool of tools.values())if(tool.legacy&&tool.status==='running')tool.status='reported';
   tools.set(id,{id,label:String(data.label || data.tool || '执行工具'),status:'running',legacy:data.tool==='legacy',startedAt:typeof data.at==='number'?data.at:undefined});
  }else tools.set(id,{id,label:previous?.label || String(data.label || data.tool || '执行工具'),status:data.success===false||data.error?'failed':'completed',durationMs:typeof data.durationMs==='number'?data.durationMs:previous?.startedAt!==undefined&&typeof data.at==='number'?Math.max(0,data.at-previous.startedAt):undefined});
 }
 if(!working||finishing)for(const tool of tools.values())if(tool.status==='running')tool.status='reported';
 const all=[...tools.values()],running=all.filter(tool=>tool.status==='running');
 const label=!working?'':active?.status==='cancelling'?'正在取消，等待 Agent 停止…':active?.status==='queued'?'正在准备执行…':finishing?'正在结束本轮任务…':running.length?running.at(-1)!.label:responding?'Agent 正在整理回复…':'Agent 正在处理…';
 return {label,tools:[...all.filter(tool=>tool.status!=='running').slice(-5),...running]};
}
