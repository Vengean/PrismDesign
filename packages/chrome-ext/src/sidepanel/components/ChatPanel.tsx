import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { useChat } from "../hooks/use-chat";
import Markdown from "react-markdown";

export function ChatPanel() {
  const { messages, sending, sendMessage, clearHistory } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
            <MessageSquare className="h-8 w-8 text-primary/30" />
            <p className="text-center leading-relaxed">
              描述你想要的修改，<br />AI 会直接修改源代码。
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "ai" && (
                <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                  AI
                </div>
              )}
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}
              >
                {msg.role === "ai" && msg.content !== "思考中..." ? (
                  <div className="prose prose-xs prose-slate max-w-none [&_pre]:bg-slate-900 [&_pre]:text-slate-200 [&_pre]:rounded-md [&_pre]:p-2 [&_pre]:text-[10px] [&_code]:bg-primary/10 [&_code]:text-primary [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px] [&_table]:text-[10px] [&_table_td]:border [&_table_td]:px-1.5 [&_table_td]:py-0.5 [&_table_th]:border [&_table_th]:px-1.5 [&_table_th]:py-0.5 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : (
                  <span className={msg.content === "思考中..." ? "animate-pulse" : ""}>{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t p-2 flex gap-1.5">
        <textarea
          className="flex-1 min-h-[36px] max-h-[80px] px-2.5 py-1.5 text-xs border rounded-md resize-none bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="描述修改内容... (Ctrl+Enter 发送)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={1}
        />
        <div className="flex flex-col gap-1">
          <Button size="icon" className="h-7 w-7" onClick={handleSend} disabled={sending || !input.trim()}>
            <Send className="h-3 w-3" />
          </Button>
          {messages.length > 0 && (
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={clearHistory} title="清空历史">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
