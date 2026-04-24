import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface ProjectProfile {
  framework: "react" | "vue" | "next" | "nuxt" | "unknown";
  language: "typescript" | "javascript";
  styling: string[];
  componentLib: string[];
  buildTool: "vite" | "webpack" | "turbopack" | "unknown";
  srcDir: string;
  conventions: string;
}

export function scanProject(root: string): ProjectProfile {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`未找到 package.json: ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // Framework
  const framework = (() => {
    if (allDeps["next"]) return "next" as const;
    if (allDeps["nuxt"]) return "nuxt" as const;
    if (allDeps["vue"]) return "vue" as const;
    if (allDeps["react"]) return "react" as const;
    return "unknown" as const;
  })();

  // Styling
  const styling: string[] = [];
  if (allDeps["tailwindcss"]) styling.push("tailwind");
  if (allDeps["styled-components"]) styling.push("styled-components");
  if (allDeps["@emotion/react"]) styling.push("emotion");
  if (allDeps["sass"] || allDeps["node-sass"]) styling.push("scss");

  try {
    const result = execSync('find . -maxdepth 5 -name "*.module.*" -not -path "*/node_modules/*" | head -3', {
      cwd: root,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.trim()) styling.push("css-modules");
  } catch {}

  if (styling.length === 0) styling.push("plain-css");

  // Component library
  const componentLib: string[] = [];
  if (allDeps["antd"] || allDeps["@ant-design/pro-components"]) componentLib.push("antd");
  if (allDeps["element-plus"]) componentLib.push("element-plus");
  if (allDeps["@mui/material"]) componentLib.push("material-ui");
  if (allDeps["@arco-design/web-react"]) componentLib.push("arco-design");
  if (allDeps["@arco-design/web-vue"]) componentLib.push("arco-design-vue");

  // Build tool
  const buildTool = (() => {
    if (allDeps["vite"]) return "vite" as const;
    if (allDeps["webpack"] || allDeps["webpack-cli"]) return "webpack" as const;
    return "unknown" as const;
  })();

  // Source directory
  const srcDir = fs.existsSync(path.join(root, "src")) ? "src" : ".";

  // Language
  const language = fs.existsSync(path.join(root, "tsconfig.json"))
    ? ("typescript" as const)
    : ("javascript" as const);

  return {
    framework,
    language,
    styling,
    componentLib,
    buildTool,
    srcDir,
    conventions: "",
  };
}
