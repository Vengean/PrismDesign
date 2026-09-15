import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/widget/index.ts"),
      formats: ["iife"],
      name: "PrismStudioWidget",
      fileName: () => "widget.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
