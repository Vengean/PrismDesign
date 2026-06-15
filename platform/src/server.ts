import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getDb } from "./services/db.js";
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

app.listen(PORT, () => {
  console.log(`Platform server running on http://localhost:${PORT}`);
});
