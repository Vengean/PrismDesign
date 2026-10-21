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
import projectRoutes from "./routes/projects.js";
import { initProjectTables } from "./services/projects.js";

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
initProjectTables();
initRuntimeTables();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/projects/:id/requirements/:requirementId/environment", environmentRoutes);
app.use("/api/projects", projectRoutes);
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

server.on("upgrade", (_req,socket) => socket.destroy());
await cleanupLegacyResources();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Platform server running on http://0.0.0.0:${PORT}`);
});
