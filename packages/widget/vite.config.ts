import { defineConfig } from "vite";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins:[tailwindcss()],
  resolve:{dedupe:["react","react-dom"]},
  define:{"process.env.NODE_ENV":JSON.stringify("production")},
  esbuild:{jsx:"automatic"},
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["iife", "es"],
      name: "PrismStudioWidget",
      fileName: (format) => `prism-studio-widget.${format === "iife" ? "iife" : "es"}.js`,
    },
    outDir: "dist",
    minify: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
