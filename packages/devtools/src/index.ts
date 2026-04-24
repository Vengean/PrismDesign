import type { Plugin, ResolvedConfig } from "vite";
import { getClientCode } from "./client/inject.js";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export interface PrismDesignOptions {
  /** Agent server port (default: 9527) */
  agentPort?: number;
  /** Shortcut key to toggle the panel (default: "Tab") */
  toggleKey?: string;
  /** Auto-start agent service (default: true) */
  autoStartAgent?: boolean;
  /** Skip AI convention analysis for faster startup (default: false) */
  skipAnalysis?: boolean;
}

export default function prismDesign(options: PrismDesignOptions = {}): Plugin {
  const {
    agentPort = 9527,
    toggleKey = "Tab",
    autoStartAgent = true,
    skipAnalysis = false,
  } = options;

  let agentProcess: ChildProcess | null = null;
  let projectRoot: string;

  return {
    name: "vite-plugin-prism-design",
    apply: "serve",

    configResolved(config: ResolvedConfig) {
      projectRoot = config.root;
    },

    configureServer() {
      if (!autoStartAgent) return;

      // Find the agent CLI entry
      let agentBin: string;
      try {
        // Resolve from the project's node_modules
        agentBin = require.resolve("@prism-design/agent/dist/cli.js", {
          paths: [projectRoot],
        });
      } catch {
        // Fallback: resolve relative to this package
        agentBin = path.resolve(
          path.dirname(new URL(import.meta.url).pathname),
          "../../agent/dist/cli.js"
        );
      }

      const args = ["start", "--port", String(agentPort), "--project", projectRoot];
      if (skipAnalysis) args.push("--skip-analysis");

      agentProcess = spawn("node", [agentBin, ...args], {
        stdio: "inherit",
        cwd: projectRoot,
      });

      agentProcess.on("error", (err) => {
        console.warn(`[PrismDesign] Failed to start agent: ${err.message}`);
        console.warn(`[PrismDesign] You can start it manually: pnpm dev:agent --project ${projectRoot}`);
        agentProcess = null;
      });

      agentProcess.on("exit", (code) => {
        if (code !== null && code !== 0) {
          console.warn(`[PrismDesign] Agent exited with code ${code}`);
        }
        agentProcess = null;
      });
    },

    transformIndexHtml(html) {
      const clientScript = getClientCode({ agentPort, toggleKey });
      return html.replace(
        "</body>",
        `<script type="module">${clientScript}</script></body>`
      );
    },

    buildEnd() {
      if (agentProcess) {
        agentProcess.kill();
        agentProcess = null;
      }
    },
  };
}
