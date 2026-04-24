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

// Clean up tab state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

// Notify side panel when active tab changes
chrome.tabs.onActivated.addListener(async (info) => {
  const state = getTabState(info.tabId);
  broadcastToSidePanel({
    type: "AGENT_STATUS",
    payload: {
      connected: state.connected,
      project: state.project ?? undefined,
    },
  });
});

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

  if (isFromTab) {
    // Content script → broadcast to side panel (no routing needed,
    // side panel listens on chrome.runtime.onMessage)
    return false;
  }

  // Side panel → route based on message type
  switch (message.type) {
    // ---- Agent operations (handled by background) ----
    case "OPEN_SIDE_PANEL":
      getActiveTabId().then((tabId) => {
        if (tabId) chrome.sidePanel.open({ tabId });
      });
      sendResponse({ success: true });
      return true;

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
    return { success: false, error: String(err) };
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
