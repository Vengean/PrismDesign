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

function validateChoice(name: string, value: string | undefined, choices: string[]) {
  if (value && !choices.includes(value)) throw new Error(`${name} must be one of: ${choices.join(", ")}`);
}

// ── Main ──

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "--help" || command === "-h") {
    console.log(`
Prism Studio Agent

Usage:
  prism-studio-agent start [options]

Options:
  --port <number>        服务端口 (default: 9527)
  --project <path>       项目根目录 (default: 当前目录)
  --provider <type>      Agent Provider: claude | claude-sub | openai | codex | glm
  --api-key <key>        Provider API Key（Codex 登录模式不需要）
  --api-base-url <url>   Provider API Base URL
  --model <name>         模型名称
`);
    process.exit(0);
  }

  // Determine project root
  const projectArg = getArg(args, "--project");
  const configRoot = projectArg ? path.resolve(projectArg) : process.cwd();
  const config = await loadConfig(configRoot);
  const projectRoot = projectArg
    ? configRoot
    : config.project
      ? path.resolve(configRoot, config.project)
      : configRoot;

  // Load .env files (lowest priority), then apply prism.config over them.
  loadEnvFile(projectRoot);
  applyConfigToEnv(config, true);

  process.env.PRISM_PERMISSION_FILESYSTEM ||= "workspace-write";
  process.env.PRISM_PERMISSION_COMMANDS ||= "none";
  process.env.PRISM_PERMISSION_NETWORK ||= "false";
  process.env.PRISM_PERMISSION_BROWSER ||= "true";
  process.env.PRISM_PERMISSION_MCP ||= "false";
  process.env.PRISM_MCP_APPROVAL ||= "prompt";
  validateChoice("filesystem", process.env.PRISM_PERMISSION_FILESYSTEM, ["read-only", "workspace-write"]);
  validateChoice("commands", process.env.PRISM_PERMISSION_COMMANDS, ["none", "workspace"]);
  validateChoice("mcp.defaultApproval", process.env.PRISM_MCP_APPROVAL, ["approve", "prompt", "deny"]);

  // CLI args override everything
  const providerArg = getArg(args, "--provider");
  if (providerArg) process.env.PRISM_AGENT_PROVIDER = providerArg;
  const agentType = process.env.PRISM_AGENT_PROVIDER || process.env.AGENT_TYPE || "claude";

  const apiKey = getArg(args, "--api-key") || config.apiKey;
  if (apiKey && agentType !== "codex") process.env[agentType === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"] = apiKey;

  const baseUrl = getArg(args, "--api-base-url") || config.apiBaseUrl;
  if (baseUrl) process.env[agentType === "openai" ? "OPENAI_BASE_URL" : "ANTHROPIC_BASE_URL"] = baseUrl;

  const model = getArg(args, "--model") || config.model;
  if (model) process.env[agentType === "openai" ? "OPENAI_MODEL" : agentType === "codex" ? "CODEX_MODEL" : "ANTHROPIC_MODEL"] = model;

  const port = parseInt(getArg(args, "--port") || String(config.port ?? 9527), 10);

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
  console.log("  Prism Studio Agent");
  console.log("=".repeat(50));

  const accessTokenRequired = config.accessTokenRequired !== false;
  const { port: actualPort } = await startServer(projectRoot, port, { accessTokenRequired });

  // Machine-readable marker for tooling (e.g. vite-plugin) to detect actual port
  console.log(`__PRISM_AGENT_PORT__=${actualPort}`);

  console.log(`\n  服务地址:  http://${localIP}:${actualPort}`);
  console.log(`  项目目录:  ${projectRoot}`);
  console.log(`  Agent:     ${agentType === "codex" ? "Codex SDK (ChatGPT login)" : agentType === "openai" ? "OpenAI Agents SDK" : agentType === "glm" ? "GLM (glm-acp-agent)" : "Claude Agent SDK"}`);
  console.log(`  模型:      ${modelName}`);
  console.log(`  Token 鉴权: ${accessTokenRequired ? "启用" : "关闭"}`);
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
