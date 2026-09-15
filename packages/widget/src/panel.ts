import { ICON_CLOSE, ICON_PRISM, ICON_UNLINK } from "./icons.js";
import { t } from "./i18n.js";

const STORAGE_KEY_VISIBLE = "prism-panel-visible";

export interface PanelAPI {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  getBody(): HTMLElement;
  onVisibilityChange(cb: (visible: boolean) => void): void;
  setDisconnectHandler(handler: (() => void) | null): void;
  destroy(): void;
}

function isMobile(): boolean {
  return window.matchMedia("(max-width: 639px)").matches;
}

export function createPanel(shadowRoot: ShadowRoot, position: "bottom-right" | "bottom-left" = "bottom-right"): PanelAPI {
  const posClass = position === "bottom-left" ? "bottom-left" : "";

  // ── Container ──
  const container = document.createElement("div");
  container.className = `prism-container collapsed ${posClass}`.trim();

  // ── Desktop FAB (inside container, used for morph) ──
  const fab = document.createElement("button");
  fab.className = "prism-fab";
  fab.innerHTML = ICON_PRISM;
  fab.onclick = () => show();
  container.appendChild(fab);

  // ── Mobile FAB (separate element, always in shadow root) ──
  const mobileFab = document.createElement("button");
  mobileFab.className = `prism-mobile-fab ${posClass}`.trim();
  mobileFab.innerHTML = ICON_PRISM;
  mobileFab.onclick = () => show();
  shadowRoot.appendChild(mobileFab);

  // ── Panel inner ──
  const panelInner = document.createElement("div");
  panelInner.className = "prism-panel-inner";

  // Mobile drag handle
  const dragHandle = document.createElement("div");
  dragHandle.className = "prism-drag-handle";
  panelInner.appendChild(dragHandle);

  // Header
  const header = document.createElement("div");
  header.className = "prism-header";

  const titleIcon = document.createElement("span");
  titleIcon.className = "title-icon";
  titleIcon.innerHTML = ICON_PRISM;
  header.appendChild(titleIcon);

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = t("panel.title");
  header.appendChild(title);

  const disconnectBtn = document.createElement("button");
  disconnectBtn.className = "prism-disconnect-btn";
  disconnectBtn.innerHTML = ICON_UNLINK;
  disconnectBtn.title = t("connect.disconnect");
  disconnectBtn.style.display = "none";
  header.appendChild(disconnectBtn);

  const closeBtn = document.createElement("button");
  closeBtn.className = "prism-close-btn";
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.onclick = () => hide();
  header.appendChild(closeBtn);

  panelInner.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;";
  panelInner.appendChild(body);

  container.appendChild(panelInner);
  shadowRoot.appendChild(container);

  // ── State ──
  let visible = false;
  const visibilityCbs: Array<(v: boolean) => void> = [];

  function applyMobileClass() {
    if (isMobile()) {
      container.classList.add("mobile-sheet");
    } else {
      container.classList.remove("mobile-sheet");
    }
  }

  // Listen for viewport changes
  const mq = window.matchMedia("(max-width: 639px)");
  mq.addEventListener("change", applyMobileClass);
  applyMobileClass();

  function show() {
    container.classList.remove("collapsed");
    container.classList.add("expanded");
    mobileFab.classList.add("hidden");
    visible = true;
    try { localStorage.setItem(STORAGE_KEY_VISIBLE, "1"); } catch {}
    visibilityCbs.forEach((cb) => cb(true));
  }

  function hide() {
    container.classList.remove("expanded");
    container.classList.add("collapsed");
    mobileFab.classList.remove("hidden");
    visible = false;
    try { localStorage.setItem(STORAGE_KEY_VISIBLE, "0"); } catch {}
    visibilityCbs.forEach((cb) => cb(false));
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  // Restore from previous session (skip animation on restore)
  try {
    if (localStorage.getItem(STORAGE_KEY_VISIBLE) === "1") {
      container.classList.add("no-transition");
      show();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.classList.remove("no-transition");
        });
      });
    }
  } catch {}

  return {
    show,
    hide,
    toggle,
    isVisible: () => visible,
    getBody: () => body,
    onVisibilityChange: (cb) => visibilityCbs.push(cb),
    setDisconnectHandler(handler) {
      if (handler) {
        disconnectBtn.style.display = "flex";
        disconnectBtn.onclick = handler;
      } else {
        disconnectBtn.style.display = "none";
        disconnectBtn.onclick = null;
      }
    },
    destroy: () => {
      container.remove();
      mobileFab.remove();
      mq.removeEventListener("change", applyMobileClass);
    },
  };
}
