import fs from "node:fs";
import path from "node:path";

export interface ProjectProfile {
  resolvedRoot: string;
  framework: "react" | "vue" | "next" | "nuxt" | "unknown";
  language: "typescript" | "javascript";
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

function findAppInMonorepo(root: string): string | null {
  for (const dir of ["demo", "app", "apps", "packages"]) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;

    const pkgFile = path.join(dirPath, "package.json");
    if (fs.existsSync(pkgFile)) {
      const p = JSON.parse(fs.readFileSync(pkgFile, "utf-8"));
      const deps = { ...p.dependencies, ...p.devDependencies };
      if (detectFramework(deps) !== "unknown") return dirPath;
    }

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

  // Static HTML project — no package.json
  if (!fs.existsSync(pkgPath)) {
    console.log("   📄 静态 HTML 项目（无 package.json）");
    return {
      resolvedRoot: path.resolve(root),
      framework: "unknown",
      language: "javascript",
      buildTool: "unknown",
      srcDir: ".",
      conventions: "",
    };
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  let framework = detectFramework(allDeps);

  // Monorepo: if root has no framework, find the app package
  if (framework === "unknown") {
    const appDir = findAppInMonorepo(root);
    if (appDir) {
      console.log(`   📦 monorepo 检测到子项目: ${path.relative(root, appDir)}`);
      return scanProject(appDir);
    }
  }

  const buildTool = (() => {
    if (allDeps["vite"]) return "vite" as const;
    if (allDeps["webpack"] || allDeps["webpack-cli"]) return "webpack" as const;
    return "unknown" as const;
  })();

  const srcDir = fs.existsSync(path.join(root, "src")) ? "src" : ".";

  const language = fs.existsSync(path.join(root, "tsconfig.json"))
    ? ("typescript" as const)
    : ("javascript" as const);

  return {
    resolvedRoot: path.resolve(root),
    framework,
    language,
    buildTool,
    srcDir,
    conventions: "",
  };
}
