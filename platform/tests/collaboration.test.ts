import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {collaborationReply,messageMentions} from '../src/services/collaboration.js';
const dir=mkdtempSync(path.join(os.tmpdir(),'prism-group-'));
process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture-password';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initConversationTables,createConversationService,readConversation,interruptPreviousRuns}=await import('../src/services/conversations.js');
const {activeWorkspaceRun,releaseInterruptedRun}=await import('../src/services/workspace-lock.js');
(await initProjectTables());(await initConversationTables());for(const user of ['alice','bob','viewer'])(await createUser(user,'unused'));
const project=(await createProject('Group','','owner',[{userId:'alice',role:'editor'},{userId:'bob',role:'editor'},{userId:'viewer',role:'viewer'}],emptyConfig));
async function demand(){const id=crypto.randomUUID(),session=crypto.randomUUID();(await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Group','','','owner'));(await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(session,id));return id;}
const services:ReturnType<typeof createConversationService>[]=[];
function controlled(options={debounceMs:0,autowake:false}){
 const turns:{id:string;prompt:string;finish:(body:string,cancelled?:boolean)=>void}[]=[];
 let running=0,maxRunning=0;
 const service=createConversationService({async run(_id,input,event){running++;maxRunning=Math.max(running,maxRunning);event({type:'bridge.ready',data:{cancelSupported:true}});event({type:'run.started',data:{runId:input.runId}});await new Promise<void>(resolve=>turns.push({id:input.runId,prompt:input.message,finish(body,cancelled=false){event({type:'bridge.result',data:{success:true,message:body,cancelled}});running--;resolve();}}));},async cancel(){}},options);
 services.push(service);return {service,turns,max:()=>maxRunning};
}
async function until(check:()=>boolean){const deadline=Date.now()+2000;while(!check()){assert.ok(Date.now()<deadline,'scheduler did not advance');await new Promise(resolve=>setTimeout(resolve,5));}}
function result(action:string,extra:Record<string,unknown>={}){return '已处理。\n<prism-collaboration>'+JSON.stringify({action,questions:[],mentions:[],resolvedQuestionIds:[],...extra})+'</prism-collaboration>';}
after(async ()=>{services.forEach(s=>s.close());(await getDb().close());rmSync(dir,{recursive:true,force:true});});
test('multiple editors post during a run; all unread messages form one autonomous batch without parallel writers',async()=>{
 const id=(await demand()),{service,turns,max}=controlled();
 const first=(await service.submit(id,'alice','实现按钮','group-first-01'));await until(()=>turns.length===1);
 const second=(await service.submit(id,'bob','按钮使用蓝色','group-second-01')),third=(await service.submit(id,'alice','补充：圆角为8','group-third-01'));
 assert.equal(second.runId,null);assert.equal(third.runId,null);assert.equal(turns.length,1);
 assert.equal((await service.submit(id,'bob','按钮使用蓝色','group-second-01')).id,second.id);
 const before=(await readConversation(id)),assistant=(before.messages as any[]).find(m=>m.role==='assistant');
 turns[0].finish(result('execute'));await service.wait(first.id);await until(()=>turns.length===2);
 assert.equal(max(),1);const incoming=JSON.parse(turns[1].prompt.split('[本批未读消息]\n')[1]);assert.deepEqual(incoming.map((m:any)=>m.messageId),[second.id,third.id]);assert.deepEqual(incoming.map((m:any)=>m.userId),['bob','alice']);
 const after=(await readConversation(id,before.next_message_cursor,before.next_event_cursor));
 assert.ok((after.current_messages as any[]).some(m=>m.id===assistant.id&&m.body==='已处理。'),'finished message updates even when newer human messages follow it');
 assert.ok(!JSON.stringify(after).includes('<prism-collaboration>'));
 turns[1].finish(result('wait'));await service.wait(second.id);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(turns.length,2);assert.equal((await activeWorkspaceRun(id)),undefined);
 assert.equal((await readConversation(id)).agent_read_cursor,((await readConversation(id)).messages as any[]).find(m=>m.id===third.id).seq);
});
test('the next turn reads every unread post even when more than fifty arrive during execution',async()=>{
 const id=(await demand()),{service,turns}=controlled();const first=(await service.submit(id,'alice','第一轮','many-first-01'));await until(()=>turns.length===1);
 const posts=await Promise.all(Array.from({length:55},async (_,i)=>(await service.submit(id,i%2?'alice':'bob','补充 '+i,'many-post-'+i))));turns[0].finish(result('execute'));await service.wait(first.id);await until(()=>turns.length===2);const incoming=JSON.parse(turns[1].prompt.split('[本批未读消息]\n')[1]);assert.deepEqual(incoming.map((m:any)=>m.messageId).sort(),posts.map(post=>post.id).sort());turns[1].finish(result('reply'));await service.wait(posts.at(-1)!.id);assert.equal(turns.length,2);
});
test('questions and real mentions persist until explicitly resolved; new arrivals are processed next',async()=>{
 const id=(await demand()),{service,turns}=controlled();const first=(await service.submit(id,'alice','需要产品确认颜色','question-first-01'));await until(()=>turns.length===1);
 turns[0].finish(result('ask',{questions:[{userId:'bob',question:'请确认具体色值',messageIds:[first.id]}]}));await service.wait(first.id);
 let snapshot=(await readConversation(id));const question=snapshot.pending_questions[0];assert.equal(question.userId,'bob');const reply=(snapshot.messages as any[]).find(m=>m.role==='assistant');assert.match(reply.body,/@bob 请确认具体色值/);assert.deepEqual(JSON.parse(reply.mentions),['bob']);
 const next=(await service.submit(id,'alice','我猜是蓝色','question-second-01'));await until(()=>turns.length===2);assert.ok(turns[1].prompt.includes(question.id));
 const answer=(await service.submit(id,'bob','明确使用 #2463eb','question-third-01'));turns[1].finish(result('wait'));await service.wait(next.id);await until(()=>turns.length===3);assert.equal((await readConversation(id)).pending_questions.length,1);
 const incoming=JSON.parse(turns[2].prompt.split('[本批未读消息]\n')[1]);assert.deepEqual(incoming.map((m:any)=>m.messageId),[answer.id]);turns[2].finish(result('execute',{resolvedQuestionIds:[question.id]}));await service.wait(answer.id);assert.deepEqual((await readConversation(id)).pending_questions,[]);
});
test('cancellation consumes only the cancelled input, does not restart it, and keeps subsequent group messages',async()=>{
 const id=(await demand()),{service,turns}=controlled();const first=(await service.submit(id,'alice','耗时任务','cancel-group-01'));await until(()=>turns.length===1);
 await service.cancel(id,first.runId!);const next=(await service.submit(id,'bob','执行另一件独立的事','cancel-group-02'));assert.equal((await activeWorkspaceRun(id))?.status,'cancelling');assert.equal(turns.length,1);
 turns[0].finish('',true);await service.wait(first.id);await until(()=>turns.length===2);const incoming=JSON.parse(turns[1].prompt.split('[本批未读消息]\n')[1]);assert.deepEqual(incoming.map((m:any)=>m.messageId),[next.id]);turns[1].finish(result('reply'));await service.wait(next.id);await new Promise(resolve=>setTimeout(resolve,15));assert.equal(turns.length,2);
});
test('persisted unread posts resume without an open client and viewer posts are rejected',async()=>{
 const id=(await demand()),old=controlled({debounceMs:1000,autowake:false});const post=(await old.service.submit(id,'alice','离线时的任务','resume-group-01'));assert.equal(post.runId,null);old.service.close();
 const next=controlled();(await next.service.resume());await until(()=>next.turns.length===1);next.turns[0].finish(result('reply'));await next.service.wait(post.id);assert.equal((await activeWorkspaceRun(id)),undefined);
 await assert.rejects(async ()=>(await next.service.submit(id,'viewer','不能参与','viewer-group-01')),/编辑成员/);
 assert.ok(!(await readConversation(id)).participants.some(member=>member.id==='viewer'));
});
test('interrupted recovery skips old input and resumes later messages once the workspace is released',async()=>{
 const id=(await demand()),{service,turns}=controlled();const first=(await service.submit(id,'alice','旧任务','crash-group-01'));await until(()=>turns.length===1);(await interruptPreviousRuns());
 const next=(await service.submit(id,'bob','恢复后处理的新消息','crash-group-02'));assert.equal(next.runId,null);turns[0].finish(result('execute'));await service.wait(first.id);assert.equal((await activeWorkspaceRun(id))?.status,'interrupted');(await releaseInterruptedRun(id));(await service.resume());await until(()=>turns.length===2);const incoming=JSON.parse(turns[1].prompt.split('[本批未读消息]\n')[1]);assert.deepEqual(incoming.map((m:any)=>m.messageId),[next.id]);turns[1].finish(result('wait'));await service.wait(next.id);
});
test('control blocks validate members, keep code readable and hide malformed protocol output',()=>{
 assert.deepEqual(messageMentions('@bob 请确认 @viewer。 @bobcat', ['bob','alice']),['bob']);
 const reply=collaborationReply('回复\n<prism-collaboration>'+JSON.stringify({action:'ask',mentions:['viewer','bob'],questions:[{userId:'unknown',question:'bad'},{userId:'bob',question:'哪个文件？',messageIds:['foreign','a']} ]})+'</prism-collaboration>',['alice','bob'],['a'],[]);
 assert.deepEqual(reply.mentions,['bob']);assert.deepEqual(reply.questions[0].messageIds,['a']);assert.match(reply.body,/@bob 哪个文件？/);
 assert.equal(collaborationReply('正常内容<prism-collaboration>{bad',['bob'],[],[]).body,'正常内容');
});
test('assistant replies mention each member once while retaining every question and recipient',()=>{
 const raw='@bob 请确认颜色。\n\n@alice 请检查布局。\n\n@bob 还有尺寸。\n<prism-collaboration>'+JSON.stringify({action:'ask',mentions:['bob','alice','bob'],questions:[{userId:'bob',question:'请确认圆角？'},{userId:'bob',question:'请确认间距？'},{userId:'alice',question:'移动端是否通过？'}]})+'</prism-collaboration>';
 const reply=collaborationReply(raw,['alice','bob'],[],[]);
 assert.equal(reply.body,'@bob 请确认颜色。\n\n@alice 请检查布局。\n\nbob 还有尺寸。\n\nbob 请确认圆角？\n\nbob 请确认间距？\n\nalice 移动端是否通过？');
 assert.deepEqual(reply.mentions,['alice','bob']);
 assert.deepEqual(reply.questions.map(item=>[item.userId,item.question]),[['bob','请确认圆角？'],['bob','请确认间距？'],['alice','移动端是否通过？']]);
});
test('mention deduplication preserves code, links, non-members and exact member IDs',()=>{
 const literal='```text\n@bob 示例\n```\n\n~~~text\n@bob 示例\n~~~\n\n`@bob 示例`\n\n[文档](https://example.com/@bob)';
 const reply=collaborationReply(literal+'\n\n@bob 请确认。@bob 谢谢。\n@bobcat 保留。@viewer 保留。\n@a.b 请确认。@a.b 谢谢。',['bob','a.b'],[],[]);
 assert.equal(reply.body,literal+'\n\n@bob 请确认。bob 谢谢。\n@bobcat 保留。@viewer 保留。\n@a.b 请确认。a.b 谢谢。');
 assert.deepEqual(reply.mentions,['bob','a.b']);
});
test('metadata-only questions and mentions still add one visible mention per member',()=>{
 const reply=collaborationReply('请确认。<prism-collaboration>'+JSON.stringify({mentions:['alice','alice'],questions:[{userId:'bob',question:'颜色？'},{userId:'bob',question:'尺寸？'}]})+'</prism-collaboration>',['alice','bob'],[],[]);
 assert.equal(reply.body,'@alice\n\n请确认。\n\n@bob 颜色？\n\nbob 尺寸？');
 assert.deepEqual(reply.mentions,['bob','alice']);
});
