export type SubscriptionProvider='codex'|'claude'|'glm';
const gates=new Map<string,Promise<void>>();
export async function withProjectAuthGate<T>(projectId:string,work:()=>Promise<T>):Promise<T>{
 const previous=gates.get(projectId)||Promise.resolve();let release!:()=>void;
 const current=new Promise<void>(resolve=>{release=resolve;});gates.set(projectId,current);
 await previous;try{return await work();}finally{release();if(gates.get(projectId)===current)gates.delete(projectId);}
}
export function subscriptionProvider(value:string):SubscriptionProvider{
 if(value!=='codex'&&value!=='claude'&&value!=='glm')throw Error('不支持的订阅 SDK');
 return value;
}
export function projectAuthVolume(projectId:string){
 if(!/^[a-zA-Z0-9_-]+$/.test(projectId))throw Error('项目 ID 无效');
 return `${process.env.PRISM_MODE==='sit'?'prism-sit':'prism'}-project-${projectId}-auth`;
}
export function subscriptionLoginCommand(provider:SubscriptionProvider){
 return provider==='codex'?['codex','login','--device-auth']:provider==='claude'?['claude','auth','login']:['glm-acp-agent','--setup'];
}
