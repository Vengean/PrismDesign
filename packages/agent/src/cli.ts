#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanProject } from "./project-profiler.js";
import { startServer } from "./server.js";
import { loadConfig, applyConfigToEnv, type PrismConfig } from "./config.js";

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

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
      fs.existsSync(path.join(dir, "lerna.json"))
    ) {
      return dir;
    }
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
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
🎨 PrismDesign Agent

Usage:
  prism-design-agent start [options]

Options:
  --port <number>        服务端口 (default: 9527)
  --project <path>       项目根目录 (default: 自动检测)
  --api-key <key>        Anthropic API Key
  --api-base-url <url>   API Base URL (代理)
  --model <name>         模型名称 (default: claude-opus-4-6)

Config File (prism.config.ts):
  启动目录下放置 prism.config.ts 可配置所有参数:
  anthropicApiKey, anthropicModel, anthropicBaseUrl,
  httpsProxy, httpProxy, options (SDK 选项)

  优先级: CLI 参数 > prism.config > 环境变量 > .env

Examples:
  npx prism-design-agent start
  npx prism-design-agent start --port 8080
  npx prism-design-agent start --model claude-sonnet-4-6
`);
    process.exit(0);
  }

  // Determine project root
  const projectArg = getArg(args, "--project");
  const projectRoot = projectArg ? path.resolve(projectArg) : findProjectRoot();

  // Load .env files first (lowest priority, only sets if key not in env)
  loadEnvFile(projectRoot);
  loadEnvFile(process.cwd());

  // Load prism.config.{ts,js,mjs} (overrides .env)
  const config = await loadConfig(projectRoot);
  applyConfigToEnv(config, true);

  // CLI args override everything
  const apiKey = getArg(args, "--api-key");
  if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey;

  const baseUrl = getArg(args, "--api-base-url");
  if (baseUrl) process.env.ANTHROPIC_BASE_URL = baseUrl;

  const model = getArg(args, "--model");
  if (model) process.env.ANTHROPIC_MODEL = model;

  const port = parseInt(getArg(args, "--port") || "9527", 10);

  // Scan project
  console.log("🔍 扫描项目...");
  let profile;
  try {
    profile = scanProject(projectRoot);
  } catch (error) {
    console.error(`❌ 项目扫描失败: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const resolvedRoot = profile.resolvedRoot;

  console.log(`   框架:     ${profile.framework}`);
  console.log(`   语言:     ${profile.language}`);
  console.log(`   构建工具: ${profile.buildTool}`);
  console.log(`   源码目录: ${profile.srcDir}`);

  // Attach SDK options from config
  profile.sdkOptions = config.options;

  // Start server
  const localIP = getLocalIP();
  const modelName = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

  console.log("\n" + "=".repeat(50));
  console.log("  🎨 PrismDesign Agent");
  console.log("=".repeat(50));
  console.log(`\n  服务地址:  http://${localIP}:${port}`);
  console.log(`  项目目录:  ${resolvedRoot}`);
  console.log(`  模型:      ${modelName}`);
  if (process.env.ANTHROPIC_BASE_URL) {
    console.log(`  API 代理:  ${process.env.ANTHROPIC_BASE_URL}`);
  }
  console.log(`\n  👉 在 Chrome 插件中配置服务地址即可开始`);
  console.log("\n" + "=".repeat(50) + "\n");

  startServer(resolvedRoot, profile, port);
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
