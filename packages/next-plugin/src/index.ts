import type { NextConfig } from "next";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { findWidgetScript, findAgentCli, type PrismDesignOptions } from "./shared.js";

export type { PrismDesignOptions };

const PRISM_PUBLIC_DIR = "__prism-design__";

// Module-level state (shared across webpack compilations)
let agentProcess: ChildProcess | null = null;
let started = false;

function log(msg: string) {
  console.log(`[PrismDesign] ${msg}`);
}

function warn(msg: string) {
  console.warn(`[PrismDesign] ${msg}`);
}

function ensurePublicDir(projectRoot: string): string {
  const dir = path.join(projectRoot, "public", PRISM_PUBLIC_DIR);
  fs.mkdirSync(dir, { recursive: true });
  // Write .gitignore to prevent accidental commits
  const gitignorePath = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n");
  }
  return dir;
}

function copyWidget(projectRoot: string): boolean {
  const widgetPath = findWidgetScript();
  if (!widgetPath) {
    warn("Widget script not found. Install prism-design-widget.");
    return false;
  }
  const dir = ensurePublicDir(projectRoot);
  fs.copyFileSync(widgetPath, path.join(dir, "widget.js"));
  return true;
}

function writeInitScript(projectRoot: string, options: PrismDesignOptions): void {
  const dir = ensurePublicDir(projectRoot);
  const initOpts: Record<string, string> = {};
  if (options.position && options.position !== "bottom-right") {
    initOpts.position = options.position;
  }
  if (options.locale) initOpts.locale = options.locale;

  // This script runs in the browser, loads widget.js dynamically, fetches config, and inits
  const script = `
(function() {
  if (typeof window === 'undefined') return;

  function initWidget(agentUrl) {
    var opts = ${JSON.stringify(initOpts)};
    if (agentUrl) opts.agentUrl = agentUrl;
    if (window.PrismDesignWidget && window.PrismDesignWidget.init) {
      window.PrismDesignWidget.init(opts);
    }
  }

  function loadWidgetAndInit() {
    // Fetch agent config
    fetch('/__prism-design__/config.json')
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(config) {
        var agentUrl;
        if (config && config.agentPort) {
          agentUrl = 'http://' + location.hostname + ':' + config.agentPort;
        } else if (config && config.agentUrl) {
          agentUrl = config.agentUrl;
        }
        initWidget(agentUrl);
      })
      .catch(function() {
        initWidget();
      });
  }

  // Load widget.js via script tag
  if (window.PrismDesignWidget) {
    loadWidgetAndInit();
    return;
  }
  var script = document.createElement('script');
  script.src = '/__prism-design__/widget.js';
  script.onload = loadWidgetAndInit;
  document.head.appendChild(script);
})();
`;
  fs.writeFileSync(path.join(dir, "init.js"), script);
}

function startAgent(
  projectRoot: string,
  options: PrismDesignOptions
): void {
  const {
    agentPort: preferredPort = 9527,
    agentType = "claude",
    agentAutoStart = true,
    agentUrl: agentUrlOverride,
    apiKey,
    baseUrl,
    model,
  } = options;

  // If running inside a workspace container, reuse its agent
  const effectiveAgentUrl = agentUrlOverride || process.env.PRISM_AGENT_URL;

  if (effectiveAgentUrl) {
    const dir = ensurePublicDir(projectRoot);
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ agentUrl: effectiveAgentUrl }) + "\n"
    );
    log(`Using existing agent at ${effectiveAgentUrl}`);
    return;
  }

  if (!agentAutoStart) return;

  const agentCli = findAgentCli();
  if (!agentCli) {
    warn("Agent CLI not found. Install prism-design-agent or run agent manually.");
    log("Widget will show connection form for manual URL input.");
    return;
  }

  const agentEnv = { ...process.env };
  if (apiKey) agentEnv.ANTHROPIC_API_KEY = apiKey;
  if (baseUrl) agentEnv.ANTHROPIC_BASE_URL = baseUrl;
  if (model) agentEnv.ANTHROPIC_MODEL = model;

  const proc = spawn(
    "node",
    [agentCli, "start", "--port", String(preferredPort), "--project", projectRoot, "--agent-type", agentType],
    { stdio: ["ignore", "pipe", "pipe"], env: agentEnv }
  );
  agentProcess = proc;

  const timeout = setTimeout(() => {
    writeAgentConfig(projectRoot, preferredPort);
    log(`Agent port detection timed out, assuming port ${preferredPort}`);
  }, 15000);

  proc.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    const match = text.match(/__PRISM_AGENT_PORT__=(\d+)/);
    if (match) {
      clearTimeout(timeout);
      const port = parseInt(match[1], 10);
      writeAgentConfig(projectRoot, port);
      log(`Agent ready on port ${port}`);
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("__PRISM_AGENT_PORT__")) {
        log(`[Agent] ${trimmed}`);
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) warn(`[Agent] ${msg}`);
  });

  proc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      warn(`Agent exited with code ${code}`);
    }
    agentProcess = null;
  });
}

function writeAgentConfig(projectRoot: string, port: number) {
  const dir = ensurePublicDir(projectRoot);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ agentPort: port }) + "\n"
  );
}

function cleanup(projectRoot: string) {
  if (agentProcess) {
    agentProcess.kill("SIGTERM");
    agentProcess = null;
  }
  const dir = path.join(projectRoot, "public", PRISM_PUBLIC_DIR);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

/**
 * Next.js config wrapper that enables PrismDesign in development.
 * Zero intrusion — only modify next.config.ts, no component needed.
 *
 * Usage:
 * ```ts
 * // next.config.ts
 * import { withPrismDesign } from 'next-plugin-prism-design';
 * export default withPrismDesign()({ reactStrictMode: true });
 * ```
 */
export function withPrismDesign(options: PrismDesignOptions = {}) {
  return (nextConfig: NextConfig = {}): NextConfig => {
    // Only activate in development
    if (process.env.NODE_ENV === "production") return nextConfig;

    return {
      ...nextConfig,
      webpack(config, context) {
        // Chain with user's webpack config
        if (typeof nextConfig.webpack === "function") {
          config = nextConfig.webpack(config, context);
        }

        // Only run on client-side dev compilation, and only once
        if (!context.isServer && context.dev && !started) {
          started = true;
          const projectRoot = context.dir || process.cwd();

          // Copy widget.js to public/
          copyWidget(projectRoot);

          // Write init.js to public/
          writeInitScript(projectRoot, options);

          // Start agent
          startAgent(projectRoot, options);

          // Inject init.js into the client-side main-app webpack entry
          const initScriptPath = path.join(projectRoot, "public", PRISM_PUBLIC_DIR, "init.js");
          const originalEntry = config.entry;
          config.entry = async () => {
            const entries = typeof originalEntry === "function"
              ? await originalEntry()
              : { ...originalEntry };

            if (Array.isArray(entries["main-app"])) {
              entries["main-app"].push(initScriptPath);
            }
            return entries;
          };

          // Register cleanup
          const doCleanup = () => cleanup(projectRoot);
          process.on("exit", doCleanup);
          process.on("SIGINT", () => { doCleanup(); process.exit(0); });
          process.on("SIGTERM", () => { doCleanup(); process.exit(0); });
        }

        return config;
      },
    };
  };
}
