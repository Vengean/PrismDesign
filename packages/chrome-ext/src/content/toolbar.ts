/**
 * Lightweight floating toolbar injected into the page.
 * Mirrors the Side Panel toolbar for quick access without switching to the panel.
 */

let toolbar: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;

interface ToolbarCallbacks {
  onToggleSelect: () => void;
  onToggleDrag: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSidePanel: () => void;
}

let callbacks: ToolbarCallbacks | null = null;
let selectActive = false;
let dragActive = false;

export function createToolbar(cbs: ToolbarCallbacks) {
  if (toolbar) return;
  callbacks = cbs;

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
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 2px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      user-select: none;
    }
    #prism-design-toolbar button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 32px;
      width: 32px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
    }
    #prism-design-toolbar button:hover {
      background: #f3f4f6;
      color: #374151;
    }
    #prism-design-toolbar button.pd-active {
      background: #ede9fe;
      color: #6366f1;
    }
    #prism-design-toolbar button:disabled {
      opacity: 0.35;
      pointer-events: none;
    }
    #prism-design-toolbar button svg {
      width: 16px;
      height: 16px;
    }
    #prism-design-toolbar .pd-tb-sep {
      width: 1px;
      height: 20px;
      background: #e5e7eb;
      margin: 0 4px;
      flex-shrink: 0;
    }
    #prism-design-toolbar .pd-tb-badge {
      display: none;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      background: #ef4444;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      border-radius: 8px;
      position: absolute;
      top: 2px;
      right: 2px;
    }
    #prism-design-toolbar .pd-tb-hint {
      font-size: 10px;
      color: #9ca3af;
      margin-left: 4px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(styleEl);

  toolbar = document.createElement("div");
  toolbar.id = "prism-design-toolbar";
  toolbar.innerHTML = `
    <button id="pd-tb-select" title="选择模式 (Ctrl+E)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
    </button>
    <button id="pd-tb-drag" title="拖拽排序 (Ctrl+D)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 13V4.5a1.5 1.5 0 013 0V12"/><path d="M11 11.5V6.5a1.5 1.5 0 013 0V12"/><path d="M14 10.5V8.5a1.5 1.5 0 013 0V12"/><path d="M8 12.5a1.5 1.5 0 00-3 0V14a6 6 0 0012 0V12"/></svg>
    </button>
    <div class="pd-tb-sep"></div>
    <button id="pd-tb-undo" title="撤销 (Ctrl+U)" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6.69 3L3 13"/></svg>
    </button>
    <button id="pd-tb-redo" title="重做 (Ctrl+R)" disabled>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016.69 3L21 13"/></svg>
    </button>
    <div class="pd-tb-sep"></div>
    <button id="pd-tb-panel" title="打开侧边栏">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
    </button>
    <span class="pd-tb-hint">Tab 退出</span>
  `;

  document.body.appendChild(toolbar);

  // Bind events
  toolbar.querySelector("#pd-tb-select")!.addEventListener("click", () => {
    callbacks?.onToggleSelect();
  });
  toolbar.querySelector("#pd-tb-drag")!.addEventListener("click", () => {
    callbacks?.onToggleDrag();
  });
  toolbar.querySelector("#pd-tb-undo")!.addEventListener("click", () => {
    callbacks?.onUndo();
  });
  toolbar.querySelector("#pd-tb-redo")!.addEventListener("click", () => {
    callbacks?.onRedo();
  });
  toolbar.querySelector("#pd-tb-panel")!.addEventListener("click", () => {
    callbacks?.onOpenSidePanel();
  });
}

export function destroyToolbar() {
  toolbar?.remove();
  styleEl?.remove();
  toolbar = null;
  styleEl = null;
  callbacks = null;
}

export function updateToolbarState(opts: {
  selectActive?: boolean;
  dragActive?: boolean;
  undoEnabled?: boolean;
  redoEnabled?: boolean;
}) {
  if (!toolbar) return;
  const selBtn = toolbar.querySelector("#pd-tb-select") as HTMLButtonElement;
  const dragBtn = toolbar.querySelector("#pd-tb-drag") as HTMLButtonElement;
  const undoBtn = toolbar.querySelector("#pd-tb-undo") as HTMLButtonElement;
  const redoBtn = toolbar.querySelector("#pd-tb-redo") as HTMLButtonElement;

  if (opts.selectActive !== undefined) {
    selectActive = opts.selectActive;
    selBtn.classList.toggle("pd-active", selectActive);
  }
  if (opts.dragActive !== undefined) {
    dragActive = opts.dragActive;
    dragBtn.classList.toggle("pd-active", dragActive);
  }
  if (opts.undoEnabled !== undefined) undoBtn.disabled = !opts.undoEnabled;
  if (opts.redoEnabled !== undefined) redoBtn.disabled = !opts.redoEnabled;
}

export function isToolbarElement(el: HTMLElement): boolean {
  return !!el.closest("#prism-design-toolbar");
}
