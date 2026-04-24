import { inspectElement, getComponentChain } from "./inspector.js";
import {
  initOverlays,
  showHoverHighlight,
  hideHoverHighlight,
  showSelectHighlight,
  hideSelectHighlight,
  destroyOverlays,
} from "./overlay.js";
import {
  initEditor,
  destroyEditor,
  handleElementClick,
  handleElementMouseDown,
  getPendingChanges,
  getDragMoves,
  clearChanges,
  getActiveElement,
} from "./editor.js";
import { buildDOMTree, resetIdCounter } from "./dom-tree.js";
import { initKeyboard, destroyKeyboard } from "./keyboard.js";
import { createToolbar, destroyToolbar, updateToolbarState, isToolbarElement } from "./toolbar.js";
import type { PrismMessage } from "../shared/types.js";

let designModeActive = false;
let dragModeActive = false;
let selectedElement: HTMLElement | null = null;

function isOurElement(element: HTMLElement): boolean {
  if (isToolbarElement(element)) return true;
  let el: HTMLElement | null = element;
  while (el) {
    if (el.id?.startsWith("prism-design-")) return true;
    el = el.parentElement;
  }
  return false;
}

// ---- Event handlers ----

function handleMouseMove(e: MouseEvent) {
  if (!designModeActive || dragModeActive) return;
  const target = e.target as HTMLElement;
  if (isOurElement(target)) return;
  if (target === getActiveElement()) return;

  const info = inspectElement(target);
  showHoverHighlight(target, info.component?.name);
}

function handleClick(e: MouseEvent) {
  if (!designModeActive) return;
  const target = e.target as HTMLElement;
  if (isOurElement(target)) return;
  if (target.contentEditable === "true") return;

  e.preventDefault();
  e.stopPropagation();

  selectedElement = target;
  hideHoverHighlight();
  showSelectHighlight(target);

  // Show inline editor toolbar
  try { handleElementClick(target); } catch {}

  // Send selection info to side panel
  const info = inspectElement(target);
  chrome.runtime.sendMessage({
    type: "ELEMENT_SELECTED",
    payload: info,
  });
}

function handleMouseDown(e: MouseEvent) {
  if (!designModeActive || !dragModeActive) return;
  const target = e.target as HTMLElement;
  if (isOurElement(target)) return;
  if (target.contentEditable === "true") return;
  handleElementMouseDown(e, target);
}

function handleMouseLeave() {
  hideHoverHighlight();
}

// ---- Design mode lifecycle ----

function enableDesignMode() {
  if (designModeActive) return;
  designModeActive = true;

  try {
    initOverlays();
    initEditor();
  } catch (err) {
    console.error("[PrismDesign] Init error:", err);
  }

  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseleave", handleMouseLeave, true);

  // Create floating toolbar
  createToolbar({
    onToggleSelect: () => {
      // Already in select mode by default, toggle would exit design mode
      chrome.runtime.sendMessage({ type: "DESIGN_MODE_STATUS", payload: { active: designModeActive } });
    },
    onToggleDrag: () => {
      dragModeActive = !dragModeActive;
      document.body.style.cursor = dragModeActive ? "grab" : "crosshair";
      updateToolbarState({ dragActive: dragModeActive, selectActive: !dragModeActive });
      chrome.runtime.sendMessage({ type: dragModeActive ? "ENABLE_DRAG_MODE" : "DISABLE_DRAG_MODE" });
    },
    onUndo: () => {
      chrome.runtime.sendMessage({ type: "UNDO" });
    },
    onRedo: () => {
      chrome.runtime.sendMessage({ type: "REDO" });
    },
    onOpenSidePanel: () => {
      // Chrome API to open side panel from content script
      chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    },
  });
  updateToolbarState({ selectActive: true });

  initKeyboard({
    e: () => {
      chrome.runtime.sendMessage({ type: "DESIGN_MODE_STATUS", payload: { active: true } });
    },
    d: () => {
      dragModeActive = !dragModeActive;
      document.body.style.cursor = dragModeActive ? "grab" : "crosshair";
      updateToolbarState({ dragActive: dragModeActive, selectActive: !dragModeActive });
    },
    u: () => chrome.runtime.sendMessage({ type: "UNDO" }),
    r: () => chrome.runtime.sendMessage({ type: "REDO" }),
  });

  document.body.style.cursor = "crosshair";
  console.log("[PrismDesign] Design mode enabled");
}

function disableDesignMode() {
  if (!designModeActive) return;
  designModeActive = false;
  dragModeActive = false;

  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("mousedown", handleMouseDown, true);
  document.removeEventListener("mouseleave", handleMouseLeave, true);

  hideHoverHighlight();
  hideSelectHighlight();
  destroyOverlays();
  destroyEditor();
  destroyKeyboard();
  destroyToolbar();

  document.body.style.cursor = "";
  selectedElement = null;

  chrome.runtime.sendMessage({ type: "ELEMENT_DESELECTED" });
  console.log("[PrismDesign] Design mode disabled");
}

// ---- Find element by DOM path ----

function findElementByPath(domPath: string): HTMLElement | null {
  try {
    // Try direct querySelector with the path
    const parts = domPath.split(" > ");
    let current: HTMLElement = document.body;
    for (const part of parts) {
      const children = Array.from(current.children) as HTMLElement[];
      const match = children.find((child) => {
        const tag = child.tagName.toLowerCase();
        if (part.includes("#")) {
          const [t, id] = part.split("#");
          return tag === t && child.id === id;
        }
        if (part.includes(".")) {
          const [t, ...classes] = part.split(".");
          return tag === t && classes.every((c) => child.classList.contains(c));
        }
        return tag === part;
      });
      if (!match) return null;
      current = match;
    }
    return current;
  } catch {
    return null;
  }
}

// ---- Message handler ----

chrome.runtime.onMessage.addListener((message: PrismMessage, _sender, sendResponse) => {
  switch (message.type) {
    case "DESIGN_MODE_ON":
      enableDesignMode();
      sendResponse({ success: true });
      break;

    case "DESIGN_MODE_OFF":
      disableDesignMode();
      sendResponse({ success: true });
      break;

    case "ENABLE_DRAG_MODE":
      dragModeActive = true;
      document.body.style.cursor = "grab";
      sendResponse({ success: true });
      break;

    case "DISABLE_DRAG_MODE":
      dragModeActive = false;
      document.body.style.cursor = designModeActive ? "crosshair" : "";
      sendResponse({ success: true });
      break;

    case "GET_DOM_TREE": {
      resetIdCounter();
      const tree = buildDOMTree(document.body);
      sendResponse(tree);
      // Also send as message for side panel
      chrome.runtime.sendMessage({ type: "DOM_TREE", payload: tree });
      break;
    }

    case "GET_PENDING_CHANGES": {
      const changes = getPendingChanges();
      const moves = getDragMoves();
      const componentInfo = selectedElement ? inspectElement(selectedElement).component : null;
      sendResponse({ changes, moves, component: componentInfo });
      break;
    }

    case "CLEAR_CHANGES":
      clearChanges();
      sendResponse({ success: true });
      break;

    case "HIGHLIGHT_ELEMENT": {
      const el = findElementByPath(message.payload.domPath);
      if (el) showHoverHighlight(el);
      sendResponse({ success: !!el });
      break;
    }

    case "UNHIGHLIGHT_ELEMENT":
      hideHoverHighlight();
      sendResponse({ success: true });
      break;

    case "SELECT_ELEMENT": {
      const el = findElementByPath(message.payload.domPath);
      if (el) {
        selectedElement = el;
        hideHoverHighlight();
        showSelectHighlight(el);
        handleElementClick(el);
        const info = inspectElement(el);
        chrome.runtime.sendMessage({ type: "ELEMENT_SELECTED", payload: info });
      }
      sendResponse({ success: !!el });
      break;
    }

    case "APPLY_STYLE_PREVIEW": {
      const el = findElementByPath(message.payload.domPath);
      if (el) {
        const prop = message.payload.property.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
        (el.style as any)[prop] = message.payload.value;
      }
      sendResponse({ success: !!el });
      break;
    }

    case "CLEAR_STYLE_PREVIEW": {
      const el = findElementByPath(message.payload.domPath);
      if (el) el.removeAttribute("style");
      sendResponse({ success: !!el });
      break;
    }

    case "PING":
      sendResponse({ active: designModeActive });
      break;

    default:
      sendResponse({ success: false });
  }
  return true;
});

// Tab key to toggle design mode directly from the page
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || (active as HTMLElement).contentEditable === "true")) {
      return;
    }
    e.preventDefault();
    if (designModeActive) {
      disableDesignMode();
    } else {
      enableDesignMode();
    }
  }
});

// Notify that content script is ready
chrome.runtime.sendMessage({ type: "CONTENT_READY" }).catch(() => {});
console.log("[PrismDesign] Content script loaded");
