import {releaseWorkflow} from './services/release-workflow.js';
import {previewHostConfig} from './services/preview-host.js';
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDb } from "./services/db.js";
import { cleanupLegacyResources } from "./services/legacy-cleanup.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import { initRuntimeTables } from "./services/requirement-runtime.js";
import environmentRoutes from "./routes/environments.js";
import {initConversationTables,interruptPreviousRuns,conversations} from './services/conversations.js';
import conversationRoutes from './routes/conversations.js';
import projectRoutes from "./routes/projects.js";
import { initProjectTables } from "./services/projects.js";
import {projectAuth} from './services/project-auth.js';
import {projectAuthRoutes,attachProjectAuthWebSocket} from './routes/project-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

previewHostConfig(); // Fail early on invalid production gateway configuration.
const app = express();
const PORT = parseInt(process.env.PORT || "3001");

// Ensure data directory exists
const dataDir = process.env.PRISM_DATA_DIR || "./data";
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
await getDb().ready();
console.log(`Platform database: ${getDb().dialect} (${process.env.PRISM_MODE||"dev"})`);
(await initProjectTables());
(await initRuntimeTables());
(await initConversationTables());
(await interruptPreviousRuns());
try{await projectAuth.recover();}catch{console.warn('[Project auth] 暂时无法清理遗留授权容器，打开登录终端前请确认容器引擎可用');}
await releaseWorkflow.recover();
(await conversations.resume());

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// API routes
app.get("/api/health", (_req,res) => res.json({service:"prism-platform",status:"ready"}));
app.use("/api/auth", authRoutes);
app.use("/api/projects/:id/requirements/:requirementId/conversation", conversationRoutes);
app.use("/api/projects/:id/requirements/:requirementId/environment", environmentRoutes);
app.use("/api/projects", projectRoutes);
app.use('/api/projects',projectAuthRoutes());
app.use("/api/users", userRoutes);

// Retired and unknown API paths must never fall through to the SPA.
app.use("/api", (_req,res) => {res.status(404).json({error:"接口不存在"});});

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

attachProjectAuthWebSocket(server);
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{server.close();void projectAuth.closeAll().finally(()=>process.exit(0));});
await cleanupLegacyResources();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Platform server running on http://0.0.0.0:${PORT}`);
});
