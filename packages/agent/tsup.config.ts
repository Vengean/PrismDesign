import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/config.ts"],
  format: ["esm"],
  splitting: true,
  dts: true,
  clean: true,
});
