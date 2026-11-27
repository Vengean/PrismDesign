import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// A standard store-mode ZIP avoids relying on a host zip binary or platform-
// specific archives. manifest.json stays at the root of the unpacked package.
export function extensionZip(directory){
 const files=[];function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('插件包不能包含符号链接');if(entry.isDirectory())visit(file);else if(entry.isFile())files.push(file);}}visit(directory);
 const local=[],central=[];let offset=0;
 for(const file of files){const name=Buffer.from(path.relative(directory,file).split(path.sep).join('/')),data=fs.readFileSync(file),crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
  local.push(header,name,data);central.push(record,name);offset+=header.length+name.length+data.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,index,end]);
}
export function packageExtension(directory,target){
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 if(!/^\d+(?:\.\d+){2,3}$/.test(manifest.version))throw Error('插件版本无效');
 for(const file of [manifest.background?.service_worker,manifest.side_panel?.default_path,...(manifest.content_scripts||[]).flatMap(script=>script.js||[])])if(!file||!fs.statSync(path.join(directory,file),{throwIfNoEntry:false})?.isFile())throw Error('插件安装包缺少入口文件');
 const filename=`prism-studio-chrome-ext-${manifest.version}.zip`;fs.mkdirSync(target,{recursive:true});
 const temporary=path.join(target,'.extension-'+randomUUID()+'.zip');
 try{fs.writeFileSync(temporary,extensionZip(directory));fs.renameSync(temporary,path.join(target,filename));}finally{fs.rmSync(temporary,{force:true});}return filename;
}
