import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync, writeFileSync, rmSync } from "fs";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/sidepanel"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/index.ts"),
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
      closeBundle() {
        const distDir = resolve(__dirname, "dist");
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
