import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentPermissions, ProjectInfo, PrismMessage } from "../../shared/types.js";
import { t } from "../../shared/i18n.js";

export function useAgent() {
  const [permissions, setPermissions] = useState<AgentPermissions>({ alwaysAllowEdits: false, alwaysAllowAutomatedTesting: false });
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [aiWorking, setAiWorking] = useState(false);
  const [agentToken, setAgentToken] = useState("");
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
    chrome.storage.local.get(["agentUrl", "agentToken"], (result) => {
      if (result.agentUrl) setAgentUrl(result.agentUrl);
      if (result.agentToken) setAgentToken(result.agentToken);
    });
  }, []);

  useEffect(() => {
    if (!connected || !agentUrl) return;
    const scope = `${agentUrl}|${project?.root || "default"}`;
    chrome.storage.local.get("agentPermissions", (result) => {
      const saved = result.agentPermissions?.[scope];
      const next = {
        alwaysAllowEdits: saved?.alwaysAllowEdits === true,
        alwaysAllowAutomatedTesting: saved?.alwaysAllowAutomatedTesting === true,
      };
      setPermissions(next);
      chrome.runtime.sendMessage({ type: "AGENT_SET_PERMISSIONS", payload: next }).catch(() => {});
    });
  }, [connected, agentUrl, project?.root]);

  const updatePermission = useCallback(async (key: keyof AgentPermissions, enabled: boolean) => {
    const next = { ...permissions, [key]: enabled };
    setPermissions(next);
    const scope = `${agentUrl}|${project?.root || "default"}`;
    const result = await chrome.storage.local.get("agentPermissions");
    await chrome.storage.local.set({ agentPermissions: { ...(result.agentPermissions || {}), [scope]: next } });
    await chrome.runtime.sendMessage({ type: "AGENT_SET_PERMISSIONS", payload: next });
  }, [permissions, agentUrl, project?.root]);

  // Listen for agent events from background
  const connectingRef = useRef(false);
  const connectedRef = useRef(false);
  useEffect(() => {
    const handler = (message: PrismMessage) => {
      switch (message.type) {
        case "AGENT_STATUS":
          // Auto-connect "connecting" broadcast
          if (message.payload.connecting) {
            if (!connectedRef.current) setConnecting(true);
            connectingRef.current = true;
            setError(null);
            if (message.payload.agentUrl) setAgentUrl(message.payload.agentUrl);
            break;
          }
          // Ignore "disconnected" broadcasts while we're actively connecting
          // (e.g. from tab activation race) — unless it carries an error
          if (!message.payload.connected && connectingRef.current && !message.payload.error) break;
          connectedRef.current = message.payload.connected;
          setConnected(message.payload.connected);
          setConnecting(false);
          connectingRef.current = false;
          if (message.payload.error) setError(message.payload.error);
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

  const connect = useCallback(async (url: string, token: string) => {
    setConnecting(true);
    connectingRef.current = true;
    setError(null);
    setAgentUrl(url);
    try {
      const result = await chrome.runtime.sendMessage({ type: "AGENT_CONNECT", payload: { url, token } }) as any;
      if (!result?.success) {
        setConnecting(false);
        connectedRef.current = false;
        setConnected(false);
        setError(result?.error || t("agent.connectFailed"));
      }
    } catch {
      setConnecting(false);
      connectedRef.current = false;
      setConnected(false);
      setError(t("agent.connectFailed"));
    }
  }, []);

  const disconnect = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "AGENT_DISCONNECT" });
    connectedRef.current = false;
    setConnected(false);
    setProject(null);
  }, []);

  const rollback = useCallback(async () => {
    return chrome.runtime.sendMessage({ type: "AGENT_ROLLBACK" }) as Promise<{ success: boolean }>;
  }, []);

  return {
    connected, connecting, error, project, aiWorking, agentUrl, setAgentUrl, agentToken, setAgentToken,
    connect, disconnect, rollback, permissions, updatePermission,
  };
}
