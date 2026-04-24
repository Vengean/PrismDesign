import type { TabState } from "./tab-state.js";
import type { StyleChange, ComponentInfo } from "../shared/types.js";

/**
 * Connect to agent server for a specific tab.
 * Returns project info on success, throws on failure.
 */
export async function connectAgent(
  state: TabState,
  url: string,
  onEvent: (type: string, data: unknown) => void
): Promise<{ framework: string; styling: string[]; componentLib: string[] }> {
  // Close existing connection
  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }

  state.agentUrl = url;

  // Test connection
  const res = await fetch(`${url}/api/status`);
  const status = await res.json();

  state.connected = true;
  state.project = status.project;

  // Establish WebSocket
  const wsUrl = url.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      onEvent(type, data);
    } catch {}
  };

  ws.onclose = () => {
    state.ws = null;
    state.connected = false;
    // Notify side panel
    onEvent("connection_lost", {});
    // Auto-reconnect after 3s
    setTimeout(() => {
      if (state.agentUrl === url) {
        connectAgent(state, url, onEvent).catch(() => {});
      }
    }, 3000);
  };

  ws.onerror = () => {
    // onclose will fire after this
  };

  state.ws = ws;
  return status.project;
}

/**
 * Disconnect from agent server.
 */
export function disconnectAgent(state: TabState) {
  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }
  state.connected = false;
  state.agentUrl = null;
  state.project = null;
}

/**
 * Apply design changes via agent REST API.
 */
export async function applyChanges(
  state: TabState,
  changes: StyleChange[],
  pagePath?: string,
  supplement?: string
): Promise<{ success: boolean; message: string; filesModified: string[] }> {
  if (!state.agentUrl) throw new Error("Agent not connected");

  const res = await fetch(`${state.agentUrl}/api/apply-changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes, pagePath, supplement }),
  });
  return res.json();
}

/**
 * Send chat message via agent REST API.
 */
export async function chatWithAgent(
  state: TabState,
  message: string,
  context: { pagePath: string; components: ComponentInfo[] }
): Promise<{ success: boolean; message: string }> {
  if (!state.agentUrl) throw new Error("Agent not connected");

  const res = await fetch(`${state.agentUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
  });
  return res.json();
}

/**
 * Rollback last change via agent REST API.
 */
export async function rollbackAgent(
  state: TabState
): Promise<{ success: boolean }> {
  if (!state.agentUrl) throw new Error("Agent not connected");

  const res = await fetch(`${state.agentUrl}/api/rollback`, { method: "POST" });
  return res.json();
}
