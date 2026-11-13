import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {mysqlConfig} from '../src/services/database.js';
import {copySqliteToMysql} from '../src/services/sit-migration.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=path.join(root,'.env.sit.local');
if(!fs.existsSync(config))throw Error('请先复制 .env.sit.example 为 .env.sit.local 并填写 MySQL 配置');
process.loadEnvFile(config);
const connection=mysqlConfig();
if(process.argv.includes('--check')){
 const db=await mysql.createConnection(connection);
 try{await db.query('SELECT 1');console.log(`MySQL 连接正常：${connection.host}:${connection.port}/${connection.database}`);}finally{await db.end();}
}else{
 const result=await copySqliteToMysql({sourcePath:path.resolve(root,process.env.SQLITE_SOURCE||'data/platform.db'),backupDir:path.join(root,'data/backups'),targetDir:path.resolve(root,process.env.SIT_DATA_DIR||'data/sit'),connection});
 console.log(JSON.stringify(result,null,2));
}
