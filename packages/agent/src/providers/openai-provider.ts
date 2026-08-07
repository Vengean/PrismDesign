import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Agent, MemorySession, run, tool } from "@openai/agents";
import { z } from "zod";
import type { AgentProvider, AgentResult, EventCallback } from "../core/types.js";
import type { ToolRegistry } from "../testing/tool-registry.js";

const execFileAsync = promisify(execFile);
const SESSION_TIMEOUT = 30 * 60 * 1000;
const MAX_OUTPUT = 80_000;

interface SessionEntry {
  session: MemorySession;
  lastActive: number;
}

function safeProjectPath(root: string, requested: string): string {
  const resolved = path.resolve(root, requested || ".");
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path is outside the project workspace: ${requested}`);
  }
  return resolved;
}

function displayPath(root: string, filePath: string): string {
  return path.relative(root, filePath) || ".";
}

export class OpenAIProvider implements AgentProvider {
  readonly name = "openai" as const;
  readonly model: string;
  readonly capabilities = { streaming: true, sessions: true, cancel: true, rollback: false };
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly projectRoot: string, private readonly toolRegistry?: ToolRegistry) {
    this.model = process.env.OPENAI_MODEL || "gpt-5.6";
    this.cleanupTimer = setInterval(() => this.cleanupSessions(), 5 * 60 * 1000);
  }

  private getSession(clientId: string): MemorySession {
    const existing = this.sessions.get(clientId);
    if (existing) {
      existing.lastActive = Date.now();
      return existing.session;
    }
    const session = new MemorySession({ sessionId: clientId });
    this.sessions.set(clientId, { session, lastActive: Date.now() });
    return session;
  }

  private createTools(clientId: string, runId: string, emit: EventCallback, filesModified: Set<string>) {
    let sequence = 0;
    const execute = async <T>(name: string, label: string, fn: () => Promise<T>): Promise<T> => {
      const toolCallId = `${runId}-${name}-${++sequence}`;
      emit({ type: "tool.started", runId, toolCallId, tool: name, label });
      try {
        const result = await fn();
        emit({ type: "tool.completed", runId, toolCallId, tool: name, success: true });
        return result;
      } catch (error) {
        emit({ type: "tool.completed", runId, toolCallId, tool: name, success: false });
        throw error;
      }
    };

    const workspaceTools = [
      tool({
        name: "read_file",
        description: "Read a UTF-8 text file inside the project workspace.",
        parameters: z.object({ path: z.string(), startLine: z.number().int().positive().optional(), endLine: z.number().int().positive().optional() }),
        execute: ({ path: requested, startLine, endLine }) => execute("read_file", `读取 ${requested}`, async () => {
          const content = fs.readFileSync(safeProjectPath(this.projectRoot, requested), "utf8");
          const lines = content.split("\n");
          return lines.slice((startLine || 1) - 1, endLine || lines.length).join("\n").slice(0, MAX_OUTPUT);
        }),
      }),
      tool({
        name: "list_files",
        description: "List project files using ripgrep globs. Use this before guessing file names.",
        parameters: z.object({ pattern: z.string().default("**/*") }),
        execute: ({ pattern }) => execute("list_files", `搜索文件 ${pattern}`, async () => {
          const { stdout } = await execFileAsync("rg", ["--files", "-g", pattern, "-g", "!node_modules", "-g", "!.git"], { cwd: this.projectRoot, maxBuffer: MAX_OUTPUT });
          return stdout.slice(0, MAX_OUTPUT);
        }),
      }),
      tool({
        name: "search_files",
        description: "Search text in project files with ripgrep.",
        parameters: z.object({ query: z.string(), glob: z.string().optional() }),
        execute: ({ query, glob }) => execute("search_files", `搜索内容 ${query}`, async () => {
          const args = ["-n", "--hidden", "-g", "!node_modules", "-g", "!.git"];
          if (glob) args.push("-g", glob);
          args.push("--", query, ".");
          try {
            const { stdout } = await execFileAsync("rg", args, { cwd: this.projectRoot, maxBuffer: MAX_OUTPUT });
            return stdout.slice(0, MAX_OUTPUT);
          } catch (error: any) {
            if (error?.code === 1) return "No matches found.";
            throw error;
          }
        }),
      }),
      tool({
        name: "write_file",
        description: "Create or replace a UTF-8 text file inside the project. Prefer edit_file for existing files.",
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: ({ path: requested, content }) => execute("write_file", `写入 ${requested}`, async () => {
          const filePath = safeProjectPath(this.projectRoot, requested);
          const operation = fs.existsSync(filePath) ? "update" as const : "create" as const;
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, "utf8");
          const relative = displayPath(this.projectRoot, filePath);
          filesModified.add(relative);
          emit({ type: "file.changed", runId, path: relative, operation });
          return `Wrote ${relative}`;
        }),
      }),
      tool({
        name: "edit_file",
        description: "Replace one exact text occurrence in an existing project file.",
        parameters: z.object({ path: z.string(), oldText: z.string(), newText: z.string() }),
        execute: ({ path: requested, oldText, newText }) => execute("edit_file", `编辑 ${requested}`, async () => {
          const filePath = safeProjectPath(this.projectRoot, requested);
          const content = fs.readFileSync(filePath, "utf8");
          const first = content.indexOf(oldText);
          if (first < 0) throw new Error("oldText was not found");
          if (content.indexOf(oldText, first + oldText.length) >= 0) throw new Error("oldText is not unique; provide more surrounding context");
          fs.writeFileSync(filePath, content.slice(0, first) + newText + content.slice(first + oldText.length), "utf8");
          const relative = displayPath(this.projectRoot, filePath);
          filesModified.add(relative);
          emit({ type: "file.changed", runId, path: relative, operation: "update" });
          return `Edited ${relative}`;
        }),
      }),
    ];
    if (!this.toolRegistry) return workspaceTools;
    const browserActionSchema = z.object({
      sessionId: z.string(),
      action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("click"), target: z.record(z.string(), z.unknown()) }),
        z.object({ type: z.literal("fill"), target: z.record(z.string(), z.unknown()), value: z.string() }),
        z.object({ type: z.literal("press"), target: z.record(z.string(), z.unknown()), key: z.string() }),
      ]),
    });
    return [...workspaceTools,
      tool({ name: "browser_start", description: "Start an isolated real browser session for the application.", parameters: z.object({ baseUrl: z.string().url(), verificationId: z.string().optional() }), execute: (input) => execute("browser.start", "启动真实浏览器", () => this.toolRegistry!.execute("browser.start", input, { clientId, runId })) }),
      tool({ name: "browser_navigate", description: "Navigate the browser to a URL.", parameters: z.object({ sessionId: z.string(), url: z.string() }), execute: (input) => execute("browser.navigate", `打开 ${input.url}`, () => this.toolRegistry!.execute("browser.navigate", input, { clientId, runId })) }),
      tool({ name: "browser_observe", description: "Observe interactive page elements and receive short-lived refs.", parameters: z.object({ sessionId: z.string() }), execute: (input) => execute("browser.observe", "观察页面", () => this.toolRegistry!.execute("browser.observe", input, { clientId, runId })) }),
      tool({ name: "browser_action", description: "Click, fill, or press a key in the real browser. Prefer refs from browser_observe.", parameters: browserActionSchema, execute: (input) => execute("browser.action", `执行浏览器操作 ${input.action.type}`, () => this.toolRegistry!.execute("browser.action", input, { clientId, runId })) }),
      tool({ name: "browser_evidence", description: "Inspect network and runtime error evidence.", parameters: z.object({ sessionId: z.string() }), execute: (input) => execute("browser.evidence", "检查浏览器证据", () => this.toolRegistry!.execute("browser.evidence", input, { clientId, runId })) }),
      tool({ name: "browser_stop", description: "Close a browser session after verification.", parameters: z.object({ sessionId: z.string() }), execute: (input) => execute("browser.stop", "关闭浏览器", () => this.toolRegistry!.execute("browser.stop", input, { clientId, runId })) }),
    ];
  }

  async run(clientId: string, runId: string, message: string, emit: EventCallback, signal?: AbortSignal): Promise<AgentResult> {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 未配置");
    const filesModified = new Set<string>();
    const agent = new Agent({
      name: "PrismDesign OpenAI Agent",
      model: this.model,
      instructions: [
        "You are a coding agent editing the current frontend project.",
        "Inspect relevant files before editing. Make the smallest coherent change that satisfies the request.",
        "Only use the provided workspace tools. Never claim a file was changed unless a tool changed it.",
        "When asked to verify a running web application, use browser tools and base conclusions on observed evidence. Do not generate test scripts unless explicitly requested.",
        `The project root is ${this.projectRoot}.`,
      ].join("\n"),
      tools: this.createTools(clientId, runId, emit, filesModified),
    });

    const stream = await run(agent, message, { stream: true, session: this.getSession(clientId), signal });
    for await (const event of stream) {
      if (event.type !== "raw_model_stream_event") continue;
      const data = event.data as any;
      if (data?.type === "output_text_delta" || data?.type === "response.output_text.delta") {
        const delta = data.delta || "";
        if (delta) emit({ type: "message.delta", runId, delta });
      }
    }
    await stream.completed;

    return {
      runId,
      success: true,
      message: typeof stream.finalOutput === "string" ? stream.finalOutput : JSON.stringify(stream.finalOutput ?? ""),
      filesModified: [...filesModified],
    };
  }

  async clearSession(clientId: string): Promise<void> {
    const entry = this.sessions.get(clientId);
    if (entry) await entry.session.clearSession();
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
