import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PlatformDatabase,mysqlConfig,mysqlSql} from '../src/services/database.js';
import {runtimeResourceNames} from '../src/services/runtime-identity.js';
import {copySqliteToMysql} from '../src/services/sit-migration.js';

test('SIT resource names cannot overlap development containers or volumes',()=>{
 const before=process.env.PRISM_MODE;try{
  delete process.env.PRISM_MODE;assert.deepEqual(runtimeResourceNames('id'),{container:'prism-req-id',volume:'prism-req-code-id'});
  process.env.PRISM_MODE='sit';assert.deepEqual(runtimeResourceNames('id'),{container:'prism-sit-req-id',volume:'prism-sit-req-code-id'});
 }finally{if(before===undefined)delete process.env.PRISM_MODE;else process.env.PRISM_MODE=before;}
});
test('SQL dialect adaptation handles null-safe comparisons, upserts and JSON text',()=>{
 assert.match(mysqlSql('DELETE FROM project_model_credentials WHERE project_id=? AND id IS NOT ?'),/NOT\(id <=> \?\)/);
 assert.match(mysqlSql('UPDATE conversation_agent_state SET read_cursor=MAX(read_cursor,?)'),/GREATEST/);
 assert.match(mysqlSql("SELECT json_extract(c.config,'$.model.provider') FROM project_configs c"),/JSON_UNQUOTE/);
 assert.match(mysqlSql('INSERT INTO project_members(project_id,user_id,role) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role'),/ON DUPLICATE KEY UPDATE role=VALUES\(role\)/);
});
test('SQLite async transactions rollback and publish notifications only after commit',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prism-sqlite-async-')),db=new PlatformDatabase({sqlite:path.join(dir,'db')});
 try{
  await db.exec('CREATE TABLE example(id INTEGER PRIMARY KEY)');let notified=false;
  await assert.rejects(db.transaction(async()=>{await db.prepare('INSERT INTO example VALUES(?)').run(1);db.afterCommit(()=>{notified=true;});throw Error('rollback');})(),/rollback/);
  assert.deepEqual(await db.prepare('SELECT * FROM example').all(),[]);assert.equal(notified,false);
  await db.transaction(async()=>{await db.prepare('INSERT INTO example VALUES(?)').run(2);db.afterCommit(()=>{notified=true;});assert.equal(notified,false);})();
  await Promise.resolve();assert.equal(notified,true);assert.equal((await db.prepare('SELECT * FROM example').all()).length,1);
 }finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('real MySQL: SQLite copy preserves identity, passwords, Unicode and keys without mutating DEV',{skip:process.env.PRISM_TEST_MYSQL!=='1'},async()=>{
 const config=mysqlConfig();assert.match(config.database,/_migration_check$/,'Use a dedicated empty test database');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prism-mysql-copy-')),sourceDir=path.join(dir,'dev'),targetDir=path.join(dir,'sit');
 const program=`import {getDb} from './src/services/db.ts';import {initProjectTables,createProject,emptyConfig} from './src/services/projects.ts';import {initConversationTables,createConversationService} from './src/services/conversations.ts';await initProjectTables();await initConversationTables();const project=await createProject('测试项目😀','','owner',[],{...emptyConfig,model:{provider:'claude',baseUrl:'https://example.test',model:'fixture',apiKey:'fixture-secret'}});await getDb().prepare('INSERT INTO requirements(id,project_id,title,description,acceptance,created_by,environment_status) VALUES(?,?,?,?,?,?,?)').run('requirement',project,'测试','','','owner','running');await getDb().prepare('INSERT INTO project_sessions(id,requirement_id) VALUES(?,?)').run('session','requirement');const service=createConversationService({async run(_id,input,emit){emit({type:'bridge.result',data:{success:true,message:'完成😀'}});},async cancel(){}});const post=await service.submit('requirement','owner','消息😀','migration-message');await service.wait(post.id);service.close();await getDb().close();`;
 const created=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',program],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',env:{...process.env,PRISM_MODE:'dev',PRISM_DATA_DIR:sourceDir,ADMIN_USER:'owner',ADMIN_PASSWORD:'fixture-password'}});
 assert.equal(created.status,0,created.stderr);
 const before=fs.readFileSync(path.join(sourceDir,'platform.db')),key=fs.readFileSync(path.join(sourceDir,'credentials.key'));
 const connection=new PlatformDatabase({mysql:config});
 try{
  const result=await copySqliteToMysql({sourcePath:path.join(sourceDir,'platform.db'),backupDir:path.join(dir,'backups'),targetDir,connection:config});
  assert.ok(fs.existsSync(result.backup));assert.deepEqual(fs.readFileSync(path.join(sourceDir,'platform.db')),before);assert.deepEqual(fs.readFileSync(path.join(targetDir,'credentials.key')),key);
  const user=await connection.prepare("SELECT * FROM users WHERE id='owner'").get();assert.ok(user.password_hash.startsWith('$2'));
  assert.equal((await connection.prepare('SELECT * FROM projects').get()).name,'测试项目😀');
  assert.equal((await connection.prepare("SELECT * FROM requirements WHERE id='requirement'").get()).environment_status,'pending');
  const messages=await connection.prepare('SELECT * FROM conversation_messages ORDER BY seq').all();assert.deepEqual(messages.map(row=>row.body),['消息😀','完成😀']);assert.equal(messages[0].seq,1);assert.equal(messages[1].seq,2);
  const credential=await connection.prepare('SELECT * FROM project_model_credentials').get(),data=Buffer.from(credential.encrypted_value,'base64');const decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));decipher.setAAD(Buffer.from(`${credential.project_id}:model:${credential.id}`));decipher.setAuthTag(data.subarray(12,28));assert.equal(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString(),'fixture-secret');
  await assert.rejects(copySqliteToMysql({sourcePath:path.join(sourceDir,'platform.db'),backupDir:path.join(dir,'backups'),targetDir,connection:config}),/已有数据/);
  assert.equal((await connection.prepare('SELECT COUNT(*) AS n FROM conversation_messages').get()).n,2);
  await assert.rejects(connection.transaction(async()=>{await connection.prepare("INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,status) VALUES('lock1','requirement','session','owner','lock-request-1','running')").run();await connection.prepare("INSERT INTO conversation_runs(id,requirement_id,session_id,user_id,request_id,status) VALUES('lock2','requirement','session','owner','lock-request-2','queued')").run();})(),{code:'ER_DUP_ENTRY'});
  assert.equal((await connection.prepare("SELECT COUNT(*) AS n FROM conversation_runs WHERE id IN ('lock1','lock2')").get()).n,0);
 }finally{await connection.close();fs.rmSync(dir,{recursive:true,force:true});}
});
