// A mention is read only while the chat and document are visible. Prefer the
// actual @ text so a long reply's offscreen mention is not acknowledged early.
export function observeMentionVisibility(viewport:HTMLElement,messageId:string,userId:string|undefined,onRead:()=>void){
 const message=Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find(el=>el.dataset.messageId===messageId);
 if(!message)return()=>{};
 const mentions=Array.from(message.querySelectorAll<HTMLElement>('[data-mention-user]')).filter(el=>el.dataset.mentionUser===userId);
 const targets=mentions.length?mentions:[message];let read=false;
 const check=()=>{
  if(read||document.visibilityState==='hidden'||!viewport.isConnected||!viewport.clientHeight||!viewport.clientWidth)return;
  const bounds=viewport.getBoundingClientRect();
  for(const target of targets){
   const style=getComputedStyle(target);if(style.visibility==='hidden'||style.display==='none'||!target.getClientRects().length)continue;
   const rect=target.getBoundingClientRect();
   const width=Math.min(rect.right,bounds.right,window.innerWidth)-Math.max(rect.left,bounds.left,0);
   const height=Math.min(rect.bottom,bounds.bottom,window.innerHeight)-Math.max(rect.top,bounds.top,0);
   if(width>0&&height>=Math.min(rect.height,48)&&height>0){read=true;onRead();return;}
  }
 };
 const intersection=new IntersectionObserver(check,{root:viewport,threshold:[0,1]});targets.forEach(target=>intersection.observe(target));
 const resize=new ResizeObserver(check);resize.observe(viewport);
 viewport.addEventListener('scroll',check,{passive:true});document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);check();
 return()=>{intersection.disconnect();resize.disconnect();viewport.removeEventListener('scroll',check);document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);};
}
