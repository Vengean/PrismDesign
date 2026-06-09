import { useEffect, useState, useRef, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
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
import type { StyleEditEvent } from "./components/PropertiesPanel";
import { ChangesPanel } from "./components/ChangesPanel";
import { PendingPanel } from "./components/PendingPanel";
import type { PendingComment, PendingEdit, PendingDrag } from "./components/PendingPanel";

type ViewType = "chat" | "navigator" | "properties" | "changes" | "pending";

const VIEW_TITLE_KEYS: Record<ViewType, string> = {
  chat: "view.chat",
  navigator: "view.navigator",
  properties: "view.properties",
  changes: "view.changes",
  pending: "view.pending",
};

export function App() {
  const agent = useAgent();
  const chat = useChat();
  const [view, setView] = useState<ViewType>("chat");
  const [isDragMode, setIsDragMode] = useState(false);
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [pendingEdits, setPendingEdits] = useState<Map<string, PendingEdit>>(new Map());
  const [pendingDrags, setPendingDrags] = useState<PendingDrag[]>([]);
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

  const pendingTotal = pendingComments.length + pendingEdits.size + pendingDrags.length;

  // Disable toolbar when AI is working
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "TOOLBAR_DISABLE", payload: { disabled: agent.aiWorking } });
  }, [agent.aiWorking]);

  // Sync pending count badge to toolbar
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "UPDATE_PENDING_COUNT", payload: { count: pendingTotal } }).catch(() => {});
  }, [pendingTotal]);

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
      } else if (message.type === "OPEN_PENDING") {
        setView("pending");
      } else if (message.type === "COMMENT_ADDED") {
        setPendingComments((prev) => [...prev, message.payload]);
        setView("pending");
      } else if (message.type === "DRAG_MOVE") {
        setPendingDrags((prev) => [...prev, message.payload]);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // ── Style edit merge logic ──
  const handleStyleEdit = useCallback((edit: StyleEditEvent) => {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      const key = edit.element.domPath;
      const existing = next.get(key);

      if (existing) {
        const props = { ...existing.properties };
        const prevEntry = props[edit.property];
        // Keep the original oldValue from the first edit
        const origOld = prevEntry ? prevEntry.oldValue : edit.oldValue;
        // If new value === original old value, user reverted — remove this property
        if (edit.newValue === origOld) {
          delete props[edit.property];
        } else {
          props[edit.property] = { oldValue: origOld, newValue: edit.newValue };
        }
        // If no properties left, remove the element entirely
        if (Object.keys(props).length === 0) {
          next.delete(key);
        } else {
          next.set(key, { ...existing, properties: props });
        }
      } else {
        // First edit for this element
        if (edit.newValue !== edit.oldValue) {
          next.set(key, {
            element: edit.element,
            properties: { [edit.property]: { oldValue: edit.oldValue, newValue: edit.newValue } },
          });
        }
      }

      return next;
    });
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

  const handleRemoveEdit = useCallback((domPath: string) => {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.delete(domPath);
      return next;
    });
  }, []);

  const handleRemoveDrag = useCallback((index: number) => {
    setPendingDrags((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Sync: format all pending items as a single message ──
  const handleSync = useCallback(() => {
    const editsArr = Array.from(pendingEdits.values());
    if (pendingComments.length === 0 && editsArr.length === 0 && pendingDrags.length === 0) return;

    const PROP_LABELS: Record<string, string> = {
      color: t("props.color"), backgroundColor: t("props.background"), "background-color": t("props.background"),
      fontSize: t("props.fontSize"), "font-size": t("props.fontSize"),
      fontWeight: t("props.fontWeight"), "font-weight": t("props.fontWeight"),
      opacity: t("props.opacity"), borderRadius: t("props.borderRadius"), "border-radius": t("props.borderRadius"),
      padding: t("sync.padding"), margin: t("sync.margin"), gap: t("props.gap"),
    };

    function formatElementInfo(el: typeof pendingComments[0]["element"]): string[] {
      const comp = el.component;
      const name = comp?.name || `<${el.tagName}>`;
      const lines: string[] = [];

      lines.push(`**${name}**${el.id ? ` #${el.id}` : ""}${el.tagName !== name ? ` \`<${el.tagName}>\`` : ""}`);

      if (el.pagePath && el.pagePath !== "/") lines.push(`${t("sync.page")}: ${el.pagePath}`);

      if (el.componentChainDetail?.length > 0) {
        const chainStr = el.componentChainDetail.map((item) => {
          let s = item.name;
          if (item.sourceFile) {
            const short = item.sourceFile.split("/").slice(-2).join("/");
            s += `(${short}${item.sourceLine ? `:${item.sourceLine}` : ""}${item.sourceColumn ? `:${item.sourceColumn}` : ""})`;
          }
          return s;
        }).join(" > ");
        lines.push(`${t("sync.chain")}: ${chainStr}`);
      } else if (el.componentChain) {
        lines.push(`${t("sync.chain")}: ${el.componentChain}`);
      }

      if (comp?.sourceFile) {
        let loc = comp.sourceFile;
        if (comp.sourceLine) loc += `:${comp.sourceLine}`;
        if (comp.sourceColumn) loc += `:${comp.sourceColumn}`;
        lines.push(`${t("sync.source")}: ${loc}`);
      }

      if (el.role) lines.push(`role: ${el.role}`);
      if (el.ariaLabel) lines.push(`aria-label: ${el.ariaLabel}`);
      if (el.textContent) lines.push(`${t("sync.text")}: "${el.textContent.slice(0, 60)}"`);

      return lines;
    }

    const parts: string[] = [];

    // Style edits
    for (const edit of editsArr) {
      const lines = formatElementInfo(edit.element);
      lines.push(`${t("sync.modify")}:`);
      for (const [prop, { oldValue, newValue }] of Object.entries(edit.properties)) {
        const label = PROP_LABELS[prop] || prop;
        lines.push(`- ${label}: ${oldValue || t("pending.none")} → ${newValue}`);
      }
      parts.push(lines.join("\n"));
    }

    // Drag moves
    for (const d of pendingDrags) {
      const lines = formatElementInfo(d.element);
      lines.push(`${t("sync.move")}: ${t("pending.itemN", { n: d.from + 1 })} → ${t("pending.itemN", { n: d.to + 1 })}`);
      parts.push(lines.join("\n"));
    }

    // Comments
    for (const c of pendingComments) {
      const lines = formatElementInfo(c.element);
      lines.push(`${t("sync.comment")}: ${c.comment}`);
      parts.push(lines.join("\n"));
    }

    setPendingComments([]);
    setPendingEdits(new Map());
    setPendingDrags([]);
    setView("chat");
    chat.sendMessage(parts.join("\n\n---\n\n"));
  }, [pendingComments, pendingEdits, pendingDrags, chat]);

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
        {(view === "navigator" || view === "pending") && (
          <button
            className="flex items-center text-xs text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
            onClick={handleBackToChat}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <span className="font-semibold text-xs">{t(VIEW_TITLE_KEYS[view])}</span>
        {view === "chat" && (
          <div className="ml-auto">
            {agent.connected
              ? <div className="w-1.5 h-1.5 rounded-full bg-green-500" title={t("agent.connected")} />
              : agent.connecting
                ? <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" title={t("agent.connecting_short")} />
                : <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" title={t("agent.disconnected")} />}
          </div>
        )}
        {view === "pending" && (
          <span className="ml-auto text-[10px] text-muted-foreground">{t("pending.count", { n: pendingTotal })}</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {view === "chat" && <ChatPanel agent={agent} chat={chat} selection={selection} />}
        {view === "navigator" && (
          <Navigator selection={selection} tree={tree} refreshTree={refreshTree} highlightElement={highlightElement} unhighlightElement={unhighlightElement} selectElement={selectElement} />
        )}
        {view === "properties" && (
          <PropertiesPanel selection={selection} applyStylePreview={applyStylePreview} onStyleEdit={handleStyleEdit} />
        )}
        {view === "changes" && <ChangesPanel />}
        {view === "pending" && (
          <PendingPanel
            comments={pendingComments}
            edits={Array.from(pendingEdits.values())}
            drags={pendingDrags}
            onRemoveComment={handleRemoveComment}
            onRemoveEdit={handleRemoveEdit}
            onRemoveDrag={handleRemoveDrag}
            onSync={handleSync}
          />
        )}
      </div>
    </div>
  );
}
