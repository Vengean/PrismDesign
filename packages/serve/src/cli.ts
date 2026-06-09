#!/usr/bin/env node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer } from "./server.js";

// ── Helpers ──

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

async function waitForAgent(url: string, maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ── Agent child process ──

function startAgent(opts: {
  agentPort: number;
  apiKey?: string;
  model?: string;
  apiBaseUrl?: string;
}): ChildProcess {
  const args = ["prism-design-agent", "start", "--port", String(opts.agentPort)];
  if (opts.apiKey) args.push("--api-key", opts.apiKey);
  if (opts.model) args.push("--model", opts.model);
  if (opts.apiBaseUrl) args.push("--api-base-url", opts.apiBaseUrl);

  const child = spawn("npx", args, {
    stdio: "pipe",
    env: { ...process.env },
  });

  child.stdout?.on("data", (data: Buffer) => {
    process.stdout.write(data);
  });

  child.stderr?.on("data", (data: Buffer) => {
    process.stderr.write(data);
  });

  child.on("error", (err) => {
    console.error("❌ 启动 Agent 失败:", err.message);
    console.error("   请确保已安装 prism-design-agent: npm install -g prism-design-agent");
  });

  return child;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);

  if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log(`
🎨 PrismDesign Serve

Usage:
  prism-design-serve [options]

Options:
  --port <number>          HTTP 服务端口 (default: 3000)
  --agent-port <number>    Agent 服务端口 (default: 9527)
  --no-agent               不启动 Agent，仅提供静态文件服务
  --dir <path>             静态文件目录 (default: 当前目录)
  --api-key <key>          Anthropic API Key (转发给 Agent)
  --api-base-url <url>     API Base URL (转发给 Agent)
  --model <name>           模型名称 (转发给 Agent)
  --open                   启动后自动打开浏览器

Examples:
  prism-design-serve
  prism-design-serve --dir ./dist --open
  prism-design-serve --port 8080 --agent-port 9000
  prism-design-serve --no-agent
`);
    process.exit(0);
  }

  const port = parseInt(getArg(args, "--port") || "3000", 10);
  const agentPort = parseInt(getArg(args, "--agent-port") || "9527", 10);
  const noAgent = hasFlag(args, "--no-agent");
  const dir = path.resolve(getArg(args, "--dir") || process.cwd());
  const shouldOpen = hasFlag(args, "--open");
  const apiKey = getArg(args, "--api-key");
  const model = getArg(args, "--model");
  const apiBaseUrl = getArg(args, "--api-base-url");

  // Validate directory
  if (!fs.existsSync(dir)) {
    console.error(`❌ 目录不存在: ${dir}`);
    process.exit(1);
  }

  const localIP = getLocalIP();
  const agentUrl = `http://localhost:${agentPort}`;

  let agentChild: ChildProcess | null = null;

  // Start agent
  if (!noAgent) {
    console.log("🤖 启动 Agent...");
    agentChild = startAgent({ agentPort, apiKey, model, apiBaseUrl });

    console.log("⏳ 等待 Agent 就绪...");
    const ready = await waitForAgent(agentUrl);
    if (!ready) {
      console.error("❌ Agent 启动超时，继续启动 HTTP 服务（Agent 功能不可用）");
    } else {
      console.log("✅ Agent 已就绪");
    }
  }

  // Start HTTP server
  startServer({ dir, port, agentUrl });

  console.log("\n" + "=".repeat(50));
  console.log("  🎨 PrismDesign Serve");
  console.log("=".repeat(50));
  console.log(`\n  静态文件:  ${dir}`);
  console.log(`  访问地址:  http://${localIP}:${port}`);
  if (!noAgent) {
    console.log(`  Agent:     ${agentUrl}`);
  }
  console.log(`\n  👉 访问页面后右下角会出现 PrismDesign 按钮`);
  console.log("\n" + "=".repeat(50) + "\n");

  // Open browser
  if (shouldOpen) {
    const openModule = await import("open");
    openModule.default(`http://localhost:${port}`);
  }

  // Cleanup on exit
  function cleanup() {
    if (agentChild) {
      agentChild.kill("SIGTERM");
      agentChild = null;
    }
    process.exit(0);
  }

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
