export interface ChatScrollAnchor {id:string;offset:number;firstId:string|undefined}
export function captureChatAnchor(viewport:HTMLElement):ChatScrollAnchor|undefined{
 const top=viewport.getBoundingClientRect().top;
 const first=Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find(message=>message.getBoundingClientRect().bottom>top);
 return first?.dataset.messageId?{id:first.dataset.messageId,offset:first.getBoundingClientRect().top-top,firstId:viewport.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId}:undefined;
}
export function restoreChatAnchor(viewport:HTMLElement,anchor:ChatScrollAnchor){
 if(viewport.querySelector<HTMLElement>('[data-message-id]')?.dataset.messageId===anchor.firstId)return false;
 const message=Array.from(viewport.querySelectorAll<HTMLElement>('[data-message-id]')).find(message=>message.dataset.messageId===anchor.id);
 if(message)viewport.scrollTop+=message.getBoundingClientRect().top-viewport.getBoundingClientRect().top-anchor.offset;
 return true;
}
