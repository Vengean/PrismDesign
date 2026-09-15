import type { Plugin, ResolvedConfig } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

const require = createRequire(import.meta.url);


export interface PrismDesignOptions {
  /** Agent server port (default: 9527, auto-increments if occupied) */
  agentPort?: number;
  /** Agent provider: Claude, OpenAI Agents SDK, Codex SDK, or GLM (default: "claude") */
  agentType?: "claude" | "claude-sub" | "openai" | "codex" | "glm";
  /** Disable auto-starting agent (if you run it manually) */
  agentAutoStart?: boolean;
  /** Require the Agent's random startup token. Default: true. */
  agentAccessToken?: boolean;
  /** Agent URL override (skips auto-start, connects to existing agent) */
  agentUrl?: string;
  /** Provider API key. Not used by the Codex subscription-login provider. */
  apiKey?: string;
  /** Provider API base URL (for example a LiteLLM proxy). */
  baseUrl?: string;
  /** Provider model override. */
  model?: string;
  /** HTTP proxy inherited by the Agent process (HTTP_PROXY). */
  httpProxy?: string;
  /** HTTPS proxy inherited by the Agent process (HTTPS_PROXY). */
  httpsProxy?: string;
  /** Hosts that bypass the proxy (NO_PROXY). */
  noProxy?: string;
  /** Codex transport override (CODEX_TRANSPORT). */
  codexTransport?: "websocket" | "sse";
  /** Log full Agent prompt bodies (PRISM_AGENT_DEBUG). */
  agentDebug?: boolean;
  /** Widget position (default: "bottom-right") */
  position?: "bottom-right" | "bottom-left";
  /** Widget locale override */
  locale?: "zh" | "en";
  /** Inject the in-page Widget. Set false when using the Chrome extension UI. Default: true. */
  widget?: boolean;
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


/** Set up a reverse proxy on the Vite dev server to forward agent requests */
function setupAgentProxy(server: any, targetBaseUrl: string) {
  const target = new URL(targetBaseUrl);

  // HTTP proxy: /__prism_agent__/api/* → agent /api/*
  server.middlewares.use("/__prism_agent__", (req: any, res: any) => {
    const proxyReq = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: req.url || "/",
        method: req.method,
        headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Agent 服务无响应" }));
    });
    req.pipe(proxyReq);
  });

  // WebSocket proxy: /__prism_agent__/ws → agent /ws
  server.httpServer?.on("upgrade", (req: http.IncomingMessage, socket: any, head: Buffer) => {
    if (!req.url?.startsWith("/__prism_agent__/ws")) return;

    const wsReq = http.request({
      hostname: target.hostname,
      port: target.port,
      path: req.url.replace(/^\/__prism_agent__/, "") || "/ws",
      method: "GET",
      headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
    });

    wsReq.on("upgrade", (_proxyRes, proxySocket, proxyHead) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        Object.entries(_proxyRes.headers)
          .filter(([k]) => !["upgrade", "connection"].includes(k.toLowerCase()))
          .map(([k, v]) => `${k}: ${v}`)
          .join("\r\n") +
        "\r\n\r\n"
      );
      if (proxyHead.length) socket.write(proxyHead);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on("error", () => socket.destroy());
      socket.on("error", () => proxySocket.destroy());
    });

    wsReq.on("error", () => socket.destroy());
    wsReq.end();
  });
}

export default function prismDesign(options: PrismDesignOptions = {}): Plugin {
  const {
    agentPort: preferredPort = 9527,
    agentType = "claude",
    agentAutoStart = true,
    agentAccessToken = true,
    agentUrl: agentUrlOverride,
    apiKey,
    baseUrl,
    model,
    httpProxy,
    httpsProxy,
    noProxy,
    codexTransport,
    agentDebug,
    position = "bottom-right",
    locale,
    widget = true,
  } = options;

  let agentProcess: ChildProcess | null = null;
  let agentToken = "";
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
      if (widget) {
        // Widget is optional: Chrome-extension-only mode still starts the Agent.
        const widgetPath = findWidgetScript();
        if (widgetPath) {
          widgetJs = fs.readFileSync(widgetPath, "utf-8");
        } else {
          config.logger.warn("[PrismDesign] Widget script not found. Run: pnpm build:widget");
          return;
        }

        server.middlewares.use("/__prism__/widget.js", (_req, res) => {
          res.setHeader("Content-Type", "application/javascript");
          res.setHeader("Cache-Control", "no-store");
          res.end(widgetJs);
        });
      } else {
        config.logger.info("[PrismDesign] Widget injection disabled; use the Chrome extension to connect to the Agent.");
      }

      // If agent is on localhost (e.g. inside a container), proxy through the Vite dev server
      // so the browser can reach it via the same origin (no port mapping issues)
      let proxyingAgent = false;
      if (agentUrl && !agentUrlOverride) {
        const localMatch = agentUrl.match(/^(https?:\/\/(?:localhost|127\.0\.0\.1):\d+)(\/.*)?$/);
        if (localMatch) {
          const localAgentUrl = localMatch[1];
          setupAgentProxy(server, localAgentUrl);
          proxyingAgent = true;
          agentUrl = "__PROXY__";
          config.logger.info(`[PrismDesign] Proxying agent via dev server (${localAgentUrl})`);
        }
      }

      // Start agent if needed (skip if agentUrl already set via option or PRISM_AGENT_URL env)
      if (!agentUrl && agentAutoStart) {
        const agentCli = findAgentCli();
        if (agentCli) {
          const projectRoot = config.root || process.cwd();

          const agentEnv: Record<string, string> = { ...process.env } as Record<string, string>;
          if (httpProxy !== undefined) agentEnv.HTTP_PROXY = httpProxy;
          if (httpsProxy !== undefined) agentEnv.HTTPS_PROXY = httpsProxy;
          if (noProxy !== undefined) agentEnv.NO_PROXY = noProxy;
          if (codexTransport !== undefined) agentEnv.CODEX_TRANSPORT = codexTransport;
          if (agentDebug !== undefined) agentEnv.PRISM_AGENT_DEBUG = agentDebug ? "1" : "0";
          // Dev servers show structured Agent/tool diagnostics by default.
          // Full prompt bodies remain opt-in through PRISM_AGENT_DEBUG=1.
          if (agentEnv.PRISM_AGENT_DEBUG_EVENTS === undefined) agentEnv.PRISM_AGENT_DEBUG_EVENTS = "1";
          if (agentType === "openai") {
            if (apiKey) agentEnv.OPENAI_API_KEY = apiKey;
            if (baseUrl) agentEnv.OPENAI_BASE_URL = baseUrl;
            if (model) agentEnv.OPENAI_MODEL = model;
          } else if (agentType === "codex") {
            if (model) agentEnv.CODEX_MODEL = model;
          } else {
            if (apiKey) agentEnv.ANTHROPIC_API_KEY = apiKey;
            if (baseUrl) agentEnv.ANTHROPIC_BASE_URL = baseUrl;
            if (model) agentEnv.ANTHROPIC_MODEL = model;
          }

          const agentArgs = [agentCli, "start", "--port", String(preferredPort), "--project", projectRoot, "--provider", agentType];
          if (!agentAccessToken) agentArgs.push("--no-access-token");
          agentProcess = spawn("node", agentArgs, {
            stdio: ["ignore", "pipe", "pipe"],
            env: agentEnv,
          });

          // Parse actual port from agent stdout marker
          const portPromise = new Promise<number>((resolve) => {
            const timeout = setTimeout(() => resolve(preferredPort), 15000);
            agentProcess!.stdout?.on("data", (data: Buffer) => {
              const text = data.toString();
              const match = text.match(/__PRISM_AGENT_PORT__=(\d+)/);
              const tokenMatch = text.match(/__PRISM_AGENT_TOKEN__=([a-f0-9]+)/);
              if (tokenMatch) agentToken = tokenMatch[1];
              if (match) {
                clearTimeout(timeout);
                resolve(parseInt(match[1], 10));
              }
              // Forward non-marker lines to logger
              for (const line of text.split("\n")) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith("__PRISM_AGENT_PORT__") && !trimmed.startsWith("__PRISM_AGENT_TOKEN__")) {
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
          // Proxy agent through Vite dev server for consistent access
          setupAgentProxy(server, `http://localhost:${actualPort}`);
          proxyingAgent = true;
          agentUrl = "__PROXY__";
          config.logger.info(`[PrismDesign] Agent ready on port ${actualPort} (proxied via dev server)`);
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
      if (!widget) return [];
      const initOptions: Record<string, string | boolean> = {};
      if (agentToken) initOptions.agentToken = agentToken;
      if (!agentAccessToken) initOptions.accessTokenRequired = false;
      if (position !== "bottom-right") initOptions.position = position;
      if (locale) initOptions.locale = locale;

      // Build init script — resolve agent URL dynamically
      let initScript: string;
      if (agentUrl === "__PROXY__") {
        // Agent is proxied through Vite dev server at /__prism_agent__
        const optionsJson = JSON.stringify(initOptions);
        initScript = `(function(){var o=${optionsJson};o.agentUrl=location.origin+"/__prism_agent__";PrismDesignWidget.init(o)})();`;
      } else if (agentUrl.startsWith("__AGENT_PORT__:")) {
        const port = agentUrl.split(":")[1];
        const optionsJson = JSON.stringify(initOptions);
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
