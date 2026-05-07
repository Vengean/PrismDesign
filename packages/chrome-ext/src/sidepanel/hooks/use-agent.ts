import { useState, useEffect, useCallback, useRef } from "react";
import type { ProjectInfo, PrismMessage } from "../../shared/types.js";
import { t } from "../../shared/i18n.js";

export function useAgent() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [aiWorking, setAiWorking] = useState(false);
  const [agentUrl, setAgentUrl] = useState(() => {
    // Default to current page's hostname so LAN access works out of the box
    try {
      const host = new URL(window.location.href).hostname || "localhost";
      return `http://${host}:9527`;
    } catch {
      return "http://localhost:9527";
    }
  });

  // Load saved URL (overrides default if exists)
  useEffect(() => {
    chrome.storage.local.get("agentUrl", (result) => {
      if (result.agentUrl) setAgentUrl(result.agentUrl);
    });
  }, []);

  // Listen for agent events from background
  const connectingRef = useRef(false);
  useEffect(() => {
    const handler = (message: PrismMessage) => {
      switch (message.type) {
        case "AGENT_STATUS":
          // Ignore "disconnected" broadcasts while we're actively connecting
          // (e.g. from tab activation race)
          if (!message.payload.connected && connectingRef.current) break;
          setConnected(message.payload.connected);
          setConnecting(false);
          connectingRef.current = false;
          if (message.payload.project) setProject(message.payload.project as ProjectInfo);
          break;
        case "AGENT_WORKING":
          setAiWorking(message.payload.working);
          break;
        case "AGENT_ERROR":
          setAiWorking(false);
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const connect = useCallback(async (url: string) => {
    setConnecting(true);
    connectingRef.current = true;
    setError(null);
    setAgentUrl(url);
    try {
      const result = await chrome.runtime.sendMessage({ type: "AGENT_CONNECT", payload: { url } }) as any;
      if (!result?.success) {
        setConnecting(false);
        setConnected(false);
        setError(result?.error || t("agent.connectFailed"));
      }
    } catch {
      setConnecting(false);
      setConnected(false);
      setError(t("agent.connectFailed"));
    }
  }, []);

  const disconnect = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "AGENT_DISCONNECT" });
    setConnected(false);
    setProject(null);
  }, []);

  const applyChanges = useCallback(async (changes: unknown[], pagePath?: string, supplement?: string) => {
    return chrome.runtime.sendMessage({
      type: "AGENT_APPLY_CHANGES",
      payload: { changes, pagePath, supplement },
    }) as Promise<{ success: boolean; message: string; filesModified?: string[] }>;
  }, []);

  const chat = useCallback(async (message: string, context: { pagePath: string; components: unknown[] }) => {
    return chrome.runtime.sendMessage({
      type: "AGENT_CHAT",
      payload: { message, context },
    }) as Promise<{ success: boolean; message: string }>;
  }, []);

  const rollback = useCallback(async () => {
    return chrome.runtime.sendMessage({ type: "AGENT_ROLLBACK" }) as Promise<{ success: boolean }>;
  }, []);

  return {
    connected, connecting, error, project, aiWorking, agentUrl, setAgentUrl,
    connect, disconnect, applyChanges, chat, rollback,
  };
}
