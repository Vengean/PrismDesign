/**
 * Floating toolbar — 3 mutually exclusive modes: select, drag, comment.
 * Default: none highlighted. ESC exits all modes.
 */

let toolbar: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let activeMode: "select" | "drag" | "comment" | null = null;
let disabled = false;

export interface ToolbarActions {
  onModeChange: (mode: "select" | "drag" | "comment" | null) => void;
}

let actions: ToolbarActions | null = null;

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
const modLabel = isMac ? "\u2318\u21E7" : "Ctrl+Shift+";

export function createToolbar(toolbarActions: ToolbarActions) {
  if (toolbar) return;
  actions = toolbarActions;

  document.getElementById("prism-design-toolbar")?.remove();
  document.getElementById("prism-design-toolbar-style")?.remove();

  styleEl = document.createElement("style");
  styleEl.id = "prism-design-toolbar-style";
  styleEl.textContent = `
    #prism-design-toolbar {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 2px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }
    #prism-design-toolbar button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 34px;
      width: 34px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
    }
    #prism-design-toolbar button:focus { outline: none; }
    #prism-design-toolbar button:hover { background: #f3f4f6; color: #374151; }
    #prism-design-toolbar button.pd-active { background: #ede9fe; color: #6366f1; }
    #prism-design-toolbar button svg { width: 18px; height: 18px; flex-shrink: 0; }
    #prism-design-toolbar.pd-disabled button {
      pointer-events: none;
      opacity: 0.35;
    }
    /* Tooltip */
    #prism-design-toolbar button .pd-tooltip {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: #fff;
      font-size: 11px;
      line-height: 1.3;
      padding: 4px 8px;
      border-radius: 6px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
    }
    #prism-design-toolbar button .pd-tooltip .pd-shortcut {
      color: #9ca3af;
      margin-left: 4px;
      font-size: 10px;
    }
    #prism-design-toolbar button:hover .pd-tooltip {
      opacity: 1;
    }
    #prism-design-toolbar.pd-disabled button:hover .pd-tooltip {
      opacity: 0;
    }
  `;
  document.head.appendChild(styleEl);

  toolbar = document.createElement("div");
  toolbar.id = "prism-design-toolbar";
  toolbar.innerHTML = `
    <button id="pd-tb-select">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
      <span class="pd-tooltip">选择元素<span class="pd-shortcut">${modLabel}E</span></span>
    </button>
    <button id="pd-tb-drag">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 16"/></svg>
      <span class="pd-tooltip">拖拽排列<span class="pd-shortcut">${modLabel}D</span></span>
    </button>
    <button id="pd-tb-comment">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <span class="pd-tooltip">评论<span class="pd-shortcut">${modLabel}C</span></span>
    </button>
  `;
  document.body.appendChild(toolbar);

  toolbar.querySelector("#pd-tb-select")!.addEventListener("click", () => switchMode("select"));
  toolbar.querySelector("#pd-tb-drag")!.addEventListener("click", () => switchMode("drag"));
  toolbar.querySelector("#pd-tb-comment")!.addEventListener("click", () => switchMode("comment"));

  syncButtonStates();
}

function switchMode(mode: "select" | "drag" | "comment") {
  if (disabled) return;
  activeMode = activeMode === mode ? null : mode;
  syncButtonStates();
  actions?.onModeChange(activeMode);
}

function syncButtonStates() {
  if (!toolbar) return;
  toolbar.querySelector("#pd-tb-select")!.classList.toggle("pd-active", activeMode === "select");
  toolbar.querySelector("#pd-tb-drag")!.classList.toggle("pd-active", activeMode === "drag");
  toolbar.querySelector("#pd-tb-comment")!.classList.toggle("pd-active", activeMode === "comment");
  toolbar.classList.toggle("pd-disabled", disabled);
}

export function destroyToolbar() {
  toolbar?.remove();
  styleEl?.remove();
  toolbar = null;
  styleEl = null;
  activeMode = null;
  disabled = false;
}

export function setActiveMode(mode: "select" | "drag" | "comment" | null) {
  activeMode = mode;
  syncButtonStates();
}

export function setToolbarDisabled(value: boolean) {
  disabled = value;
  syncButtonStates();
}

export function isToolbarDisabled(): boolean {
  return disabled;
}

export function isToolbarElement(el: HTMLElement): boolean {
  return !!el.closest("#prism-design-toolbar");
}

/** Trigger mode switch from keyboard shortcut */
export function triggerMode(mode: "select" | "drag" | "comment") {
  switchMode(mode);
}
