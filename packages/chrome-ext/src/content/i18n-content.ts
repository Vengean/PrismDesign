/**
 * Inline i18n for content scripts only.
 * Separate file to avoid Rollup creating shared chunks with sidepanel.
 */

const zh: Record<string, string> = {
  "toolbar.select": "选择元素",
  "toolbar.drag": "拖拽排列",
  "toolbar.comment": "评论",
  "comment.placeholder": "输入评论...",
  "comment.cancel": "取消",
  "comment.confirm": "确认",
};

const en: Record<string, string> = {
  "toolbar.select": "Select Element",
  "toolbar.drag": "Drag to Reorder",
  "toolbar.comment": "Comment",
  "comment.placeholder": "Enter comment...",
  "comment.cancel": "Cancel",
  "comment.confirm": "Confirm",
};

let lang = "en";
try {
  const uiLang = (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.()) || navigator.language || "en";
  lang = uiLang.startsWith("zh") ? "zh" : "en";
} catch {}

const locales: Record<string, Record<string, string>> = { zh, en };

export function t(key: string): string {
  return locales[lang]?.[key] || locales.en[key] || key;
}
