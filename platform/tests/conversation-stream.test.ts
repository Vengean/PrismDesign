import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlatformClient,type PlatformConversation,type PlatformContext,type PlatformRequest} from '../../packages/ui/src/studio/platform-client.js';
import {watchConversation,type ConversationCursor,type ConversationLive,type ConversationStreamEvent} from '../../packages/ui/src/studio/conversation-stream.js';
const context:PlatformContext={protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'P',title:'R',userId:'u',role:'editor'};
const message=(seq:number)=>({id:`m${seq}`,seq,run_id:'run',role:'assistant' as const,body:`Message ${seq}`,user_id:'u'});
const snapshot=(seq:number,messages=[message(seq)]):PlatformConversation=>({session_id:'s',restricted:false,messages,current_messages:[],runs:[],active_run:null,events:[],next_message_cursor:seq,next_event_cursor:0});
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('loads history once over HTTP then applies WebSocket events without periodic reads',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const paths:string[]=[],values:PlatformConversation[]=[],connected:boolean[]=[];
 const request:PlatformRequest=async<T>(path)=>{paths.push(path);return snapshot(1) as T;};
 let event:(event:ConversationStreamEvent)=>void=()=>{},cursor:ConversationCursor|undefined;
 const live:ConversationLive=(input,listener)=>{cursor=input;event=listener;return()=>{};};
 const watch=watchConversation(new PlatformClient(context,request),live,{snapshot:(value,ready)=>{values.push(value);connected.push(ready);},error:()=>assert.fail('unexpected disconnect')});
 await flush();assert.equal(paths.length,1);assert.ok(!paths[0].includes('wait=1'));assert.equal(cursor?.after,1);
 event({type:'snapshot',value:snapshot(2)});event({type:'snapshot',value:snapshot(2)});
 assert.deepEqual(values.at(-1)!.messages.map(m=>m.id),['m1','m2']);
 assert.deepEqual(connected,[false,true,true]);
 t.mock.timers.tick(120000);await flush();assert.equal(paths.length,1);
 watch.close();
});

test('reconnect fills missed messages using the retained cursor and rejects late events from an old socket',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const cursors:ConversationCursor[]=[],handlers:((event:ConversationStreamEvent)=>void)[]=[],values:PlatformConversation[]=[];
 let reads=0,closed=0,failures=0;
 const request:PlatformRequest=async<T>()=>snapshot(++reads) as T;
 const live:ConversationLive=(cursor,listener)=>{cursors.push(cursor);handlers.push(listener);return()=>{closed++;};};
 const client=new PlatformClient(context,request),watch=watchConversation(client,live,{snapshot:value=>values.push(value),error:()=>{failures++;}});
 await flush();handlers[0]({type:'closed',message:'connection lost'});
 assert.equal(failures,1);assert.equal(closed,1);
 t.mock.timers.tick(1200);await flush();assert.equal(reads,2);assert.equal(cursors[1].after,2);
 assert.deepEqual(values.at(-1)!.messages.map(m=>m.id),['m1','m2']);
 handlers[0]({type:'snapshot',value:snapshot(99)});assert.equal(client.cursor().after,2);
 handlers[1]({type:'snapshot',value:snapshot(3)});assert.deepEqual(values.at(-1)!.messages.map(m=>m.id),['m1','m2','m3']);
 watch.close();handlers[1]({type:'closed',message:'late close'});t.mock.timers.tick(60000);await flush();assert.equal(reads,2);assert.equal(failures,1);assert.equal(closed,2);
});

test('manual retry closes the old subscription and permission-restricted snapshots clear cached history',async()=>{
 let event:(event:ConversationStreamEvent)=>void=()=>{},closed=0,reads=0;
 const request:PlatformRequest=async<T>()=>{reads++;return snapshot(1) as T;};
 const client=new PlatformClient(context,request);
 const watch=watchConversation(client,(_cursor,listener)=>{event=listener;return()=>{closed++;};},{snapshot:()=>{},error:()=>{}});
 await flush();event({type:'snapshot',value:{...snapshot(1,[]),restricted:true}});assert.equal(client.cursor().after,0);
 watch.retry();await flush();assert.equal(closed,1);assert.equal(reads,2);
 watch.close();
});
