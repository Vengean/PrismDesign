import { ICON_CLOSE } from "./icons.js";
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
  const panel = document.createElement("div");
  panel.className = "prism-panel hidden";

  // ── Header ──
  const header = document.createElement("div");
  header.className = "prism-header";

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = t("panel.title");
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "prism-close-btn";
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.onclick = () => hide();
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // ── Body ──
  const body = document.createElement("div");
  body.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;";
  panel.appendChild(body);

  shadowRoot.appendChild(panel);

  // ── State ──
  let visible = false;
  const visibilityCbs: Array<(v: boolean) => void> = [];

  function show() {
    panel.classList.remove("hidden");
    visible = true;
    try { localStorage.setItem(STORAGE_KEY_VISIBLE, "1"); } catch {}
    visibilityCbs.forEach((cb) => cb(true));
  }

  function hide() {
    panel.classList.add("hidden");
    visible = false;
    try { localStorage.setItem(STORAGE_KEY_VISIBLE, "0"); } catch {}
    visibilityCbs.forEach((cb) => cb(false));
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  // Restore visibility from previous session
  try {
    if (localStorage.getItem(STORAGE_KEY_VISIBLE) === "1") {
      show();
    }
  } catch {}

  return {
    show,
    hide,
    toggle,
    isVisible: () => visible,
    getBody: () => body,
    onVisibilityChange: (cb) => visibilityCbs.push(cb),
    destroy: () => panel.remove(),
  };
}
