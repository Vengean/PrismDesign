import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
export function prismBrowserMcp(){
 const root=path.dirname(fileURLToPath(import.meta.url)),compiled=path.join(root,'testing/mcp-browser-server.js'),source=path.join(root,'testing/mcp-browser-server.ts');
 return {command:process.execPath,args:fs.existsSync(compiled)?[compiled]:['--import','tsx',source],env:{PRISM_AGENT_URL:process.env.PRISM_AGENT_URL||'http://127.0.0.1:9527'}};
}
