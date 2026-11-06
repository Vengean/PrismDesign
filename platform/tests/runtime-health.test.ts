import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {probe,chooseService,evaluateHealth}=require('../docker/runtime-health.cjs');
const {createPreviewProxy}=require('../docker/preview-proxy.cjs');
async function listen(server:net.Server,host='127.0.0.1'){await new Promise<void>(r=>server.listen(0,host,r));return (server.address() as net.AddressInfo).port;}
async function close(server:net.Server){await new Promise<void>(r=>server.close(()=>r()));}
test('HTTP detection accepts authentication/not-found, separates JSON, 5xx, raw TCP and silent services',async()=>{
 const app=http.createServer((req,res)=>{res.statusCode=Number(req.url?.slice(1)) || 200;res.setHeader('Content-Type',req.url==='/200'?'application/json':'text/html');res.end('{}');});
 const raw=net.createServer(socket=>{socket.resume();socket.end('DATABASE greeting\r\n');});
 const sockets=new Set<net.Socket>();const silent=net.createServer(socket=>{socket.resume();sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 const [port,rawPort,silentPort]=await Promise.all([listen(app),listen(raw),listen(silent)]);
 try{
  for(const status of [401,404,302]){const result=await probe({port},{path:`/${status}`});assert.equal(result.protocol,'http');assert.equal(result.ready,true);assert.equal(result.page,true);}
  assert.equal((await probe({port},{path:'/503'})).ready,false);
  assert.equal((await probe({port},{path:'/200'})).page,false);
  assert.equal((await probe({port:rawPort})).protocol,'non-http');
  assert.equal((await probe({port:silentPort},{timeout:50})).protocol,'timeout');
 }finally{for(const socket of sockets)socket.destroy();await Promise.all([close(app),close(raw),close(silent)]);}
});
test('Agent readiness requires an authenticated status response with running state',async()=>{
 const app=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer fixture'){res.writeHead(401);res.end('{}');return;}res.end(JSON.stringify({status:req.url==='/api/status'?'running':'starting'}));});
 const port=await listen(app);
 try{
  assert.equal((await probe({port},{path:'/api/status',agent:true})).ready,false);
  assert.equal((await probe({port},{path:'/api/status',agent:true,token:'fixture'})).ready,true);
  assert.equal((await probe({port},{path:'/starting',agent:true,token:'fixture'})).ready,false);
 }finally{app.closeAllConnections();await close(app);}
});
test('default selection prefers a unique HTML service and requires selection for ambiguity',()=>{
 const api={port:3000,protocol:'http',ready:true,page:false},page={port:5173,protocol:'http',ready:true,page:true},db={port:5432,protocol:'non-http',ready:false};
 assert.equal(chooseService([api,page,db]),5173);assert.equal(chooseService([api,db]),3000);
 assert.equal(chooseService([page,{...page,port:5174}]),undefined);
 assert.equal(chooseService([api,{...api,port:3001}]),undefined);
 assert.equal(chooseService([api,page],3000),3000);assert.equal(chooseService([api,page],9527),undefined);
});
test('readiness requires both Agent and HTTP, enforces preparation/startup deadlines and allows brief recovery',()=>{
 const phase={phase:'starting',startedAt:0,changedAt:1000},web=[{protocol:'http',ready:true}];
 assert.equal(evaluateHealth(phase,false,web,2000,undefined,10000,3000).status,'starting');
 assert.equal(evaluateHealth(phase,true,web,2000,undefined,10000,3000).status,'running');
 assert.match(evaluateHealth(phase,false,web,4000,undefined,10000,3000).error,/Agent/);
 assert.match(evaluateHealth(phase,true,[],4000,undefined,10000,3000).error,/HTTP/);
 assert.equal(evaluateHealth({...phase,phase:'initializing'},true,web,10000,undefined,10000,3000).status,'failed');
 const lost=evaluateHealth(phase,false,web,100000,100000,10000,3000);assert.equal(lost.status,'starting');
 assert.equal(evaluateHealth(phase,true,web,101000,lost.unhealthySince,10000,3000).status,'running');
});
test('proxy routes selected services and reports protocol failures/timeouts with bounded waits',async()=>{
 const sockets=new Set<net.Socket>();
 const app=http.createServer((req,res)=>{if(req.url==='/hang')return;if(req.url==='/raw'){req.socket.end('NOT HTTP\r\n');return;}res.end('app:'+req.url);});
 app.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 const port=await listen(app),proxy=createPreviewProxy({services:()=>[{port,protocol:'http',ready:true,page:true}],hostname:()=> '127.0.0.1',timeout:80});
 const proxyPort=await listen(proxy);const base=`http://127.0.0.1:${proxyPort}`;
 try{
  assert.equal(await (await fetch(base+'/ok')).text(),'app:/ok');
  assert.equal((await fetch(base,{headers:{'x-prism-service-port':'9527'}})).status,503);
  const raw=await fetch(base+'/raw');assert.equal(raw.status,502);assert.match(await raw.text(),/HTTP/);
  const hung=await fetch(base+'/hang');assert.equal(hung.status,504);assert.match(await hung.text(),/超时/);
 }finally{proxy.closeAllConnections();for(const socket of sockets)socket.destroy();await Promise.all([close(proxy),close(app)]);}
});
