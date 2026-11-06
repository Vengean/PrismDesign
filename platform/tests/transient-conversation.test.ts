import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ReplyBuffer} from '../../packages/agent/src/core/reply-buffer.js';
import {PlatformClient,type PlatformContext,type PlatformConversation,type PlatformRequest} from '../../packages/ui/src/studio/platform-client.js';
const dir=mkdtempSync(path.join(os.tmpdir(),'prism-transient-'));
process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture-password';
const {getDb}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initConversationTables,createConversationService,readConversation}=await import('../src/services/conversations.js');
initProjectTables();initConversationTables();
const project=createProject('Transient','','owner',[],emptyConfig),id=crypto.randomUUID(),session=crypto.randomUUID();
getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'R','','','owner');
getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(session,id);
after(()=>{getDb().close();rmSync(dir,{recursive:true,force:true});});
test('progress is live-only, completed history and next-turn context retain just the final reply',async()=>{
 let finish=()=>{},emit:(type:string,data:Record<string,unknown>)=>void=()=>{};
 const service=createConversationService({async run(_id,input,onEvent){emit=(type,data)=>onEvent({type,data:{runId:input.runId,...data}});emit('bridge.dispatch',{});emit('run.started',{});await new Promise<void>(resolve=>{finish=resolve;});emit('bridge.result',{success:true,message:'最终结果：修改完成。'});},async cancel(){}});
 const task=service.submit(id,'owner','修改按钮','transient-request-01');await Promise.resolve();
 emit('message.delta',{delta:'持久化验证通过，接着验证构建。'});emit('tool.started',{toolCallId:'bash',label:'执行命令...'});
 const partial=readConversation(id);assert.match((partial.current_messages.find((m:any)=>m.role==='assistant') as {body:string}).body,/接着验证/);assert.ok(partial.events.some(e=>e.type==='tool.started'));assert.ok(partial.next_live_cursor);
 assert.equal((getDb().prepare("SELECT body FROM conversation_messages WHERE run_id=? AND role='assistant'").get(task.runId!) as {body:string}).body,'');
 assert.equal((getDb().prepare("SELECT count(*) AS n FROM conversation_events WHERE run_id=? AND type IN ('message.delta','tool.started')").get(task.runId!) as {n:number}).n,0);
 finish();await service.wait(task.runId!);
 const complete=readConversation(id);assert.equal((complete.current_messages.find((m:any)=>m.role==='assistant') as {body:string}).body,'最终结果：修改完成。');assert.equal(complete.next_live_cursor,'');assert.ok(!JSON.stringify(complete).includes('接着验证'));assert.ok(!JSON.stringify(complete).includes('执行命令'));
 let context='';const next=createConversationService({async run(_id,input,onEvent){context=input.message;onEvent({type:'bridge.result',data:{success:true,message:'第二轮结果'}});},async cancel(){}});
 const nextTask=next.submit(id,'owner','继续','transient-request-02');await next.wait(nextTask.id);assert.ok(context.includes('最终结果'));assert.ok(!context.includes('接着验证'));assert.ok(!context.includes('执行命令'));
 // Previously saved tool events remain in the database but are no longer returned as history.
 getDb().prepare('INSERT INTO conversation_events(session_id,run_id,type,data) VALUES(?,?,?,?)').run(session,task.runId!,'tool.started',JSON.stringify({runId:task.runId!,label:'旧工具记录'}));
 assert.ok(!JSON.stringify(readConversation(id)).includes('旧工具记录'));
});
test('client uses a live cursor independent of durable event sequence and discards transient cache',async()=>{
 const context:PlatformContext={protocol:1,projectId:project,requirementId:id,sessionId:session,projectName:'P',title:'R',userId:'owner',role:'admin'};
 let count=0;const paths:string[]=[];
 const request:PlatformRequest=async<T>(url:string)=>{paths.push(url);count++;return {session_id:session,restricted:false,messages:[],current_messages:[],runs:[],active_run:count===1?{id:'run',status:'running',user_id:'owner'}:null,events:count===1?[{seq:1,transient:true,type:'tool.started',data:{runId:'run',label:'执行命令'}}]:[],next_message_cursor:0,next_event_cursor:9,next_live_cursor:count===1?'generation:1':''} as T;};
 const client=new PlatformClient(context,request);assert.equal((await client.sync()).events.length,1);const completed=await client.sync(true);assert.ok(paths[1].includes('liveAfter=generation%3A1'));assert.ok(paths[1].includes('eventAfter=9'));assert.deepEqual(completed.events,[]);
});
test('provider reply buffer excludes text before tool calls and keeps the final answer intact',()=>{
 const reply=new ReplyBuffer();reply.append('持久化验证通过，接着查看日志。');reply.clear();reply.append('API 返回 HTML，继续检查。');reply.clear();reply.append('已修复代理');reply.append('，验证通过。');assert.equal(reply.final(),'已修复代理，验证通过。');assert.equal(reply.final('SDK 的正式最终回复'),'SDK 的正式最终回复');
});
