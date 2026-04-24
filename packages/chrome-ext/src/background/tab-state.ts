import type { ProjectInfo } from "../shared/types.js";

export interface TabState {
  agentUrl: string | null;
  connected: boolean;
  project: ProjectInfo | null;
  ws: WebSocket | null;
  designMode: boolean;
}

const tabs = new Map<number, TabState>();

export function getTabState(tabId: number): TabState {
  if (!tabs.has(tabId)) {
    tabs.set(tabId, {
      agentUrl: null,
      connected: false,
      project: null,
      ws: null,
      designMode: false,
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
