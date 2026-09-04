import { t } from "./i18n.js";
import { ICON_LINK } from "./icons.js";
import { AgentClient } from "./agent-client.js";

const STORAGE_KEY_URL = "prism-agent-url";
const STORAGE_KEY_TOKEN = "prism-agent-token";
const DEFAULT_URL = "http://localhost:9527";

export interface ConnectFormAPI {
  destroy(): void;
}

export function createConnectForm(
  container: HTMLElement,
  onConnected: (client: AgentClient, url: string) => void
): ConnectFormAPI {
  const form = document.createElement("div");
  form.className = "connect-form";

  // Icon
  const iconWrap = document.createElement("div");
  iconWrap.className = "connect-icon";
  iconWrap.innerHTML = ICON_LINK;
  form.appendChild(iconWrap);

  // Hint
  const hint = document.createElement("div");
  hint.className = "connect-hint";
  hint.textContent = t("connect.hint");
  form.appendChild(hint);

  // Input row
  const inputRow = document.createElement("div");
  inputRow.className = "connect-input-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t("connect.placeholder");

  // Restore last URL
  let savedUrl = DEFAULT_URL;
  try { savedUrl = localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_URL; } catch {}
  input.value = savedUrl;
  inputRow.appendChild(input);

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.className = "connect-token-input";
  tokenInput.placeholder = t("connect.tokenPlaceholder");
  try { tokenInput.value = sessionStorage.getItem(STORAGE_KEY_TOKEN) || ""; } catch {}
  inputRow.appendChild(tokenInput);

  const connectBtn = document.createElement("button");
  connectBtn.className = "connect-btn";
  connectBtn.textContent = t("connect.button");
  inputRow.appendChild(connectBtn);

  form.appendChild(inputRow);

  // Error message
  const errorEl = document.createElement("div");
  errorEl.className = "connect-error";
  errorEl.style.display = "none";
  form.appendChild(errorEl);

  container.appendChild(form);

  // Submit handler
  async function tryConnect() {
    const url = input.value.trim().replace(/\/+$/, "");
    const token = tokenInput.value.trim();
    if (!url || !token) return;

    connectBtn.disabled = true;
    connectBtn.textContent = t("connect.connecting");
    errorEl.style.display = "none";

    const ok = await AgentClient.checkConnection(url, token);

    if (ok) {
      try { localStorage.setItem(STORAGE_KEY_URL, url); } catch {}
      try { sessionStorage.setItem(STORAGE_KEY_TOKEN, token); } catch {}
      const client = new AgentClient(url, token);
      onConnected(client, url);
    } else {
      errorEl.textContent = t("connect.error");
      errorEl.style.display = "block";
      connectBtn.disabled = false;
      connectBtn.textContent = t("connect.button");
    }
  }

  connectBtn.onclick = tryConnect;
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryConnect();
    }
  };
  tokenInput.onkeydown = input.onkeydown;

  return {
    destroy() {
      form.remove();
    },
  };
}

/** Get the saved agent URL from localStorage */
export function getSavedAgentUrl(): string | null {
  try { return localStorage.getItem(STORAGE_KEY_URL); } catch { return null; }
}

export function getSavedAgentToken(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY_TOKEN); } catch { return null; }
}

/** Clear the saved agent URL */
export function clearSavedAgentUrl(): void {
  try { localStorage.removeItem(STORAGE_KEY_URL); } catch {}
  try { sessionStorage.removeItem(STORAGE_KEY_TOKEN); } catch {}
}
