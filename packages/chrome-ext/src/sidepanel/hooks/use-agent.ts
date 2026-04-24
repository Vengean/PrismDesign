import { useState, useEffect, useCallback } from "react";
import type { ProjectInfo, PrismMessage } from "../../shared/types.js";

export function useAgent() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [aiWorking, setAiWorking] = useState(false);
  const [agentUrl, setAgentUrl] = useState("http://localhost:9527");

  // Load saved URL
  useEffect(() => {
    chrome.storage.local.get("agentUrl", (result) => {
      if (result.agentUrl) setAgentUrl(result.agentUrl);
    });
  }, []);

  // Listen for agent events from background
  useEffect(() => {
    const handler = (message: PrismMessage) => {
      switch (message.type) {
        case "AGENT_STATUS":
          setConnected(message.payload.connected);
          setConnecting(false);
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
    setAgentUrl(url);
    try {
      const result = await chrome.runtime.sendMessage({ type: "AGENT_CONNECT", payload: { url } }) as any;
      if (!result?.success) {
        setConnecting(false);
        setConnected(false);
      }
    } catch {
      setConnecting(false);
      setConnected(false);
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
    connected, connecting, project, aiWorking, agentUrl, setAgentUrl,
    connect, disconnect, applyChanges, chat, rollback,
  };
}
