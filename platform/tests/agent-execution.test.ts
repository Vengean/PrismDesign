import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executionPolicy} from '../../packages/agent/src/execution-policy.js';
import {runWithConfigurationRefresh,configurationFingerprint} from '../../packages/agent/src/runtime-configuration.js';
import {CodexProvider} from '../../packages/agent/src/providers/codex-provider.js';
import {applyConfigToEnv} from '../../packages/agent/src/config.js';
import type {AgentProvider} from '../../packages/agent/src/core/types.js';

async function workspace(run:(root:string)=>void|Promise<void>){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'prism-execution-')));try{await run(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('container permissions grant native configuration writes and network while retaining workspace sandbox',async()=>workspace(root=>{
 const env={PRISM_RUNTIME_CONTAINER:'true',PRISM_PERMISSION_NETWORK:'true',PRISM_PERMISSION_FILESYSTEM:'workspace-write',PRISM_PERMISSION_COMMANDS:'workspace'};
 const options=executionPolicy(root,false,env);assert.equal(options.sandboxMode,'workspace-write');assert.equal(options.networkAccessEnabled,true);
 for(const name of ['.codex','.agents','.claude'])assert.ok(options.additionalDirectories.includes(path.join(root,name)));
 const readonly=executionPolicy(root,true,env);assert.equal(readonly.sandboxMode,'read-only');assert.equal(readonly.networkAccessEnabled,false);assert.deepEqual(readonly.additionalDirectories,[]);
 const standalone=executionPolicy(root,false,{PRISM_PERMISSION_NETWORK:'false'});assert.equal(standalone.networkAccessEnabled,false);assert.deepEqual(standalone.additionalDirectories,[]);
}));
test('project configuration cannot silently override container permission policy',()=>{
 const keys=['PRISM_RUNTIME_CONTAINER','PRISM_PERMISSION_NETWORK'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{process.env.PRISM_RUNTIME_CONTAINER='true';process.env.PRISM_PERMISSION_NETWORK='true';applyConfigToEnv({permissions:{network:false}},true);assert.equal(process.env.PRISM_PERMISSION_NETWORK,'true');delete process.env.PRISM_RUNTIME_CONTAINER;applyConfigToEnv({permissions:{network:false}},true);assert.equal(process.env.PRISM_PERMISSION_NETWORK,'false');}
 finally{for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('native config changes continue the original task, without special MCP tools or keywords',async()=>workspace(async(root)=>{
 let calls=0,refreshes=0;const events:any[]=[];
 const provider={async refreshConfiguration(){refreshes++;},async run(_client:string,_run:string,message:string,emit:Function){calls++;if(calls===1){fs.mkdirSync(path.join(root,'.codex'));fs.writeFileSync(path.join(root,'.codex/config.toml'),'[mcp_servers.example]\ncommand="node"\n');}else{assert.match(message,/取得源码并分析入口/);assert.match(message,/继续原始任务/);}emit({type:'message.delta',runId:'r',messageId:'repeat',delta:'part'});return {success:true,message:calls===1?'初始化完成':'源码已分析',filesModified:['phase'+calls]};}} as unknown as AgentProvider;
 const result=await runWithConfigurationRefresh(provider,root,'c','r','取得源码并分析入口',e=>events.push(e),new AbortController().signal);
 assert.equal(calls,2);assert.equal(refreshes,1);assert.equal(result.message,'源码已分析');assert.deepEqual(result.filesModified,['phase1','phase2']);assert.notEqual(events[0].messageId,events[1].messageId);
}));
test('business file edits do not restart the model; cancellation and readonly turns do not continue',async()=>workspace(async root=>{
 const before=configurationFingerprint(root);fs.writeFileSync(path.join(root,'app.ts'),'business');assert.equal(configurationFingerprint(root),before);
 let calls=0;const provider={async run(){calls++;fs.mkdirSync(path.join(root,'.agents/skills/example'),{recursive:true});fs.writeFileSync(path.join(root,'.agents/skills/example/SKILL.md'),String(calls));return {success:true,message:'done',filesModified:[]};}} as unknown as AgentProvider;
 await runWithConfigurationRefresh(provider,root,'c','r','read',()=>{},new AbortController().signal,{readOnly:true});assert.equal(calls,1);
 await assert.rejects(()=>runWithConfigurationRefresh(provider,root,'c','r','cancel',()=>{},AbortSignal.abort()),/abort/i);
}));
test('Codex rebuilds the native client each turn and resumes the same thread with current shared config',async()=>workspace(async root=>{
 const old=process.env.CODEX_HOME;process.env.CODEX_HOME=path.join(root,'auth');
 let clients=0;const starts:string[]=[],resumes:string[]=[];
 const thread=(id:string)=>({id,async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',id:'r',text:'done'}};})()};}});
 const provider=new CodexProvider(root,()=>{clients++;return {startThread(){starts.push('thread');return thread('thread');},resumeThread(id:string){resumes.push(id);return thread(id);}} as any;});
 try{await provider.run('c','r','first',()=>{});await provider.run('c','r2','continue',()=>{});assert.equal(clients,2);assert.equal(starts.length,1);assert.deepEqual(resumes,['thread']);}
 finally{provider.close();if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;}
}));
