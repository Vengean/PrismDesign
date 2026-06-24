import { WIDGET_CSS } from "./styles.js";
import { AgentClient } from "./agent-client.js";
import { createPanel, type PanelAPI } from "./panel.js";
import { createChat, type ChatAPI } from "./chat.js";
import { createConnectForm, getSavedAgentUrl, clearSavedAgentUrl } from "./connect-form.js";
import { setLocale } from "./i18n.js";

export interface PrismWidgetOptions {
  /** Agent server URL. If provided, skips the connection form. */
  agentUrl?: string;
  /** FAB position. Default: "bottom-right" */
  position?: "bottom-right" | "bottom-left";
  /** Override locale auto-detection */
  locale?: "zh" | "en";
}

let initialized = false;

export function init(options?: PrismWidgetOptions) {
  if (initialized) return;
  initialized = true;

  if (options?.locale) {
    setLocale(options.locale);
  }

  const position = options?.position || "bottom-right";

  // ── Create Shadow DOM host ──
  const host = document.createElement("div");
  host.id = "prism-design-widget";
  host.style.cssText = "position:fixed;z-index:2147483647;bottom:0;right:0;all:initial;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = WIDGET_CSS;
  shadow.appendChild(styleEl);

  // ── Create panel ──
  const panel = createPanel(shadow, position);

  // ── State ──
  let currentChat: ChatAPI | null = null;

  function mountChat(client: AgentClient) {
    const body = panel.getBody();
    body.innerHTML = "";
    currentChat = createChat(body, client, shadow, panel);
    panel.setDisconnectHandler(() => {
      handleDisconnect();
    });
  }

  function mountConnectForm() {
    const body = panel.getBody();
    body.innerHTML = "";
    currentChat = null;
    panel.setDisconnectHandler(null);
    createConnectForm(body, (client, _url) => {
      mountChat(client);
    });
  }

  function handleDisconnect() {
    if (currentChat) {
      currentChat.destroy();
      currentChat = null;
    }
    clearSavedAgentUrl();
    mountConnectForm();
  }

  // ── Init flow ──
  if (options?.agentUrl) {
    // Direct connect — skip form
    const client = new AgentClient(options.agentUrl);
    mountChat(client);
  } else {
    // Try saved URL
    const savedUrl = getSavedAgentUrl();
    if (savedUrl) {
      // Attempt silent connect
      AgentClient.checkConnection(savedUrl).then((ok) => {
        if (ok) {
          const client = new AgentClient(savedUrl);
          mountChat(client);
        } else {
          mountConnectForm();
        }
      });
    } else {
      mountConnectForm();
    }
  }
}

// Auto-init for backward compatibility with serve-style injection
if (typeof window !== "undefined") {
  const cfg = (window as any).__PRISM_DESIGN__;
  if (cfg?.agentUrl) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init({ agentUrl: cfg.agentUrl }));
    } else {
      init({ agentUrl: cfg.agentUrl });
    }
  }
}
