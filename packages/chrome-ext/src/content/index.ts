import { inspectElement, getComponentChain } from "./inspector.js";
import {
  initOverlays, showHoverHighlight, hideHoverHighlight,
  showSelectHighlight, hideSelectHighlight, destroyOverlays,
} from "./overlay.js";
import {
  initEditor, destroyEditor, handleElementClick, handleElementMouseDown,
  getPendingChanges, getDragMoves, clearChanges, getActiveElement, recordStyleChange,
  setOnDragComplete,
} from "./editor.js";
import { buildDOMTree, resetIdCounter } from "./dom-tree.js";
import { initKeyboard, destroyKeyboard } from "./keyboard.js";
import { createToolbar, destroyToolbar, isToolbarElement, setActiveMode, setToolbarDisabled, isToolbarDisabled, triggerMode } from "./toolbar.js";
import { initCommentPopup, showCommentPopup, hideCommentPopup, destroyCommentPopup, isCommentPopupElement } from "./comment-popup.js";
import { safeSendMessage, isContextInvalidated, onContextInvalidated } from "./runtime.js";
import type { PrismMessage } from "../shared/types.js";

let designModeActive = false;
let dragModeActive = false;
let commentModeActive = false;
let selectedElement: HTMLElement | null = null;

/** ESC — deactivate current toolbar mode and return to chat panel */
function exitCurrentMode() {
  disableDesignMode();
  setActiveMode(null);
  safeSendMessage({ type: "OPEN_CHAT" });
}

onContextInvalidated(() => {
  disableDesignMode();
  destroyCommentPopup();
  removeToolbar();
});

function isOurElement(element: HTMLElement): boolean {
  if (isToolbarElement(element)) return true;
  if (isCommentPopupElement(element)) return true;
  let el: HTMLElement | null = element;
  while (el) {
    if (el.id?.startsWith("prism-design-")) return true;
    el = el.parentElement;
  }
  return false;
}

// ---- Event handlers ----

function handleMouseMove(e: MouseEvent) {
  if (!designModeActive) return;
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

  if (commentModeActive) {
    hideHoverHighlight();
    showSelectHighlight(target);
    const info = inspectElement(target);
    showCommentPopup(target, (comment) => {
      hideSelectHighlight();
      safeSendMessage({ type: "COMMENT_ADDED", payload: { element: info, comment } });
    });
    return;
  }

  selectedElement = target;
  hideHoverHighlight();
  showSelectHighlight(target);
  handleElementClick(target);
  const info = inspectElement(target);
  safeSendMessage({ type: "ELEMENT_SELECTED", payload: info });
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
    initCommentPopup();
    setOnDragComplete((element, from, to) => {
      const info = inspectElement(element);
      safeSendMessage({ type: "DRAG_MOVE", payload: { element: info, from, to } });
    });
  } catch (err) {
    console.error("[PrismDesign] Init error:", err);
  }

  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseleave", handleMouseLeave, true);

  initKeyboard({
    plain: { escape: () => exitCurrentMode() },
    ctrlShift: {
      e: () => triggerMode("select"),
      d: () => triggerMode("drag"),
      c: () => triggerMode("comment"),
    },
  });

  if (dragModeActive) document.body.classList.add("prism-design-drag-mode");
  // Keep default arrow cursor in select / comment mode
  if (!dragModeActive) document.body.style.cursor = "default";
  console.log("[PrismDesign] Design mode enabled");
}

function disableDesignMode() {
  if (!designModeActive) return;
  designModeActive = false;
  dragModeActive = false;
  commentModeActive = false;

  document.removeEventListener("mousemove", handleMouseMove, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("mousedown", handleMouseDown, true);
  document.removeEventListener("mouseleave", handleMouseLeave, true);

  hideHoverHighlight();
  hideSelectHighlight();
  hideCommentPopup();
  destroyOverlays();
  destroyEditor();
  destroyKeyboard();

  document.body.classList.remove("prism-design-drag-mode");
  document.body.style.cursor = "";
  selectedElement = null;

  safeSendMessage({ type: "ELEMENT_DESELECTED" });
  console.log("[PrismDesign] Design mode disabled");
}

// ---- Find element by DOM path ----

function findElementByPath(domPath: string): HTMLElement | null {
  try {
    const parts = domPath.split(" > ");
    let current: HTMLElement = document.body;
    for (const part of parts) {
      // Check for child index suffix like "div.cls[2]"
      const idxMatch = part.match(/\[(\d+)\]$/);
      if (idxMatch) {
        const idx = parseInt(idxMatch[1]);
        const children = Array.from(current.children) as HTMLElement[];
        if (idx < 0 || idx >= children.length) return null;
        current = children[idx];
      } else if (part.includes("#")) {
        // ID selector — unique, no ambiguity
        const [, id] = part.split("#");
        const children = Array.from(current.children) as HTMLElement[];
        const match = children.find((c) => c.id === id);
        if (!match) return null;
        current = match;
      } else {
        // Fallback for legacy paths without index
        const children = Array.from(current.children) as HTMLElement[];
        const match = children.find((child) => {
          const tag = child.tagName.toLowerCase();
          if (part.includes(".")) { const [t, ...cls] = part.split("."); return tag === t && cls.every((c) => child.classList.contains(c)); }
          return tag === part;
        });
        if (!match) return null;
        current = match;
      }
    }
    return current;
  } catch { return null; }
}

// ---- Message handler ----

// Only handle downstream messages meant for content script
const HANDLED_TYPES = new Set([
  "DESIGN_MODE_ON", "DESIGN_MODE_OFF", "ENABLE_DRAG_MODE", "DISABLE_DRAG_MODE",
  "GET_DOM_TREE", "GET_PENDING_CHANGES", "CLEAR_CHANGES",
  "HIGHLIGHT_ELEMENT", "UNHIGHLIGHT_ELEMENT", "SELECT_ELEMENT",
  "APPLY_STYLE_PREVIEW", "CLEAR_STYLE_PREVIEW",
  "SHOW_TOOLBAR", "HIDE_TOOLBAR", "TOOLBAR_DISABLE", "PING",
]);

chrome.runtime.onMessage.addListener((message: PrismMessage, _sender, sendResponse) => {
  if (isContextInvalidated()) return false;
  if (!HANDLED_TYPES.has(message.type)) return false; // ignore upstream broadcasts

  switch (message.type) {
    case "DESIGN_MODE_ON": enableDesignMode(); sendResponse({ success: true }); break;
    case "DESIGN_MODE_OFF": disableDesignMode(); sendResponse({ success: true }); break;
    case "ENABLE_DRAG_MODE":
      dragModeActive = true;
      document.body.classList.add("prism-design-drag-mode");
      sendResponse({ success: true });
      break;
    case "DISABLE_DRAG_MODE":
      dragModeActive = false;
      document.body.classList.remove("prism-design-drag-mode");
      sendResponse({ success: true });
      break;
    case "GET_DOM_TREE": {
      resetIdCounter();
      const tree = buildDOMTree(document.body);
      sendResponse(tree);
      safeSendMessage({ type: "DOM_TREE", payload: tree });
      break;
    }
    case "GET_PENDING_CHANGES": {
      const changes = getPendingChanges();
      const moves = getDragMoves();
      const componentInfo = selectedElement ? inspectElement(selectedElement).component : null;
      sendResponse({ changes, moves, component: componentInfo });
      break;
    }
    case "CLEAR_CHANGES": clearChanges(); sendResponse({ success: true }); break;
    case "HIGHLIGHT_ELEMENT": {
      const el = findElementByPath(message.payload.domPath);
      if (el) showHoverHighlight(el);
      sendResponse({ success: !!el });
      break;
    }
    case "UNHIGHLIGHT_ELEMENT": hideHoverHighlight(); sendResponse({ success: true }); break;
    case "SELECT_ELEMENT": {
      const el = findElementByPath(message.payload.domPath);
      if (el) {
        selectedElement = el;
        hideHoverHighlight();
        showSelectHighlight(el);
        handleElementClick(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const info = inspectElement(el);
        safeSendMessage({ type: "ELEMENT_SELECTED", payload: info });
      }
      sendResponse({ success: !!el });
      break;
    }
    case "APPLY_STYLE_PREVIEW": {
      // Prefer the already-selected element to avoid domPath lookup errors
      const el = selectedElement || findElementByPath(message.payload.domPath);
      if (el) {
        const cssProperty = message.payload.property;
        const camelProp = cssProperty.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
        const oldValue = window.getComputedStyle(el).getPropertyValue(cssProperty);
        (el.style as any)[camelProp] = message.payload.value;
        recordStyleChange(el, cssProperty, oldValue, message.payload.value);
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
    case "SHOW_TOOLBAR":
      ensureToolbar();
      sendResponse({ success: true });
      break;
    case "HIDE_TOOLBAR":
      disableDesignMode();
      removeToolbar();
      sendResponse({ success: true });
      break;
    case "TOOLBAR_DISABLE":
      setToolbarDisabled(message.payload.disabled);
      if (message.payload.disabled) {
        // Exit current mode when toolbar is disabled
        disableDesignMode();
        setActiveMode(null);
      }
      sendResponse({ success: true });
      break;
    case "PING": sendResponse({ active: designModeActive }); break;
  }
  return true;
});

// ---- Global keyboard shortcuts (work even when design mode is off) ----

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
  if (isToolbarDisabled()) return;
  const key = e.key.toLowerCase();
  if (key === "e" || key === "d" || key === "c") {
    e.preventDefault();
    const mode = key === "e" ? "select" : key === "d" ? "drag" : "comment";
    triggerMode(mode);
  }
}, true);

// ---- Toolbar (created on demand when side panel opens) ----

let toolbarCreated = false;

function ensureToolbar() {
  if (toolbarCreated) return;
  toolbarCreated = true;
  createToolbar({
    onModeChange(mode) {
      disableDesignMode();
      dragModeActive = false;
      commentModeActive = false;

      if (mode === "select") {
        enableDesignMode();
        safeSendMessage({ type: "OPEN_SIDE_PANEL" });
        safeSendMessage({ type: "OPEN_NAVIGATOR", payload: { mode: "select" } });
      } else if (mode === "drag") {
        dragModeActive = true;
        enableDesignMode();
        safeSendMessage({ type: "OPEN_SIDE_PANEL" });
        safeSendMessage({ type: "OPEN_NAVIGATOR", payload: { mode: "drag" } });
      } else if (mode === "comment") {
        commentModeActive = true;
        enableDesignMode();
        safeSendMessage({ type: "OPEN_SIDE_PANEL" });
        safeSendMessage({ type: "OPEN_PENDING" });
      } else {
        // null — exit current mode
        safeSendMessage({ type: "OPEN_CHAT" });
      }
    },
  });
}

function removeToolbar() {
  destroyToolbar();
  toolbarCreated = false;
}

safeSendMessage({ type: "CONTENT_READY" });
console.log("[PrismDesign] Content script loaded");
