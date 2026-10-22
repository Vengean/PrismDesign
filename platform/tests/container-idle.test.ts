import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {containerEngine} from '../src/services/requirement-runtime.js';

// Opt in against an existing test container; no model call or workspace write.
test('Agent container stream survives silence beyond the management timeout', {skip:!process.env.PRISM_TEST_IDLE_CONTAINER},async()=>{
 async function probe(timeout:number){
  const engine=containerEngine(timeout);
  const exec=await engine.getContainer(process.env.PRISM_TEST_IDLE_CONTAINER!).exec({Cmd:['node','-e',"console.log('start');setTimeout(()=>console.log('done'),17000)"],AttachStdout:true,AttachStderr:true});
  const stream=await exec.start({Detach:false,Tty:false});
  const stdout=new PassThrough();let output='';stdout.on('data',b=>{output+=b.toString();});engine.modem.demuxStream(stream,stdout,stdout);
  await new Promise<void>((resolve,reject)=>{stream.once('end',resolve);stream.once('error',reject);stream.once('close',()=>{if(!output.includes('done'))reject(Error('stream closed before completion'));});});
  assert.match(output,/done/);assert.equal((await exec.inspect()).ExitCode,0);
 }
 const [short,long]=await Promise.allSettled([probe(15000),probe(0)]);
 assert.equal(short.status,'rejected','reproduce the old 15s idle disconnect');
 assert.equal(long.status,'fulfilled',long.status==='rejected'?String(long.reason):undefined);
});
