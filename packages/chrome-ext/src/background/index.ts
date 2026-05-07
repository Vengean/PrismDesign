import { getTabState, removeTab } from "./tab-state.js";
import {
  connectAgent,
  disconnectAgent,
  applyChanges,
  chatWithAgent,
  rollbackAgent,
} from "./agent-connection.js";
import type { PrismMessage } from "../shared/types.js";

// Open side panel when clicking the extension icon
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

/** Ensure content script is injected in the given tab. */
async function ensureContentScript(tabId: number) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (response) return;
  } catch {}
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  }).catch(() => {});
}

// Re-inject content script after extension reload/update
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    if (tab.id) ensureContentScript(tab.id);
  }
});

// Clean up tab state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

// Ensure content script when active tab changes
chrome.tabs.onActivated.addListener(async (info) => {
  await ensureContentScript(info.tabId);
  // If side panel is open, show toolbar on the new tab
  if (sidePanelOpen) {
    chrome.tabs.sendMessage(info.tabId, { type: "SHOW_TOOLBAR" }).catch(() => {});
  }
});

// When a page finishes loading, re-show toolbar if side panel is open
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === "complete" && sidePanelOpen) {
    await ensureContentScript(tabId);
    chrome.tabs.sendMessage(tabId, { type: "SHOW_TOOLBAR" }).catch(() => {});
  }
});

// ============================================================
// Side panel lifecycle via port
// ============================================================
// Side panel connects a port "prism-sidepanel" on mount.
// Port keeps service worker alive → prevents WebSocket disconnect.
// On port disconnect, we wait briefly for reconnection (service worker
// restart) before concluding the side panel is truly closed.

let sidePanelOpen = false;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "prism-sidepanel") {
    sidePanelOpen = true;
    handleSidePanelOpen();

    port.onDisconnect.addListener(() => {
      sidePanelOpen = false;
      handleSidePanelClose();
    });
  }
});

async function handleSidePanelOpen() {
  const tabId = await getActiveTabId();
  if (!tabId) return;
  await ensureContentScript(tabId);

  // Show toolbar
  sendToActiveTab({ type: "SHOW_TOOLBAR" } as PrismMessage);

  // Auto-connect agent
  const state = getTabState(tabId);
  if (!state.connected) {
    const result = await chrome.storage.local.get("agentUrl");
    let url = result.agentUrl;
    if (!url) {
      // Derive default from active tab's hostname so LAN access works
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const host = tab?.url ? new URL(tab.url).hostname : "localhost";
        url = `http://${host}:9527`;
      } catch {
        url = "http://localhost:9527";
      }
    }
    await handleAgentConnect(url);
  } else {
    // Already connected — notify side panel of current status
    broadcastToSidePanel({
      type: "AGENT_STATUS",
      payload: { connected: true, project: state.project ?? undefined },
    });
  }
}

async function handleSidePanelClose() {
  // Hide toolbar + exit design mode
  sendToActiveTab({ type: "HIDE_TOOLBAR" } as PrismMessage);

  // Disconnect agent
  const tabId = await getActiveTabId();
  if (tabId) {
    const state = getTabState(tabId);
    if (state.connected) {
      disconnectAgent(state);
    }
  }
}

/**
 * Broadcast a message to all extension contexts (side panel listens here).
 */
function broadcastToSidePanel(message: PrismMessage) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open — ignore
  });
}

/**
 * Get active tab ID.
 */
async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

/**
 * Forward a message to the active tab's content script.
 */
async function sendToActiveTab(message: PrismMessage): Promise<unknown> {
  const tabId = await getActiveTabId();
  if (!tabId) return { success: false, error: "no active tab" };
  return chrome.tabs.sendMessage(tabId, message).catch((err) => {
    console.warn("[BG] sendToTab error:", err.message);
    return { success: false, error: err.message };
  });
}

// ============================================================
// Message routing
// ============================================================
chrome.runtime.onMessage.addListener((message: PrismMessage, sender, sendResponse) => {
  const isFromTab = !!sender.tab;

  // Handle OPEN_SIDE_PANEL from any context
  if (message.type === "OPEN_SIDE_PANEL") {
    (async () => {
      const tabId = sender.tab?.id || (await getActiveTabId());
      if (tabId) chrome.sidePanel.open({ tabId });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (isFromTab) {
    // Forward critical events to side panel reliably
    if (
      message.type === "ELEMENT_SELECTED" ||
      message.type === "ELEMENT_DESELECTED" ||
      message.type === "OPEN_CHAT" ||
      message.type === "OPEN_NAVIGATOR" ||
      message.type === "OPEN_CHANGES" ||
      message.type === "OPEN_PENDING" ||
      message.type === "COMMENT_ADDED" ||
      message.type === "DRAG_MOVE"
    ) {
      broadcastToSidePanel(message);
    }
    return false;
  }

  // Side panel → route based on message type
  switch (message.type) {
    // ---- Agent operations (handled by background) ----
    case "AGENT_CONNECT":
      handleAgentConnect(message.payload.url).then(sendResponse);
      return true;

    case "AGENT_DISCONNECT":
      handleAgentDisconnect().then(sendResponse);
      return true;

    case "AGENT_APPLY_CHANGES":
      handleApplyChanges(message.payload).then(sendResponse);
      return true;

    case "AGENT_CHAT":
      handleChat(message.payload).then(sendResponse);
      return true;

    case "AGENT_ROLLBACK":
      handleRollback().then(sendResponse);
      return true;

    // ---- Content script operations (forwarded to tab) ----
    case "DESIGN_MODE_ON":
    case "DESIGN_MODE_OFF":
    case "APPLY_STYLE_PREVIEW":
    case "CLEAR_STYLE_PREVIEW":
    case "HIGHLIGHT_ELEMENT":
    case "UNHIGHLIGHT_ELEMENT":
    case "SELECT_ELEMENT":
    case "ENABLE_DRAG_MODE":
    case "DISABLE_DRAG_MODE":
    case "GET_DOM_TREE":
    case "GET_PENDING_CHANGES":
    case "CLEAR_CHANGES":
    case "UNDO":
    case "REDO":
    case "SHOW_TOOLBAR":
    case "HIDE_TOOLBAR":
    case "TOOLBAR_DISABLE":
    case "PING":
      sendToActiveTab(message).then(sendResponse);
      return true;

    default:
      return false;
  }
});

// ============================================================
// Agent operation handlers
// ============================================================

async function handleAgentConnect(url: string) {
  const tabId = await getActiveTabId();
  if (!tabId) return { success: false, error: "no active tab" };

  const state = getTabState(tabId);

  try {
    const project = await connectAgent(state, url, (eventType, data) => {
      // Forward agent WebSocket events to side panel
      if (eventType === "agent:start") {
        broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
      } else if (eventType === "agent:progress") {
        broadcastToSidePanel({ type: "AGENT_PROGRESS", payload: { text: (data as any)?.text || "" } });
      } else if (eventType === "agent:done") {
        broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
      } else if (eventType === "agent:error") {
        broadcastToSidePanel({ type: "AGENT_ERROR", payload: { message: String(data) } });
      } else if (eventType === "connection_lost") {
        broadcastToSidePanel({ type: "AGENT_STATUS", payload: { connected: false } });
      }
    });

    // Persist URL
    chrome.storage.local.set({ agentUrl: url });

    broadcastToSidePanel({
      type: "AGENT_STATUS",
      payload: { connected: true, project },
    });

    return { success: true, project };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleAgentDisconnect() {
  const tabId = await getActiveTabId();
  if (!tabId) return { success: false };

  const state = getTabState(tabId);
  disconnectAgent(state);

  broadcastToSidePanel({
    type: "AGENT_STATUS",
    payload: { connected: false },
  });

  return { success: true };
}

async function handleApplyChanges(payload: {
  changes: unknown[];
  pagePath?: string;
  supplement?: string;
}) {
  const tabId = await getActiveTabId();
  if (!tabId) return { success: false, error: "no active tab" };

  const state = getTabState(tabId);
  if (!state.connected) return { success: false, error: "not connected" };

  try {
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
    const result = await applyChanges(
      state,
      payload.changes as any,
      payload.pagePath,
      payload.supplement
    );
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
    broadcastToSidePanel({
      type: "AGENT_RESULT",
      payload: {
        success: result.success,
        message: result.message,
        filesModified: result.filesModified,
      },
    });
    return result;
  } catch (err) {
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
    broadcastToSidePanel({ type: "AGENT_ERROR", payload: { message: String(err) } });
    return { success: false, error: String(err) };
  }
}

async function handleChat(payload: {
  message: string;
  context: { pagePath: string; components: unknown[] };
}) {
  const tabId = await getActiveTabId();
  if (!tabId) return { success: false, error: "no active tab" };

  const state = getTabState(tabId);
  if (!state.connected) return { success: false, error: "not connected" };

  try {
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
    const result = await chatWithAgent(state, payload.message, payload.context as any);
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
    broadcastToSidePanel({
      type: "AGENT_RESULT",
      payload: {
        success: result.success,
        message: result.message,
      },
    });
    return result;
  } catch (err) {
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
    broadcastToSidePanel({ type: "AGENT_ERROR", payload: { message: String(err) } });
    return { success: false, error: String(err) };
  }
}

async function handleRollback() {
  const tabId = await getActiveTabId();
  if (!tabId) return { success: false };

  const state = getTabState(tabId);
  if (!state.connected) return { success: false, error: "not connected" };

  try {
    const result = await rollbackAgent(state);
    return result;
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
