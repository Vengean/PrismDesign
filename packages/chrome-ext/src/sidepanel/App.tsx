import { useEffect, useState, useRef, useCallback } from "react";
import { LogOut } from "lucide-react";
import { t } from "../shared/i18n.js";
import type { PrismMessage } from "../shared/types.js";
import { useAgent } from "./hooks/use-agent";
import { useChat } from "./hooks/use-chat";
import { ChatPanel } from "./components/ChatPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import { SidePanelHeader } from "./components/SidePanelHeader";
import type { CommentAnnotation } from "../shared/types.js";

type ViewType = "chat" | "changes";

const VIEW_TITLE_KEYS: Record<ViewType, string> = {
  chat: "view.chat",
  changes: "view.changes",
};

export function App() {
  const agent = useAgent();
  const chat = useChat();
  const [view, setView] = useState<ViewType>("chat");
  const [commentMode, setCommentMode] = useState(false);
  const [pendingComments, setPendingComments] = useState<CommentAnnotation[]>([]);
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const connectionMenuRef = useRef<HTMLDivElement>(null);

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

  // Listen for page comments and legacy navigation events.
  useEffect(() => {
    const handler = (message: PrismMessage, sender: chrome.runtime.MessageSender) => {
      if (sender.tab) return;
      if (message.type === "OPEN_CHAT") {
        setView("chat");
      } else if (message.type === "OPEN_CHANGES") {
        setView("changes");
      } else if (message.type === "COMMENT_TARGET_SELECTED") {
        setPendingComments((prev) => [...prev, { element: message.payload, comment: "" }]);
        setCommentMode(false);
        setView("chat");
      } else if (message.type === "COMMENT_CANCELLED") {
        // Selecting an element creates the message annotation immediately.
        // Closing the page popup must not remove it from the message editor.
        setCommentMode(false);
        setView("chat");
      } else if (message.type === "COMMENT_ADDED") {
        setPendingComments((prev) => {
          const index = prev.findLastIndex((item) => item.element.domPath === message.payload.element.domPath && !item.comment);
          if (index < 0) return [...prev, message.payload];
          return prev.map((item, itemIndex) => itemIndex === index ? message.payload : item);
        });
        setCommentMode(false);
        setView("chat");
        chrome.runtime.sendMessage({ type: "STOP_COMMENT_MODE" }).catch(() => {});
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const handleToggleCommentMode = useCallback(() => {
    setCommentMode((active) => {
      chrome.runtime.sendMessage({ type: active ? "STOP_COMMENT_MODE" : "START_COMMENT_MODE" }).catch(() => {});
      return !active;
    });
  }, []);

  useEffect(() => {
    if (!commentMode) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCommentMode(false);
      chrome.runtime.sendMessage({ type: "STOP_COMMENT_MODE" }).catch(() => {});
    };
    document.addEventListener("keydown", exitOnEscape);
    return () => document.removeEventListener("keydown", exitOnEscape);
  }, [commentMode]);

  const handleRestoreMessage = useCallback((_message: string, restoredComments: CommentAnnotation[]) => {
    setPendingComments(restoredComments);
    setView("chat");
  }, []);

  const handleRemoveComment = useCallback((index: number) => {
    setPendingComments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEditComment = useCallback((index: number, comment: string) => {
    setPendingComments((prev) => prev.map((item, i) => i === index ? { ...item, comment } : item));
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <SidePanelHeader>
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
      </SidePanelHeader>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {view === "chat" && <ChatPanel agent={agent} chat={chat} selection={null} comments={pendingComments} onEditComment={handleEditComment} onRemoveComment={handleRemoveComment} onCommentsSent={() => setPendingComments([])} commentMode={commentMode} onToggleCommentMode={handleToggleCommentMode} onRestoreMessage={handleRestoreMessage} />}
        {view === "changes" && <ChangesPanel />}
      </div>
    </div>
  );
}
