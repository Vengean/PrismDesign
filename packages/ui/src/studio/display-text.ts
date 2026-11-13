// Format display summaries only. Source messages and tool payloads stay intact.
export function truncateDisplayText(text:string,maxLength:number){
 const characters=Array.from(text);
 if(characters.length<=maxLength)return text;
 const head=characters.slice(0,Math.max(0,maxLength-1)).join('').trimEnd().replace(/[，,、；;：:。.!?！？…]+$/u,'');
 return head+'…';
}
export function progressSummary(text:string,maxLength=80){
 const summary=truncateDisplayText(text.replace(/\s+/gu,' ').trim(),maxLength);
 return summary.replace(/[，,、；;：:]+$/u,'…').replace(/\.{3,}$/u,'…');
}
