import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import type { PrismMessage } from "../shared/types.js";
import { useAgent } from "./hooks/use-agent";
import { useChat } from "./hooks/use-chat";
import { useChanges } from "./hooks/use-changes";
import { useElement } from "./hooks/use-element";
import { ChatPanel } from "./components/ChatPanel";
import { Navigator } from "./components/Navigator";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import { PendingPanel } from "./components/PendingPanel";
import type { PendingComment } from "./components/PendingPanel";

type ViewType = "chat" | "navigator" | "properties" | "changes" | "pending";

const VIEW_TITLES: Record<ViewType, string> = {
  chat: "对话",
  navigator: "导航",
  properties: "属性",
  changes: "变更",
  pending: "评论",
};

export function App() {
  const agent = useAgent();
  const chat = useChat();
  const [view, setView] = useState<ViewType>("chat");
  const [isDragMode, setIsDragMode] = useState(false);
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const isDragModeRef = useRef(false);
  isDragModeRef.current = isDragMode;

  const { selection, clearSelection, applyStylePreview, highlightElement, unhighlightElement, selectElement } = useElement({
    onSelected: () => {
      if (!isDragModeRef.current) setView("properties");
    },
    onDeselected: () => {
      if (view === "properties") setView("navigator");
    },
  });
  const changes = useChanges();

  // Side panel lifecycle — port to background manages everything:
  // open → show toolbar + connect agent; close → hide toolbar + disconnect agent.
  // Reconnects automatically when the service worker restarts.
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let unmounted = false;

    function connectPort() {
      if (unmounted) return;
      try {
        port = chrome.runtime.connect({ name: "prism-sidepanel" });
        port.onDisconnect.addListener(() => {
          port = null;
          // Service worker restarted — reconnect after a short delay
          if (!unmounted) setTimeout(connectPort, 500);
        });
      } catch {
        // Extension context gone
      }
    }
    connectPort();

    return () => {
      unmounted = true;
      port?.disconnect();
    };
  }, []);

  // Disable toolbar when AI is working; re-enable when done
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "TOOLBAR_DISABLE", payload: { disabled: agent.aiWorking } });
  }, [agent.aiWorking]);

  // Listen for toolbar mode changes and comments from content script
  useEffect(() => {
    const handler = (message: PrismMessage, sender: chrome.runtime.MessageSender) => {
      // Only process messages forwarded by the background, skip direct content-script messages
      if (sender.tab) return;
      if (message.type === "OPEN_CHAT") {
        setView("chat");
        setIsDragMode(false);
      } else if (message.type === "OPEN_NAVIGATOR") {
        setView("navigator");
        setIsDragMode(message.payload?.mode === "drag");
      } else if (message.type === "OPEN_CHANGES") {
        setView("changes");
      } else if (message.type === "OPEN_PENDING") {
        setView("pending");
      } else if (message.type === "COMMENT_ADDED") {
        setPendingComments((prev) => [...prev, message.payload]);
        setView("pending");
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleBack = () => {
    clearSelection();
    setView("navigator");
  };

  const handleRemoveComment = useCallback((index: number) => {
    setPendingComments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSync = useCallback(() => {
    if (pendingComments.length === 0) return;
    const parts = pendingComments.map((c) => {
      const el = c.element;
      const comp = el.component;
      const name = comp?.name || `<${el.tagName}>`;
      const lines: string[] = [];

      // Header: component name + element tag
      lines.push(`**${name}**${el.id ? ` #${el.id}` : ""}${el.tagName !== name ? ` \`<${el.tagName}>\`` : ""}`);

      // Page path (skip root "/")
      if (el.pagePath && el.pagePath !== "/") lines.push(`页面: ${el.pagePath}`);

      // Component chain with source locations
      if (el.componentChainDetail?.length > 0) {
        const chainStr = el.componentChainDetail.map((item) => {
          let s = item.name;
          if (item.sourceFile) {
            const short = item.sourceFile.split("/").slice(-2).join("/");
            s += `(${short}${item.sourceLine ? `:${item.sourceLine}` : ""}${item.sourceColumn ? `:${item.sourceColumn}` : ""})`;
          }
          return s;
        }).join(" > ");
        lines.push(`组件链: ${chainStr}`);
      } else if (el.componentChain) {
        lines.push(`组件链: ${el.componentChain}`);
      }

      // Direct source location
      if (comp?.sourceFile) {
        let loc = comp.sourceFile;
        if (comp.sourceLine) loc += `:${comp.sourceLine}`;
        if (comp.sourceColumn) loc += `:${comp.sourceColumn}`;
        lines.push(`源码: ${loc}`);
      }

      // Semantic hints
      if (el.role) lines.push(`role: ${el.role}`);
      if (el.ariaLabel) lines.push(`aria-label: ${el.ariaLabel}`);
      if (el.textContent) lines.push(`文本: "${el.textContent.slice(0, 60)}"`);

      // The comment itself
      lines.push(`评论: ${c.comment}`);

      return lines.join("\n");
    });
    setPendingComments([]);
    setView("chat");
    chat.sendMessage(parts.join("\n\n---\n\n"));
  }, [pendingComments, chat]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b bg-card">
        {view === "properties" && (
          <button
            className="flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
            onClick={handleBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="font-semibold text-xs">{VIEW_TITLES[view]}</span>
        {view === "chat" && (
          <div className="ml-auto">
            {agent.connected
              ? <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="已连接" />
              : agent.connecting
                ? <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" title="连接中" />
                : <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" title="未连接" />}
          </div>
        )}
        {view === "pending" && (
          <span className="ml-auto text-[10px] text-muted-foreground">{pendingComments.length} 条</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {view === "chat" && <ChatPanel agent={agent} chat={chat} />}
        {view === "navigator" && (
          <Navigator selection={selection} highlightElement={highlightElement} unhighlightElement={unhighlightElement} selectElement={selectElement} />
        )}
        {view === "properties" && <PropertiesPanel selection={selection} applyStylePreview={applyStylePreview} />}
        {view === "changes" && <ChangesPanel />}
        {view === "pending" && <PendingPanel comments={pendingComments} onRemove={handleRemoveComment} onSync={handleSync} />}
      </div>
    </div>
  );
}
