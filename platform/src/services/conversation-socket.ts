import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import {WebSocket,WebSocketServer} from 'ws';
import {conversationEvents} from './conversation-events.js';

interface Snapshot {session_id:string;restricted:boolean;messages:unknown[];events:{seq?:number;transient?:boolean}[];next_message_cursor:number;next_event_cursor:number}
const server=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false});

export function acceptConversationSocket(req:IncomingMessage,socket:Duplex,head:Buffer,options:{sessionId:string;read:(after:number,eventAfter:number)=>Snapshot;heartbeatMs?:number}){
 const url=new URL(req.url||'/','http://preview');
 let after=Number(url.searchParams.get('after')||0),eventAfter=Number(url.searchParams.get('eventAfter')||0);
 if(url.searchParams.get('sessionId')!==options.sessionId||!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(eventAfter)||eventAfter<0){
  socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');return;
 }
 // Check access before upgrading as well as before every frame and heartbeat.
 try{options.read(after,eventAfter);}catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
 server.handleUpgrade(req,socket,head,ws=>{
  let alive=true,queued:ReturnType<typeof setTimeout>|undefined;
  function fail(){if(ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'error',message:'会话访问权限或归属已变化，请重新打开预览'}));ws.close(1008,'Session unavailable');}else ws.terminate();}
  function push(){
   clearTimeout(queued);queued=undefined;if(ws.readyState!==WebSocket.OPEN)return;
   try{
    const value=options.read(after,eventAfter);
    if(value.session_id!==options.sessionId)throw Error('session changed');
    // Bound slow clients rather than accumulating unlimited progress frames.
    if(ws.bufferedAmount>2*1024*1024){ws.terminate();return;}
    ws.send(JSON.stringify({type:'snapshot',value}));
    after=value.restricted?0:value.next_message_cursor;eventAfter=value.restricted?0:value.next_event_cursor;
    if(!value.restricted&&(value.messages.length>=100||value.events.filter(event=>!event.transient).length>=200))schedule();
   }catch{fail();}
  }
  function schedule(){if(!queued)queued=setTimeout(push,20);}
  // Subscribe first, then send catch-up, so the HTTP-to-WS handoff loses no events.
  conversationEvents.on(options.sessionId,schedule);
  ws.on('pong',()=>{alive=true;});
  const heartbeat=setInterval(()=>{
   if(!alive){ws.terminate();return;}alive=false;
   push();if(ws.readyState===WebSocket.OPEN){ws.ping();ws.send(JSON.stringify({type:'heartbeat'}));}
  },options.heartbeatMs??20000);heartbeat.unref();
  const cleanup=()=>{clearInterval(heartbeat);clearTimeout(queued);conversationEvents.off(options.sessionId,schedule);};
  ws.once('close',cleanup);ws.once('error',()=>{cleanup();ws.terminate();});
  push();
 });
}
