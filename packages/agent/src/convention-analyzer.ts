import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
import type { ProjectProfile } from "./project-profiler.js";

export async function analyzeConventions(
  root: string,
  profile: ProjectProfile
): Promise<string> {
  const ext = profile.language === "typescript" ? "tsx" : "jsx";
  const vuePattern = profile.framework === "vue" || profile.framework === "nuxt" ? "、*.vue" : "";

  const prompt = `分析这个 ${profile.framework} 项目的编码规范。
请用 Glob 找到 ${profile.srcDir} 下的 *.${ext}${vuePattern} 组件文件（最多5个），
然后用 Read 读取它们的内容。

重点总结：
1. 样式怎么写的（className 命名、CSS 文件组织、主题变量使用方式）
2. 组件结构（函数组件 vs class、props 定义方式）
3. 文件组织方式
4. 常用的 UI 组件和用法模式

用简洁的条目列出规范，不超过 300 字。只输出规范内容，不要输出其他说明。`;

  try {
    const result = await unstable_v2_prompt(prompt, {
      model: "claude-haiku-4-5",
      cwd: root,
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    });

    return (result as any).result || "未能自动分析，请遵循项目已有代码风格";
  } catch (error) {
    console.warn("[Convention] 分析失败:", error);
    return "未能自动分析，请遵循项目已有代码风格";
  }
}
