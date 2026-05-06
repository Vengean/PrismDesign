import {
  unstable_v2_createSession,
  type SDKSession,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProjectProfile } from "./project-profiler.js";
import { buildSystemPrompt } from "./prompt-builder.js";

export interface AgentResult {
  success: boolean;
  message: string;
  filesModified: string[];
}

// ---- Multi-user session management ----

interface UserSession {
  session: SDKSession;
  initialized: boolean; // whether project context has been sent
  lastActive: number;
}

const sessions = new Map<string, UserSession>();
let projectRoot: string;
let profile: ProjectProfile;

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Initialize the agent module with project info.
 * Called once at startup.
 */
export function initAgent(root: string, proj: ProjectProfile) {
  projectRoot = root;
  profile = proj;

  // Periodically clean up stale sessions
  setInterval(cleanupStaleSessions, 5 * 60 * 1000);
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

  const session = unstable_v2_createSession({
    model: "claude-sonnet-4-6",
    cwd: projectRoot,
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
  });

  userSession = {
    session,
    initialized: false,
    lastActive: Date.now(),
  };

  sessions.set(clientId, userSession);
  return userSession;
}

/**
 * Send project context on first message of a session.
 */
function buildInitMessage(userMessage: string): string {
  const systemPrompt = buildSystemPrompt(profile);
  return `${systemPrompt}\n\n---\n\n${userMessage}`;
}

/**
 * Run agent for a specific client.
 * First message includes project context, subsequent messages are user-only.
 */
export type ProgressCallback = (text: string) => void;

export async function runAgent(
  clientId: string,
  userMessage: string,
  onProgress?: ProgressCallback,
): Promise<AgentResult> {
  const userSession = getSession(clientId);
  const { session } = userSession;

  // First message includes project context
  const message = userSession.initialized
    ? userMessage
    : buildInitMessage(userMessage);

  console.log(
    `[Agent] 客户端 ${clientId} ${userSession.initialized ? "继续会话" : "初始化会话"}`
  );

  await session.send(message);
  userSession.initialized = true;

  let resultText = "";
  const filesModified: string[] = [];

  try {
    for await (const msg of session.stream()) {
      const raw = JSON.stringify(msg);
      console.log(
        "[Agent] 消息:",
        raw.length > 500 ? raw.slice(0, 500) + "..." : raw
      );

      if (isToolUseMessage(msg)) {
        const toolName = getToolName(msg);
        const filePath = getToolFilePath(msg);
        if (filePath) {
          if ((toolName === "Write" || toolName === "Edit") && !filesModified.includes(filePath)) {
            filesModified.push(filePath);
          }
          const shortPath = filePath.split("/").slice(-2).join("/");
          const TOOL_LABELS: Record<string, string> = {
            Read: "读取", Write: "写入", Edit: "编辑",
            Glob: "搜索文件", Grep: "搜索内容", Bash: "执行命令",
          };
          onProgress?.(`${TOOL_LABELS[toolName] || toolName} ${shortPath}`);
        } else if (toolName) {
          const TOOL_LABELS: Record<string, string> = {
            Glob: "搜索文件", Grep: "搜索内容", Bash: "执行命令",
          };
          onProgress?.(`${TOOL_LABELS[toolName] || toolName}...`);
        }
      } else if (isTextMessage(msg)) {
        const text = getTextContent(msg);
        if (text) onProgress?.(text.length > 80 ? text.slice(0, 80) + "..." : text);
      }

      if ("result" in msg) {
        resultText = (msg as any).result || "";
      }
    }
  } catch (error) {
    console.error(`[Agent] 客户端 ${clientId} 会话错误:`, error);
    // Remove broken session so next call creates a fresh one
    removeSession(clientId);
    throw error;
  }

  console.log("[Agent] 完成, result:", resultText.slice(0, 300));

  return {
    success: true,
    message: resultText,
    filesModified,
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
  for (const [clientId] of sessions) {
    removeSession(clientId);
  }
  console.log("[Agent] 所有会话已关闭");
}

// ---- Helpers ----

/** Get content blocks from an assistant message */
function getContentBlocks(msg: SDKMessage): any[] {
  const m = msg as any;
  if (m.type === "assistant" && m.message?.content) {
    return Array.isArray(m.message.content) ? m.message.content : [];
  }
  return [];
}

function isToolUseMessage(msg: SDKMessage): boolean {
  const m = msg as any;
  if (m.type === "tool_use" || m.subtype === "tool_use") return true;
  return getContentBlocks(msg).some((b: any) => b.type === "tool_use");
}

function getToolName(msg: SDKMessage): string {
  const m = msg as any;
  if (m.name) return m.name;
  const block = getContentBlocks(msg).find((b: any) => b.type === "tool_use");
  return block?.name || "";
}

function getToolFilePath(msg: SDKMessage): string | undefined {
  const m = msg as any;
  const input = m.input || m.arguments || {};
  if (input.file_path || input.path || input.filePath) {
    return input.file_path || input.path || input.filePath;
  }
  const block = getContentBlocks(msg).find((b: any) => b.type === "tool_use");
  const blockInput = block?.input || {};
  return blockInput.file_path || blockInput.path || blockInput.filePath;
}

function isTextMessage(msg: SDKMessage): boolean {
  const m = msg as any;
  if (m.type === "text" || m.subtype === "text") return true;
  return getContentBlocks(msg).some((b: any) => b.type === "text");
}

function getTextContent(msg: SDKMessage): string {
  const m = msg as any;
  if (m.text) return m.text;
  const block = getContentBlocks(msg).find((b: any) => b.type === "text");
  return block?.text || "";
}
