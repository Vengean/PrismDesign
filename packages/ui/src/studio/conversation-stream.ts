import type {PlatformClient,PlatformConversation} from './platform-client.js';

export interface ConversationCursor {sessionId:string;after:number;eventAfter:number;liveAfter:string}
export type ConversationStreamEvent={type:'snapshot';value:PlatformConversation}|{type:'heartbeat'}|{type:'closed';message:string};
export type ConversationLive=(cursor:ConversationCursor,onEvent:(event:ConversationStreamEvent)=>void)=>()=>void;

// Runs in the preview page so its existing HttpOnly gateway cookie authenticates
// the socket. The extension receives events through a tab port, never credentials.
export const pageConversationLive:ConversationLive=(cursor,onEvent)=>{
 const url=new URL('/__prism_platform__/conversation/live',location.href);
 url.protocol=url.protocol==='https:'?'wss:':'ws:';
 for(const [key,value] of Object.entries(cursor))url.searchParams.set(key,String(value));
 const socket=new WebSocket(url);
 let stopped=false,timer:ReturnType<typeof setTimeout>;
 const finish=(message:string)=>{
  if(stopped)return;stopped=true;clearTimeout(timer);socket.close();onEvent({type:'closed',message});
 };
 const arm=(milliseconds:number)=>{clearTimeout(timer);timer=setTimeout(()=>finish('WebSocket 心跳超时，正在重新连接'),milliseconds);};
 arm(10000);
 socket.onopen=()=>{if(!stopped)arm(45000);};
 socket.onmessage=event=>{
  if(stopped)return;
  try{
   const frame=JSON.parse(String(event.data));
   if(frame.type==='error'){finish(String(frame.message||'实时连接不可用'));return;}
   if(frame.type!=='snapshot'&&frame.type!=='heartbeat')throw Error('invalid frame');
   arm(45000);onEvent(frame);
  }catch{finish('WebSocket 返回了无效消息');}
 };
 socket.onclose=event=>finish(event.reason||`WebSocket 连接关闭 (${event.code})`);
 socket.onerror=()=>finish('WebSocket 连接失败，请检查预览服务或网络');
 return()=>{stopped=true;clearTimeout(timer);socket.close();};
};

export function watchConversation(client:PlatformClient,live:ConversationLive,callbacks:{snapshot:(value:PlatformConversation,live:boolean)=>void;error:(error:unknown,durationMs:number)=>void}){
 let stopped=false,generation=0,attempt=0,disconnect:(()=>void)|undefined,retryTimer:ReturnType<typeof setTimeout>|undefined;
 function clear(){clearTimeout(retryTimer);retryTimer=undefined;disconnect?.();disconnect=undefined;}
 async function connect(){
  if(stopped)return;
  clear();const expected=++generation,started=Date.now();
  const valid=()=>!stopped&&generation===expected;
  function failed(error:unknown){
   if(!valid())return;
   generation++;clear();callbacks.error(error,Date.now()-started);
   const delay=Math.min(30000,1000*2**Math.min(attempt++,5))*(0.8+Math.random()*0.4);
   retryTimer=setTimeout(()=>{retryTimer=undefined;void connect();},delay);
  }
  try{
   // HTTP loads history and fills any gap after reconnect. Subscribe from that
   // cursor; the server's first frame also catches changes during this handoff.
   const initial=await client.sync();if(!valid())return;callbacks.snapshot(initial,false);
   if(!valid())return;
   const stop=live(client.cursor(),event=>{
    if(!valid())return;
    if(event.type==='closed'){failed(Error(event.message));return;}
    if(event.type==='heartbeat')return;
    try{const value=client.apply(event.value);attempt=0;callbacks.snapshot(value,true);}catch(error){failed(error);}
   });
   if(valid())disconnect=stop;else stop();
  }catch(error){failed(error);}
 }
 void connect();
 return {retry(){if(!stopped){generation++;clear();void connect();}},close(){stopped=true;generation++;clear();}};
}
