import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {WebSocket} from 'ws';
import {acceptConversationSocket} from '../src/services/conversation-socket.js';
import {conversationEvents} from '../src/services/conversation-events.js';

async function fixture(heartbeatMs=1000){
 const sessionId='socket-fixture';let allowed=true,restricted=false;
 const rows=Array.from({length:205},(_,i)=>({id:`m${i+1}`,seq:i+1,body:`History ${i+1}`}));
 const app=http.createServer();const clients=new Set<WebSocket>();
 app.on('upgrade',(req,socket,head)=>acceptConversationSocket(req,socket,head,{sessionId,heartbeatMs,read:(after,eventAfter)=>{
  if(!allowed)throw Error('revoked');
  const messages=restricted?[]:rows.filter(row=>row.seq>after).slice(0,100);
  return {session_id:sessionId,restricted,messages,current_messages:restricted?[]:rows.slice(-2),events:[],next_message_cursor:messages.at(-1)?.seq||after,next_event_cursor:eventAfter};
 }}));
 await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
 const base=`ws://127.0.0.1:${(app.address() as {port:number}).port}`;
 function connect(query='sessionId=socket-fixture&after=0&eventAfter=0',autoPong=true){
  const ws=new WebSocket(base+'/?'+query,{autoPong});clients.add(ws);
  const frames:any[]=[];ws.on('message',data=>frames.push(JSON.parse(String(data))));
  const ready=new Promise<void>((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
  async function until(predicate:(frames:any[])=>boolean){const deadline=Date.now()+3000;while(!predicate(frames)){assert.ok(Date.now()<deadline,'WebSocket frame timeout');await new Promise(resolve=>setTimeout(resolve,5));}return frames;}
  return {ws,frames,ready,until};
 }
 return {rows,connect,revoke(){allowed=false;},restrict(value:boolean){restricted=value;},changed(){conversationEvents.emit(sessionId);},async close(){for(const ws of clients)ws.terminate();await new Promise<void>(resolve=>app.close(()=>resolve()));}};
}

test('WebSocket catches up paginated history, pushes changes and resumes from a reconnect cursor',async()=>{
 const f=await fixture();try{
  const a=f.connect();await a.ready;await a.until(frames=>frames.some(frame=>frame.value?.next_message_cursor===205));
  assert.deepEqual(a.frames.filter(frame=>frame.type==='snapshot').flatMap(frame=>frame.value.messages.map((row:any)=>row.seq)),Array.from({length:205},(_,i)=>i+1));
  f.rows.push({id:'m206',seq:206,body:'During disconnect'});
  a.ws.terminate();
  const b=f.connect('sessionId=socket-fixture&after=205&eventAfter=0');await b.ready;await b.until(frames=>frames.some(frame=>frame.value?.next_message_cursor===206));
  assert.deepEqual(b.frames.find(frame=>frame.type==='snapshot').value.messages.map((row:any)=>row.id),['m206']);
  f.rows.push({id:'m207',seq:207,body:'Pushed live'});f.changed();await b.until(frames=>frames.some(frame=>frame.value?.next_message_cursor===207));
 }finally{await f.close();}
 const deadline=Date.now()+3000;while(conversationEvents.listenerCount('socket-fixture')){assert.ok(Date.now()<deadline,'socket listener was not removed');await new Promise(resolve=>setTimeout(resolve,5));}
});

test('permission changes redact messages, restored access reloads history, and revocation closes the stream',async()=>{
 const f=await fixture();try{
  const a=f.connect('sessionId=socket-fixture&after=205&eventAfter=0');await a.ready;await a.until(frames=>frames.length>0);
  f.restrict(true);f.changed();await a.until(frames=>frames.some(frame=>frame.value?.restricted));
  const restricted=a.frames.find(frame=>frame.value?.restricted).value;assert.deepEqual(restricted.messages,[]);assert.deepEqual(restricted.current_messages,[]);
  const count=a.frames.length;f.restrict(false);f.changed();await a.until(frames=>frames.slice(count).some(frame=>frame.value?.next_message_cursor===205));
  assert.equal(a.frames.slice(count).flatMap(frame=>frame.value?.messages||[]).length,205);
  const closed=new Promise<number>(resolve=>a.ws.once('close',resolve));f.revoke();f.changed();assert.equal(await closed,1008);
 }finally{await f.close();}
});

test('heartbeat maintains healthy connections and terminates peers which no longer pong',async()=>{
 const f=await fixture(40);try{
  const healthy=f.connect('sessionId=socket-fixture&after=205&eventAfter=0');await healthy.ready;
  await healthy.until(frames=>frames.filter(frame=>frame.type==='heartbeat').length>=3);assert.equal(healthy.ws.readyState,WebSocket.OPEN);
  const silent=f.connect('sessionId=socket-fixture&after=205&eventAfter=0',false);await silent.ready;
  await new Promise<void>(resolve=>silent.ws.once('close',()=>resolve()));assert.equal(silent.ws.readyState,WebSocket.CLOSED);
 }finally{await f.close();}
});

test('invalid cursors and wrong session identities are rejected before upgrade',async()=>{
 const f=await fixture();try{
  for(const query of ['sessionId=wrong','sessionId=socket-fixture&after=-1','sessionId=socket-fixture&eventAfter=NaN']){
   const socket=f.connect(query);await assert.rejects(socket.ready,/409/);
  }
 }finally{await f.close();}
});
