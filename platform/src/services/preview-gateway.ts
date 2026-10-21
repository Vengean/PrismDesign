import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { projectRole } from './projects.js';
import { requirement, runtimePort, runtimeServicePorts } from './requirement-runtime.js';

// Each requirement/service has its own browser origin (port), separate from the management UI.
// No platform JWT, source credentials or Agent endpoints are exposed to the preview application.
const gateways=new Map<string,Promise<{port:number;issue:(userId:string)=>string}>>();
export function canOpenRuntime(id:string,userId:string,kind:'preview'|'ide') {
  const role=projectRole(requirement(id).project_id,userId);
  return !!role && (kind==='preview' || role!=='viewer');
}
export async function issueRuntimeLink(id:string,userId:string,kind:'preview'|'ide',hostname:string,servicePort?:number) {
  if(!canOpenRuntime(id,userId,kind))throw new Error('项目权限不足');
  if(servicePort!==undefined && (kind!=='preview' || !(await runtimeServicePorts(id)).includes(servicePort)))throw new Error('服务端口无效');
  const key=`${id}:${kind}:${servicePort || 'default'}`;
  let pending=gateways.get(key);
  if(!pending){pending=createGateway(id,kind,servicePort);gateways.set(key,pending);pending.catch(()=>gateways.delete(key));}
  const gateway=await pending;
  const host=process.env.PRISM_PREVIEW_HOST || hostname;
  const url=new URL(`http://${host.includes(':')?`[${host}]`:host}:${gateway.port}/__prism_open`);
  url.searchParams.set('ticket',gateway.issue(userId));return url.toString();
}
async function createGateway(id:string,kind:'preview'|'ide',servicePort?:number) {
  // Confirm the target exists before allocating a public listener.
  await runtimePort(id,kind);
  const tickets=new Map<string,{userId:string;until:number}>();
  const sessions=new Map<string,{userId:string;until:number}>();
  const cookie=`prism_${crypto.createHash('sha256').update(id+kind).digest('hex').slice(0,20)}`;
  function session(req:http.IncomingMessage){
    const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookie+'='))?.slice(cookie.length+1);
    const value=token?sessions.get(token):undefined;
    return value && value.until>Date.now() && canOpenRuntime(id,value.userId,kind)?value:undefined;
  }
  function sameOrigin(req:http.IncomingMessage) {
    return !req.headers.origin || req.headers.origin===`http://${req.headers.host}`;
  }
  function headers(req:http.IncomingMessage,port:number) {
    const host=kind==='ide' ? req.headers.host : `localhost:${port}`;
    const h:http.OutgoingHttpHeaders={...req.headers,host};delete h.authorization;delete h['x-prism-service-port'];
    // code-server validates WebSocket Origin against Host/forwarded Host. Preserve
    // the browser-facing authority after our own origin check, not the Docker port.
    delete h.forwarded;
    h['x-forwarded-host']=host;
    h['x-forwarded-proto']='http';
    if(kind==='preview' && servicePort)h['x-prism-service-port']=String(servicePort);
    // Never forward platform/gateway cookies to user project code.
    h.cookie=(req.headers.cookie || '').split(';').filter(v=>!v.trim().startsWith('prism_')).join(';');
    return h;
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url || '/', 'http://gateway');
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
    if(url.pathname==='/__prism_open') {
      const ticket=url.searchParams.get('ticket') || '';const value=tickets.get(ticket);tickets.delete(ticket);
      if(!value || value.until<Date.now() || !canOpenRuntime(id,value.userId,kind)){res.writeHead(403);res.end('链接已失效，请从平台重新打开。');return;}
      const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{userId:value.userId,until:Date.now()+8*3600000});
      res.setHeader('Set-Cookie',`${cookie}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
      res.writeHead(302,{Location:'/'});res.end();return;
    }
    if(!session(req)){res.writeHead(401,{'Content-Type':'text/plain; charset=utf-8'});res.end('请登录 Prism Studio 后，从需求页面打开服务。');return;}
    if(!sameOrigin(req)){res.writeHead(403);res.end('Origin denied');return;}
    try {
      const port=await runtimePort(id,kind);
      const proxy=http.request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:headers(req,port)},upstream=>{
        const h={...upstream.headers};delete h['access-control-allow-origin'];delete h['access-control-allow-credentials'];
        if(h['set-cookie'])h['set-cookie']=h['set-cookie'].filter(v=>!v.startsWith('prism_'));
        res.writeHead(upstream.statusCode || 502,h);upstream.pipe(res);
      });
      proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('服务连接失败，请查看启动日志。');});
      req.pipe(proxy);res.on('close',()=>proxy.destroy());
    }catch{res.writeHead(503);res.end('环境尚未启动或服务已停止。');}
  });
  server.on('upgrade',async(req,socket,head)=>{
    if(!session(req)||!sameOrigin(req))return socket.destroy();
    try{
      const port=await runtimePort(id,kind);
      const upstream=net.connect(port,'127.0.0.1',()=>{
        upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers(req,port)).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
      });
      const timer=setInterval(()=>{if(!session(req))socket.destroy();},30000);timer.unref();
      socket.on('close',()=>{clearInterval(timer);upstream.destroy();});socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
    }catch{socket.destroy();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,process.env.PRISM_PREVIEW_BIND || '0.0.0.0',()=>resolve());});
  server.unref();
  const cleanup=setInterval(()=>{for(const map of [tickets,sessions])for(const [key,value] of map)if(value.until<Date.now())map.delete(key);},60000);cleanup.unref();
  return {port:(server.address() as net.AddressInfo).port,issue(userId:string){const token=crypto.randomBytes(32).toString('hex');tickets.set(token,{userId,until:Date.now()+60000});return token;}};
}
