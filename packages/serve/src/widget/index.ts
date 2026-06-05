import { WIDGET_CSS } from "./styles.js";
import { ICON_PRISM } from "./icons.js";
import { AgentClient } from "./agent-client.js";
import { createPanel } from "./panel.js";
import { createChat } from "./chat.js";

declare global {
  interface Window {
    __PRISM_DESIGN__?: { agentUrl: string };
  }
}

function init() {
  const config = window.__PRISM_DESIGN__;
  if (!config) {
    console.warn("[棱镜] Missing window.__PRISM_DESIGN__ config");
    return;
  }

  const agentClient = new AgentClient(config.agentUrl);

  // ── Shadow DOM host ──
  const host = document.createElement("div");
  host.id = "prism-design-widget";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; bottom: 0; right: 0;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // ── Inject CSS ──
  const style = document.createElement("style");
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  // ── Floating button ──
  const fab = document.createElement("button");
  fab.className = "prism-fab";
  fab.innerHTML = ICON_PRISM;
  fab.onclick = () => panel.toggle();
  shadow.appendChild(fab);

  // ── Panel ──
  const panel = createPanel(shadow);

  // ── Chat (the only view) ──
  createChat(panel.getBody(), agentClient, shadow);
}

// Wait for DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
