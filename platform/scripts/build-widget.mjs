import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const widget=process.env.PRISM_WIDGET_DIR || fileURLToPath(new URL('../../packages/widget/',import.meta.url));
execFileSync(path.join(widget,'node_modules/.bin/vite'),['build'],{cwd:widget,stdio:'inherit'});
execFileSync(path.join(widget,'node_modules/.bin/tsc'),['--emitDeclarationOnly','--incremental','false'],{cwd:widget,stdio:'inherit'});
const target=new URL('../web/public/',import.meta.url);mkdirSync(target,{recursive:true});
copyFileSync(path.join(widget,'dist/prism-studio-widget.iife.js'),new URL('prism-widget.js',target));
