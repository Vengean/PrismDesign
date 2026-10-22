import type {AnnotationAdapter,AnnotationEvent} from '../../ui/src/studio/annotations.js';
import {inspectElement} from '../../ui/src/studio/inspector.js';
import {installPageBridge} from '../../ui/src/studio/page-bridge.js';
export function createPageAnnotations(host:HTMLElement,nonce=''):AnnotationAdapter {
 installPageBridge();
 const listeners=new Set<(event:AnnotationEvent)=>void>();let active=false;
 const overlay=document.createElement('div');overlay.id='prism-platform-selection';overlay.setAttribute('aria-hidden','true');
 overlay.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #86909c;background:rgba(134,144,156,.1);border-radius:3px;display:none;';
 const cursor=document.createElement('style');if(nonce)cursor.nonce=nonce;cursor.textContent='html.prism-platform-selecting,html.prism-platform-selecting *{cursor:crosshair!important}';
 const emit=(event:AnnotationEvent)=>listeners.forEach(listener=>listener(event));
 const inside=(event:Event)=>event.composedPath().includes(host);
 function stop(){active=false;host.classList.remove('prism-platform-picking');overlay.remove();cursor.remove();document.documentElement.classList.remove('prism-platform-selecting');document.removeEventListener('pointermove',move,true);document.removeEventListener('click',click,true);document.removeEventListener('keydown',escape,true);}
 function move(event:PointerEvent){if(inside(event)||!(event.target instanceof HTMLElement)){overlay.style.display='none';return;}const rect=event.target.getBoundingClientRect();Object.assign(overlay.style,{display:'block',top:rect.top+'px',left:rect.left+'px',width:rect.width+'px',height:rect.height+'px'});}
 function click(event:MouseEvent){if(inside(event)||!(event.target instanceof HTMLElement))return;event.preventDefault();event.stopImmediatePropagation();const element=inspectElement(event.target);stop();emit({type:'selected',element});}
 function escape(event:KeyboardEvent){if(event.key==='Escape'){stop();emit({type:'cancelled'});}}
 return {start(){if(active)return;active=true;host.classList.add('prism-platform-picking');document.body.appendChild(overlay);document.head.appendChild(cursor);document.documentElement.classList.add('prism-platform-selecting');document.addEventListener('pointermove',move,true);document.addEventListener('click',click,true);document.addEventListener('keydown',escape,true);},stop,subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);if(!listeners.size)stop();};}};
}
