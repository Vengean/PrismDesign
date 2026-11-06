import crypto from 'node:crypto';
import http from 'node:http';
import type {Duplex} from 'node:stream';
export interface PreviewHostConfig {domain:string;platformOrigin:string;port:number}
export function previewHostConfig():PreviewHostConfig|undefined {
 const domain=process.env.PRISM_PREVIEW_DOMAIN?.trim().toLowerCase();if(!domain)return;
 if(domain.length>190||!domain.includes('.')||!domain.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw Error('PRISM_PREVIEW_DOMAIN 必须是独立预览域名，不含协议、端口或通配符');
 const platform=new URL(process.env.PRISM_PLATFORM_URL || 'http://invalid');
 if(platform.protocol!=='https:'||platform.username||platform.password||platform.pathname!=='/'||platform.search||platform.hash||platform.hostname===domain||platform.hostname.endsWith('.'+domain))throw Error('统一预览需要配置独立于预览域名的 HTTPS PRISM_PLATFORM_URL');
 const port=Number(process.env.PRISM_PREVIEW_GATEWAY_PORT || 3100);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PRISM_PREVIEW_GATEWAY_PORT 无效');
 return {domain,platformOrigin:platform.origin,port};
}
export function previewHostname(key:string,domain:string){return 'p-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,32)+'.'+domain;}
export interface HostHandler {request:(req:http.IncomingMessage,res:http.ServerResponse)=>void;upgrade:(req:http.IncomingMessage,socket:Duplex,head:Buffer)=>void}
// One loopback listener behind the TLS terminator. Never trust X-Forwarded-Host/Proto.
export function createPreviewHostServer() {
 const hosts=new Map<string,HostHandler>();
 const resolve=(req:http.IncomingMessage)=>hosts.get(String(req.headers.host || '').toLowerCase());
 const server=http.createServer((req,res)=>{const handler=resolve(req);if(!handler){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('预览入口不存在或已失效，请从平台重新打开。');return;}handler.request(req,res);});
 server.on('upgrade',(req,socket,head)=>{const handler=resolve(req);if(!handler){socket.destroy();return;}handler.upgrade(req,socket,head);});
 return {server,register(host:string,handler:HostHandler){hosts.set(host,handler);}};
}
let listener:ReturnType<typeof createPreviewHostServer>|undefined,pending:Promise<void>|undefined;
export async function registerPreviewHost(config:PreviewHostConfig,host:string,handler:HostHandler) {
 if(!listener)listener=createPreviewHostServer();
 if(!pending)pending=new Promise<void>((resolve,reject)=>{listener!.server.once('error',reject);listener!.server.listen(config.port,'127.0.0.1',()=>{listener!.server.unref();resolve();});}).catch(error=>{pending=undefined;listener=undefined;throw error;});
 await pending;listener!.register(host,handler);
}
// Used by orderly shutdown and integration tests; active sessions expire on restart.
export async function closePreviewHosts() {
 if(!listener)return;const current=listener;listener=undefined;pending=undefined;
 current.server.closeAllConnections();await new Promise<void>(resolve=>current.server.close(()=>resolve()));
}
