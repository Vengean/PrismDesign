#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { startServer } from "./server.js";
import { loadConfig, applyConfigToEnv } from "./config.js";

// ── .env loader (lightweight, no dependency) ──

function loadEnvFile(dir: string) {
  const envPath = path.join(dir, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Helpers ──

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

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "--help" || command === "-h") {
    console.log(`
PrismDesign Agent

Usage:
  prism-design-agent start [options]

Options:
  --port <number>        服务端口 (default: 9527)
  --project <path>       项目根目录 (default: 当前目录)
  --api-key <key>        API Key
  --api-base-url <url>   API Base URL
  --model <name>         模型名称
  --provider <type>      Agent Provider: claude | claude-sub | openai | codex | glm
  --agent-type <type>    --provider 的兼容别名
`);
    process.exit(0);
  }

  // Determine project root
  const projectArg = getArg(args, "--project");
  const projectRoot = projectArg ? path.resolve(projectArg) : process.cwd();

  // Load .env files (lowest priority)
  loadEnvFile(projectRoot);

  // Load prism.config (overrides .env)
  const config = await loadConfig(projectRoot);
  applyConfigToEnv(config, true);

  // CLI args override everything
  const providerArg = getArg(args, "--provider") || getArg(args, "--agent-type");
  if (providerArg) process.env.PRISM_AGENT_PROVIDER = providerArg;
  const agentType = process.env.PRISM_AGENT_PROVIDER || process.env.AGENT_TYPE || "claude";

  const apiKey = getArg(args, "--api-key");
  if (apiKey && agentType !== "codex") process.env[agentType === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"] = apiKey;

  const baseUrl = getArg(args, "--api-base-url");
  if (baseUrl) process.env[agentType === "openai" ? "OPENAI_BASE_URL" : "ANTHROPIC_BASE_URL"] = baseUrl;

  const model = getArg(args, "--model");
  if (model) process.env[agentType === "openai" ? "OPENAI_MODEL" : agentType === "codex" ? "CODEX_MODEL" : "ANTHROPIC_MODEL"] = model;

  const port = parseInt(getArg(args, "--port") || "9527", 10);

  // Determine agent type and model display
  const modelName = agentType === "codex"
    ? (process.env.CODEX_MODEL || "Codex CLI default")
    : agentType === "openai"
    ? (process.env.OPENAI_MODEL || "gpt-5.6")
    : agentType === "glm"
    ? (process.env.ANTHROPIC_MODEL || "glm-5.1")
    : (process.env.ANTHROPIC_MODEL || "claude-opus-4-6");

  const localIP = getLocalIP();

  console.log("\n" + "=".repeat(50));
  console.log("  PrismDesign Agent");
  console.log("=".repeat(50));

  const { port: actualPort } = await startServer(projectRoot, port);

  // Machine-readable marker for tooling (e.g. vite-plugin) to detect actual port
  console.log(`__PRISM_AGENT_PORT__=${actualPort}`);

  console.log(`\n  服务地址:  http://${localIP}:${actualPort}`);
  console.log(`  项目目录:  ${projectRoot}`);
  console.log(`  Agent:     ${agentType === "codex" ? "Codex SDK (ChatGPT login)" : agentType === "openai" ? "OpenAI Agents SDK" : agentType === "glm" ? "GLM (glm-acp-agent)" : "Claude Agent SDK"}`);
  console.log(`  模型:      ${modelName}`);
  const configuredBaseUrl = agentType === "openai" ? process.env.OPENAI_BASE_URL : process.env.ANTHROPIC_BASE_URL;
  if (configuredBaseUrl) {
    console.log(`  API 代理:  ${configuredBaseUrl}`);
  }
  console.log("\n" + "=".repeat(50) + "\n");
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
