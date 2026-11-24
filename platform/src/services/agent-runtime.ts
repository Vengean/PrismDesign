export interface AgentRuntimeConfig {
  provider: "claude" | "glm" | "claude-sub" | "codex";
  authMode?: "api-key" | "subscription";
  proxyUrl?: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function buildAgentEnvironment(config: AgentRuntimeConfig,options:{proxyScope?:'container'|'agent'}={}): string[] {
  if (!["claude","glm","claude-sub","codex"].includes(config.provider)) throw new Error("不支持的 Agent SDK");
  const provider=config.provider==='claude'&&config.authMode==='subscription'?'claude-sub':config.provider;
  const env = [
    `PRISM_AGENT_PROVIDER=${provider}`,
    `AGENT_TYPE=${provider}`,
  ];
  if(config.provider==='codex'){
    const mode=config.authMode||'api-key';
    if(mode==='api-key'&&!config.apiKey)throw new Error('请先配置 Codex API Key');
    env.push(`CODEX_AUTH_MODE=${mode}`,`CODEX_HOME=${mode==='subscription'?'/project-auth/codex':'/home/prism/.codex'}`,`CODEX_MODEL=${config.model}`);
    if(mode==='api-key')env.push(`CODEX_API_KEY=${config.apiKey}`,`OPENAI_BASE_URL=${config.baseUrl||'https://api.openai.com/v1'}`);
  }else if(provider==='claude-sub'){
    env.push('CLAUDE_CONFIG_DIR=/project-auth/claude',`ANTHROPIC_MODEL=${config.model}`);
  }else if(config.authMode==='subscription'&&provider==='glm'){
    env.push(`ANTHROPIC_BASE_URL=${config.baseUrl}`,`ANTHROPIC_MODEL=${config.model}`);
  }else{
    env.push(`ANTHROPIC_API_KEY=${config.apiKey}`,`ANTHROPIC_BASE_URL=${config.baseUrl}`,`ANTHROPIC_MODEL=${config.model}`);
  }
  if(config.authMode==='subscription')env.push('PRISM_AUTH_MODE=subscription','XDG_CONFIG_HOME=/project-auth/glm');
  if(config.proxyUrl){
    if(options.proxyScope==='agent')env.push(`PRISM_MODEL_PROXY_URL=${config.proxyUrl}`);
    else env.push(`HTTP_PROXY=${config.proxyUrl}`,`HTTPS_PROXY=${config.proxyUrl}`,`http_proxy=${config.proxyUrl}`,`https_proxy=${config.proxyUrl}`,
      'NO_PROXY=localhost,127.0.0.1,::1','no_proxy=localhost,127.0.0.1,::1');
  }
  return env;
}
