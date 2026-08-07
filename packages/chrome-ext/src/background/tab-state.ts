import type { ProjectInfo, TestRunInfo } from "../shared/types.js";

export interface TabState {
  clientId: string;
  agentUrl: string | null;
  connected: boolean;
  project: ProjectInfo | null;
  ws: WebSocket | null;
  designMode: boolean;
  currentTestRun: TestRunInfo | null;
  agentWorking: boolean;
  agentProgress: string;
}

const tabs = new Map<number, TabState>();

export function getTabState(tabId: number): TabState {
  if (!tabs.has(tabId)) {
    tabs.set(tabId, {
      clientId: `chrome-tab-${tabId}`,
      agentUrl: null,
      connected: false,
      project: null,
      ws: null,
      designMode: false,
      currentTestRun: null,
      agentWorking: false,
      agentProgress: "",
    });
  }
  return tabs.get(tabId)!;
}

export function removeTab(tabId: number) {
  const state = tabs.get(tabId);
  if (state?.ws) {
    try { state.ws.close(); } catch {}
  }
  tabs.delete(tabId);
}

export function getAllTabs() {
  return tabs;
}
