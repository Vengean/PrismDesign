#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanProject, type ProjectProfile } from "./project-profiler.js";
import { analyzeConventions } from "./convention-analyzer.js";
import { startServer } from "./server.js";

/**
 * Walk up from cwd to find the monorepo root (pnpm runs agent from packages/agent).
 */
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

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "start" && command !== undefined) {
    console.log(`
🎨 PrismDesign Agent

Usage:
  prism-design start [options]

Options:
  --port <number>    Agent 服务端口 (default: 9527)
  --project <path>   项目根目录 (default: 自动检测)
  --skip-analysis    跳过 AI 规范分析，加速启动
`);
    process.exit(0);
  }

  // Parse options
  const portIdx = args.indexOf("--port");
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 9527;

  const projectIdx = args.indexOf("--project");
  const projectRoot = projectIdx !== -1
    ? path.resolve(args[projectIdx + 1])
    : findProjectRoot();

  const skipAnalysis = args.includes("--skip-analysis");

  // Step 1: Scan project
  console.log("🔍 扫描项目...");
  let profile: ProjectProfile;

  try {
    profile = scanProject(projectRoot);
  } catch (error) {
    console.error(`❌ 项目扫描失败: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Use resolved root (may differ in monorepos)
  const resolvedRoot = profile.resolvedRoot;
  const cacheFile = path.join(resolvedRoot, ".design-agent-profile.json");

  console.log(`   框架:     ${profile.framework}`);
  console.log(`   语言:     ${profile.language}`);
  console.log(`   构建工具: ${profile.buildTool}`);
  console.log(`   源码目录: ${profile.srcDir}`);
  console.log(`   (组件库、样式方案等由 Agent 首次对话时自动深度扫描)`);

  // Step 2: Analyze conventions (uses Agent SDK)
  if (!skipAnalysis) {
    console.log("\n🤖 分析项目编码规范...");
    try {
      profile.conventions = await analyzeConventions(resolvedRoot, profile);
      console.log("\n📋 项目规范:");
      console.log(profile.conventions);
    } catch (error) {
      console.warn(`⚠️  规范分析失败，将使用默认规则: ${error instanceof Error ? error.message : error}`);
      profile.conventions = "未能自动分析，请遵循项目已有代码风格";
    }
  } else {
    console.log("\n⏭️  跳过规范分析");
    profile.conventions = "未分析，请遵循项目已有代码风格";
  }

  // Cache profile
  fs.writeFileSync(cacheFile, JSON.stringify(profile, null, 2));

  // Step 3: Start server
  const localIP = getLocalIP();

  console.log("\n" + "=".repeat(50));
  console.log("  🎨 PrismDesign Agent 准备就绪");
  console.log("=".repeat(50));
  console.log(`\n  Agent 服务: http://${localIP}:${port}`);
  console.log(`  项目目录:   ${resolvedRoot}`);
  console.log(`\n  👉 请将 Agent 地址发给设计师`);
  console.log(`     设计师在 Chrome 插件中配置此地址即可开始编辑`);
  console.log("\n" + "=".repeat(50) + "\n");

  startServer(resolvedRoot, profile, port);
}

main().catch((error) => {
  console.error("启动失败:", error);
  process.exit(1);
});
