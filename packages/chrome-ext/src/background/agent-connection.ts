import type { TabState } from "./tab-state.js";
import type { TestRunInfo } from "../shared/types.js";

/**
 * Connect to agent server for a specific tab.
 * Returns project info on success, throws on failure.
 */
export async function connectAgent(
  state: TabState,
  url: string,
  token: string,
  onEvent: (type: string, data: unknown) => void,
  onBrowserCommand?: (data: any) => Promise<unknown>,
  pageUrl?: string,
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
  state.agentToken = token;

  // Test connection with timeout
  let res: Response;
  try {
    res = await fetch(`${url}/api/status`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
  } catch (err) {
    state.agentUrl = null;
    state.agentToken = null;
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error("连接超时，请检查 Agent 服务是否已启动");
    }
    throw new Error("无法连接到 Agent 服务，请检查地址是否正确以及服务是否已启动");
  }
  if (!res.ok) { state.agentUrl = null; state.agentToken = null; throw new Error(res.status === 401 ? "Agent 已启用 Token 鉴权，请填写正确的访问 Token" : `Agent 返回错误 (${res.status})`); }
  let status: any;
  try { status = await res.json(); } catch { state.agentUrl = null; state.agentToken = null; throw new Error("Agent 返回了无效数据"); }

  state.project = status.project;

  // Establish WebSocket
  const wsUrl = url.replace(/^http/, "ws") + `/ws?clientId=${encodeURIComponent(state.clientId)}`;
  const ws = new WebSocket(wsUrl, token ? ["prism", token] : ["prism"]);
  let opened = false;
  let rejectOpen: ((error: Error) => void) | undefined;
  const openPromise = new Promise<void>((resolve, reject) => {
    rejectOpen = reject;
    const timer = setTimeout(() => reject(new Error("浏览器连接注册超时，请刷新页面后重试")), 8_000);
    ws.addEventListener("open", () => { clearTimeout(timer); opened = true; resolve(); }, { once: true });
  });
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "browser:register", data: { url: pageUrl || "", mode: "current-tab" } }));
  };

  ws.onmessage = (event) => {
    try {
      const { type, data } = JSON.parse(event.data);
      if (type === "browser:command" && onBrowserCommand) {
        void onBrowserCommand(data).then((result) => {
          ws.send(JSON.stringify({ type: "browser:result", data: { requestId: data.requestId, success: true, result } }));
        }).catch((error) => {
          ws.send(JSON.stringify({ type: "browser:result", data: { requestId: data.requestId, success: false, error: error instanceof Error ? error.message : String(error) } }));
        });
        return;
      }
      onEvent(type, data);
    } catch {}
  };

  ws.onclose = () => {
    if (!opened) rejectOpen?.(new Error("浏览器连接在注册前已断开"));
    state.ws = null;
    state.connected = false;
    // Notify side panel
    onEvent("connection_lost", {});
    // Auto-reconnect after 3s
    setTimeout(() => {
      if (state.agentUrl === url) {
        connectAgent(state, url, token, onEvent, onBrowserCommand, pageUrl)
          .then((project) => onEvent("connection_restored", { project }))
          .catch((error) => onEvent("connection_reconnect_failed", { error: error instanceof Error ? error.message : String(error) }));
      }
    }, 3000);
  };

  ws.onerror = () => {
    // onclose will fire after this
  };

  state.ws = ws;
  try {
    await openPromise;
  } catch (error) {
    ws.onclose = null;
    try { ws.close(); } catch {}
    state.ws = null;
    state.connected = false;
    state.agentUrl = null;
    state.agentToken = null;
    state.project = null;
    throw error;
  }
  state.connected = true;
  return status.project;
}

export function updateBrowserRegistration(state: TabState, pageUrl: string) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "browser:register", data: { url: pageUrl, mode: "current-tab" } }));
  }
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
  state.agentToken = null;
  state.project = null;
}

/**
 * Send chat message via agent REST API.
 */
export async function chatWithAgent(
  state: TabState,
  message: string,
  attachmentIds: string[] = [],
): Promise<{ success: boolean; message: string; filesModified?: string[]; runId?: string }> {
  if (!state.agentUrl) throw new Error("Agent not connected");

  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${state.agentUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": state.clientId, Authorization: `Bearer ${state.agentToken}` },
    body: JSON.stringify({
      message,
      runId,
      pageUrl: (await chrome.tabs.get(Number(state.clientId.replace("chrome-tab-", "")))).url,
      attachmentIds,
      capabilities: {
        browserInteraction: true,
        automatedTesting: true,
        alwaysAllowEdits: state.permissions.alwaysAllowEdits,
        alwaysAllowAutomatedTesting: state.permissions.alwaysAllowAutomatedTesting,
      },
    }),
  });
  const result = await res.json().catch(() => ({})) as { success?: boolean; message?: string; error?: string; filesModified?: string[]; runId?: string };
  if (!res.ok) {
    throw new Error(result.message || result.error || `Agent 请求失败 (${res.status})`);
  }
  if (result.success === false) {
    throw new Error(result.message || result.error || "Agent 请求失败");
  }
  return result as { success: boolean; message: string; filesModified?: string[]; runId?: string };
}

export async function uploadAgentAttachment(state: TabState, file: { name: string; mimeType: string; data: number[] }) {
  if (!state.agentUrl) throw new Error("Agent not connected");
  const res = await fetch(`${state.agentUrl}/api/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "x-client-id": state.clientId, "x-attachment-name": encodeURIComponent(file.name), "x-attachment-type": file.mimeType || "text/plain", Authorization: `Bearer ${state.agentToken}` },
    body: new Uint8Array(file.data),
  });
  const text = await res.text();
  let result: any;
  try { result = text ? JSON.parse(text) : {}; }
  catch { result = { error: text }; }
  if (!res.ok) throw new Error(result.error || `附件上传失败 (${res.status})`);
  if (!result.attachment?.id) throw new Error("Agent 返回了无效的附件响应，请重启开发服务");
  return result.attachment;
}

export async function deleteAgentAttachment(state: TabState, id: string) {
  if (!state.agentUrl) return;
  await fetch(`${state.agentUrl}/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-client-id": state.clientId, Authorization: `Bearer ${state.agentToken}` } });
}

export async function cancelCurrentAgentRun(state: TabState): Promise<{ success: boolean }> {
  if (!state.agentUrl) throw new Error("Agent not connected");
  const response = await fetch(`${state.agentUrl}/api/runs/current`, {
    method: "DELETE",
    headers: { "x-client-id": state.clientId, Authorization: `Bearer ${state.agentToken}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`取消运行失败 (${response.status})`);
  return { success: response.ok };
}

export async function getAgentRuntimeState(state: TabState): Promise<{ activeTestRuns: TestRunInfo[]; activeAgentRuns: Array<{ runId: string; progress: string }> }> {
  if (!state.agentUrl) return { activeTestRuns: [], activeAgentRuns: [] };
  const response = await fetch(`${state.agentUrl}/api/browser/diagnostics`, { headers: { "x-client-id": state.clientId, Authorization: `Bearer ${state.agentToken}` } });
  if (!response.ok) return { activeTestRuns: [], activeAgentRuns: [] };
  return response.json();
}

export async function startAgentVerification(
  state: TabState,
  verification: { id: string; goal: string; proposedChecks: string[] },
) {
  if (!state.agentUrl) throw new Error("Agent not connected");
  const tabId = Number(state.clientId.replace("chrome-tab-", ""));
  const tab = await chrome.tabs.get(tabId);
  const res = await fetch(`${state.agentUrl}/api/verifications/${encodeURIComponent(verification.id)}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": state.clientId, Authorization: `Bearer ${state.agentToken}` },
    body: JSON.stringify({ pageUrl: tab.url, goal: verification.goal, proposedChecks: verification.proposedChecks }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || "Failed to start verification");
  return result;
}

/**
 * Rollback last change via agent REST API.
 */
export async function rollbackAgent(
  state: TabState
): Promise<{ success: boolean }> {
  if (!state.agentUrl) throw new Error("Agent not connected");

  const res = await fetch(`${state.agentUrl}/api/rollback`, { method: "POST", headers: { Authorization: `Bearer ${state.agentToken}` } });
  return res.json();
}
