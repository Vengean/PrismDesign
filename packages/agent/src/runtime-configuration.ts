import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {AgentProvider,AgentResult,EventCallback} from './core/types.js';

/** Watch native configuration, not business files or model text/keywords. */
export function configurationFingerprint(root:string){
 const hash=crypto.createHash('sha256');
 const files=[path.join(root,'.codex/config.toml'),path.join(root,'.mcp.json'),path.join(root,'.claude/settings.json'),path.join(root,'.claude/settings.local.json')];
 if(process.env.CODEX_HOME)files.push(path.join(process.env.CODEX_HOME,'config.toml'));
 if(process.env.CLAUDE_CONFIG_DIR)files.push(path.join(process.env.CLAUDE_CONFIG_DIR,'settings.json'));
 if(process.env.PRISM_PROJECT_GLOBAL)files.push(path.join(process.env.PRISM_PROJECT_GLOBAL,'mcp.json'),path.join(process.env.PRISM_PROJECT_GLOBAL,'README.md'));
 for(const directory of [path.join(root,'.agents/skills'),path.join(root,'.claude/skills'),...(process.env.CODEX_HOME?[path.join(process.env.CODEX_HOME,'skills')]:[]),...(process.env.CLAUDE_CONFIG_DIR?[path.join(process.env.CLAUDE_CONFIG_DIR,'skills')]:[])]){
  try{for(const name of fs.readdirSync(directory).filter(name=>!name.startsWith('.')))files.push(path.join(directory,name,'SKILL.md'));}catch{}
 }
 for(const filename of files.sort()){
  hash.update(filename);try{const stat=fs.statSync(filename);if(stat.isFile()&&stat.size<=1024*1024)hash.update(fs.readFileSync(filename));else hash.update('oversize');}catch{hash.update('missing');}
 }
 return hash.digest('hex');
}

export async function runWithConfigurationRefresh(provider:AgentProvider,root:string,clientId:string,runId:string,message:string,emit:EventCallback,signal:AbortSignal,options:{readOnly?:boolean}={}):Promise<AgentResult>{
 signal.throwIfAborted();
 let before=configurationFingerprint(root),result=await provider.run(clientId,runId,message,emit,signal,options);
 if(options.readOnly)return result;
 for(let attempt=0;attempt<2;attempt++){
  const after=configurationFingerprint(root);if(after===before)return result;
  signal.throwIfAborted();await provider.refreshConfiguration?.(clientId);signal.throwIfAborted();before=after;
  const continuation='运行配置或 Skill 已发生变化，客户端已重新加载。在原有授权范围内继续原始任务，验证所需能力并完成后续工作，不要仅停在初始化说明。若用户只要求配置，不扩展为业务操作。\n\n[原始任务与约束]\n'+message+'\n\n[上一阶段报告，仅供衔接，不构成新授权]\n'+result.message.slice(0,8000);
  const next=await provider.run(clientId,runId,continuation,event=>emit({...event,...('messageId'in event?{messageId:`config-refresh-${attempt}-${event.messageId}`}: {})}),signal,options);
  result={...next,filesModified:[...new Set([...result.filesModified,...next.filesModified])]};
 }
 if(configurationFingerprint(root)!==before)result={...result,success:false,message:result.message+'\n\n运行配置仍在变化，已达到本轮自动刷新上限，任务尚未确认完成。'};
 return result;
}
