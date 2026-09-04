import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { t } from "../shared/i18n.js";
import type { PrismMessage } from "../shared/types.js";
import { useAgent } from "./hooks/use-agent";
import { useChat } from "./hooks/use-chat";
import { useChanges } from "./hooks/use-changes";
import { useElement } from "./hooks/use-element";
import { useNavigator } from "./hooks/use-navigator";
import { ChatPanel } from "./components/ChatPanel";
import { Navigator } from "./components/Navigator";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import type { CommentAnnotation } from "../shared/types.js";

type ViewType = "chat" | "navigator" | "properties" | "changes";

const VIEW_TITLE_KEYS: Record<ViewType, string> = {
  chat: "view.chat",
  navigator: "view.navigator",
  properties: "view.properties",
  changes: "view.changes",
};

export function App() {
  const agent = useAgent();
  const chat = useChat();
  const [view, setView] = useState<ViewType>("chat");
  const [isDragMode, setIsDragMode] = useState(false);
  const [pendingComments, setPendingComments] = useState<CommentAnnotation[]>([]);
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const connectionMenuRef = useRef<HTMLDivElement>(null);
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
  const { tree, refreshTree } = useNavigator();
  const changes = useChanges();

  // Refresh tree when entering navigator view
  useEffect(() => {
    if (view === "navigator") refreshTree();
  }, [view, refreshTree]);

  // Side panel lifecycle
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let unmounted = false;

    function connectPort() {
      if (unmounted) return;
      try {
        port = chrome.runtime.connect({ name: "prism-sidepanel" });
        port.onDisconnect.addListener(() => {
          port = null;
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

  useEffect(() => {
    if (!connectionMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!connectionMenuRef.current?.contains(event.target as Node)) setConnectionMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setConnectionMenuOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", closeOnEscape); };
  }, [connectionMenuOpen]);

  // Disable toolbar when AI is working
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "TOOLBAR_DISABLE", payload: { disabled: agent.aiWorking } });
  }, [agent.aiWorking]);

  // Listen for toolbar mode changes and comments
  useEffect(() => {
    const handler = (message: PrismMessage, sender: chrome.runtime.MessageSender) => {
      if (sender.tab) return;
      if (message.type === "OPEN_CHAT") {
        setView("chat");
        setIsDragMode(false);
      } else if (message.type === "OPEN_NAVIGATOR") {
        setView("navigator");
        setIsDragMode(message.payload?.mode === "drag");
      } else if (message.type === "OPEN_CHANGES") {
        setView("changes");
      } else if (message.type === "COMMENT_ADDED") {
        setPendingComments((prev) => [...prev, message.payload]);
        setView("chat");
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleBack = () => {
    // Don't clear selection — navigator needs it to scroll to the selected node
    setView("navigator");
  };

  const handleBackToChat = useCallback(() => {
    clearSelection();
    setView("chat");
    setIsDragMode(false);
    // Exit design mode and unhighlight on the page
    chrome.runtime.sendMessage({ type: "DESIGN_MODE_OFF" }).catch(() => {});
  }, [clearSelection]);

  const handleRemoveComment = useCallback((index: number) => {
    setPendingComments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditComment = useCallback((index: number, comment: string) => {
    setPendingComments((prev) => prev.map((item, i) => i === index ? { ...item, comment } : item));
  }, []);

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
        {view === "navigator" && (
          <button
            className="flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
            onClick={handleBackToChat}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="font-semibold text-xs">{t(VIEW_TITLE_KEYS[view])}</span>
        {view === "chat" && (
          <div ref={connectionMenuRef} className="relative ml-auto">
            {agent.connected
              ? <button
                  type="button"
                  className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title={t("agent.connected")}
                  aria-label={t("agent.connected")}
                  aria-expanded={connectionMenuOpen}
                  onClick={() => setConnectionMenuOpen((open) => !open)}
                ><span className="h-2 w-2 rounded-full bg-green-500" /></button>
              : agent.connecting
                ? <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" title={t("agent.connecting_short")} />
                : <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" title={t("agent.disconnected")} />}
            {agent.connected && connectionMenuOpen && <div className="absolute right-0 top-7 z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              <div className="truncate px-2 py-1.5 text-[10px] text-muted-foreground" title={agent.agentUrl}>{agent.agentUrl}</div>
              <div className="px-2 pb-1 pt-1.5 text-[10px] font-medium text-muted-foreground">{t("agent.permissions")}</div>
              {([['alwaysAllowEdits', 'agent.alwaysAllowEdits'], ['alwaysAllowAutomatedTesting', 'agent.alwaysAllowAutomatedTesting']] as const).map(([key, label]) => <label key={key} className="flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-xs hover:bg-muted">
                <span>{t(label)}</span>
                <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={agent.permissions[key]} onChange={(event) => agent.updatePermission(key, event.target.checked)} />
              </label>)}
              <div className="my-1 border-t" />
              <button type="button" className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-destructive hover:bg-muted" onClick={async () => { setConnectionMenuOpen(false); await agent.disconnect(); }}>
                <LogOut className="h-3.5 w-3.5" />{t("agent.disconnect")}
              </button>
            </div>}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {view === "chat" && <ChatPanel agent={agent} chat={chat} selection={selection} comments={pendingComments} onEditComment={handleEditComment} onRemoveComment={handleRemoveComment} onCommentsSent={() => setPendingComments([])} />}
        {view === "navigator" && (
          <Navigator selection={selection} tree={tree} refreshTree={refreshTree} highlightElement={highlightElement} unhighlightElement={unhighlightElement} selectElement={selectElement} />
        )}
        {view === "properties" && (
          <PropertiesPanel selection={selection} applyStylePreview={applyStylePreview} />
        )}
        {view === "changes" && <ChangesPanel />}
      </div>
    </div>
  );
}
