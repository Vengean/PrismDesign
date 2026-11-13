import {AsyncLocalStorage} from 'node:async_hooks';
import SQLite from 'better-sqlite3';
import mysql,{type Pool,type PoolConnection} from 'mysql2/promise';

export interface MysqlConfig {host:string;port:number;user:string;password:string;database:string}
export function mysqlConfig():MysqlConfig{
 const host=process.env.DB_HOST||'127.0.0.1',port=Number(process.env.DB_PORT||3306),user=process.env.DB_USER||'prism',database=process.env.DB_NAME||'prism_sit',password=process.env.DB_PASSWORD;
 if(!password)throw Error('SIT 模式需要在 .env.sit.local 配置 DB_PASSWORD');
 if(!Number.isInteger(port)||port<1||port>65535||!/^[a-zA-Z0-9_]+$/.test(database))throw Error('MySQL 连接配置无效');
 return {host,port,user,password,database};
}
// Runtime SQL is shared; schema evolution is explicit per dialect. Values remain
// parameters and are never passed through the SQL rewriting step.
export function mysqlSql(sql:string){
 if(sql.includes('sqlite_master'))return sql.replace(/SELECT 1 FROM sqlite_master WHERE type='table' AND name=/g,'SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=');
 if(sql.includes('json_each('))return `SELECT 1 FROM conversation_messages m JOIN JSON_TABLE(CASE WHEN JSON_VALID(m.client_context) THEN m.client_context ELSE '{}' END,'$.attachments[*]' COLUMNS(attachment_id VARCHAR(191) PATH '$.id')) a ON TRUE WHERE m.session_id=? AND a.attachment_id=? LIMIT 1`;
 return sql.replace(/datetime\('now'\)/g,'CURRENT_TIMESTAMP').replace(/char\(10\)/g,'CHAR(10)').replace(/body \|\| CHAR\(10\) \|\| CHAR\(10\) \|\| \?/g,"CONCAT(body,CHAR(10),CHAR(10),?)")
  .replace(/\browid DESC/g,'seq DESC').replace(/\bMAX\(read_cursor,/g,'GREATEST(read_cursor,')
  .replace(/\bid IS NOT \?/g,'NOT(id <=> ?)')
  .replace(/json_extract\((\w+\.\w+),'([^']+)'\)/g,"JSON_UNQUOTE(JSON_EXTRACT($1,'$2'))")
  .replace(/ON CONFLICT\([^)]+\) DO UPDATE SET /g,'ON DUPLICATE KEY UPDATE ').replace(/excluded\.(\w+)/g,'VALUES($1)')
  .replace(/INSERT OR IGNORE INTO conversation_agent_state\(session_id\) VALUES\(\?\)/g,'INSERT INTO conversation_agent_state(session_id) VALUES(?) ON DUPLICATE KEY UPDATE session_id=session_id');
}
interface Context {connection?:PoolConnection;initializing?:boolean;transaction?:boolean;onCommit?:(()=>void)[]}
export class PlatformDatabase {
 readonly dialect:'sqlite'|'mysql';
 private sqlite?:SQLite.Database;private pool?:Pool;private context=new AsyncLocalStorage<Context>();
 private initialized?:Promise<void>;private tail=Promise.resolve();private initialize:(db:PlatformDatabase)=>Promise<void>;
 constructor(options:{sqlite?:string;mysql?:MysqlConfig;initialize?:(db:PlatformDatabase)=>Promise<void>}){
  this.dialect=options.mysql?'mysql':'sqlite';this.initialize=options.initialize|| (async()=>{});
  if(options.mysql){this.pool=mysql.createPool({...options.mysql,connectionLimit:10,waitForConnections:true,charset:'utf8mb4_bin',timezone:'Z',dateStrings:true,multipleStatements:false});this.pool.on('connection',connection=>{connection.query("SET time_zone = '+00:00'");});}
  else{this.sqlite=new SQLite(options.sqlite!);this.sqlite.pragma('journal_mode = WAL');this.sqlite.pragma('foreign_keys = ON');this.sqlite.pragma('secure_delete = ON');}
 }
 ready(){if(this.context.getStore()?.initializing)return Promise.resolve();return this.initialized??=this.context.run({initializing:true},()=>this.initialize(this));}
 private async exclusive<T>(work:()=>T|Promise<T>):Promise<T>{
  const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(resolve=>{release=resolve;});await previous;try{return await work();}finally{release();}
 }
 private async operation<T>(work:()=>T|Promise<T>):Promise<T>{await this.ready();return this.sqlite&&!this.context.getStore()?this.exclusive(work):work();}
 prepare(sql:string){return {
  all:(...params:unknown[])=>this.rows(sql,params),
  get:async(...params:unknown[])=>(await this.rows(sql,params))[0],
  run:async(...params:unknown[])=>this.operation(async()=>{
   if(this.sqlite)return this.sqlite.prepare(sql).run(...params);
   const [result]=await (this.context.getStore()?.connection||this.pool!).query(mysqlSql(sql),params) as any;
   return {changes:result.affectedRows,lastInsertRowid:result.insertId};
  }),
 };}
 private rows(sql:string,params:unknown[]):Promise<any[]>{return this.operation(async()=>{
  if(this.sqlite)return this.sqlite.prepare(sql).all(...params);
  const [rows]=await (this.context.getStore()?.connection||this.pool!).query(mysqlSql(sql),params);return rows as any[];
 });}
 exec(sql:string){return this.operation(async()=>{if(this.sqlite){this.sqlite.exec(sql);return;}for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await (this.context.getStore()?.connection||this.pool!).query(mysqlSql(statement));});}
 pragma(sql:string){return this.operation(()=>{if(!this.sqlite)throw Error('PRAGMA only supports SQLite');return this.sqlite.pragma(sql) as any;});}
 afterCommit(callback:()=>void){const callbacks=this.context.getStore()?.onCommit;if(callbacks)callbacks.push(callback);else callback();}
 transaction<T>(work:()=>T|Promise<T>){return async():Promise<T>=>{
  await this.ready();if(this.context.getStore()?.transaction||this.context.getStore()?.connection)return work();
  const onCommit:(()=>void)[]=[];let result:T;
  if(this.sqlite){result=await this.exclusive(()=>this.context.run({...this.context.getStore(),transaction:true,onCommit},async()=>{
   this.sqlite!.exec('BEGIN IMMEDIATE');try{const value=await work();this.sqlite!.exec('COMMIT');return value;}catch(error){this.sqlite!.exec('ROLLBACK');throw error;}
  }));}else{
   const connection=await this.pool!.getConnection();
   try{await connection.beginTransaction();result=await this.context.run({connection,onCommit},work);await connection.commit();}catch(error){await connection.rollback();throw error;}finally{connection.release();}
  }
  for(const notify of onCommit)queueMicrotask(notify);return result;
 };}
 async close(){try{await this.initialized;await this.tail;}finally{this.sqlite?.close();await this.pool?.end();}}
}
