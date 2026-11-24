// Run as the final image user. No model calls or account credentials are needed.
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

async function checkProvider(provider,cwd){
 const child=spawn(process.execPath,['/prism-agent/dist/cli.js','start','--port','9527','--provider',provider],{
  cwd,env:{...process.env,PRISM_PERMISSION_BROWSER:'false',PRISM_AGENT_PROVIDER:provider,AGENT_TYPE:provider},
 });
 let log='',checking=false;
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error(`${provider}: Agent 启动检查超时`)),20000);
   const finish=error=>{clearTimeout(timer);error?reject(error):resolve();};
   child.once('error',finish);
   child.once('exit',code=>{
    const missing=log.match(/Cannot find package ['"]([@a-zA-Z0-9_./-]+)['"]/);
    finish(Error(missing?`${provider}: 缺少生产依赖 ${missing[1]}`:`${provider}: Agent 提前退出 (${code})`));
   });
   child.stderr.on('data',chunk=>{log+=chunk.toString();});
   child.stdout.on('data',async chunk=>{
    log+=chunk.toString();const token=log.match(/^__PRISM_AGENT_TOKEN__=([^\r\n]+)$/m)?.[1];
    if(!token||checking)return;checking=true;
    try{
     const url='http://127.0.0.1:9527/api/status';
     const denied=await fetch(url,{signal:AbortSignal.timeout(5000)});
     await denied.arrayBuffer();
     if(denied.status!==401)throw Error(`${provider}: Agent 未拒绝未授权访问`);
     const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
     const value=await response.json();
     if(!response.ok||value.agent?.provider!==provider||value.agent?.capabilities?.cancel!==true)throw Error(`${provider}: Provider、鉴权或取消能力检查失败`);
     finish();
    }catch(error){finish(error);}
   });
  });
 }finally{
  child.kill('SIGTERM');
  const force=setTimeout(()=>child.kill('SIGKILL'),3000);
  await closed;clearTimeout(force);
 }
 console.log(`[Agent] ${provider}: 启动、鉴权和取消能力检查通过`);
}

async function main(){
 const patchRoot=fs.mkdtempSync(path.join(os.tmpdir(),'prism-patch-smoke-'));
 try{
  execFileSync('apply_patch',['*** Begin Patch\n*** Add File: fixture.txt\n+before\n*** End Patch'],{cwd:patchRoot,timeout:10000});
  execFileSync('apply_patch',['*** Begin Patch\n*** Update File: fixture.txt\n@@\n-before\n+after\n*** End Patch'],{cwd:patchRoot,timeout:10000});
  if(fs.readFileSync(path.join(patchRoot,'fixture.txt'),'utf8')!=='after\n')throw Error('apply_patch: 文件编辑检查失败');
 }finally{fs.rmSync(patchRoot,{recursive:true,force:true});}
 console.log('[Codex] apply_patch 文件创建和编辑检查通过');
 for(const [command,args] of [['codex',['--version']],['claude',['--version']],['glm-acp-agent',['--help']]]){
  const output=execFileSync(command,args,{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']});
  if(!output.trim())throw Error(`${command}: CLI 检查未返回信息`);
  console.log(`[CLI] ${command}: ${output.trim().split('\n')[0]}`);
 }
 // Parse the exact SDK overrides in a clean profile. Starting the HTTP server
 // alone does not load Codex config and cannot catch invalid MCP transports.
 const chunk=fs.readdirSync('/prism-agent/dist').find(file=>/^codex-provider-.*\.js$/.test(file));
 const {codexClientOptions}=await import('node:url').then(({pathToFileURL})=>import(pathToFileURL(path.join('/prism-agent/dist',chunk)).href));
 const options=codexClientOptions(),args=[];
 const flatten=(prefix,value)=>{
  if(value&&typeof value==='object'&&!Array.isArray(value)){
   for(const [key,item]of Object.entries(value))flatten(prefix?`${prefix}.${JSON.stringify(key)}`:JSON.stringify(key),item);
  }else args.push('-c',`${prefix}=${JSON.stringify(value)}`);
 };
 flatten('',options.config);
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'prism-codex-config-'));
 try{execFileSync('codex',[...args,'mcp','list','--json'],{env:{...process.env,CODEX_HOME:profile},timeout:20000,stdio:['ignore','pipe','pipe']});}
 finally{fs.rmSync(profile,{recursive:true,force:true});}
 console.log('[Codex] 全部 SDK 配置通过 CLI 解析检查');
 const prefix=execFileSync('npm',['prefix','-g'],{encoding:'utf8'}).trim();
 fs.accessSync(prefix,fs.constants.W_OK);
 console.log('[npm] 普通用户全局安装目录可写');
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'prism-agent-smoke-'));
 try{for(const provider of ['claude','claude-sub','glm','codex','openai'])await checkProvider(provider,cwd);}
 finally{fs.rmSync(cwd,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
