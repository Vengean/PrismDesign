import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { Bell, Check, Copy, Minus, Plus, RotateCcw, Send } from "lucide-react";
import { Badge, Button, Dialog, DialogContent, DialogTitle, DialogTrigger, Input, MessageComposer, Separator, SidePanelHeader as UISidePanelHeader } from "@prism-studio-ai/ui";
import { App as ChromeExtensionApp } from "../../packages/chrome-ext/src/sidepanel/App";
import { ChatPanel as ChromeChatPanel } from "../../packages/chrome-ext/src/sidepanel/components/ChatPanel";
import { SidePanelHeader } from "../../packages/chrome-ext/src/sidepanel/components/SidePanelHeader";
import type { ChatMessage, CommentAnnotation, ElementSelection, TestRunInfo } from "../../packages/chrome-ext/src/shared/types";
import "./styles.css";

const DEFAULT_THEME = {
  grey100: "#f7f8fa", grey200: "#f0f1f3", grey300: "#e5e6eb", grey400: "#c9cdd4",
  grey500: "#86909c", grey600: "#667085", grey700: "#4e5969", grey800: "#252525",
  destructive: "#d93d54", radius: 8, fontSize: 14,
};
type Theme = typeof DEFAULT_THEME;

const THEME_TOKEN_GROUPS: Array<{ key: keyof Theme; level: string; label: string; tokens: string[] }> = [
  { key: "grey100", level: "100", label: "基础背景", tokens: ["background", "bg"] },
  { key: "grey200", level: "200", label: "次级背景", tokens: ["muted", "secondary", "bg2"] },
  { key: "grey300", level: "300", label: "边框与输入框", tokens: ["border", "input", "bg3"] },
  { key: "grey400", level: "400", label: "分割线与 Idle", tokens: ["divider", "idle"] },
  { key: "grey500", level: "500", label: "图标与装饰", tokens: ["hue-grey", "tx-deco"] },
  { key: "grey600", level: "600", label: "辅助文字", tokens: ["tx3", "txm", "muted-foreground"] },
  { key: "grey700", level: "700", label: "次级文字", tokens: ["tx2", "hue-grey-text"] },
  { key: "grey800", level: "800", label: "正文与主色", tokens: ["foreground", "primary", "tx"] },
];

type MessageListener = (message: unknown, sender: Record<string, never>) => void;
const messageListeners = new Set<MessageListener>();
const storage = new Map<string, unknown>();

// The studio renders the real extension UI. This adapter only replaces APIs
// that normally come from Chrome; no visual component is duplicated here.
const chromeMock = {
  runtime: {
    connect: () => ({ onDisconnect: { addListener: () => {} }, disconnect: () => {} }),
    onMessage: {
      addListener: (listener: MessageListener) => {
        messageListeners.add(listener);
        window.setTimeout(() => listener({ type: "AGENT_STATUS", payload: { connected: true, connecting: false, agentUrl: "http://127.0.0.1:19527" } }, {}), 0);
      },
      removeListener: (listener: MessageListener) => messageListeners.delete(listener),
    },
    sendMessage: async (message: { type?: string; payload?: { name?: string; mimeType?: string; data?: number[] } }) => {
      if (message.type === "AGENT_GET_RUNTIME_STATE") return {};
      if (message.type === "AGENT_CONNECT") {
        window.setTimeout(() => messageListeners.forEach((listener) => listener({ type: "AGENT_STATUS", payload: { connected: true, connecting: false, agentUrl: "http://127.0.0.1:19527" } }, {})), 120);
        return { success: true };
      }
      if (message.type === "AGENT_DISCONNECT") {
        messageListeners.forEach((listener) => listener({ type: "AGENT_STATUS", payload: { connected: false, connecting: false } }, {}));
        return { success: true };
      }
      if (message.type === "AGENT_UPLOAD_ATTACHMENT") return { id: "studio-pending-file", name: message.payload?.name || "design-notes.md", mimeType: message.payload?.mimeType || "text/markdown", size: message.payload?.data?.length || 1024 };
      return { success: true };
    },
  },
  storage: { local: {
    get: (keys: string | string[], callback?: (result: Record<string, unknown>) => void) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const result = Object.fromEntries(list.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)]));
      callback?.(result);
      return Promise.resolve(result);
    },
    set: async (values: Record<string, unknown>) => { Object.entries(values).forEach(([key, value]) => storage.set(key, value)); },
  } },
};
const studioGlobal = globalThis as unknown as { chrome?: Record<string, unknown> };
studioGlobal.chrome = {
  ...(studioGlobal.chrome || {}),
  runtime: chromeMock.runtime,
  storage: chromeMock.storage,
};

function ChatPanel({ initialInput, ...props }: ComponentProps<typeof ChromeChatPanel> & { initialInput?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialInput) return;
    const input = rootRef.current?.querySelector<HTMLTextAreaElement>("textarea");
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, initialInput);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [initialInput]);
  useEffect(() => {
    if (!initialInput || typeof DataTransfer === "undefined") return;
    const input = rootRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# 设计补充\n请保持导航间距一致。"], "design-notes.md", { type: "text/markdown" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, [initialInput]);
  return <div ref={rootRef} className="h-full"><ChromeChatPanel {...props} /></div>;
}

function ConnectionForm({ agent }: { agent: ComponentProps<typeof ChromeChatPanel>["agent"] }) {
  const chat = { messages: [], sending: false, sendMessage: () => {}, startVerification: () => {}, fixVerification: () => {}, cancelCurrent: () => {}, clearHistory: () => {}, deleteMessage: () => {} };
  return <ChromeChatPanel agent={agent} chat={chat} selection={null} comments={[]} onEditComment={() => {}} onRemoveComment={() => {}} onCommentsSent={() => {}} commentMode={false} onToggleCommentMode={() => {}} onRestoreMessage={() => {}} />;
}

function ThemeDesigner({ theme, onChange }: { theme: Theme; onChange: (value: Theme) => void }) {
  const [copied, setCopied] = useState(false);
  const set = <K extends keyof Theme>(key: K, value: Theme[K]) => onChange({ ...theme, [key]: value });
  const copyTheme = async () => {
    const greys = THEME_TOKEN_GROUPS.map(({ key, level, tokens }) => `  --grey-${level}: ${theme[key]};\n${tokens.map((token) => `  --${token}: var(--grey-${level});`).join("\n")}`).join("\n");
    const configuration = `请将以下主题配置应用到 Prism Studio 的共享 UI 源码（packages/ui/src/tokens.css），并同步检查 Chrome 插件效果：\n\n\`\`\`css\n:root {\n${greys}\n  --destructive: ${theme.destructive};\n  --radius: ${theme.radius}px;\n  --font-size-base: ${theme.fontSize}px;\n}\n\`\`\``;
    await navigator.clipboard.writeText(configuration);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return <aside className="studio-theme-panel">
    <div className="studio-theme-title"><div><span>APPEARANCE</span><h1>主题设计器</h1></div><button onClick={() => onChange(DEFAULT_THEME)} title="恢复默认"><RotateCcw size={15} /></button></div>
    <p>调整预览后复制主题配置，发送给 Agent 修改共享 UI 源码。</p>
    <div className="studio-color-grid">{THEME_TOKEN_GROUPS.map(({ key, level, label, tokens }) => <label key={key} title={tokens.map((token) => `--${token}`).join(" / ")}><small><b>{level}</b>{label}</small><div><input aria-label={`${level} ${label}`} type="color" value={theme[key] as string} onChange={(e) => set(key, e.target.value)} /><input aria-label={`${level} 色值`} value={theme[key] as string} onChange={(e) => set(key, e.target.value)} /></div></label>)}</div>
    <label className="studio-color-single"><small>危险色</small><div><input aria-label="危险色" type="color" value={theme.destructive} onChange={(e) => set("destructive", e.target.value)} /><input value={theme.destructive} onChange={(e) => set("destructive", e.target.value)} /></div></label>
    <label className="studio-range-row">圆角 <output>{theme.radius}px</output><input type="range" min="0" max="20" value={theme.radius} onChange={(e) => set("radius", Number(e.target.value))} /></label>
    <label className="studio-range-row">基础字号 <output>{theme.fontSize}px</output><input type="range" min="12" max="24" step="2" value={theme.fontSize} onChange={(e) => set("fontSize", Number(e.target.value))} /></label>
    <Button className="studio-apply-button" size="sm" onClick={() => void copyTheme()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "已复制主题配置" : "复制主题配置"}</Button>
  </aside>;
}

const mockElement = (name: string, path: string): ElementSelection => ({
  pagePath: "/workspace", domPath: path, tagName: "button", id: "", textContent: name,
  className: "primary-action", role: "button", ariaLabel: name,
  component: { name, props: {}, sourceFile: `src/components/${name}.tsx`, sourceLine: 24 },
  componentChain: `App > Workspace > ${name}`, componentChainDetail: [], styles: {},
  rect: { top: 120, left: 80, width: 120, height: 36 }, isTextElement: true, isFlexContainer: false,
});
const sentComments: CommentAnnotation[] = [
  { element: mockElement("PrimaryButton", "#root > main > button.primary"), comment: "按钮圆角统一为 8px。" },
  { element: mockElement("TaskCard", "#root > main > section.task-card"), comment: "卡片层级需要更明显。" },
];
const pendingComments: CommentAnnotation[] = [
  { element: mockElement("SearchInput", "#root > header > input.search"), comment: "输入框高度调整为 36px。" },
  { element: mockElement("FilterButton", "#root > header > button.filter"), comment: "筛选按钮使用品牌色。" },
];
const testRun: TestRunInfo = {
  id: "run-01", verificationId: "verify-result", agentRunId: "agent-01", status: "passed",
  startedAt: "2026-09-14T08:00:00.000Z", updatedAt: "2026-09-14T08:00:12.480Z", finishedAt: "2026-09-14T08:00:12.480Z",
  cases: [
    { id: "case-1", title: "按钮视觉状态", assertion: "默认、悬停与聚焦状态符合设计", status: "passed", evidenceSummary: "按钮样式和焦点环均正确", evidenceIds: ["ev-1"], updatedAt: "2026-09-14T08:00:08.000Z" },
    { id: "case-2", title: "卡片布局响应", assertion: "不同宽度下卡片无溢出", status: "passed", evidenceSummary: "380px 侧栏下布局稳定", evidenceIds: ["ev-2"], updatedAt: "2026-09-14T08:00:10.000Z" },
  ],
  evidence: [
    { id: "ev-1", type: "network", severity: "info", method: "GET", url: "http://localhost:5173/workspace", status: 200, observedAt: "2026-09-14T08:00:04.000Z", responsePreview: { status: "ok" }, responseBodyReadReason: "测试断言需要", responseOriginalSize: 24, caseIds: ["case-1"] },
    { id: "ev-2", type: "console", severity: "info", message: "Layout verification completed without overflow", observedAt: "2026-09-14T08:00:10.000Z", caseIds: ["case-2"] },
  ],
  steps: [
    { id: "step-1", tool: "browser.open", label: "打开工作区页面", status: "passed", startedAt: "2026-09-14T08:00:00.000Z", finishedAt: "2026-09-14T08:00:02.100Z", durationMs: 2100 },
    { id: "step-2", tool: "browser.click", label: "检查按钮交互状态", status: "passed", startedAt: "2026-09-14T08:00:02.100Z", finishedAt: "2026-09-14T08:00:07.340Z", durationMs: 5240 },
    { id: "step-3", tool: "browser.resize", label: "验证侧栏响应布局", status: "passed", startedAt: "2026-09-14T08:00:07.340Z", finishedAt: "2026-09-14T08:00:11.900Z", durationMs: 4560 },
  ], cleanup: [{ id: "cleanup-1", label: "关闭测试页面", success: true }],
  performance: { totalDurationMs: 12480, agentDurationMs: 11900, toolDurationMs: 9600, browserDurationMs: 8420, cleanupDurationMs: 580, toolCallCount: 6, browserCommandCount: 4, browserCommands: { click: { count: 2, durationMs: 3180, maxDurationMs: 1820 }, screenshot: { count: 2, durationMs: 5240, maxDurationMs: 2840 } } },
};
const mockMessages: ChatMessage[] = [
  { role: "user", content: "请按这两条评论优化当前页面。", timestamp: 1, comments: sentComments },
  { role: "ai", content: "### 页面调整已完成\n\n已完成以下优化：\n\n- 将按钮圆角统一为 `8px`\n- 增强卡片的 **边框与阴影层级**\n- 保留键盘 `focus-visible` 状态\n\n> 建议继续执行自动测试，确认响应式布局没有回归。", timestamp: 2, verification: { id: "verify-prompt", goal: "验证页面调整", proposedChecks: ["检查按钮默认、悬停和聚焦状态", "检查卡片在侧栏宽度下的布局"] } },
  { role: "user", content: "附件里是补充的交互说明，请一起参考。", timestamp: 3, attachments: [{ id: "file-1", name: "interaction-spec.md", mimeType: "text/markdown", size: 4820 }] },
  { role: "ai", content: "## 自动测试完成\n\n| 检查项 | 结果 |\n| --- | --- |\n| 按钮交互 | ✅ 通过 |\n| 响应式布局 | ✅ 通过 |\n\n所有关键路径均符合预期。", timestamp: 4, verification: { id: "verify-result", goal: "验证页面调整", proposedChecks: ["按钮交互", "响应式布局"], status: "passed", summary: "2/2 个业务测试用例通过。" }, testRun },
  { role: "ai", content: "### 发现一处实现偏差\n\n`Header` 当前使用 `gap: 12px`，设计稿要求为 **8px**。\n\n需要获得你的允许后才能修改源码。", timestamp: 5, verification: { id: "verify-edit", goal: "修复标题间距", proposedChecks: ["标题间距"], status: "failed", summary: "标题间距与设计稿不一致。", fixSuggestion: "将 Header 的 gap 从 12px 修改为 8px。" }, testRun: { ...testRun, id: "run-02", verificationId: "verify-edit", status: "failed" } },
];

function MockConversationPanel() {
  const [comments, setComments] = useState(pendingComments);
  const [menuOpen, setMenuOpen] = useState(false);
  const agent = { connected: true, connecting: false, error: null, agentUrl: "http://127.0.0.1:19527", agentToken: "", setAgentUrl: () => {}, setAgentToken: () => {}, connect: async () => {}, permissions: { alwaysAllowEdits: false, alwaysAllowAutomatedTesting: false }, updatePermission: async () => {} };
  const chat = { messages: mockMessages, sending: false, sendMessage: () => {}, startVerification: () => {}, fixVerification: () => {}, cancelCurrent: () => {}, clearHistory: () => {}, deleteMessage: () => {} };
  return <div className="flex h-screen flex-col"><SidePanelHeader className="relative"><span className="font-semibold text-xs">对话</span><button type="button" className="ml-auto flex h-6 w-6 items-center justify-center rounded hover:bg-muted" onClick={() => setMenuOpen((open) => !open)}><span className="h-2 w-2 rounded-full bg-primary" /></button>{menuOpen && <div className="absolute right-2 top-8 z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"><div className="truncate px-2 py-1.5 text-xs text-muted-foreground">http://127.0.0.1:19527</div><div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">权限</div><label className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-xs hover:bg-muted"><span>始终允许编辑</span><input type="checkbox" className="h-3.5 w-3.5 accent-primary" /></label><label className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-xs hover:bg-muted"><span>始终允许自动测试</span><input type="checkbox" className="h-3.5 w-3.5 accent-primary" /></label><div className="my-1 border-t" /><button className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted">断开连接</button></div>}</SidePanelHeader><div className="min-h-0 flex-1"><ChatPanel agent={agent} chat={chat} selection={null} comments={comments} onEditComment={(i, comment) => setComments((items) => items.map((item, index) => index === i ? { ...item, comment } : item))} onRemoveComment={(i) => setComments((items) => items.filter((_, index) => index !== i))} onCommentsSent={() => setComments([])} commentMode={false} onToggleCommentMode={() => {}} onRestoreMessage={() => {}} initialInput="请继续调整顶部导航，并保留现有的响应式行为。" /></div></div>;
}

function ProcessStatePanel() {
  const agent = { connected: true, connecting: false, error: null, agentUrl: "http://127.0.0.1:19527", agentToken: "", setAgentUrl: () => {}, setAgentToken: () => {}, connect: async () => {}, permissions: { alwaysAllowEdits: false, alwaysAllowAutomatedTesting: false }, updatePermission: async () => {} };
  const messages: ChatMessage[] = [
    { role: "user", content: "请优化任务卡片并完成自动测试。", timestamp: 1 },
    { role: "ai", content: "⏳ Agent 正在处理…", timestamp: 2, pending: true },
  ];
  const chat = { messages, sending: true, sendMessage: () => {}, startVerification: () => {}, fixVerification: () => {}, cancelCurrent: () => {}, clearHistory: () => {}, deleteMessage: () => {} };
  return <div className="flex h-screen flex-col"><SidePanelHeader><span className="font-semibold text-xs">对话</span><span className="ml-auto flex h-6 w-6 items-center justify-center"><span className="h-2 w-2 rounded-full bg-primary" /></span></SidePanelHeader><div className="min-h-0 flex-1"><ChatPanel agent={agent} chat={chat} selection={null} comments={[]} onEditComment={() => {}} onRemoveComment={() => {}} onCommentsSent={() => {}} commentMode={false} onToggleCommentMode={() => {}} onRestoreMessage={() => {}} /></div></div>;
}

function ComponentGallery() {
  return <div className="component-gallery">
    <UISidePanelHeader title="组件总览" leading={<Bell size={14} />} trailing={<Badge variant="secondary">UI</Badge>} />
    <div className="component-gallery-body">
      <section><h2>Button</h2><div className="component-row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="outline">Outline</Button><Button variant="ghost">Ghost</Button><Button variant="destructive">Danger</Button><Button disabled>Disabled</Button><Button size="icon" aria-label="通知"><Bell /></Button></div></section>
      <Separator />
      <section><h2>Input</h2><div className="component-stack"><Input placeholder="请输入内容" /><Input value="已填写的内容" readOnly /><Input placeholder="不可用" disabled /></div></section>
      <Separator />
      <section><h2>Badge</h2><div className="component-row"><Badge>Default</Badge><Badge variant="secondary">Secondary</Badge><Badge variant="outline">Outline</Badge><Badge variant="destructive">Danger</Badge></div></section>
      <Separator />
      <section><h2>Message Composer</h2><MessageComposer placeholder="输入消息…" beforeInput={<Badge variant="outline">上下文附件</Badge>} actions={<><Button size="sm" variant="outline" className="w-20">取消</Button><Button size="sm" className="w-20"><Send />发送</Button></>} /></section>
      <Separator />
      <section><h2>Dialog</h2><Dialog><DialogTrigger asChild><Button variant="outline">打开 Dialog</Button></DialogTrigger><DialogContent><DialogTitle className="text-sm font-semibold">确认操作</DialogTitle><p className="mt-2 text-xs text-muted-foreground">这是共享 UI 包的 Dialog 组件。</p></DialogContent></Dialog></section>
    </div>
  </div>;
}

function TokenGallery({ theme }: { theme: Theme }) {
  return <div className="token-gallery">
    <header><span>DESIGN TOKENS</span><h2>变量与灰阶</h2><p>左侧主题设计器修改后，此处实时同步。</p></header>
    <div className="token-list">{THEME_TOKEN_GROUPS.map(({ key, level, label, tokens }) => <section key={key}>
      <div className="token-swatch" style={{ background: theme[key] as string }} />
      <div className="token-details"><div><b>{level}</b><strong>{label}</strong><code>{theme[key]}</code></div><p>{tokens.map((token) => `--${token}`).join(" · ")}</p></div>
    </section>)}</div>
    <Separator />
    <div className="token-meta"><div><span>危险色</span><code>{theme.destructive}</code></div><div><span>全局圆角</span><code>{theme.radius}px</code></div><div><span>基础字号</span><code>{theme.fontSize}px</code></div></div>
  </div>;
}

function App() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [viewport, setViewport] = useState({ x: 470, y: 70, scale: 1 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => {
    const root = document.documentElement.style;
    THEME_TOKEN_GROUPS.forEach(({ key, level, tokens }) => {
      root.setProperty(`--grey-${level}`, theme[key] as string);
      tokens.forEach((token) => root.setProperty(`--${token}`, `var(--grey-${level})`));
    });
    root.setProperty("--card", "var(--grey-100)");
    root.setProperty("--card-foreground", "var(--grey-800)");
    root.setProperty("--popover", "var(--grey-100)");
    root.setProperty("--popover-foreground", "var(--grey-800)");
    root.setProperty("--secondary-foreground", "var(--grey-700)");
    root.setProperty("--accent", "var(--grey-200)");
    root.setProperty("--accent-foreground", "var(--grey-800)");
    root.setProperty("--ring", theme.grey800);
    root.setProperty("--destructive", theme.destructive);
    root.setProperty("--radius", `${theme.radius}px`);
    root.setProperty("--font-size-base", `${theme.fontSize}px`);
  }, [theme]);
  const startPan = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button,input,textarea,label,.studio-artboard")) return;
    drag.current = { x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pan = (event: ReactPointerEvent<HTMLElement>) => {
    const activeDrag = drag.current;
    if (!activeDrag) return;
    const x = activeDrag.originX + event.clientX - activeDrag.x;
    const y = activeDrag.originY + event.clientY - activeDrag.y;
    setViewport((current) => ({ ...current, x, y }));
  };
  const zoom = (event: ReactWheelEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(".studio-theme-panel,.studio-artboard")) return;
    event.preventDefault();
    setViewport((current) => ({ ...current, scale: Math.min(1.5, Math.max(.55, current.scale - event.deltaY * .001)) }));
  };
  const disconnectedAgent = {
    connected: false, connecting: false, error: "无法连接 Prism Agent，请确认本地 Agent 已启动且地址与 Token 正确。", agentUrl: "http://127.0.0.1:19527", agentToken: "",
    setAgentUrl: () => {}, setAgentToken: () => {}, connect: async () => {},
    permissions: { alwaysAllowEdits: false, alwaysAllowAutomatedTesting: false }, updatePermission: async () => {},
  };
  return <main className="studio-page" onPointerDown={startPan} onPointerMove={pan} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onWheel={zoom}>
    <ThemeDesigner theme={theme} onChange={setTheme} />
    <div className="studio-stage" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
      <section className="studio-artboard-wrap"><div className="studio-artboard-label"><span>PRISM DESIGN · CHROME SIDE PANEL</span><span>登录 PANEL</span></div><div className="studio-artboard"><div className="flex h-screen flex-col"><SidePanelHeader><span className="font-semibold text-xs">对话</span><span className="ml-auto flex h-6 w-6 items-center justify-center"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" /></span></SidePanelHeader><div className="min-h-0 flex-1"><ConnectionForm agent={disconnectedAgent} /></div></div></div></section>
      <section className="studio-artboard-wrap"><div className="studio-artboard-label"><span>PRISM DESIGN · CHROME SIDE PANEL</span><span>对话 PANEL</span></div><div className="studio-artboard"><ChromeExtensionApp /></div></section>
      <section className="studio-artboard-wrap"><div className="studio-artboard-label"><span>PRISM DESIGN · CHROME SIDE PANEL</span><span>完整对话 MOCK</span></div><div className="studio-artboard"><MockConversationPanel /></div></section>
      <section className="studio-artboard-wrap"><div className="studio-artboard-label"><span>PRISM DESIGN · CHROME SIDE PANEL</span><span>AGENT 处理过程</span></div><div className="studio-artboard"><ProcessStatePanel /></div></section>
      <section className="studio-artboard-wrap"><div className="studio-artboard-label"><span>PRISM DESIGN · SHARED UI</span><span>全部组件</span></div><div className="studio-artboard"><ComponentGallery /></div></section>
      <section className="studio-artboard-wrap"><div className="studio-artboard-label"><span>PRISM DESIGN · TOKENS</span><span>全部变量</span></div><div className="studio-artboard"><TokenGallery theme={theme} /></div></section>
    </div>
    <div className="studio-canvas-hint">拖动画布浏览 · 滚轮缩放</div>
    <div className="studio-zoom"><button onClick={() => setViewport((v) => ({ ...v, scale: Math.max(.55, v.scale - .1) }))}><Minus size={14} /></button><output>{Math.round(viewport.scale * 100)}%</output><button onClick={() => setViewport({ x: 470, y: 70, scale: 1 })}><RotateCcw size={14} /></button><button onClick={() => setViewport((v) => ({ ...v, scale: Math.min(1.5, v.scale + .1) }))}><Plus size={14} /></button></div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
