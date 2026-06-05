import { ICON_SEND, ICON_TRASH } from "./icons.js";
import { t } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";
import type { AgentClient } from "./agent-client.js";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  thinking?: boolean;
}

export interface ChatTabAPI {
  getUnreadCount(): number;
  onUnreadChange(cb: (count: number) => void): void;
  destroy(): void;
}

export function createChatTab(container: HTMLElement, agentClient: AgentClient): ChatTabAPI {
  const messages: ChatMessage[] = [];
  let unreadCount = 0;
  let sending = false;
  const unreadCbs: Array<(n: number) => void> = [];

  // ── DOM structure ──
  const messagesEl = document.createElement("div");
  messagesEl.className = "chat-messages";
  container.appendChild(messagesEl);

  const toolbarEl = document.createElement("div");
  toolbarEl.className = "chat-toolbar";
  toolbarEl.style.display = "none";

  const clearBtn = document.createElement("button");
  clearBtn.className = "chat-clear-btn";
  clearBtn.textContent = t("chat.clearHistory");
  clearBtn.onclick = clearHistory;
  toolbarEl.appendChild(clearBtn);
  container.appendChild(toolbarEl);

  const inputArea = document.createElement("div");
  inputArea.className = "chat-input-area";

  const textarea = document.createElement("textarea");
  textarea.placeholder = t("chat.placeholder");
  textarea.rows = 1;
  textarea.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  };
  textarea.oninput = () => autoResize();
  inputArea.appendChild(textarea);

  const sendBtn = document.createElement("button");
  sendBtn.className = "chat-send-btn";
  sendBtn.innerHTML = ICON_SEND;
  sendBtn.onclick = sendMessage;
  inputArea.appendChild(sendBtn);

  container.appendChild(inputArea);

  // ── Render ──
  function render() {
    messagesEl.innerHTML = "";
    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = t("chat.empty");
      messagesEl.appendChild(empty);
      toolbarEl.style.display = "none";
      return;
    }

    toolbarEl.style.display = "flex";

    for (const msg of messages) {
      const el = document.createElement("div");
      el.className = `chat-msg ${msg.role}${msg.thinking ? " thinking" : ""}`;

      if (msg.role === "ai") {
        const label = document.createElement("div");
        label.className = "ai-label";
        label.textContent = "AI";
        el.appendChild(label);
      }

      const body = document.createElement("div");
      if (msg.thinking) {
        body.innerHTML = `<span class="prism-spinner"></span>${escapeHtml(msg.content)}`;
      } else if (msg.role === "ai") {
        body.innerHTML = renderMarkdown(msg.content);
      } else {
        body.textContent = msg.content;
      }
      el.appendChild(body);

      messagesEl.appendChild(el);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function autoResize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + "px";
  }

  // ── Send message ──
  async function sendMessage() {
    const text = textarea.value.trim();
    if (!text || sending) return;

    sending = true;
    sendBtn.disabled = true;
    textarea.value = "";
    autoResize();

    // Add user message
    messages.push({ role: "user", content: text });
    // Add thinking placeholder
    const thinkingIdx = messages.length;
    messages.push({ role: "ai", content: t("chat.thinking"), thinking: true });
    render();

    // Listen for WebSocket progress
    let progressText = t("chat.thinking");
    const ws = agentClient.connectWebSocket((type, data: any) => {
      if (type === "agent:progress") {
        progressText = data.text || progressText;
        if (messages[thinkingIdx]) {
          messages[thinkingIdx].content = progressText;
          render();
        }
      }
    });

    try {
      const result = await agentClient.chat(text, {
        pagePath: location.pathname,
        components: [],
      });

      // Replace thinking with result
      messages[thinkingIdx] = {
        role: "ai",
        content: result.message || (result.success ? t("chat.done") : t("chat.error")),
        thinking: false,
      };
    } catch (err) {
      messages[thinkingIdx] = {
        role: "ai",
        content: t("chat.requestFailed"),
        thinking: false,
      };
    } finally {
      ws.close();
      sending = false;
      sendBtn.disabled = false;
      unreadCount++;
      unreadCbs.forEach((cb) => cb(unreadCount));
      render();
    }
  }

  function clearHistory() {
    messages.length = 0;
    unreadCount = 0;
    unreadCbs.forEach((cb) => cb(0));
    render();
  }

  // Initial render
  render();

  return {
    getUnreadCount: () => unreadCount,
    onUnreadChange: (cb) => unreadCbs.push(cb),
    destroy: () => {
      container.innerHTML = "";
    },
  };
}
