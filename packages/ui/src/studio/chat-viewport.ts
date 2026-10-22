// Hidden widgets have a zero-size message viewport. Scroll after they actually
// become visible, rather than only when their messages load in the background.
export function observeChatViewport(element:HTMLElement,onGutter:(width:number)=>void){
 let visible=false;
 const update=()=>{
  const next=element.clientHeight>0&&element.clientWidth>0;
  if(next&&!visible)element.scrollTop=element.scrollHeight;
  visible=next;onGutter(Math.max(0,element.offsetWidth-element.clientWidth));
 };
 const observer=new ResizeObserver(update);observer.observe(element);update();
 return()=>observer.disconnect();
}
