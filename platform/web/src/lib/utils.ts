import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Copy inside the active dialog so its focus trap cannot redirect selection. */
export async function copyToClipboard(text:string,container?:HTMLElement|null):Promise<boolean>{
 if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true;}catch{/* HTTP/permission fallback. */}}
 const previous=document.activeElement as HTMLElement|null;
 const target=container||previous?.closest<HTMLElement>('[role="dialog"]')||document.body;
 const textarea=document.createElement('textarea');textarea.value=text;textarea.readOnly=true;
 textarea.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
 try{
  target.appendChild(textarea);textarea.focus({preventScroll:true});textarea.select();textarea.setSelectionRange(0,text.length);
  return document.execCommand('copy')===true;
 }catch{return false;}finally{textarea.remove();if(previous?.isConnected)previous.focus({preventScroll:true});}
}
