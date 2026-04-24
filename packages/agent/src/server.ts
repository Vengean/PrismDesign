import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { runAgent, initAgent, closeAllSessions } from "./agent.js";
import { GitSafety } from "./git-safety.js";
import type { ProjectProfile } from "./project-profiler.js";

interface ApplyChangesRequest {
  changes: Array<{
    selector: string;
    property: string;
    oldValue: string;
    newValue: string;
    componentChain?: string;
    componentName?: string;
    sourceFile?: string;
    sourceLine?: number;
    textContent?: string;
    siblingIndex?: string;
  }>;
  pagePath?: string;
  supplement?: string;
}

interface ChatRequest {
  message: string;
  context: {
    pagePath: string;
    components: Array<{
      name: string;
      sourceFile?: string;
      sourceLine?: number;
    }>;
  };
}

/**
 * Extract or assign a client ID from the request.
 * Uses X-Client-ID header, falls back to generating one.
 */
function getClientId(req: express.Request): string {
  return (req.headers["x-client-id"] as string) || "default";
}

export function startServer(
  projectRoot: string,
  profile: ProjectProfile,
  port: number
) {
  // Initialize agent module with project info
  initAgent(projectRoot, profile);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  const server = http.createServer(app);
  const git = new GitSafety(projectRoot);

  // ---- WebSocket for real-time events ----
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsClients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    ws.on("close", () => wsClients.delete(ws));
  });

  function broadcast(type: string, data: unknown) {
    const msg = JSON.stringify({ type, data });
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // ---- REST API ----

  // Health check & project info
  app.get("/api/status", (_req, res) => {
    res.json({
      status: "running",
      project: {
        framework: profile.framework,
        styling: profile.styling,
        componentLib: profile.componentLib,
      },
    });
  });

  // Apply design changes via AI agent
  app.post("/api/apply-changes", async (req, res) => {
    const clientId = getClientId(req);
    const body = req.body as ApplyChangesRequest;
    console.log(`[Server] 客户端 ${clientId} apply-changes:`, JSON.stringify(body.changes).slice(0, 300));

    broadcast("agent:start", { changes: body.changes });

    // Auto backup
    git.stash("before-design-edit");

    // Group changes by component
    const grouped = new Map<string, typeof body.changes>();
    for (const c of body.changes) {
      const key = c.componentChain || c.componentName || c.selector.split(" > ").slice(0, 3).join(" > ");
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(c);
    }

    let changeDesc = "";
    for (const [comp, changes] of grouped) {
      const first = changes[0];
      const source = first.sourceFile ? `（源文件：${first.sourceFile}${first.sourceLine ? `:${first.sourceLine}` : ""}）` : "";
      const textHint = first.textContent ? `（文本内容：「${first.textContent}」）` : "";
      const sibHint = first.siblingIndex ? `（${first.siblingIndex}）` : "";
      changeDesc += `\n【${comp}】${source}${sibHint}${textHint}\n`;
      for (const c of changes) {
        if (c.property === "comment") {
          changeDesc += `  - 设计师评论: "${c.newValue}"\n`;
        } else {
          changeDesc += `  - ${c.property}: "${c.oldValue}" → "${c.newValue}"\n`;
        }
      }
    }

    const userMessage = `设计师对页面做了以下视觉修改，请应用到源代码中：

页面路径：${body.pagePath || "/"}
${changeDesc}
${body.supplement ? `设计师补充说明：${body.supplement}\n` : ""}
请根据组件名和源文件定位代码，读取确认后应用修改。`;

    try {
      const result = await runAgent(clientId, userMessage);
      broadcast("agent:done", {
        success: result.success,
        filesModified: result.filesModified,
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcast("agent:error", { message });
      res.status(500).json({ success: false, message });
    }
  });

  // AI chat for natural language edits
  app.post("/api/chat", async (req, res) => {
    const clientId = getClientId(req);
    const body = req.body as ChatRequest;

    broadcast("agent:start", { type: "chat" });

    // Auto backup
    git.stash("before-chat-edit");

    const componentContext = body.context.components
      .map((c) => `- ${c.name}${c.sourceFile ? ` (${c.sourceFile}:${c.sourceLine || ""})` : ""}`)
      .join("\n");

    const userMessage = `设计师的修改需求：${body.message}

当前页面：${body.context.pagePath}
页面上的组件：
${componentContext}

请根据需求搜索并修改相关源代码。`;

    try {
      const result = await runAgent(clientId, userMessage);
      broadcast("agent:done", {
        success: result.success,
        filesModified: result.filesModified,
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      broadcast("agent:error", { message });
      res.status(500).json({ success: false, message });
    }
  });

  // Rollback last change
  app.post("/api/rollback", (_req, res) => {
    const success = git.rollback();
    broadcast("agent:rollback", { success });
    res.json({ success });
  });

  // Get component source code context
  app.get("/api/source", (req, res) => {
    const { file, line } = req.query;
    if (!file || typeof file !== "string") {
      res.status(400).json({ success: false, message: "file parameter required" });
      return;
    }

    try {
      const filePath = path.resolve(projectRoot, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const lineNum = parseInt(line as string, 10) || 0;
      const contextStart = Math.max(0, lineNum - 15);
      const contextEnd = Math.min(lines.length, lineNum + 15);

      res.json({
        success: true,
        file,
        content: lines.slice(contextStart, contextEnd).join("\n"),
        startLine: contextStart + 1,
        totalLines: lines.length,
      });
    } catch {
      res.status(404).json({ success: false, message: "File not found" });
    }
  });

  // Git status
  app.get("/api/git-status", (_req, res) => {
    res.json({ status: git.status() });
  });

  // ---- Start ----
  server.listen(port, "0.0.0.0", () => {
    console.log(`\n🎨 PrismDesign Agent 服务已启动`);
    console.log(`   HTTP API:   http://0.0.0.0:${port}`);
    console.log(`   WebSocket:  ws://0.0.0.0:${port}/ws\n`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => { closeAllSessions(); process.exit(0); });
  process.on("SIGINT", () => { closeAllSessions(); process.exit(0); });

  return server;
}
