import crypto from 'node:crypto';
import {conversationError} from './conversation-errors.js';
import {getDb} from './db.js';
import {requirement,redactRuntimeText,runtimeOperationActive} from './requirement-runtime.js';
import {activeWorkspaceRun,workspaceEvents} from './workspace-lock.js';
import {dockerAgentTransport,type AgentTransport,type RuntimeEvent} from './agent-transport.js';

export function messageContext(value:unknown):string{
 if(value===undefined)return '';
 const data=value as {text?:unknown;comments?:unknown;contextOrder?:unknown};
 if(!data||typeof data.text!=='string'||data.text.length>20000||!Array.isArray(data.comments)||data.comments.length>30)throw Error('消息上下文无效');
 const string=(value:unknown)=>{if(value===undefined||value===null)return '';if(typeof value!=='string')throw Error('元素上下文无效');return value;};
 const comments=data.comments.map(item=>{
  if(!item||typeof item.comment!=='string'||!item.element||typeof item.element.domPath!=='string'||typeof item.element.tagName!=='string')throw Error('元素上下文无效');
  const el=item.element,element:Record<string,unknown>={};
  for(const key of ['pagePath','domPath','tagName','id','textContent','className','role','ariaLabel','componentChain'])element[key]=string(el[key]);
  element.component=el.component?{name:string(el.component.name),sourceFile:string(el.component.sourceFile),sourceLine:Number(el.component.sourceLine)||undefined,props:{}}:null;
  element.componentChainDetail=Array.isArray(el.componentChainDetail)?el.componentChainDetail.map((part:Record<string,unknown>)=>({name:string(part?.name),sourceFile:string(part?.sourceFile),sourceLine:Number(part?.sourceLine)||undefined})):[];
  return {element,comment:item.comment};
 });
 const result=JSON.stringify({text:data.text,comments,contextOrder:Array.isArray(data.contextOrder)?data.contextOrder.filter(x=>x==='comments'||x==='attachments'):[]});
 if(Buffer.byteLength(result)>64000)throw Error('元素上下文过大');return result;
}
export function initConversationTables(){
 getDb().exec(`CREATE TABLE IF NOT EXISTS conversation_runs (
  id TEXT PRIMARY KEY,requirement_id TEXT NOT NULL REFERENCES requirements(id),session_id TEXT NOT NULL REFERENCES project_sessions(id),
  user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',error TEXT NOT NULL DEFAULT '',
  cancel_supported INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id,user_id,request_id));
  CREATE UNIQUE INDEX IF NOT EXISTS conversation_active_run ON conversation_runs(requirement_id) WHERE status IN ('queued','running','cancelling','interrupted');
  CREATE TABLE IF NOT EXISTS conversation_messages (
   seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,session_id TEXT NOT NULL REFERENCES project_sessions(id),run_id TEXT NOT NULL REFERENCES conversation_runs(id),
   role TEXT NOT NULL CHECK(role IN ('user','assistant')),user_id TEXT REFERENCES users(id),body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS conversation_message_session ON conversation_messages(session_id,seq);
  CREATE TABLE IF NOT EXISTS conversation_events (
   seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES project_sessions(id),run_id TEXT NOT NULL REFERENCES conversation_runs(id),
   type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS conversation_event_session ON conversation_events(session_id,seq);`);
 const columns=getDb().prepare('PRAGMA table_info(conversation_messages)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='client_context'))getDb().exec("ALTER TABLE conversation_messages ADD COLUMN client_context TEXT NOT NULL DEFAULT ''");
}
export function conversationSession(id:string){
 requirement(id);const row=getDb().prepare('SELECT id FROM project_sessions WHERE requirement_id=?').get(id) as {id:string}|undefined;
 if(!row)throw new Error('需求会话不存在');return row.id;
}
export function interruptPreviousRuns(){
 const message='平台服务连接已中断，本轮任务无法继续确认。请重启需求环境后继续，源码和历史对话会保留。';
 getDb().prepare("UPDATE conversation_messages SET body=CASE WHEN body='' THEN ? ELSE body || char(10) || char(10) || ? END WHERE role='assistant' AND run_id IN (SELECT id FROM conversation_runs WHERE status IN ('queued','running','cancelling'))").run(message,message);
 getDb().prepare("UPDATE conversation_runs SET status='interrupted',error='平台服务连接已中断，请重启需求环境后继续，源码和历史对话会保留',updated_at=datetime('now') WHERE status IN ('queued','running','cancelling')").run();
}
function appendEvent(sessionId:string,runId:string,type:string,data:unknown){
 getDb().prepare('INSERT INTO conversation_events(session_id,run_id,type,data) VALUES(?,?,?,?)').run(sessionId,runId,type,JSON.stringify(data));
}
export function readConversation(id:string,after=0,eventAfter=0){
 const sessionId=conversationSession(id);
 const rows=getDb().prepare('SELECT * FROM conversation_messages WHERE session_id=? AND seq>? ORDER BY seq LIMIT 100').all(sessionId,after) as {seq:number}[];
 const events=getDb().prepare('SELECT * FROM conversation_events WHERE session_id=? AND seq>? ORDER BY seq LIMIT 200').all(sessionId,eventAfter) as {seq:number;data:string}[];
 const currentMessages=getDb().prepare('SELECT * FROM conversation_messages WHERE session_id=? ORDER BY seq DESC LIMIT 2').all(sessionId);
 const runs=getDb().prepare('SELECT * FROM conversation_runs WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(sessionId).map(value=>{const run=value as {id:string;status:string;error:string;user_id:string;cancel_supported:number};return ['interrupted','failed'].includes(run.status)?{...run,error:conversationError(run.error,run.status==='interrupted')}:run;});
 return {session_id:sessionId,messages:rows,current_messages:currentMessages,events:events.map(e=>({...e,data:JSON.parse(e.data)})),runs,active_run:activeWorkspaceRun(id) || null,
  next_message_cursor:rows.at(-1)?.seq || after,next_event_cursor:events.at(-1)?.seq || eventAfter};
}
export function readConversationForRole(id:string,role:string,after=0,eventAfter=0){
 const value=readConversation(id,after,eventAfter);
 if(role!=='viewer')return {...value,restricted:false};
 return {session_id:value.session_id,active_run:value.active_run,runs:value.runs.map(run=>{const r=run as {id:string;status:string;user_id:string};return {id:r.id,status:r.status,user_id:r.user_id};}),messages:[],current_messages:[],events:[],next_message_cursor:after,next_event_cursor:eventAfter,restricted:true};
}
export function createConversationService(transport:AgentTransport=dockerAgentTransport){
 const pending=new Map<string,Promise<void>>();
 function submit(id:string,userId:string,message:string,requestId:string,clientContext?:unknown){
  const metadata=messageContext(clientContext);
  const sessionId=conversationSession(id);
  if(runtimeOperationActive(id))throw new Error('环境操作进行中，请稍后发送');
  if(!message.trim() || message.length>20000 || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw new Error('消息或请求标识无效');
  const repeat=getDb().prepare('SELECT id FROM conversation_runs WHERE session_id=? AND user_id=? AND request_id=?').get(sessionId,userId,requestId) as {id:string}|undefined;
  if(repeat){const original=getDb().prepare("SELECT body,client_context FROM conversation_messages WHERE run_id=? AND role='user'").get(repeat.id) as {body:string;client_context:string};if(original.body!==message.trim()||original.client_context!==metadata)throw new Error('相同请求标识不能用于不同消息');return {id:repeat.id,replayed:true};}
  const runId=crypto.randomUUID();
  getDb().transaction(()=>{
   const active=activeWorkspaceRun(id);if(active)throw new Error(active.status==='interrupted'?'上一任务连接中断，请先重启需求环境后继续':'Agent 正在处理此需求，请等待任务结束');
   getDb().prepare('INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id) VALUES(?,?,?,?,?)').run(runId,id,sessionId,userId,requestId);
   getDb().prepare('INSERT INTO conversation_messages(id,session_id,run_id,role,user_id,body,client_context) VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),sessionId,runId,'user',userId,message.trim(),metadata);
   getDb().prepare('INSERT INTO conversation_messages(id,session_id,run_id,role,body) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),sessionId,runId,'assistant','');
   appendEvent(sessionId,runId,'run.queued',{userId});
  })();
  workspaceEvents.emit('locked',id);
  // Defer execution so the durable run/lock exists before any asynchronous operation.
  const work=Promise.resolve().then(()=>execute(id,sessionId,runId,message)).finally(()=>pending.delete(runId));pending.set(runId,work);
  return {id:runId,replayed:false};
 }
 async function execute(id:string,sessionId:string,runId:string,message:string){
  let result:Record<string,unknown>|undefined;let failure='';let started=false;let canCancel=false;
  const safe=(value:string)=>{try{return redactRuntimeText(id,value).slice(0,100000);}catch{return '需求凭证不可读取，请检查平台数据和密钥文件';}};
  try {
   // A unique provider client per run allows reliable context reconstruction from
   // persisted messages after a container/platform restart without stale SDK state.
   const history=getDb().prepare("SELECT role,body FROM conversation_messages WHERE session_id=? AND run_id!=? AND body!='' ORDER BY seq DESC LIMIT 20").all(sessionId,runId) as {role:string;body:string}[];
   const context=history.reverse().map(m=>`[${m.role}]\n${m.body.slice(-4000)}`).join('\n\n').slice(-32000);
   getDb().prepare("UPDATE conversation_runs SET status='running' WHERE id=?").run(runId);
   await transport.run(id,{runId,clientId:`platform-${sessionId}-${runId}`,message:context?`以下是此前需求对话记录，作为上下文参考：\n${context}\n\n当前用户请求：\n${message}`:message},(event:RuntimeEvent)=>{
    const data=JSON.parse(redactRuntimeText(id,JSON.stringify(event.data))) as Record<string,unknown>;
    if(event.type==='bridge.ready'){canCancel=data.cancelSupported===true;return;}
    if(event.type==='bridge.dispatch'){started=true;return;}
    if(event.type==='bridge.result'){result=data;return;}
    if(event.type==='bridge.error'){failure=String(data.message || 'Agent 执行失败');return;}
    if(!['run.started','message.delta','tool.started','tool.completed','file.changed','run.completed','run.failed','run.cancelled'].includes(event.type))return;
    if(data.runId!==runId)return;
    if(event.type==='run.started'){started=true;getDb().prepare('UPDATE conversation_runs SET cancel_supported=? WHERE id=?').run(canCancel?1:0,runId);}
    if(event.type==='message.delta' && typeof data.delta==='string')getDb().prepare("UPDATE conversation_messages SET body=substr(body || ?,1,100000) WHERE run_id=? AND role='assistant'").run(data.delta,runId);
    appendEvent(sessionId,runId,event.type,data);
   });
   if(!result)throw new Error(failure || 'Agent 未返回最终结果');
   const status=result.cancelled?'cancelled':result.success===false || result.httpOk===false?'failed':'succeeded';
   const raw=typeof result.message==='string'?safe(result.message):'';
   const body=status==='failed'?conversationError(raw,false):raw;
   if(body)getDb().prepare("UPDATE conversation_messages SET body=? WHERE run_id=? AND role='assistant'").run(body,runId);
   getDb().prepare("UPDATE conversation_runs SET status=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,status==='failed'?body:'',runId);
   appendEvent(sessionId,runId,'run.finished',{status});
  }catch(e){
   // A lost bridge after execution began cannot prove that code writes stopped.
   // Keep the exclusive lock until a deliberate container restart terminates it.
   const status=started?'interrupted':'failed';
   const diagnostic=safe(failure || (e as Error).message);
   console.error(`[Conversation ${runId}] ${status}: ${diagnostic}`);
   const error=conversationError(diagnostic,started);
   getDb().prepare("UPDATE conversation_messages SET body=CASE WHEN body='' THEN ? ELSE body || char(10) || char(10) || ? END WHERE run_id=? AND role='assistant'").run(error,error,runId);
   getDb().prepare("UPDATE conversation_runs SET status=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,error,runId);
   appendEvent(sessionId,runId,'run.finished',{status,error});
  }finally{workspaceEvents.emit('changed',id);}
 }
 async function cancel(id:string,runId:string){
  const run=getDb().prepare('SELECT * FROM conversation_runs WHERE id=? AND requirement_id=?').get(runId,id) as {session_id:string;status:string;cancel_supported:number}|undefined;
  if(!run || !['running','cancelling'].includes(run.status))throw new Error('任务未在运行');
  if(!run.cancel_supported)throw new Error('当前环境的 Agent SDK 暂不支持取消，请更新工作镜像后重试');
  await transport.cancel(id,runId,`platform-${run.session_id}-${runId}`);
  getDb().prepare("UPDATE conversation_runs SET status='cancelling' WHERE id=? AND status='running'").run(runId);
  // Do not release the lock on cancellation acknowledgement; wait for actual completion.
 }
 return {submit,cancel,wait:async(runId:string)=>{await pending.get(runId);}};
}
export const conversations=createConversationService();
