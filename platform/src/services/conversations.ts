import {appendLiveEvent,liveConversation,clearLiveConversation} from './conversation-live.js';
import {conversationEvents} from './conversation-events.js';
import crypto from 'node:crypto';
import {conversationError} from './conversation-errors.js';
import {getDb} from './db.js';
import {requirement,redactRuntimeText,runtimeOperationActive} from './requirement-runtime.js';
import {activeWorkspaceRun,workspaceEvents} from './workspace-lock.js';
import {dockerAgentTransport,type AgentTransport,type RuntimeEvent} from './agent-transport.js';
import {projectRole} from './projects.js';
import {collaborationInstructions,collaborationReply,messageMentions,type PendingQuestion} from './collaboration.js';
import type {WorkspaceAttachment} from './workspace-attachments.js';

export function messageContext(value:unknown,attachments:WorkspaceAttachment[]=[]):string{
 if(value===undefined&&!attachments.length)return '';
 if(value===undefined)value={text:'',comments:[]};
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
 const result=JSON.stringify({text:data.text,comments,...(attachments.length?{attachments}:{}),contextOrder:Array.isArray(data.contextOrder)?data.contextOrder.filter(x=>x==='comments'||x==='attachments'):[]});
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
   seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,session_id TEXT NOT NULL REFERENCES project_sessions(id),run_id TEXT REFERENCES conversation_runs(id),
   role TEXT NOT NULL CHECK(role IN ('user','assistant')),user_id TEXT REFERENCES users(id),body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS conversation_message_session ON conversation_messages(session_id,seq);
  CREATE TABLE IF NOT EXISTS conversation_events (
   seq INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES project_sessions(id),run_id TEXT NOT NULL REFERENCES conversation_runs(id),
   type TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE INDEX IF NOT EXISTS conversation_event_session ON conversation_events(session_id,seq);`);
 const columns=getDb().prepare('PRAGMA table_info(conversation_messages)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='client_context'))getDb().exec("ALTER TABLE conversation_messages ADD COLUMN client_context TEXT NOT NULL DEFAULT ''");
 const info=getDb().prepare('PRAGMA table_info(conversation_messages)').all() as {name:string;notnull:number}[];
 if(info.find(column=>column.name==='run_id')?.notnull){
  getDb().transaction(()=>{
   getDb().exec(`CREATE TABLE conversation_messages_v2 (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,session_id TEXT NOT NULL REFERENCES project_sessions(id),run_id TEXT REFERENCES conversation_runs(id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),user_id TEXT REFERENCES users(id),body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now')),client_context TEXT NOT NULL DEFAULT '');
    INSERT INTO conversation_messages_v2(seq,id,session_id,run_id,role,user_id,body,created_at,client_context) SELECT seq,id,session_id,run_id,role,user_id,body,created_at,client_context FROM conversation_messages;
    DROP TABLE conversation_messages;ALTER TABLE conversation_messages_v2 RENAME TO conversation_messages;
    CREATE INDEX conversation_message_session ON conversation_messages(session_id,seq);`);
  })();
 }
 const add=(table:string,name:string,definition:string)=>{if(!(getDb().prepare('PRAGMA table_info('+table+')').all() as {name:string}[]).some(column=>column.name===name))getDb().exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition);};
 add('conversation_messages','request_id','TEXT');add('conversation_messages','mentions',"TEXT NOT NULL DEFAULT '[]'");
 add('conversation_runs','input_from_seq','INTEGER NOT NULL DEFAULT 0');add('conversation_runs','input_to_seq','INTEGER NOT NULL DEFAULT 0');add('conversation_runs','decision',"TEXT NOT NULL DEFAULT ''");
 getDb().exec(`CREATE UNIQUE INDEX IF NOT EXISTS conversation_post_request ON conversation_messages(session_id,user_id,request_id) WHERE role='user';
  CREATE TABLE IF NOT EXISTS conversation_agent_state(session_id TEXT PRIMARY KEY REFERENCES project_sessions(id),read_cursor INTEGER NOT NULL DEFAULT 0,pending_questions TEXT NOT NULL DEFAULT '[]',paused INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO conversation_agent_state(session_id,read_cursor) SELECT s.id,COALESCE((SELECT MAX(m.seq) FROM conversation_messages m WHERE m.session_id=s.id AND m.role='user' AND m.run_id IS NOT NULL),0) FROM project_sessions s;
  UPDATE conversation_messages SET request_id=(SELECT request_id FROM conversation_runs r WHERE r.id=conversation_messages.run_id) WHERE role='user' AND request_id IS NULL;`);
}
export function conversationSession(id:string){
 requirement(id);const row=getDb().prepare('SELECT id FROM project_sessions WHERE requirement_id=?').get(id) as {id:string}|undefined;
 if(!row)throw new Error('需求会话不存在');return row.id;
}
export function interruptPreviousRuns(){
 getDb().exec("UPDATE conversation_agent_state SET paused=1 WHERE session_id IN (SELECT session_id FROM conversation_runs WHERE status IN ('queued','running','cancelling'))");
 const message='平台服务连接已中断，本轮任务无法继续确认。请重启需求环境后继续，源码和历史对话会保留。';
 getDb().prepare("UPDATE conversation_messages SET body=CASE WHEN body='' THEN ? ELSE body || char(10) || char(10) || ? END WHERE role='assistant' AND run_id IN (SELECT id FROM conversation_runs WHERE status IN ('queued','running','cancelling'))").run(message,message);
 getDb().prepare("UPDATE conversation_runs SET status='interrupted',error='平台服务连接已中断，请重启需求环境后继续，源码和历史对话会保留',updated_at=datetime('now') WHERE status IN ('queued','running','cancelling')").run();
}
function appendEvent(sessionId:string,runId:string,type:string,data:unknown){
 if(!['run.queued','run.started','run.finished','run.cancelling'].includes(type)){
  appendLiveEvent(sessionId,runId,type,data as Record<string,unknown>);return;
 }
 getDb().prepare('INSERT INTO conversation_events(session_id,run_id,type,data) VALUES(?,?,?,?)').run(sessionId,runId,type,JSON.stringify({...data as Record<string,unknown>,runId,at:Date.now()}));
 conversationEvents.emit(sessionId);
}
export function readConversation(id:string,after=0,eventAfter=0){
 const sessionId=conversationSession(id);
 const rows=getDb().prepare('SELECT * FROM conversation_messages WHERE session_id=? AND seq>? ORDER BY seq LIMIT 100').all(sessionId,after) as {seq:number}[];
 const events=getDb().prepare("SELECT * FROM conversation_events WHERE session_id=? AND seq>? AND type IN ('run.queued','run.started','run.finished','run.cancelling') ORDER BY seq LIMIT 200").all(sessionId,eventAfter) as {seq:number;data:string}[];
 const changed=events.filter(event=>(event as {type?:string}).type==='run.finished').map(event=>JSON.parse(event.data).runId as string);
 const activeId=activeWorkspaceRun(id)?.id;if(activeId)changed.push(activeId);
 const extra=changed.length?" OR (role='assistant' AND run_id IN ("+changed.map(()=>'?').join(',')+"))":'';
 const currentMessages=getDb().prepare(`SELECT * FROM conversation_messages WHERE session_id=? AND (seq IN (SELECT seq FROM conversation_messages WHERE session_id=? ORDER BY seq DESC LIMIT 2)${extra}) ORDER BY seq`).all(sessionId,sessionId,...changed);

 const live=liveConversation(sessionId),active=activeWorkspaceRun(id);
 const working=active&&['queued','running','cancelling'].includes(active.status)&&live?.runId===active.id;
 const display=(row:unknown)=>{const message=row as {role:string;run_id:string;body:string};return working&&message.role==='assistant'&&message.run_id===active.id?{...message,body:live.text}:message;};
 const runs=getDb().prepare('SELECT * FROM conversation_runs WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(sessionId).map(value=>{const run=value as {id:string;status:string;error:string;user_id:string;cancel_supported:number};
  const input=getDb().prepare("SELECT body,client_context FROM conversation_messages WHERE run_id=? AND role='user' ORDER BY seq LIMIT 1").get(run.id) as {body:string;client_context:string}|undefined;
  let title=input?.body||'处理群聊消息';try{title=JSON.parse(input?.client_context||'{}').text||title;}catch{}
  const display={...run,title:title.split('\n')[0].slice(0,60)};
  return ['interrupted','failed'].includes(run.status)?{...display,error:conversationError(run.error,run.status==='interrupted')}:display;});
 const agentState=getDb().prepare('SELECT read_cursor,pending_questions,paused FROM conversation_agent_state WHERE session_id=?').get(sessionId) as {read_cursor:number;pending_questions:string;paused:number}|undefined;
 return {session_id:sessionId,participants:conversationMembers(id),agent_read_cursor:agentState?.read_cursor||0,pending_questions:JSON.parse(agentState?.pending_questions||'[]'),agent_paused:agentState?.paused===1,messages:rows.map(row=>({...row,...display(row)})),current_messages:currentMessages.map(display),events:[...events.map(e=>({...e,data:JSON.parse(e.data)})),...(working?live.events:[])],runs,active_run:active || null,next_live_cursor:working?live.cursor:'',
  next_message_cursor:rows.at(-1)?.seq || after,next_event_cursor:events.at(-1)?.seq || eventAfter};
}
export function readConversationForRole(id:string,role:string,after=0,eventAfter=0){
 const value=readConversation(id,after,eventAfter);
 if(role!=='viewer')return {...value,restricted:false};
 return {session_id:value.session_id,active_run:value.active_run,runs:value.runs.map(run=>{const r=run as {id:string;status:string;user_id:string};return {id:r.id,status:r.status,user_id:r.user_id};}),messages:[],current_messages:[],events:[],next_message_cursor:after,next_event_cursor:eventAfter,next_live_cursor:'',restricted:true};
}
export function conversationMembers(id:string){
 const projectId=requirement(id).project_id;
 return (getDb().prepare('SELECT id FROM users ORDER BY id').all() as {id:string}[]).filter(user=>{const role=projectRole(projectId,user.id);return !!role&&role!=='viewer';}).map(user=>({id:user.id,name:user.id}));
}
export function createConversationService(transport:AgentTransport=dockerAgentTransport,options:{debounceMs?:number;autowake?:boolean}={}){
 const pending=new Map<string,Promise<void>>(),timers=new Map<string,ReturnType<typeof setTimeout>>(),owned=new Set<string>();
 let closed=false;
 const debounce=options.debounceMs??0;
 const state=(sessionId:string)=>{getDb().prepare('INSERT OR IGNORE INTO conversation_agent_state(session_id) VALUES(?)').run(sessionId);return getDb().prepare('SELECT * FROM conversation_agent_state WHERE session_id=?').get(sessionId) as {read_cursor:number;pending_questions:string;paused:number};};
 function schedule(id:string,delay=debounce){
  if(closed||timers.has(id)||activeWorkspaceRun(id)||runtimeOperationActive(id))return;
  const sessionId=conversationSession(id),current=state(sessionId);
  if(current.paused||!getDb().prepare("SELECT 1 FROM conversation_messages WHERE session_id=? AND role='user' AND seq>? LIMIT 1").get(sessionId,current.read_cursor))return;
  if(delay===0){kick(id);return;}
  timers.set(id,setTimeout(()=>{timers.delete(id);kick(id);},delay));
 }
 function submit(id:string,userId:string,message:string,requestId:string,clientContext?:unknown,attachments:WorkspaceAttachment[]=[]){
  const role=projectRole(requirement(id).project_id,userId);if(!role||role==='viewer')throw Error('只有项目编辑成员可以参与群聊');
  const metadata=messageContext(clientContext,attachments),sessionId=conversationSession(id);state(sessionId);
  if(!message.trim()&&attachments.length)message='请读取所附文件，并结合其中的需求或资源处理。';
  if(!message.trim()||message.length>20000||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw Error('消息或请求标识无效');
  const repeat=getDb().prepare("SELECT * FROM conversation_messages WHERE session_id=? AND user_id=? AND request_id=? AND role='user'").get(sessionId,userId,requestId) as {id:string;run_id:string|null;body:string;client_context:string}|undefined;
  if(repeat){if(repeat.body!==message.trim()||repeat.client_context!==metadata)throw Error('相同请求标识不能用于不同消息');return {id:repeat.id,messageId:repeat.id,runId:repeat.run_id,replayed:true};}
  const messageId=crypto.randomUUID(),mentions=messageMentions(message,conversationMembers(id).map(member=>member.id));
  getDb().prepare("INSERT INTO conversation_messages(id,session_id,role,user_id,body,client_context,request_id,mentions) VALUES(?,?,'user',?,?,?,?,?)").run(messageId,sessionId,userId,message.trim(),metadata,requestId,JSON.stringify(mentions));
  // New user input can resume a failed attempt; an uncertain interrupted run keeps
  // its lock until the environment is deliberately recovered.
  if(activeWorkspaceRun(id)?.status!=='interrupted')getDb().prepare('UPDATE conversation_agent_state SET paused=0 WHERE session_id=?').run(sessionId);
  owned.add(id);conversationEvents.emit(sessionId);schedule(id);
  const accepted=getDb().prepare('SELECT run_id FROM conversation_messages WHERE id=?').get(messageId) as {run_id:string|null};
  return {id:messageId,messageId,runId:accepted.run_id,replayed:false};
 }
 function kick(id:string){
  if(activeWorkspaceRun(id)||runtimeOperationActive(id))return;
  const sessionId=conversationSession(id),current=state(sessionId);if(current.paused)return;
  const rows=getDb().prepare("SELECT * FROM conversation_messages WHERE session_id=? AND role='user' AND seq>? ORDER BY seq").all(sessionId,current.read_cursor) as Post[];
  if(!rows.length)return;
  const members=conversationMembers(id),allowed=new Set(members.map(member=>member.id)),batch=rows.filter(row=>allowed.has(row.user_id!));
  if(!batch.length){getDb().prepare('UPDATE conversation_agent_state SET read_cursor=? WHERE session_id=?').run(rows.at(-1)!.seq,sessionId);schedule(id,1);return;}
  const runId=crypto.randomUUID(),to=rows.at(-1)!.seq;
  getDb().transaction(()=>{
   getDb().prepare('INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,input_from_seq,input_to_seq) VALUES(?,?,?,?,?,?,?)').run(runId,id,sessionId,batch[0].user_id,'batch-'+runId,current.read_cursor,to);
   getDb().prepare("UPDATE conversation_messages SET run_id=? WHERE session_id=? AND role='user' AND seq>? AND seq<=?").run(runId,sessionId,current.read_cursor,to);
   getDb().prepare("INSERT INTO conversation_messages(id,session_id,run_id,role,body) VALUES(?,?,?,'assistant','')").run(crypto.randomUUID(),sessionId,runId);
   appendEvent(sessionId,runId,'run.queued',{userId:batch[0].user_id,messageIds:batch.map(post=>post.id),throughSeq:to});
  })();workspaceEvents.emit('locked',id);
  const work=Promise.resolve().then(()=>execute(id,sessionId,runId,batch,to,members.map(member=>member.id),JSON.parse(current.pending_questions))).finally(()=>{
   pending.delete(runId);workspaceEvents.emit('changed',id);
   if(!state(sessionId).paused&&!activeWorkspaceRun(id))schedule(id,1);
  });pending.set(runId,work);
 }
 interface Post {id:string;seq:number;role:string;user_id:string|null;body:string;client_context:string;run_id:string|null}
 const references=(metadata:string)=>{
  let files:WorkspaceAttachment[]=[];try{files=JSON.parse(metadata||'{}').attachments||[];}catch{}
  return files.length?'\n[用户附件：读取或复制到源码时请保留附件原件供历史下载]\n'+files.map(file=>`${JSON.stringify(file.name)}: ${JSON.stringify('/workspace/'+file.workspacePath)}`).join('\n'):'';
 };
 async function execute(id:string,sessionId:string,runId:string,batch:Post[],through:number,members:string[],questions:PendingQuestion[]){
  let result:Record<string,unknown>|undefined,failure='',started=false,canCancel=false;
  const safe=(value:string)=>{try{return redactRuntimeText(id,value).slice(0,100000);}catch{return '需求凭证不可读取，请检查平台数据和密钥文件';}};
  try{
   const history=getDb().prepare("SELECT * FROM conversation_messages WHERE session_id=? AND seq<? AND body!='' ORDER BY seq DESC LIMIT 30").all(sessionId,batch[0].seq) as Post[];
   const context=history.reverse().map(post=>`[${post.role==='user'?post.user_id:'Agent'}] ${post.body.slice(-3000)}${references(post.client_context)}`).join('\n\n').slice(-32000);
   const incoming=batch.map(post=>({messageId:post.id,seq:post.seq,userId:post.user_id,text:post.body,attachments:references(post.client_context)}));
   const prompt=collaborationInstructions(members,questions)+'\n\n[历史上下文]\n'+context+'\n\n[本批未读消息]\n'+JSON.stringify(incoming);
   getDb().prepare("UPDATE conversation_runs SET status='running' WHERE id=?").run(runId);
   await transport.run(id,{runId,clientId:`platform-${sessionId}-${runId}`,message:prompt},event=>{
    const data=JSON.parse(redactRuntimeText(id,JSON.stringify(event.data))) as Record<string,unknown>;
    if(event.type==='bridge.ready'){canCancel=data.cancelSupported===true;return;}
    if(event.type==='bridge.dispatch'){started=true;return;}
    if(event.type==='bridge.result'){result=data;return;}
    if(event.type==='bridge.error'){failure=String(data.message||'Agent 执行失败');return;}
    if(!['run.started','message.delta','tool.started','tool.completed','file.changed','run.completed','run.failed','run.cancelled'].includes(event.type)||data.runId!==runId)return;
    if(event.type==='run.started'){started=true;getDb().prepare('UPDATE conversation_runs SET cancel_supported=? WHERE id=?').run(canCancel?1:0,runId);}
    appendEvent(sessionId,runId,event.type,data);
   });
   if((getDb().prepare('SELECT status FROM conversation_runs WHERE id=?').get(runId) as {status:string}).status==='interrupted')return;
   if(!result)throw Error(failure||'Agent 未返回最终结果');
   const status=result.cancelled?'cancelled':result.success===false||result.httpOk===false?'failed':'succeeded';
   const raw=typeof result.message==='string'?safe(result.message):'';
   const reply=collaborationReply(raw,members,batch.map(post=>post.id),questions);
   const body=status==='failed'?conversationError(raw,false):reply.body||(status==='cancelled'?'任务已取消。':reply.decision==='wait'?'已阅读消息，正在等待进一步信息。':'已完成。');
   clearLiveConversation(sessionId,runId);
   getDb().transaction(()=>{
    getDb().prepare("UPDATE conversation_messages SET body=?,mentions=? WHERE run_id=? AND role='assistant'").run(body,JSON.stringify(reply.mentions),runId);
    getDb().prepare("UPDATE conversation_runs SET status=?,decision=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,reply.decision,status==='failed'?body:'',runId);
    if(status==='failed')getDb().prepare('UPDATE conversation_agent_state SET paused=1 WHERE session_id=?').run(sessionId);
    else getDb().prepare('UPDATE conversation_agent_state SET read_cursor=MAX(read_cursor,?),pending_questions=? WHERE session_id=?').run(through,JSON.stringify(status==='cancelled'?questions:reply.questions),sessionId);
    appendEvent(sessionId,runId,'run.finished',{status});
   })();
  }catch(error){
   const status=started?'interrupted':'failed',diagnostic=safe(failure||(error as Error).message),message=conversationError(diagnostic,started);
   console.error(`[Conversation ${runId}] ${status}: ${diagnostic}`);clearLiveConversation(sessionId,runId);
   getDb().prepare("UPDATE conversation_messages SET body=? WHERE run_id=? AND role='assistant'").run(message,runId);
   getDb().prepare("UPDATE conversation_runs SET status=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,message,runId);
   getDb().prepare('UPDATE conversation_agent_state SET paused=1 WHERE session_id=?').run(sessionId);appendEvent(sessionId,runId,'run.finished',{status,error:message});
  }finally{clearLiveConversation(sessionId,runId);}
 }
 async function cancel(id:string,runId:string){
  const run=getDb().prepare('SELECT * FROM conversation_runs WHERE id=? AND requirement_id=?').get(runId,id) as {session_id:string;status:string;cancel_supported:number}|undefined;
  if(!run||!['running','cancelling'].includes(run.status))throw Error('任务未在运行');
  if(!run.cancel_supported)throw Error('当前环境的 Agent SDK 暂不支持取消，请更新工作镜像后重试');
  await transport.cancel(id,runId,`platform-${run.session_id}-${runId}`);
  getDb().prepare("UPDATE conversation_runs SET status='cancelling' WHERE id=? AND status='running'").run(runId);appendEvent(run.session_id,runId,'run.cancelling',{});
 }
 const changed=(id:string)=>{if(owned.has(id))schedule(id);};if(options.autowake)workspaceEvents.on('changed',changed);
 return {submit,cancel,
  resume(){for(const row of getDb().prepare("SELECT s.requirement_id FROM project_sessions s JOIN conversation_agent_state a ON a.session_id=s.id WHERE a.paused=0 AND EXISTS(SELECT 1 FROM conversation_messages m WHERE m.session_id=s.id AND m.role='user' AND m.seq>a.read_cursor)").all() as {requirement_id:string}[]){owned.add(row.requirement_id);schedule(row.requirement_id);}},
  close(){closed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();workspaceEvents.off('changed',changed);},
  async wait(key:string){
   for(let tries=0;tries<100;tries++){
    let work=pending.get(key);if(work){await work;return;}
    const post=getDb().prepare("SELECT m.run_id,s.requirement_id FROM conversation_messages m JOIN project_sessions s ON s.id=m.session_id WHERE m.id=?").get(key) as {run_id:string|null;requirement_id:string}|undefined;if(!post)return;
    if(post.run_id){work=pending.get(post.run_id);if(work)await work;return;}
    const active=activeWorkspaceRun(post.requirement_id);if(active&&pending.has(active.id)){await pending.get(active.id);continue;}
    if(timers.has(post.requirement_id)){await new Promise(resolve=>setTimeout(resolve,Math.max(5,debounce+1)));continue;}
    kick(post.requirement_id);if(!pending.size)return;
   }
  },
 };
}
export const conversations=createConversationService(dockerAgentTransport,{debounceMs:750,autowake:true});
