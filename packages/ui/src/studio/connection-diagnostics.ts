type ConnectionSource='context'|'realtime';

// Debug details belong in the sidebar/page DevTools, never the product UI.
export function createConnectionLogger(output:Pick<Console,'warn'|'info'>=console){
 const failures=new Map<ConnectionSource,{at:number;message:string}>();
 return {
  failed(source:ConnectionSource,message:string,durationMs?:number){
   const now=Date.now(),previous=failures.get(source);
   failures.set(source,{at:previous?.at??now,message});
   output.warn('[Prism Studio] Connection failed',{source,at:new Date(now).toISOString(),message,...(durationMs===undefined?{}:{durationMs})});
  },
  recovered(source:ConnectionSource){
   const previous=failures.get(source);if(!previous)return;
   failures.delete(source);const now=Date.now();
   output.info('[Prism Studio] Connection restored',{source,at:new Date(now).toISOString(),failedAt:new Date(previous.at).toISOString(),recoveryMs:now-previous.at,previousError:previous.message});
  },
 };
}
