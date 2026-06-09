import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { runAgent, initAgent, closeAllSessions } from "./agent.js";
import type { ProjectProfile } from "./project-profiler.js";

function getClientId(req: express.Request): string {
  return (req.headers["x-client-id"] as string) || "default";
}

export function startServer(
  projectRoot: string,
  profile: ProjectProfile,
  port: number
) {
  initAgent(projectRoot, profile);

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
      project: {
        root: projectRoot,
        framework: profile.framework,
        language: profile.language,
      },
    });
  });

  // Chat — pure pass-through: client sends full message, server forwards to agent
  app.post("/api/chat", async (req, res) => {
    const clientId = getClientId(req);
    const { message } = req.body as { message: string };

    if (!message) {
      res.status(400).json({ success: false, message: "message is required" });
      return;
    }

    broadcast("agent:start", { type: "chat" });

    const onProgress = (text: string) => broadcast("agent:progress", { text });

    try {
      const result = await runAgent(clientId, message, onProgress);
      broadcast("agent:done", { success: result.success, filesModified: result.filesModified });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      broadcast("agent:error", { message: msg });
      res.status(500).json({ success: false, message: msg });
    }
  });

  // ---- Start ----
  server.listen(port, "0.0.0.0");

  function shutdown() {
    closeAllSessions();
    server.close();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}
