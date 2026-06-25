import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { getDb } from "./services/db.js";
import { findWorkspaceById } from "./services/db.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import workspaceRoutes from "./routes/workspaces.js";
import gitRoutes from "./routes/git.js";
import serviceRoutes from "./routes/services.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

// Ensure data directory exists
const dataDir = process.env.PRISM_DATA_DIR || "./data";
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
getDb();

// Middleware
app.use(cors());
app.use(express.json());

// Agent proxy — no auth required (Chrome extension / Serve widget connects directly)
app.all("/api/workspaces/:id/agent/*", async (req, res) => {
  const workspace = findWorkspaceById(req.params.id);
  if (!workspace) { res.status(404).json({ error: "工作空间不存在" }); return; }
  if (workspace.status !== "running" || !workspace.agent_port) {
    res.status(503).json({ error: "Agent 服务未运行" }); return;
  }

  const agentPath = req.params[0]; // everything after /agent/
  const targetUrl = `http://127.0.0.1:${workspace.agent_port}/${agentPath}`;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const clientId = req.headers["x-client-id"];
    if (clientId) headers["x-client-id"] = String(clientId);

    const fetchOptions: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const agentRes = await fetch(targetUrl, fetchOptions);
    const data = await agentRes.json();
    res.status(agentRes.status).json(data);
  } catch (err) {
    console.error(`[AgentProxy] ${req.method} ${targetUrl} failed:`, err);
    res.status(502).json({ error: "Agent 服务无响应" });
  }
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspaces", gitRoutes);
app.use("/api/workspaces", serviceRoutes);

// Static files (production)
const webDist = path.join(__dirname, "../web/dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

const server = http.createServer(app);

// WebSocket proxy: /api/workspaces/:id/agent/ws → container ws://127.0.0.1:port/ws
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const match = req.url?.match(/^\/api\/workspaces\/([^/]+)\/agent\/ws/);
  if (!match) {
    socket.destroy();
    return;
  }

  const workspaceId = match[1];
  const workspace = findWorkspaceById(workspaceId);

  if (!workspace || workspace.status !== "running" || !workspace.agent_port) {
    socket.destroy();
    return;
  }

  // Accept the client WebSocket connection
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const targetUrl = `ws://127.0.0.1:${workspace.agent_port}/ws`;
    const upstream = new WebSocket(targetUrl);

    upstream.on("open", () => {
      // Forward messages: client → upstream
      clientWs.on("message", (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
      });
      // Forward messages: upstream → client
      upstream.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
      });
    });

    upstream.on("error", () => clientWs.close());
    upstream.on("close", () => clientWs.close());
    clientWs.on("error", () => upstream.close());
    clientWs.on("close", () => upstream.close());
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Platform server running on http://0.0.0.0:${PORT}`);
});
