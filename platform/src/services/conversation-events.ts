import {EventEmitter} from 'node:events';
import type {ServerResponse} from 'node:http';
export const conversationEvents=new EventEmitter().setMaxListeners(0);
// Register before checking cursors so no event can fall between the read and wait.
// Long polling works through the extension's existing tab message bridge.
export async function waitForConversation(sessionId:string,res:ServerResponse,changed:()=>boolean,timeout=20000){
 await new Promise<void>(resolve=>{
  const finish=()=>{clearTimeout(timer);conversationEvents.off(sessionId,finish);res.off('close',finish);resolve();};
  const timer=setTimeout(finish,timeout);
  conversationEvents.on(sessionId,finish);res.once('close',finish);
  try{if(changed()||res.destroyed)finish();}catch{finish();}
 });
}
