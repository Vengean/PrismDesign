import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {extensionCompatibility,compareExtensionVersions} from '../../packages/ui/src/studio/extension-compatibility.js';
import {extensionRelease,extensionFilename,sendExtensionArchive} from '../src/services/extension-release.js';
import {extensionZip,packageExtension} from '../scripts/extension-distribution.mjs';
test('version comparison distinguishes required, recommended, current and future versions numerically',()=>{
 const release={latestVersion:'0.7.10',minVersion:'0.7.0',downloadUrl:'/download'};
 assert.equal(compareExtensionVersions('0.7.10','0.7.9'),1);assert.equal(compareExtensionVersions('0.7.0.0','0.7.0'),0);
 assert.equal(extensionCompatibility('0.6.9',release).required,true);
 assert.deepEqual(extensionCompatibility(undefined,release),{required:true,update:true,current:'未知'});
 assert.equal(extensionCompatibility('bad',release).required,true);
 assert.deepEqual(extensionCompatibility('0.7.9',release),{required:false,update:true,current:'0.7.9'});
 assert.equal(extensionCompatibility('0.7.10',release).update,false);assert.equal(extensionCompatibility('0.8.0',release).update,false);
 const manifest=JSON.parse(fs.readFileSync(new URL('../../packages/chrome-ext/public/manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.version,extensionRelease().latestVersion);
});
test('ZIP contains an installable root manifest and preserves arbitrary binary files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-extension-zip-')),source=path.join(root,'source');fs.mkdirSync(source);
 try{
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({version:'0.7.0',background:{service_worker:'background.js'},side_panel:{default_path:'sidepanel.html'}}));
  fs.writeFileSync(path.join(source,'background.js'),'worker');fs.writeFileSync(path.join(source,'sidepanel.html'),'panel');const icon=Buffer.from([0,255,1,13,10]);fs.writeFileSync(path.join(source,'icon.png'),icon);
  const filename=packageExtension(source,path.join(root,'downloads')),zip=fs.readFileSync(path.join(root,'downloads',filename));
  const files=new Map<string,Buffer>();let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),name=zip.subarray(offset+30,offset+30+length).toString();files.set(name,zip.subarray(offset+30+length,offset+30+length+size));offset+=30+length+size;}
  assert.equal(JSON.parse(files.get('manifest.json')!.toString()).version,'0.7.0');assert.deepEqual(files.get('icon.png'),icon);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
  fs.symlinkSync('/tmp',path.join(source,'outside'));assert.throws(()=>extensionZip(source),/符号链接/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('download uses the matching package with ZIP headers, and missing packages return 503 rather than HTML',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prism-extension-http-')),previous=process.cwd();let server:http.Server|undefined;
 try{
  process.chdir(root);server=http.createServer((_req,res)=>sendExtensionArchive(res));await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${(server.address() as any).port}`;
  assert.equal((await fetch(url)).status,503);
  fs.mkdirSync('web/dist/downloads',{recursive:true});fs.writeFileSync(path.join('web/dist/downloads',extensionFilename),'ZIP-fixture');
  const response=await fetch(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/zip');assert.ok(response.headers.get('content-disposition')!.includes(extensionFilename));assert.equal(await response.text(),'ZIP-fixture');
 }finally{process.chdir(previous);if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));fs.rmSync(root,{recursive:true,force:true});}
});
