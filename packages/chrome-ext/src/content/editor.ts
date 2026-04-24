/** Inline visual editor — direct manipulation on the page */

import type { StyleChange } from "../shared/types.js";

interface DragState {
  element: HTMLElement;
  placeholder: HTMLElement;
  startY: number;
  siblings: HTMLElement[];
}

// All changes made by the designer, collected on save
const pendingChanges: Map<string, StyleChange> = new Map();
let originalStyles: Map<HTMLElement, Record<string, string>> = new Map();
let originalTexts: Map<HTMLElement, string> = new Map();
let dragState: DragState | null = null;
let dragMoves: Array<{ element: string; from: number; to: number }> = [];

// ---- Floating toolbar ----

let toolbar: HTMLDivElement | null = null;
let activeElement: HTMLElement | null = null;

function createToolbar(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "prism-design-toolbar";
  el.innerHTML = `
    <div class="pd-toolbar-row">
      <label>颜色</label>
      <input type="color" data-prop="color" />
    </div>
    <div class="pd-toolbar-row">
      <label>背景</label>
      <input type="color" data-prop="backgroundColor" />
    </div>
    <div class="pd-toolbar-row">
      <label>字号</label>
      <input type="range" data-prop="fontSize" min="10" max="72" step="1" />
      <span class="pd-value" data-for="fontSize"></span>
    </div>
    <div class="pd-toolbar-row">
      <label>字重</label>
      <select data-prop="fontWeight">
        <option value="300">Light</option>
        <option value="400">Normal</option>
        <option value="500">Medium</option>
        <option value="600">SemiBold</option>
        <option value="700">Bold</option>
        <option value="800">ExtraBold</option>
      </select>
    </div>
    <div class="pd-toolbar-row">
      <label>行高</label>
      <input type="range" data-prop="lineHeight" min="0.8" max="3" step="0.1" />
      <span class="pd-value" data-for="lineHeight"></span>
    </div>
    <div class="pd-toolbar-row">
      <label>内边距</label>
      <input type="range" data-prop="padding" min="0" max="80" step="1" />
      <span class="pd-value" data-for="padding"></span>
    </div>
    <div class="pd-toolbar-row">
      <label>外边距</label>
      <input type="range" data-prop="margin" min="0" max="80" step="1" />
      <span class="pd-value" data-for="margin"></span>
    </div>
    <div class="pd-toolbar-row">
      <label>圆角</label>
      <input type="range" data-prop="borderRadius" min="0" max="50" step="1" />
      <span class="pd-value" data-for="borderRadius"></span>
    </div>
    <div class="pd-toolbar-row">
      <label>间距</label>
      <input type="range" data-prop="gap" min="0" max="60" step="1" />
      <span class="pd-value" data-for="gap"></span>
    </div>
    <div class="pd-toolbar-row pd-toolbar-actions">
      <button class="pd-btn pd-btn-drag" title="拖拽排序模式">↕ 拖拽</button>
      <button class="pd-btn pd-btn-edit" title="编辑文字">✏️ 文字</button>
    </div>
  `;

  const style = document.createElement("style");
  style.id = "prism-design-toolbar-style";
  style.textContent = `
    #prism-design-toolbar {
      position: fixed;
      z-index: 2147483647;
      background: #1a1a2e;
      color: #e5e7eb;
      border-radius: 10px;
      padding: 12px;
      width: 220px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      display: none;
      user-select: none;
    }
    #prism-design-toolbar .pd-toolbar-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    #prism-design-toolbar label {
      width: 42px;
      flex-shrink: 0;
      font-size: 11px;
      color: #9ca3af;
      text-align: right;
    }
    #prism-design-toolbar input[type="color"] {
      width: 28px;
      height: 24px;
      border: 1px solid #374151;
      border-radius: 4px;
      cursor: pointer;
      padding: 1px;
      background: none;
    }
    #prism-design-toolbar input[type="range"] {
      flex: 1;
      height: 4px;
      accent-color: #6366f1;
      cursor: pointer;
    }
    #prism-design-toolbar select {
      flex: 1;
      background: #374151;
      color: #e5e7eb;
      border: 1px solid #4b5563;
      border-radius: 4px;
      padding: 2px 4px;
      font-size: 11px;
    }
    #prism-design-toolbar .pd-value {
      width: 32px;
      font-size: 10px;
      color: #6366f1;
      text-align: right;
    }
    #prism-design-toolbar .pd-toolbar-actions {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #374151;
      justify-content: center;
      gap: 8px;
    }
    #prism-design-toolbar .pd-btn {
      background: #374151;
      color: #e5e7eb;
      border: 1px solid #4b5563;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }
    #prism-design-toolbar .pd-btn:hover {
      background: #6366f1;
      border-color: #6366f1;
    }
    #prism-design-toolbar .pd-btn.active {
      background: #6366f1;
      border-color: #818cf8;
    }

    .prism-design-editable-outline {
      outline: 2px solid #6366f1 !important;
      outline-offset: 2px;
    }
    .prism-design-text-editing {
      outline: 2px dashed #f59e0b !important;
      outline-offset: 2px;
      cursor: text !important;
    }
    .prism-design-drag-over {
      border-top: 3px solid #6366f1 !important;
    }
    .prism-design-dragging {
      opacity: 0.4 !important;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(el);

  // Bind input events
  el.querySelectorAll("input, select").forEach((input) => {
    const prop = (input as HTMLElement).dataset.prop;
    if (!prop) return;

    const event = input.type === "color" ? "input" : "change";
    input.addEventListener(event, () => {
      if (!activeElement) return;
      applyStyleChange(activeElement, prop, (input as HTMLInputElement).value);
    });

    // Live preview for range inputs
    if (input.type === "range") {
      input.addEventListener("input", () => {
        if (!activeElement) return;
        applyStyleChange(activeElement, prop, (input as HTMLInputElement).value);
      });
    }
  });

  // Drag mode button
  el.querySelector(".pd-btn-drag")!.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.classList.toggle("active");
    toggleDragMode(btn.classList.contains("active"));
  });

  // Text edit button
  el.querySelector(".pd-btn-edit")!.addEventListener("click", () => {
    if (!activeElement) return;
    enableTextEditing(activeElement);
  });

  return el;
}

function showToolbar(element: HTMLElement) {
  if (!toolbar) return;

  activeElement = element;
  element.classList.add("prism-design-editable-outline");

  // Snapshot original styles
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

  // Fill current values
  const computed = window.getComputedStyle(element);

  const colorInput = toolbar.querySelector('[data-prop="color"]') as HTMLInputElement;
  colorInput.value = rgbToHex(computed.color);

  const bgInput = toolbar.querySelector('[data-prop="backgroundColor"]') as HTMLInputElement;
  bgInput.value = rgbToHex(computed.backgroundColor);

  const fontSizeInput = toolbar.querySelector('[data-prop="fontSize"]') as HTMLInputElement;
  fontSizeInput.value = String(parseFloat(computed.fontSize));
  updateValueLabel("fontSize", parseFloat(computed.fontSize) + "px");

  const fontWeightSelect = toolbar.querySelector('[data-prop="fontWeight"]') as HTMLSelectElement;
  fontWeightSelect.value = String(Math.round(parseFloat(computed.fontWeight) / 100) * 100);

  const lineHeightInput = toolbar.querySelector('[data-prop="lineHeight"]') as HTMLInputElement;
  const lh = parseFloat(computed.lineHeight) / parseFloat(computed.fontSize);
  lineHeightInput.value = String(Math.round(lh * 10) / 10);
  updateValueLabel("lineHeight", (Math.round(lh * 10) / 10).toString());

  const paddingInput = toolbar.querySelector('[data-prop="padding"]') as HTMLInputElement;
  paddingInput.value = String(parseFloat(computed.padding) || 0);
  updateValueLabel("padding", (parseFloat(computed.padding) || 0) + "px");

  const marginInput = toolbar.querySelector('[data-prop="margin"]') as HTMLInputElement;
  marginInput.value = String(parseFloat(computed.margin) || 0);
  updateValueLabel("margin", (parseFloat(computed.margin) || 0) + "px");

  const radiusInput = toolbar.querySelector('[data-prop="borderRadius"]') as HTMLInputElement;
  radiusInput.value = String(parseFloat(computed.borderRadius) || 0);
  updateValueLabel("borderRadius", (parseFloat(computed.borderRadius) || 0) + "px");

  const gapInput = toolbar.querySelector('[data-prop="gap"]') as HTMLInputElement;
  gapInput.value = String(parseFloat(computed.gap) || 0);
  updateValueLabel("gap", (parseFloat(computed.gap) || 0) + "px");

  // Position toolbar
  const rect = element.getBoundingClientRect();
  let left = rect.right + 12;
  let top = rect.top;

  if (left + 230 > window.innerWidth) {
    left = rect.left - 232;
  }
  if (left < 0) left = 8;
  if (top + 400 > window.innerHeight) {
    top = window.innerHeight - 400;
  }
  if (top < 0) top = 8;

  toolbar.style.left = left + "px";
  toolbar.style.top = top + "px";
  toolbar.style.display = "block";
}

function hideToolbar() {
  if (toolbar) toolbar.style.display = "none";
  if (activeElement) {
    activeElement.classList.remove("prism-design-editable-outline");
  }
  activeElement = null;
}

function updateValueLabel(prop: string, value: string) {
  if (!toolbar) return;
  const label = toolbar.querySelector(`.pd-value[data-for="${prop}"]`);
  if (label) label.textContent = value;
}

// ---- Style manipulation ----

function applyStyleChange(element: HTMLElement, prop: string, rawValue: string) {
  const unitProps: Record<string, string> = {
    fontSize: "px",
    padding: "px",
    margin: "px",
    borderRadius: "px",
    gap: "px",
  };

  let value = rawValue;
  if (unitProps[prop]) {
    value = parseFloat(rawValue) + unitProps[prop];
  }
  if (prop === "lineHeight") {
    value = rawValue; // unitless
  }

  // Apply directly to DOM
  (element.style as any)[prop] = value;

  // Update value label
  updateValueLabel(prop, value);

  // Track change
  const original = originalStyles.get(element);
  const cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
  const domPath = getDomPath(element);
  const key = `${domPath}::${cssProp}`;

  pendingChanges.set(key, {
    selector: domPath,
    property: cssProp,
    oldValue: original ? (original as any)[prop] || "" : "",
    newValue: value,
  });
}

// ---- Text editing ----

function enableTextEditing(element: HTMLElement) {
  // Snapshot original text
  if (!originalTexts.has(element)) {
    originalTexts.set(element, element.textContent || "");
  }

  element.classList.add("prism-design-text-editing");
  element.contentEditable = "true";
  element.focus();

  const handler = () => {
    element.contentEditable = "false";
    element.classList.remove("prism-design-text-editing");
    element.removeEventListener("blur", handler);

    // Track text change
    const oldText = originalTexts.get(element) || "";
    const newText = element.textContent || "";
    if (oldText !== newText) {
      const domPath = getDomPath(element);
      pendingChanges.set(`${domPath}::textContent`, {
        selector: domPath,
        property: "textContent",
        oldValue: oldText,
        newValue: newText,
      });
    }
  };

  element.addEventListener("blur", handler);
}

// ---- Drag & drop reorder ----

let dragModeEnabled = false;

function toggleDragMode(enabled: boolean) {
  dragModeEnabled = enabled;
  document.body.style.cursor = enabled ? "grab" : "";
}

function startDrag(e: MouseEvent, element: HTMLElement) {
  if (!dragModeEnabled) return;
  e.preventDefault();

  const parent = element.parentElement;
  if (!parent) return;

  const siblings = Array.from(parent.children).filter(
    (child) => !child.id?.startsWith("prism-design-")
  ) as HTMLElement[];

  const fromIndex = siblings.indexOf(element);
  element.classList.add("prism-design-dragging");

  dragState = {
    element,
    placeholder: element,
    startY: e.clientY,
    siblings,
  };

  const onMouseMove = (ev: MouseEvent) => {
    if (!dragState) return;
    const hoverEl = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement;
    if (!hoverEl || hoverEl === element) return;

    const sibling = dragState.siblings.find(
      (s) => s === hoverEl || s.contains(hoverEl)
    );
    if (sibling && sibling !== element) {
      // Clear previous markers
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
    const target = dragState.siblings.find(
      (s) => s === hoverEl || s.contains(hoverEl)
    );

    if (target && target !== element) {
      const toIndex = dragState.siblings.indexOf(target);
      // Perform the DOM move
      if (toIndex > fromIndex) {
        parent.insertBefore(element, target.nextSibling);
      } else {
        parent.insertBefore(element, target);
      }
      dragMoves.push({
        element: getDomPath(element),
        from: fromIndex,
        to: toIndex,
      });
    }

    dragState = null;
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
}

// ---- DOM path ----

function getDomPath(element: HTMLElement): string {
  const parts: string[] = [];
  let el: HTMLElement | null = element;
  while (el && el !== document.body) {
    let selector = el.tagName.toLowerCase();
    if (el.id && !el.id.startsWith("prism-design-")) {
      selector += `#${el.id}`;
    } else if (el.className && typeof el.className === "string") {
      const cls = el.className
        .split(/\s+/)
        .filter((c) => !c.startsWith("prism-design-"))
        .slice(0, 2)
        .join(".");
      if (cls) selector += `.${cls}`;
    }
    parts.unshift(selector);
    el = el.parentElement;
  }
  return parts.join(" > ");
}

// ---- Helpers ----

function rgbToHex(rgb: string): string {
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return "#000000";
  return (
    "#" +
    match
      .slice(0, 3)
      .map((n) => parseInt(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

// ---- Public API ----

export function initEditor() {
  toolbar = createToolbar();
}

export function destroyEditor() {
  toolbar?.remove();
  document.getElementById("prism-design-toolbar-style")?.remove();
  toolbar = null;
  activeElement = null;
  dragModeEnabled = false;
  // Restore original styles
  originalStyles.forEach((styles, el) => {
    Object.assign(el.style, styles);
    el.classList.remove("prism-design-editable-outline", "prism-design-text-editing");
  });
  // Restore original texts
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
  hideToolbar();
  if (dragModeEnabled) {
    startDrag({ clientX: 0, clientY: 0, preventDefault: () => {} } as MouseEvent, element);
  } else {
    showToolbar(element);
  }
}

export function handleElementMouseDown(e: MouseEvent, element: HTMLElement) {
  if (dragModeEnabled) {
    startDrag(e, element);
  }
}

export function getActiveElement() {
  return activeElement;
}

export function getPendingChanges(): StyleChange[] {
  return Array.from(pendingChanges.values());
}

export function getDragMoves() {
  return [...dragMoves];
}

export function clearChanges() {
  pendingChanges.clear();
  originalStyles = new Map();
  originalTexts = new Map();
  dragMoves = [];
}
