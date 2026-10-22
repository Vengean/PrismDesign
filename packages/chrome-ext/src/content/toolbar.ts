/**
 * Floating toolbar — Comment annotation toolbar.
 * Default: none highlighted. ESC exits all modes.
 */
import { t as _t } from "./i18n-content.js";

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

type LucideNode = readonly [tag: "path", attributes: Readonly<Record<string, string>>];

const LUCIDE_ICONS = {
  comment: [["path", { d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" }]],
} as const satisfies Record<string, readonly LucideNode[]>;

function lucideIcon(nodes: readonly LucideNode[]) {
  const children = nodes.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ")}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

export function createToolbar(toolbarActions: ToolbarActions) {
  if (toolbar) return;
  actions = toolbarActions;

  document.getElementById("prism-studio-toolbar")?.remove();
  document.getElementById("prism-studio-toolbar-style")?.remove();

  styleEl = document.createElement("style");
  styleEl.id = "prism-studio-toolbar-style";
  styleEl.textContent = `
    #prism-studio-toolbar {
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
    #prism-studio-toolbar button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 34px;
      width: 34px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #86909c;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
    }
    #prism-studio-toolbar button:focus { outline: none; }
    #prism-studio-toolbar button:hover { background: #f0f1f3; color: #4e5969; }
    #prism-studio-toolbar button.pd-active { background: #f0f1f3; color: #4e5969; }
    #prism-studio-toolbar button svg { width: 18px; height: 18px; flex-shrink: 0; }
    #prism-studio-toolbar.pd-disabled {
      pointer-events: none;
      opacity: 0;
    }
    /* Tooltip */
    #prism-studio-toolbar button .pd-tooltip {
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
    #prism-studio-toolbar button .pd-tooltip .pd-shortcut {
      color: #9ca3af;
      margin-left: 4px;
      font-size: 10px;
    }
    @media (hover: hover) {
      #prism-studio-toolbar button:hover .pd-tooltip {
        opacity: 1;
      }
    }
    #prism-studio-toolbar.pd-disabled button:hover .pd-tooltip,
    #prism-studio-toolbar button.pd-active .pd-tooltip {
      opacity: 0;
    }
  `;
  document.head.appendChild(styleEl);

  toolbar = document.createElement("div");
  toolbar.id = "prism-studio-toolbar";
  toolbar.innerHTML = `
    <button id="pd-tb-comment">
      ${lucideIcon(LUCIDE_ICONS.comment)}
      <span class="pd-tooltip">${_t("toolbar.comment")}<span class="pd-shortcut">${modLabel}C</span></span>
    </button>
  `;
  document.body.appendChild(toolbar);

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
  return !!el.closest("#prism-studio-toolbar");
}

/** Trigger mode switch from keyboard shortcut */
export function triggerMode(mode: "select" | "drag" | "comment") {
  switchMode(mode);
}
