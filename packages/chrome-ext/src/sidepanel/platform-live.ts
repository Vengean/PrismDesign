import type {ConversationLive,ConversationStreamEvent} from '../../../ui/src/studio/conversation-stream.js';

export function tabConversationLive(tabId:number,onReconnect?:()=>void):ConversationLive{
 let connected=false;
 return(cursor,onEvent)=>{
  const port=chrome.tabs.connect(tabId,{name:'prism-platform-live',frameId:0});
  let stopped=false,firstSnapshot=true;
  const receive=(event:ConversationStreamEvent)=>{if(!stopped){
   if(event.type==='snapshot'&&firstSnapshot){firstSnapshot=false;const reconnected=connected;connected=true;if(reconnected)onReconnect?.();}
   onEvent(event);
  }};
  const disconnected=()=>{const message=chrome.runtime.lastError?.message;if(!stopped){stopped=true;onEvent({type:'closed',message:message||'预览页面通信已断开'});}};
  port.onMessage.addListener(receive);port.onDisconnect.addListener(disconnected);
  port.postMessage(cursor);
  return()=>{stopped=true;port.onMessage.removeListener(receive);port.onDisconnect.removeListener(disconnected);port.disconnect();};
 };
}
