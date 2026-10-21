// Internal proxy: app ports stay inside the container, only this port is published.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
function ports() {
  const values = new Set();
  for (const file of ['/proc/net/tcp','/proc/net/tcp6']) {
    for (const line of fs.readFileSync(file,'utf8').trim().split('\n').slice(1)) {
      const columns=line.trim().split(/\s+/);
      const port=parseInt(columns[1].split(':')[1],16);
      if(columns[3]==='0A' && port>1024 && ![8080,8090,9527].includes(port)) values.add(port);
    }
  }
  return [...values].sort((a,b)=>a-b);
}
function target(req) {const available=ports();const selected=Number(req.headers['x-prism-service-port']);return selected ? (available.includes(selected)?selected:undefined) : available[0];}
function hostname(port) {
  const v4=fs.readFileSync('/proc/net/tcp','utf8').trim().split('\n').slice(1).some(line=>{const c=line.trim().split(/\s+/);return c[3]==='0A'&&parseInt(c[1].split(':')[1],16)===port;});
  return v4?'127.0.0.1':'::1';
}
const server=http.createServer((req,res)=>{
  const port=target(req);
  if(!port){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('应用尚未监听端口，请查看启动日志。');return;}
  const headers={...req.headers,host:`localhost:${port}`};delete headers['x-prism-service-port'];
  const upstream=http.request({hostname:hostname(port),port,path:req.url,method:req.method,headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('应用连接失败');});
  req.pipe(upstream);res.on('close',()=>upstream.destroy());
});
server.on('upgrade',(req,socket,head)=>{
  const port=target(req);if(!port)return socket.destroy();
  const upstream=net.connect(port,hostname(port),()=>{
    const headers={...req.headers,host:`localhost:${port}`};delete headers['x-prism-service-port'];
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
  });upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(8090,'0.0.0.0');
