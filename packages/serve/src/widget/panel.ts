import { ICON_CLOSE, ICON_PRISM } from "./icons.js";
import { t } from "./i18n.js";

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

export function createPanel(shadowRoot: ShadowRoot): PanelAPI {
  // ── Container: anchored bottom-right, morphs between FAB and panel ──
  const container = document.createElement("div");
  container.className = "prism-container collapsed";

  // ── FAB face (visible when collapsed) ──
  const fab = document.createElement("button");
  fab.className = "prism-fab";
  fab.innerHTML = ICON_PRISM;
  fab.onclick = () => show();
  container.appendChild(fab);

  // ── Panel face (visible when expanded) ──
  const panelInner = document.createElement("div");
  panelInner.className = "prism-panel-inner";

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

  function show() {
    container.classList.remove("collapsed");
    container.classList.add("expanded");
    visible = true;
    try { localStorage.setItem(STORAGE_KEY_VISIBLE, "1"); } catch {}
    visibilityCbs.forEach((cb) => cb(true));
  }

  function hide() {
    container.classList.remove("expanded");
    container.classList.add("collapsed");
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
      // Re-enable transitions after paint
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
    destroy: () => container.remove(),
  };
}
