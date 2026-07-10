const zh: Record<string, string> = {
  "panel.title": "棱镜",
  "chat.empty": "发送消息与 AI 对话，描述你想要的修改",
  "chat.placeholder": "描述你想要的修改...",
  "chat.send": "发送",
  "chat.thinking": "AI 思考中...",
  "chat.done": "完成",
  "chat.error": "出错了",
  "chat.clearHistory": "清空",
  "chat.requestFailed": "请求失败，请检查 Agent 连接",
  "comment.tooltip": "添加评论",
  "comment.placeholder": "输入评论...",
  "comment.cancel": "取消",
  "comment.confirm": "确认",
  "connect.placeholder": "Agent 地址",
  "connect.button": "连接",
  "connect.connecting": "连接中...",
  "connect.error": "无法连接到 Agent",
  "connect.disconnect": "断开",
  "connect.hint": "请输入 PrismDesign Agent 服务地址",
  "connect.waiting": "等待 Agent 服务就绪...",
  "connect.retry": "重试",
};

const en: Record<string, string> = {
  "panel.title": "棱镜",
  "chat.empty": "Send a message to chat with AI about design changes",
  "chat.placeholder": "Describe the changes you want...",
  "chat.send": "Send",
  "chat.thinking": "AI is thinking...",
  "chat.done": "Done",
  "chat.error": "Error",
  "chat.clearHistory": "Clear",
  "chat.requestFailed": "Request failed, check Agent connection",
  "comment.tooltip": "Add comment",
  "comment.placeholder": "Enter comment...",
  "comment.cancel": "Cancel",
  "comment.confirm": "Confirm",
  "connect.placeholder": "Agent URL",
  "connect.button": "Connect",
  "connect.connecting": "Connecting...",
  "connect.error": "Cannot reach Agent",
  "connect.disconnect": "Disconnect",
  "connect.hint": "Enter the PrismDesign Agent server URL",
  "connect.waiting": "Waiting for Agent...",
  "connect.retry": "Retry",
};

let currentLocale: "zh" | "en" = navigator.language.startsWith("zh") ? "zh" : "en";
let dict = currentLocale === "zh" ? zh : en;

export function setLocale(locale: "zh" | "en") {
  currentLocale = locale;
  dict = currentLocale === "zh" ? zh : en;
}

export function t(key: string, params?: Record<string, string | number>): string {
  let text = dict[key] || en[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
