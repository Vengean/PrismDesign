import {resolveSitRelease} from './sit-release.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('../',import.meta.url)),mode=process.argv[2];
if(!['dev','sit'].includes(mode))throw Error('请选择 dev 或 sit 模式');
if(mode==='sit'){
 const config=path.join(directory,'.env.sit.local');
 if(!fs.existsSync(config))throw Error('SIT 配置不存在，请复制 .env.sit.example 为 .env.sit.local 并填写数据库密码');
 process.loadEnvFile(config);
 if(!process.env.DB_PASSWORD)throw Error('请在 .env.sit.local 中填写 DB_PASSWORD');
}
const env={...process.env,PRISM_MODE:mode,PORT:mode==='sit'?(process.env.SIT_PORT||'3002'):(process.env.PORT||'3001'),PRISM_DATA_DIR:mode==='sit'?path.resolve(directory,process.env.SIT_DATA_DIR||'data/sit'):path.join(directory,'data')};
if(mode==='sit'){env.PRISM_PREVIEW_GATEWAY_PORT=process.env.SIT_PREVIEW_GATEWAY_PORT||'3101';env.NODE_ENV='production';}
// DEV never loads SIT credentials or changes its existing SQLite data directory.
console.log(`[${mode}] ${mode==='sit'?'MySQL':'SQLite'} · 后端端口 ${env.PORT}`);
const release=mode==='sit'?resolveSitRelease(directory):undefined;
if(release)console.log(`[sit] 固定测试包 ${release.id} · 访问 http://localhost:${env.PORT} · 源码修改不会触发刷新或重启`);
const child=release
 ?spawn(process.execPath,['dist/server.js'],{cwd:release.directory,env,stdio:'inherit'})
 :spawn('pnpm',['exec','concurrently','--kill-others','pnpm dev:server','pnpm dev:web'],{cwd:directory,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
