import { useState, useEffect, useCallback } from "react";
import type { ChatMessage, PrismMessage } from "../../shared/types.js";
import { t } from "../../shared/i18n.js";

const STORAGE_KEY = "pd-chat-history";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  // Load from storage
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (result[STORAGE_KEY]) setMessages(result[STORAGE_KEY]);
    });
  }, []);

  // Save to storage on change
  useEffect(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: messages });
  }, [messages]);

  // Listen for agent progress and results
  useEffect(() => {
    const handler = (message: PrismMessage) => {
      if (message.type === "AGENT_PROGRESS") {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.findLastIndex((m) => m.role === "ai" && m.content.startsWith("⏳"));
          if (lastIdx >= 0) {
            updated[lastIdx] = { ...updated[lastIdx], content: `⏳ ${message.payload.text}` };
          }
          return updated;
        });
        return;
      }
      if (message.type === "AGENT_RESULT") {
        setSending(false);
        setMessages((prev) => {
          const updated = [...prev];
          // Replace last "thinking" message
          const lastIdx = updated.findLastIndex((m) => m.role === "ai" && m.content.startsWith("⏳"));
          if (lastIdx >= 0) {
            updated[lastIdx] = {
              role: "ai",
              content: message.payload.success
                ? message.payload.message || t("chat.done")
                : `${t("chat.error")}: ${message.payload.message}`,
              timestamp: Date.now(),
            };
          } else {
            updated.push({
              role: "ai",
              content: message.payload.message || "已完成。",
              timestamp: Date.now(),
            });
          }
          return updated;
        });
      } else if (message.type === "AGENT_ERROR") {
        setSending(false);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.findLastIndex((m) => m.role === "ai" && m.content.startsWith("⏳"));
          if (lastIdx >= 0) {
            updated[lastIdx] = { role: "ai", content: `${t("chat.error")}: ${message.payload.message}`, timestamp: Date.now() };
          }
          return updated;
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const sendMessage = useCallback(async (text: string, context?: { pagePath: string; components: unknown[] }) => {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    const thinkingMsg: ChatMessage = { role: "ai", content: `⏳ ${t("chat.thinking")}`, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setSending(true);

    chrome.runtime.sendMessage({
      type: "AGENT_CHAT",
      payload: {
        message: text,
        context: context || { pagePath: "/", components: [] },
      },
    }).catch(() => {
      setSending(false);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.findLastIndex((m) => m.content.startsWith("⏳"));
        if (lastIdx >= 0) updated[lastIdx] = { role: "ai", content: t("chat.requestFailed"), timestamp: Date.now() };
        return updated;
      });
    });
  }, [sending]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    chrome.storage.local.remove(STORAGE_KEY);
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "ai", content, timestamp: Date.now() }]);
  }, []);

  return { messages, sending, sendMessage, clearHistory, addSystemMessage };
}
