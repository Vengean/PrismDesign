import {useEffect,useState} from 'react';

export function useDeletionCountdown(open:boolean){
 const [remaining,setRemaining]=useState(5);
 useEffect(()=>{
  setRemaining(5);
  if(!open)return;
  const deadline=Date.now()+5000;
  const timer=setInterval(()=>setRemaining(Math.max(0,Math.ceil((deadline-Date.now())/1000))),100);
  return()=>clearInterval(timer);
 },[open]);
 return remaining;
}
