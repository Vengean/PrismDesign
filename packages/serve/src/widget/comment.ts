import { t } from "./i18n.js";

export interface CommentInfo {
  target: string; // e.g. "div.header" or "button#submit"
  text: string;
  domStructure?: string;
  /** React/Vue component name */
  component?: string;
  /** Component chain (authoring hierarchy) */
  componentChain?: string;
  /** Component props */
  props?: Record<string, unknown>;
  /** Source file path (relative) */
  sourceFile?: string;
  /** Source line number */
  sourceLine?: number;
}

// ── Global overlay & popup IDs ──
const OVERLAY_ID = "prism-studio-comment-overlay";
const POPUP_ID = "prism-studio-comment-popup";
const STYLE_ID = "prism-studio-comment-styles";

function ensureGlobalStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: absolute;
      pointer-events: none;
      border: 2px solid #6366f1;
      background: rgba(99, 102, 241, 0.08);
      border-radius: 3px;
      z-index: 2147483646;
      transition: all 0.1s ease-out;
    }
    #${POPUP_ID} {
      position: absolute;
      z-index: 2147483647;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      padding: 10px;
      width: 240px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
    }
    #${POPUP_ID} textarea {
      width: 100%;
      min-height: 60px;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      color: #1a1a1a;
    }
    #${POPUP_ID} textarea:focus { border-color: #6366f1; }
    #${POPUP_ID} .popup-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
    }
    #${POPUP_ID} button {
      padding: 4px 12px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: white;
      cursor: pointer;
      font-family: inherit;
    }
    #${POPUP_ID} button.confirm {
      background: #6366f1;
      color: white;
      border-color: #6366f1;
    }
    #${POPUP_ID} button.confirm:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

function showOverlay(el: Element) {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  }
  const rect = el.getBoundingClientRect();
  overlay.style.top = rect.top + window.scrollY + "px";
  overlay.style.left = rect.left + window.scrollX + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.display = "block";
}

function hideOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.style.display = "none";
}

function removePopup() {
  const popup = document.getElementById(POPUP_ID);
  if (popup) popup.remove();
}

// ── Source location detection (React / Vue) ──

function parseStackLine(line: string): { fileName?: string; lineNumber?: number } | null {
  const m = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at\s+(.+):(\d+):(\d+)/);
  if (!m) return null;
  let fileName = m[1];
  const lineNumber = parseInt(m[2], 10);
  try { fileName = decodeURIComponent(new URL(fileName).pathname).slice(1); } catch { fileName = fileName.replace(/\?.*$/, ""); }
  if (fileName.includes("node_modules") || fileName.startsWith("chrome-extension")) return null;
  return { fileName, lineNumber };
}

function getSourceFromFiber(fiber: any): { fileName?: string; lineNumber?: number } | null {
  if (fiber._debugSource) return fiber._debugSource;
  if (fiber._debugOwner?._debugSource) return fiber._debugOwner._debugSource;
  if (fiber._debugStack) {
    const stack = typeof fiber._debugStack === "string" ? fiber._debugStack : fiber._debugStack?.stack;
    if (stack) { for (const line of stack.split("\n").slice(1)) { const p = parseStackLine(line); if (p) return p; } }
  }
  if (typeof fiber.type === "function" && fiber.type.__source) return fiber.type.__source;
  return null;
}

const SKIP_TAGS = new Set([6, 9, 10, 13]);

function sanitizeProps(props: Record<string, unknown> | null): Record<string, unknown> {
  if (!props) return {};
  const clean: Record<string, unknown> = {};
  try {
    for (const key of Object.keys(props)) {
      if (key === "children") continue;
      const value = props[key];
      const t = typeof value;
      if (t === "string" || t === "number" || t === "boolean" || value === null) clean[key] = value;
    }
  } catch {}
  return clean;
}

interface DetectedInfo {
  component?: string;
  componentChain?: string;
  props?: Record<string, unknown>;
  sourceFile?: string;
  sourceLine?: number;
}

function detectComponentInfo(el: Element): DetectedInfo {
  try {
    const keys = Object.getOwnPropertyNames(el);
    const fiberKey = keys.find(k => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (fiberKey) {
      const fiber = (el as any)[fiberKey];
      let comp: DetectedInfo | null = null;
      let f = fiber;
      while (f) {
        if (typeof f.type === "function" && !SKIP_TAGS.has(f.tag)) {
          const name = f.type.displayName || f.type.name;
          if (name && name.length > 2) {
            const src = getSourceFromFiber(f);
            if (!src?.fileName?.includes("node_modules")) {
              comp = { component: name, props: sanitizeProps(f.memoizedProps), sourceFile: src?.fileName, sourceLine: src?.lineNumber };
              break;
            }
          }
        }
        f = f.return;
      }
      const chain: string[] = [];
      let owner = fiber._debugOwner;
      while (owner) {
        if (typeof owner.type === "function" && !SKIP_TAGS.has(owner.tag)) {
          const name = owner.type.displayName || owner.type.name;
          if (name && name.length > 2) {
            const src = getSourceFromFiber(owner);
            if (!src?.fileName?.includes("node_modules") && (chain.length === 0 || chain[chain.length - 1] !== name)) chain.push(name);
          }
        }
        owner = owner._debugOwner;
      }
      chain.reverse();
      if (comp?.component && (chain.length === 0 || chain[chain.length - 1] !== comp.component)) chain.push(comp.component);
      const trimmed = chain.length > 5 ? "... > " + chain.slice(-5).join(" > ") : chain.join(" > ");
      return { component: comp?.component, componentChain: trimmed || undefined, props: comp?.props, sourceFile: comp?.sourceFile, sourceLine: comp?.sourceLine };
    }
    const vueInst = (el as any).__vueParentComponent;
    if (vueInst) { const name = vueInst.type.__name || vueInst.type.name; return { component: name, sourceFile: vueInst.type.__file }; }
    const vue2 = (el as any).__vue__;
    if (vue2) { const name = vue2.$options.name; return { component: name, sourceFile: vue2.$options.__file }; }
  } catch {}
  return {};
}

/** Build simplified DOM snapshot */
function collectDomSnapshot(el: Element, depth = 0, maxDepth = 4): string {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();
  const htmlEl = el as HTMLElement;
  let attrs = "";
  if (el.id) attrs += ` id="${el.id}"`;
  const cls = typeof el.className === "string" ? el.className.trim() : "";
  if (cls) { const parts = cls.split(" "); attrs += ` class="${parts.slice(0, 3).join(" ")}${parts.length > 3 ? " ..." : ""}"`; }
  const children = el.children;
  if (children.length === 0 || depth >= maxDepth) {
    const text = (htmlEl.innerText || "").trim().replace(/\s+/g, " ");
    if (!text) return `${indent}<${tag}${attrs} />`;
    const truncated = text.length > 30 ? text.slice(0, 30) + "..." : text;
    return `${indent}<${tag}${attrs}>${truncated}</${tag}>`;
  }
  const lines: string[] = [`${indent}<${tag}${attrs}>`];
  for (const node of el.childNodes) {
    if (node === children[0]) break;
    if (node.nodeType === Node.TEXT_NODE) { const t = (node.textContent || "").trim(); if (t) lines.push(`${indent}  ${t.length > 30 ? t.slice(0, 30) + "..." : t}`); }
  }
  lines.push(collectDomSnapshot(children[0], depth + 1, maxDepth));
  if (children.length > 1) lines.push(`${indent}  ...`);
  lines.push(`${indent}</${tag}>`);
  return lines.join("\n");
}

function buildCommentInfo(el: Element, commentText: string): CommentInfo {
  const tag = el.tagName.toLowerCase();
  let target = tag;
  if (el.id) {
    target = `${tag}#${el.id}`;
  } else if (el.className && typeof el.className === "string") {
    const cls = el.className.trim().split(/\s+/).slice(0, 2).join(".");
    if (cls) target = `${tag}.${cls}`;
  }
  const domStructure = collectDomSnapshot(el);
  const { component, componentChain, props, sourceFile, sourceLine } = detectComponentInfo(el);
  return {
    target,
    text: commentText,
    domStructure: domStructure || undefined,
    component,
    componentChain,
    props: props && Object.keys(props).length > 0 ? props : undefined,
    sourceFile,
    sourceLine,
  };
}

function isCommentUI(el: Element): boolean {
  const id = el.id || "";
  if (id === OVERLAY_ID || id === POPUP_ID) return true;
  if (el.closest(`#${POPUP_ID}`) || el.closest("#prism-studio-widget")) return true;
  return false;
}

/**
 * Enter comment mode: user clicks a page element, types a comment,
 * then onConfirm is called with the CommentInfo.
 * onCancel is called if user exits without confirming.
 */
export function showCommentMode(
  _shadowRoot: ShadowRoot,
  onConfirm: (info: CommentInfo) => void,
  onCancel: () => void
) {
  ensureGlobalStyles();

  const savedCursor = document.body.style.cursor;
  document.body.style.cursor = "crosshair";

  function onMouseMove(e: MouseEvent) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isCommentUI(target)) {
      hideOverlay();
      return;
    }
    showOverlay(target);
  }

  function onClick(e: MouseEvent) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isCommentUI(target)) return;

    e.preventDefault();
    e.stopPropagation();
    hideOverlay();

    // Show popup
    showPopup(target);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      cleanup();
      onCancel();
    }
  }

  function cleanup() {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = savedCursor;
    hideOverlay();
    removePopup();
  }

  function showPopup(target: Element) {
    removePopup();

    // Pause mouse/click listeners while popup is open
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);

    const popup = document.createElement("div");
    popup.id = POPUP_ID;

    const textareaEl = document.createElement("textarea");
    textareaEl.placeholder = t("comment.placeholder");
    popup.appendChild(textareaEl);

    const actions = document.createElement("div");
    actions.className = "popup-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = t("comment.cancel");
    cancelBtn.onclick = () => {
      cleanup();
      onCancel();
    };
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "confirm";
    confirmBtn.textContent = t("comment.confirm");
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => {
      const text = textareaEl.value.trim();
      if (text) {
        cleanup();
        onConfirm(buildCommentInfo(target, text));
      }
    };
    actions.appendChild(confirmBtn);
    popup.appendChild(actions);

    textareaEl.oninput = () => {
      confirmBtn.disabled = !textareaEl.value.trim();
    };
    textareaEl.onkeydown = (e) => {
      if (e.key === "Escape") {
        cleanup();
        onCancel();
      }
    };

    // Position below the target element
    const rect = target.getBoundingClientRect();
    popup.style.top = rect.bottom + window.scrollY + 8 + "px";
    let left = rect.left + window.scrollX;
    if (left + 240 > window.innerWidth) left = window.innerWidth - 252;
    popup.style.left = Math.max(8, left) + "px";

    document.body.appendChild(popup);
    textareaEl.focus();
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}
