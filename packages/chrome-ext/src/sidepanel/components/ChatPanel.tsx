import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Trash2, MessageSquare, Plug, Loader2, AlertCircle, CheckCircle2, Circle, XCircle, ChevronDown, Paperclip, X } from "lucide-react";
import { t } from "../../shared/i18n.js";
import type { ChatMessage, ElementSelection, TestRunInfo } from "../../shared/types.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  agentUrl: string;
  setAgentUrl: (url: string) => void;
  connect: (url: string) => Promise<void>;
}

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  sendMessage: (text: string, attachments?: ChatMessage["attachments"]) => void;
  startVerification: (verification: NonNullable<ChatMessage["verification"]>) => void;
  fixVerification: (verification: NonNullable<ChatMessage["verification"]>, testRun?: TestRunInfo) => void;
  cancelCurrent: () => void;
  clearHistory: () => void;
  deleteMessage: (index: number) => void;
}

export function ChatPanel({ agent, chat, selection }: { agent: AgentState; chat: ChatState; selection: ElementSelection | null }) {
  if (!agent.connected && !agent.connecting) {
    return <ConnectionForm agent={agent} />;
  }
  if (agent.connecting) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p>{t("agent.connecting")}</p>
      </div>
    );
  }
  return <ChatView agent={agent} chat={chat} selection={selection} />;
}

function ConnectionForm({ agent }: { agent: AgentState }) {
  const [url, setUrl] = useState(agent.agentUrl);

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-4">
      <div className="text-center space-y-2">
        <Plug className="h-10 w-10 text-primary/30 mx-auto" />
        <p className="text-sm font-medium">{t("agent.connectTitle")}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("agent.connectDesc")}
        </p>
      </div>
      <div className="w-full space-y-2">
        <Input
          placeholder={agent.agentUrl}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") agent.connect(url); }}
        />
        <Button className="w-full" onClick={() => agent.connect(url)}>
          <Plug className="h-3.5 w-3.5 mr-1.5" />
          {t("agent.connect")}
        </Button>
        {agent.error && (
          <div className="flex items-start gap-1.5 p-2 rounded-md bg-destructive/10 text-destructive text-xs leading-relaxed">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{agent.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSelectionContext(sel: ElementSelection): string {
  const lines: string[] = [];
  lines.push(`Page: ${sel.pagePath}`);
  lines.push(`Element: <${sel.tagName}> ${sel.domPath}`);
  if (sel.componentChain) {
    // Keep only the last few meaningful components to avoid noise
    const parts = sel.componentChain.split(" > ");
    const trimmed = parts.length > 5 ? "... > " + parts.slice(-5).join(" > ") : sel.componentChain;
    lines.push(`Component: ${trimmed}`);
  }
  if (sel.component?.sourceFile) {
    let loc = sel.component.sourceFile;
    if (sel.component.sourceLine) loc += `:${sel.component.sourceLine}`;
    lines.push(`Source: ${loc}`);
  }
  if (sel.component?.props && Object.keys(sel.component.props).length > 0) {
    const propEntries = Object.entries(sel.component.props).slice(0, 8);
    const propStr = propEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    lines.push(`Props: ${propStr}`);
  }
  if (sel.id) lines.push(`id: ${sel.id}`);
  if (sel.className) lines.push(`class: ${sel.className.split(" ").slice(0, 5).join(" ")}`);
  if (sel.textContent) {
    lines.push(`DOM Structure:`);
    lines.push(sel.textContent);
  }
  return lines.join("\n");
}

function ChatView({ agent, chat, selection }: { agent: AgentState; chat: ChatState; selection: ElementSelection | null }) {
  const { messages, sending, sendMessage, startVerification, cancelCurrent, clearHistory, deleteMessage } = chat;
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; mimeType: string; size: number; uploading?: boolean; error?: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() && !attachments.some((item) => !item.uploading && !item.error)) return;
    let message = input;
    if (selection) {
      message += `\n\n--- Context ---\n${formatSelectionContext(selection)}`;
    }
    sendMessage(message, attachments.filter((item) => !item.uploading && !item.error).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size })));
    setInput("");
    setAttachments([]);
  };

  const addFiles = async (files: FileList | null) => {
    for (const file of Array.from(files || []).slice(0, Math.max(0, 5 - attachments.length))) {
      const temporaryId = `pending-${Date.now()}-${Math.random()}`;
      setAttachments((prev) => [...prev, { id: temporaryId, name: file.name, mimeType: file.type, size: file.size, uploading: true }]);
      try {
        const uploaded = await chrome.runtime.sendMessage({ type: "AGENT_UPLOAD_ATTACHMENT", payload: { name: file.name, mimeType: file.type, data: Array.from(new Uint8Array(await file.arrayBuffer())) } });
        if (uploaded?.error) throw new Error(uploaded.error);
        setAttachments((prev) => prev.map((item) => item.id === temporaryId ? uploaded : item));
      } catch (error) { setAttachments((prev) => prev.map((item) => item.id === temporaryId ? { ...item, uploading: false, error: String(error) } : item)); }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
            <MessageSquare className="h-8 w-8 text-primary/30" />
            <p className="text-center leading-relaxed">{t("chat.empty").split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}</p>
          </div>
        ) : (
          <>
          {messages.map((msg, i) => (
            <div key={i} className={`group flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "ai" && (
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">AI</div>
              )}
              <div className={`relative max-w-[85%] space-y-2 px-3 py-2 rounded-xl text-xs leading-relaxed ${msg.role === "user" ? "bg-blue-100 text-gray-900 rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}>
                {!msg.pending && <button
                  type="button"
                  title="删除此消息"
                  aria-label="删除此消息"
                  className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 hover:text-destructive"
                  onClick={() => deleteMessage(i)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>}
                {!!msg.attachments?.length && <div className="flex flex-wrap gap-1">{msg.attachments.map((file) => <span key={file.id} className="rounded border bg-background/70 px-1.5 py-0.5">📄 {file.name}</span>)}</div>}
                {msg.content.startsWith("⏳") ? (
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                    <span className="text-muted-foreground">{msg.content.slice(2)}</span>
                  </div>
                ) : (
                  <div className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{["passed", "failed", "inconclusive"].includes(msg.verification?.status || "")
                      ? msg.content.replace(/^\s*测试(?:通过|未通过|结果不确定)[。！!]?\s*/i, "")
                      : msg.content}</Markdown>
                  </div>
                )}
                {msg.verification && (
                  <div className="border border-primary/20 bg-background/70 rounded-lg p-2.5 space-y-2">
                    <div className="font-medium">{{ passed: "测试通过", failed: "测试未通过", inconclusive: "测试结果不确定" }[msg.verification.status || ""] || "是否开始当前页面真实浏览器测试？"}</div>
                    {msg.verification.status === "failed" && msg.verification.fixSuggestion && <div className="rounded-md border border-destructive/20 bg-destructive/5 p-2 text-muted-foreground">
                      <div className="font-medium text-foreground">建议修复</div>
                      <div className="mt-0.5">{msg.verification.fixSuggestion}</div>
                    </div>}
                    {!msg.testRun && !['passed', 'failed', 'inconclusive'].includes(msg.verification.status || "") && <>
                      {msg.verification.summary && <div className="text-muted-foreground">{msg.verification.summary}</div>}
                      <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                        {msg.verification.proposedChecks.map((check) => <li key={check}>{check}</li>)}
                      </ul>
                    </>}
                    {msg.testRun ? (
                      <TestRunDetails run={msg.testRun} onRetest={() => startVerification(msg.verification!)} onFix={() => chat.fixVerification(msg.verification!, msg.testRun)} />
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={["preparing", "running"].includes(msg.verification.status || "")}
                        onClick={() => startVerification(msg.verification!)}
                      >
                        {["preparing", "running"].includes(msg.verification.status || "") ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />测试运行中…</> : ["passed", "failed", "inconclusive"].includes(msg.verification.status || "") ? "重新测试" : "开始测试"}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          </>
        )}
      </div>

      <div className="border-t p-2 space-y-1.5">
        {!!attachments.length && <div className="flex flex-col gap-1">{attachments.map((file) => <div key={file.id} title={file.error} className={`flex max-w-full flex-wrap items-center gap-1 rounded border px-1.5 py-1 text-[11px] ${file.error ? "border-destructive bg-destructive/5 text-destructive" : "bg-muted"}`}>
          {file.uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : "📄"}
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button onClick={() => { setAttachments((prev) => prev.filter((item) => item.id !== file.id)); if (!file.uploading && !file.error) chrome.runtime.sendMessage({ type: "AGENT_DELETE_ATTACHMENT", payload: { id: file.id } }); }}><X className="h-3 w-3" /></button>
          {file.error && <span className="w-full break-words text-[10px] leading-4">{file.error}</span>}
        </div>)}</div>}
        <input ref={fileInputRef} type="file" multiple hidden accept=".txt,.md,.json,.csv,.html,.css,.js,.jsx,.ts,.tsx,.yaml,.yml,.xml,.sql,.log,.sh,.py,.java,.go,.rs" onChange={(event) => addFiles(event.target.files)} />
        <textarea
          className="w-full min-h-[60px] max-h-[120px] px-2.5 py-2 text-xs border rounded-md resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("chat.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={3}
        />
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="添加文件" onClick={() => fileInputRef.current?.click()} disabled={sending || attachments.length >= 5}><Paperclip className="h-3.5 w-3" /></Button>
          {sending && <Button size="sm" variant="destructive" className="h-7 text-xs px-2.5" onClick={cancelCurrent}>取消运行</Button>}
          {messages.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1" onClick={clearHistory}>
              <Trash2 className="h-3 w-3" />
              {t("chat.clearHistory")}
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs px-3 gap-1" onClick={handleSend} disabled={sending || attachments.some((item) => item.uploading || item.error) || (!input.trim() && !attachments.some((item) => !item.error))}>
            <Send className="h-3 w-3" />
            {t("chat.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}

const terminalRunStatuses = ["passed", "failed", "inconclusive", "cancelled", "timed_out"];

function durationLabel(startedAt: string, finishedAt?: string) {
  const milliseconds = Math.max(0, Date.parse(finishedAt || new Date().toISOString()) - Date.parse(startedAt));
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function TestRunDetails({ run, onRetest, onFix }: { run: TestRunInfo; onRetest: () => void; onFix: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const terminal = terminalRunStatuses.includes(run.status);
  const cases = run.cases || [];
  const evidence = run.evidence || [];

  return (
    <div className="space-y-2">
      {cases.length > 0 && <div className="space-y-1.5">
        <div className="font-medium">业务测试用例</div>
        {cases.map((testCase) => {
          const CaseIcon = testCase.status === "passed" ? CheckCircle2 : testCase.status === "failed" ? XCircle : testCase.status === "pending" ? Loader2 : AlertCircle;
          const statusLabel = {
            pending: "执行中",
            passed: "通过",
            failed: "失败",
            not_run: "未执行",
            insufficient_evidence: "证据不足",
          }[testCase.status];
          return <div key={testCase.id} className="flex items-start gap-2 rounded-md border bg-background/70 px-2 py-1.5">
            <CaseIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${testCase.status === "pending" ? "animate-spin text-primary" : testCase.status === "passed" ? "text-emerald-600" : testCase.status === "failed" ? "text-destructive" : "text-amber-600"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="break-words font-medium">{testCase.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{statusLabel}</span>
              </div>
              {testCase.assertion !== testCase.title && <div className="mt-0.5 text-muted-foreground">{testCase.assertion}</div>}
              {testCase.evidenceSummary && <div className="mt-0.5 text-muted-foreground">证据：{testCase.evidenceSummary}</div>}
              {testCase.failureReason && <div className="mt-0.5 text-destructive">原因：{testCase.failureReason}</div>}
            </div>
          </div>;
        })}
      </div>}
      {evidence.length > 0 && <div className="space-y-1.5">
        <button type="button" className="inline-flex items-center text-xs text-primary hover:underline" onClick={() => setEvidenceExpanded((value) => !value)}>
          <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${evidenceExpanded ? "rotate-180" : ""}`} />
          {evidenceExpanded ? "收起运行证据" : `查看运行证据（${evidence.length}）`}
        </button>
        {evidenceExpanded && <div className="space-y-1.5 border-t pt-2">
          {evidence.map((item) => <div key={item.id} className="flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1.5">
            {item.severity === "error"
              ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              : item.severity === "warning"
                ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase text-muted-foreground">{{ network: "Network", console: "Console", page_error: "Page Error" }[item.type]}</div>
              {item.type === "network"
                ? <div className="break-all"><span className="mr-1 font-medium">{item.method || "REQUEST"}</span><span className={item.status === undefined || item.status === 0 || item.status >= 400 ? "text-destructive" : "text-emerald-600"}>{item.status || "FAILED"}</span> {item.url}</div>
                : <div className="break-words">{item.message}</div>}
              {item.message && item.type === "network" && <div className="mt-0.5 text-destructive">{item.message}</div>}
              {item.responsePreview !== undefined && <div className="mt-1.5 rounded border bg-background/80 p-1.5">
                <div className="text-[10px] text-muted-foreground">响应摘要 · 原因：{item.responseBodyReadReason}</div>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(item.responsePreview, null, 2)}</pre>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {item.responseOriginalSize !== undefined && `${item.responseOriginalSize} bytes`}
                  {item.responseTruncated && " · 已裁剪"}
                  {!!item.responseRedactedPaths?.length && ` · 已脱敏 ${item.responseRedactedPaths.length} 个字段`}
                </div>
              </div>}
              {item.caseIds.length > 0 && <div className="mt-0.5 text-[10px] text-muted-foreground">关联用例：{item.caseIds.join(", ")}</div>}
            </div>
          </div>)}
        </div>}
      </div>}
      {run.steps.length > 0 && <button type="button" className="inline-flex items-center text-xs text-primary hover:underline" onClick={() => setExpanded((value) => !value)}>
        <ChevronDown className={`mr-1 h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        {expanded ? "收起执行步骤" : `查看执行步骤（${run.steps.length}）`}
      </button>}
      {expanded && <div className="space-y-1.5 border-t pt-2">
        {run.steps.map((step) => {
          const StepIcon = step.status === "passed" ? CheckCircle2 : step.status === "failed" ? XCircle : step.status === "running" ? Loader2 : Circle;
          return <div key={step.id} className="flex items-start gap-2 rounded-md bg-muted/60 px-2 py-1.5">
            <StepIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${step.status === "running" ? "animate-spin text-primary" : step.status === "passed" ? "text-emerald-600" : step.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} />
            <div className="min-w-0 flex-1">
              <div className="break-words">{step.label}</div>
              {step.error && <div className="mt-0.5 text-destructive">{step.error}</div>}
            </div>
            {step.durationMs !== undefined && <span className="shrink-0 text-[10px] text-muted-foreground">{durationLabel(step.startedAt, step.finishedAt)}</span>}
          </div>;
        })}
      </div>}
      <div className="flex flex-wrap gap-1.5">
        {terminal
          ? <>{run.status === "failed" && <Button size="sm" className="h-7 text-xs" onClick={onFix}>修复问题</Button>}<Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetest}>重新测试</Button></>
          : <div className="inline-flex items-center text-xs text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin" />测试运行中…</div>}
      </div>
    </div>
  );
}
