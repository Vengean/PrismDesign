import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * prism.config.ts / prism.config.js configuration interface.
 * All fields are optional — CLI args and env vars fill in defaults.
 */
export interface PrismConfig {
  /** Agent provider. `agentType` is kept for backwards compatibility. */
  provider?: "claude" | "claude-sub" | "openai" | "codex" | "glm";
  agentType?: "claude" | "claude-sub" | "openai" | "codex" | "glm";
  /** Anthropic API Key */
  anthropicApiKey?: string;
  /** Model name */
  anthropicModel?: string;
  /** API Base URL (proxy) */
  anthropicBaseUrl?: string;
  /** OpenAI API configuration */
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  /** Codex CLI configuration; authentication is managed by `codex login`. */
  codexModel?: string;
  codexReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  /** `https` avoids slow WebSocket fallback; set `websocket` when the network supports it. */
  codexTransport?: "https" | "websocket";
  /** HTTPS proxy */
  httpsProxy?: string;
  /** HTTP proxy */
  httpProxy?: string;
  /** claude-agent-sdk session options override */
  options?: {
    model?: string;
    cwd?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
    allowDangerouslySkipPermissions?: boolean;
    settingSources?: string[];
    env?: Record<string, string | undefined>;
  };
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

    // Another fallback: defineConfig pattern
    const defineMatch = content.match(/defineConfig\s*\(\s*({[\s\S]*})\s*\)\s*;?\s*$/m);
    if (defineMatch) {
      try {
        const fn = new Function(`return (${defineMatch[1]})`);
        return fn();
      } catch {}
    }

    console.warn("⚠️  无法解析 prism.config.ts，请确保已安装 tsx");
    return {};
  }
}

/**
 * Helper for users to get type hints in their config file.
 */
export function defineConfig(config: PrismConfig): PrismConfig {
  return config;
}

/**
 * Apply config values to process.env.
 * @param force - if true, overwrite existing env vars (config > .env)
 */
export function applyConfigToEnv(config: PrismConfig, force = false) {
  const mapping: Array<[keyof PrismConfig, string]> = [
    ["anthropicApiKey", "ANTHROPIC_API_KEY"],
    ["anthropicModel", "ANTHROPIC_MODEL"],
    ["anthropicBaseUrl", "ANTHROPIC_BASE_URL"],
    ["openaiApiKey", "OPENAI_API_KEY"],
    ["openaiModel", "OPENAI_MODEL"],
    ["openaiBaseUrl", "OPENAI_BASE_URL"],
    ["codexModel", "CODEX_MODEL"],
    ["codexReasoningEffort", "CODEX_REASONING_EFFORT"],
    ["codexTransport", "CODEX_TRANSPORT"],
    ["provider", "PRISM_AGENT_PROVIDER"],
    ["agentType", "PRISM_AGENT_PROVIDER"],
    ["httpsProxy", "HTTPS_PROXY"],
    ["httpProxy", "HTTP_PROXY"],
  ];

  for (const [configKey, envKey] of mapping) {
    const val = config[configKey];
    if (typeof val === "string" && val && (force || !process.env[envKey])) {
      process.env[envKey] = val;
    }
  }
}
