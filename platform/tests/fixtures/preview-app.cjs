const http=require('node:http');
const crypto=require('node:crypto');
const server=http.createServer((req,res)=>{if(req.url.startsWith('/html')){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'none'");res.setHeader('Content-Encoding','gzip');res.end(require('node:zlib').gzipSync('<html><head><title>Fixture</title></head><body>preview HTML</body></html>'));return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:req.url,authorization:req.headers.authorization,cookie:req.headers.cookie,message:'prism-preview-fixture'}));});
server.on('upgrade',(req,socket)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');socket.on('error',()=>{});socket.on('data',()=>{});});
server.listen(3456,'0.0.0.0',()=>console.log('fixture listening on 3456'));

http.createServer((req,res)=>res.end('second-ipv6-service')).listen(3457,'::1');
