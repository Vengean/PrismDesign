import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {packageExtension} from './extension-distribution.mjs';
const extension=fileURLToPath(new URL('../../packages/chrome-ext/',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'prism-extension-build-'));
try{execFileSync(process.execPath,[path.join(extension,'node_modules/vite/bin/vite.js'),'build','--outDir',temporary,'--emptyOutDir'],{cwd:extension,stdio:'inherit'});const filename=packageExtension(temporary,fileURLToPath(new URL('../web/public/downloads/',import.meta.url)));console.log('[Extension] 下载包已生成：'+filename);}
finally{fs.rmSync(temporary,{recursive:true,force:true});}
