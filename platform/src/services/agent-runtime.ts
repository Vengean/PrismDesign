export interface AgentRuntimeConfig {
  provider: "claude" | "glm" | "claude-sub";
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function buildAgentEnvironment(config: AgentRuntimeConfig): string[] {
  if (!["claude","glm","claude-sub"].includes(config.provider)) throw new Error("不支持的 Agent SDK");
  // Both existing adapters read ANTHROPIC_*; the provider selects the execution implementation.
  return [
    `PRISM_AGENT_PROVIDER=${config.provider}`,
    `AGENT_TYPE=${config.provider}`,
    `ANTHROPIC_API_KEY=${config.apiKey}`,
    `ANTHROPIC_BASE_URL=${config.baseUrl}`,
    `ANTHROPIC_MODEL=${config.model}`,
  ];
}
