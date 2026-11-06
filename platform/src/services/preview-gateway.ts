import {previewHostConfig,previewHostname,registerPreviewHost} from './preview-host.js';
import {runtimeOperationActive} from './requirement-runtime.js';
import {activeWorkspaceRun,workspaceEvents} from './workspace-lock.js';
import {handlePreviewClient} from './preview-client.js';
import {acceptConversationSocket} from './conversation-socket.js';
import {conversationSession,readConversationForRole} from './conversations.js';
import {forwardPreviewResponse} from './preview-html.js';
import http from 'node:http';
import {safePreviewPath,isPreviewNavigation,previewLoginUrl} from './preview-navigation.js';
import net from 'node:net';
import crypto from 'node:crypto';
import { projectRole } from './projects.js';
import { requirement, runtimePort, runtimeServices } from './requirement-runtime.js';

// Each requirement/service has its own origin (development port or HTTPS subdomain).
// No platform JWT, source credentials or Agent endpoints are exposed to the preview application.
const gateways=new Map<string,Promise<{port:number;origin?:string;issue:(userId:string)=>string}>>();
export function canOpenRuntime(id:string,userId:string,kind:'preview'|'ide') {
  try{const role=projectRole(requirement(id).project_id,userId);return !!role && (kind==='preview' || role!=='viewer');}catch{return false;}
}
export async function issueRuntimeLink(id:string,userId:string,kind:'preview'|'ide',hostname:string,servicePort?:number,platformOrigin?:string) {
  if(kind==='ide' && (activeWorkspaceRun(id)||runtimeOperationActive(id)))throw new Error(activeWorkspaceRun(id)?.status==='interrupted'?'任务已中断，请重启需求环境后使用 IDE':'Agent 正在处理此需求，暂时无法使用 IDE');
  if(!canOpenRuntime(id,userId,kind))throw new Error('项目权限不足');
  if(kind==='preview'){
    const services=(await runtimeServices(id)).filter(s=>s.protocol==='http'&&s.ready);
    if(servicePort!==undefined){if(!Number.isInteger(servicePort)||!services.some(s=>s.port===servicePort))throw new Error('服务端口无效或 HTTP 服务尚未就绪');}
    else {const pages=services.filter(s=>s.page);servicePort=pages.length===1?pages[0].port:services.length===1?services[0].port:undefined;
      if(servicePort===undefined)throw Error(services.length?'检测到多个 HTTP 服务，请先选择预览服务':'HTTP 服务尚未就绪，请查看启动日志');}
  }else if(servicePort!==undefined)throw Error('服务端口无效');
  const key=`${id}:${kind}:${servicePort || 'default'}`;
  let pending=gateways.get(key);
  if(!pending){pending=createGateway(id,kind,servicePort,platformOrigin);gateways.set(key,pending);pending.catch(()=>gateways.delete(key));}
  const gateway=await pending;
  const host=process.env.PRISM_PREVIEW_HOST || (platformOrigin?new URL(platformOrigin).hostname:hostname);
  const authority=host.startsWith('[')?host:host.includes(':')?`[${host}]`:host;
  const url=new URL(`/__prism_open`,gateway.origin || `http://${authority}:${gateway.port}`);
  url.searchParams.set('ticket',gateway.issue(userId));return url.toString();
}
export async function createGateway(id:string,kind:'preview'|'ide',servicePort?:number,platformOrigin?:string,resolvePort=runtimePort) {
  // Confirm the target exists before allocating a public listener.
  await resolvePort(id,kind);
  const unified=previewHostConfig();
  const origin=unified?`https://${previewHostname(`${id}:${kind}:${servicePort || 'default'}`,unified.domain)}`:undefined;
  const tickets=new Map<string,{userId:string;until:number}>();
  const sessions=new Map<string,{userId:string;until:number}>();
  const cookie=`${unified?'__Host-':''}prism_${crypto.createHash('sha256').update(id+kind+String(servicePort || 'default')).digest('hex').slice(0,20)}`;
  function session(req:http.IncomingMessage){
    const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
    const value=token?sessions.get(token):undefined;
    return value && value.until>Date.now() && canOpenRuntime(id,value.userId,kind)?value:undefined;
  }
  function sameOrigin(req:http.IncomingMessage) {
    return !req.headers.origin || req.headers.origin===(origin || `http://${req.headers.host}`);
  }
  function headers(req:http.IncomingMessage,port:number) {
    const host=kind==='ide' ? req.headers.host : `localhost:${port}`;
    const h:http.OutgoingHttpHeaders={...req.headers,host};delete h.authorization;delete h['x-prism-service-port'];
    // code-server validates WebSocket Origin against Host/forwarded Host. Preserve
    // the browser-facing authority after our own origin check, not the Docker port.
    delete h.forwarded;
    h['x-forwarded-host']=host;
    h['x-forwarded-proto']=unified?'https':'http';
    if(kind==='preview'){h['accept-encoding']='identity';if(String(req.headers.accept).includes('text/html')){delete h['if-none-match'];delete h['if-modified-since'];}}
    if(kind==='preview' && servicePort)h['x-prism-service-port']=String(servicePort);
    // Never forward platform/gateway cookies to user project code.
    h.cookie=(req.headers.cookie || '').split(';').filter(v=>!/^(?:__Host-)?prism_/.test(v.trim())).join(';');
    return h;
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url || '/', 'http://gateway');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    function login(){
     try{
      const target=previewLoginUrl({projectId:requirement(id).project_id,requirementId:id,kind,servicePort,path:url.pathname==='/__prism_open'?'/':url.pathname+url.search,host:req.headers.host||'localhost',platformOrigin});
      res.writeHead(302,{Location:target});res.end();
     }catch{res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('平台访问地址不可用，请从 Prism Studio 重新打开预览。');}
    }
    if(url.pathname==='/__prism_open') {
      const ticket=url.searchParams.get('ticket') || '';const value=tickets.get(ticket);tickets.delete(ticket);
      if(!value || value.until<Date.now() || !canOpenRuntime(id,value.userId,kind)){if(isPreviewNavigation(req,url.pathname)){login();return;}res.writeHead(403);res.end('链接已失效，请从平台重新打开。');return;}
      const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{userId:value.userId,until:Date.now()+8*3600000});
      res.setHeader('Set-Cookie',`${cookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${unified?'; Secure':''}`);
      res.writeHead(302,{Location:safePreviewPath(url.searchParams.get('path'))});res.end();return;
    }
    if(kind==='ide' && (activeWorkspaceRun(id)||runtimeOperationActive(id))){res.writeHead(423,{'Content-Type':'text/plain; charset=utf-8'});res.end(activeWorkspaceRun(id)?.status==='interrupted'?'任务已中断，请重启需求环境后重新打开 IDE。':'工作区操作进行中，结束后可重新打开 IDE。');return;}
    if(!session(req)){if(isPreviewNavigation(req,url.pathname)){login();return;}const message='请登录 Prism Studio 后，从需求页面打开服务。';const api=url.pathname.startsWith('/__prism_platform__/');res.writeHead(401,{'Content-Type':api?'application/json; charset=utf-8':'text/plain; charset=utf-8'});res.end(api?JSON.stringify({error:message}):message);return;}
    if(!sameOrigin(req)){res.writeHead(403);res.end('Origin denied');return;}
    if(kind==='preview' && await handlePreviewClient(req,res,id,session(req)!.userId))return;
    try {
      const port=await resolvePort(id,kind);
      let headerTimer:ReturnType<typeof setTimeout>;
      const proxy=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:headers(req,port)},upstream=>{
        clearTimeout(headerTimer);
        const h={...upstream.headers};delete h['access-control-allow-origin'];delete h['access-control-allow-credentials'];
        if(h['set-cookie'])h['set-cookie']=h['set-cookie'].filter(v=>!/^(?:__Host-)?prism_/i.test(v));
        if(kind==='preview')forwardPreviewResponse(upstream,res,h);else{res.writeHead(upstream.statusCode || 502,h);upstream.pipe(res);}
      });
      headerTimer=setTimeout(()=>proxy.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})),35000);
      proxy.setTimeout(35000,()=>proxy.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));
      proxy.on('error',(error:NodeJS.ErrnoException)=>{clearTimeout(headerTimer);if(res.headersSent){res.destroy();return;}res.writeHead(error.code==='ETIMEDOUT'?504:502,{'Content-Type':'text/plain; charset=utf-8'});res.end(error.code==='ETIMEDOUT'?'服务响应超时，请查看启动日志。':'服务连接失败，请查看启动日志。');});
      req.pipe(proxy);res.on('close',()=>{clearTimeout(headerTimer);proxy.destroy();});
    }catch{res.writeHead(503);res.end('环境尚未启动或服务已停止。');}
  });
  server.on('upgrade',async(req,socket,head)=>{
    if((kind==='ide' && (activeWorkspaceRun(id)||runtimeOperationActive(id)))||!session(req)||!sameOrigin(req))return socket.destroy();
    try{
      const url=new URL(req.url||'/','http://gateway');
      if(kind==='preview'&&url.pathname.startsWith('/__prism_platform__/')){
        if(url.pathname!=='/__prism_platform__/conversation/live')return socket.destroy();
        const sessionId=conversationSession(id),userId=session(req)!.userId;
        if(projectRole(requirement(id).project_id,userId)==='viewer')return socket.destroy();
        acceptConversationSocket(req,socket,head,{sessionId,read:(after,eventAfter)=>{
          if(!session(req)||conversationSession(id)!==sessionId)throw Error('Session expired');
          const role=projectRole(requirement(id).project_id,userId);if(!role)throw Error('Access revoked');
          return readConversationForRole(id,role,after,eventAfter);
        }});return;
      }
      const port=await resolvePort(id,kind);
      const connectTimer=setTimeout(()=>{upstream.destroy();socket.destroy();},10000);
      const upstream=net.connect(port,'127.0.0.1',()=>{
        upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers(req,port)).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
      });
      upstream.once('data',()=>clearTimeout(connectTimer));
      const timer=setInterval(()=>{if(!session(req))socket.destroy();},30000);timer.unref();
      socket.on('close',()=>{clearTimeout(connectTimer);clearInterval(timer);upstream.destroy();});socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
    }catch{socket.destroy();}
  });
  if(unified){
    await registerPreviewHost(unified,new URL(origin!).host,{
      request:(req,res)=>{server.emit('connection-tracked',req.socket);server.emit('request',req,res);},
      upgrade:(req,socket,head)=>{server.emit('connection-tracked',socket);server.emit('upgrade',req,socket,head);}
    });
  }else await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,process.env.PRISM_PREVIEW_BIND || '0.0.0.0',()=>resolve());});
  server.unref();
  if(kind==='ide'){const sockets=new Set<net.Socket>();const track=(socket:net.Socket)=>{if(sockets.has(socket))return;sockets.add(socket);socket.once('close',()=>sockets.delete(socket));};server.on('connection',track);server.on('connection-tracked',track);workspaceEvents.on('locked',(target:string)=>{if(target===id)for(const socket of sockets)socket.destroy();});}
  const cleanup=setInterval(()=>{for(const map of [tickets,sessions])for(const [key,value] of map)if(value.until<Date.now())map.delete(key);},60000);cleanup.unref();
  return {port:unified?unified.port:(server.address() as net.AddressInfo).port,origin,issue(userId:string){const token=crypto.randomBytes(32).toString('hex');tickets.set(token,{userId,until:Date.now()+60000});return token;}};
}
