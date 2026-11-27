import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Codex, type Thread, type ThreadItem } from "@openai/codex-sdk";
import { codexAuthentication } from './codex-auth.js';
import {persistCodexImages} from './codex-images.js';
import {projectMcpServers} from '../project-context.js';
import {executionPolicy} from '../execution-policy.js';
import type { AgentProvider, AgentResult, EventCallback } from "../core/types.js";

const SESSION_TIMEOUT = 30 * 60 * 1000;

interface SessionEntry {
  thread: Thread;
  lastActive: number;
}

export function codexClientOptions(projectRoot=process.cwd()) {
    // Subscription mode reuses the official CLI login state under CODEX_HOME.
    // API mode supplies a key explicitly; neither mode reads auth.json here.
    const auth=codexAuthentication();
    const useWebSocket = process.env.CODEX_TRANSPORT === "websocket";
    const mcpServerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "testing", "mcp-browser-server.js");
    const browserEnabled = process.env.PRISM_PERMISSION_BROWSER !== "false";
    const commonConfig = {
      ...auth.config,
      // Prism verification must use its own Chrome-extension MCP. The desktop
      // Codex installation may globally enable the bundled Browser plugin and
      // node_repl browser backends; disable them only for this SDK child so the
      // model cannot select an unrelated runtime with no browser instances.
      plugins: {
        "browser@openai-bundled": { enabled: false },
      },
      mcp_servers: {
        ...Object.fromEntries(Object.entries(projectMcpServers(projectRoot)).map(([name,server])=>[name,{...('url'in server?{url:server.url,http_headers:server.headers||{}}:{command:server.command,args:server.args||[],env:server.env||{}}),default_tools_approval_mode:server.defaultToolsApprovalMode||'approve'}])),
        // Codex validates transport even for disabled servers. A complete,
        // inert stdio definition also works in clean container profiles.
        node_repl: { enabled: false, command: process.execPath, args: ['--version'] },
        ...(browserEnabled ? { prism_browser: {
          command: process.execPath,
          args: [mcpServerPath],
          // The user explicitly authorizes this bounded verification run by
          // clicking Start Test. Without this, approvalPolicy=never causes
          // Codex to report every MCP call as "user cancelled".
          default_tools_approval_mode: "approve",
          env: {
            PRISM_AGENT_URL: process.env.PRISM_AGENT_URL || "http://127.0.0.1:9527",
          },
        } } : {}),
      },
    };
    return auth.apiKey || useWebSocket ? {...auth,config:commonConfig} : {
      ...auth,
      // ChatGPT-login Codex currently retries WebSocket connections for roughly
      // 75 seconds before falling back on networks where WS is unavailable.
      // Use the same authenticated Codex endpoint over HTTPS/SSE directly.
      config: {
        ...commonConfig,
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
    };
}

export class CodexProvider implements AgentProvider {
  readonly name = "codex" as const;
  readonly model = process.env.CODEX_MODEL || "Codex CLI default";
  readonly capabilities = { streaming: true, sessions: true, cancel: true, rollback: false };
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly projectRoot: string,private readonly clientFactory=(options:ReturnType<typeof codexClientOptions>)=>new Codex(options)) {
    this.cleanupTimer = setInterval(() => this.cleanupSessions(), 5 * 60 * 1000);
  }

  private getThread(clientId:string,readOnly=false):Thread {
    const existing=this.sessions.get(clientId),client=this.clientFactory(codexClientOptions(this.projectRoot));
    const options={workingDirectory:this.projectRoot,...executionPolicy(this.projectRoot,readOnly),model:process.env.CODEX_MODEL||undefined,
      modelReasoningEffort:(process.env.CODEX_REASONING_EFFORT as "minimal"|"low"|"medium"|"high"|"xhigh"|undefined),skipGitRepoCheck:true};
    const thread=existing?.thread.id?client.resumeThread(existing.thread.id,options):client.startThread(options);
    this.sessions.set(clientId,{thread,lastActive:Date.now()});return thread;
  }

  private toolLabel(item: ThreadItem): { tool: string; label: string } | null {
    if (item.type === "command_execution") {
      return { tool: "command_execution", label: `执行命令 ${item.command}` };
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

  private snapshotProjectFiles(): Map<string, string> {
    const snapshot = new Map<string, string>();
    const ignored = new Set([".git", ".codex", ".global", "node_modules", "dist", "build", ".next", ".turbo", "coverage"]);
    const visit = (directory: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) { visit(absolute); continue; }
        if (!entry.isFile()) continue;
        if (/\.(?:db|sqlite)(?:-(?:wal|shm|journal))?$/i.test(entry.name)) continue;
        try {
          const stat = fs.statSync(absolute);
          snapshot.set(path.relative(this.projectRoot, absolute), `${stat.size}:${stat.mtimeMs}`);
        } catch {}
      }
    };
    visit(this.projectRoot);
    return snapshot;
  }

  async run(clientId: string, runId: string, message: string, emit: EventCallback, signal?: AbortSignal,options:{readOnly?:boolean}={}): Promise<AgentResult> {
    const beforeFiles = this.snapshotProjectFiles();
    const filesModified = new Set<string>();
    const messageTextById = new Map<string, string>();
    let finalMessage = "";
    let terminalFailure: string | null = null;
    let streamWarning: string | null = null;
    const thread=this.getThread(clientId,options.readOnly);
    const streamed = await thread.runStreamed(message, { signal });

    const emitMessageUpdate = (item: Extract<ThreadItem, { type: "agent_message" }>) => {
      const previous = messageTextById.get(item.id) || "";
      const delta = item.text.startsWith(previous) ? item.text.slice(previous.length) : item.text;
      messageTextById.set(item.id, item.text);
      if (delta) emit({ type: "message.delta", runId, delta, messageId: item.id });
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
          const error = item.type === "mcp_tool_call" ? item.error?.message : undefined;
          emit({ type: "tool.completed", runId, toolCallId: item.id, tool: tool.tool, success, error });
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
    const images=persistCodexImages(this.projectRoot,thread.id,runId);
    for(const image of images){filesModified.add(image);emit({type:'file.changed',runId,path:image,operation:'create'});}
    if(images.length)finalMessage+='\n\n'+images.map((image,index)=>`![生成图片 ${index+1}](/workspace/${image})\n\n[下载原图 ${index+1}](/workspace/${image})`).join('\n\n');
    const afterFiles = this.snapshotProjectFiles();
    for (const [filePath, fingerprint] of afterFiles) {
      if (beforeFiles.get(filePath) !== fingerprint) filesModified.add(filePath);
    }
    for (const filePath of beforeFiles.keys()) {
      if (!afterFiles.has(filePath)) filesModified.add(filePath);
    }
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
