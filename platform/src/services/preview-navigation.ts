import type http from 'node:http';
export function safePreviewPath(value:unknown){
 if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value))return '/';
 try{const url=new URL(value,'http://preview');return url.origin==='http://preview'?url.pathname+url.search+url.hash:'/';}catch{return '/';}
}
export function isPreviewNavigation(req:Pick<http.IncomingMessage,'method'|'headers'>,pathname:string){
 return ['GET','HEAD'].includes(req.method||'GET')&&String(req.headers.accept||'').includes('text/html')&&!pathname.startsWith('/__prism_platform__/');
}
export function previewLoginUrl(input:{projectId:string;requirementId:string;kind:'preview'|'ide';servicePort?:number;path:string;host:string;platformOrigin?:string}){
 const configured=process.env.PRISM_PLATFORM_URL;
 const base=new URL(configured||input.platformOrigin||`http://localhost:${process.env.PORT||3001}`);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('平台访问地址配置无效');
 // Preserve the address used by this browser (localhost/LAN IP/domain), while
 // using the management UI port captured when its preview link was issued.
 if(!configured)base.hostname=new URL('http://'+input.host).hostname;
 const next=new URLSearchParams({project:input.projectId,requirement:input.requirementId,kind:input.kind,path:safePreviewPath(input.path)});
 if(input.servicePort)next.set('port',String(input.servicePort));
 const login=new URL('/login',base);login.searchParams.set('next','/preview/continue?'+next);return login.toString();
}
