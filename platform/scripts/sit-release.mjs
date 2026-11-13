import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const platformDirectory=fileURLToPath(new URL('../',import.meta.url));
const required=['dist/server.js','web/dist/index.html','web/dist/prism-widget.js'];
function validate(directory){for(const file of required)if(!fs.statSync(path.join(directory,file),{throwIfNoEntry:false})?.isFile())throw Error(`SIT 测试包不完整：缺少 ${file}，请重新运行 pnpm build:sit`);}
export function resolveSitRelease(directory=platformDirectory){
 const current=path.join(directory,'.sit/current.json');
 if(!fs.existsSync(current))throw Error('SIT 测试包不存在，请先运行 pnpm build:sit（仓库根目录：pnpm build:sit:platform）');
 const {id}=JSON.parse(fs.readFileSync(current,'utf8'));
 if(typeof id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('SIT 测试包索引无效，请重新运行 pnpm build:sit');
 const release=path.join(directory,'.sit/releases',id);validate(release);return {id,directory:release};
}
async function execute(command,args,options){
 await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{...options,stdio:'inherit'});
  child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`SIT 构建失败：${command} (${signal||code})`)));
 });
}
export async function buildSitRelease({directory=platformDirectory,run=execute}={}){
 const id=new Date().toISOString().replace(/[^0-9]/g,'')+'-'+randomUUID().slice(0,8);
 const root=path.join(directory,'.sit'),staging=path.join(root,'releases','.build-'+id),release=path.join(root,'releases',id);
 const widget=path.resolve(directory,'../packages/widget'),env={...process.env,NODE_ENV:'production',PRISM_MODE:'sit'};
 fs.mkdirSync(staging,{recursive:true});
 try{
  // Each build has its own output directory. Never clear or replace files served
  // by a running SIT process, even when another build is published.
  await run(process.execPath,[path.join(directory,'node_modules/tsup/dist/cli-default.js'),'--out-dir',path.join(staging,'dist')],{cwd:directory,env});
  await run(process.execPath,[path.join(widget,'node_modules/vite/bin/vite.js'),'build','--outDir',path.join(staging,'widget'),'--emptyOutDir'],{cwd:widget,env});
  await run(process.execPath,[path.join(directory,'web/node_modules/vite/bin/vite.js'),'build','--outDir',path.join(staging,'web/dist'),'--emptyOutDir'],{cwd:path.join(directory,'web'),env});
  fs.copyFileSync(path.join(staging,'widget/prism-studio-widget.iife.js'),path.join(staging,'web/dist/prism-widget.js'));
  fs.rmSync(path.join(staging,'widget'),{recursive:true,force:true});
  fs.writeFileSync(path.join(staging,'package.json'),JSON.stringify({private:true,type:'module'}));
  fs.writeFileSync(path.join(staging,'release.json'),JSON.stringify({id,builtAt:new Date().toISOString(),node:process.version},null,2)+'\n');
  validate(staging);fs.renameSync(staging,release);
  const pointer=path.join(root,'.current-'+id+'.json');fs.writeFileSync(pointer,JSON.stringify({id})+'\n');fs.renameSync(pointer,path.join(root,'current.json'));
  console.log(`[sit] 测试包已构建：${id}\n[sit] 运行 pnpm sit 启动；已运行的 SIT 保持原版本，手动重启后切换。`);
  return {id,directory:release};
 }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))buildSitRelease().catch(error=>{console.error(error.message);process.exitCode=1;});
