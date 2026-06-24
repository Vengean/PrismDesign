import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    shims: true,
    external: ["next", "react", "webpack"],
  },
  {
    entry: ["src/react.tsx"],
    format: ["esm", "cjs"],
    dts: true,
    external: ["react/jsx-runtime"],
  },
]);
