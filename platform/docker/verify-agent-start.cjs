// Validate the real CLI and its production dependencies without calling a model.
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'prism-agent-smoke-'));
const child=spawn(process.execPath,['/prism-agent/dist/cli.js','start','--port','9527','--provider','claude'],{cwd,env:{...process.env,PRISM_PERMISSION_BROWSER:'false'}});
let log='',finished=false;
const timer=setTimeout(()=>finish(Error('Agent 启动检查超时')),20000);
function finish(error){if(finished)return;finished=true;clearTimeout(timer);child.kill('SIGTERM');fs.rmSync(cwd,{recursive:true,force:true});if(error){console.error(error.message);process.exitCode=1;}else console.log('Agent 启动、鉴权和取消能力检查通过');}
child.stdout.on('data',async chunk=>{
 log+=chunk.toString();const token=log.match(/^__PRISM_AGENT_TOKEN__=([^\r\n]+)$/m)?.[1];if(!token||finished)return;
 try{const res=await fetch('http://127.0.0.1:9527/api/status',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});const value=await res.json();if(!res.ok||value.agent?.capabilities?.cancel!==true)throw Error('Agent 鉴权或取消能力检查失败');finish();}catch(e){finish(e);}
});
child.stderr.on('data',chunk=>{log+=chunk.toString();});
child.on('error',finish);child.on('exit',code=>{if(!finished){const missing=log.match(/Cannot find package ['"]([@a-zA-Z0-9_./-]+)['"]/);finish(Error(missing?'Agent 缺少生产依赖：'+missing[1]:'Agent 启动检查失败，退出码：'+code));}});
