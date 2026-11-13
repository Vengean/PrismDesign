import {executeCurrentTabCommand,type CurrentTabCommand} from './browser-controller.js';
interface Binding {id:string;tabId:number;sessionId:string;pageUrl:string;closed:boolean;completed:Map<string,Record<string,unknown>>;inflight:Set<string>}
const bindings=new Map<number,Binding>();
async function request<T>(tabId:number,sessionId:string,path:string,method='GET',body?:unknown):Promise<T>{
 const result=await chrome.tabs.sendMessage(tabId,{type:'PRISM_PLATFORM_REQUEST',path:path+(path.includes('?')?'&':'?')+'sessionId='+encodeURIComponent(sessionId),method,body});
 if(!result?.platform||result.error)throw Error(result?.error||'测试页面连接已断开');return result.data as T;
}
async function close(binding:Binding){binding.closed=true;bindings.delete(binding.tabId);await executeCurrentTabCommand(binding.tabId,{requestId:'cleanup',action:'detach'}).catch(()=>{});await request(binding.tabId,binding.sessionId,'/browser/unregister','POST',{bindingId:binding.id}).catch(()=>{});}
async function poll(binding:Binding){
 try{while(!binding.closed){
  const value=await request<{commands:{requestId:string;command:CurrentTabCommand}[]}>(binding.tabId,binding.sessionId,'/browser/commands?bindingId='+encodeURIComponent(binding.id));
  let navigation:Promise<void>|undefined;
  for(const item of value.commands){
   if(binding.closed)return;
   if(binding.inflight.has(item.requestId))continue;binding.inflight.add(item.requestId);
   const work=(async()=>{
   let result=binding.completed.get(item.requestId);
   if(!result){
    try{const tab=await chrome.tabs.get(binding.tabId);if(!tab.url||new URL(tab.url).origin!==new URL(binding.pageUrl).origin)throw Error('测试标签页已离开当前需求预览');
     result={requestId:item.requestId,success:true,result:await executeCurrentTabCommand(binding.tabId,item.command)};
    }catch(error){result={requestId:item.requestId,success:false,error:(error as Error).message};}
    binding.completed.set(item.requestId,result);while(binding.completed.size>100)binding.completed.delete(binding.completed.keys().next().value!);
   }
   await request(binding.tabId,binding.sessionId,'/browser/result','POST',{bindingId:binding.id,...result});
   })().catch(()=>close(binding)).finally(()=>binding.inflight.delete(item.requestId));
   if(item.command.action==='navigate')navigation=work;
  }
  if(navigation)await navigation;
 }}catch{await close(binding);}
}
chrome.tabs.onRemoved.addListener(tabId=>{const binding=bindings.get(tabId);if(binding)void close(binding);});
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
 if(message?.type!=='PRISM_BROWSER_PREPARE')return;
 void(async()=>{
  const tabId=Number(message.tabId),sessionId=String(message.sessionId||'');
  const previous=bindings.get(tabId);if(previous&&!previous.closed&&previous.sessionId===sessionId){respond({success:true,bindingId:previous.id});return;}
  if(previous)await close(previous);
  const tab=await chrome.tabs.get(tabId);if(!tab.url)throw Error('测试标签页不可用');
  const value=await request<{id:string}>(tabId,sessionId,'/browser/register','POST',{pageUrl:tab.url});
  const binding={id:value.id,tabId,sessionId,pageUrl:tab.url,closed:false,completed:new Map<string,Record<string,unknown>>(),inflight:new Set<string>()};bindings.set(tabId,binding);void poll(binding);respond({success:true,bindingId:value.id});
 })().catch(error=>respond({success:false,error:(error as Error).message}));return true;
});
