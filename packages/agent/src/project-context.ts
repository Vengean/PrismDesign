import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
export type SharedMcpServer=({type?:'stdio';command:string;args?:string[];env?:Record<string,string>}|{type:'http';url:string;headers?:Record<string,string>})&{defaultToolsApprovalMode?:'approve'|'prompt'|'deny';enabled?:boolean};
export function sdkMcpServer(server:SharedMcpServer){return 'url'in server?{type:'http' as const,url:server.url,headers:server.headers||{}}:{command:server.command,args:server.args||[],env:server.env||{}};}
export function projectMcpServers(projectRoot=process.cwd()):Record<string,SharedMcpServer>{
 const servers:Record<string,SharedMcpServer>={};
 function merge(configured:unknown,prefix=''){
  if(!configured||typeof configured!=='object'||Array.isArray(configured))throw Error('MCP 配置应为服务对象');
  for(const [name,value]of Object.entries(configured)){
   if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(name)||['prism_project','prism_browser','node_repl'].includes(name)||(!prefix&&name.startsWith('project_')))throw Error('MCP 名称无效或与项目共享/内置服务冲突');
   const server=value as SharedMcpServer;
   if(!server||typeof server!=='object')throw Error('MCP 服务配置无效');
   if(server.enabled===false){delete servers[prefix+name];continue;}
   const stringRecord=(value:unknown)=>value===undefined||!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(v=>typeof v==='string');
   if('url'in server){
    try{const url=new URL(server.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();}catch{throw Error('MCP HTTP 地址无效');}
    if(!stringRecord(server.headers)||Object.entries(server.headers||{}).some(([key,value])=>/[\r\n\0]/.test(key+value)))throw Error('MCP HTTP 请求头无效');
   }else{
    if(typeof server.command!=='string'||!server.command.trim())throw Error('MCP stdio 服务缺少 command');
    if(server.args!==undefined&&(!Array.isArray(server.args)||server.args.some(v=>typeof v!=='string'))||!stringRecord(server.env))throw Error('MCP stdio 参数无效');
   }
   servers[prefix+name]=server;
  }
 }
 function read(filename:string){try{return JSON.parse(fs.readFileSync(filename,'utf8')).mcpServers;}catch{throw Error('MCP 配置文件无法解析，请检查 JSON 格式');}}
 if(process.env.PRISM_PERMISSION_MCP!=='false'){
  const shared=process.env.PRISM_PROJECT_GLOBAL&&path.join(process.env.PRISM_PROJECT_GLOBAL,'mcp.json');
  if(shared&&fs.existsSync(shared))merge(read(shared),'project_');
  const local=path.join(projectRoot,'.mcp.json');if(fs.existsSync(local))merge(read(local));
  if(process.env.PRISM_MCP_SERVERS){let configured;try{configured=JSON.parse(process.env.PRISM_MCP_SERVERS);}catch{throw Error('prism.config MCP 配置无法解析');}merge(configured);}
 }
 if(process.env.PRISM_PLATFORM_TOOLS==='true'){
  const root=path.dirname(fileURLToPath(import.meta.url)),compiled=path.join(root,'testing/mcp-project-server.js');
  servers.prism_project={command:process.execPath,args:fs.existsSync(compiled)?[compiled]:['--import','tsx',path.join(root,'testing/mcp-project-server.ts')],env:{PRISM_AGENT_URL:process.env.PRISM_AGENT_URL||'http://127.0.0.1:9527'}};
 }
 return servers;
}
export function projectKnowledgeContext(){
 const root=process.env.PRISM_PROJECT_GLOBAL;
 if(!root||!fs.existsSync(path.join(root,'README.md')))return '';
 const skills=fs.existsSync(path.join(root,'skills'))?fs.readdirSync(path.join(root,'skills'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>`${e.name}: ${path.join(root,'skills',e.name,'SKILL.md')}`):[];
 return ['[项目共享 .global]',`项目总说明：${root}/README.md。先读取相关说明，再按需读取 ${root}/docs/ 内文档。`,`共享 MCP 定义：${root}/mcp.json，由 SDK 适配加载为 project_ 前缀工具。`,...skills.map(s=>'共享 Skill '+s),'Skill 是可读取的操作规范；按任务选择相关 SKILL.md 后遵循步骤，也可按当前 CLI 约定安装本需求的本地 Skill。','同一项目下的需求容器共享此目录，不同项目隔离。共享内容只读；仓库自己的 README、AGENTS.md、CLAUDE.md、Skill 和 MCP 保持独立，同名本地内容优先，不覆盖共享层。','按任务自主安装依赖、配置本地 MCP/Skill 并验证，不要仅停留在方案说明。不要输出凭证或修改项目共享登录态。'].join('\n');
}
