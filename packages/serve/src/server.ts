import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

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

  // ── HTML injection snippet ──
  // Use the page's hostname so LAN clients connect to the right agent address
  const agentUrlObj = new URL(agentUrl);
  const agentPort = agentUrlObj.port;
  const injectionSnippet =
    `<script>window.__PRISM_DESIGN__={agentUrl:"http://"+location.hostname+":${agentPort}"}</script>\n` +
    `<script src="/__prism__/widget.js"></script>\n`;

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

  server.listen(port, "0.0.0.0");
  return server;
}
