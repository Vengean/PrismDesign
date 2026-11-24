import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Duplex,PassThrough} from 'node:stream';
import {createProjectAuthService} from '../src/services/project-auth.js';
import {projectAuthVolume} from '../src/services/project-auth-storage.js';
import {emptyConfig,type ProjectConfig} from '../src/services/projects.js';

class Socket extends EventEmitter{
 readyState=1;bufferedAmount=0;messages:any[]=[];
 send(value:string){this.messages.push(JSON.parse(value));}
 close(){if(this.readyState===3)return;this.readyState=3;queueMicrotask(()=>this.emit('close'));}
}
function fixture(){
 let provider='codex',permission='admin',running=false,logged=false,configVersion=0,removalDelay=0,resizeFailure=false;
 const volumes=new Set<string>(),specs:any[]=[],removed:string[]=[],inputs:string[]=[],resizes:any[]=[];
 let terminal:Duplex;
 const containers=new Map<string,any>();
 const engine:any={
  getContainer:(id:string)=>containers.get(id),
  createVolume:async(spec:any)=>{volumes.add(spec.Name);return {};},
  getVolume:(name:string)=>({inspect:async()=>{if(!volumes.has(name))throw {statusCode:404};return {};}}),
  createContainer:async(spec:any)=>{
   specs.push(spec);
   const container={id:spec.name,start:async()=>{},remove:async()=>{if(removalDelay)await new Promise(resolve=>setTimeout(resolve,removalDelay));removed.push(spec.name);containers.delete(spec.name);terminal?.destroy();},exec:async(options:any)=>{
    const login=options.Cmd.includes('--device-auth')||options.Cmd.includes('--setup')||options.Cmd.join(' ')==='claude auth login';
    if(login){terminal=new Duplex({read(){},write(chunk,_encoding,callback){inputs.push(String(chunk));callback();}});
     return {start:async()=>terminal,inspect:async()=>({ExitCode:0}),resize:async(size:any)=>{if(resizeFailure)throw Error('PTY is starting');resizes.push(size);}};
    }
    if(options.Cmd.includes('logout')||options.Cmd.some((v:string)=>v.includes('rmSync')))logged=false;
    const status=options.Cmd.includes('status')||options.Cmd.some((v:string)=>v.includes('credentials.json'));
    return {start:async()=>{const stream=new PassThrough();queueMicrotask(()=>stream.end());return stream;},inspect:async()=>({ExitCode:status&&!logged?1:0})};
   }};
   containers.set(spec.name,container);return container;
  },
 };
 const service=createProjectAuthService({engine:()=>engine,config:async()=>({...emptyConfig,model:{provider,authMode:'subscription',baseUrl:'',model:'',proxyUrl:configVersion?'http://changed:7890':'http://proxy:7890'}} as ProjectConfig),role:async()=>permission,userExists:async()=>true,active:async()=>running});
 return {service,volumes,specs,removed,inputs,resizes,terminal:()=>terminal!,setProvider:(p:string)=>{provider=p;},revoke:()=>{permission='editor';},setRunning:()=>{running=true;},setLogged:()=>{logged=true;},changeConfig:()=>{configVersion++;},slowRemoval:()=>{removalDelay=60;},failResize:()=>{resizeFailure=true;}};
}
const turn=()=>new Promise(resolve=>setTimeout(resolve,10));

test('project login uses an isolated helper and one shared volume with provider directories',async()=>{
 const f=fixture();try{
  assert.equal((await f.service.status('p','owner')).status,'not_logged_in');assert.equal(f.specs.length,0);
  for(const provider of ['codex','claude','glm']){
   f.setProvider(provider);const session=await f.service.start('p','owner');
   assert.equal(session.provider,provider);assert.equal(session.ticket.length,64);
   const spec=f.specs.at(-1);assert.deepEqual(spec.HostConfig.Binds,[`${projectAuthVolume('p')}:/project-auth`]);
   assert.ok(spec.Env.includes('HTTPS_PROXY=http://proxy:7890'));assert.equal(spec.User,'prism');assert.equal(spec.HostConfig.LogConfig.Type,'none');
   assert.ok(!spec.HostConfig.Binds.some((value:string)=>value.endsWith(':/workspace')));
   assert.equal((await f.service.status('p','owner')).status,'logging_in');
   await assert.rejects(f.service.start('p','owner'),/正在进行/);
   await f.service.stop('p',session.id,'owner');assert.equal(f.service.isBusy('p'),false);
  }
  assert.equal(f.volumes.size,1);assert.equal(f.removed.length,3);
 }finally{await f.service.closeAll();}
});
test('unauthorized users and projects with active tasks cannot alter subscription credentials',async()=>{
 const f=fixture();f.revoke();await assert.rejects(f.service.start('p','editor'),/管理员/);await assert.rejects(f.service.status('p','editor'),/管理员/);assert.equal(f.specs.length,0);
 const active=fixture();active.setRunning();await assert.rejects(active.service.start('p','owner'),/未结束/);await assert.rejects(active.service.logout('p','owner'),/未结束/);assert.equal(active.service.isBusy('p'),false);
});
test('terminal tickets are single-use and scoped to a project; tty input, resize and successful cleanup work',async()=>{
 const f=fixture();try{
  const session=await f.service.start('p','owner');
  await assert.rejects(f.service.attach('other',session.id,session.ticket,new Socket() as any),/过期/);
  const ws=new Socket();await f.service.attach('p',session.id,session.ticket,ws as any);
  await assert.rejects(f.service.attach('p',session.id,session.ticket,new Socket() as any),/过期/);
  ws.emit('message',JSON.stringify({type:'input',data:'fixture-input\r'}));
  ws.emit('message',JSON.stringify({type:'resize',cols:120,rows:32}));await turn();
  assert.deepEqual(f.inputs,['fixture-input\r']);assert.deepEqual(f.resizes,[{w:120,h:32}]);
  const output=Buffer.from('授权 https://chatgpt.com/device\r\n');f.terminal().push(output.subarray(0,2));f.terminal().push(output.subarray(2));
  f.setLogged();f.terminal().push(null);await turn();
  assert.equal(ws.messages.filter(m=>m.type==='output').map(m=>m.data).join(''),'授权 https://chatgpt.com/device\r\n');
  assert.equal(ws.messages.find(m=>m.type==='exit')?.success,true);assert.equal(f.service.isBusy('p'),false);
  assert.ok(f.volumes.has(projectAuthVolume('p')));assert.equal((await f.service.status('p','owner')).status,'logged_in');
 }finally{await f.service.closeAll();}
});
test('disconnects terminate helpers but retain project authorization; revoked permissions reject input',async()=>{
 const f=fixture();try{
  const session=await f.service.start('p','owner'),ws=new Socket();await f.service.attach('p',session.id,session.ticket,ws as any);
  f.revoke();ws.emit('message',JSON.stringify({type:'input',data:'must-not-execute'}));await turn();
  assert.deepEqual(f.inputs,[]);assert.equal(f.service.isBusy('p'),false);assert.ok(f.volumes.has(projectAuthVolume('p')));
 }finally{await f.service.closeAll();}
 const other=fixture();const session=await other.service.start('p','owner'),ws=new Socket();await other.service.attach('p',session.id,session.ticket,ws as any);ws.close();await turn();assert.equal(other.service.isBusy('p'),false);await other.service.closeAll();
});
test('configuration changes invalidate terminal tickets and logout retains the shared volume',async()=>{
 const f=fixture();const session=await f.service.start('p','owner');f.changeConfig();
 await assert.rejects(f.service.attach('p',session.id,session.ticket,new Socket() as any),/已更改/);assert.equal(f.service.isBusy('p'),false);
 f.setLogged();assert.equal((await f.service.logout('p','owner')).status,'not_logged_in');assert.ok(f.volumes.has(projectAuthVolume('p')));await f.service.closeAll();
});
test('early PTY resize failures do not terminate login or reject later input',async()=>{
 const f=fixture();try{
  const session=await f.service.start('p','owner'),ws=new Socket();await f.service.attach('p',session.id,session.ticket,ws as any);
  f.failResize();ws.emit('message',JSON.stringify({type:'resize',cols:120,rows:40}));ws.emit('message',JSON.stringify({type:'input',data:'ok\r'}));await turn();
  assert.deepEqual(f.inputs,['ok\r']);assert.equal(f.service.isBusy('p'),true);assert.ok(!ws.messages.some(message=>message.type==='error'));
 }finally{await f.service.closeAll();}
});
test('logout waits for a completed terminal helper to finish cleanup',async()=>{
 const f=fixture();try{
  const session=await f.service.start('p','owner'),ws=new Socket();await f.service.attach('p',session.id,session.ticket,ws as any);
  f.setLogged();f.slowRemoval();f.terminal().push(null);await turn();
  assert.equal((await f.service.logout('p','owner')).status,'not_logged_in');assert.equal(f.service.isBusy('p'),false);assert.equal(f.removed.length,2);
 }finally{await f.service.closeAll();}
});
