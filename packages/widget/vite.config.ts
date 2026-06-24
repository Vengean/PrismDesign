import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["iife", "es"],
      name: "PrismDesignWidget",
      fileName: (format) => `prism-design-widget.${format === "iife" ? "iife" : "es"}.js`,
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
