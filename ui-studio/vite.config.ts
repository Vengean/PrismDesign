import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Keep the source alias, but let workspace dependencies resolve from packages/ui.
// This ensures the studio and Radix use the same React module instance.
export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: {
    "@prism-studio-ai/ui": new URL("../packages/ui/src/index.tsx", import.meta.url).pathname,
    "@": new URL("../packages/chrome-ext/src/sidepanel", import.meta.url).pathname,
  } },
});
