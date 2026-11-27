import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {persistCodexImages} from '../../packages/agent/src/providers/codex-images.js';
test('native Codex image output is persisted in the requirement workspace with deterministic links',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-images-')),workspace=path.join(root,'workspace'),home=path.join(root,'auth');
 fs.mkdirSync(workspace);const sessions=path.join(home,'sessions/2026/11/25');fs.mkdirSync(sessions,{recursive:true});
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
 const rollout=path.join(sessions,'rollout-date-thread-id.jsonl');
 try{
  fs.writeFileSync(rollout,JSON.stringify({type:'event_msg',payload:{type:'image_generation_end',status:'completed',result:bytes.toString('base64'),saved_path:'/auth-only/image.png'}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'image_generation_end',status:'failed'}}));
  const files=persistCodexImages(workspace,'thread-id','run-id',home);assert.equal(files.length,1);assert.ok(files[0].startsWith('prism-artifacts/run-id/'));assert.deepEqual(fs.readFileSync(path.join(workspace,files[0])),bytes);
  assert.deepEqual(persistCodexImages(workspace,'thread-id','run-id',home),files);
  assert.deepEqual(persistCodexImages(workspace,'other-thread','run-id',home),[]);
  fs.rmSync(path.join(workspace,'prism-artifacts'),{recursive:true});fs.symlinkSync(home,path.join(workspace,'prism-artifacts'));
  assert.throws(()=>persistCodexImages(workspace,'thread-id','run-id',home),/目录无效/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
