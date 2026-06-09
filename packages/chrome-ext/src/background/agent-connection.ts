import type { TabState } from "./tab-state.js";

/**
 * Connect to agent server for a specific tab.
 * Returns project info on success, throws on failure.
 */
export async function connectAgent(
  state: TabState,
  url: string,
  onEvent: (type: string, data: unknown) => void
): Promise<{ framework: string; styling: string[]; componentLib: string[] }> {
  // Close existing connection — remove handlers to prevent stale callbacks
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.onmessage = null;
    state.ws.onerror = null;
    try { state.ws.close(); } catch {}
    state.ws = null;
  }

  state.agentUrl = url;

  // Test connection with timeout
  let res: Response;
  try {
    res = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    state.agentUrl = null;
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("连接超时，请检查 Agent 服务是否已启动");
    }
    throw new Error("无法连接到 Agent 服务，请检查地址是否正确以及服务是否已启动");
  }
  if (!res.ok) { state.agentUrl = null; throw new Error(`Agent 返回错误 (${res.status})`); }
  let status: any;
  try { status = await res.json(); } catch { state.agentUrl = null; throw new Error("Agent 返回了无效数据"); }

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
    // Remove handlers BEFORE closing to prevent stale onclose from
    // broadcasting "connection_lost" after an intentional disconnect.
    state.ws.onclose = null;
    state.ws.onmessage = null;
    state.ws.onerror = null;
    try { state.ws.close(); } catch {}
    state.ws = null;
  }
  state.connected = false;
  state.agentUrl = null;
  state.project = null;
}

/**
 * Send chat message via agent REST API.
 */
export async function chatWithAgent(
  state: TabState,
  message: string,
): Promise<{ success: boolean; message: string }> {
  if (!state.agentUrl) throw new Error("Agent not connected");

  const res = await fetch(`${state.agentUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
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
