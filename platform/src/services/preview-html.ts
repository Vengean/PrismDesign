import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type http from 'node:http';
const LIMIT=8*1024*1024;
export function injectPreviewHtml(html:string,nonce:string){
 if(/<script\b[^>]*\bsrc=["']\/__prism_platform__\/widget\.js["']/i.test(html))return html;
 html=html.replace(/<meta\b[^>]*>/gi,tag=>{
  if(!/http-equiv\s*=\s*(["'])content-security-policy\1/i.test(tag))return tag;
  return tag.replace(/(content\s*=\s*)(["'])(.*?)\2/i,(_all,prefix:string,quote:string,value:string)=>{
   const decoded=value.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
   const next=widgetCsp(decoded,nonce).replace(/&/g,'&amp;').replace(quote==='"'?/"/g:/'/g,quote==='"'?'&quot;':'&#39;');return prefix+quote+next+quote;
  });
 });
 const viewport=/<meta\b[^>]*\bname\s*=\s*(?:["']viewport["']|viewport(?=\s|\/>|>))/i.test(html)?'':'<meta name="viewport" content="width=device-width, initial-scale=1">';
 const markup=`${viewport}<meta name="prism-platform" content="1"><script nonce="${nonce}" src="/__prism_platform__/widget.js" defer></script>`;
 return /<head\b[^>]*>/i.test(html)?html.replace(/<head\b[^>]*>/i,match=>match+markup):/<html\b[^>]*>/i.test(html)?html.replace(/<html\b[^>]*>/i,match=>match+markup):/<!doctype[^>]*>/i.test(html)?html.replace(/<!doctype[^>]*>/i,match=>match+markup):markup+html;
}
function allowWidget(directive:string[],nonce:string,script:boolean){
 // Adding a nonce disables a previously valid unsafe-inline fallback. Preserve
 // that existing behavior rather than breaking the application's own bootstrap.
 if(directive.includes("'unsafe-inline'")&&!directive.some(v=>/^'(nonce-|sha(256|384|512)-|strict-dynamic)/.test(v))){if(script&&!directive.includes("'self'"))directive.push("'self'");return;}
 directive.splice(1,directive.length-1,...directive.slice(1).filter(s=>s!=="'none'"),`'nonce-${nonce}'`);
}
export function widgetCsp(policy:string,nonce:string){
 const directives=policy.split(';').map(s=>s.trim()).filter(Boolean).map(s=>s.split(/\s+/));
 const defaults=directives.find(d=>d[0].toLowerCase()==='default-src')?.slice(1) || ["'self'"];
 for(const name of ['script-src','style-src']){
  let directive=directives.find(d=>d[0].toLowerCase()===name);if(!directive){directive=[name,...defaults];directives.push(directive);}
  allowWidget(directive,nonce,name==='script-src');
 }
 let connect=directives.find(d=>d[0].toLowerCase()==='connect-src');if(!connect){connect=['connect-src',...defaults];directives.push(connect);}if(!connect.includes("'self'"))connect.splice(1,connect.length-1,...connect.slice(1).filter(s=>s!=="'none'"),"'self'");
 let images=directives.find(d=>d[0].toLowerCase()==='img-src');if(!images){images=['img-src',...defaults];directives.push(images);}if(!images.includes('data:'))images.splice(1,images.length-1,...images.slice(1).filter(s=>s!=="'none'"),'data:');
 for(const directive of directives)if(['script-src-elem','style-src-elem'].includes(directive[0].toLowerCase()))allowWidget(directive,nonce,directive[0].toLowerCase()==='script-src-elem');
 return directives.map(d=>d.join(' ')).join('; ');
}
export function forwardPreviewResponse(upstream:http.IncomingMessage,res:http.ServerResponse,headers:http.IncomingHttpHeaders){
 const status=upstream.statusCode || 502;
 const charset=String(headers['content-type'] || '').match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1].toLowerCase();
 if((charset&&!['utf-8','utf8','us-ascii'].includes(charset)) || [204,206,304].includes(status) || (status>=300&&status<400) || !String(headers['content-type'] || '').toLowerCase().includes('text/html')){res.writeHead(status,headers);upstream.pipe(res);return;}
 let chunks:Buffer[]=[];let size=0,bypass=false;
 upstream.on('data',(chunk:Buffer)=>{
  if(bypass){res.write(chunk);return;}chunks.push(chunk);size+=chunk.length;
  if(size>LIMIT){bypass=true;res.writeHead(status,{...headers,'x-prism-widget':'skipped-size'});for(const b of chunks)res.write(b);chunks=[];}
 });
 upstream.on('end',()=>{
  if(bypass){res.end();return;}const original=Buffer.concat(chunks);
  try{
   const encoding=String(headers['content-encoding'] || '').toLowerCase();let decoded=original;
   if(encoding==='gzip')decoded=zlib.gunzipSync(original,{maxOutputLength:LIMIT});else if(encoding==='br')decoded=zlib.brotliDecompressSync(original,{maxOutputLength:LIMIT});else if(encoding==='deflate')decoded=zlib.inflateSync(original,{maxOutputLength:LIMIT});else if(encoding&&encoding!=='identity')throw Error('encoding');
   const nonce=crypto.randomBytes(18).toString('base64');const html=Buffer.from(injectPreviewHtml(decoded.toString('utf8'),nonce));
   const h={...headers};delete h['content-encoding'];delete h['content-length'];delete h.etag;delete h['content-md5'];
   for(const key of ['content-security-policy','content-security-policy-report-only'])if(h[key]){const value=h[key];h[key]=Array.isArray(value)?value.map(p=>widgetCsp(p,nonce)):widgetCsp(String(value),nonce);}
   h['cache-control']='no-store';h['content-type']='text/html; charset=utf-8';h['x-prism-widget']='injected';res.writeHead(status,h);res.end(html);
  }catch{res.writeHead(status,{...headers,'x-prism-widget':'skipped-encoding'});res.end(original);}
 });
 upstream.on('error',()=>res.destroy());
}
