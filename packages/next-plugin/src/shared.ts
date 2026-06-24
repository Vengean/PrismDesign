import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PrismDesignOptions {
  /** Agent server port (default: 9527, auto-increments if occupied) */
  agentPort?: number;
  /** Agent type: "claude" | "glm" (default: "claude") */
  agentType?: "claude" | "glm";
  /** Disable auto-starting agent (if you run it manually) */
  agentAutoStart?: boolean;
  /** Agent URL override (skips auto-start, connects to existing agent) */
  agentUrl?: string;
  /** API Key for the AI model (passed to agent as ANTHROPIC_API_KEY) */
  apiKey?: string;
  /** API Base URL (passed to agent as ANTHROPIC_BASE_URL, e.g. LiteLLM proxy) */
  baseUrl?: string;
  /** AI model name (passed to agent as ANTHROPIC_MODEL) */
  model?: string;
  /** Widget position (default: "bottom-right") */
  position?: "bottom-right" | "bottom-left";
  /** Widget locale override */
  locale?: "zh" | "en";
}

export function findWidgetScript(): string | null {
  // Strategy 1: resolve from node_modules
  try {
    const widgetPkg = require.resolve("prism-design-widget/package.json");
    const widgetDir = path.dirname(widgetPkg);
    const iifeFile = path.join(widgetDir, "dist", "prism-design-widget.iife.js");
    if (fs.existsSync(iifeFile)) return iifeFile;
  } catch {}

  // Strategy 2: monorepo sibling
  try {
    const thisDir = __dirname;
    const candidate = path.resolve(thisDir, "../../widget/dist/prism-design-widget.iife.js");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  return null;
}

export function findAgentCli(): string | null {
  // Strategy 1: resolve from node_modules
  try {
    const agentPkg = require.resolve("prism-design-agent/package.json");
    const agentDir = path.dirname(agentPkg);
    const cliFile = path.join(agentDir, "dist", "cli.js");
    if (fs.existsSync(cliFile)) return cliFile;
  } catch {}

  // Strategy 2: monorepo sibling
  try {
    const thisDir = __dirname;
    const candidate = path.resolve(thisDir, "../../agent/dist/cli.js");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  return null;
}
