import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {CheckCircle2,AlertCircle,X} from 'lucide-react';

type Notice={id:number;message:string;kind:'success'|'error';duration:number};
let sequence=0;
let notices:Notice[]=[];
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const snapshot=()=>notices;
function dismiss(id:number){notices=notices.filter(notice=>notice.id!==id);listeners.forEach(listener=>listener());}
function show(message:string,kind:Notice['kind']){
 const id=++sequence;
 notices=[...notices.filter(notice=>notice.message!==message),{id,message,kind,duration:kind==='error'?7000:4500}].slice(-3);
 listeners.forEach(listener=>listener());
 return id;
}
export const toast={success:(message:string)=>show(message,'success'),error:(message:string)=>show(message,'error'),dismiss};

function ToastItem({notice}:{notice:Notice}){
 const [hovered,setHovered]=useState(false),[focused,setFocused]=useState(false);
 const remaining=useRef(notice.duration);
 useEffect(()=>{
  if(hovered||focused)return;
  const started=Date.now(),timer=setTimeout(()=>dismiss(notice.id),remaining.current);
  return()=>{clearTimeout(timer);remaining.current=Math.max(0,remaining.current-(Date.now()-started));};
 },[notice.id,hovered,focused]);
 const Icon=notice.kind==='success'?CheckCircle2:AlertCircle;
 return <div className="app-toast" data-kind={notice.kind} role={notice.kind==='error'?'alert':'status'} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
  <Icon size={16} className="toast-icon" aria-hidden="true"/><p>{notice.message}</p><button type="button" onClick={()=>dismiss(notice.id)} aria-label="关闭提示"><X size={14}/></button>
 </div>;
}
export function Toaster(){
 const items=useSyncExternalStore(subscribe,snapshot);
 return createPortal(<div className="app-toaster" aria-label="操作通知" aria-live="polite" aria-relevant="additions text">{items.map(notice=><ToastItem key={notice.id} notice={notice}/>)}</div>,document.body);
}
