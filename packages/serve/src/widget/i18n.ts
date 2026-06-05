const zh: Record<string, string> = {
  "panel.title": "PrismDesign",
  "tab.chat": "对话",
  "tab.comments": "评论",
  "chat.empty": "发送消息与 AI 对话，描述你想要的修改",
  "chat.placeholder": "描述你想要的修改...",
  "chat.send": "发送",
  "chat.thinking": "AI 思考中...",
  "chat.done": "完成",
  "chat.error": "出错了",
  "chat.clearHistory": "清空",
  "chat.requestFailed": "请求失败，请检查 Agent 连接",
  "comment.add": "添加评论",
  "comment.stop": "停止标注",
  "comment.placeholder": "输入评论...",
  "comment.cancel": "取消",
  "comment.confirm": "确认",
  "comment.sync": "同步到 Agent",
  "comment.syncing": "同步中...",
  "comment.empty": "点击「添加评论」在页面元素上标注",
  "comment.delete": "删除",
};

const en: Record<string, string> = {
  "panel.title": "PrismDesign",
  "tab.chat": "Chat",
  "tab.comments": "Comments",
  "chat.empty": "Send a message to chat with AI about design changes",
  "chat.placeholder": "Describe the changes you want...",
  "chat.send": "Send",
  "chat.thinking": "AI is thinking...",
  "chat.done": "Done",
  "chat.error": "Error",
  "chat.clearHistory": "Clear",
  "chat.requestFailed": "Request failed, check Agent connection",
  "comment.add": "Add Comment",
  "comment.stop": "Stop",
  "comment.placeholder": "Enter comment...",
  "comment.cancel": "Cancel",
  "comment.confirm": "Confirm",
  "comment.sync": "Sync to Agent",
  "comment.syncing": "Syncing...",
  "comment.empty": "Click \"Add Comment\" to annotate page elements",
  "comment.delete": "Delete",
};

const locale = navigator.language.startsWith("zh") ? "zh" : "en";
const dict = locale === "zh" ? zh : en;

export function t(key: string, params?: Record<string, string | number>): string {
  let text = dict[key] || en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
