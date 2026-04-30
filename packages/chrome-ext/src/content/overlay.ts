/** Visual overlay for element highlighting and selection */

let hoverOverlay: HTMLDivElement | null = null;
let labelEl: HTMLDivElement | null = null;
let selectTarget: HTMLElement | null = null;
let hoverTarget: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;
let animFrame: number | null = null;

const SELECT_OUTLINE = "2px solid #6366f1";
const SELECT_OUTLINE_OFFSET = "-2px";
const SELECT_CLASS = "prism-design-selected";

/** Inject a style rule for the selected-element outline (avoids inline style conflicts) */
let styleEl: HTMLStyleElement | null = null;
function ensureStyle() {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.id = "prism-design-overlay-style";
  styleEl.textContent = `
    .${SELECT_CLASS} {
      outline: ${SELECT_OUTLINE} !important;
      outline-offset: ${SELECT_OUTLINE_OFFSET} !important;
    }
  `;
  document.head.appendChild(styleEl);
}

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

/** Sync hover overlay position to its target element */
function syncHoverPosition() {
  if (!hoverOverlay || !hoverTarget) return;
  const rect = hoverTarget.getBoundingClientRect();
  Object.assign(hoverOverlay.style, {
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left + window.scrollX}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  if (labelEl && labelEl.style.display !== "none") {
    Object.assign(labelEl.style, {
      top: `${rect.top + window.scrollY - 20}px`,
      left: `${rect.left + window.scrollX}px`,
    });
  }
}

/** Start observing the hover target for size/position changes */
function observeHover(element: HTMLElement) {
  stopObserving();
  hoverTarget = element;

  resizeObserver = new ResizeObserver(() => syncHoverPosition());
  resizeObserver.observe(element);

  // Also track scroll & animation frames for position changes
  const tick = () => {
    if (!hoverTarget) return;
    syncHoverPosition();
    animFrame = requestAnimationFrame(tick);
  };
  animFrame = requestAnimationFrame(tick);
}

function stopObserving() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (animFrame !== null) {
    cancelAnimationFrame(animFrame);
    animFrame = null;
  }
  hoverTarget = null;
}

// ── public API ──

export function initOverlays() {
  document.getElementById("prism-design-hover")?.remove();
  document.getElementById("prism-design-label")?.remove();
  styleEl?.remove();
  styleEl = null;

  ensureStyle();
  hoverOverlay = createOverlay("prism-design-hover", "rgba(99, 102, 241, 0.6)");
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

  observeHover(element);
}

export function hideHoverHighlight() {
  if (hoverOverlay) hoverOverlay.style.display = "none";
  if (labelEl) labelEl.style.display = "none";
  stopObserving();
}

export function showSelectHighlight(element: HTMLElement) {
  hideSelectHighlight();
  ensureStyle();
  selectTarget = element;
  element.classList.add(SELECT_CLASS);
}

export function hideSelectHighlight() {
  if (selectTarget) {
    selectTarget.classList.remove(SELECT_CLASS);
    selectTarget = null;
  }
}

export function destroyOverlays() {
  hideSelectHighlight();
  stopObserving();
  [hoverOverlay, labelEl, styleEl].forEach((el) => el?.remove());
  hoverOverlay = null;
  labelEl = null;
  styleEl = null;
}
