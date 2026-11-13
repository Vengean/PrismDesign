import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {projectRole} from './projects.js';
import {requirement} from './requirement-runtime.js';

export interface BrowserBinding {id:string;requirementId:string;userId:string;pageUrl:string;until:number}
export interface BrowserCommand {requestId:string;command:Record<string,unknown>}
export function createPlatformBrowser({timeoutMs=30000,leaseMs=45000}={}){
 const bindings=new Map<string,BrowserBinding>(),events=new EventEmitter().setMaxListeners(0);
 const pending=new Map<string,{bindingId:string;message:BrowserCommand;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;deliveredAt?:number}>();
 async function access(id:string,userId:string){const row=await requirement(id),role=await projectRole(row.project_id,userId);if(!role||role==='viewer')throw Error('只有项目编辑成员可以执行浏览器测试');if(['merged','closed'].includes(row.status))throw Error('已合入或关闭的需求只读');}
 function release(id:string){bindings.delete(id);for(const [key,item] of pending)if(item.bindingId===id){clearTimeout(item.timer);pending.delete(key);item.reject(Error('测试浏览器已断开，请重新打开插件后重试'));}events.emit(id);}
 async function get(id:string,requirementId:string,userId:string){await access(requirementId,userId);const binding=bindings.get(id);if(!binding||binding.requirementId!==requirementId||binding.userId!==userId)throw Error('浏览器绑定不存在或无权访问');if(binding.until<Date.now()){release(id);throw Error('测试浏览器连接已过期，请重新打开插件');}return binding;}
 return {
  async register(requirementId:string,userId:string,pageUrl:string){await access(requirementId,userId);const url=new URL(pageUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('浏览器页面地址无效');
   const binding={id:crypto.randomUUID(),requirementId,userId,pageUrl:url.href,until:Date.now()+leaseMs};bindings.set(binding.id,binding);return binding;
  },get,
  async poll(id:string,requirementId:string,userId:string){const binding=await get(id,requirementId,userId);binding.until=Date.now()+leaseMs;
   const next=()=>[...pending.values()].filter(item=>item.bindingId===id&&(!item.deliveredAt||Date.now()-item.deliveredAt>20000)).map(item=>item.message);
   if(!next().length)await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);events.off(id,done);resolve();};const timer=setTimeout(done,15000);events.once(id,done);});
   await get(id,requirementId,userId);binding.until=Date.now()+leaseMs;const commands=next();for(const command of commands)pending.get(command.requestId)!.deliveredAt=Date.now();return {commands};
  },
  async execute(id:string,requirementId:string,userId:string,command:Record<string,unknown>){const binding=await get(id,requirementId,userId);
   if(!['attach','detach','navigate','observe','scroll','click','fill','press','wait','screenshot','evidence','responseBody'].includes(String(command.action)))throw Error('不支持的浏览器命令');
   if(command.action==='navigate'){const url=new URL(String(command.url),binding.pageUrl);if(url.origin!==new URL(binding.pageUrl).origin)throw Error('测试不能跳转到其他需求或站点');command={...command,url:url.href};}
   const requestId=crypto.randomUUID();return new Promise<unknown>((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('浏览器命令超时，请确认插件仍连接到测试标签页'));},timeoutMs);pending.set(requestId,{bindingId:id,message:{requestId,command},resolve,reject,timer});events.emit(id);});
  },
  async result(id:string,requirementId:string,userId:string,requestId:string,success:boolean,value:unknown){await get(id,requirementId,userId);const item=pending.get(requestId);if(!item||item.bindingId!==id)throw Error('浏览器命令已过期或不属于当前标签页');clearTimeout(item.timer);pending.delete(requestId);if(success)item.resolve(value);else item.reject(Error(typeof value==='string'?value.slice(0,1000):'浏览器操作失败'));},
  async unregister(id:string,requirementId:string,userId:string){await get(id,requirementId,userId);release(id);},
  close(){for(const id of bindings.keys())release(id);},
 };
}
export const platformBrowser=createPlatformBrowser();
