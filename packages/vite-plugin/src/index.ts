import type { Plugin, ResolvedConfig } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);


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
  /** AI model name (passed to agent as ANTHROPIC_MODEL, e.g. "claude-sonnet-4-20250514") */
  model?: string;
  /** Widget position (default: "bottom-right") */
  position?: "bottom-right" | "bottom-left";
  /** Widget locale override */
  locale?: "zh" | "en";
}

function findWidgetScript(): string | null {
  // Strategy 1: resolve from prism-design-widget package
  try {
    const widgetPkg = require.resolve("prism-design-widget/package.json");
    const widgetDir = path.dirname(widgetPkg);
    const iifeFile = path.join(widgetDir, "dist", "prism-design-widget.iife.js");
    if (fs.existsSync(iifeFile)) return iifeFile;
  } catch {}

  // Strategy 2: look relative to this package
  try {
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    const candidate = path.resolve(thisDir, "../../widget/dist/prism-design-widget.iife.js");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  return null;
}

function findAgentCli(): string | null {
  // Strategy 1: resolve from node_modules (npm/pnpm installed)
  try {
    const agentPkg = require.resolve("prism-design-agent/package.json");
    const agentDir = path.dirname(agentPkg);
    const cliFile = path.join(agentDir, "dist", "cli.js");
    if (fs.existsSync(cliFile)) return cliFile;
  } catch {}

  // Strategy 2: monorepo sibling
  try {
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    const candidate = path.resolve(thisDir, "../../agent/dist/cli.js");
    if (fs.existsSync(candidate)) return candidate;
  } catch {}

  return null;
}


export default function prismDesign(options: PrismDesignOptions = {}): Plugin {
  const {
    agentPort: preferredPort = 9527,
    agentType = "claude",
    agentAutoStart = true,
    agentUrl: agentUrlOverride,
    apiKey,
    baseUrl,
    model,
    position = "bottom-right",
    locale,
  } = options;

  let agentProcess: ChildProcess | null = null;
  // If running inside a workspace container, reuse its agent
  let agentUrl = agentUrlOverride || process.env.PRISM_AGENT_URL || "";
  let widgetJs = "";
  let config: ResolvedConfig;

  return {
    name: "prism-design",
    apply: "serve", // Dev only

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    async configureServer(server) {
      // Load widget script
      const widgetPath = findWidgetScript();
      if (widgetPath) {
        widgetJs = fs.readFileSync(widgetPath, "utf-8");
      } else {
        config.logger.warn("[PrismDesign] Widget script not found. Run: pnpm build:widget");
        return;
      }

      // Serve widget JS at a virtual path
      server.middlewares.use("/__prism__/widget.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Cache-Control", "no-store");
        res.end(widgetJs);
      });

      // Start agent if needed (skip if agentUrl already set via option or PRISM_AGENT_URL env)
      if (!agentUrl && agentAutoStart) {
        const agentCli = findAgentCli();
        if (agentCli) {
          const projectRoot = config.root || process.cwd();

          const agentEnv: Record<string, string> = { ...process.env } as Record<string, string>;
          if (apiKey) agentEnv.ANTHROPIC_API_KEY = apiKey;
          if (baseUrl) agentEnv.ANTHROPIC_BASE_URL = baseUrl;
          if (model) agentEnv.ANTHROPIC_MODEL = model;

          agentProcess = spawn("node", [agentCli, "start", "--port", String(preferredPort), "--project", projectRoot, "--agent-type", agentType], {
            stdio: ["ignore", "pipe", "pipe"],
            env: agentEnv,
          });

          // Parse actual port from agent stdout marker
          const portPromise = new Promise<number>((resolve) => {
            const timeout = setTimeout(() => resolve(preferredPort), 15000);
            agentProcess!.stdout?.on("data", (data: Buffer) => {
              const text = data.toString();
              const match = text.match(/__PRISM_AGENT_PORT__=(\d+)/);
              if (match) {
                clearTimeout(timeout);
                resolve(parseInt(match[1], 10));
              }
              // Forward non-marker lines to logger
              for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith("__PRISM_AGENT_PORT__")) {
                  config.logger.info(`[PrismDesign Agent] ${trimmed}`);
                }
              }
            });
          });

          agentProcess.stderr?.on("data", (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) config.logger.warn(`[PrismDesign Agent] ${msg}`);
          });

          agentProcess.on("exit", (code) => {
            if (code !== null && code !== 0) {
              config.logger.error(`[PrismDesign] Agent exited with code ${code}`);
            }
            agentProcess = null;
          });

          const actualPort = await portPromise;
          // Use __AGENT_PORT__ marker — actual URL is resolved in browser using location.hostname
          agentUrl = `__AGENT_PORT__:${actualPort}`;
          config.logger.info(`[PrismDesign] Agent ready on port ${actualPort}`);
        } else {
          config.logger.warn("[PrismDesign] Agent CLI not found. Install prism-design-agent or run agent manually.");
          config.logger.info("[PrismDesign] Widget will show connection form for manual URL input.");
        }
      } else if (agentUrl) {
        config.logger.info(`[PrismDesign] Using existing agent at ${agentUrl}`);
      }

      // Cleanup on server close
      server.httpServer?.on("close", () => {
        if (agentProcess) {
          agentProcess.kill("SIGTERM");
          agentProcess = null;
        }
      });
    },

    transformIndexHtml() {
      const initOptions: Record<string, string> = {};
      if (position !== "bottom-right") initOptions.position = position;
      if (locale) initOptions.locale = locale;

      // Build init script — resolve agent URL dynamically using page hostname
      let initScript: string;
      if (agentUrl.startsWith("__AGENT_PORT__:")) {
        const port = agentUrl.split(":")[1];
        const optionsJson = JSON.stringify(initOptions);
        // Merge dynamic agentUrl into options at runtime
        initScript = `(function(){var o=${optionsJson};o.agentUrl="http://"+location.hostname+":${port}";PrismDesignWidget.init(o)})();`;
      } else if (agentUrl) {
        initOptions.agentUrl = agentUrl;
        initScript = `PrismDesignWidget.init(${JSON.stringify(initOptions)});`;
      } else {
        initScript = `PrismDesignWidget.init(${JSON.stringify(initOptions)});`;
      }

      return [
        {
          tag: "script",
          attrs: { src: "/__prism__/widget.js" },
          injectTo: "body" as const,
        },
        {
          tag: "script",
          children: initScript,
          injectTo: "body" as const,
        },
      ];
    },
  };
}
