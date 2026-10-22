import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import {injectPreviewHtml,widgetCsp,forwardPreviewResponse} from '../src/services/preview-html.js';
import {PlatformClient,type PlatformContext,type PlatformRequest} from '../../packages/widget/src/platform-client.js';
test('HTML injection is idempotent and nonce CSP preserves app restrictions',()=>{
 const html=injectPreviewHtml('<html><head><title>App</title></head><body>你好</body></html>','nonce-value');assert.equal(injectPreviewHtml(html,'other'),html);assert.equal((html.match(/widget\.js/g)||[]).length,1);
 const inline=widgetCsp("script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'",'nonce-value');assert.ok(!inline.includes('nonce-nonce-value'));assert.match(inline,/unsafe-inline/);
 const meta=injectPreviewHtml('<html><head><meta content="default-src &apos;none&apos;" http-equiv="Content-Security-Policy"></head></html>','nonce-value');assert.match(meta,/nonce-nonce-value/);
 const csp=widgetCsp("default-src 'none'; script-src 'strict-dynamic' https://scripts.example; connect-src https://api.example; frame-ancestors 'none'",'nonce-value');assert.match(csp,/nonce-nonce-value/);assert.match(csp,/connect-src https:\/\/api.example 'self'/);assert.match(csp,/img-src data:/);assert.match(csp,/frame-ancestors 'none'/);assert.ok(!csp.includes("script-src 'unsafe-inline'"));
});
test('preview adds a mobile viewport only when the application has none',()=>{
 assert.match(injectPreviewHtml('<head></head>','n'),/name="viewport" content="width=device-width, initial-scale=1"/);
 for(const tag of ['<meta name="viewport" content="width=500">',"<meta content='width=500' name='viewport'>",'<meta name=viewport content="width=500">']){
  const html=injectPreviewHtml(`<head>${tag}</head>`,'n');assert.ok(html.includes(tag));assert.equal((html.match(/name=["']?viewport/gi)||[]).length,1);
 }
});
test('gzip HTML is injected with corrected headers; JSON passes through unchanged',async()=>{
 const app=http.createServer((req,res)=>{if(req.url==='/broken')res.statusCode=500;if(req.url==='/data'){res.setHeader('Content-Type','application/json');res.end('{"untouched":true}');return;}res.setHeader('Content-Type','text/html');res.setHeader('Content-Encoding','gzip');res.setHeader('ETag','fixture');res.setHeader('Content-Security-Policy',"default-src 'none'");res.end(zlib.gzipSync('<html><head></head><body>你好</body></html>'));});await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));
 const proxy=http.createServer((req,res)=>{http.get(`http://127.0.0.1:${(app.address() as {port:number}).port}${req.url}`,upstream=>forwardPreviewResponse(upstream,res,{...upstream.headers}));});await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 try{const base=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`;const response=await fetch(base);const text=await response.text();assert.match(text,/你好/);assert.equal(response.headers.get('etag'),null);assert.equal(response.headers.get('content-encoding'),null);assert.equal(response.headers.get('x-prism-widget'),'injected');assert.ok(response.headers.get('content-security-policy')!.includes(text.match(/nonce="([^"]+)"/)![1]));assert.deepEqual(await (await fetch(base+'/data')).json(),{untouched:true});const broken=await fetch(base+'/broken');assert.equal(broken.status,500);assert.equal(broken.headers.get('x-prism-widget'),'injected');}finally{await Promise.all([new Promise<void>(r=>proxy.close(()=>r())),new Promise<void>(r=>app.close(()=>r()))]);}
});
test('Widget and plugin clients share server messages and bind every request to the expected session',async()=>{
 const context:PlatformContext={protocol:1,projectId:'p',requirementId:'r',sessionId:'s',projectName:'P',title:'R',userId:'owner',role:'editor'};const calls:string[]=[];let body='partial';
 const request:PlatformRequest=async<T>(path:string)=>{calls.push(path);return {session_id:'s',messages:[{id:'m',seq:1,body,role:'assistant'}],current_messages:[],events:[],runs:[],active_run:null,next_message_cursor:1,next_event_cursor:0} as T;};
 const widget=new PlatformClient(context,request),plugin=new PlatformClient(context,request);await widget.sync();body='final';assert.equal((await plugin.sync()).messages[0].body,'final');assert.equal((await widget.sync()).messages.length,1);assert.ok(calls.every(c=>c.includes('sessionId=s')));
 const wrong:PlatformRequest=async<T>()=>({session_id:'other'} as T);await assert.rejects(new PlatformClient(context,wrong).sync(),/归属/);
});
