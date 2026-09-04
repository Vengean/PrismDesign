/**
 * Lightweight i18n for PrismDesign Chrome extension.
 * Detects browser language and returns the correct string.
 */

const zh: Record<string, string> = {
  // ── View titles ──
  "view.chat": "对话",
  "view.navigator": "导航",
  "view.properties": "属性",
  "view.changes": "变更",
  "view.pending": "待同步",

  // ── Toolbar ──
  "toolbar.select": "选择元素",
  "toolbar.drag": "拖拽排列",
  "toolbar.comment": "评论",

  // ── Comment popup ──
  "comment.placeholder": "输入评论...",
  "comment.cancel": "取消",
  "comment.confirm": "确认",

  // ── Connection ──
  "agent.connecting": "正在连接 Agent...",
  "agent.connectTitle": "连接 Agent 服务",
  "agent.connectDesc": "请输入 Agent 服务地址，连接源码工程后即可开发、调整并验证当前页面。",
  "agent.connect": "连接",
  "agent.tokenPlaceholder": "输入 Agent 启动时显示的访问 Token",
  "agent.connected": "已连接",
  "agent.disconnect": "断开连接",
  "agent.permissions": "权限",
  "agent.alwaysAllowEdits": "始终允许修改",
  "agent.alwaysAllowAutomatedTesting": "始终允许自动测试",
  "agent.connecting_short": "连接中",
  "agent.disconnected": "未连接",
  "agent.connectFailed": "连接失败，请检查 Agent 服务是否已启动",

  // ── Chat ──
  "chat.empty": "描述开发、调整或测试目标，\nAI 会修改源码并协助验证页面。",
  "chat.placeholder": "描述开发、修改或测试目标... (Ctrl+Enter 发送)",
  "chat.clearHistory": "清空",
  "chat.thinking": "思考中...",
  "chat.done": "已完成。",
  "chat.error": "错误",
  "chat.requestFailed": "请求失败。",
  "chat.send": "发送",

  // ── Navigator ──
  "nav.search": "搜索节点...",
  "nav.refresh": "刷新",
  "nav.empty": "开启选择模式后显示 DOM 树",

  // ── Properties Panel ──
  "props.empty1": "选中页面元素后",
  "props.empty2": "可在此查看和编辑属性",
  "props.text": "文字",
  "props.fontSize": "字号",
  "props.fontWeight": "字重",
  "props.color": "颜色",
  "props.fill": "填充",
  "props.background": "背景色",
  "props.appearance": "外观",
  "props.opacity": "透明度",
  "props.borderRadius": "圆角",
  "props.layout": "布局",
  "props.gap": "间隔",
  "props.weight.light": "细体",
  "props.weight.regular": "常规",
  "props.weight.medium": "中等",
  "props.weight.semibold": "半粗",
  "props.weight.bold": "粗体",
  "props.weight.extrabold": "特粗",

  // ── Pending Panel ──
  "pending.empty": "修改元素属性或添加评论后，\n待同步消息会显示在这里。",
  "pending.none": "(无)",
  "pending.delete": "删除",
  "pending.sync": "同步",
  "pending.position": "位置",
  "pending.itemN": "第 {n} 项",
  "pending.count": "{n} 条",

  // ── Sync message formatting ──
  "sync.page": "页面",
  "sync.chain": "组件链",
  "sync.source": "源码",
  "sync.text": "DOM 结构",
  "sync.modify": "修改",
  "sync.move": "移动",
  "sync.comment": "评论",
  "sync.padding": "内边距",
  "sync.margin": "外边距",

  // ── Changes Panel ──
  "changes.syncing": "正在同步 {n} 项变更到源码...",
  "changes.done": "同步完成。",
  "changes.failed": "同步失败",
  "changes.empty": "暂无待同步的变更。",
  "changes.commentLabel": "评论",
  "changes.emptyValue": "空",
  "changes.syncBtn": "同步到代码",
  "changes.syncingBtn": "同步中...",
  "changes.discard": "丢弃所有变更",
};

const en: Record<string, string> = {
  // ── View titles ──
  "view.chat": "Chat",
  "view.navigator": "Navigator",
  "view.properties": "Properties",
  "view.changes": "Changes",
  "view.pending": "Pending",

  // ── Toolbar ──
  "toolbar.select": "Select Element",
  "toolbar.drag": "Drag to Reorder",
  "toolbar.comment": "Comment",

  // ── Comment popup ──
  "comment.placeholder": "Enter comment...",
  "comment.cancel": "Cancel",
  "comment.confirm": "Confirm",

  // ── Connection ──
  "agent.connecting": "Connecting to Agent...",
  "agent.connectTitle": "Connect Agent Service",
  "agent.connectDesc": "Enter the Agent service URL to develop, refine, and verify the current source-backed page.",
  "agent.connect": "Connect",
  "agent.tokenPlaceholder": "Enter the access token shown when Agent starts",
  "agent.connected": "Connected",
  "agent.disconnect": "Disconnect",
  "agent.permissions": "Permissions",
  "agent.alwaysAllowEdits": "Always allow edits",
  "agent.alwaysAllowAutomatedTesting": "Always allow automated testing",
  "agent.connecting_short": "Connecting",
  "agent.disconnected": "Disconnected",
  "agent.connectFailed": "Connection failed. Please check if the Agent service is running.",

  // ── Chat ──
  "chat.empty": "Describe a development, refinement, or testing goal.\nAI will update the source and help verify the page.",
  "chat.placeholder": "Describe a development, change, or test goal... (Ctrl+Enter to send)",
  "chat.clearHistory": "Clear",
  "chat.thinking": "Thinking...",
  "chat.done": "Done.",
  "chat.error": "Error",
  "chat.requestFailed": "Request failed.",
  "chat.send": "Send",

  // ── Navigator ──
  "nav.search": "Search nodes...",
  "nav.refresh": "Refresh",
  "nav.empty": "Enable select mode to view the DOM tree",

  // ── Properties Panel ──
  "props.empty1": "Select an element on the page",
  "props.empty2": "to inspect and edit its properties",
  "props.text": "Text",
  "props.fontSize": "Size",
  "props.fontWeight": "Weight",
  "props.color": "Color",
  "props.fill": "Fill",
  "props.background": "Background",
  "props.appearance": "Appearance",
  "props.opacity": "Opacity",
  "props.borderRadius": "Radius",
  "props.layout": "Layout",
  "props.gap": "Gap",
  "props.weight.light": "Light",
  "props.weight.regular": "Regular",
  "props.weight.medium": "Medium",
  "props.weight.semibold": "Semibold",
  "props.weight.bold": "Bold",
  "props.weight.extrabold": "Extra Bold",

  // ── Pending Panel ──
  "pending.empty": "Edit element properties or add comments,\npending messages will appear here.",
  "pending.none": "(none)",
  "pending.delete": "Delete",
  "pending.sync": "Sync",
  "pending.position": "Position",
  "pending.itemN": "Item {n}",
  "pending.count": "{n} items",

  // ── Sync message formatting ──
  "sync.page": "Page",
  "sync.chain": "Component Chain",
  "sync.source": "Source",
  "sync.text": "DOM Structure",
  "sync.modify": "Changes",
  "sync.move": "Move",
  "sync.comment": "Comment",
  "sync.padding": "Padding",
  "sync.margin": "Margin",

  // ── Changes Panel ──
  "changes.syncing": "Syncing {n} changes to source...",
  "changes.done": "Sync complete.",
  "changes.failed": "Sync failed",
  "changes.empty": "No pending changes.",
  "changes.commentLabel": "Comment",
  "changes.emptyValue": "empty",
  "changes.syncBtn": "Sync to Code",
  "changes.syncingBtn": "Syncing...",
  "changes.discard": "Discard All Changes",
};

const locales: Record<string, Record<string, string>> = { zh, en };

let currentLang = "en";
try {
  const uiLang = (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.()) || navigator.language || "en";
  currentLang = uiLang.startsWith("zh") ? "zh" : "en";
} catch {
  // content script or test env
}

/**
 * Get translated string. Supports `{n}` placeholder.
 * Usage: t("pending.count", { n: 3 }) → "3 条" / "3 items"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let str = locales[currentLang]?.[key] || locales.en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
}

export function getCurrentLang(): string {
  return currentLang;
}
