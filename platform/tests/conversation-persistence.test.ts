import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('a fresh platform process reloads the same session and all persisted messages after interruption',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'prism-persistence-'));
 const bootstrap=`import {getDb} from './src/services/db.ts';import {initProjectTables,createProject,emptyConfig} from './src/services/projects.ts';import {initRuntimeTables} from './src/services/requirement-runtime.ts';import {initConversationTables,createConversationService,readConversation,interruptPreviousRuns} from './src/services/conversations.ts';initProjectTables();initRuntimeTables();initConversationTables();`;
 function run(source:string){const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',bootstrap+source],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',env:{...process.env,PRISM_DATA_DIR:dir,ADMIN_USER:'owner',ADMIN_PASSWORD:'fixture-password'},timeout:20000});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim().split('\n').at(-1)!);}
 try{
  const before=run(`const project=createProject('Persistence','','owner',[],{...emptyConfig});const id='persisted-requirement',session='persisted-session';getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run(id,project,'Fixture','','','owner');getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run(session,id);const service=createConversationService({async run(_id,input,emit){emit({type:'bridge.dispatch',data:{}});emit({type:'bridge.result',data:{success:true,message:'persisted answer'}});},async cancel(){}});const complete=service.submit(id,'owner','first turn','persist-request-1');await service.wait(complete.id);const pending=createConversationService({async run(_id,input,emit){emit({type:'bridge.dispatch',data:{}});await new Promise(()=>{});},async cancel(){}});pending.submit(id,'owner','second turn','persist-request-2');await new Promise(setImmediate);const value=readConversation(id);console.log(JSON.stringify({session:value.session_id,messages:value.messages}));getDb().close();`);
  const after=run(`interruptPreviousRuns();const value=readConversation('persisted-requirement');console.log(JSON.stringify(value));getDb().close();`);
  assert.equal(after.session_id,before.session);assert.equal(after.messages.length,4);assert.deepEqual(after.messages.map((m:any)=>m.id),before.messages.map((m:any)=>m.id));assert.equal(after.messages[0].body,'first turn');assert.equal(after.messages[1].body,'persisted answer');assert.equal(after.messages[2].body,'second turn');assert.match(after.messages[3].body,/中断/);assert.equal(after.active_run.status,'interrupted');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
