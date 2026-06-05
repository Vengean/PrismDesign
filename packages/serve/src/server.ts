import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { watch } from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startServer(opts: { dir: string; port: number; agentUrl: string }) {
  const { dir, port, agentUrl } = opts;
  const app = express();
  app.use(cors());

  // ── Serve widget.js ──
  const widgetPath = path.join(__dirname, "widget.js");
  let widgetContent: string;
  try {
    widgetContent = fs.readFileSync(widgetPath, "utf-8");
  } catch {
    widgetContent = "console.warn('[PrismDesign] widget.js not found — run pnpm build:widget first');";
  }

  app.get("/__prism__/widget.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "no-store");
    res.send(widgetContent);
  });

  // ── Livereload client script ──
  const livereloadScript = `<script>(function(){var ws=new WebSocket("ws://"+location.host+"/__prism__/livereload");ws.onmessage=function(e){if(JSON.parse(e.data).type==="reload"){location.reload()}};ws.onclose=function(){setTimeout(function(){location.reload()},1000)}})()</script>\n`;

  // ── HTML injection snippet ──
  const injectionSnippet =
    `<script>window.__PRISM_DESIGN__=${JSON.stringify({ agentUrl })}</script>\n` +
    `<script src="/__prism__/widget.js"></script>\n` +
    livereloadScript;

  // ── Helper: inject into HTML ──
  function injectHtml(html: string): string {
    const bodyCloseIdx = html.lastIndexOf("</body>");
    if (bodyCloseIdx !== -1) {
      return html.slice(0, bodyCloseIdx) + injectionSnippet + html.slice(bodyCloseIdx);
    }
    return html + "\n" + injectionSnippet;
  }

  // ── HTML injection middleware ──
  app.use((req: Request, res: Response, next: NextFunction) => {
    const ext = path.extname(req.path);
    const isHtmlRequest = ext === ".html" || ext === ".htm" || ext === "" || req.path.endsWith("/");

    if (!isHtmlRequest) {
      return next();
    }

    let filePath: string;
    if (ext === ".html" || ext === ".htm") {
      filePath = path.join(dir, req.path);
    } else {
      filePath = path.join(dir, req.path, "index.html");
      if (!fs.existsSync(filePath)) {
        filePath = path.join(dir, "index.html");
      }
    }

    if (!fs.existsSync(filePath) || !filePath.endsWith(".html")) {
      return next();
    }

    try {
      const html = fs.readFileSync(filePath, "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(injectHtml(html));
    } catch {
      next();
    }
  });

  // ── Static files ──
  app.use(express.static(dir, { index: false }));

  // ── SPA fallback ──
  app.use((req: Request, res: Response, next: NextFunction) => {
    const indexPath = path.join(dir, "index.html");
    if (req.method === "GET" && fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, "utf-8");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(injectHtml(html));
    } else {
      next();
    }
  });

  // ── HTTP server ──
  const server = http.createServer(app);

  // ── Livereload WebSocket ──
  const wss = new WebSocketServer({ server, path: "/__prism__/livereload" });
  const lrClients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    lrClients.add(ws);
    ws.on("close", () => lrClients.delete(ws));
  });

  function broadcastReload() {
    const msg = JSON.stringify({ type: "reload" });
    for (const ws of lrClients) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  // ── Chokidar file watcher ──
  const watcher = watch(dir, {
    ignored: [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/.DS_Store",
    ],
    depth: 5,
    ignoreInitial: true,
    usePolling: false,
  });

  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  watcher.on("all", (event, filePath) => {
    if (event === "add" || event === "change" || event === "unlink") {
      // Debounce: batch rapid changes into one reload
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        const rel = path.relative(dir, filePath);
        console.log(`  🔄 ${rel} changed, reloading...`);
        broadcastReload();
        reloadTimer = null;
      }, 150);
    }
  });

  server.listen(port, "0.0.0.0");
  return server;
}
