import React from 'react';
import {STUDIO_LOGO} from './brand.js';
export function MessageAvatar({name,agent=false}:{name:string;agent?:boolean}){
 const palettes=[['#e4edff','#315b9c'],['#eee8fa','#71519b'],['#e4f1e9','#3e7356'],['#fff0dd','#956630'],['#f7e7eb','#96596a']];
 let hash=0;for(const char of name)hash=(hash*31+char.charCodeAt(0))>>>0;const [background,color]=palettes[hash%palettes.length];
 return agent?<img src={STUDIO_LOGO} alt="Agent 头像" className="mt-0.5 h-6 w-6 shrink-0 rounded-full"/>:<span role="img" aria-label={`${name}的头像`} title={name} className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium" style={{background,color}}>{Array.from(name.trim()).slice(0,2).join('').toUpperCase()}</span>;
}
// Only text nodes become mentions; code blocks, inline code and links keep their
// original meaning. The server validates the member IDs used by this renderer.
export function remarkMentions({ids}:{ids:string[]}){
 return(tree:any)=>{
  if(!ids.length)return;
  const pattern=new RegExp('@('+[...ids].sort((a,b)=>b.length-a.length).map(id=>id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')(?=$|[\\s，。！？、:：;；,!?()（）])','gu');
  const visit=(node:any)=>{
   if(['code','inlineCode','link','linkReference'].includes(node.type)||!node.children)return;
   node.children=node.children.flatMap((child:any)=>{
    if(child.type!=='text'){visit(child);return [child];}
    const text=String(child.value),parts:any[]=[];let last=0;
    for(const match of text.matchAll(pattern)){const start=match.index!;if(start>last)parts.push({type:'text',value:text.slice(last,start)});parts.push({type:'link',url:'#prism-mention-'+encodeURIComponent(match[1]),children:[{type:'text',value:match[0]}]});last=start+match[0].length;}
    if(!parts.length)return [child];if(last<text.length)parts.push({type:'text',value:text.slice(last)});return parts;
   });
  };visit(tree);
 };
}
