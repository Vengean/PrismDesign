function findMessage(viewport:HTMLElement,messageId:string){
 return Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find(element=>element.dataset.messageId===messageId);
}
function userMentions(message:HTMLElement,userId:string|undefined){
 return Array.from(message.querySelectorAll<HTMLElement>('[data-mention-user]')).filter(element=>element.dataset.mentionUser===userId);
}
export function scrollToMention(viewport:HTMLElement,messageId:string,userId:string|undefined){
 const message=findMessage(viewport,messageId);
 if(message)(userMentions(message,userId)[0]||message).scrollIntoView({block:'center'});
}

// A visible chat at its latest messages is read, even when a long reply places
// the @ above the viewport. Hidden chats and history being browsed stay unread.
export function observeMentionVisibility(viewport:HTMLElement,messageId:string,userId:string|undefined,onRead:()=>void){
 const message=findMessage(viewport,messageId);
 const mentions=message?userMentions(message,userId):[],targets=mentions.length?mentions:message?[message]:[];let read=false;
 const check=()=>{
  if(read||document.visibilityState==='hidden'||!viewport.isConnected||!viewport.clientHeight||!viewport.clientWidth)return;
  const style=getComputedStyle(viewport);if(style.visibility==='hidden'||style.display==='none'||!viewport.getClientRects().length)return;
  const bounds=viewport.getBoundingClientRect(),top=Math.max(bounds.top,0),bottom=Math.min(bounds.bottom,window.innerHeight);
  if(Math.min(bounds.right,window.innerWidth)-Math.max(bounds.left,0)<=0||bottom-top<Math.min(viewport.clientHeight,48))return;
  const markRead=()=>{read=true;onRead();};
  if(bounds.bottom<=window.innerHeight+1&&viewport.scrollHeight-viewport.scrollTop-viewport.clientHeight<=24){markRead();return;}
  const messageRect=message?.getBoundingClientRect();
  if(messageRect&&messageRect.height>bottom-top&&messageRect.bottom>top+48&&messageRect.bottom<=bottom+1){markRead();return;}
  for(const target of targets){
   const targetStyle=getComputedStyle(target);if(targetStyle.visibility==='hidden'||targetStyle.display==='none'||!target.getClientRects().length)continue;
   const rect=target.getBoundingClientRect();
   const width=Math.min(rect.right,bounds.right,window.innerWidth)-Math.max(rect.left,bounds.left,0);
   const height=Math.min(rect.bottom,bottom)-Math.max(rect.top,top);
   if(width>0&&height>=Math.min(rect.height,48)&&height>0){markRead();return;}
  }
 };
 const intersection=new IntersectionObserver(check,{root:viewport,threshold:[0,1]});new Set([...targets,...(message?[message]:[])]).forEach(target=>intersection.observe(target));
 const resize=new ResizeObserver(check);resize.observe(viewport);if(message)resize.observe(message);
 viewport.addEventListener('scroll',check,{passive:true});document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);check();
 return()=>{intersection.disconnect();resize.disconnect();viewport.removeEventListener('scroll',check);document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);};
}
