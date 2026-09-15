import { useRef, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Trash2, MessageSquare, MessageSquareText, Plug, Loader2, AlertCircle, CheckCircle2, Circle, XCircle, ChevronDown, Paperclip, X, Pencil, FlaskConical, Copy } from "lucide-react";
import { t } from "../../shared/i18n.js";
import type { AgentPermissions, ChatMessage, CommentAnnotation, ElementSelection, TestRunInfo } from "../../shared/types.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  agentUrl: string;
  setAgentUrl: (url: string) => void;
  agentToken: string;
  setAgentToken: (token: string) => void;
  connect: (url: string, token: string) => Promise<void>;
  permissions: AgentPermissions;
  updatePermission: (key: keyof AgentPermissions, enabled: boolean) => Promise<void>;
}

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  sendMessage: (text: string, attachments?: ChatMessage["attachments"], comments?: CommentAnnotation[], agentText?: string, contextOrder?: ChatMessage["contextOrder"]) => void;
  startVerification: (verification: NonNullable<ChatMessage["verification"]>) => void;
  fixVerification: (verification: NonNullable<ChatMessage["verification"]>, testRun?: TestRunInfo) => void;
  cancelCurrent: () => void;
  clearHistory: () => void;
  deleteMessage: (index: number) => void;
}

interface ChatPanelProps {
  agent: AgentState;
  chat: ChatState;
  selection: ElementSelection | null;
  comments: CommentAnnotation[];
  onEditComment: (index: number, comment: string) => void;
  onRemoveComment: (index: number) => void;
  onCommentsSent: () => void;
  commentMode: boolean;
  onToggleCommentMode: () => void;
  onRestoreMessage: (message: string, comments: CommentAnnotation[]) => void;
}

function FloatingPopover({ anchor, align = "left", className = "", children }: { anchor: HTMLElement | null; align?: "left" | "right"; className?: string; children: React.ReactNode }) {
  const floatingRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const update = () => {
      const floating = floatingRef.current;
      const boundary = anchor?.closest<HTMLElement>("[data-chat-root]");
      if (!anchor || !floating || !boundary) return;
      const trigger = anchor.getBoundingClientRect();
      const viewport = boundary.getBoundingClientRect();
      const margin = 8; const gap = 6;
      const availableBelow = viewport.bottom - trigger.bottom - margin - gap;
      const availableAbove = trigger.top - viewport.top - margin - gap;
      const wantedHeight = Math.min(floating.scrollHeight, viewport.height - margin * 2);
      const openDown = availableBelow >= Math.min(wantedHeight, 220) || availableBelow >= availableAbove;
      const maxHeight = Math.max(0, openDown ? availableBelow : availableAbove);
      const width = floating.offsetWidth;
      const desiredLeft = align === "right" ? trigger.right - width : trigger.left;
      const screenLeft = Math.max(viewport.left + margin, Math.min(desiredLeft, viewport.right - width - margin));
      const screenTop = openDown ? trigger.bottom + gap : Math.max(viewport.top + margin, trigger.top - Math.min(wantedHeight, maxHeight) - gap);
      setStyle({ position: "absolute", left: screenLeft - viewport.left, top: screenTop - viewport.top, maxHeight, visibility: "visible" });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor, align]);
  const boundary = anchor?.closest<HTMLElement>("[data-chat-root]");
  const overlay = boundary?.querySelector<HTMLElement>("[data-chat-overlay]");
  if (!overlay) return null;
  return createPortal(<div ref={floatingRef} style={style} className={`z-[100] overflow-y-auto overscroll-contain ${className}`}>{children}</div>, overlay);
}

export function ChatPanel({ agent, chat, selection, comments, onEditComment, onRemoveComment, onCommentsSent, commentMode, onToggleCommentMode, onRestoreMessage }: ChatPanelProps) {
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
  return <ChatView agent={agent} chat={chat} selection={selection} comments={comments} onEditComment={onEditComment} onRemoveComment={onRemoveComment} onCommentsSent={onCommentsSent} commentMode={commentMode} onToggleCommentMode={onToggleCommentMode} onRestoreMessage={onRestoreMessage} />;
}

function ConnectionForm({ agent }: { agent: AgentState }) {
  const [url, setUrl] = useState(agent.agentUrl);
  const [token, setToken] = useState(agent.agentToken);
  const connect = () => agent.connect(url.trim(), token.trim());

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
          onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
        />
        <Input
          type="password"
          placeholder={t("agent.tokenPlaceholder")}
          value={token}
          onChange={(e) => { setToken(e.target.value); agent.setAgentToken(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") connect(); }}
        />
        <Button className="w-full" onClick={connect} disabled={!url.trim()}>
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

function commentNodeLabel(comment: CommentAnnotation) {
  const el = comment.element;
  return el.component?.name || el.textContent?.trim().slice(0, 60) || `<${el.tagName}>`;
}

function commentNodeDetails(comment: CommentAnnotation) {
  const el = comment.element;
  const source = el.component?.sourceFile
    ? `${el.component.sourceFile}${el.component.sourceLine ? `:${el.component.sourceLine}` : ""}${el.component.sourceColumn ? `:${el.component.sourceColumn}` : ""}`
    : "";
  return [
    ["节点", `<${el.tagName}> ${el.domPath}`],
    ["组件", el.component?.name || ""],
    ["组件链", el.componentChain || ""],
    ["页面", el.pagePath || ""],
    ["源码", source],
    ["ID", el.id || ""],
    ["Class", el.className || ""],
    ["Role", el.role || ""],
    ["ARIA label", el.ariaLabel || ""],
    ["文本 / DOM", el.textContent || ""],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
}

function formatCommentsForAgent(comments: CommentAnnotation[]) {
  return comments.map(({ element: el, comment }) => {
    const lines = [`Element: <${el.tagName}> ${el.domPath}`];
    if (el.componentChain) lines.push(`Component: ${el.componentChain}`);
    if (el.component?.sourceFile) lines.push(`Source: ${el.component.sourceFile}${el.component.sourceLine ? `:${el.component.sourceLine}` : ""}`);
    if (el.textContent) lines.push(`DOM Structure:\n${el.textContent}`);
    lines.push(`Comment: "${comment}"`);
    return lines.join("\n");
  }).join("\n\n");
}

function CommentTag({ comments, editable = false, align = "left", onEdit, onRemove }: { comments: CommentAnnotation[]; editable?: boolean; align?: "left" | "right"; onEdit?: (index: number, value: string) => void; onRemove?: (index: number) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);
  if (!comments.length) return null;
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      setEditing(null);
      closeTimerRef.current = null;
    }, 350);
  };
  return <div ref={anchorRef}
    className="comment-tag-anchor relative inline-flex max-w-full"
    onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }}
    onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}
  >
    <button type="button" className="inline-flex h-6 max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border bg-background px-2 text-[11px] text-foreground shadow-sm hover:bg-muted" onClick={(event) => { event.stopPropagation(); setOpen((value) => supportsHover() ? true : !value); }} aria-expanded={open}>
      <MessageSquareText className="h-3 w-3 text-muted-foreground" />{comments.length} 条评论
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} align={align} className="comment-popover w-[min(320px,calc(100vw-16px))] overflow-x-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg" ><div onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      {comments.map((item, index) => <div key={`${item.element.domPath}-${index}`} className="group/comment relative border-b px-3 py-2.5 last:border-0">
        <div className="pr-12 text-[10px] text-muted-foreground">{index + 1}.</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">节点信息：</div>
        <div className="mt-1 space-y-1 rounded-md bg-muted/50 p-2">
          <div className="text-xs font-semibold" title={commentNodeLabel(item)}>{commentNodeLabel(item)}</div>
          {commentNodeDetails(item).map(([label, value]) => <div key={label} className="grid grid-cols-[58px_minmax(0,1fr)] gap-1 text-[10px] leading-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="whitespace-pre-wrap break-all font-mono text-foreground">{value}</span>
          </div>)}
        </div>
        <div className="mt-1.5 text-[10px] text-muted-foreground">用户评论：</div>
        {editing === index ? <textarea autoFocus className="mt-0.5 min-h-14 w-full resize-none rounded-md border bg-background p-1.5 text-xs outline-none focus:ring-1 focus:ring-ring" value={item.comment} onChange={(event) => onEdit?.(index, event.target.value)} onBlur={() => setEditing(null)} onKeyDown={(event) => { if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) setEditing(null); }} /> : <div className="whitespace-pre-wrap break-words text-xs">{item.comment}</div>}
        {editable && editing !== index && <div className="absolute right-2 top-2 flex gap-0.5 opacity-70 group-hover/comment:opacity-100">
          <button type="button" className="rounded p-1 hover:bg-muted" title="编辑评论" onClick={() => setEditing(index)}><Pencil className="h-3 w-3" /></button>
          <button type="button" className="rounded p-1 hover:bg-destructive/10 hover:text-destructive" title="删除评论" onClick={() => onRemove?.(index)}><X className="h-3 w-3" /></button>
        </div>}
      </div>)}
    </div></FloatingPopover>}
  </div>;
}

type AttachmentItem = { id: string; name: string; mimeType: string; size: number; uploading?: boolean; error?: string };
function AttachmentTag({ files, editable = false, align = "left", onRemove }: { files: AttachmentItem[]; editable?: boolean; align?: "left" | "right"; onRemove?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  if (!files.length) return null;
  return <div ref={anchorRef} className="relative inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-[11px] text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}><Paperclip className="h-3 w-3 text-muted-foreground" />{files.length} 个附件</button>
    {open && <FloatingPopover anchor={anchorRef.current} align={align} className="w-[min(300px,calc(100vw-16px))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"><div className="space-y-1" onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      {files.map((file) => <div key={file.id} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${file.error ? "bg-destructive/5 text-destructive" : "bg-muted/60"}`}>
        {file.uploading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1"><div className="truncate">{file.name}</div><div className="text-[10px] text-muted-foreground">{file.uploading ? "上传中…" : file.error || `${Math.max(1, Math.round(file.size / 1024))} KB`}</div></div>
        {editable && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="删除附件" onClick={() => onRemove?.(file.id)}><X className="h-3 w-3" /></button>}
      </div>)}
    </div></FloatingPopover>}
  </div>;
}

function TestPromptTag({ verification, onStart, onAlways }: { verification: NonNullable<ChatMessage["verification"]>; onStart: () => void; onAlways: () => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  return <div ref={anchorRef} className="absolute left-0 top-full mt-1 inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 w-max shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-[11px] text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>
      <FlaskConical className="h-3 w-3 text-muted-foreground" />测试
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} className="w-[min(300px,calc(100vw-16px))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"><div onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      <div className="text-xs font-medium">是否开始测试？</div>
      {!!verification.proposedChecks.length && <div className="mt-2">
        <div className="text-[10px] text-muted-foreground">建议测试案例</div>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-foreground">{verification.proposedChecks.map((check) => <li key={check}>{check}</li>)}</ul>
      </div>}
      <div className="mt-3 flex justify-start gap-1.5">
        <Button size="sm" className="h-7 px-3 text-xs" onClick={onStart}>开始</Button>
        <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={onAlways}>始终执行</Button>
      </div>
    </div></FloatingPopover>}
  </div>;
}

function TestResultTag({ verification, run, onRetest }: { verification: NonNullable<ChatMessage["verification"]>; run?: TestRunInfo; onRetest: () => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  const statusTitle = { passed: "测试通过", failed: "测试未通过", inconclusive: "测试结果不确定" }[verification.status || ""] || "测试结果";
  return <div ref={anchorRef} className="relative inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 w-max shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-[11px] text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>
      <FlaskConical className="h-3 w-3 text-muted-foreground" />测试结果
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} className="flex w-[min(320px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"><div className="flex min-h-0 flex-col" onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      <div className="shrink-0 border-b px-3 py-2.5 text-xs font-medium">{statusTitle}</div>
      <div className="min-h-0 overflow-y-auto p-3">
        {verification.summary && <div className="mb-2 text-xs text-muted-foreground">{verification.summary}</div>}
        {verification.status === "failed" && verification.fixSuggestion && <div className="mb-2 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-muted-foreground"><div className="font-medium text-foreground">建议修复</div><div className="mt-0.5">{verification.fixSuggestion}</div></div>}
        {run ? <TestRunDetails run={run} onRetest={onRetest} /> : <><ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">{verification.proposedChecks.map((check) => <li key={check}>{check}</li>)}</ul><div className="mt-3 flex justify-end"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetest}>重新测试</Button></div></>}
      </div>
    </div></FloatingPopover>}
  </div>;
}

function EditPromptTag({ onEdit, onAlways }: { onEdit: () => void; onAlways: () => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  return <div ref={anchorRef} className="relative inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 w-max shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-[11px] text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>
      <Pencil className="h-3 w-3 text-muted-foreground" />修改
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} className="w-[min(280px,calc(100vw-16px))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"><div onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      <div className="text-xs font-medium">是否允许修改代码？</div>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button size="sm" className="h-7 px-3 text-xs" onClick={onEdit}>修改</Button>
        <Button size="sm" variant="outline" className="h-7 px-3 text-xs" onClick={onAlways}>始终允许</Button>
      </div>
    </div></FloatingPopover>}
  </div>;
}

function ChatView({ agent, chat, selection, comments, onEditComment, onRemoveComment, onCommentsSent, commentMode, onToggleCommentMode, onRestoreMessage }: ChatPanelProps) {
  const { messages, sending, sendMessage, startVerification, cancelCurrent, clearHistory, deleteMessage } = chat;
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; mimeType: string; size: number; uploading?: boolean; error?: string }>>([]);
  const [contextOrder, setContextOrder] = useState<Array<"comments" | "attachments">>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, comments.length, attachments.length, contextOrder.length]);
  useEffect(() => {
    setContextOrder((order) => comments.length ? (order.includes("comments") ? order : [...order, "comments"]) : order.filter((item) => item !== "comments"));
  }, [comments.length]);

  const handleSend = () => {
    if (!input.trim() && !attachments.some((item) => !item.uploading && !item.error)) return;
    let message = input;
    if (selection) {
      message += `\n\n--- Context ---\n${formatSelectionContext(selection)}`;
    }
    const readyAttachments = attachments.filter((item) => !item.uploading && !item.error).map(({ id, name, mimeType, size }) => ({ id, name, mimeType, size }));
    const agentMessage = comments.length ? [formatCommentsForAgent(comments), message].filter(Boolean).join("\n\n") : message;
    sendMessage(message, readyAttachments, comments, agentMessage, contextOrder);
    setInput("");
    setAttachments([]);
    setContextOrder([]);
    onCommentsSent();
  };

  const addFiles = async (files: FileList | null) => {
    if (files?.length) setContextOrder((order) => order.includes("attachments") ? order : [...order, "attachments"]);
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

  const editMessage = (msg: ChatMessage) => {
    setInput(msg.content);
    onRestoreMessage(msg.content, msg.comments || []);
  };

  return (
    <div data-chat-root className="relative flex h-full flex-col">
      <div data-chat-viewport className="relative flex-1 min-h-0 overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-x-hidden overflow-y-auto p-3 space-y-3">
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
              <div className={`relative min-w-0 max-w-[85%] space-y-2 px-3 pt-2 pb-0.5 rounded-xl text-xs leading-relaxed ${!msg.pending ? "mb-6" : ""} ${msg.verification && (msg.testRun || ["passed", "failed", "inconclusive"].includes(msg.verification.status || "")) ? "mb-7" : ""} ${msg.role === "user" && (msg.comments?.length || msg.attachments?.length) ? "mt-7" : ""} ${msg.role === "user" ? "bg-blue-100 text-gray-900 rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}>
                {msg.role === "user" && (!!msg.comments?.length || !!msg.attachments?.length) && <div className="absolute bottom-full right-0 mb-1 flex max-w-[calc(100vw-32px)] gap-1">{(msg.contextOrder?.length ? msg.contextOrder : ["comments", "attachments"]).map((kind) => kind === "comments" ? <CommentTag key={kind} comments={msg.comments || []} align="right" /> : <AttachmentTag key={kind} files={msg.attachments || []} align="right" />)}</div>}
                {msg.content.startsWith("⏳") ? (
                  <div className="flex min-w-0 max-w-full items-start gap-1.5 overflow-hidden">
                    <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-muted-foreground">{msg.content.slice(2)}</span>
                  </div>
                ) : (
                  <div className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{["passed", "failed", "inconclusive"].includes(msg.verification?.status || "")
                      ? msg.content.replace(/^\s*测试(?:通过|未通过|结果不确定)[。！!]?\s*/i, "")
                      : msg.content}</Markdown>
                  </div>
                )}
                {msg.verification && !msg.testRun && !["passed", "failed", "inconclusive"].includes(msg.verification.status || "") && (
                  <TestPromptTag verification={msg.verification} onStart={() => startVerification(msg.verification!)} onAlways={async () => { await agent.updatePermission("alwaysAllowAutomatedTesting", true); startVerification(msg.verification!); }} />
                )}
                {msg.verification && (msg.testRun || ["passed", "failed", "inconclusive"].includes(msg.verification.status || "")) && <div className="absolute left-0 top-full mt-1 flex gap-1.5">
                  <TestResultTag verification={msg.verification} run={msg.testRun} onRetest={() => startVerification(msg.verification!)} />
                  {msg.verification.status === "failed" && msg.testRun && <EditPromptTag onEdit={() => chat.fixVerification(msg.verification!, msg.testRun)} onAlways={async () => { await agent.updatePermission("alwaysAllowEdits", true); chat.fixVerification(msg.verification!, msg.testRun); }} />}
                </div>}
                {!msg.pending && <div className="absolute right-0 top-full mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" title="删除" aria-label="删除" onClick={() => deleteMessage(i)}><Trash2 className="h-3 w-3" /></button>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑" aria-label="编辑" onClick={() => { editMessage(msg); deleteMessage(i); }}><Pencil className="h-3 w-3" /></button>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="复制正文" aria-label="复制正文" onClick={() => void navigator.clipboard.writeText(msg.content).catch(() => {})}><Copy className="h-3 w-3" /></button>
                </div>}
              </div>
            </div>
          ))}
          </>
        )}
      </div>
      </div>

      <div className="border-t p-2 space-y-1.5">
        {(comments.length > 0 || attachments.length > 0) && <div className="flex flex-wrap gap-1">{contextOrder.map((kind) => kind === "comments" ? <CommentTag key={kind} comments={comments} editable onEdit={onEditComment} onRemove={onRemoveComment} /> : <AttachmentTag key={kind} files={attachments} editable onRemove={(id) => { const file = attachments.find((item) => item.id === id); setAttachments((items) => { const next = items.filter((item) => item.id !== id); if (!next.length) setContextOrder((order) => order.filter((item) => item !== "attachments")); return next; }); if (file && !file.uploading && !file.error) chrome.runtime.sendMessage({ type: "AGENT_DELETE_ATTACHMENT", payload: { id } }); }} />)}</div>}
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
          <Button size="sm" variant={commentMode ? "default" : "outline"} className="h-7 w-7 p-0" title={commentMode ? "退出评论模式" : "评论元素"} onClick={onToggleCommentMode} disabled={sending}><MessageSquareText className="h-3.5 w-3.5" /></Button>
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
      <div data-chat-overlay className="pointer-events-none absolute inset-0 z-50 [&>*]:pointer-events-auto" />
    </div>
  );
}

const terminalRunStatuses = ["passed", "failed", "inconclusive", "cancelled", "timed_out"];

function durationLabel(startedAt: string, finishedAt?: string) {
  const milliseconds = Math.max(0, Date.parse(finishedAt || new Date().toISOString()) - Date.parse(startedAt));
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function millisecondsLabel(milliseconds: number) {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function TestRunDetails({ run, onRetest }: { run: TestRunInfo; onRetest: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const terminal = terminalRunStatuses.includes(run.status);
  const cases = run.cases || [];
  const evidence = run.evidence || [];
  const metrics = run.performance;

  return (
    <div className="space-y-2">
      {metrics && <div className="rounded-md border bg-background/70 p-2">
        <div className="mb-1.5 font-medium">性能监测</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <span className="text-muted-foreground">端到端耗时</span><span className="text-right">{millisecondsLabel(metrics.totalDurationMs)}</span>
          <span className="text-muted-foreground">Agent 回合</span><span className="text-right">{millisecondsLabel(metrics.agentDurationMs)}</span>
          <span className="text-muted-foreground">工具调用</span><span className="text-right">{millisecondsLabel(metrics.toolDurationMs)} · {metrics.toolCallCount} 次</span>
          <span className="text-muted-foreground">浏览器命令</span><span className="text-right">{millisecondsLabel(metrics.browserDurationMs)} · {metrics.browserCommandCount} 次</span>
          <span className="text-muted-foreground">资源清理</span><span className="text-right">{millisecondsLabel(metrics.cleanupDurationMs)}</span>
        </div>
        {Object.keys(metrics.browserCommands).length > 0 && <div className="mt-2 border-t pt-1.5 text-[10px] text-muted-foreground">
          {Object.entries(metrics.browserCommands).sort(([, a], [, b]) => b.durationMs - a.durationMs).map(([action, metric]) => <div key={action} className="flex justify-between gap-2"><span className="break-all">{action} × {metric.count}</span><span className="shrink-0">累计 {millisecondsLabel(metric.durationMs)} · 最慢 {millisecondsLabel(metric.maxDurationMs)}</span></div>)}
        </div>}
        <div className="mt-1.5 text-[10px] text-muted-foreground">各指标存在包含关系，不应相加。</div>
      </div>}
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
          ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetest}>重新测试</Button>
          : <div className="inline-flex items-center text-xs text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin" />测试运行中…</div>}
      </div>
    </div>
  );
}
