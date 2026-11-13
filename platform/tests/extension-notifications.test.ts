import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectNotifications} from '../../packages/chrome-ext/src/background/notification-state.js';
import {createNotificationService,NOTIFICATION_STATE,NOTIFICATION_ENABLED} from '../../packages/chrome-ext/src/background/notifications.js';
import type {PlatformContext,PlatformConversation,PlatformMessage} from '../../packages/ui/src/studio/platform-client.js';
const context:PlatformContext={protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'Project',title:'Requirement',userId:'u',role:'editor'};
const empty:PlatformConversation={session_id:'s',restricted:false,messages:[],current_messages:[],active_run:null,runs:[],events:[],next_message_cursor:0,next_event_cursor:0};
const mention=(seq=1):PlatformMessage=>({id:'m'+seq,seq,run_id:null,role:'user',user_id:'other',body:'@u 请查看',mentions:'["u"]'});
const checkpoint=()=>collectNotifications(context,empty).checkpoint;
test('baseline stays quiet; new mentions deduplicate and self mentions stay quiet',()=>{
 const value={...empty,messages:[mention()],next_message_cursor:1};
 const initial=collectNotifications(context,value);assert.deepEqual(initial.candidates,[]);
 const next={...value,messages:[mention(),mention(2)],next_message_cursor:2};
 const result=collectNotifications(context,next,initial.checkpoint);assert.deepEqual(result.candidates.map(c=>c.kind),['mention']);
 assert.deepEqual(collectNotifications(context,next,result.checkpoint).candidates,[]);
 assert.deepEqual(collectNotifications(context,{...next,messages:[{...mention(3),user_id:'u'}]},result.checkpoint).candidates,[]);
});
test('assistant can acquire a mention without changing sequence; completion coalesces',()=>{
 const pending={...mention(),run_id:'run',role:'assistant' as const,user_id:null,mentions:'[]',body:''};
 const initial=collectNotifications(context,{...empty,messages:[pending],next_message_cursor:1,active_run:{id:'run',status:'running',user_id:'u'}});
 const finished={...empty,messages:[{...pending,mentions:'["u"]',body:'@u 完成'}],next_message_cursor:1,runs:[{id:'run',status:'succeeded',user_id:'u'}],events:[{seq:1,type:'run.finished',data:{runId:'run'}}],next_event_cursor:1};
 const result=collectNotifications(context,finished,initial.checkpoint);assert.deepEqual(result.candidates.map(c=>c.kind),['mention']);
 assert.deepEqual(collectNotifications(context,finished,result.checkpoint).candidates,[]);
});
test('own terminal runs notify; other users and cancellation stay quiet',()=>{
 for(const status of ['succeeded','failed','interrupted','cancelled']){
  const value={...empty,runs:[{id:'run',status,user_id:'u',error:'failure'}],events:[{seq:1,type:'run.finished',data:{runId:'run'}}],next_event_cursor:1};
  assert.deepEqual(collectNotifications(context,value,checkpoint()).candidates.map(c=>c.kind),status==='cancelled'?[]:[status==='succeeded'?'completed':'failed']);
  assert.deepEqual(collectNotifications(context,{...value,runs:[{id:'run',status,user_id:'other'}]},checkpoint()).candidates,[]);
 }
});
test('questions and test proposals target owner and coalesce completion',()=>{
 const reply={...mention(),role:'assistant' as const,run_id:'run',user_id:null,mentions:'["u"]',client_context:JSON.stringify({verification:{id:'v',status:'awaiting_confirmation',goal:'验收'}})};
 const value={...empty,messages:[reply],next_message_cursor:1,runs:[{id:'run',status:'succeeded',user_id:'u'}],pending_questions:[{id:'q',userId:'u',question:'请确认',messageIds:['m1']}]};
 assert.deepEqual(collectNotifications(context,value,checkpoint()).candidates.map(c=>c.kind),['question']);
 assert.deepEqual(collectNotifications(context,{...value,pending_questions:[],messages:[{...reply,mentions:'[]'}]},checkpoint()).candidates.map(c=>c.kind),['verification']);
 assert.deepEqual(collectNotifications(context,{...value,pending_questions:[{...value.pending_questions[0],userId:'other'}],messages:[{...reply,mentions:'[]'}],runs:[{id:'run',status:'succeeded',user_id:'other'}]},checkpoint()).candidates,[]);
});
class Signal {listeners:Function[]=[];addListener=(fn:Function)=>this.listeners.push(fn);emit=(...args:any[])=>{for(const fn of this.listeners)fn(...args);};}
function fixture(storage:Record<string,any>={}){
 const streams:any[]=[],alerts:any[]=[],calls:string[]=[];
 const tabs=new Map([[1,{id:1,windowId:10,active:true,url:'http://preview.fixture/'}],[2,{id:2,windowId:10,active:false,url:'http://preview.fixture/'}]]);
 let reading=false,focused=true,permission='granted',snapshot=empty;
 const api:any={runtime:{getURL:(path:string)=>'chrome-extension://fixture/'+path,onMessage:new Signal(),onConnect:new Signal()},storage:{local:{get:async()=>storage,set:async(value:any)=>Object.assign(storage,value)},onChanged:new Signal()},windows:{getAll:async()=>[{id:10,focused}],update:async()=>{calls.push('focus');}},tabs:{onRemoved:new Signal(),onUpdated:new Signal(),get:async(id:number)=>{const tab=tabs.get(id);if(!tab)throw Error('closed');return tab;},query:async()=>[],sendMessage:async(_id:number,message:any)=>message.type==='PRISM_NOTIFICATION_PAGE_STATE'?{reading}:{platform:true,data:message.path==='/context'?context:snapshot},connect:()=>{const port={onMessage:new Signal(),onDisconnect:new Signal(),postMessage:(value:any)=>{port.cursor=value;},cursor:null as any,disconnect:()=>{if(!port.closed){port.closed=true;port.onDisconnect.emit();}},closed:false};streams.push(port);return port;},update:async(id:number,options:any)=>{calls.push('tab');const tab=tabs.get(id);if(!tab)throw Error('closed');Object.assign(tab,options);return tab;},create:async(options:any)=>{calls.push('create');return {id:3,...options};}},sidePanel:{open:()=>{calls.push('open');return Promise.resolve();}},notifications:{getPermissionLevel:(cb:Function)=>cb(permission),create:(id:string,options:any,cb:Function)=>{alerts.push({id,options});cb();},clear:async()=>true,onClicked:new Signal(),onClosed:new Signal()}};
 const service=createNotificationService(api);service.install();
 return {api,service,streams,alerts,calls,storage,tabs,push(value:PlatformConversation){snapshot=value;streams.at(-1).onMessage.emit({type:'snapshot',value});},setReading:(v:boolean)=>reading=v,setFocused:(v:boolean)=>focused=v,setPermission:(v:string)=>permission=v};
}
async function until(predicate:()=>boolean){const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('condition timed out');await new Promise(resolve=>setTimeout(resolve,5));}}
async function settled(f:ReturnType<typeof fixture>,cursor:number){await until(()=>Object.values(f.storage[NOTIFICATION_STATE]||{}).some((value:any)=>value.after===cursor));await new Promise(resolve=>setTimeout(resolve,10));}
test('background watches with panel closed, deduplicates tabs, consumes read/mute state and restores cursors',async t=>{
 const f=fixture();t.after(()=>f.service.close());await f.service.discover(1);await until(()=>f.streams.length===1);await f.service.discover(2);assert.equal(f.streams.length,1);
 f.push({...empty,messages:[mention()],next_message_cursor:1});await until(()=>f.alerts.length===1);assert.equal(f.alerts[0].options.title,'有人 @ 了你');assert.ok(!JSON.stringify(f.storage).includes('请查看'));
 f.setReading(true);f.push({...empty,messages:[mention(2)],next_message_cursor:2});await settled(f,2);assert.equal(f.alerts.length,1);
 f.setReading(false);f.api.storage.onChanged.emit({[NOTIFICATION_ENABLED]:{newValue:false}},'local');f.push({...empty,messages:[mention(3)],next_message_cursor:3});await settled(f,3);assert.equal(f.alerts.length,1);
 f.api.storage.onChanged.emit({[NOTIFICATION_ENABLED]:{newValue:true}},'local');f.push({...empty,messages:[mention(2),mention(3)],next_message_cursor:3});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.alerts.length,1);
 f.setPermission('denied');f.push({...empty,messages:[mention(4)],next_message_cursor:4});await settled(f,4);assert.equal(f.alerts.length,1);
 f.service.close();const resumed=fixture(f.storage);t.after(()=>resumed.service.close());await resumed.service.discover(1);await until(()=>resumed.streams.length===1);assert.equal(resumed.streams[0].cursor.after,4);assert.equal(resumed.alerts.length,0);
});
test('sidepanel presence suppresses focused conversation; notification click opens synchronously',async t=>{
 const f=fixture();t.after(()=>f.service.close());await f.service.discover(1);await until(()=>f.streams.length===1);
 const port={name:'prism-notification-presence',sender:{url:f.api.runtime.getURL('sidepanel.html')},onMessage:new Signal(),onDisconnect:new Signal()};f.api.runtime.onConnect.emit(port);port.onMessage.emit({tabId:1,sessionId:'s',userId:'u',visible:true});
 f.push({...empty,messages:[mention()],next_message_cursor:1});await settled(f,1);assert.equal(f.alerts.length,0);
 f.setFocused(false);f.push({...empty,messages:[mention(2)],next_message_cursor:2});await until(()=>f.alerts.length===1);
 f.api.notifications.onClicked.emit(f.alerts[0].id);assert.equal(f.calls[0],'open');await until(()=>f.calls.includes('tab'));
 port.onDisconnect.emit();f.setFocused(true);f.push({...empty,messages:[mention(3)],next_message_cursor:3});await until(()=>f.alerts.length===2);
 f.api.tabs.onRemoved.emit(1);assert.equal(f.streams[0].closed,true);
});
