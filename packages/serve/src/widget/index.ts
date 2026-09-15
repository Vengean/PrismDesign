import { WIDGET_CSS } from "./styles.js";
import { AgentClient } from "./agent-client.js";
import { createPanel } from "./panel.js";
import { createChat } from "./chat.js";

declare global {
  interface Window {
    __PRISM_STUDIO__?: { agentUrl: string };
  }
}

function init() {
  const config = window.__PRISM_STUDIO__;
  if (!config) {
    console.warn("[棱镜] Missing window.__PRISM_STUDIO__ config");
    return;
  }

  const agentClient = new AgentClient(config.agentUrl);

  // ── Shadow DOM host ──
  const host = document.createElement("div");
  host.id = "prism-studio-widget";
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; bottom: 0; right: 0;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // ── Inject CSS ──
  const style = document.createElement("style");
  style.textContent = WIDGET_CSS;
  shadow.appendChild(style);

  // ── Panel (includes FAB) ──
  const panel = createPanel(shadow);

  // ── Chat ──
  createChat(panel.getBody(), agentClient, shadow);
}

// Wait for DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
