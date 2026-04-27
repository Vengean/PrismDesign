import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface ProjectProfile {
  /** Resolved project root (may differ from input in monorepos) */
  resolvedRoot: string;
  framework: "react" | "vue" | "next" | "nuxt" | "unknown";
  language: "typescript" | "javascript";
  styling: string[];
  componentLib: string[];
  buildTool: "vite" | "webpack" | "turbopack" | "unknown";
  srcDir: string;
  conventions: string;
}

function detectFramework(deps: Record<string, string>) {
  if (deps["next"]) return "next" as const;
  if (deps["nuxt"]) return "nuxt" as const;
  if (deps["vue"]) return "vue" as const;
  if (deps["react"]) return "react" as const;
  return "unknown" as const;
}

/**
 * In a monorepo root (no framework deps), find the first child with a known framework.
 */
function findAppInMonorepo(root: string): string | null {
  for (const dir of ["demo", "app", "apps", "packages"]) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;

    // Direct child is an app?
    const pkgFile = path.join(dirPath, "package.json");
    if (fs.existsSync(pkgFile)) {
      const p = JSON.parse(fs.readFileSync(pkgFile, "utf-8"));
      const deps = { ...p.dependencies, ...p.devDependencies };
      if (detectFramework(deps) !== "unknown") return dirPath;
    }

    // One level deeper (apps/web, packages/app)
    try {
      for (const sub of fs.readdirSync(dirPath)) {
        const subPkg = path.join(dirPath, sub, "package.json");
        if (fs.existsSync(subPkg)) {
          const p = JSON.parse(fs.readFileSync(subPkg, "utf-8"));
          const deps = { ...p.dependencies, ...p.devDependencies };
          if (detectFramework(deps) !== "unknown") return path.join(dirPath, sub);
        }
      }
    } catch {}
  }
  return null;
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
  let framework = detectFramework(allDeps);

  // Monorepo: if root has no framework, find the app package
  if (framework === "unknown") {
    const appDir = findAppInMonorepo(root);
    if (appDir) {
      console.log(`   📦 monorepo 检测到子项目: ${path.relative(root, appDir)}`);
      return scanProject(appDir);
    }
  }

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
    resolvedRoot: path.resolve(root),
    framework,
    language,
    styling,
    componentLib,
    buildTool,
    srcDir,
    conventions: "",
  };
}
