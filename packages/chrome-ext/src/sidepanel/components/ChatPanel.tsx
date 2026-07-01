import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Trash2, MessageSquare, Plug, Loader2, AlertCircle } from "lucide-react";
import { t } from "../../shared/i18n.js";
import type { ChatMessage, ElementSelection } from "../../shared/types.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  agentUrl: string;
  setAgentUrl: (url: string) => void;
  connect: (url: string) => Promise<void>;
}

interface ChatState {
  messages: ChatMessage[];
  sending: boolean;
  sendMessage: (text: string) => void;
  clearHistory: () => void;
}

export function ChatPanel({ agent, chat, selection }: { agent: AgentState; chat: ChatState; selection: ElementSelection | null }) {
  if (!agent.connected && !agent.connecting) {
    return <ConnectionForm agent={agent} />;
  }
  if (agent.connecting) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p>{t("agent.connecting")}</p>
      </div>
    );
  }
  return <ChatView chat={chat} selection={selection} />;
}

function ConnectionForm({ agent }: { agent: AgentState }) {
  const [url, setUrl] = useState(agent.agentUrl);

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 gap-4">
      <div className="text-center space-y-2">
        <Plug className="h-10 w-10 text-primary/30 mx-auto" />
        <p className="text-sm font-medium">{t("agent.connectTitle")}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("agent.connectDesc")}
        </p>
      </div>
      <div className="w-full space-y-2">
        <Input
          placeholder={agent.agentUrl}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") agent.connect(url); }}
        />
        <Button className="w-full" onClick={() => agent.connect(url)}>
          <Plug className="h-3.5 w-3.5 mr-1.5" />
          {t("agent.connect")}
        </Button>
        {agent.error && (
          <div className="flex items-start gap-1.5 p-2 rounded-md bg-destructive/10 text-destructive text-xs leading-relaxed">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{agent.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSelectionContext(sel: ElementSelection): string {
  const lines: string[] = [];
  lines.push(`Page: ${sel.pagePath}`);
  lines.push(`Element: <${sel.tagName}> ${sel.domPath}`);
  if (sel.componentChain) {
    // Keep only the last few meaningful components to avoid noise
    const parts = sel.componentChain.split(" > ");
    const trimmed = parts.length > 5 ? "... > " + parts.slice(-5).join(" > ") : sel.componentChain;
    lines.push(`Component: ${trimmed}`);
  }
  if (sel.component?.sourceFile) {
    let loc = sel.component.sourceFile;
    if (sel.component.sourceLine) loc += `:${sel.component.sourceLine}`;
    lines.push(`Source: ${loc}`);
  }
  if (sel.component?.props && Object.keys(sel.component.props).length > 0) {
    const propEntries = Object.entries(sel.component.props).slice(0, 8);
    const propStr = propEntries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
    lines.push(`Props: ${propStr}`);
  }
  if (sel.id) lines.push(`id: ${sel.id}`);
  if (sel.className) lines.push(`class: ${sel.className.split(" ").slice(0, 5).join(" ")}`);
  if (sel.textContent) {
    lines.push(`DOM Structure:`);
    lines.push(sel.textContent);
  }
  return lines.join("\n");
}

function ChatView({ chat, selection }: { chat: ChatState; selection: ElementSelection | null }) {
  const { messages, sending, sendMessage, clearHistory } = chat;
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    let message = input;
    if (selection) {
      message += `\n\n--- Context ---\n${formatSelectionContext(selection)}`;
    }
    sendMessage(message);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
            <MessageSquare className="h-8 w-8 text-primary/30" />
            <p className="text-center leading-relaxed">{t("chat.empty").split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "ai" && (
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">AI</div>
              )}
              <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${msg.role === "user" ? "bg-blue-100 text-gray-900 rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"}`}>
                {msg.content.startsWith("⏳") ? (
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                    <span className="text-muted-foreground">{msg.content.slice(2)}</span>
                  </div>
                ) : (
                  <div className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t p-2 space-y-1.5">
        <textarea
          className="w-full min-h-[60px] max-h-[120px] px-2.5 py-2 text-xs border rounded-md resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("chat.placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={3}
        />
        <div className="flex justify-end gap-1">
          {messages.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1" onClick={clearHistory}>
              <Trash2 className="h-3 w-3" />
              {t("chat.clearHistory")}
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs px-3 gap-1" onClick={handleSend} disabled={sending || !input.trim()}>
            <Send className="h-3 w-3" />
            {t("chat.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
