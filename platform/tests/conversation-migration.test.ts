import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('legacy NOT NULL run references migrate without changing message identity, ordering, comments or replay keys',()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'prism-group-migrate-'));
 try{
 const code=`import {getDb} from './src/services/db.ts';import {initProjectTables,createProject,emptyConfig} from './src/services/projects.ts';import {initConversationTables,createConversationService,readConversation} from './src/services/conversations.ts';initProjectTables();const db=getDb();const project=createProject('Old','','owner',[],emptyConfig);db.prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by) VALUES(?,?,?,?,?,?)').run('r',project,'Old','','','owner');db.prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run('s','r');
 db.exec(\`CREATE TABLE conversation_runs(id TEXT PRIMARY KEY,requirement_id TEXT,session_id TEXT,user_id TEXT,request_id TEXT,status TEXT,error TEXT DEFAULT '',cancel_supported INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,status) VALUES('old','r','s','owner','old-request-1','succeeded');CREATE TABLE conversation_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,session_id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES conversation_runs(id),role TEXT,user_id TEXT,body TEXT,created_at TEXT DEFAULT (datetime('now')),client_context TEXT NOT NULL DEFAULT '');INSERT INTO conversation_messages(seq,id,session_id,run_id,role,user_id,body,client_context) VALUES(10,'post','s','old','user','owner','旧消息','{"text":"旧消息","comments":[]}'),(11,'answer','s','old','assistant',NULL,'旧回复','');\`);
 initConversationTables();initConversationTables();const service=createConversationService(undefined,{debounceMs:1000});const replay=service.submit('r','owner','旧消息','old-request-1',{text:'旧消息',comments:[]});const next=service.submit('r','owner','新消息','new-request-1');service.close();const value=readConversation('r');console.log(JSON.stringify({replay,next,value,nullable:db.prepare('PRAGMA table_info(conversation_messages)').all().find(c=>c.name==='run_id').notnull}));db.close();`;
 // Old context must match the normalizer's canonical encoding, including contextOrder.
 const source=code.replace('"comments":[]}', '"comments":[],"contextOrder":[]}');
 const run=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',env:{...process.env,PRISM_DATA_DIR:dir,ADMIN_USER:'owner',ADMIN_PASSWORD:'fixture-password'},timeout:10000});assert.equal(run.status,0,run.stderr);const value=JSON.parse(run.stdout.trim().split('\n').at(-1)!);assert.equal(value.nullable,0);assert.equal(value.replay.messageId,'post');assert.equal(value.replay.replayed,true);assert.equal(value.next.runId,null);assert.equal(value.value.agent_read_cursor,10);assert.deepEqual(value.value.messages.map((m:any)=>[m.id,m.seq,m.body]),[['post',10,'旧消息'],['answer',11,'旧回复'],[value.next.messageId,12,'新消息']]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
