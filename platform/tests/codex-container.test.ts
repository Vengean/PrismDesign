import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-codex-container-'));
process.env.PRISM_DATA_DIR=path.join(root,'data');
process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture';
process.env.CONTAINER_SOCKET=path.join(root,'docker.sock');
delete process.env.PRISM_MODE;
const {getDb}=await import('../src/services/db.js');
const {initProjectTables,createProject,emptyConfig}=await import('../src/services/projects.js');
const {initRuntimeTables,startRuntime,removeWorkspaceResources,workspaceSecurityOptions}=await import('../src/services/requirement-runtime.js');
await initProjectTables();await initRuntimeTables();

// Exercise the production container creation path against a Docker-compatible
// endpoint, without running a model or using the developer's container engine.
const specifications:any[]=[],volumes=new Set<string>(),containers=new Set<string>();
let containerDeletes=0;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url!,'http://docker'),route=url.pathname.replace(/^\/v[\d.]+/,'');
 let body='';for await(const chunk of req)body+=chunk;
 const reply=(status:number,value:unknown={})=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(route==='/volumes/create'){
  const spec=JSON.parse(body);volumes.add(spec.Name);reply(201,{Name:spec.Name});return;
 }
 if(route==='/containers/create'){
  const name=url.searchParams.get('name')!;containers.add(name);
  specifications.push({name,...JSON.parse(body)});reply(201,{Id:name,Warnings:[]});return;
 }
 const container=route.match(/^\/containers\/([^/]+)\/(json|start|stop|wait)$/);
 if(container){
  if(!containers.has(container[1])){reply(404,{message:'missing'});return;}
  if(container[2]==='json')reply(200,{State:{Running:true}});else if(container[2]==='wait')reply(200,{StatusCode:0});else{res.writeHead(204);res.end();}return;
 }
 const name=route.match(/^\/containers\/([^/]+)$/)?.[1];
 if(req.method==='DELETE'&&name){containers.delete(name);if(specifications.find(s=>s.name===name)?.Entrypoint?.[0]==='/project-entrypoint.sh')containerDeletes++;res.writeHead(204);res.end();return;}
 const volume=route.match(/^\/volumes\/([^/]+)$/)?.[1];
 if(req.method==='DELETE'&&volume){volumes.delete(volume);res.writeHead(204);res.end();return;}
 reply(500,{message:`Unexpected Docker request: ${req.method} ${route}`});
});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(process.env.CONTAINER_SOCKET,resolve);});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await getDb().close();fs.rmSync(root,{recursive:true,force:true});});

test('requirements share their project auth volume and deleting one preserves the shared login',async()=>{
 process.env.PRISM_CODEX_SELINUX_TYPE='prism_codex.process';
 const project=await createProject('Codex fixture','','owner',[],{
  ...emptyConfig,repos:[{name:'app',url:'https://git.example.com/app.git',branch:'main'}],
  gitAuth:{mode:'token',sshPort:22,token:'fixture-git-token'},startupScript:'sleep infinity',
  model:{provider:'codex',authMode:'subscription',baseUrl:'',model:'',proxyUrl:'http://proxy.example.com:7890'},
 });
 const first=crypto.randomUUID(),second=crypto.randomUUID();
 for(const id of [first,second])await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');
 await startRuntime(first);await startRuntime(first);await startRuntime(second);
 assert.equal(containerDeletes,1);
 const runtimes=specifications.filter(s=>s.Entrypoint?.[0]==='/project-entrypoint.sh');assert.equal(runtimes.length,3);
 const [initial,recreated,other]=runtimes;
 assert.deepEqual(initial.HostConfig.SecurityOpt,['no-new-privileges','label=type:prism_codex.process']);
 assert.deepEqual(initial.HostConfig.CapDrop,['ALL']);
 assert.deepEqual(initial.HostConfig.Binds,recreated.HostConfig.Binds);
 const authBind=initial.HostConfig.Binds.find((bind:string)=>bind.endsWith(':/project-auth'));
 assert.ok(authBind);assert.ok(!authBind.endsWith(':/workspace'));
 assert.ok(other.HostConfig.Binds.includes(authBind));
 assert.notEqual(initial.HostConfig.Binds[0],other.HostConfig.Binds[0]);
 assert.ok(volumes.has(authBind.split(':')[0]));
 assert.ok(initial.Env.includes('CODEX_HOME=/project-auth/codex'));
 assert.ok(initial.Env.includes('CODEX_AUTH_MODE=subscription'));
 assert.ok(initial.Env.includes('PRISM_PERMISSION_MCP=true'));
 assert.ok(initial.Env.includes('PRISM_RUNTIME_CONTAINER=true'));
 assert.ok(initial.Env.includes('PRISM_PERMISSION_NETWORK=true'));
 assert.ok(initial.Env.includes('PRISM_PROJECT_GLOBAL=/workspace/.global/current'));
 assert.ok(!initial.Env.some((v:string)=>v.startsWith('PRISM_MCP_CONFIGURATION=')));
 assert.ok(initial.Env.includes('PRISM_MODEL_PROXY_URL=http://proxy.example.com:7890'));
 assert.ok(!initial.Env.some((value:string)=>/^(https?_proxy|HTTPS?_PROXY)=/.test(value)));
 assert.ok(!initial.Env.some((value:string)=>value.startsWith('CODEX_API_KEY=')||value.startsWith('ANTHROPIC_API_KEY=')));
 await removeWorkspaceResources(first);
 assert.ok(volumes.has(authBind.split(':')[0]));
 for(const bind of other.HostConfig.Binds)assert.ok(volumes.has(bind.split(':')[0]));
});

test('Claude subscription persists its login directory and launches the subscription provider',async()=>{
 const project=await createProject('Claude fixture','','owner',[],{
  ...emptyConfig,repos:[{name:'app',url:'https://git.example.com/app.git',branch:'main'}],
  gitAuth:{mode:'token',sshPort:22,token:'fixture-git-token'},startupScript:'sleep infinity',
  model:{provider:'claude',authMode:'subscription',baseUrl:'',model:''},
 });
 const id=crypto.randomUUID(),offset=specifications.length;
 await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');
 await startRuntime(id);await startRuntime(id);
 const [first,second]=specifications.slice(offset).filter(s=>s.Entrypoint?.[0]==='/project-entrypoint.sh');
 assert.deepEqual(first.HostConfig.SecurityOpt,['no-new-privileges']);
 assert.deepEqual(first.HostConfig.Binds,second.HostConfig.Binds);
 const bind=first.HostConfig.Binds.find((value:string)=>value.endsWith(':/project-auth'));
 assert.ok(bind);assert.ok(volumes.has(bind.split(':')[0]));
 assert.ok(first.Env.includes('PRISM_AGENT_PROVIDER=claude-sub'));
 assert.ok(first.Env.includes('CLAUDE_CONFIG_DIR=/project-auth/claude'));
 assert.ok(!first.Env.some((value:string)=>value.startsWith('ANTHROPIC_API_KEY=')||value.startsWith('ANTHROPIC_BASE_URL=')));
 await removeWorkspaceResources(id);assert.ok(volumes.has(bind.split(':')[0]));
});

test('Codex SELinux selection is opt-in and rejects malformed types',()=>{
 const previous=process.env.PRISM_CODEX_SELINUX_TYPE;
 try{
  delete process.env.PRISM_CODEX_SELINUX_TYPE;
  assert.deepEqual(workspaceSecurityOptions('codex'),['no-new-privileges']);
  process.env.PRISM_CODEX_SELINUX_TYPE='prism_codex.process,disable';
  assert.throws(()=>workspaceSecurityOptions('codex'),/无效/);
  assert.deepEqual(workspaceSecurityOptions('claude'),['no-new-privileges']);
 }finally{if(previous===undefined)delete process.env.PRISM_CODEX_SELINUX_TYPE;else process.env.PRISM_CODEX_SELINUX_TYPE=previous;}
});
test('requirements mount shared knowledge read-only separately from credentials and preserve repository guidance',async()=>{
 const project=await createProject('Knowledge fixture','','owner',[],{
  ...emptyConfig,repos:[{name:'app',url:'https://git.example.com/app.git',branch:'main'}],gitAuth:{mode:'token',sshPort:22,token:'fixture'},startupScript:'sleep infinity',guidance:'Shared project overview',
  model:{provider:'codex',authMode:'subscription',baseUrl:'',model:''},knowledge:{documents:[],skills:[],mcpServers:{dataforge:{command:'node',args:['server.js']}}},
 });
 const id=crypto.randomUUID(),offset=specifications.length;await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');
 await startRuntime(id);const [helper,runtime]=specifications.slice(offset);
 assert.ok(helper.HostConfig.Binds[0].endsWith('-knowledge:/project-global'));assert.equal(helper.HostConfig.Binds.length,1);
 assert.ok(runtime.HostConfig.Binds.some((bind:string)=>bind.endsWith('-knowledge:/workspace/.global:ro')));
 assert.ok(runtime.HostConfig.Binds.some((bind:string)=>bind.endsWith('-auth:/project-auth')));
 assert.ok(runtime.Env.includes('PRISM_PROJECT_GLOBAL=/workspace/.global/current'));assert.ok(runtime.Env.includes('PRISM_PLATFORM_TOOLS=true'));assert.ok(!runtime.Env.some((env:string)=>env.startsWith('CLAUDE_MD=')));
});
