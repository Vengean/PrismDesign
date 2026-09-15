/** Editor — change tracking, text editing, drag & drop reorder (no inline UI panel) */

import type { StyleChange } from "../shared/types.js";

interface DragState {
  element: HTMLElement;
  startY: number;
  siblings: HTMLElement[];
}

const pendingChanges: Map<string, StyleChange> = new Map();
let originalStyles: Map<HTMLElement, Record<string, string>> = new Map();
let originalTexts: Map<HTMLElement, string> = new Map();
let dragState: DragState | null = null;
let dragMoves: Array<{ element: string; from: number; to: number }> = [];
let activeElement: HTMLElement | null = null;
let editorStyleEl: HTMLStyleElement | null = null;
let onDragComplete: ((element: HTMLElement, from: number, to: number) => void) | null = null;

export function setOnDragComplete(cb: (element: HTMLElement, from: number, to: number) => void) {
  onDragComplete = cb;
}

export function initEditor() {
  if (editorStyleEl) return;
  editorStyleEl = document.createElement("style");
  editorStyleEl.id = "prism-studio-editor-style";
  editorStyleEl.textContent = `
    .prism-studio-text-editing {
      outline: 2px dashed #f59e0b !important;
      outline-offset: 2px;
      cursor: text !important;
    }
    .prism-studio-drag-mode,
    .prism-studio-drag-mode * {
      cursor: grab !important;
    }
    .prism-studio-drag-over-top {
      border-top: 3px solid #6366f1 !important;
    }
    .prism-studio-drag-over-left {
      border-left: 3px solid #6366f1 !important;
    }
    .prism-studio-dragging {
      opacity: 0.4 !important;
    }
  `;
  document.head.appendChild(editorStyleEl);
}

export function destroyEditor() {
  editorStyleEl?.remove();
  editorStyleEl = null;
  activeElement = null;
  // Only clean up editing UI state, NOT user's style changes.
  // User modifications (inline styles) are intentionally preserved
  // until synced to the agent.
  originalStyles.forEach((_styles, el) => {
    el.classList.remove("prism-studio-text-editing");
  });
  originalTexts.forEach((text, el) => {
    el.contentEditable = "false";
  });
}

export function handleElementClick(element: HTMLElement) {
  activeElement = element;
  if (!originalStyles.has(element)) {
    const computed = window.getComputedStyle(element);
    originalStyles.set(element, {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      lineHeight: computed.lineHeight,
      padding: computed.padding,
      margin: computed.margin,
      borderRadius: computed.borderRadius,
      gap: computed.gap,
    });
  }
}

const DRAG_OVER_CLASSES = ["prism-studio-drag-over-top", "prism-studio-drag-over-left"];

function removeDragOverClass(el: HTMLElement) {
  el.classList.remove(...DRAG_OVER_CLASSES);
}

function isHorizontalLayout(parent: HTMLElement): boolean {
  const style = window.getComputedStyle(parent);
  const display = style.display;
  if (display === "flex" || display === "inline-flex") {
    const dir = style.flexDirection;
    return dir === "row" || dir === "row-reverse";
  }
  if (display === "grid" || display === "inline-grid") {
    // If grid has multiple columns, treat as horizontal
    const cols = style.gridTemplateColumns;
    return cols !== "none" && cols.split(/\s+/).length > 1;
  }
  return false;
}

export function handleElementMouseDown(e: MouseEvent, element: HTMLElement) {
  e.preventDefault();
  const parent = element.parentElement;
  if (!parent) return;

  const siblings = Array.from(parent.children).filter(
    (child) => !child.id?.startsWith("prism-studio-")
  ) as HTMLElement[];

  const fromIndex = siblings.indexOf(element);
  element.classList.add("prism-studio-dragging");

  const horizontal = isHorizontalLayout(parent);
  const overClass = horizontal ? "prism-studio-drag-over-left" : "prism-studio-drag-over-top";

  dragState = { element, startY: e.clientY, siblings };

  const onMouseMove = (ev: MouseEvent) => {
    if (!dragState) return;
    const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement;
    if (!hoverEl || hoverEl === element) return;
    const sibling = dragState.siblings.find((s) => s === hoverEl || s.contains(hoverEl));
    if (sibling && sibling !== element) {
      dragState.siblings.forEach((s) => removeDragOverClass(s));
      sibling.classList.add(overClass);
    }
  };

  const onMouseUp = (ev: MouseEvent) => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    if (!dragState) return;
    element.classList.remove("prism-studio-dragging");
    dragState.siblings.forEach((s) => removeDragOverClass(s));
    const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement;
    const target = dragState.siblings.find((s) => s === hoverEl || s.contains(hoverEl));
    if (target && target !== element) {
      const toIndex = dragState.siblings.indexOf(target);
      if (toIndex > fromIndex) parent.insertBefore(element, target.nextSibling);
      else parent.insertBefore(element, target);
      dragMoves.push({ element: getDomPath(element), from: fromIndex, to: toIndex });
      try { onDragComplete?.(element, fromIndex, toIndex); } catch (e) { console.error("[Prism Studio] drag callback error:", e); }
    }
    dragState = null;
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

function getDomPath(element: HTMLElement): string {
  const parts: string[] = [];
  let el: HTMLElement | null = element;
  while (el && el !== document.body) {
    let selector = el.tagName.toLowerCase();
    if (el.id && !el.id.startsWith("prism-studio-")) {
      selector += `#${el.id}`;
    } else {
      if (el.className && typeof el.className === "string") {
        const cls = el.className.split(/\s+/).filter((c) => !c.startsWith("prism-studio-")).slice(0, 2).join(".");
        if (cls) selector += `.${cls}`;
      }
      const parent = el.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(el);
        selector += `[${idx}]`;
      }
    }
    parts.unshift(selector);
    el = el.parentElement;
  }
  return parts.join(" > ");
}

export function recordStyleChange(
  element: HTMLElement,
  property: string,
  oldValue: string,
  newValue: string,
) {
  const path = getDomPath(element);
  const key = `${path}::${property}`;
  const existing = pendingChanges.get(key);
  pendingChanges.set(key, {
    selector: path,
    property,
    oldValue: existing ? existing.oldValue : oldValue, // keep original old value
    newValue,
    textContent: (element.textContent || "").trim().slice(0, 60),
  });
}

export function getActiveElement() { return activeElement; }
export function getPendingChanges(): StyleChange[] { return Array.from(pendingChanges.values()); }
export function getDragMoves() { return [...dragMoves]; }
export function clearChanges() {
  pendingChanges.clear();
  originalStyles = new Map();
  originalTexts = new Map();
  dragMoves = [];
}
