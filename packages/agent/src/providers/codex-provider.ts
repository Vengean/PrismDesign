import path from "node:path";
import { Codex, type Thread, type ThreadItem } from "@openai/codex-sdk";
import type { AgentProvider, AgentResult, EventCallback } from "../core/types.js";

const SESSION_TIMEOUT = 30 * 60 * 1000;

interface SessionEntry {
  thread: Thread;
  lastActive: number;
}

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;
  readonly model = process.env.CODEX_MODEL || "Codex CLI default";
  readonly capabilities = { streaming: true, sessions: true, cancel: true, rollback: false };
  private readonly codex: Codex;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly projectRoot: string) {
    // With no apiKey option the spawned official CLI reuses its own login state
    // (normally stored under CODEX_HOME). Never read or copy auth.json here.
    const useWebSocket = process.env.CODEX_TRANSPORT === "websocket";
    this.codex = new Codex(useWebSocket ? {} : {
      // ChatGPT-login Codex currently retries WebSocket connections for roughly
      // 75 seconds before falling back on networks where WS is unavailable.
      // Use the same authenticated Codex endpoint over HTTPS/SSE directly.
      config: {
        model_provider: "prism_chatgpt_https",
        model_providers: {
          prism_chatgpt_https: {
            name: "Prism ChatGPT HTTPS",
            base_url: "https://chatgpt.com/backend-api/codex",
            wire_api: "responses",
            requires_openai_auth: true,
            supports_websockets: false,
          },
        },
      },
    });
    this.cleanupTimer = setInterval(() => this.cleanupSessions(), 5 * 60 * 1000);
  }

  private getThread(clientId: string): Thread {
    const existing = this.sessions.get(clientId);
    if (existing) {
      existing.lastActive = Date.now();
      return existing.thread;
    }
    const thread = this.codex.startThread({
      workingDirectory: this.projectRoot,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      model: process.env.CODEX_MODEL || undefined,
      modelReasoningEffort: (process.env.CODEX_REASONING_EFFORT as "minimal" | "low" | "medium" | "high" | "xhigh" | undefined),
      networkAccessEnabled: process.env.CODEX_NETWORK_ACCESS === "true",
      skipGitRepoCheck: true,
    });
    this.sessions.set(clientId, { thread, lastActive: Date.now() });
    return thread;
  }

  private toolLabel(item: ThreadItem): { tool: string; label: string } | null {
    if (item.type === "command_execution") {
      return { tool: "command_execution", label: `执行命令 ${item.command.slice(0, 100)}` };
    }
    if (item.type === "file_change") {
      return { tool: "file_change", label: `修改文件 ${item.changes.map((change) => change.path).join(", ")}` };
    }
    if (item.type === "mcp_tool_call") {
      return { tool: "mcp_tool_call", label: `调用工具 ${item.server}/${item.tool}` };
    }
    if (item.type === "web_search") return { tool: "web_search", label: `搜索 ${item.query}` };
    return null;
  }

  async run(clientId: string, runId: string, message: string, emit: EventCallback, signal?: AbortSignal): Promise<AgentResult> {
    const filesModified = new Set<string>();
    const messageTextById = new Map<string, string>();
    let finalMessage = "";
    let terminalFailure: string | null = null;
    let streamWarning: string | null = null;
    const streamed = await this.getThread(clientId).runStreamed(message, { signal });

    const emitMessageUpdate = (item: Extract<ThreadItem, { type: "agent_message" }>) => {
      const previous = messageTextById.get(item.id) || "";
      const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text;
      messageTextById.set(item.id, item.text);
      if (delta) emit({ type: "message.delta", runId, delta });
    };

    for await (const event of streamed.events) {
      if (event.type === "item.started") {
        if (event.item.type === "agent_message") emitMessageUpdate(event.item);
        const tool = this.toolLabel(event.item);
        if (tool) emit({ type: "tool.started", runId, toolCallId: event.item.id, ...tool });
        continue;
      }
      if (event.type === "item.updated") {
        if (event.item.type === "agent_message") emitMessageUpdate(event.item);
        continue;
      }
      if (event.type === "item.completed") {
        const item = event.item;
        const tool = this.toolLabel(item);
        if (tool) {
          const success = !((item.type === "command_execution" || item.type === "mcp_tool_call") && item.status === "failed")
            && !(item.type === "file_change" && item.status === "failed");
          emit({ type: "tool.completed", runId, toolCallId: item.id, tool: tool.tool, success });
        }
        if (item.type === "agent_message") {
          emitMessageUpdate(item);
          finalMessage = item.text;
        } else if (item.type === "file_change" && item.status === "completed") {
          for (const change of item.changes) {
            const filePath = path.isAbsolute(change.path) ? path.relative(this.projectRoot, change.path) : change.path;
            filesModified.add(filePath);
            emit({
              type: "file.changed",
              runId,
              path: filePath,
              operation: change.kind === "add" ? "create" : change.kind === "delete" ? "delete" : "update",
            });
          }
        } else if (item.type === "error") {
          streamWarning = item.message;
        }
        continue;
      }
      if (event.type === "turn.failed") terminalFailure = event.error.message;
      // Codex can emit an error-shaped transport event and then successfully
      // fall back from WebSocket to HTTPS. Keep it as a warning unless the turn
      // produces no final response.
      if (event.type === "error") streamWarning = event.message;
    }

    if (terminalFailure) throw new Error(terminalFailure);
    if (!finalMessage && streamWarning) throw new Error(streamWarning);
    return { runId, success: true, message: finalMessage || "修改完成。", filesModified: [...filesModified] };
  }

  clearSession(clientId: string): void {
    this.sessions.delete(clientId);
  }

  private cleanupSessions(): void {
    const cutoff = Date.now() - SESSION_TIMEOUT;
    for (const [id, entry] of this.sessions) if (entry.lastActive < cutoff) this.sessions.delete(id);
  }

  close(): void {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
  }
}
