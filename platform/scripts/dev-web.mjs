import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

function ready(port){return new Promise(resolve=>{
 const request=http.get({hostname:'127.0.0.1',port,path:'/api/health',agent:false},response=>{
  let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy();});
  response.on('end',()=>{try{const value=JSON.parse(body);resolve(response.statusCode===200&&value.service==='prism-platform'&&value.status==='ready');}catch{resolve(false);}});
  response.on('error',()=>resolve(false));
 });
 const timer=setTimeout(()=>request.destroy(),1000);
 request.on('error',()=>resolve(false));request.on('close',()=>clearTimeout(timer));
});}
export async function waitForBackend({port=Number(process.env.PORT || 3001),timeout=60000,interval=250}={}){
 const deadline=Date.now()+timeout;
 while(!await ready(port)){
  if(Date.now()>=deadline)throw Error(`平台后端未在 ${timeout/1000} 秒内就绪，请检查 dev:server 的启动错误和端口 ${port} 的占用。`);
  await delay(interval);
 }
}
async function main(){
 const port=Number(process.env.PORT || 3001);
 console.log(`[dev] 等待平台后端就绪：127.0.0.1:${port}`);
 await waitForBackend({port});
 console.log('[dev] 平台后端已就绪，启动前端。');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../web/node_modules/vite/bin/vite.js',import.meta.url))],{cwd:fileURLToPath(new URL('../web/',import.meta.url)),stdio:'inherit',env:process.env});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});
 child.on('exit',(code,signal)=>{process.exitCode=code ?? (signal?1:0);});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(`[dev] ${error.message}`);process.exitCode=1;});
