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

export function initEditor() {
  if (editorStyleEl) return;
  editorStyleEl = document.createElement("style");
  editorStyleEl.id = "prism-design-editor-style";
  editorStyleEl.textContent = `
    .prism-design-text-editing {
      outline: 2px dashed #f59e0b !important;
      outline-offset: 2px;
      cursor: text !important;
    }
    .prism-design-drag-mode,
    .prism-design-drag-mode * {
      cursor: grab !important;
    }
    .prism-design-drag-over {
      border-top: 3px solid #6366f1 !important;
    }
    .prism-design-dragging {
      opacity: 0.4 !important;
    }
  `;
  document.head.appendChild(editorStyleEl);
}

export function destroyEditor() {
  editorStyleEl?.remove();
  editorStyleEl = null;
  activeElement = null;
  originalStyles.forEach((styles, el) => {
    Object.assign(el.style, styles);
    el.classList.remove("prism-design-text-editing");
  });
  originalTexts.forEach((text, el) => {
    el.textContent = text;
    el.contentEditable = "false";
  });
  pendingChanges.clear();
  originalStyles = new Map();
  originalTexts = new Map();
  dragMoves = [];
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

export function handleElementMouseDown(e: MouseEvent, element: HTMLElement) {
  e.preventDefault();
  const parent = element.parentElement;
  if (!parent) return;

  const siblings = Array.from(parent.children).filter(
    (child) => !child.id?.startsWith("prism-design-")
  ) as HTMLElement[];

  const fromIndex = siblings.indexOf(element);
  element.classList.add("prism-design-dragging");

  dragState = { element, startY: e.clientY, siblings };

  const onMouseMove = (ev: MouseEvent) => {
    if (!dragState) return;
    const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement;
    if (!hoverEl || hoverEl === element) return;
    const sibling = dragState.siblings.find((s) => s === hoverEl || s.contains(hoverEl));
    if (sibling && sibling !== element) {
      dragState.siblings.forEach((s) => s.classList.remove("prism-design-drag-over"));
      sibling.classList.add("prism-design-drag-over");
    }
  };

  const onMouseUp = (ev: MouseEvent) => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    if (!dragState) return;
    element.classList.remove("prism-design-dragging");
    dragState.siblings.forEach((s) => s.classList.remove("prism-design-drag-over"));
    const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement;
    const target = dragState.siblings.find((s) => s === hoverEl || s.contains(hoverEl));
    if (target && target !== element) {
      const toIndex = dragState.siblings.indexOf(target);
      if (toIndex > fromIndex) parent.insertBefore(element, target.nextSibling);
      else parent.insertBefore(element, target);
      dragMoves.push({ element: getDomPath(element), from: fromIndex, to: toIndex });
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
    if (el.id && !el.id.startsWith("prism-design-")) selector += `#${el.id}`;
    else if (el.className && typeof el.className === "string") {
      const cls = el.className.split(/\s+/).filter((c) => !c.startsWith("prism-design-")).slice(0, 2).join(".");
      if (cls) selector += `.${cls}`;
    }
    parts.unshift(selector);
    el = el.parentElement;
  }
  return parts.join(" > ");
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
