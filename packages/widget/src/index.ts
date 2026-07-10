import { WIDGET_CSS } from "./styles.js";
import { AgentClient } from "./agent-client.js";
import { createPanel, type PanelAPI } from "./panel.js";
import { createChat, type ChatAPI } from "./chat.js";
import { createConnectForm, getSavedAgentUrl, clearSavedAgentUrl } from "./connect-form.js";
import { setLocale, t } from "./i18n.js";

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
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Show a "connecting / retry" status when agentUrl is preconfigured */
  function mountAutoConnect(url: string) {
    const body = panel.getBody();
    body.innerHTML = "";
    currentChat = null;
    panel.setDisconnectHandler(null);

    const wrap = document.createElement("div");
    wrap.className = "connect-form";

    const statusEl = document.createElement("div");
    statusEl.className = "connect-hint";
    statusEl.textContent = t("connect.connecting");
    wrap.appendChild(statusEl);

    const retryBtn = document.createElement("button");
    retryBtn.className = "connect-btn";
    retryBtn.textContent = t("connect.retry");
    retryBtn.style.display = "none";
    retryBtn.onclick = () => attemptConnect();
    wrap.appendChild(retryBtn);

    body.appendChild(wrap);

    let attempt = 0;
    async function attemptConnect() {
      attempt++;
      statusEl.textContent = t("connect.connecting");
      retryBtn.style.display = "none";

      const ok = await AgentClient.checkConnection(url);
      if (ok) {
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        const client = new AgentClient(url);
        mountChat(client);
      } else {
        statusEl.textContent = t("connect.waiting");
        retryBtn.style.display = "";
        // Auto-retry with backoff: 3s, 5s, 10s, then every 10s
        const delay = attempt <= 1 ? 3000 : attempt <= 3 ? 5000 : 10000;
        retryTimer = setTimeout(attemptConnect, delay);
      }
    }

    attemptConnect();
  }

  function handleDisconnect() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (currentChat) {
      currentChat.destroy();
      currentChat = null;
    }
    if (options?.agentUrl) {
      // Preconfigured URL — show auto-reconnect, not manual form
      mountAutoConnect(options.agentUrl);
    } else {
      clearSavedAgentUrl();
      mountConnectForm();
    }
  }

  // ── Init flow ──
  if (options?.agentUrl) {
    // Preconfigured URL — check connection first, auto-retry if unavailable
    mountAutoConnect(options.agentUrl);
  } else {
    // Try saved URL
    const savedUrl = getSavedAgentUrl();
    if (savedUrl) {
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
