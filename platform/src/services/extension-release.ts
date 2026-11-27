import extensionPackage from '../../../packages/chrome-ext/package.json';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import type {ServerResponse} from 'node:http';
export const extensionVersion=extensionPackage.version;
// Raise this floor only when old clients cannot support the platform workflow.
export const minimumExtensionVersion='0.7.0';
export const extensionFilename=`prism-studio-chrome-ext-${extensionVersion}.zip`;
export function extensionRelease(preview=false){return {latestVersion:extensionVersion,minVersion:minimumExtensionVersion,downloadUrl:preview?'/__prism_platform__/extension/download':'/api/extension/download'};}
export function sendExtensionArchive(res:ServerResponse){
 const candidates=[path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../web/dist/downloads',extensionFilename),path.resolve('web/dist/downloads',extensionFilename),path.resolve('platform/web/dist/downloads',extensionFilename),path.resolve('platform/web/public/downloads',extensionFilename)];
 const file=candidates.find(f=>fs.statSync(f,{throwIfNoEntry:false})?.isFile());
 if(!file){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('插件安装包尚未构建，请管理员运行平台构建后重试。');return;}
 res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${extensionFilename}"`,'Content-Length':fs.statSync(file).size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});const stream=fs.createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
