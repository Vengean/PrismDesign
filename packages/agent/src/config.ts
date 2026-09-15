import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * prism.config.ts / prism.config.js configuration interface.
 * All fields are optional — CLI args and env vars fill in defaults.
 */
export interface PrismConfig {
  /** Service port. Defaults to 9527. */
  port?: number;
  /** Project root, resolved relative to the directory containing the config file. */
  project?: string;
  /** Require the random startup token for HTTP and WebSocket clients. Defaults to true. */
  accessTokenRequired?: boolean;
  /** Agent provider. `agentType` is kept for backwards compatibility. */
  provider?: "claude" | "claude-sub" | "openai" | "codex" | "glm";
  agentType?: "claude" | "claude-sub" | "openai" | "codex" | "glm";
  /** Provider API key. Ignored by providers that use local subscription authentication. */
  apiKey?: string;
  /** Provider-compatible API base URL. */
  apiBaseUrl?: string;
  /** Provider model override. */
  model?: string;
  /** Provider-independent execution boundaries. */
  permissions?: {
    filesystem?: "read-only" | "workspace-write";
    commands?: "none" | "workspace";
    network?: boolean;
    browser?: {
      enabled?: boolean;
      headless?: boolean;
      allowedOrigins?: string[];
    };
    mcp?: {
      enabled?: boolean;
      defaultApproval?: "approve" | "prompt" | "deny";
    };
  };
  /** Codex CLI configuration; authentication is managed by `codex login`. */
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** `https` avoids slow WebSocket fallback; set `websocket` when the network supports it. */
  codexTransport?: "https" | "websocket";
  /** Project-scoped MCP servers exposed to Codex. */
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    defaultToolsApprovalMode?: "approve" | "prompt" | "deny";
  }>;
  /** HTTPS proxy */
  httpsProxy?: string;
  /** HTTP proxy */
  httpProxy?: string;
  /** Hosts that bypass HTTP(S) proxies. */
  noProxy?: string;
  /** Log full Agent prompt bodies. Defaults to false. */
  debug?: boolean;
}

const CONFIG_NAMES = ["prism.config.ts", "prism.config.js", "prism.config.mjs"];

/**
 * Load prism.config.{ts,js,mjs} from the given directory.
 * Uses tsx for .ts files, dynamic import for .js/.mjs.
 */
export async function loadConfig(dir: string): Promise<PrismConfig> {
  for (const name of CONFIG_NAMES) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) continue;

    console.log(`📄 加载配置: ${filePath}`);

    try {
      if (name.endsWith(".ts")) {
        // Use tsx to load TypeScript config
        return await loadTsConfig(filePath);
      } else {
        const fileUrl = pathToFileURL(filePath).href;
        const mod = await import(fileUrl);
        return mod.default || mod;
      }
    } catch (error) {
      console.error(`❌ 加载配置失败 (${name}):`, error instanceof Error ? error.message : error);
      return {};
    }
  }

  return {};
}

async function loadTsConfig(filePath: string): Promise<PrismConfig> {
  // Try using tsx register to load .ts files
  try {
    const fileUrl = pathToFileURL(filePath).href;
    // tsx registers itself to handle .ts imports
    const mod = await import(fileUrl);
    return mod.default || mod;
  } catch {
    // Fallback: read file, strip type annotations naively, eval as JS
    // This handles simple config files without complex TS features
    const content = fs.readFileSync(filePath, "utf-8");
    // Extract the object between export default and the end
    const match = content.match(/export\s+default\s+({[\s\S]*})\s*;?\s*$/m);
    if (match) {
      try {
        // Use Function constructor to evaluate the object literal
        const fn = new Function(`return (${match[1]})`);
        return fn();
      } catch {}
    }

    console.warn("⚠️  无法解析 prism.config.ts，请确保已安装 tsx");
    return {};
  }
}

/**
 * Apply config values to process.env.
 * @param force - if true, overwrite existing env vars (config > .env)
 */
export function applyConfigToEnv(config: PrismConfig, force = false) {
  const mapping: Array<[keyof PrismConfig, string]> = [
    ["codexReasoningEffort", "CODEX_REASONING_EFFORT"],
    ["codexTransport", "CODEX_TRANSPORT"],
    ["provider", "PRISM_AGENT_PROVIDER"],
    ["agentType", "PRISM_AGENT_PROVIDER"],
    ["httpsProxy", "HTTPS_PROXY"],
    ["httpProxy", "HTTP_PROXY"],
    ["noProxy", "NO_PROXY"],
  ];

  const permissions = config.permissions;
  const setPermission = (name: string, value: string | boolean | undefined) => {
    if (value !== undefined && (force || process.env[name] === undefined)) process.env[name] = String(value);
  };
  setPermission("PRISM_PERMISSION_FILESYSTEM", permissions?.filesystem);
  setPermission("PRISM_PERMISSION_COMMANDS", permissions?.commands);
  setPermission("PRISM_PERMISSION_NETWORK", permissions?.network);
  setPermission("PRISM_PERMISSION_BROWSER", permissions?.browser?.enabled);
  setPermission("PRISM_BROWSER_HEADLESS", permissions?.browser?.headless);
  setPermission("PRISM_BROWSER_ALLOWED_ORIGINS", permissions?.browser?.allowedOrigins?.join(","));
  setPermission("PRISM_PERMISSION_MCP", permissions?.mcp?.enabled ?? (config.mcpServers ? true : undefined));
  setPermission("PRISM_MCP_APPROVAL", permissions?.mcp?.defaultApproval);
  setPermission("PRISM_AGENT_DEBUG", config.debug);

  if (config.mcpServers && (force || !process.env.PRISM_MCP_SERVERS)) {
    process.env.PRISM_MCP_SERVERS = JSON.stringify(config.mcpServers);
  }

  for (const [configKey, envKey] of mapping) {
    const val = config[configKey];
    if (typeof val === "string" && val && (force || !process.env[envKey])) {
      process.env[envKey] = val;
    }
  }
}
