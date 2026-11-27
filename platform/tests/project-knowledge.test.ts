import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {knowledgeFiles,validKnowledge,writeKnowledgeProgram,prepareProjectKnowledge} from '../src/services/project-knowledge.js';
import {projectMcpServers,projectKnowledgeContext,sdkMcpServer} from '../../packages/agent/src/project-context.js';
test('shared knowledge validates paths, renders README and skills without overwriting repositories',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-knowledge-'));
 const knowledge={documents:[{path:'architecture.md',content:'Architecture'}],skills:[{name:'demo',content:'Demo steps'}],mcpServers:{dataforge:{command:'node',args:['service.js']}}};
 try{
  assert.ok(validKnowledge(knowledge));assert.ok(!validKnowledge({...knowledge,documents:[{path:'../auth.json',content:'x'}]}));assert.ok(!validKnowledge({...knowledge,skills:[...knowledge.skills,...knowledge.skills]}));
  const files=knowledgeFiles('Project guidance',knowledge);
  assert.equal(JSON.parse(files['mcp.json']).mcpServers.dataforge.command,'node');assert.equal(files['README.md'],'Project guidance');assert.equal(files['skills/demo/SKILL.md'],'Demo steps');
  const program=writeKnowledgeProgram.replace("root='/project-global'",'root='+JSON.stringify(root));
  for(let i=0;i<2;i++)execFileSync('node',['-e',program,JSON.stringify(files)]);
  assert.equal(fs.readFileSync(path.join(root,'current/README.md'),'utf8'),'Project guidance');assert.equal(fs.readdirSync(root).filter(x=>x.startsWith('version-')).length,1);
  const original=process.env.PRISM_PROJECT_GLOBAL;try{process.env.PRISM_PROJECT_GLOBAL=path.join(root,'current');assert.match(projectKnowledgeContext(),/skills\/demo\/SKILL.md/);}finally{if(original===undefined)delete process.env.PRISM_PROJECT_GLOBAL;else process.env.PRISM_PROJECT_GLOBAL=original;}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('project global MCP loads stdio and HTTP without overwriting local names',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-global-mcp-'));
 const keys=['PRISM_PROJECT_GLOBAL','PRISM_PLATFORM_TOOLS','PRISM_PERMISSION_MCP'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  const mcpServers={local:{command:'node',args:['server.js']},remote:{type:'http',url:'https://service.example/mcp',headers:{Authorization:'Bearer fixture'}}};
  fs.writeFileSync(path.join(root,'mcp.json'),JSON.stringify({mcpServers}));process.env.PRISM_PROJECT_GLOBAL=root;process.env.PRISM_PLATFORM_TOOLS='true';delete process.env.PRISM_PERMISSION_MCP;
  const servers=projectMcpServers();assert.equal((servers.project_local as any).command,'node');assert.equal((servers.project_remote as any).url,'https://service.example/mcp');assert.ok(servers.prism_project);assert.equal(servers.local,undefined);
  assert.ok(validKnowledge({documents:[],skills:[],mcpServers}));assert.ok(!validKnowledge({documents:[],skills:[],mcpServers:{bad:{type:'http',url:'file:///private'}}}));
  process.env.PRISM_PERMISSION_MCP='false';assert.equal(projectMcpServers().project_remote,undefined);assert.ok(projectMcpServers().prism_project);
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});}
});
test('knowledge writer helper has no source or auth mounts and always cleans up',async()=>{
 let spec:any,removed=false;
 const engine={async createVolume(){},async createContainer(value:unknown){spec=value;return {async start(){},async wait(){return {StatusCode:0};},async remove(){removed=true;}};}};
 const name=await prepareProjectKnowledge(engine as any,'fixture','Guidance');assert.ok(name.endsWith('-knowledge'));assert.deepEqual(spec.HostConfig.Binds,[name+':/project-global']);assert.equal(spec.HostConfig.NetworkMode,'none');assert.equal(removed,true);
});
test('optional repository MCP configuration loads alongside shared services and explicit project overrides',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-repository-mcp-'));
 const keys=['PRISM_PROJECT_GLOBAL','PRISM_PLATFORM_TOOLS','PRISM_PERMISSION_MCP','PRISM_MCP_SERVERS'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const key of keys)delete process.env[key];
  assert.deepEqual(projectMcpServers(root),{});
  fs.mkdirSync(path.join(root,'.global'));
  fs.writeFileSync(path.join(root,'.global/mcp.json'),JSON.stringify({mcpServers:{source:{command:'node',args:['shared.js']}}}));process.env.PRISM_PROJECT_GLOBAL=path.join(root,'.global');
  fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{source:{type:'http',url:'https://repo.example/mcp',headers:{Authorization:'Bearer fixture'},defaultToolsApprovalMode:'approve'}}}));
  let servers=projectMcpServers(root);assert.equal((servers.project_source as any).command,'node');assert.equal((servers.source as any).url,'https://repo.example/mcp');
  assert.deepEqual(sdkMcpServer(servers.source),{type:'http',url:'https://repo.example/mcp',headers:{Authorization:'Bearer fixture'}});
  process.env.PRISM_MCP_SERVERS=JSON.stringify({source:{command:'node',args:['override.js']}});servers=projectMcpServers(root);assert.deepEqual((servers.source as any).args,['override.js']);
  delete process.env.PRISM_MCP_SERVERS;
  fs.writeFileSync(path.join(root,'.mcp.json'),JSON.stringify({mcpServers:{source:{type:'http',url:'https://repo.example/mcp',headers:{Authorization:'secret\r\ninvalid'}}}}));
  assert.throws(()=>projectMcpServers(root),error=>error instanceof Error&&!error.message.includes('secret')&&/请求头/.test(error.message));
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(root,{recursive:true,force:true});}
});
