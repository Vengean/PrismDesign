import {appendLiveEvent,liveConversation,clearLiveConversation} from './conversation-live.js';
import {conversationEvents} from './conversation-events.js';
import crypto from 'node:crypto';
import {platformBrowser} from './platform-browser.js';
import {conversationError} from './conversation-errors.js';
import {getDb} from './db.js';
import {requirement,redactRuntimeText,runtimeOperationActive} from './requirement-runtime.js';
import {activeWorkspaceRun,workspaceEvents,withWorkspaceGate} from './workspace-lock.js';
import {dockerAgentTransport,type AgentTransport,type RuntimeEvent} from './agent-transport.js';
import {projectRole} from './projects.js';
import {collaborationInstructions,collaborationReply,messageMentions,type PendingQuestion} from './collaboration.js';
import type {WorkspaceAttachment} from './workspace-attachments.js';
import {projectAuth} from './project-auth.js';
import {withProjectAuthGate} from './project-auth-storage.js';
import {queryAgentHistory} from './agent-history.js';

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
export async function initConversationTables(){
 if(getDb().dialect==='mysql'){await getDb().ready();return;}
 (await getDb().exec(`CREATE TABLE IF NOT EXISTS conversation_runs (
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
  CREATE INDEX IF NOT EXISTS conversation_event_session ON conversation_events(session_id,seq);`));
 const columns=(await getDb().prepare('PRAGMA table_info(conversation_messages)').all()) as {name:string}[];
 if(!columns.some(c=>c.name==='client_context'))(await getDb().exec("ALTER TABLE conversation_messages ADD COLUMN client_context TEXT NOT NULL DEFAULT ''"));
 const info=(await getDb().prepare('PRAGMA table_info(conversation_messages)').all()) as {name:string;notnull:number}[];
 if(info.find(column=>column.name==='run_id')?.notnull){
  (await getDb().transaction(async ()=>{
   (await getDb().exec(`CREATE TABLE conversation_messages_v2 (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,session_id TEXT NOT NULL REFERENCES project_sessions(id),run_id TEXT REFERENCES conversation_runs(id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),user_id TEXT REFERENCES users(id),body TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT (datetime('now')),client_context TEXT NOT NULL DEFAULT '');
    INSERT INTO conversation_messages_v2(seq,id,session_id,run_id,role,user_id,body,created_at,client_context) SELECT seq,id,session_id,run_id,role,user_id,body,created_at,client_context FROM conversation_messages;
    DROP TABLE conversation_messages;ALTER TABLE conversation_messages_v2 RENAME TO conversation_messages;
    CREATE INDEX conversation_message_session ON conversation_messages(session_id,seq);`));
  })());
 }
 const add=async (table:string,name:string,definition:string)=>{if(!((await getDb().prepare('PRAGMA table_info('+table+')').all()) as {name:string}[]).some(column=>column.name===name))(await getDb().exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition));};
 (await add('conversation_messages','request_id','TEXT'));(await add('conversation_messages','mentions',"TEXT NOT NULL DEFAULT '[]'"));
 (await add('conversation_runs','input_from_seq','INTEGER NOT NULL DEFAULT 0'));(await add('conversation_runs','input_to_seq','INTEGER NOT NULL DEFAULT 0'));(await add('conversation_runs','decision',"TEXT NOT NULL DEFAULT ''"));
 (await getDb().exec(`CREATE UNIQUE INDEX IF NOT EXISTS conversation_post_request ON conversation_messages(session_id,user_id,request_id) WHERE role='user';
  CREATE TABLE IF NOT EXISTS conversation_agent_state(session_id TEXT PRIMARY KEY REFERENCES project_sessions(id),read_cursor INTEGER NOT NULL DEFAULT 0,pending_questions TEXT NOT NULL DEFAULT '[]',paused INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO conversation_agent_state(session_id,read_cursor) SELECT s.id,COALESCE((SELECT MAX(m.seq) FROM conversation_messages m WHERE m.session_id=s.id AND m.role='user' AND m.run_id IS NOT NULL),0) FROM project_sessions s;
  UPDATE conversation_messages SET request_id=(SELECT request_id FROM conversation_runs r WHERE r.id=conversation_messages.run_id) WHERE role='user' AND request_id IS NULL;`));
}
export async function conversationSession(id:string){
 (await requirement(id));const row=(await getDb().prepare('SELECT id FROM project_sessions WHERE requirement_id=?').get(id)) as {id:string}|undefined;
 if(!row)throw new Error('需求会话不存在');return row.id;
}
export async function interruptPreviousRuns(){
 (await getDb().exec("UPDATE conversation_agent_state SET paused=1 WHERE session_id IN (SELECT session_id FROM conversation_runs WHERE status IN ('queued','running','cancelling'))"));
 const message='平台服务连接已中断，本轮任务无法继续确认。请重启需求环境后继续，源码和历史对话会保留。';
 (await getDb().prepare("UPDATE conversation_messages SET body=CASE WHEN body='' THEN ? ELSE body || char(10) || char(10) || ? END WHERE role='assistant' AND run_id IN (SELECT id FROM conversation_runs WHERE status IN ('queued','running','cancelling'))").run(message,message));
 (await getDb().prepare("UPDATE conversation_runs SET status='interrupted',error='平台服务连接已中断，请重启需求环境后继续，源码和历史对话会保留',updated_at=datetime('now') WHERE status IN ('queued','running','cancelling')").run());
}
async function appendEvent(sessionId:string,runId:string,type:string,data:unknown){
 if(!['run.queued','run.started','run.finished','run.cancelling'].includes(type)){
  appendLiveEvent(sessionId,runId,type,data as Record<string,unknown>);return;
 }
 (await getDb().prepare('INSERT INTO conversation_events(session_id,run_id,type,data) VALUES(?,?,?,?)').run(sessionId,runId,type,JSON.stringify({...data as Record<string,unknown>,runId,at:Date.now()})));
 getDb().afterCommit(()=>conversationEvents.emit(sessionId));
}
export interface ConversationPage {latest?:boolean;before?:number;userId?:string}
export async function readConversation(id:string,after=0,eventAfter=0,page:ConversationPage={}){
 const sessionId=(await conversationSession(id));
 const historical=page.latest||page.before!==undefined;
 if(page.before!==undefined&&(!Number.isSafeInteger(page.before)||page.before<=0||page.latest))throw Error('历史消息游标无效');
 const batch=historical?await getDb().prepare(`SELECT * FROM conversation_messages WHERE session_id=?${page.before===undefined?'':' AND seq<?'} ORDER BY seq DESC LIMIT 51`).all(sessionId,...(page.before===undefined?[]:[page.before])):await getDb().prepare('SELECT * FROM conversation_messages WHERE session_id=? AND seq>? ORDER BY seq LIMIT 100').all(sessionId,after);
 const rows=(historical?batch.slice(0,50).reverse():batch) as {seq:number;run_id?:string|null}[];
 const history=historical?{has_more_history:batch.length>50,oldest_message_cursor:rows[0]?.seq||0}:{};
 const latestMention=page.latest&&page.userId?await getDb().prepare(`SELECT id,seq FROM conversation_messages WHERE session_id=? AND ${getDb().dialect==='mysql'?'INSTR(CAST(mentions AS BINARY),CAST(? AS BINARY))':'INSTR(mentions,?)'}>0 ORDER BY seq DESC LIMIT 1`).get(sessionId,JSON.stringify(page.userId)):undefined;
 const eventRows=(await getDb().prepare(`SELECT * FROM conversation_events WHERE session_id=? AND seq>? AND type IN ('run.queued','run.started','run.finished','run.cancelling','run.cancel_rejected') ORDER BY seq ${historical?'DESC':'ASC'} LIMIT 200`).all(sessionId,historical?0:eventAfter)) as {seq:number;data:string}[];
 const events=historical?eventRows.reverse():eventRows;
 const changed=historical?[]:events.filter(event=>(event as {type?:string}).type==='run.finished').map(event=>JSON.parse(event.data).runId as string);
 const activeId=(await activeWorkspaceRun(id))?.id;if(activeId&&(!historical||rows.some(row=>row.run_id===activeId)))changed.push(activeId);
 const extra=changed.length?" OR (role='assistant' AND run_id IN ("+changed.map(()=>'?').join(',')+"))":'';
 const currentMessages=(await getDb().prepare(`SELECT * FROM conversation_messages WHERE session_id=? AND (seq IN (SELECT seq FROM (SELECT seq FROM conversation_messages WHERE session_id=? ORDER BY seq DESC LIMIT 2) recent_messages)${extra}) ORDER BY seq`).all(sessionId,sessionId,...changed));

 const live=liveConversation(sessionId),active=(await activeWorkspaceRun(id));
 const working=active&&['queued','running','cancelling'].includes(active.status)&&live?.runId===active.id;
 const display=(row:unknown)=>{const message=row as {role:string;run_id:string;body:string};return working&&message.role==='assistant'&&message.run_id===active.id?{...message,body:live.text}:message;};
 const recentRuns=await getDb().prepare('SELECT * FROM conversation_runs WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20').all(sessionId);
 const missingRunIds=[...new Set([...rows.map(row=>row.run_id),activeId].filter((runId):runId is string=>!!runId&&!recentRuns.some(run=>run.id===runId)))];
 const pageRuns=missingRunIds.length?await getDb().prepare(`SELECT * FROM conversation_runs WHERE session_id=? AND id IN (${missingRunIds.map(()=>'?').join(',')})`).all(sessionId,...missingRunIds):[];
 const runs=await Promise.all([...recentRuns,...pageRuns].map(async value=>{const run=value as {id:string;status:string;error:string;user_id:string;cancel_supported:number};
  const input=(await getDb().prepare("SELECT body,client_context FROM conversation_messages WHERE run_id=? AND role='user' ORDER BY seq LIMIT 1").get(run.id)) as {body:string;client_context:string}|undefined;
  let title=input?.body||'处理群聊消息';try{title=JSON.parse(input?.client_context||'{}').text||title;}catch{}
  const titleCharacters=Array.from(title.split('\n')[0]);
  const displayTitle=titleCharacters.length>60?titleCharacters.slice(0,59).join('').trimEnd().replace(/[，,、；;：:。.!?！？…]+$/u,'')+'…':titleCharacters.join('');
  const display={...run,title:displayTitle};
  return ['interrupted','failed'].includes(run.status)?{...display,error:conversationError(run.error,run.status==='interrupted')}:display;}));
 const agentState=(await getDb().prepare('SELECT read_cursor,pending_questions,paused FROM conversation_agent_state WHERE session_id=?').get(sessionId)) as {read_cursor:number;pending_questions:string;paused:number}|undefined;
 const pendingMessage=await getDb().prepare("SELECT id,seq FROM conversation_messages WHERE session_id=? AND role='user' AND run_id IS NULL AND seq>? ORDER BY seq LIMIT 1").get(sessionId,agentState?.read_cursor||0);
 return {...history,...(page.latest?{latest_mention:latestMention||null}:{}),session_id:sessionId,participants:(await conversationMembers(id)),agent_pending_message:pendingMessage||null,agent_read_cursor:agentState?.read_cursor||0,pending_questions:JSON.parse(agentState?.pending_questions||'[]'),agent_paused:agentState?.paused===1,messages:rows.map(row=>({...row,...display(row)})),current_messages:currentMessages.map(display),events:[...events.map(e=>({...e,data:JSON.parse(e.data)})),...(working?live.events:[])],runs,active_run:active || null,next_live_cursor:working?live.cursor:'',
  next_message_cursor:rows.at(-1)?.seq || after,next_event_cursor:events.at(-1)?.seq || eventAfter};
}
export async function readConversationForRole(id:string,role:string,after=0,eventAfter=0,page:ConversationPage={}){
 const value=(await readConversation(id,after,eventAfter,page));
 if(role!=='viewer')return {...value,restricted:false};
 return {session_id:value.session_id,active_run:value.active_run,runs:value.runs.map(run=>{const r=run as {id:string;status:string;user_id:string};return {id:r.id,status:r.status,user_id:r.user_id};}),messages:[],current_messages:[],events:[],next_message_cursor:after,next_event_cursor:eventAfter,next_live_cursor:'',restricted:true};
}
export async function conversationMembers(id:string){
 const projectId=(await requirement(id)).project_id;
 const users=(await getDb().prepare('SELECT id FROM users ORDER BY id').all()) as {id:string}[];
 const roles=await Promise.all(users.map(async user=>({user,role:await projectRole(projectId,user.id)})));
 return roles.filter(({role})=>role&&role!=='viewer').map(({user})=>({id:user.id,name:user.id}));
}
export function createConversationService(transport:AgentTransport=dockerAgentTransport,options:{debounceMs?:number;autowake?:boolean}={}){
 const pending=new Map<string,Promise<void>>(),timers=new Map<string,ReturnType<typeof setTimeout>>(),owned=new Set<string>();
 let closed=false;
 const debounce=options.debounceMs??0;
 const kicking=new Set<string>();
 const state=async (sessionId:string)=>{(await getDb().prepare('INSERT OR IGNORE INTO conversation_agent_state(session_id) VALUES(?)').run(sessionId));return (await getDb().prepare('SELECT * FROM conversation_agent_state WHERE session_id=?').get(sessionId)) as {read_cursor:number;pending_questions:string;paused:number};};
 async function schedule(id:string,delay=debounce){
  if(['merged','closed'].includes((await requirement(id)).status))return;
  if(closed||timers.has(id)||(await activeWorkspaceRun(id))||runtimeOperationActive(id))return;
  const sessionId=(await conversationSession(id)),current=(await state(sessionId));
  if(current.paused||!(await getDb().prepare("SELECT 1 FROM conversation_messages WHERE session_id=? AND role='user' AND seq>? LIMIT 1").get(sessionId,current.read_cursor)))return;
  if(delay===0){(await kick(id));return;}
  if(timers.has(id)||closed)return;
  timers.set(id,setTimeout(()=>{timers.delete(id);void kick(id).catch(error=>console.error("[Conversation scheduler]",error.code||"failed"));},delay));
 }
 async function submit(id:string,userId:string,message:string,requestId:string,clientContext?:unknown,attachments:WorkspaceAttachment[]=[],browser?:{bindingId:string;verifyOnly?:boolean}){
  if(projectAuth.isBusy((await requirement(id)).project_id))throw Error('项目登录操作正在进行，请先关闭登录终端再发送任务');
  if(['merged','closed'].includes((await requirement(id)).status))throw Error('已合入或关闭的需求只读');
  const role=(await projectRole((await requirement(id)).project_id,userId));if(!role||role==='viewer')throw Error('只有项目编辑成员可以参与群聊');
  let metadata=messageContext(clientContext,attachments);const sessionId=await conversationSession(id);await state(sessionId);
  if(browser){const binding=await platformBrowser.get(browser.bindingId,id,userId);metadata=JSON.stringify({...JSON.parse(metadata||'{}'),browser:{bindingId:binding.id,pageUrl:binding.pageUrl,verifyOnly:!!browser.verifyOnly}});}
  if(!message.trim()&&attachments.length)message='请读取所附文件，并结合其中的需求或资源处理。';
  if(!message.trim()||message.length>20000||!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))throw Error('消息或请求标识无效');
  const accepted=await getDb().transaction(async()=>{
   if(getDb().dialect==='mysql')await getDb().prepare('SELECT id FROM project_sessions WHERE id=? FOR UPDATE').get(sessionId);
   const latest=await requirement(id);if(['merged','closed'].includes(latest.status))throw Error('已合入或关闭的需求只读');
   if(latest.release_id){const operation=await getDb().prepare('SELECT operation_kind FROM releases WHERE id=?').get(latest.release_id);if(['merge','confirm'].includes(operation?.operation_kind))throw Error('正在合入发布，请操作完成后再发送消息');}

   const repeat=await getDb().prepare("SELECT * FROM conversation_messages WHERE session_id=? AND user_id=? AND request_id=? AND role='user'").get(sessionId,userId,requestId) as {id:string;run_id:string|null;body:string;client_context:string}|undefined;
   if(repeat){if(repeat.body!==message.trim()||repeat.client_context!==metadata)throw Error('相同请求标识不能用于不同消息');return {id:repeat.id,messageId:repeat.id,runId:repeat.run_id,replayed:true};}
   const messageId=crypto.randomUUID(),mentions=messageMentions(message,(await conversationMembers(id)).map(member=>member.id));
   await getDb().prepare("INSERT INTO conversation_messages(id,session_id,role,user_id,body,client_context,request_id,mentions) VALUES(?,?,'user',?,?,?,?,?)").run(messageId,sessionId,userId,message.trim(),metadata,requestId,JSON.stringify(mentions));
   if((await activeWorkspaceRun(id))?.status!=='interrupted')await getDb().prepare('UPDATE conversation_agent_state SET paused=0 WHERE session_id=?').run(sessionId);
   return {id:messageId,messageId,runId:null as string|null,replayed:false};
  })();
  owned.add(id);conversationEvents.emit(sessionId);await schedule(id);
  if(accepted.replayed)return accepted;
  const row=await getDb().prepare('SELECT run_id FROM conversation_messages WHERE id=?').get(accepted.id) as {run_id:string|null};
  return {...accepted,runId:row.run_id};
 }
 async function kick(id:string){
  if(kicking.has(id)||closed)return;
  kicking.add(id);try{await performKick(id);}finally{kicking.delete(id);}
 }
 async function performKick(id:string){
  const sessionId=await conversationSession(id);
  const created=await withProjectAuthGate((await requirement(id)).project_id,()=>withWorkspaceGate(id,()=>getDb().transaction(async()=>{
   if(getDb().dialect==='mysql')await getDb().prepare('SELECT id FROM project_sessions WHERE id=? FOR UPDATE').get(sessionId);
   const workspace=await requirement(id);
   if(projectAuth.isBusy(workspace.project_id)){await schedule(id,1000);return;}
   if(['merged','closed'].includes(workspace.status)||await activeWorkspaceRun(id)||runtimeOperationActive(id))return;
   const current=await state(sessionId);if(current.paused)return;
   const rows=await getDb().prepare("SELECT * FROM conversation_messages WHERE session_id=? AND role='user' AND seq>? ORDER BY seq").all(sessionId,current.read_cursor) as Post[];
   if(!rows.length)return;
   const members=await conversationMembers(id),allowed=new Set(members.map(member=>member.id)),batch=rows.filter(row=>allowed.has(row.user_id!));
   if(!batch.length){await getDb().prepare('UPDATE conversation_agent_state SET read_cursor=? WHERE session_id=?').run(rows.at(-1)!.seq,sessionId);return;}
   // Keep a test turn on its own; later user messages remain unread until it ends.
   const browserMode=(post:Post)=>{try{return !!JSON.parse(post.client_context||'{}').browser?.verifyOnly;}catch{return false;}};
   const boundary=batch.findIndex((post,index)=>index>0&&browserMode(post));
   const selected=browserMode(batch[0])?batch.slice(0,1):boundary>0?batch.slice(0,boundary):batch;
   batch.splice(0,batch.length,...selected);
   const to=batch.at(-1)!.seq;
   const runId=crypto.randomUUID();
   await getDb().prepare('INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,input_from_seq,input_to_seq) VALUES(?,?,?,?,?,?,?)').run(runId,id,sessionId,batch[0].user_id,'batch-'+runId,current.read_cursor,to);
   await getDb().prepare("UPDATE conversation_messages SET run_id=? WHERE session_id=? AND role='user' AND seq>? AND seq<=?").run(runId,sessionId,current.read_cursor,to);
   await getDb().prepare("INSERT INTO conversation_messages(id,session_id,run_id,role,body) VALUES(?,?,?,'assistant','')").run(crypto.randomUUID(),sessionId,runId);
   await appendEvent(sessionId,runId,'run.queued',{userId:batch[0].user_id,messageIds:batch.map(post=>post.id),throughSeq:to});
   return {runId,batch,to,members,current};
  })()));
  if(!created)return;
  const {runId,batch,to,members,current}=created;workspaceEvents.emit('locked',id);
  const work=Promise.resolve().then(()=>execute(id,sessionId,runId,batch,to,members.map(member=>member.id),JSON.parse(current.pending_questions))).finally(async()=>{
   pending.delete(runId);workspaceEvents.emit('changed',id);
   if(!(await state(sessionId)).paused&&!await activeWorkspaceRun(id))await schedule(id,1);
  });pending.set(runId,work);
 }

 interface Post {id:string;seq:number;role:string;user_id:string|null;body:string;client_context:string;run_id:string|null}
 const references=(metadata:string)=>{
  let files:WorkspaceAttachment[]=[];try{files=JSON.parse(metadata||'{}').attachments||[];}catch{}
  return files.length?'\n[用户附件：读取或复制到源码时请保留附件原件供历史下载]\n'+files.map(file=>`${JSON.stringify(file.name)}: ${JSON.stringify('/workspace/'+file.workspacePath)}`).join('\n'):'';
 };
 async function execute(id:string,sessionId:string,runId:string,batch:Post[],through:number,members:string[],questions:PendingQuestion[]){
  let result:Record<string,unknown>|undefined,failure='',started=false,canCancel=false,browserDetached=false;
  let eventQueue=Promise.resolve();
  const safe=async (value:string)=>{try{return (await redactRuntimeText(id,value)).slice(0,100000);}catch{return '需求凭证不可读取，请检查平台数据和密钥文件';}};
  try{
   const incoming=batch.map(post=>({messageId:post.id,seq:post.seq,userId:post.user_id,text:post.body,attachments:references(post.client_context)}));
   const browser=JSON.parse(batch[0].client_context||'{}').browser as {bindingId:string;pageUrl:string;verifyOnly:boolean}|undefined;
   const prompt=(browser?.verifyOnly?'本轮是用户已确认的真实浏览器测试。只操作绑定页面，不修改源码。定义业务测试用例、执行、采集截图和运行证据、逐条记录结果并提交 verification_complete。测试失败时给出修复建议，等待用户发起修复。\n':'')+collaborationInstructions(members,questions)+'\n\n[聊天历史按需查询]\n历史正文未自动注入。涉及此前决策或缺少上下文时，用 prism_project/chat_history 自行选择 query、limit 和 before。当前需求以外的聊天不可查询。\n\n[本批未读消息]\n'+JSON.stringify(incoming);
   (await getDb().prepare("UPDATE conversation_runs SET status='running' WHERE id=?").run(runId));
   const clientId=browser?`platform-browser-${browser.verifyOnly?'test-':''}${sessionId}-${runId}`:`platform-${sessionId}-${runId}`;
   await transport.run(id,{runId,clientId,message:prompt,projectTools:{execute:command=>{if(command.action!=='chat_history'||command.runId!==runId)throw Error('项目查询作用域无效');return queryAgentHistory(id,runId,batch[0].user_id!,command);}},...(browser?{browser:{pageUrl:browser.pageUrl,verifyOnly:browser.verifyOnly,execute:(command:Record<string,unknown>)=>platformBrowser.execute(browser.bindingId,id,batch[0].user_id!,command)}}:{})},event=>{eventQueue=eventQueue.then(async()=>{
    const data=JSON.parse((await redactRuntimeText(id,JSON.stringify(event.data)))) as Record<string,unknown>;
    if(['verification.proposed','verification.updated','test-run.updated'].includes(event.type)){
     const old=await getDb().prepare("SELECT client_context FROM conversation_messages WHERE run_id=? AND role='assistant'").get(runId);
     const saved=JSON.parse(old?.client_context||'{}');
     if(event.type==='test-run.updated')saved.testRun=data;else saved.verification=data;
     await getDb().prepare("UPDATE conversation_messages SET client_context=? WHERE run_id=? AND role='assistant'").run(JSON.stringify(saved),runId);conversationEvents.emit(sessionId);return;
    }
    if(event.type==='bridge.ready'){canCancel=data.cancelSupported===true;return;}
    if(event.type==='bridge.dispatch'){started=true;return;}
    if(event.type==='bridge.result'){result=data;return;}
    if(event.type==='bridge.error'){failure=String(data.message||'Agent 执行失败');return;}
    if(!['run.started','message.delta','tool.started','tool.completed','file.changed','run.completed','run.failed','run.cancelled'].includes(event.type)||data.runId!==runId)return;
    if(event.type==='run.started'){started=true;(await getDb().prepare('UPDATE conversation_runs SET cancel_supported=? WHERE id=?').run(canCancel?1:0,runId));}
    (await appendEvent(sessionId,runId,event.type,data));
   });return eventQueue;});
   await eventQueue;
   if(((await getDb().prepare('SELECT status FROM conversation_runs WHERE id=?').get(runId)) as {status:string}).status==='interrupted')return;
   if(!result)throw Error(failure||'Agent 未返回最终结果');
   const status=result.cancelled?'cancelled':result.success===false||result.httpOk===false?'failed':'succeeded';
   const raw=typeof result.message==='string'?(await safe(result.message)):'';
   const reply=collaborationReply(raw,members,batch.map(post=>post.id),questions);
   const body=status==='failed'?conversationError(raw,false):reply.body||(status==='cancelled'?'任务已取消。':reply.decision==='wait'?'已阅读消息，正在等待进一步信息。':'已完成。');
   if(status==='failed')console.error(`[Conversation ${runId}] failed: ${raw.slice(0,4000)||body}`);
   if(browser){await platformBrowser.execute(browser.bindingId,id,batch[0].user_id!,{action:'detach'}).catch(()=>{});browserDetached=true;}
   clearLiveConversation(sessionId,runId);
   if(result.verification||result.testRun){const old=await getDb().prepare("SELECT client_context FROM conversation_messages WHERE run_id=? AND role='assistant'").get(runId);await getDb().prepare("UPDATE conversation_messages SET client_context=? WHERE run_id=? AND role='assistant'").run(JSON.stringify({...JSON.parse(old?.client_context||'{}'),...(result.verification?{verification:result.verification}:{}),...(result.testRun?{testRun:result.testRun}:{})}),runId);}
   (await getDb().transaction(async ()=>{
    (await getDb().prepare("UPDATE conversation_messages SET body=?,mentions=? WHERE run_id=? AND role='assistant'").run(body,JSON.stringify(reply.mentions),runId));
    (await getDb().prepare("UPDATE conversation_runs SET status=?,decision=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,reply.decision,status==='failed'?(raw.slice(0,8000)||body):'',runId));
    if(status==='cancelled'){
     const requested=await getDb().prepare("SELECT data FROM conversation_events WHERE run_id=? AND type='run.cancelling' ORDER BY seq DESC LIMIT 1").get(runId);
     let userId:string|undefined;try{userId=JSON.parse(String(requested?.data||'{}')).userId;}catch{}
     if(userId)await getDb().prepare("INSERT OR IGNORE INTO conversation_messages(id,session_id,role,body,client_context) VALUES(?,?,'assistant',?,?)").run('cancel-notice-'+runId,sessionId,`${userId} 取消了本次任务。`,JSON.stringify({systemNotice:{type:'run.cancelled',userId,runId}}));
    }
    if(status==='failed')(await getDb().prepare('UPDATE conversation_agent_state SET paused=1 WHERE session_id=?').run(sessionId));
    else (await getDb().prepare('UPDATE conversation_agent_state SET read_cursor=MAX(read_cursor,?),pending_questions=? WHERE session_id=?').run(through,JSON.stringify(status==='cancelled'?questions:reply.questions),sessionId));
    (await appendEvent(sessionId,runId,'run.finished',{status}));
   })());
  }catch(error){
   await eventQueue.catch(()=>{});
   const status=started?'interrupted':'failed',diagnostic=(await safe(failure||(error as Error).message)),message=conversationError(diagnostic,started);
   console.error(`[Conversation ${runId}] ${status}: ${diagnostic}`);clearLiveConversation(sessionId,runId);
   (await getDb().prepare("UPDATE conversation_messages SET body=? WHERE run_id=? AND role='assistant'").run(message,runId));
   (await getDb().prepare("UPDATE conversation_runs SET status=?,error=?,updated_at=datetime('now') WHERE id=?").run(status,message,runId));
   (await getDb().prepare('UPDATE conversation_agent_state SET paused=1 WHERE session_id=?').run(sessionId));(await appendEvent(sessionId,runId,'run.finished',{status,error:message}));
  }finally{clearLiveConversation(sessionId,runId);
   const browser=JSON.parse(batch[0].client_context||'{}').browser;
   if(browser&&!browserDetached)await platformBrowser.execute(browser.bindingId,id,batch[0].user_id!,{action:'detach'}).catch(()=>{});
  }
 }
 async function cancel(id:string,runId:string,userId?:string){
  if(userId){const role=await projectRole((await requirement(id)).project_id,userId);if(!role||role==='viewer')throw Error('只有项目编辑成员可以取消任务');}
  const run=(await getDb().prepare('SELECT * FROM conversation_runs WHERE id=? AND requirement_id=?').get(runId,id)) as {session_id:string;status:string;cancel_supported:number}|undefined;
  if(!run||!['running','cancelling'].includes(run.status))throw Error('任务未在运行');
  if(!run.cancel_supported)throw Error('当前环境的 Agent SDK 暂不支持取消，请更新工作镜像后重试');
  const claimed=await getDb().transaction(async()=>{
   const current=await getDb().prepare(`SELECT status FROM conversation_runs WHERE id=? AND requirement_id=?${getDb().dialect==='mysql'?' FOR UPDATE':''}`).get(runId,id);
   if(current?.status==='cancelling')return false;if(current?.status!=='running')throw Error('任务未在运行');
   await getDb().prepare("UPDATE conversation_runs SET status='cancelling' WHERE id=?").run(runId);
   await appendEvent(run.session_id,runId,'run.cancelling',{...(userId?{userId}:{})});return true;
  })();
  if(!claimed)return;
  const post=await getDb().prepare("SELECT client_context FROM conversation_messages WHERE run_id=? AND role='user' ORDER BY seq LIMIT 1").get(runId);const browser=JSON.parse(post?.client_context||'{}').browser;
  try{await transport.cancel(id,runId,browser?`platform-browser-${browser.verifyOnly?'test-':''}${run.session_id}-${runId}`:`platform-${run.session_id}-${runId}`);}
  catch(error){await getDb().prepare("UPDATE conversation_runs SET status='running' WHERE id=? AND status='cancelling'").run(runId);await appendEvent(run.session_id,runId,'run.cancel_rejected',{});throw error;}
 }
 const deleted=(id:string)=>{const timer=timers.get(id);if(timer)clearTimeout(timer);timers.delete(id);owned.delete(id);};
 const changed=(id:string)=>{if(owned.has(id))void schedule(id).catch(error=>console.error("[Conversation scheduler]",error.code||"failed"));};if(options.autowake){workspaceEvents.on('changed',changed);workspaceEvents.on('deleted',deleted);}
 return {submit,cancel,
  async resume(){for(const row of (await getDb().prepare("SELECT s.requirement_id FROM project_sessions s JOIN conversation_agent_state a ON a.session_id=s.id WHERE a.paused=0 AND EXISTS(SELECT 1 FROM conversation_messages m WHERE m.session_id=s.id AND m.role='user' AND m.seq>a.read_cursor)").all()) as {requirement_id:string}[]){owned.add(row.requirement_id);(await schedule(row.requirement_id));}},
  close(){closed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();workspaceEvents.off('changed',changed);workspaceEvents.off('deleted',deleted);},
  async wait(key:string){
   for(let tries=0;tries<100;tries++){
    let work=pending.get(key);if(work){await work;return;}
    const post=(await getDb().prepare("SELECT m.run_id,s.requirement_id FROM conversation_messages m JOIN project_sessions s ON s.id=m.session_id WHERE m.id=?").get(key)) as {run_id:string|null;requirement_id:string}|undefined;if(!post)return;
    if(post.run_id){work=pending.get(post.run_id);if(work)await work;return;}
    const active=(await activeWorkspaceRun(post.requirement_id));if(active&&pending.has(active.id)){await pending.get(active.id);continue;}
    if(timers.has(post.requirement_id)){await new Promise(resolve=>setTimeout(resolve,Math.max(5,debounce+1)));continue;}
    (await kick(post.requirement_id));if(!pending.size)return;
   }
  },
 };
}
export const conversations=createConversationService(dockerAgentTransport,{debounceMs:750,autowake:true});
