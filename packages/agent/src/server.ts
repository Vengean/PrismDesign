import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import type { AgentEvent, AgentProvider } from "./core/types.js";
import { LegacyProvider } from "./providers/legacy-provider.js";
import { OpenAIProvider } from "./providers/openai-provider.js";
import { CodexProvider } from "./providers/codex-provider.js";

function getClientId(req: express.Request): string {
  return (req.headers["x-client-id"] as string) || "default";
}

export async function startServer(
  projectRoot: string,
  port: number,
) {
  const agentType = process.env.PRISM_AGENT_PROVIDER || process.env.AGENT_TYPE || "claude";

  // Lazy-load agent modules so choosing GLM doesn't require claude-agent-sdk
  let provider: AgentProvider;

  if (agentType === "glm") {
    const glm = await import("./glm-agent.js");
    glm.initGlmAgent(projectRoot);
    provider = new LegacyProvider("glm", process.env.ANTHROPIC_MODEL || "glm-5.1", glm.runGlmAgent, glm.closeAllGlmSessions);
    console.log("[Server] 使用 GLM Agent (glm-acp-agent)");
  } else if (agentType === "openai") {
    provider = new OpenAIProvider(projectRoot);
    console.log(`[Server] 使用 OpenAI Agents SDK (${provider.model})`);
  } else if (agentType === "codex") {
    provider = new CodexProvider(projectRoot);
    console.log(`[Server] 使用 Codex SDK (${provider.model})`);
  } else {
    const claude = await import("./agent.js");
    claude.initAgent(projectRoot);
    provider = new LegacyProvider(agentType === "claude-sub" ? "claude-sub" : "claude", process.env.ANTHROPIC_MODEL || "claude-opus-4-6", claude.runAgent, claude.closeAllSessions);
    console.log("[Server] 使用 Claude Agent SDK");
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  const server = http.createServer(app);

  // ---- WebSocket for real-time events ----
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsClients = new Set<WebSocket>();
  const wsClientIds = new Map<WebSocket, string>();
  const activeRuns = new Map<string, AbortController>();
  const pendingFetchRequests = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  wss.on("connection", (ws, request) => {
    wsClients.add(ws);
    const url = new URL(request.url || "/ws", "http://localhost");
    wsClientIds.set(ws, url.searchParams.get("clientId") || "default");
    ws.on("close", () => {
      wsClients.delete(ws);
      wsClientIds.delete(ws);
    });
    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== "test:fetch:result" || !message.data?.requestId) return;
        const pending = pendingFetchRequests.get(message.data.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingFetchRequests.delete(message.data.requestId);
        pending.resolve(message.data);
      } catch {}
    });
  });

  function broadcast(type: string, data: unknown, clientId?: string) {
    const msg = JSON.stringify({ type, data });
    for (const ws of wsClients) {
      if (ws.readyState === WebSocket.OPEN && (!clientId || wsClientIds.get(ws) === clientId)) {
        ws.send(msg);
      }
    }
  }

  function emitAgentEvent(clientId: string, event: AgentEvent) {
    if (process.env.PRISM_AGENT_DEBUG === "1") {
      const detail = event.type === "message.delta"
        ? JSON.stringify({ runId: event.runId, delta: event.delta.slice(0, 160) })
        : JSON.stringify(event);
      console.log(`[Agent:${provider.name}] client=${clientId} ${event.type} ${detail}`);
    }
    broadcast(event.type, event, clientId);
    // v1 compatibility during the protocol migration.
    if (event.type === "run.started") broadcast("agent:start", { runId: event.runId, type: "chat" }, clientId);
    if (event.type === "tool.started") broadcast("agent:progress", { runId: event.runId, text: event.label }, clientId);
    if (event.type === "run.completed") broadcast("agent:done", { runId: event.runId, success: true, filesModified: event.result.filesModified }, clientId);
    if (event.type === "run.failed") broadcast("agent:error", { runId: event.runId, message: event.error.message }, clientId);
  }

  // ---- REST API ----

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "running",
      protocolVersion: 2,
      agentType: provider.name,
      agent: { provider: provider.name, model: provider.model, capabilities: provider.capabilities },
      project: { root: projectRoot },
    });
  });

  app.post("/api/chat", async (req, res) => {
    const clientId = getClientId(req);
    const { message, runId: requestedRunId } = req.body as { message: string; runId?: string };
    const runId = requestedRunId || `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    console.log(`[Server] POST /api/chat clientId=${clientId} message=${message ? `${message.length} chars` : "EMPTY"}`);

    if (message && process.env.PRISM_AGENT_DEBUG === "1") {
      const maxLogLength = 8_000;
      const loggedMessage = message.length > maxLogLength
        ? `${message.slice(0, maxLogLength)}\n...(truncated, total ${message.length} chars)`
        : message;
      console.log(`[Agent:${provider.name}] client=${clientId} input:\n${loggedMessage}`);
    }

    if (!message) {
      res.status(400).json({ success: false, message: "message is required" });
      return;
    }

    const controller = new AbortController();
    activeRuns.set(runId, controller);
    emitAgentEvent(clientId, { type: "run.started", runId });

    try {
      const result = await provider.run(clientId, runId, message, (event) => emitAgentEvent(clientId, event), controller.signal);
      emitAgentEvent(clientId, { type: "run.completed", runId, result });
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted) {
        emitAgentEvent(clientId, { type: "run.cancelled", runId });
        res.status(499).json({ success: false, runId, message: "run cancelled" });
        return;
      }
      emitAgentEvent(clientId, { type: "run.failed", runId, error: { message: msg } });
      res.status(500).json({ success: false, message: msg });
    } finally {
      activeRuns.delete(runId);
    }
  });

  app.delete("/api/runs/:runId", (req, res) => {
    const controller = activeRuns.get(req.params.runId);
    if (!controller) {
      res.status(404).json({ success: false, message: "run not found" });
      return;
    }
    controller.abort();
    res.json({ success: true });
  });

  app.delete("/api/session", async (req, res) => {
    await provider.clearSession(getClientId(req));
    res.json({ success: true });
  });

  // Browser-proxied fetch reuses the connected browser's authenticated session.
  app.post("/api/test/fetch", async (req, res) => {
    const clientId = getClientId(req);
    const { url, method = "GET", headers = {}, body } = req.body as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    if (!url) {
      res.status(400).json({ success: false, error: "url is required" });
      return;
    }
    const activeClient = [...wsClients].find((ws) => ws.readyState === WebSocket.OPEN && wsClientIds.get(ws) === clientId)
      || [...wsClients].find((ws) => ws.readyState === WebSocket.OPEN);
    if (!activeClient) {
      res.status(503).json({ success: false, error: "No browser client connected" });
      return;
    }

    const requestId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeoutMs = 30_000;
    try {
      const result = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingFetchRequests.delete(requestId);
          reject(new Error(`Browser fetch timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pendingFetchRequests.set(requestId, { resolve, reject, timer });
        activeClient.send(JSON.stringify({ type: "test:fetch", data: { requestId, url, method, headers, body } }));
      });
      res.json({ success: true, status: result.status, statusText: result.statusText, headers: result.headers, body: result.body });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
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
    for (const controller of activeRuns.values()) controller.abort();
    void provider.close();
    server.close();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { server, port: actualPort };
}
