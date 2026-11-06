import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {waitForBackend} from '../scripts/dev-web.mjs';
import {findDevPort} from '../scripts/dev-port.mjs';
async function listen(server:net.Server){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return (server.address() as net.AddressInfo).port;}
async function close(server:net.Server){await new Promise<void>(r=>server.close(()=>r()));}
test('front-end waits for the actual platform readiness, not just an open port',async()=>{
 let ready=false;const server=http.createServer((req,res)=>{assert.equal(req.url,'/api/health');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'prism-platform',status:ready?'ready':'starting'}));});
 const port=await listen(server);let resolved=false;
 try{
  const waiting=waitForBackend({port,timeout:1000,interval:5}).then(()=>{resolved=true;});
  await new Promise(r=>setTimeout(r,30));assert.equal(resolved,false);ready=true;await waiting;assert.equal(resolved,true);
 }finally{server.closeAllConnections();await close(server);}
});
test('another service on the API port produces a bounded, actionable startup error',async()=>{
 const server=http.createServer((_req,res)=>res.end(JSON.stringify({service:'another-app',status:'ready'})));const port=await listen(server);
 try{await assert.rejects(waitForBackend({port,timeout:40,interval:5}),/dev:server.*端口/);}finally{server.closeAllConnections();await close(server);}
});
test('front-end avoids ports held by loopback-only services on macOS',async()=>{
 const occupied=net.createServer(),port=await listen(occupied);
 try{const chosen=await findDevPort(port);assert.ok(chosen>port);assert.ok(chosen<port+100);}finally{await close(occupied);}
});
