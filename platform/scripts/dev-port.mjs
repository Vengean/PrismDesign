import net from 'node:net';
function available(port,host){return new Promise(resolve=>{
 const server=net.createServer();
 server.once('error',error=>resolve(error.code==='EAFNOSUPPORT'||error.code==='EADDRNOTAVAIL'));
 server.listen({port,host,exclusive:true},()=>server.close(()=>resolve(true)));
});}
// On macOS, a wildcard listener can coexist with another process bound to
// 127.0.0.1. Check both loopbacks before letting Vite bind its wildcard address.
export async function findDevPort(first=5173){
 for(let port=first;port<first+100&&port<=65535;port++){
  if(await available(port,'127.0.0.1')&&await available(port,'::1')&&await available(port,'0.0.0.0'))return port;
 }
 throw Error('没有可用的平台前端端口，请检查端口占用。');
}
