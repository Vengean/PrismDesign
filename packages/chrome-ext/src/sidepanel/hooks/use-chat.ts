import { useState, useEffect, useCallback } from "react";
import type { ChatMessage, PrismMessage, TestRunInfo } from "../../shared/types.js";
import { t } from "../../shared/i18n.js";

const STORAGE_KEY = "pd-chat-history";

function formatVerificationMessage(content: string): string {
  return content
    .replace(/^\s*VERIFICATION_RESULT:\s*PASSED\s*$/gim, "测试结论：通过")
    .replace(/^\s*VERIFICATION_RESULT:\s*FAILED\s*$/gim, "测试结论：未通过")
    .trim();
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  const applyTestRun = useCallback((run: TestRunInfo | null) => {
    if (!run) return;
    const active = ["preparing", "running", "cleaning"].includes(run.status);
    setSending(active);
    setMessages((prev) => {
      const updated = [...prev];
      const verificationIndex = updated.findLastIndex((message) => message.role === "ai" && message.verification?.id === run.verificationId);
      const pendingIndex = updated.findLastIndex((message) => message.role === "ai" && message.pending);
      const targetIndex = verificationIndex >= 0 ? verificationIndex : pendingIndex;
      const content = run.status === "cleaning" ? "⏳ 正在清理测试资源…" : "⏳ 测试运行中…";
      if (targetIndex >= 0) {
        updated[targetIndex] = {
          ...updated[targetIndex],
          testRun: run,
          content: active ? content : updated[targetIndex].content,
        };
      } else {
        updated.push({ role: "ai", content: active ? content : "测试运行已结束。", timestamp: Date.now(), pending: active, testRun: run });
      }
      return updated;
    });
  }, []);

  const applyAgentWorking = useCallback((working: boolean, progress = "Agent 正在处理…") => {
    setSending(working);
    if (!working) return;
    setMessages((prev) => {
      const updated = [...prev];
      const pendingIndex = updated.findLastIndex((message) => message.role === "ai" && message.pending);
      const content = `⏳ ${progress}`;
      if (pendingIndex >= 0) updated[pendingIndex] = { ...updated[pendingIndex], content };
      else updated.push({ role: "ai", content, timestamp: Date.now(), pending: true });
      return updated;
    });
  }, []);

  // Load from storage
  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (result[STORAGE_KEY]) {
        setMessages((result[STORAGE_KEY] as ChatMessage[])
          .filter((message) => !message.pending)
          .map((message) => {
            const interrupted = message.verification && ["preparing", "running"].includes(message.verification.status || "");
            return {
              ...message,
              content: /浏览器测试启动失败：Failed to fetch/i.test(message.content)
                ? "Agent 服务连接已中断，本次测试未能完成，可重新测试。"
                : formatVerificationMessage(message.content),
              verification: interrupted ? { ...message.verification!, status: "inconclusive", summary: "Agent 服务已中断，本次测试未能完成。" } : message.verification,
            };
          }));
      }
    });
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "AGENT_GET_RUNTIME_STATE" }).then((state) => {
      const runtime = state as { testRun?: TestRunInfo | null; agentWorking?: boolean; agentProgress?: string };
      applyTestRun(runtime?.testRun || null);
      if (runtime?.agentWorking) applyAgentWorking(true, runtime.agentProgress || "Agent 正在处理…");
    }).catch(() => {});
  }, [applyAgentWorking, applyTestRun]);

  // Save to storage on change
  useEffect(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: messages });
  }, [messages]);

  // Listen for agent progress and results
  useEffect(() => {
    const handler = (message: PrismMessage) => {
      if (message.type === "AGENT_WORKING") {
        applyAgentWorking(message.payload.working);
        return;
      }
      if (message.type === "AGENT_RUNTIME_RESET") {
        setSending(false);
        setMessages((prev) => prev.filter((item) => !item.pending));
        return;
      }
      if (message.type === "AGENT_PROGRESS") {
        applyAgentWorking(true, message.payload.text || "Agent 正在处理…");
        return;
      }
      if (message.type === "TEST_RUN_UPDATE") {
        applyTestRun(message.payload);
        return;
      }
      if (message.type === "AGENT_TEXT_DELTA") {
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.findLastIndex((m) => m.role === "ai" && m.pending);
          if (lastIdx >= 0) {
            const previous = updated[lastIdx];
            const switchedItem = !!message.payload.messageId && !!previous.streamItemId && message.payload.messageId !== previous.streamItemId;
            const current = previous.content.startsWith("⏳") || switchedItem ? "" : previous.content;
            updated[lastIdx] = { ...previous, content: current + message.payload.delta, streamItemId: message.payload.messageId || previous.streamItemId };
          }
          return updated;
        });
        return;
      }
      if (message.type === "AGENT_RESULT") {
        setSending(false);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.findLastIndex((m) => m.role === "ai" && m.pending);
          if (lastIdx >= 0) {
            const previous = updated[lastIdx];
            updated[lastIdx] = {
              ...previous,
              role: "ai",
              content: message.payload.success
                ? formatVerificationMessage(message.payload.message || t("chat.done"))
                : `${t("chat.error")}: ${formatVerificationMessage(message.payload.message)}`,
              timestamp: Date.now(),
              pending: false,
              verification: message.payload.verification || previous.verification,
            };
          } else {
            updated.push({
              role: "ai",
              content: formatVerificationMessage(message.payload.message || "已完成。"),
              timestamp: Date.now(),
              verification: message.payload.verification,
            });
          }
          return updated;
        });
      } else if (message.type === "AGENT_ERROR") {
        setSending(false);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.findLastIndex((m) => m.role === "ai" && m.pending);
          if (lastIdx >= 0) {
            updated[lastIdx] = { ...updated[lastIdx], content: `${t("chat.error")}: ${message.payload.message}`, timestamp: Date.now(), pending: false };
          }
          return updated;
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [applyAgentWorking, applyTestRun]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    const thinkingMsg: ChatMessage = { role: "ai", content: `⏳ ${t("chat.thinking")}`, timestamp: Date.now(), pending: true };
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setSending(true);

    chrome.runtime.sendMessage({
      type: "AGENT_CHAT",
      payload: { message: text },
    }).catch(() => {
      setSending(false);
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.findLastIndex((m) => m.pending);
        if (lastIdx >= 0) updated[lastIdx] = { role: "ai", content: t("chat.requestFailed"), timestamp: Date.now() };
        return updated;
      });
    });
  }, [sending]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    chrome.storage.local.remove(STORAGE_KEY);
  }, []);

  const cancelCurrent = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: "AGENT_CANCEL_CURRENT" });
  }, []);

  const startVerification = useCallback(async (verification: NonNullable<ChatMessage["verification"]>) => {
    setMessages((prev) => prev.map((message) => message.verification?.id === verification.id
      ? { ...message, content: "⏳ 正在启动当前页面测试…", pending: true, verification: { ...message.verification, status: "running" } }
      : message));
    const result = await chrome.runtime.sendMessage({ type: "AGENT_START_VERIFICATION", payload: { verification } }) as any;
    setMessages((prev) => {
      const status = result?.success
        ? (/VERIFICATION_RESULT:\s*PASSED/i.test(result.agentResult?.message || "") ? "passed" : /VERIFICATION_RESULT:\s*FAILED/i.test(result.agentResult?.message || "") ? "failed" : "inconclusive")
        : "failed";
      const content = result?.success
        ? formatVerificationMessage(result.agentResult?.message || "测试已完成。")
        : result?.error === "Agent 服务连接已中断，本次测试未能完成，可重新测试。"
          ? result.error
          : `浏览器测试启动失败：${result?.error || "未知错误"}`;
      return prev.map((message) => message.verification?.id === verification.id
        ? { ...message, content, pending: false, timestamp: Date.now(), verification: { ...message.verification, status } }
        : message);
    });
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    setMessages((prev) => [...prev, { role: "ai", content, timestamp: Date.now() }]);
  }, []);

  return { messages, sending, sendMessage, startVerification, cancelCurrent, clearHistory, addSystemMessage };
}
