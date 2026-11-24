import type { CodexOptions } from '@openai/codex-sdk';

/** Keep subscription authentication isolated from inherited API credentials. */
export function codexAuthentication(env:NodeJS.ProcessEnv=process.env):CodexOptions {
  const apiKey=env.CODEX_API_KEY||env.OPENAI_API_KEY;
  const mode=env.CODEX_AUTH_MODE||(apiKey?'api-key':'subscription');
  if(!['api-key','subscription'].includes(mode))throw new Error('不支持的 Codex 认证模式');
  const childEnv=Object.fromEntries(Object.entries(env).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  if(mode==='api-key'){
    if(!apiKey)throw new Error('请先配置 Codex API Key');
    return {apiKey,baseUrl:env.OPENAI_BASE_URL||'https://api.openai.com/v1',env:childEnv,config:{forced_login_method:'api',model_provider:'openai'}};
  }
  delete childEnv.CODEX_API_KEY;
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.OPENAI_BASE_URL;
  return {env:childEnv,config:{forced_login_method:'chatgpt'}};
}
