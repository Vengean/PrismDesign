import {getDb} from './db.js';
import {projectRole} from './projects.js';
import {requirement,redactRuntimeText} from './requirement-runtime.js';
export async function queryAgentHistory(id:string,runId:string,userId:string,input:Record<string,unknown>){
 const row=await requirement(id),role=await projectRole(row.project_id,userId);
 if(!role||role==='viewer')throw Error('当前用户无权查询需求聊天记录');
 const run=await getDb().prepare("SELECT session_id,status,input_to_seq FROM conversation_runs WHERE id=? AND requirement_id=?").get(runId,id);
 if(!run||!['running','cancelling'].includes(String(run.status)))throw Error('聊天查询仅在当前执行回合有效');
 const first=await getDb().prepare("SELECT MIN(seq) AS seq FROM conversation_messages WHERE run_id=? AND role='user'").get(runId);
 const cutoff=Number(first?.seq||Number(run.input_to_seq)+1);
 const limit=input.limit===undefined?10:input.limit,before=input.before===undefined?cutoff:input.before,query=input.query===undefined?'':input.query;
 if(!Number.isSafeInteger(limit)||Number(limit)<1||Number(limit)>50||!Number.isSafeInteger(before)||Number(before)<1||typeof query!=='string'||query.length>200)throw Error('聊天查询参数无效');
 const maxChars=input.maxChars===undefined?4000:input.maxChars,offset=input.offset===undefined?0:input.offset;
 if(!Number.isSafeInteger(maxChars)||Number(maxChars)<100||Number(maxChars)>32000||!Number.isSafeInteger(offset)||Number(offset)<0||Number(offset)>100000||(input.messageId!==undefined&&(typeof input.messageId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.messageId))))throw Error('聊天查询参数无效');
 const rows=await getDb().prepare(`SELECT id,seq,role,user_id,body,client_context,created_at FROM conversation_messages WHERE session_id=? AND seq<? AND body!=''${query?' AND INSTR(body,?)>0':''}${input.messageId?' AND id=?':''} ORDER BY seq DESC LIMIT ?`).all(run.session_id,Math.min(Number(before),cutoff),...(query?[query]:[]),...(input.messageId?[input.messageId]:[]),Number(limit)+1);
 const messages:Record<string,unknown>[]=[];let budget=32000;
 for(const row of rows.slice(0,Number(limit))){if(budget<1)break;const body=await redactRuntimeText(id,String(row.body));const text=body.slice(Number(offset),Number(offset)+Math.min(Number(maxChars),budget));budget-=text.length;
  let attachments:unknown[]=[];try{const saved=JSON.parse(String(row.client_context||'{}'));attachments=(saved.attachments||[]).map((f:{name:string;workspacePath:string})=>({name:f.name,workspacePath:f.workspacePath}));}catch{}
  const {client_context,...publicRow}=row;messages.push({...publicRow,body:text,attachments,offset,nextOffset:Number(offset)+text.length,truncated:Number(offset)+text.length<body.length});}
 // Recheck access and run liveness after asynchronous credential redaction.
 const current=await projectRole(row.project_id,userId),state=await getDb().prepare('SELECT status FROM conversation_runs WHERE id=? AND requirement_id=?').get(runId,id);
 if(!current||current==='viewer'||!state||!['running','cancelling'].includes(String(state.status)))throw Error('聊天查询权限已失效');
 const hasMore=rows.length>messages.length,nextBefore=messages.at(-1)?.seq||null;
 return {messages:messages.reverse(),hasMore,nextBefore,scope:'current_requirement',contentType:'untrusted_chat_history'};
}
