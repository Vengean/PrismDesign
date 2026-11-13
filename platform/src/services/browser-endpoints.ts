import type {IncomingMessage,ServerResponse} from 'node:http';
import {platformBrowser} from './platform-browser.js';
import {conversations} from './conversations.js';
export async function handleBrowserEndpoint(req:IncomingMessage,res:ServerResponse,id:string,userId:string){
 const url=new URL(req.url||'/','http://preview'),action=url.pathname.slice('/__prism_platform__'.length);
 if(!action.startsWith('/browser/')&&action!=='/testing/start')return false;
 const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
  let body:Record<string,unknown>={};
  if(req.method==='POST'){let text='',size=0;for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>12*1024*1024)throw Error('浏览器响应过大');text+=chunk;}body=JSON.parse(text||'{}');}
  const bindingId=String(body.bindingId||url.searchParams.get('bindingId')||'');
  if(action==='/browser/register'&&req.method==='POST'){
   const page=new URL(String(body.pageUrl));if(page.host!==req.headers.host)throw Error('测试页面不属于当前需求预览');
   json(201,await platformBrowser.register(id,userId,page.href));
  }else if(action==='/browser/commands'&&req.method==='GET')json(200,await platformBrowser.poll(bindingId,id,userId));
  else if(action==='/browser/result'&&req.method==='POST'){await platformBrowser.result(bindingId,id,userId,String(body.requestId),body.success===true,body.success===true?body.result:body.error);json(200,{success:true});}
  else if(action==='/browser/unregister'&&req.method==='POST'){await platformBrowser.unregister(bindingId,id,userId);json(200,{success:true});}
  else if(action==='/testing/start'&&req.method==='POST'){
   const goal=String(body.goal||'').trim(),checks=Array.isArray(body.proposedChecks)?body.proposedChecks.map(String).slice(0,20):[];
   if(!goal||goal.length>2000)throw Error('请填写测试目标');
   json(202,await conversations.submit(id,userId,`开始真实浏览器测试：${goal}${checks.length?'\n检查项：\n'+checks.join('\n'):''}`,String(body.requestId),undefined,[],{bindingId,verifyOnly:true}));
  }else json(404,{error:'测试接口不存在'});
 }catch(error){if(!res.destroyed)json(409,{error:(error as Error).message});}
 return true;
}
