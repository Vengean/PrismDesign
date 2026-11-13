// SIT must never stop, replace or mount a development workspace with the same ID.
export function runtimeResourceNames(id:string){
 const prefix=process.env.PRISM_MODE==='sit'?'prism-sit':'prism';
 return {container:`${prefix}-req-${id}`,volume:`${prefix}-req-code-${id}`};
}
