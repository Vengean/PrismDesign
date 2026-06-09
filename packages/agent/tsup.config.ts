import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/config.ts"],
  format: ["esm"],
  dts: true,
});
