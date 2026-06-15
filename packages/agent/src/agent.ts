import {
  unstable_v2_createSession,
  type SDKSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProjectProfile } from "./project-profiler.js";

export interface AgentResult {
  success: boolean;
  message: string;
  filesModified: string[];
}

// ---- Multi-user session management ----

interface UserSession {
  session: SDKSession;
  lastActive: number;
}

const sessions = new Map<string, UserSession>();
let projectRoot: string;
let profile: ProjectProfile;

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the agent module with project info.
 * Called once at startup.
 */
export function initAgent(root: string, proj: ProjectProfile) {
  projectRoot = root;
  profile = proj;

  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(cleanupStaleSessions, 5 * 60 * 1000);
}

/**
 * Get or create a session for a specific client.
 */
function getSession(clientId: string): UserSession {
  let userSession = sessions.get(clientId);

  if (userSession) {
    userSession.lastActive = Date.now();
    return userSession;
  }

  console.log(`[Agent] 为客户端 ${clientId} 创建新会话`);

  const defaultOptions: Record<string, unknown> = {
    cwd: projectRoot,
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    settingSources: ["project" as const],
  };

  // Set model from env var or default
  defaultOptions.model = process.env.ANTHROPIC_MODEL || "claude-opus-4-6";

  // Pass env vars explicitly so the spawned claude CLI inherits them
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL) {
    defaultOptions.env = {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "",
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "",
    };
  }

  // Merge SDK options from prism.config (config options override defaults)
  const sessionOptions = profile.sdkOptions
    ? { ...defaultOptions, ...profile.sdkOptions }
    : defaultOptions;

  console.log(`[Agent] 创建会话, options:`, JSON.stringify({
    ...sessionOptions,
    env: undefined,
  }));
  console.log(`[Agent] 环境变量: MODEL=${process.env.ANTHROPIC_MODEL}, BASE_URL=${process.env.ANTHROPIC_BASE_URL}, KEY=${process.env.ANTHROPIC_API_KEY?.slice(0, 10)}...`);

  const session = unstable_v2_createSession(sessionOptions as any);

  userSession = {
    session,
    lastActive: Date.now(),
  };

  sessions.set(clientId, userSession);
  return userSession;
}

/**
 * Run agent for a specific client.
 */
export type ProgressCallback = (text: string) => void;

export async function runAgent(
  clientId: string,
  userMessage: string,
  onProgress?: ProgressCallback,
): Promise<AgentResult> {
  const userSession = getSession(clientId);
  const { session } = userSession;

  console.log(`[Agent] 客户端 ${clientId} 发送消息:`);
  console.log(userMessage.length > 2000 ? userMessage.slice(0, 2000) + "\n...(truncated)" : userMessage);

  const TOOL_LABELS: Record<string, string> = {
    Read: "读取", Write: "写入", Edit: "编辑",
    Glob: "搜索文件", Grep: "搜索内容", Bash: "执行命令",
  };

  let resultText = "";
  const textParts: string[] = [];
  const filesModified = new Set<string>();

  try {
    await session.send(userMessage);

    for await (const msg of session.stream()) {
      const m = msg as any;

      // SDKResultMessage — type: 'result'
      if (m.type === "result") {
        resultText = m.result || "";
        console.log("[Agent] 收到 result:", resultText.slice(0, 500));
        continue;
      }

      // SDKAssistantMessage — type: 'assistant', contains message.content[]
      if (m.type === "assistant" && m.message?.content) {
        const blocks: any[] = Array.isArray(m.message.content) ? m.message.content : [];
        for (const block of blocks) {
          if (block.type === "tool_use") {
            const toolName = block.name || "";
            const input = block.input || {};
            const filePath = input.file_path || input.path || input.filePath;
            if (filePath) {
              if (toolName === "Write" || toolName === "Edit") filesModified.add(filePath);
              const shortPath = filePath.split("/").slice(-2).join("/");
              console.log(`[Agent] 工具调用: ${toolName} ${shortPath}`);
              onProgress?.(`${TOOL_LABELS[toolName] || toolName} ${shortPath}`);
            } else if (toolName) {
              console.log(`[Agent] 工具调用: ${toolName}`);
              onProgress?.(`${TOOL_LABELS[toolName] || toolName}...`);
            }
          } else if (block.type === "text" && block.text) {
            textParts.push(block.text);
            console.log("[Agent] 文本:", block.text.length > 200 ? block.text.slice(0, 200) + "..." : block.text);
            onProgress?.(block.text.length > 80 ? block.text.slice(0, 80) + "..." : block.text);
          }
        }
        continue;
      }
    }
  } catch (error) {
    console.error(`[Agent] 客户端 ${clientId} 会话错误:`, error);
    removeSession(clientId);
    throw error;
  }

  const finalMessage = resultText || textParts.join("\n\n");
  console.log("[Agent] 完成, filesModified:", [...filesModified]);
  console.log("[Agent] 返回结果:", finalMessage.slice(0, 500));

  return {
    success: true,
    message: finalMessage,
    filesModified: [...filesModified],
  };
}

/**
 * Remove a specific client's session.
 */
function removeSession(clientId: string) {
  const userSession = sessions.get(clientId);
  if (userSession) {
    try {
      userSession.session.close();
    } catch {}
    sessions.delete(clientId);
    console.log(`[Agent] 客户端 ${clientId} 会话已移除`);
  }
}

/**
 * Clean up sessions that have been inactive for too long.
 */
function cleanupStaleSessions() {
  const now = Date.now();
  for (const [clientId, userSession] of sessions) {
    if (now - userSession.lastActive > SESSION_TIMEOUT) {
      console.log(`[Agent] 清理过期会话: ${clientId}`);
      removeSession(clientId);
    }
  }
}

/**
 * Close all sessions (e.g., on server shutdown).
 */
export function closeAllSessions() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  for (const [clientId] of sessions) {
    removeSession(clientId);
  }
  console.log("[Agent] 所有会话已关闭");
}

