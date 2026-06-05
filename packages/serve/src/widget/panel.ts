import { ICON_CLOSE } from "./icons.js";
import { t } from "./i18n.js";

export type TabName = "chat" | "comments";

export interface PanelAPI {
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  switchTab(tab: TabName): void;
  getTabContainer(tab: TabName): HTMLElement;
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

  const tabs: Record<TabName, HTMLButtonElement> = {} as any;
  const tabNames: TabName[] = ["chat", "comments"];
  for (const name of tabNames) {
    const btn = document.createElement("button");
    btn.className = "prism-tab-btn";
    btn.textContent = t(`tab.${name}`);
    btn.dataset.tab = name;
    btn.onclick = () => switchTab(name);
    header.appendChild(btn);
    tabs[name] = btn;
  }

  const closeBtn = document.createElement("button");
  closeBtn.className = "prism-close-btn";
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.onclick = () => hide();
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // ── Body ──
  const body = document.createElement("div");
  body.className = "prism-body";

  const tabContents: Record<TabName, HTMLElement> = {} as any;
  for (const name of tabNames) {
    const content = document.createElement("div");
    content.className = "prism-tab-content";
    content.dataset.tab = name;
    body.appendChild(content);
    tabContents[name] = content;
  }

  panel.appendChild(body);
  shadowRoot.appendChild(panel);

  // ── State ──
  let currentTab: TabName = "chat";
  let visible = false;
  const visibilityCbs: Array<(v: boolean) => void> = [];

  function switchTab(tab: TabName) {
    currentTab = tab;
    for (const name of tabNames) {
      tabs[name].classList.toggle("active", name === tab);
      tabContents[name].classList.toggle("active", name === tab);
    }
  }

  function show() {
    panel.classList.remove("hidden");
    visible = true;
    visibilityCbs.forEach((cb) => cb(true));
  }

  function hide() {
    panel.classList.add("hidden");
    visible = false;
    visibilityCbs.forEach((cb) => cb(false));
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  // Default to chat tab
  switchTab("chat");

  return {
    show,
    hide,
    toggle,
    isVisible: () => visible,
    switchTab,
    getTabContainer: (tab) => tabContents[tab],
    onVisibilityChange: (cb) => visibilityCbs.push(cb),
    destroy: () => panel.remove(),
  };
}
