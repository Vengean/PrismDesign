import { build, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync, writeFileSync, rmSync } from "fs";

export default defineConfig({
  base: "./",
  resolve: {
    dedupe:["react","react-dom"],
    alias: {
      "@": resolve(__dirname, "src/sidepanel"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "page-bridge": resolve(__dirname, "src/content/page-bridge.ts"),
        sidepanel: resolve(__dirname, "src/sidepanel/index.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "fix-chrome-ext-paths",
      async closeBundle() {
        const distDir = resolve(__dirname, "dist");
        // Manifest content scripts are classic scripts. Bundle separately so
        // shared WebSocket code never introduces an unsupported ESM import.
        await build({
          configFile: false,
          publicDir: false,
          build: {
            outDir: distDir,
            emptyOutDir: false,
            lib: { entry: resolve(__dirname, "src/content/index.ts"), name: "PrismContent", formats: ["iife"], fileName: () => "content.js" },
          },
        });
        const srcHtml = resolve(distDir, "src/sidepanel/index.html");
        try {
          let html = readFileSync(srcHtml, "utf-8");
          // Fix all relative paths from nested dir to dist root
          html = html.replace(/(src|href)="\.\.\/\.\.\//g, '$1="./');
          writeFileSync(resolve(distDir, "sidepanel.html"), html);
          rmSync(resolve(distDir, "src"), { recursive: true, force: true });
        } catch {}
      },
    },
  ],
  publicDir: "public",
});
