import type {ToolActivity} from './conversation-progress.js';
import {observeChatViewport} from './chat-viewport.js';
import React from 'react';
import { useRef, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { Send, Trash2, MessageSquare, MessageSquareText, Loader2, AlertCircle, CheckCircle2, Circle, XCircle, ChevronDown, Paperclip, X, Pencil, FlaskConical, Copy, Download, RefreshCw } from "lucide-react";
import { t } from "./i18n.js";
import type { ChatMessage, CommentAnnotation, ElementSelection, TestRunInfo } from "./types.js";
import {MessageAvatar} from './message-identity.js';
import {MAX_ATTACHMENTS,MAX_ATTACHMENT_SIZE,MAX_ATTACHMENT_TOTAL,type AttachmentClient,type AttachmentMeta} from "./attachment-client.js";

import {MessageMarkdown} from './MessageMarkdown.js';

async function copyText(text:string){
 if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{/* HTTP previews use the selection fallback. */}}
 const input=document.createElement('textarea');input.value=text;input.style.cssText='position:fixed;opacity:0;pointer-events:none';document.body.appendChild(input);input.select();try{document.execCommand('copy');}finally{input.remove();}
}

export interface ChatState {
  collaborative?:boolean;
  currentUserId?:string;
  mentionTarget?:string;
  onMentionRead?:()=>void;
  uploadAttachment?:AttachmentClient["upload"];
  removeAttachment?:AttachmentClient["remove"];
  downloadAttachment?:AttachmentClient["download"];
  messages: ChatMessage[];
  sending: boolean;
  progress?:string;
  activity?:ToolActivity[];
  activityText?:string;
  blocked?:boolean;
  blockedReason?:string;
  canCancel?:boolean;
  sendMessage: (text: string, attachments?: ChatMessage["attachments"], comments?: CommentAnnotation[], agentText?: string, contextOrder?: ChatMessage["contextOrder"]) => void | Promise<boolean|void>;
  startVerification: (verification: NonNullable<ChatMessage["verification"]>) => void;
  fixVerification: (verification: NonNullable<ChatMessage["verification"]>, testRun?: TestRunInfo) => void;
  cancelCurrent: () => void;
  clearHistory: () => void;
  deleteMessage: (index: number) => void;
}

interface ChatPanelProps {
  readOnly?:boolean;
  unavailable?:{attachments?:string;history?:string};
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
      const openDown = availableBelow >= wantedHeight || availableBelow >= availableAbove;
      const maxHeight = Math.max(0, openDown ? availableBelow : availableAbove);
      const width = floating.offsetWidth;
      const desiredLeft = align === "right" ? trigger.right - width : trigger.left;
      const screenLeft = Math.max(viewport.left + margin, Math.min(desiredLeft, viewport.right - width - margin));
      const screenTop = openDown ? trigger.bottom + gap : Math.max(viewport.top + margin, trigger.top - Math.min(wantedHeight, maxHeight) - gap);
      setStyle({ position: "absolute", left: screenLeft - viewport.left, top: screenTop - viewport.top, maxHeight, visibility: "visible" });
    };
    update();
    const observer = new ResizeObserver(update);
    if (floatingRef.current) observer.observe(floatingRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor, align]);
  const boundary = anchor?.closest<HTMLElement>("[data-chat-root]");
  const overlay = boundary?.querySelector<HTMLElement>("[data-chat-overlay]");
  if (!overlay) return null;
  return createPortal(<div ref={floatingRef} style={style} className={`z-[100] overflow-y-auto overscroll-contain ${className}`}>{children}</div>, overlay);
}

export function ChatPanel({ readOnly,unavailable,chat, selection, comments, onEditComment, onRemoveComment, onCommentsSent, commentMode, onToggleCommentMode, onRestoreMessage }: ChatPanelProps) {
  return <ChatView readOnly={readOnly} unavailable={unavailable} chat={chat} selection={selection} comments={comments} onEditComment={onEditComment} onRemoveComment={onRemoveComment} onCommentsSent={onCommentsSent} commentMode={commentMode} onToggleCommentMode={onToggleCommentMode} onRestoreMessage={onRestoreMessage} />;
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
  const text = el.textContent?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return el.component?.name || text?.slice(0, 60) || `<${el.tagName.toLowerCase()}>`;
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
  const contentRef = useRef<HTMLDivElement>(null);
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
      if (contentRef.current?.contains(document.activeElement)) return;
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
    <button type="button" className="inline-flex h-6 max-w-full items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border bg-background px-2 text-xs text-foreground shadow-sm hover:bg-muted" onClick={(event) => { event.stopPropagation(); setOpen((value) => supportsHover() ? true : !value); }} aria-expanded={open}>
      <MessageSquareText className="h-3 w-3 text-primary" />{comments.length} 条评论
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} align={align} className="comment-popover w-[min(340px,calc(100vw-16px))] overflow-x-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg" ><div ref={contentRef} onFocus={cancelClose} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); }} onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      {comments.map((item, index) => <div key={`${item.element.domPath}-${index}`} className="comment-item grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 border-b px-3 py-3 last:border-0">
        <span className="flex h-6 items-center text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
        <div className="comment-node-title min-w-0 truncate text-xs font-medium leading-6" title={commentNodeLabel(item)}>{commentNodeLabel(item)}</div>
        <div className="flex h-6 items-center gap-0.5">
          {editable && editing !== index && <>
            <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑评论" onClick={() => setEditing(index)}><Pencil className="h-3 w-3" /></button>
            <button type="button" className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="删除评论" onClick={() => onRemove?.(index)}><X className="h-3 w-3" /></button>
          </>}
        </div>
        <div className="comment-body col-span-2 col-start-2 min-w-0 text-xs leading-5 [overflow-wrap:anywhere]">
          {editing === index ? <textarea autoFocus aria-label={`编辑第 ${index + 1} 条评论`} className="block min-h-20 w-full resize-y rounded-md border bg-background p-2 text-xs leading-5 outline-none focus:ring-1 focus:ring-ring" value={item.comment} onChange={(event) => onEdit?.(index, event.target.value)} onBlur={() => setEditing(null)} onKeyDown={(event) => { if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) setEditing(null); }} /> : <p className={`m-0 whitespace-pre-wrap ${item.comment.trim() ? "text-foreground" : "text-muted-foreground"}`}>{item.comment.trim() ? item.comment : "暂无评论内容"}</p>}
        </div>
        <details className="group/node col-span-2 col-start-2 min-w-0 text-xs leading-5">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><ChevronDown className="h-3 w-3 shrink-0 transition-transform group-open/node:rotate-180" />节点信息</summary>
          <dl className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-2 gap-y-1 border-t pt-2">
            {commentNodeDetails(item).map(([label, value]) => <React.Fragment key={label}>
              <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
              <dd className="m-0 min-w-0 whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{value}</dd>
            </React.Fragment>)}
          </dl>
        </details>
      </div>)}
    </div></FloatingPopover>}
  </div>;
}

type AttachmentItem = AttachmentMeta & { serverId?:string;file?:File;progress?:number;uploading?:boolean;error?:string };
function AttachmentTag({ files, editable = false, align = "left", onRemove, onRetry, onDownload }: { files: AttachmentItem[]; editable?: boolean; align?: "left" | "right"; onRemove?: (id: string) => void; onRetry?:(id:string)=>void;onDownload?:AttachmentClient["download"] }) {
  const [open, setOpen] = useState(false);
  const [downloading,setDownloading]=useState<string>(),[downloadErrors,setDownloadErrors]=useState<Record<string,string>>({});
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  if (!files.length) return null;
  const download=async(file:AttachmentItem)=>{
    if(!onDownload||file.uploading||file.error||downloading)return;
    setDownloading(file.id);setDownloadErrors(previous=>({...previous,[file.id]:""}));
    try{await onDownload({...file,id:file.serverId||file.id});}catch(error){setDownloadErrors(previous=>({...previous,[file.id]:(error as Error).message}));}finally{setDownloading(undefined);}
  };
  return <div ref={anchorRef} className="relative inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-xs text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>{files.some(file=>file.uploading)?<Loader2 className="h-3 w-3 animate-spin text-primary" />:<Paperclip className={`h-3 w-3 ${files.some(file=>file.error)?"text-destructive":"text-primary"}`} />}{files.length} 个附件</button>
    {open && <FloatingPopover anchor={anchorRef.current} align={align} className="attachment-popover w-[min(320px,calc(100vw-16px))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"><div className="space-y-1" onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      {files.map((file) => <div key={file.id} className="flex items-start gap-2 rounded-md bg-muted/50 px-2 py-2 text-xs leading-5">
        {file.uploading||downloading===file.id ? <Loader2 className="mt-1 h-3 w-3 shrink-0 animate-spin text-primary" /> : <Paperclip className="mt-1 h-3 w-3 shrink-0 text-primary" />}
        <div className="min-w-0 flex-1">
          <button type="button" className="block max-w-full truncate text-left hover:text-primary disabled:cursor-default" title={file.name} disabled={!onDownload||file.uploading||!!file.error||!!downloading} onClick={()=>void download(file)}>{file.name}</button>
          <div className={file.error||downloadErrors[file.id]?"break-words text-destructive":"text-muted-foreground"}>{file.uploading?`上传中 ${file.progress||0}%`:file.error||downloadErrors[file.id]||`${Math.max(1,Math.round(file.size/1024))} KB`}</div>
          {file.uploading&&<div role="progressbar" aria-label={`上传 ${file.name}`} aria-valuenow={file.progress||0} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-1 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{width:`${file.progress||0}%`}}/></div>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {editable&&file.error&&onRetry&&<button type="button" className="rounded p-1 hover:bg-muted" title={`重试上传 ${file.name}`} onClick={()=>onRetry(file.id)}><RefreshCw className="h-3 w-3"/></button>}
          {!editable&&onDownload&&<button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-50" title={`下载 ${file.name}`} disabled={!!downloading} onClick={()=>void download(file)}><Download className="h-3 w-3"/></button>}
          {editable&&<button type="button" className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title={`删除附件 ${file.name}`} onClick={()=>onRemove?.(file.id)}><X className="h-3 w-3"/></button>}
        </div>
      </div>)}
    </div></FloatingPopover>}
  </div>;
}

function TestPromptTag({ verification, onStart }: { verification: NonNullable<ChatMessage["verification"]>; onStart: () => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  return <div ref={anchorRef} className="relative inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 w-max shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-xs text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>
      <FlaskConical className="h-3 w-3 text-primary" />测试
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} className="w-[min(300px,calc(100vw-16px))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"><div onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      <div className="text-xs font-medium">是否开始测试？</div>
      {!!verification.proposedChecks.length && <div className="mt-2">
        <div className="text-xs text-muted-foreground">建议测试案例</div>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-foreground">{verification.proposedChecks.map((check) => <li key={check}>{check}</li>)}</ul>
      </div>}
      <div className="mt-3 flex justify-start gap-1.5">
        <Button size="sm" className="h-7 px-3 text-xs" onClick={onStart}>开始</Button>
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
    <button type="button" className="inline-flex h-6 w-max shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-xs text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>
      <FlaskConical className="h-3 w-3 text-primary" />测试结果
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

function EditPromptTag({ onEdit }: { onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supportsHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const cancelClose = () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimerRef.current = setTimeout(() => setOpen(false), 350); };
  useEffect(() => () => cancelClose(), []);
  return <div ref={anchorRef} className="relative inline-flex" onMouseEnter={() => { if (supportsHover()) { cancelClose(); setOpen(true); } }} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
    <button type="button" className="inline-flex h-6 w-max shrink-0 items-center gap-1 whitespace-nowrap rounded-full border bg-background px-2 text-xs text-foreground shadow-sm hover:bg-muted" onClick={() => setOpen((value) => supportsHover() ? true : !value)} aria-expanded={open}>
      <Pencil className="h-3 w-3 text-primary" />修改
    </button>
    {open && <FloatingPopover anchor={anchorRef.current} className="w-[min(280px,calc(100vw-16px))] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"><div onMouseEnter={cancelClose} onMouseLeave={() => { if (supportsHover()) scheduleClose(); }}>
      <div className="text-xs font-medium">是否允许修改代码？</div>
      <div className="mt-3 flex justify-end gap-1.5">
        <Button size="sm" className="h-7 px-3 text-xs" onClick={onEdit}>修改</Button>
      </div>
    </div></FloatingPopover>}
  </div>;
}

function ChatView({ readOnly,unavailable,chat, selection, comments, onEditComment, onRemoveComment, onCommentsSent, commentMode, onToggleCommentMode, onRestoreMessage }: ChatPanelProps) {
  const { messages, sending, sendMessage, startVerification, cancelCurrent, clearHistory } = chat;
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [contextOrder, setContextOrder] = useState<Array<"comments" | "attachments">>([]);
  const [scrollbarGutter, setScrollbarGutter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const uploads = useRef(new Map<string,AbortController>());
  const uploadQueue = useRef(Promise.resolve());
  const [attachmentError,setAttachmentError]=useState("");
  useEffect(()=>()=>{for(const controller of uploads.current.values())controller.abort();uploads.current.clear();},[]);
  const followLatest = useRef(true);

  useLayoutEffect(() => {
    if (scrollRef.current) {
      if (followLatest.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setScrollbarGutter(scrollRef.current.offsetWidth - scrollRef.current.clientWidth);
    }
  }, [messages, comments.length, attachments.length, contextOrder.length, chat.progress, chat.activity, chat.activityText]);
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    return observeChatViewport(scrollElement,setScrollbarGutter);
  }, []);
  useEffect(() => {
    setContextOrder((order) => comments.length ? (order.includes("comments") ? order : [...order, "comments"]) : order.filter((item) => item !== "comments"));
  }, [comments.length]);

  const handleSend = async () => {
    if(readOnly||sending||chat.blocked)return;
    if (!input.trim() && !comments.length && !attachments.some((item) => !item.uploading && !item.error)) return;
    let message = input;
    if (selection) {
      message += `\n\n--- Context ---\n${formatSelectionContext(selection)}`;
    }
    const readyAttachments = attachments.filter((item) => !item.uploading && !item.error).map(({ id, serverId, name, mimeType, size }) => ({ id:serverId||id, name, mimeType, size }));
    const agentMessage = comments.length ? [formatCommentsForAgent(comments), message].filter(Boolean).join("\n\n") : message;
    const accepted=await sendMessage(message, readyAttachments, comments, agentMessage, contextOrder);
    if(accepted===false)return;
    setInput(current=>current===input?"":current);
    setAttachments([]);
    setContextOrder([]);
    onCommentsSent();
  };

  const queueUpload=(item:AttachmentItem)=>{
    if(!item.file||!chat.uploadAttachment)return;
    const controller=new AbortController();uploads.current.set(item.id,controller);
    setAttachments(previous=>previous.map(file=>file.id===item.id?{...file,error:undefined,uploading:true,progress:0}:file));
    uploadQueue.current=uploadQueue.current.then(async()=>{
      if(controller.signal.aborted)return;
      try{
        const meta=await chat.uploadAttachment!(item.file!,controller.signal,progress=>setAttachments(previous=>previous.map(file=>file.id===item.id?{...file,progress}:file)));
        if(controller.signal.aborted||!uploads.current.has(item.id)){void chat.removeAttachment?.(meta.id).catch(()=>{});return;}
        setAttachments(previous=>previous.map(file=>file.id===item.id?{...file,name:meta.name,mimeType:meta.mimeType,size:meta.size,serverId:meta.id,uploading:false,progress:100}:file));
      }catch(error){if(!controller.signal.aborted)setAttachments(previous=>previous.map(file=>file.id===item.id?{...file,uploading:false,error:(error as Error).message}:file));}
      finally{uploads.current.delete(item.id);}
    });
  };
  const removeAttachment=(id:string)=>{
    const item=attachments.find(file=>file.id===id);uploads.current.get(id)?.abort();uploads.current.delete(id);
    if(item?.serverId)void chat.removeAttachment?.(item.serverId).catch(error=>console.warn('[Prism Studio] Draft attachment cleanup failed',error));
    setAttachments(previous=>{const next=previous.filter(file=>file.id!==id);if(!next.length)setContextOrder(order=>order.filter(kind=>kind!=="attachments"));return next;});
  };
  const addFiles = (files: FileList | null) => {
    if(readOnly||sending||!chat.uploadAttachment)return;
    let count=attachments.length,total=attachments.reduce((sum,file)=>sum+file.size,0);const accepted:AttachmentItem[]=[];setAttachmentError("");
    for(const file of Array.from(files||[])){
      if(count>=MAX_ATTACHMENTS){setAttachmentError(`每条消息最多添加 ${MAX_ATTACHMENTS} 个附件`);break;}
      if(!file.size||file.size>MAX_ATTACHMENT_SIZE){setAttachmentError(`${file.name}：单个附件需大于 0 且不超过 5 MB`);continue;}
      if(total+file.size>MAX_ATTACHMENT_TOTAL){setAttachmentError("每条消息的附件总计不能超过 20 MB");continue;}
      const item={id:crypto.randomUUID(),name:file.name,mimeType:file.type,size:file.size,file,uploading:true,progress:0};accepted.push(item);count++;total+=file.size;
    }
    if(accepted.length){setAttachments(previous=>[...previous,...accepted]);setContextOrder(order=>order.includes("attachments")?order:[...order,"attachments"]);accepted.forEach(queueUpload);}
    if(fileInputRef.current)fileInputRef.current.value="";
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
      <div
        ref={scrollRef}
        onScroll={(event) => { const el=event.currentTarget; followLatest.current=el.scrollHeight-el.clientHeight-el.scrollTop<48; }}
        className="h-full overflow-x-hidden overflow-y-auto p-3 space-y-3"
        style={{ paddingRight: `calc(0.75rem - ${scrollbarGutter}px)` }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
            <MessageSquare className="h-8 w-8 text-primary" />
            <p className="text-center leading-relaxed">{t("chat.empty").split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}</p>
          </div>
        ) : (
          <>
          {(!chat.collaborative && sending && !messages.some(msg => msg.role !== "user" && msg.pending)
            ? [...messages, { role: "ai" as const, content: "", pending: true, timestamp: 0 }]
            : messages).map((message, i) => {
            const msg = message.role !== "user" && message.pending
              ? { ...message, content: `⏳ ${chat.progress || t("chat.processing")}` }
              : message;
            const own=msg.role==="user"&&(!chat.collaborative||msg.userId===chat.currentUserId);
            const hasContent = Boolean(msg.content.trim());
            const hasContext = msg.role === "user" && Boolean(msg.comments?.length || msg.attachments?.length);
            return (
            <div key={message.id ?? i} data-message-id={message.id} className={`group flex gap-2 ${own ? "justify-end" : "justify-start"}`}>
              {chat.collaborative&&!own&&<MessageAvatar name={msg.authorName||'Agent'} agent={msg.role!=="user"}/>}
              <div className="min-w-0 max-w-[85%] flex-1" style={{flex: '0 1 auto'}}>
              {chat.collaborative&&<div className={`mb-1 flex items-center gap-2 text-[10px] text-muted-foreground ${own?'justify-end':''}`}><span>{msg.authorName||'Agent'}</span>{msg.timestamp>0&&<time>{new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time>}</div>}
              <div className={`relative min-w-0 text-sm font-normal leading-relaxed ${hasContent && msg.role === "user" ? "px-3 py-2 rounded-xl" : ""} ${!msg.pending ? "mb-6" : ""} ${msg.verification && (msg.testRun || ["passed", "failed", "inconclusive"].includes(msg.verification.status || "")) ? "mb-7" : ""} ${hasContent && hasContext ? "mt-7" : ""} ${hasContent && msg.role === "user" ? "bg-[#dbeafe] text-[#2563eb] rounded-br-sm" : hasContent ? "text-foreground" : ""}`}>
                {msg.pending&&msg.taskTitle&&<div className="mb-1 text-xs font-medium text-foreground [overflow-wrap:anywhere]">{msg.taskTitle}</div>}
                {hasContext && <div className={`${hasContent ? (own?"absolute bottom-full right-0 mb-1":"absolute bottom-full left-0 mb-1") : ""} flex max-w-[calc(100vw-32px)] gap-1`}>{(msg.contextOrder?.length ? msg.contextOrder : ["comments", "attachments"]).map((kind) => kind === "comments" ? <CommentTag key={kind} comments={msg.comments || []} align={own?"right":"left"} /> : <AttachmentTag key={kind} files={msg.attachments || []} align={own?"right":"left"} onDownload={chat.downloadAttachment} />)}</div>}
                {hasContent && (msg.content.startsWith("⏳") ? (
                  <div className="flex min-w-0 max-w-full items-start gap-1.5 overflow-hidden">
                    <span className="flex h-[1.625em] shrink-0 items-center" aria-hidden="true">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-muted-foreground">{msg.content.slice(2)}</span>
                    {!readOnly&&msg.pending&&(msg.canCancel??chat.canCancel)!==false&&<button type="button" className="shrink-0 rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={cancelCurrent}>取消运行</button>}
                  </div>
                ) : (
                  <div className="chat-markdown">
                    <MessageMarkdown mentions={JSON.stringify(msg.mentions||[])} currentUserId={chat.currentUserId} content={["passed", "failed", "inconclusive"].includes(msg.verification?.status || "")
                      ? msg.content.replace(/^\s*测试(?:通过|未通过|结果不确定)[。！!]?\s*/i, "")
                      : msg.content} />
                  </div>
                ))}
                {msg.role !== "user" && !msg.pending && <div className="absolute left-0 top-full mt-1 flex items-center gap-1.5">
                  {msg.verification && !msg.testRun && !["passed", "failed", "inconclusive"].includes(msg.verification.status || "") && <TestPromptTag verification={msg.verification} onStart={() => startVerification(msg.verification!)} />}
                  {msg.verification && (msg.testRun || ["passed", "failed", "inconclusive"].includes(msg.verification.status || "")) && <TestResultTag verification={msg.verification} run={msg.testRun} onRetest={() => startVerification(msg.verification!)} />}
                  {msg.verification?.status === "failed" && msg.testRun && <EditPromptTag onEdit={() => chat.fixVerification(msg.verification!, msg.testRun)} />}
                  <button type="button" className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100" title="复制正文" aria-label="复制正文" onClick={() => void copyText(msg.content).catch(() => {})}><Copy className="h-3 w-3" /></button>
                </div>}
                {msg.role === "user" && !msg.pending && <div className="absolute right-0 top-full mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="复制正文" aria-label="复制正文" onClick={() => void copyText(msg.content).catch(() => {})}><Copy className="h-3 w-3" /></button>
                  {own&&<button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="编辑" aria-label="编辑" onClick={() => editMessage(msg)}><Pencil className="h-3 w-3" /></button>}
                </div>}
              </div>
              </div>
              {chat.collaborative&&own&&<MessageAvatar name={msg.authorName||'我'}/>}
            </div>
          );})}
          </>
        )}

      </div>
      </div>

      <div className="p-2 space-y-1.5">
        {chat.mentionTarget&&<button type="button" className="w-full rounded border bg-amber-50 px-2 py-1.5 text-left text-xs text-amber-900" onClick={()=>{const target=Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-message-id]')||[]).find(el=>el.dataset.messageId===chat.mentionTarget);if(target){followLatest.current=false;target.scrollIntoView({block:'center'});chat.onMentionRead?.();}}}>有人 @ 了你 · 查看消息</button>}
        {attachmentError&&<p role="alert" className="text-xs text-destructive">{attachmentError}</p>}
        {chat.blockedReason && !sending && <p role="status" className="text-xs leading-relaxed text-muted-foreground">{chat.blockedReason}</p>}
        {(comments.length > 0 || attachments.length > 0) && <div className="flex flex-wrap gap-1">{contextOrder.map((kind) => kind === "comments" ? <CommentTag key={kind} comments={comments} editable onEdit={onEditComment} onRemove={onRemoveComment} /> : <AttachmentTag key={kind} files={attachments} editable onRemove={removeAttachment} onRetry={id=>{const item=attachments.find(file=>file.id===id);if(item)queueUpload(item);}} onDownload={chat.downloadAttachment} />)}</div>}
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(event.target.files)} />
        <textarea
          className="w-full min-h-[60px] max-h-[120px] px-2.5 py-2 text-xs border rounded-md resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("chat.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={readOnly}
          rows={3}
        />
        <div className="flex justify-end gap-1">
          <Button size="sm" variant={commentMode ? "default" : "outline"} className="h-7 w-7 p-0" title={commentMode ? "退出评论模式" : "评论元素"} onClick={onToggleCommentMode} disabled={sending||readOnly}><MessageSquareText className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" title="添加附件" onClick={() => fileInputRef.current?.click()} disabled={sending || readOnly || !chat.uploadAttachment || attachments.length >= MAX_ATTACHMENTS}><Paperclip className="h-3.5 w-3.5" /></Button>
          {messages.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1" onClick={clearHistory} disabled={readOnly||!!unavailable?.history} title={unavailable?.history}>
              <Trash2 className="h-3 w-3" />
              {t("chat.clearHistory")}
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs px-3 gap-1" onClick={handleSend} title={chat.blockedReason} disabled={sending || chat.blocked || readOnly || attachments.some((item) => item.uploading || item.error) || (!input.trim() && !comments.length && !attachments.some((item) => !item.error))}>
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
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">端到端耗时</span><span className="text-right">{millisecondsLabel(metrics.totalDurationMs)}</span>
          <span className="text-muted-foreground">Agent 回合</span><span className="text-right">{millisecondsLabel(metrics.agentDurationMs)}</span>
          <span className="text-muted-foreground">工具调用</span><span className="text-right">{millisecondsLabel(metrics.toolDurationMs)} · {metrics.toolCallCount} 次</span>
          <span className="text-muted-foreground">浏览器命令</span><span className="text-right">{millisecondsLabel(metrics.browserDurationMs)} · {metrics.browserCommandCount} 次</span>
          <span className="text-muted-foreground">资源清理</span><span className="text-right">{millisecondsLabel(metrics.cleanupDurationMs)}</span>
        </div>
        {Object.keys(metrics.browserCommands).length > 0 && <div className="mt-2 border-t pt-1.5 text-xs text-muted-foreground">
          {Object.entries(metrics.browserCommands).sort(([, a], [, b]) => b.durationMs - a.durationMs).map(([action, metric]) => <div key={action} className="flex justify-between gap-2"><span className="break-all">{action} × {metric.count}</span><span className="shrink-0">累计 {millisecondsLabel(metric.durationMs)} · 最慢 {millisecondsLabel(metric.maxDurationMs)}</span></div>)}
        </div>}
        <div className="mt-1.5 text-xs text-muted-foreground">各指标存在包含关系，不应相加。</div>
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
                <span className="shrink-0 text-xs text-muted-foreground">{statusLabel}</span>
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
          <ChevronDown className={`mr-1 h-3.5 w-3.5 text-primary transition-transform ${evidenceExpanded ? "rotate-180" : ""}`} />
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
              <div className="text-xs uppercase text-muted-foreground">{{ network: "Network", console: "Console", page_error: "Page Error" }[item.type]}</div>
              {item.type === "network"
                ? <div className="break-all"><span className="mr-1 font-medium">{item.method || "REQUEST"}</span><span className={item.status === undefined || item.status === 0 || item.status >= 400 ? "text-destructive" : "text-emerald-600"}>{item.status || "FAILED"}</span> {item.url}</div>
                : <div className="break-words">{item.message}</div>}
              {item.message && item.type === "network" && <div className="mt-0.5 text-destructive">{item.message}</div>}
              {item.responsePreview !== undefined && <div className="mt-1.5 rounded border bg-background/80 p-1.5">
                <div className="text-xs text-muted-foreground">响应摘要 · 原因：{item.responseBodyReadReason}</div>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(item.responsePreview, null, 2)}</pre>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.responseOriginalSize !== undefined && `${item.responseOriginalSize} bytes`}
                  {item.responseTruncated && " · 已裁剪"}
                  {!!item.responseRedactedPaths?.length && ` · 已脱敏 ${item.responseRedactedPaths.length} 个字段`}
                </div>
              </div>}
              {item.caseIds.length > 0 && <div className="mt-0.5 text-xs text-muted-foreground">关联用例：{item.caseIds.join(", ")}</div>}
            </div>
          </div>)}
        </div>}
      </div>}
      {run.steps.length > 0 && <button type="button" className="inline-flex items-center text-xs text-primary hover:underline" onClick={() => setExpanded((value) => !value)}>
        <ChevronDown className={`mr-1 h-3.5 w-3.5 text-primary transition-transform ${expanded ? "rotate-180" : ""}`} />
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
            {step.durationMs !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{durationLabel(step.startedAt, step.finishedAt)}</span>}
          </div>;
        })}
      </div>}
      <div className="flex flex-wrap gap-1.5">
        {terminal
          ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRetest}>重新测试</Button>
          : <div className="inline-flex items-center text-xs text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin text-primary" />测试运行中…</div>}
      </div>
    </div>
  );
}
