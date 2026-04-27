import { inspectElement, getComponentChain } from "./inspector.js";
import {
  initOverlays, showHoverHighlight, hideHoverHighlight,
  showSelectHighlight, hideSelectHighlight, destroyOverlays,
} from "./overlay.js";
import {
  initEditor, destroyEditor, handleElementClick, handleElementMouseDown,
  getPendingChanges, getDragMoves, clearChanges, getActiveElement,
} from "./editor.js";
import { buildDOMTree, resetIdCounter } from "./dom-tree.js";
import { initKeyboard, destroyKeyboard } from "./keyboard.js";
import { createToolbar, destroyToolbar, isToolbarElement, setActiveMode } from "./toolbar.js";
import { initCommentPopup, showCommentPopup, hideCommentPopup, destroyCommentPopup, isCommentPopupElement } from "./comment-popup.js";
import { safeSendMessage, isContextInvalidated, onContextInvalidated } from "./runtime.js";
import type { PrismMessage } from "../shared/types.js";

let designModeActive = false;
let dragModeActive = false;
let commentModeActive = false;
let selectedElement: HTMLElement | null = null;

/** Exit all modes → back to chat panel */
function exitAllModes() {
  disableDesignMode();
  setActiveMode(null);
  safeSendMessage({ type: "OPEN_CHAT" });
}

onContextInvalidated(() => {
  disableDesignMode();
  destroyCommentPopup();
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
  } catch (err) {
    console.error("[PrismDesign] Init error:", err);
  }

  document.addEventListener("mousemove", handleMouseMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("mousedown", handleMouseDown, true);
  document.addEventListener("mouseleave", handleMouseLeave, true);

  initKeyboard({ plain: { escape: () => exitAllModes() } });

  if (dragModeActive) document.body.classList.add("prism-design-drag-mode");
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
      const children = Array.from(current.children) as HTMLElement[];
      const match = children.find((child) => {
        const tag = child.tagName.toLowerCase();
        if (part.includes("#")) { const [t, id] = part.split("#"); return tag === t && child.id === id; }
        if (part.includes(".")) { const [t, ...cls] = part.split("."); return tag === t && cls.every((c) => child.classList.contains(c)); }
        return tag === part;
      });
      if (!match) return null;
      current = match;
    }
    return current;
  } catch { return null; }
}

// ---- Message handler ----

chrome.runtime.onMessage.addListener((message: PrismMessage, _sender, sendResponse) => {
  if (isContextInvalidated()) return;
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
    case "PING": sendResponse({ active: designModeActive }); break;
    default: sendResponse({ success: false });
  }
  return true;
});

// ---- Toolbar (always visible) ----

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
      safeSendMessage({ type: "OPEN_CHAT" });
    } else {
      // null — exit all, back to chat
      safeSendMessage({ type: "OPEN_CHAT" });
    }
  },
});

safeSendMessage({ type: "CONTENT_READY" });
console.log("[PrismDesign] Content script loaded");
