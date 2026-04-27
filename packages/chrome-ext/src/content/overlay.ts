/** Visual overlay for element highlighting and selection */

let hoverOverlay: HTMLDivElement | null = null;
let selectOverlay: HTMLDivElement | null = null;
let labelEl: HTMLDivElement | null = null;

function createOverlay(id: string, borderColor: string): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "2147483646",
    border: `2px solid ${borderColor}`,
    borderRadius: "3px",
    transition: "all 0.1s ease",
    display: "none",
  });
  document.body.appendChild(el);
  return el;
}

function createLabel(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "prism-design-label";
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "2147483647",
    background: "#6366f1",
    color: "#fff",
    fontSize: "11px",
    fontFamily: "monospace",
    padding: "2px 6px",
    borderRadius: "3px",
    whiteSpace: "nowrap",
    display: "none",
  });
  document.body.appendChild(el);
  return el;
}

export function initOverlays() {
  document.getElementById("prism-design-hover")?.remove();
  document.getElementById("prism-design-select")?.remove();
  document.getElementById("prism-design-label")?.remove();

  hoverOverlay = createOverlay("prism-design-hover", "rgba(99, 102, 241, 0.6)");
  selectOverlay = createOverlay("prism-design-select", "#6366f1");
  labelEl = createLabel();
}

export function showHoverHighlight(element: HTMLElement, componentName?: string) {
  if (!hoverOverlay || !labelEl) return;

  const rect = element.getBoundingClientRect();
  Object.assign(hoverOverlay.style, {
    display: "block",
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    backgroundColor: "rgba(99, 102, 241, 0.08)",
  });

  const label = componentName || element.tagName.toLowerCase();
  labelEl.textContent = label;
  Object.assign(labelEl.style, {
    display: "block",
    top: `${rect.top + window.scrollY - 20}px`,
    left: `${rect.left + window.scrollX}px`,
  });
}

export function hideHoverHighlight() {
  if (hoverOverlay) hoverOverlay.style.display = "none";
  if (labelEl) labelEl.style.display = "none";
}

export function showSelectHighlight(element: HTMLElement) {
  if (!selectOverlay) return;

  const rect = element.getBoundingClientRect();
  Object.assign(selectOverlay.style, {
    display: "block",
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    backgroundColor: "rgba(99, 102, 241, 0.05)",
  });
}

export function hideSelectHighlight() {
  if (selectOverlay) selectOverlay.style.display = "none";
}

export function destroyOverlays() {
  [hoverOverlay, selectOverlay, labelEl].forEach((el) => el?.remove());
  hoverOverlay = null;
  selectOverlay = null;
  labelEl = null;
}
