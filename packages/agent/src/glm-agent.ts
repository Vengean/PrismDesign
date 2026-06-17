import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

// ---- Public types (shared with server.ts) ----

export interface AgentResult {
  success: boolean;
  message: string;
  filesModified: string[];
}

export type ProgressCallback = (text: string) => void;

// ---- ACP Client implementation ----

class PrismAcpClient implements acp.Client {
  onProgress?: ProgressCallback;
  filesModified = new Set<string>();
  textParts: string[] = [];

  reset() {
    this.filesModified.clear();
    this.textParts = [];
  }

  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const approveOption = params.options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
    return {
      outcome: {
        outcome: "selected",
        optionId: approveOption?.optionId || params.options[0].optionId,
      },
    };
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text" && update.content.text) {
          this.textParts.push(update.content.text);
          this.onProgress?.(
            update.content.text.length > 80
              ? update.content.text.slice(0, 80) + "..."
              : update.content.text,
          );
        }
        break;
      case "tool_call": {
        const title = update.title || "";
        console.log(`[GLM] 工具调用: ${title} (${update.status})`);
        if (update.status === "running" || update.status === "in_progress") {
          this.onProgress?.(`${title}`);
        }
        // Track file modifications: "Write file: path/to/file" or "write_file path"
        if (/write.file/i.test(title)) {
          const match = title.match(/:\s*(.+)$/) || title.match(/[`']([^`']+)[`']/);
          if (match) this.filesModified.add(match[1].trim());
        }
        break;
      }
      case "tool_call_update":
        console.log(`[GLM] 工具更新: ${update.toolCallId} ${update.status}`);
        break;
      default:
        break;
    }
  }

  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    // glm-acp-agent handles file writes internally; this is for client-side fs
    console.log(`[GLM] writeTextFile: ${params.path}`);
    this.filesModified.add(params.path);
    return {};
  }

  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    console.log(`[GLM] readTextFile: ${params.path}`);
    // Let the agent handle file reads internally
    const fs = await import("node:fs");
    try {
      const content = fs.readFileSync(params.path, "utf-8");
      return { content };
    } catch {
      return { content: "" };
    }
  }
}

// ---- Session Management ----

interface GlmSession {
  process: ChildProcess;
  connection: acp.ClientSideConnection;
  sessionId: string;
  client: PrismAcpClient;
  lastActive: number;
}

const sessions = new Map<string, GlmSession>();
let projectRoot: string;

const SESSION_TIMEOUT = 30 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function initGlmAgent(root: string) {
  projectRoot = root;

  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(cleanupStaleSessions, 5 * 60 * 1000);
}

async function createSession(clientId: string): Promise<GlmSession> {
  console.log(`[GLM] 为客户端 ${clientId} 创建新会话`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("API Key 未配置");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    Z_AI_API_KEY: apiKey,
  };

  // Map our env vars to glm-acp-agent env vars
  if (process.env.ANTHROPIC_BASE_URL) {
    env.ACP_GLM_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }
  if (process.env.ANTHROPIC_MODEL) {
    env.ACP_GLM_MODEL = process.env.ANTHROPIC_MODEL;
  }

  // Spawn glm-acp-agent subprocess
  const agentProcess = spawn("glm-acp-agent", [], {
    stdio: ["pipe", "pipe", "inherit"],
    cwd: projectRoot,
    env,
  });

  agentProcess.on("error", (err) => {
    console.error(`[GLM] 进程启动失败:`, err.message);
  });

  const input = Writable.toWeb(agentProcess.stdin!);
  const output = Readable.toWeb(agentProcess.stdout!) as ReadableStream<Uint8Array>;

  const client = new PrismAcpClient();
  const stream = acp.ndJsonStream(input, output);
  const connection = new acp.ClientSideConnection((_agent) => client, stream);

  // Initialize connection
  const initResult = await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {
      fs: {
        readTextFile: true,
        writeTextFile: true,
      },
    },
  });

  console.log(`[GLM] ACP 连接建立 (protocol v${initResult.protocolVersion})`);

  // Set mode to bypass_permissions for non-interactive use
  const sessionResult = await connection.newSession({
    cwd: projectRoot,
    mcpServers: [],
  });

  const sessionId = sessionResult.sessionId;
  console.log(`[GLM] 会话创建: ${sessionId}`);

  // Try to set bypass_permissions mode
  try {
    await connection.setSessionMode({
      sessionId,
      mode: "bypass_permissions",
    });
    console.log(`[GLM] 已设置 bypass_permissions 模式`);
  } catch (err) {
    console.warn(`[GLM] 设置 bypass_permissions 失败:`, err);
  }

  const session: GlmSession = {
    process: agentProcess,
    connection,
    sessionId,
    client,
    lastActive: Date.now(),
  };

  sessions.set(clientId, session);
  return session;
}

async function getSession(clientId: string): Promise<GlmSession> {
  const existing = sessions.get(clientId);
  if (existing) {
    existing.lastActive = Date.now();
    return existing;
  }
  return createSession(clientId);
}

// ---- Agent execution ----

export async function runGlmAgent(
  clientId: string,
  userMessage: string,
  onProgress?: ProgressCallback,
): Promise<AgentResult> {
  const session = await getSession(clientId);
  session.client.onProgress = onProgress;
  session.client.reset();

  console.log(`[GLM] 客户端 ${clientId} 发送消息:`);
  console.log(
    userMessage.length > 2000
      ? userMessage.slice(0, 2000) + "\n...(truncated)"
      : userMessage,
  );

  try {
    const result = await session.connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: userMessage }],
    });

    console.log(`[GLM] 完成, stopReason=${result.stopReason}, filesModified:`, [...session.client.filesModified]);

    // Use collected text from agent_message_chunk events
    const finalMessage = session.client.textParts.join("") || "修改完成。";

    return {
      success: true,
      message: finalMessage,
      filesModified: [...session.client.filesModified],
    };
  } catch (error) {
    console.error(`[GLM] 客户端 ${clientId} 错误:`, error);
    removeSession(clientId);
    throw error;
  }
}

// ---- Cleanup ----

function removeSession(clientId: string) {
  const session = sessions.get(clientId);
  if (session) {
    try { session.connection.closeSession({ sessionId: session.sessionId }); } catch {}
    try { session.process.kill(); } catch {}
    sessions.delete(clientId);
    console.log(`[GLM] 客户端 ${clientId} 会话已移除`);
  }
}

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [clientId, session] of sessions) {
    if (now - session.lastActive > SESSION_TIMEOUT) {
      console.log(`[GLM] 清理过期会话: ${clientId}`);
      removeSession(clientId);
    }
  }
}

export function closeAllGlmSessions() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  for (const [clientId] of sessions) {
    removeSession(clientId);
  }
  console.log("[GLM] 所有会话已关闭");
}
