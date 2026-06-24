import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import type { AgentResult, ProgressCallback } from "./glm-agent.js";

function getClientId(req: express.Request): string {
  return (req.headers["x-client-id"] as string) || "default";
}

export async function startServer(
  projectRoot: string,
  port: number,
) {
  const agentType = process.env.AGENT_TYPE || "claude";

  // Lazy-load agent modules so choosing GLM doesn't require claude-agent-sdk
  let runAgentFn: (clientId: string, message: string, onProgress?: ProgressCallback) => Promise<AgentResult>;
  let shutdownFn: () => void;

  if (agentType === "glm") {
    const glm = await import("./glm-agent.js");
    glm.initGlmAgent(projectRoot);
    runAgentFn = glm.runGlmAgent;
    shutdownFn = glm.closeAllGlmSessions;
    console.log("[Server] 使用 GLM Agent (glm-acp-agent)");
  } else {
    const claude = await import("./agent.js");
    claude.initAgent(projectRoot);
    runAgentFn = claude.runAgent;
    shutdownFn = claude.closeAllSessions;
    console.log("[Server] 使用 Claude Agent SDK");
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  const server = http.createServer(app);

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

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "running",
      agentType,
      project: { root: projectRoot },
    });
  });

  app.post("/api/chat", async (req, res) => {
    const clientId = getClientId(req);
    const { message } = req.body as { message: string };

    console.log(`[Server] POST /api/chat clientId=${clientId} message=${message ? `${message.length} chars` : "EMPTY"}`);

    if (!message) {
      res.status(400).json({ success: false, message: "message is required" });
      return;
    }

    broadcast("agent:start", { type: "chat" });
    const onProgress = (text: string) => broadcast("agent:progress", { text });

    try {
      const result = await runAgentFn(clientId, message, onProgress);
      broadcast("agent:done", { success: result.success, filesModified: result.filesModified });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      broadcast("agent:error", { message: msg });
      res.status(500).json({ success: false, message: msg });
    }
  });

  // ---- Start (auto-increment port if occupied) ----
  const maxRetries = 10;
  let actualPort = port;

  // Suppress WSS error events (they mirror the HTTP server errors)
  wss.on("error", () => {});

  await new Promise<void>((resolve, reject) => {
    function tryListen(p: number, attempt: number) {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && attempt < maxRetries) {
          console.log(`[Server] 端口 ${p} 被占用，尝试 ${p + 1}...`);
          server.close(() => {
            tryListen(p + 1, attempt + 1);
          });
        } else {
          reject(err);
        }
      };
      server.once("error", onError);
      server.listen(p, "0.0.0.0", () => {
        server.removeListener("error", onError);
        actualPort = p;
        resolve();
      });
    }
    tryListen(port, 0);
  });

  function shutdown() {
    shutdownFn();
    server.close();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { server, port: actualPort };
}
