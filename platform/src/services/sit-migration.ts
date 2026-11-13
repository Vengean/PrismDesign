import fs from 'node:fs';
import path from 'node:path';
import SQLite from 'better-sqlite3';
import {PlatformDatabase,type MysqlConfig} from './database.js';
import {mysqlTables,initializeMysqlSchema} from './mysql-schema.js';
export async function copySqliteToMysql({sourcePath,backupDir,targetDir,connection}:{sourcePath:string;backupDir:string;targetDir:string;connection:MysqlConfig}){
 if(!fs.existsSync(sourcePath))throw Error('开发 SQLite 数据库不存在');
 fs.mkdirSync(backupDir,{recursive:true});
 const backup=path.join(backupDir,`platform-before-sit-${Date.now()}.db`);
 const source=new SQLite(sourcePath,{readonly:true});
 await source.backup(backup);source.close();
 const snapshot=new SQLite(backup,{readonly:true});
 const destination=new PlatformDatabase({mysql:connection});
 try{
  if(snapshot.pragma('integrity_check',{simple:true})!=='ok'||(snapshot.pragma('foreign_key_check') as unknown[]).length)throw Error('SQLite 备份完整性或外键检查失败，停止迁移');
  if(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='release_repositories'").get()&&snapshot.prepare('SELECT 1 FROM release_repositories LIMIT 1').get())throw Error('开发库已有实际发布分支，不能直接复制到 SIT 以免共用远端分支；请使用独立 SIT 项目和发布');
  await initializeMysqlSchema(destination);
  const importTables=[...mysqlTables.map(([name])=>name),'release_repositories','requirement_repositories','merge_requests','release_events'];
  const counts:Record<string,number>={};
  // Import only into an empty database, never merge or replace SIT data.
  for(const table of importTables){const count=await destination.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();if(count.n)throw Error(`SIT 表 ${table} 已有数据，迁移已停止；原数据未覆盖`);}
  const sqliteTables=new Set((snapshot.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row=>row.name));
  const rows=new Map<string,Record<string,any>[]>();
  for(const table of importTables){
   const values=sqliteTables.has(table)?snapshot.prepare(`SELECT * FROM ${table}${table==='conversation_runs'?' ORDER BY rowid':''}`).all() as Record<string,any>[]:[];
   if(table==='legacy_resource_cleanup'||table==='requirement_environments')rows.set(table,[]);
   else rows.set(table,values);
  }
  const active=rows.get('conversation_runs')!.filter(row=>['queued','running','cancelling','interrupted'].includes(row.status));
  // These are historical copies, never a takeover of a DEV process or lock.
  active.forEach(row=>{row.status='failed';row.error='从开发环境导入的历史任务，不会在 SIT 自动重启';});
  for(const table of ['requirements','releases'])for(const row of rows.get(table)!)row.environment_status='pending';
  for(const row of rows.get('conversation_agent_state')!){row.paused=1;row.read_cursor=rows.get('conversation_messages')!.reduce((seq,message)=>message.session_id===row.session_id&&message.role==='user'?Math.max(seq,message.seq):seq,row.read_cursor);}
  const sourceKey=path.join(path.dirname(sourcePath),'credentials.key'),targetKey=path.join(targetDir,'credentials.key');
  const hasCredentials=rows.get('project_git_credentials')!.length||rows.get('project_model_credentials')!.length;
  if(hasCredentials&&!fs.existsSync(sourceKey))throw Error('原凭证密钥 credentials.key 不存在，停止迁移');
  fs.mkdirSync(targetDir,{recursive:true});
  if(fs.existsSync(sourceKey)){
   if(fs.existsSync(targetKey)&&!fs.readFileSync(sourceKey).equals(fs.readFileSync(targetKey)))throw Error('SIT 已有不同的凭证密钥，停止迁移');
   if(!fs.existsSync(targetKey))fs.copyFileSync(sourceKey,targetKey,fs.constants.COPYFILE_EXCL);
   fs.chmodSync(targetKey,0o600);
  }
  await destination.transaction(async()=>{
   for(const table of importTables){
    const values=rows.get(table)!;
    for(const row of values){const columns=Object.keys(row);await destination.prepare(`INSERT INTO ${table} (${columns.map(c=>'`'+c+'`').join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c]));}
    counts[table]=values.length;
    const saved=await destination.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();if(saved.n!==values.length)throw Error(`表 ${table} 记录数校验失败`);
   }
  })();
  return {message:'已将开发数据复制到 SIT，SQLite 原库未改动',backup,counts,notes:'SIT 环境状态重置，历史任务暂停；workspace 源码和附件卷不共享，需在 SIT 单独启动需求环境'};
 }finally{snapshot.close();await destination.close();}
}
