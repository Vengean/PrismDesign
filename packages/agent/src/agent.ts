import {
  unstable_v2_createSession,
  type SDKSession,
} from "@anthropic-ai/claude-agent-sdk";

export interface AgentResult {
  success: boolean;
  message: string;
  filesModified: string[];
}

export type ProgressCallback = (text: string) => void;

// ---- Multi-user session management ----

interface UserSession {
  session: SDKSession;
  lastActive: number;
}

const sessions = new Map<string, UserSession>();
let projectRoot: string;

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize the Claude agent module.
 */
export function initAgent(root: string) {
  projectRoot = root;

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

  console.log(`[Claude] 为客户端 ${clientId} 创建新会话`);

  const filesystem = process.env.PRISM_PERMISSION_FILESYSTEM || "workspace-write";
  const commands = process.env.PRISM_PERMISSION_COMMANDS || "none";
  const allowedTools = ["Read", "Glob", "Grep"];
  if (filesystem === "workspace-write") allowedTools.push("Write", "Edit");
  if (commands === "workspace") allowedTools.push("Bash");

  const sessionOptions: Record<string, unknown> = {
    cwd: projectRoot,
    allowedTools,
    disallowedTools: process.env.PRISM_PERMISSION_NETWORK === "true" ? [] : ["WebFetch", "WebSearch"],
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    settingSources: ["project" as const],
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-6",
  };

  // Pass env vars explicitly so the spawned claude CLI inherits them
  // For claude-sub (subscription mode), skip API key/base_url — SDK uses ~/.claude/ credentials
  const isSubscription = process.env.AGENT_TYPE === "claude-sub";
  if (!isSubscription && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL)) {
    sessionOptions.env = {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "",
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || "",
    };
  }

  console.log(`[Claude] 创建会话, model=${sessionOptions.model}`);
  console.log(`[Claude] 环境变量: BASE_URL=${process.env.ANTHROPIC_BASE_URL || "(default)"}, KEY=${process.env.ANTHROPIC_API_KEY?.slice(0, 10)}...`);

  const session = unstable_v2_createSession(sessionOptions as any);

  userSession = { session, lastActive: Date.now() };
  sessions.set(clientId, userSession);
  return userSession;
}

/**
 * Run Claude agent for a specific client.
 */
export async function runAgent(
  clientId: string,
  userMessage: string,
  onProgress?: ProgressCallback,
): Promise<AgentResult> {
  const userSession = getSession(clientId);
  const { session } = userSession;

  console.log(`[Claude] 客户端 ${clientId} 发送消息:`);
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

      if (m.type === "result") {
        resultText = m.result || "";
        console.log("[Claude] 收到 result:", resultText.slice(0, 500));
        continue;
      }

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
              console.log(`[Claude] 工具调用: ${toolName} ${shortPath}`);
              onProgress?.(`${TOOL_LABELS[toolName] || toolName} ${shortPath}`);
            } else if (toolName) {
              console.log(`[Claude] 工具调用: ${toolName}`);
              onProgress?.(`${TOOL_LABELS[toolName] || toolName}...`);
            }
          } else if (block.type === "text" && block.text) {
            textParts.push(block.text);
            console.log("[Claude] 文本:", block.text.length > 200 ? block.text.slice(0, 200) + "..." : block.text);
            onProgress?.(block.text.length > 80 ? block.text.slice(0, 80) + "..." : block.text);
          }
        }
        continue;
      }
    }
  } catch (error) {
    console.error(`[Claude] 客户端 ${clientId} 会话错误:`, error);
    removeSession(clientId);
    throw error;
  }

  const finalMessage = resultText || textParts.join("\n\n");
  console.log("[Claude] 完成, filesModified:", [...filesModified]);

  return {
    success: true,
    message: finalMessage,
    filesModified: [...filesModified],
  };
}

function removeSession(clientId: string) {
  const userSession = sessions.get(clientId);
  if (userSession) {
    try { userSession.session.close(); } catch {}
    sessions.delete(clientId);
    console.log(`[Claude] 客户端 ${clientId} 会话已移除`);
  }
}

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [clientId, userSession] of sessions) {
    if (now - userSession.lastActive > SESSION_TIMEOUT) {
      console.log(`[Claude] 清理过期会话: ${clientId}`);
      removeSession(clientId);
    }
  }
}

export function closeAllSessions() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  for (const [clientId] of sessions) {
    removeSession(clientId);
  }
  console.log("[Claude] 所有会话已关闭");
}
