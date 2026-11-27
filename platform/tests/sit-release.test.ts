import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {buildSitRelease,resolveSitRelease} from '../scripts/sit-release.mjs';
const write=(file:string,text:string)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);};
const serverSource=`import http from 'node:http';import fs from 'node:fs';if(process.env.PRISM_MODE!=='sit'||process.env.NODE_ENV!=='production')throw Error('incorrect mode');http.createServer((_req,res)=>res.end(fs.readFileSync('web/dist/index.html'))).listen(Number(process.env.PORT),'127.0.0.1');`;
function builder(version:string,fail=false){let step=0;return async(_command:string,args:string[],options:any)=>{
 assert.equal(options.env.NODE_ENV,'production');assert.equal(options.env.PRISM_MODE,'sit');step++;
 const output=args[args.indexOf(step===1?'--out-dir':'--outDir')+1];
 if(step===1)write(path.join(output,'server.js'),serverSource);
 else if(step===2)write(path.join(output,'prism-studio-widget.iife.js'),'widget-'+version);
 else if(step===3){if(fail)throw Error('fixture build failure');write(path.join(output,'index.html'),version);write(path.join(output,'prism-widget.js'),'stale public widget');}
 else {write(path.join(output,'manifest.json'),JSON.stringify({version:'0.7.0',background:{service_worker:'background.js'},side_panel:{default_path:'sidepanel.html'},content_scripts:[{js:['content.js']}]}));for(const name of ['background.js','sidepanel.html','content.js'])write(path.join(output,name),'fixture');}
};}
test('SIT releases isolate assets; failed build retains last usable package',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prism-sit-build-'));
 try{
  assert.throws(()=>resolveSitRelease(directory),/先运行 pnpm build:sit/);
  const first=await buildSitRelease({directory,run:builder('first')});assert.equal(resolveSitRelease(directory).id,first.id);
  assert.equal(fs.readFileSync(path.join(first.directory,'web/dist/prism-widget.js'),'utf8'),'widget-first');
  await assert.rejects(buildSitRelease({directory,run:builder('broken',true)}),/fixture build failure/);assert.equal(resolveSitRelease(directory).id,first.id);
  const second=await buildSitRelease({directory,run:builder('second')});assert.notEqual(first.id,second.id);assert.equal(resolveSitRelease(directory).id,second.id);
  assert.equal(fs.readFileSync(path.join(first.directory,'web/dist/index.html'),'utf8'),'first');
  assert.deepEqual(fs.readdirSync(path.join(directory,'.sit/releases')).sort(),[first.id,second.id].sort());
  fs.unlinkSync(path.join(second.directory,'web/dist/prism-widget.js'));assert.throws(()=>resolveSitRelease(directory),/测试包不完整/);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
function get(port:number){return new Promise<string>((resolve,reject)=>{const request=http.get(`http://127.0.0.1:${port}`,response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve(body));});request.on('error',reject);request.setTimeout(500,()=>request.destroy());});}
async function until(fn:()=>Promise<boolean>){const deadline=Date.now()+5000;while(!await fn().catch(()=>false)){assert.ok(Date.now()<deadline,'SIT fixture did not become ready');await new Promise(resolve=>setTimeout(resolve,10));}}
test('running SIT ignores source edits and new builds; explicit restart selects new package',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'prism-sit-runtime-'));
 const reservation=http.createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 let child:ReturnType<typeof spawn>|undefined,logs='';
 const start=()=>{child=spawn(process.execPath,['scripts/run-mode.mjs','sit'],{cwd:directory,env:{...process.env,DB_PASSWORD:'fixture',SIT_PORT:String(port)},stdio:['ignore','pipe','pipe']});child.stdout?.on('data',data=>logs+=data);child.stderr?.on('data',data=>logs+=data);};
 const stop=async()=>{if(!child||child.exitCode!==null)return;const stopped=new Promise(resolve=>child!.once('exit',resolve));child.kill('SIGTERM');await stopped;};
 try{
  for(const name of ['run-mode.mjs','sit-release.mjs','extension-distribution.mjs'])write(path.join(directory,'scripts',name),fs.readFileSync(new URL('../scripts/'+name,import.meta.url),'utf8'));
  write(path.join(directory,'.env.sit.local'),'DB_PASSWORD=fixture\n');
  await buildSitRelease({directory,run:builder('first')});start();await until(async()=>await get(port)==='first');const pid=child!.pid;
  write(path.join(directory,'src/server.ts'),'invalid modified source');write(path.join(directory,'web/src/App.tsx'),'modified UI');write(path.join(directory,'dist/server.js'),'invalid rebuilt output');write(path.join(directory,'web/dist/index.html'),'shared output');
  await buildSitRelease({directory,run:builder('second')});assert.equal(await get(port),'first');assert.equal(child!.pid,pid);assert.equal(child!.exitCode,null);assert.ok(!logs.includes('tsx watch'));assert.ok(!logs.includes('VITE'));
  await stop();start();await until(async()=>await get(port)==='second');
 }finally{await stop();fs.rmSync(directory,{recursive:true,force:true});}
});
