import { ICON_CLOSE, ICON_PRISM } from "./icons.js";
import { t } from "./i18n.js";

const MOBILE_QUERY = "(max-width: 767px), (pointer: coarse) and (max-device-width: 767px)";
const STORAGE_KEY_VISIBLE = "prism-panel-visible";

export interface PanelAPI {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  getBody(): HTMLElement;
  onVisibilityChange(cb: (visible: boolean) => void): void;
  destroy(): void;
}

function isMobile(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function createPanel(shadowRoot: ShadowRoot, position: "bottom-right" | "bottom-left" = "bottom-right", onOpenRequest?: () => boolean, restoreVisibility = true): PanelAPI {
  const posClass = position === "bottom-left" ? "bottom-left" : "";

  const backdrop = document.createElement("div");
  backdrop.className = "prism-backdrop";
  backdrop.onclick = () => hide();
  backdrop.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
  shadowRoot.appendChild(backdrop);

  // ── Container ──
  const container = document.createElement("div");
  container.className = `prism-container collapsed ${posClass}`.trim();

  // ── Desktop FAB (inside container, used for morph) ──
  const fab = document.createElement("button");
  fab.className = "prism-fab";
  fab.innerHTML = ICON_PRISM;
  fab.onclick = () => {if(!onOpenRequest?.())show();};
  container.appendChild(fab);

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

  function updateViewport() {
    const viewport = window.visualViewport;
    container.style.setProperty("--prism-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    const host = shadowRoot.host as HTMLElement | undefined;
    host?.style.setProperty("--prism-viewport-width", `${viewport?.width ?? window.innerWidth}px`);
    host?.style.setProperty("--prism-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    host?.style.setProperty("--prism-viewport-left", `${viewport?.offsetLeft ?? 0}px`);
    host?.style.setProperty("--prism-viewport-top", `${viewport?.offsetTop ?? 0}px`);
  }
  const onKeyDown = (event: KeyboardEvent) => { if (visible && event.key === "Escape") hide(); };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("scroll", updateViewport);
  updateViewport();

  function applyMobileClass() {
    if (isMobile()) {
      container.classList.add("mobile-sheet");
      shadowRoot.host?.classList.add("prism-mobile");
    } else {
      container.classList.remove("mobile-sheet");
      shadowRoot.host?.classList.remove("prism-mobile");
    }
  }

  // Listen for viewport changes
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", applyMobileClass);
  applyMobileClass();

  function show() {
    container.classList.remove("collapsed");
    container.classList.add("expanded");
    backdrop.classList.add("open");
    updateViewport();
    visible = true;
    try { localStorage.setItem(STORAGE_KEY_VISIBLE, "1"); } catch {}
    visibilityCbs.forEach((cb) => cb(true));
  }

  function hide() {
    container.classList.remove("expanded");
    container.classList.add("collapsed");
    backdrop.classList.remove("open");
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
    if (restoreVisibility && localStorage.getItem(STORAGE_KEY_VISIBLE) === "1") {
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
    destroy: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      backdrop.remove();
      container.remove();
      mq.removeEventListener("change", applyMobileClass);
    },
  };
}
