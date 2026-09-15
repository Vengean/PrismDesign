import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PrismStudioOptions {
  /** Agent server port (default: 9527, auto-increments if occupied) */
  agentPort?: number;
  /** Disable auto-starting agent (if you run it manually) */
  agentAutoStart?: boolean;
  /** Agent URL override (skips auto-start, connects to existing agent) */
  agentUrl?: string;
  /** Widget position (default: "bottom-right") */
  position?: "bottom-right" | "bottom-left";
  /** Widget locale override */
  locale?: "zh" | "en";
  /** Inject the in-page Widget. Set false when using the Chrome extension UI. Default: true. */
  widget?: boolean;
}

// Require from project root (fallback when plugin's own require can't resolve hoisted deps)
const projectRequire = createRequire(path.join(process.cwd(), "package.json"));

export function findWidgetScript(): string | null {
  // Strategy 1: resolve from plugin's node_modules
  try {
    const widgetPkg = require.resolve("@prism-studio-ai/widget/package.json");
    const iifeFile = path.join(path.dirname(widgetPkg), "dist", "prism-studio-widget.iife.js");
    if (fs.existsSync(iifeFile)) return iifeFile;
  } catch {}

  // Strategy 2: resolve from project root node_modules
  try {
    const widgetPkg = projectRequire.resolve("@prism-studio-ai/widget/package.json");
    const iifeFile = path.join(path.dirname(widgetPkg), "dist", "prism-studio-widget.iife.js");
    if (fs.existsSync(iifeFile)) return iifeFile;
  } catch {}

  // Strategy 3: monorepo sibling
  try {
    const candidate = path.resolve(__dirname, "../../widget/dist/prism-studio-widget.iife.js");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  return null;
}

export function findAgentCli(): string | null {
  // Strategy 1: resolve from plugin's node_modules
  try {
    const agentPkg = require.resolve("@prism-studio-ai/agent/package.json");
    const cliFile = path.join(path.dirname(agentPkg), "dist", "cli.js");
    if (fs.existsSync(cliFile)) return cliFile;
  } catch {}

  // Strategy 2: resolve from project root node_modules
  try {
    const agentPkg = projectRequire.resolve("@prism-studio-ai/agent/package.json");
    const cliFile = path.join(path.dirname(agentPkg), "dist", "cli.js");
    if (fs.existsSync(cliFile)) return cliFile;
  } catch {}

  // Strategy 3: monorepo sibling
  try {
    const candidate = path.resolve(__dirname, "../../agent/dist/cli.js");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  return null;
}
