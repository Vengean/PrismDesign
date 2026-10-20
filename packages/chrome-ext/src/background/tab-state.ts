import type { AgentPermissions, ProjectInfo, TestRunInfo } from "../shared/types.js";

export interface TabState {
  clientId: string;
  agentUrl: string | null;
  agentToken: string | null;
  connected: boolean;
  project: ProjectInfo | null;
  ws: WebSocket | null;
  connectionAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  autoReconnect: boolean;
  designMode: boolean;
  currentTestRun: TestRunInfo | null;
  agentWorking: boolean;
  agentProgress: string;
  permissions: AgentPermissions;
}

const tabs = new Map<number, TabState>();

export function getTabState(tabId: number): TabState {
  if (!tabs.has(tabId)) {
    tabs.set(tabId, {
      clientId: `chrome-tab-${tabId}`,
      agentUrl: null,
      agentToken: null,
      connected: false,
      project: null,
      ws: null,
      connectionAttempt: 0,
      reconnectTimer: null,
      autoReconnect: true,
      designMode: false,
      currentTestRun: null,
      agentWorking: false,
      agentProgress: "",
      permissions: { alwaysAllowEdits: false, alwaysAllowAutomatedTesting: false },
    });
  }
  return tabs.get(tabId)!;
}

export function removeTab(tabId: number) {
  const state = tabs.get(tabId);
  if (state) state.autoReconnect = false;
  if (state?.reconnectTimer) clearTimeout(state.reconnectTimer);
  if (state?.ws) {
    try { state.ws.close(); } catch {}
  }
  tabs.delete(tabId);
}

export function getAllTabs() {
  return tabs;
}
