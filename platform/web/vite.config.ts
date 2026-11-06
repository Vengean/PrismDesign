import {findDevPort} from "../scripts/dev-port.mjs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Allow cross-origin requests to /api (widget in container dev server → platform)
function corsPlugin(): Plugin {
  return {
    name: "cors-for-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const origin = req.headers.origin;
        if (origin && req.url?.startsWith("/api/")) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-client-id");
          if (req.method === "OPTIONS") {
            res.statusCode = 204;
            res.end();
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(async ({command}) => ({
  plugins: [corsPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: command === "serve" ? await findDevPort() : 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
}));
