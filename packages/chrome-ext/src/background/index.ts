import { getTabState, removeTab } from "./tab-state.js";
import {
  connectAgent,
  disconnectAgent,
  chatWithAgent,
  rollbackAgent,
  startAgentVerification,
  updateBrowserRegistration,
  cancelCurrentAgentRun,
  getAgentRuntimeState,
  uploadAgentAttachment,
  deleteAgentAttachment,
} from "./agent-connection.js";
import type { PrismMessage } from "../shared/types.js";
import { executeCurrentTabCommand } from "./browser-controller.js";

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
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file:///*"] });
  for (const tab of tabs) {
    if (tab.id) ensureContentScript(tab.id);
  }
});

// Clean up tab state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
  if (boundAgentTabId === tabId) void clearBoundAgentTab();
});

// Ensure content script when active tab changes
chrome.tabs.onActivated.addListener(async (info) => {
  const boundTabId = await getBoundAgentTabId();
  if (sidePanelOpen && boundTabId === info.tabId) {
    await ensureContentScript(info.tabId);
  }
});

// Keep the content script available after navigation while the side panel is open.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const boundTabId = await getBoundAgentTabId();
  if (boundTabId !== tabId) return;
  if (changeInfo.url) {
    updateBrowserRegistration(getTabState(tabId), changeInfo.url);
    const changedTab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (changedTab) await persistBoundAgentTab(changedTab);
  }
  if (changeInfo.status === "complete" && sidePanelOpen) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) updateBrowserRegistration(getTabState(tabId), tab.url);
    await ensureContentScript(tabId);
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
let sidePanelCloseTimer: ReturnType<typeof setTimeout> | null = null;
let boundAgentTabId: number | undefined;
const BOUND_AGENT_TAB_KEY = "boundAgentTab";

interface PersistedBoundTab {
  tabId: number;
}

function isBindablePage(url?: string): boolean {
  return !!url && /^(https?|file):/i.test(url);
}

async function getBoundAgentTabId(): Promise<number | undefined> {
  if (boundAgentTabId === undefined) {
    const stored = await chrome.storage.session.get(BOUND_AGENT_TAB_KEY);
    const persisted = stored[BOUND_AGENT_TAB_KEY] as PersistedBoundTab | undefined;
    if (persisted?.tabId !== undefined) boundAgentTabId = persisted.tabId;
  }
  if (boundAgentTabId === undefined) return undefined;
  const tab = await chrome.tabs.get(boundAgentTabId).catch(() => undefined);
  if (!tab?.id || !isBindablePage(tab.url)) {
    await clearBoundAgentTab();
    return undefined;
  }
  return tab.id;
}

async function persistBoundAgentTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined || !isBindablePage(tab.url)) throw new Error("Only a Web application tab can be bound");
  boundAgentTabId = tab.id;
  const value: PersistedBoundTab = { tabId: tab.id };
  await chrome.storage.session.set({ [BOUND_AGENT_TAB_KEY]: value });
}

async function clearBoundAgentTab(): Promise<void> {
  boundAgentTabId = undefined;
  await chrome.storage.session.remove(BOUND_AGENT_TAB_KEY);
}

// Handle the toolbar click ourselves so Chrome gives us the exact originating
// tab. The automatic side-panel behavior loses this association and forces an
// unreliable active-tab query after the panel has already started opening.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !isBindablePage(tab.url)) return;
  const tabId = tab.id;
  const panelWasOpen = sidePanelOpen;
  // Opening must be requested before any await; Chrome expires the action
  // click's user-gesture token once asynchronous work is crossed.
  void chrome.sidePanel.open({ tabId }).catch((error) => {
    console.warn("[BG] Unable to open side panel:", error instanceof Error ? error.message : String(error));
  });
  void (async () => {
    const previousTabId = await getBoundAgentTabId();
    if (previousTabId !== undefined && previousTabId !== tabId) disconnectAgent(getTabState(previousTabId));
    await persistBoundAgentTab(tab);
    if (panelWasOpen) {
      const state = getTabState(tabId);
      if (state.connected || state.ws) disconnectAgent(state);
      const saved = await chrome.storage.local.get(["agentUrl", "agentToken"]);
      const agentUrl = saved.agentUrl || `http://${new URL(tab.url!).hostname}:9527`;
      const result = await handleAgentConnect(agentUrl, saved.agentToken || "", tabId);
      if (!result.success) broadcastToSidePanel({ type: "AGENT_STATUS", payload: { connected: false, error: result.error } });
    }
  })();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "prism-sidepanel") {
    if (sidePanelCloseTimer) clearTimeout(sidePanelCloseTimer);
    sidePanelCloseTimer = null;
    sidePanelOpen = true;
    handleSidePanelOpen();

    port.onDisconnect.addListener(() => {
      sidePanelOpen = false;
      // Chrome may rotate the extension context and reconnect immediately.
      // Avoid tearing down the Agent for a transient port disconnect.
      if (sidePanelCloseTimer) clearTimeout(sidePanelCloseTimer);
      sidePanelCloseTimer = setTimeout(() => {
        sidePanelCloseTimer = null;
        if (!sidePanelOpen) void handleSidePanelClose();
      }, 1200);
    });
  }
});

async function handleSidePanelOpen() {
  let tabId = await getBoundAgentTabId();
  if (!tabId) {
    tabId = await getActiveTabId();
    const activeTab = tabId ? await chrome.tabs.get(tabId).catch(() => undefined) : undefined;
    if (activeTab && isBindablePage(activeTab.url)) await persistBoundAgentTab(activeTab);
  }
  if (!tabId) {
    broadcastToSidePanel({ type: "AGENT_STATUS", payload: { connected: false, error: "尚未绑定页面，请切换到目标应用页面并点击 Prism 插件图标" } });
    return;
  }
  const openingTab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!openingTab || !isBindablePage(openingTab.url)) return;
  await ensureContentScript(tabId);

  // Auto-connect agent
  const state = getTabState(tabId);
  if (!state.connected) {
    const result = await chrome.storage.local.get(["agentUrl", "agentToken"]);
    let url = result.agentUrl;
    if (!url) {
      // Derive default from active tab's hostname so LAN access works
      try {
        const host = openingTab.url ? new URL(openingTab.url).hostname : "";
        url = `http://${host || "localhost"}:9527`;
      } catch {
        url = "http://localhost:9527";
      }
    }
    // Notify side panel that auto-connect is starting
    broadcastToSidePanel({
      type: "AGENT_STATUS",
      payload: { connected: false, connecting: true, agentUrl: url },
    });
    const connectResult = await handleAgentConnect(url, result.agentToken || "");
    if (!connectResult.success) {
      // Broadcast failure so side panel shows the error immediately
      broadcastToSidePanel({
        type: "AGENT_STATUS",
        payload: { connected: false, connecting: false, error: connectResult.error },
      });
    }
  } else {
    // Already connected — notify side panel of current status
    broadcastToSidePanel({
      type: "AGENT_STATUS",
      payload: { connected: true, project: state.project ?? undefined },
    });
  }
}

async function handleSidePanelClose() {
  // Exit any active page selection mode.
  sendToBoundTab({ type: "DESIGN_MODE_OFF" } as PrismMessage);

  // Disconnect agent
  const tabId = await getBoundAgentTabId();
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
  const focusedWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => undefined);
  if (focusedWindow?.id === undefined) return undefined;
  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
  return isBindablePage(tab?.url) ? tab?.id : undefined;
}

/**
 * Forward a message to the active tab's content script.
 */
async function sendToBoundTab(message: PrismMessage): Promise<unknown> {
  const tabId = await getBoundAgentTabId();
  if (!tabId) return { success: false, error: "no bound tab" };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Content script not ready — re-inject and retry once
    await ensureContentScript(tabId);
    await new Promise((r) => setTimeout(r, 200));
    return chrome.tabs.sendMessage(tabId, message).catch((err) => {
      console.warn("[BG] sendToTab error:", err.message);
      return { success: false, error: err.message };
    });
  }
}

// ============================================================
// Message routing
// ============================================================
chrome.runtime.onMessage.addListener((message: PrismMessage, sender, sendResponse) => {
  const isFromTab = !!sender.tab;

  if (isFromTab) {
    // Forward critical events to side panel reliably
    if (
      message.type === "ELEMENT_SELECTED" ||
      message.type === "ELEMENT_DESELECTED" ||
      message.type === "OPEN_CHAT" ||
      message.type === "OPEN_NAVIGATOR" ||
      message.type === "OPEN_CHANGES" ||
      message.type === "COMMENT_TARGET_SELECTED" ||
      message.type === "COMMENT_CANCELLED" ||
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
      handleAgentConnect(message.payload.url, message.payload.token).then(sendResponse);
      return true;


    case "AGENT_DISCONNECT":
      handleAgentDisconnect().then(sendResponse);
      return true;

    case "AGENT_SET_PERMISSIONS":
      (async () => { const tabId = await getBoundAgentTabId(); if (tabId) getTabState(tabId).permissions = message.payload; sendResponse({ success: true }); })();
      return true;

    case "AGENT_CHAT":
      handleChat(message.payload).then(sendResponse);
      return true;

    case "AGENT_UPLOAD_ATTACHMENT":
      (async () => { const tabId = await getBoundAgentTabId(); if (!tabId) throw new Error("no active tab"); return uploadAgentAttachment(getTabState(tabId), message.payload); })().then(sendResponse).catch((error) => sendResponse({ error: String(error) }));
      return true;

    case "AGENT_DELETE_ATTACHMENT":
      (async () => { const tabId = await getBoundAgentTabId(); if (tabId) await deleteAgentAttachment(getTabState(tabId), message.payload.id); return { success: true }; })().then(sendResponse);
      return true;

    case "AGENT_ROLLBACK":
      handleRollback().then(sendResponse);
      return true;

    case "AGENT_START_VERIFICATION":
      handleStartVerification(message.payload.verification).then(sendResponse);
      return true;

    case "AGENT_CANCEL_CURRENT":
      handleCancelCurrent().then(sendResponse);
      return true;

    case "AGENT_GET_RUNTIME_STATE":
      (async () => {
        const tabId = await getBoundAgentTabId();
        const state = tabId ? getTabState(tabId) : undefined;
        sendResponse({ connected: state?.connected || false, testRun: state?.currentTestRun || null, agentWorking: state?.agentWorking || false, agentProgress: state?.agentProgress || "" });
      })();
      return true;

    // ---- Content script operations (forwarded to tab) ----
    case "DESIGN_MODE_ON":
    case "DESIGN_MODE_OFF":
    case "START_COMMENT_MODE":
    case "STOP_COMMENT_MODE":
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
      sendToBoundTab(message).then(sendResponse);
      return true;

    default:
      return false;
  }
});

// ============================================================
// Agent operation handlers
// ============================================================

async function restoreAgentPermissions(state: ReturnType<typeof getTabState>) {
  if (!state.agentUrl) return state.permissions;
  const scope = `${state.agentUrl}|${state.project?.root || "default"}`;
  const stored = await chrome.storage.local.get("agentPermissions");
  const saved = stored.agentPermissions?.[scope];
  state.permissions = {
    alwaysAllowEdits: saved?.alwaysAllowEdits === true,
    alwaysAllowAutomatedTesting: saved?.alwaysAllowAutomatedTesting === true,
  };
  return state.permissions;
}

async function handleAgentConnect(url: string, token: string, requestedTabId?: number) {
  const tabId = requestedTabId || await getBoundAgentTabId();
  if (!tabId) return { success: false, error: "尚未绑定页面，请在目标应用页面点击 Prism 插件图标" };
  const tab = await chrome.tabs.get(tabId);
  if (!isBindablePage(tab.url)) return { success: false, error: "当前页面不是可操作的 Web 页面" };
  await persistBoundAgentTab(tab);

  const state = getTabState(tabId);

  try {
    const project = await connectAgent(state, url, token, (eventType, data) => {
      // Forward agent WebSocket events to side panel
      if (eventType === "agent:start") {
        state.agentWorking = true;
        state.agentProgress = "Agent 正在处理…";
        broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
      } else if (eventType === "agent:progress") {
        state.agentWorking = true;
        state.agentProgress = (data as any)?.text || "Agent 正在处理…";
        broadcastToSidePanel({ type: "AGENT_PROGRESS", payload: { text: (data as any)?.text || "" } });
      } else if (eventType === "message.delta") {
        state.agentWorking = true;
        broadcastToSidePanel({ type: "AGENT_TEXT_DELTA", payload: { runId: (data as any)?.runId || "", delta: (data as any)?.delta || "", messageId: (data as any)?.messageId } });
      } else if (eventType === "agent:done") {
        state.agentWorking = false;
        state.agentProgress = "";
        broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
        // Reload static pages (file://) since they have no HMR/dev server
        sendToBoundTab({ type: "RELOAD_IF_STATIC" } as PrismMessage);
      } else if (eventType === "agent:error") {
        state.agentWorking = false;
        state.agentProgress = "";
        broadcastToSidePanel({ type: "AGENT_ERROR", payload: { message: (data as any)?.message || String(data) } });
      } else if (eventType === "connection_lost") {
        // Keep the current conversation mounted during the automatic retry.
        // A failure is reported only after the retry attempt completes.
      } else if (eventType === "connection_restored") {
        broadcastToSidePanel({ type: "AGENT_STATUS", payload: { connected: true, project: (data as any)?.project } });
        void getAgentRuntimeState(state).then((runtime) => {
          const activeAgent = runtime.activeAgentRuns[0];
          state.agentWorking = Boolean(activeAgent);
          state.agentProgress = activeAgent?.progress || "";
          if (activeAgent) {
            broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
            broadcastToSidePanel({ type: "AGENT_PROGRESS", payload: { text: activeAgent.progress } });
          }
        });
      } else if (eventType === "connection_reconnect_failed") {
        broadcastToSidePanel({ type: "AGENT_STATUS", payload: { connected: false, error: (data as any)?.error || "Agent 连接已中断" } });
      } else if (eventType === "test-run.updated") {
        state.currentTestRun = data as any;
        broadcastToSidePanel({ type: "TEST_RUN_UPDATE", payload: data as any });
      }
    }, (command) => executeCurrentTabCommand(tabId, command), tab.url);

    await restoreAgentPermissions(state);

    const runtime = await getAgentRuntimeState(state).catch(() => ({ activeTestRuns: [], activeAgentRuns: [] }));
    state.currentTestRun = runtime.activeTestRuns[0] || null;
    const activeAgent = runtime.activeAgentRuns[0];
    state.agentWorking = Boolean(activeAgent);
    state.agentProgress = activeAgent?.progress || "";

    // Persist URL
    chrome.storage.local.set({ agentUrl: url, agentToken: token });

    broadcastToSidePanel({
      type: "AGENT_STATUS",
      payload: { connected: true, project },
    });
    if (state.currentTestRun) broadcastToSidePanel({ type: "TEST_RUN_UPDATE", payload: state.currentTestRun });
    if (state.agentWorking) {
      broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
      broadcastToSidePanel({ type: "AGENT_PROGRESS", payload: { text: state.agentProgress } });
    }
    if (!state.agentWorking && !state.currentTestRun) broadcastToSidePanel({ type: "AGENT_RUNTIME_RESET" });

    return { success: true, project };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleAgentDisconnect() {
  const tabId = await getBoundAgentTabId();
  if (!tabId) return { success: false };

  const state = getTabState(tabId);
  disconnectAgent(state);

  broadcastToSidePanel({
    type: "AGENT_STATUS",
    payload: { connected: false },
  });

  return { success: true };
}

async function handleChat(payload: { message: string; attachmentIds?: string[] }) {
  const tabId = await getBoundAgentTabId();
  if (!tabId) return { success: false, error: "no active tab" };

  const state = getTabState(tabId);
  if (!state.connected) return { success: false, error: "not connected" };

  try {
    // A Manifest V3 service worker can restart independently of the side panel.
    // Restore the persisted project-scoped grant before every request instead
    // of relying on an earlier AGENT_SET_PERMISSIONS message still being in memory.
    await restoreAgentPermissions(state);
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: true } });
    let result: any = await chatWithAgent(state, payload.message, payload.attachmentIds);
    let iteration = 0;
    while (state.permissions.alwaysAllowAutomatedTesting && result.verification && iteration < 3) {
      const tested = await startAgentVerification(state, result.verification);
      result = { ...result, ...tested.agentResult, verification: tested.verification };
      if (tested.verification?.status === "passed") break;
      const canFix = state.permissions.alwaysAllowEdits
        && tested.verification?.status === "failed"
        && ["code_defect", "unknown"].includes(tested.verification?.failureCategory || "unknown");
      if (!canFix || iteration >= 2) break;
      iteration += 1;
      const failedCases = (tested.testRun?.cases || [])
        .filter((item: any) => item.status === "failed")
        .map((item: any) => `- ${item.title}：${item.failureReason || item.evidenceSummary || "测试未通过"}`)
        .join("\n");
      result = await chatWithAgent(state, [
        `这是自动修复闭环的第 ${iteration} 次修复（最多 3 次测试）。用户已开启“始终允许修改”和“始终允许自动测试”。`,
        `原测试目标：${tested.verification.goal}`,
        `测试结论：${tested.verification.summary || "测试未通过"}`,
        failedCases ? `失败用例：\n${failedCases}` : "",
        `建议修复方向：${tested.verification.fixSuggestion || "根据测试证据定位并进行最小修复"}`,
        "请修复代码并完成代码级检查。修改完成后生成相同目标的待测试项，由 Prism 自动继续真实浏览器测试。",
      ].filter(Boolean).join("\n\n"));
    }
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
    broadcastToSidePanel({
      type: "AGENT_RESULT",
      payload: {
        success: result.success,
        message: result.message,
        filesModified: result.filesModified,
        verification: (result as any).verification,
      },
    });
    return result;
  } catch (err) {
    broadcastToSidePanel({ type: "AGENT_WORKING", payload: { working: false } });
    broadcastToSidePanel({ type: "AGENT_ERROR", payload: { message: String(err) } });
    return { success: false, error: String(err) };
  }
}

async function handleStartVerification(verification: { id: string; goal: string; proposedChecks: string[] }) {
  const tabId = await getBoundAgentTabId();
  if (!tabId) return { success: false, error: "no active tab" };
  const state = getTabState(tabId);
  if (!state.connected) return { success: false, error: "not connected" };
  try {
    const result = await startAgentVerification(state, verification);
    return { success: true, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: /failed to fetch|networkerror|load failed/i.test(message) ? "Agent 服务连接已中断，本次测试未能完成，可重新测试。" : message };
  }
}

async function handleCancelCurrent() {
  const tabId = await getBoundAgentTabId();
  if (!tabId) return { success: false, error: "no active tab" };
  try {
    return await cancelCurrentAgentRun(getTabState(tabId));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleRollback() {
  const tabId = await getBoundAgentTabId();
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
