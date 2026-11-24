import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-auth-http-'));
process.env.PRISM_DATA_DIR=root;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
const {getDb,createUser}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig,projectRole}=await import('../src/services/projects.js');
const {signToken}=await import('../src/middleware/auth.js');
const {projectAuthRoutes,attachProjectAuthWebSocket}=await import('../src/routes/project-auth.js');
await initProjectTables();await createUser('editor','fixture');
const project=await createProject('Fixture','','owner',[{userId:'editor',role:'editor'}],emptyConfig);
let calls=0;const ticket='a'.repeat(64);
const guard=async(id:string,user:string)=>{if(await projectRole(id,user)!=='admin')throw Error('仅项目管理员可以管理订阅登录');calls++;};
const service:any={
 status:async(id:string,user:string)=>{await guard(id,user);return {provider:'codex',status:'not_logged_in'};},
 start:async(id:string,user:string)=>{await guard(id,user);return {id:'abc-def',ticket,provider:'codex'};},
 stop:async(id:string,_session:string,user:string)=>guard(id,user),logout:async(id:string,user:string)=>guard(id,user),
 attach:async(id:string,_session:string,value:string,ws:WebSocket)=>{if(id!==project||value!==ticket)throw Error('expired');ws.send(JSON.stringify({type:'ready'}));ws.close();},
};
const app=express();app.use(express.json());app.use('/api/projects',projectAuthRoutes(service));
const server=http.createServer(app),sockets=attachProjectAuthWebSocket(server,service);
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
after(async()=>{sockets.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await getDb().close();fs.rmSync(root,{recursive:true,force:true});});
async function request(user:string|undefined,suffix:string,method='GET'){
 return fetch(`${base}/api/projects/${project}/subscription/${suffix}`,{method,headers:user?{Authorization:`Bearer ${signToken({userId:user,role:user==='owner'?'admin':'user'})}`}:{}});
}
test('subscription endpoints require authenticated project administrators and do not trust client role claims',async()=>{
 assert.equal((await request(undefined,'status')).status,401);
 for(const [suffix,method]of [['status','GET'],['sessions','POST'],['sessions/session','DELETE'],['logout','POST']])assert.equal((await request('editor',suffix,method)).status,403);
 assert.equal(calls,0);
 const response=await request('owner','status');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const opened=await(await request('owner','sessions','POST')).json();assert.equal(opened.ticket,ticket);assert.ok(!JSON.stringify(opened).includes('Bearer'));
});
async function connect(origin:string,value=ticket,projectId=project){
 const ws=new WebSocket(base.replace('http:','ws:')+`/api/projects/${projectId}/subscription/sessions/abc-def/terminal?ticket=${value}`,{origin});
 const messages:any[]=[];ws.on('message',data=>messages.push(JSON.parse(String(data))));
 await new Promise<void>(resolve=>{ws.on('close',()=>resolve());ws.on('error',()=>resolve());});return messages;
}
test('terminal WebSockets reject cross-origin requests and validate one-time session credentials',async()=>{
 assert.deepEqual(await connect('https://untrusted.example.com'),[]);
 assert.equal((await connect(base))[0].type,'ready');
 assert.equal((await connect(base,'b'.repeat(64)))[0].type,'error');
 assert.equal((await connect(base,ticket,'other'))[0].type,'error');
});
