import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlatformClient,type PlatformContext,type PlatformConversation,type PlatformRequest} from '../../packages/ui/src/studio/platform-client.js';
import {conversationProgress} from '../../packages/ui/src/studio/conversation-progress.js';
const context:PlatformContext={protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'P',title:'R',userId:'u',role:'editor'};
const base:PlatformConversation={session_id:'s',restricted:false,messages:[],current_messages:[],active_run:{id:'run',status:'running',user_id:'u'},runs:[],events:[],next_message_cursor:0,next_event_cursor:0};
const event=(seq:number,type:string,data:Record<string,unknown>)=>({seq,type,data:{runId:'run',...data}});
test('partial text does not hide running tools; completed/failed tools and durations remain visible',()=>{
 const events=[event(1,'tool.started',{toolCallId:'read',label:'读取文件',at:100}),event(2,'message.delta',{delta:'partial'}),event(3,'tool.completed',{toolCallId:'read',success:true,at:350}),event(4,'tool.started',{toolCallId:'search',label:'查找资料',at:360})];
 const current=conversationProgress({...base,events});assert.equal(current.label,'查找资料');assert.equal(current.tools[0].status,'completed');assert.equal(current.tools[0].durationMs,250);assert.equal(current.tools[1].status,'running');
 const failed=conversationProgress({...base,events:[...events,event(5,'tool.completed',{toolCallId:'search',success:false})]});assert.equal(failed.tools[1].status,'failed');
 const done=conversationProgress({...base,active_run:null,runs:[{id:'run',status:'succeeded'}],events});assert.equal(done.label,'');assert.deepEqual(done.tools,[]);
});
test('legacy progress never invents completed tool events and ignores other runs',()=>{
 const events=[event(1,'tool.started',{tool:'legacy',toolCallId:'a',label:'读取文件'}),event(2,'tool.started',{tool:'legacy',toolCallId:'b',label:'执行命令'}),event(3,'tool.started',{runId:'other',toolCallId:'x',label:'别的需求'})];
 const current=conversationProgress({...base,events});assert.equal(current.label,'执行命令');assert.deepEqual(current.tools.map(t=>t.status),['reported','running']);
 const text=conversationProgress({...base,events:[...events,event(4,'message.delta',{delta:'正在回复'})]});assert.equal(text.label,'Agent 正在整理回复…');assert.ok(text.tools.every(tool=>tool.status==='reported'));
 assert.equal(conversationProgress({...base,active_run:{id:'run',status:'cancelling',user_id:'u'},events}).label,'正在取消，等待 Agent 停止…');
});
test('client preserves tool progress across incremental text batches, deduplicates reconnect data and clears restricted data',async()=>{
 let batch=0;const paths:string[]=[];
 const request:PlatformRequest=async<T>(path:string)=>{paths.push(path);batch++;return {...base,restricted:batch===4,next_event_cursor:batch,events:batch===1?[event(1,'tool.started',{toolCallId:'a',label:'读取文件'})]:batch===2?[event(2,'message.delta',{delta:'partial'})]:batch===3?[event(1,'tool.started',{toolCallId:'a',label:'读取文件'}),event(3,'tool.completed',{toolCallId:'a',success:true})]:[]} as T;};
 const client=new PlatformClient(context,request);await client.sync();const partial=await client.sync(true);assert.equal(conversationProgress(partial).tools[0].status,'running');assert.ok(paths[1].includes('wait=1'));assert.ok(paths[1].includes('eventAfter=1'));
 const complete=await client.sync(true);assert.equal(complete.events.filter(e=>e.type==='tool.started').length,1);assert.equal(conversationProgress(complete).tools[0].status,'completed');
 assert.deepEqual((await client.sync()).events,[]);
});

test('completed/failed/interrupted history never revives transient progress',()=>{
 const events=[event(1,'tool.started',{toolCallId:'a',label:'执行命令'})];
 for(const status of ['succeeded','failed','cancelled','interrupted']){
  const active_run=status==='interrupted'?{id:'run',status,user_id:'u'}:null;
  assert.deepEqual(conversationProgress({...base,active_run,runs:[{id:'run',status}],events}),{label:'',tools:[]});
 }
});
