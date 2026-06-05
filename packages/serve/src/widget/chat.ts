import { ICON_SEND, ICON_COMMENT, ICON_TRASH } from "./icons.js";
import { t } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";
import type { AgentClient } from "./agent-client.js";
import { showCommentMode, type CommentInfo } from "./comment.js";

const STORAGE_KEY = "prism-chat-history";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  timestamp: number;
  /** If this is a user message with comments, store them for display */
  comments?: CommentInfo[];
}

export interface ChatAPI {
  destroy(): void;
}

export function createChat(
  container: HTMLElement,
  agentClient: AgentClient,
  shadowRoot: ShadowRoot
): ChatAPI {
  let messages: ChatMessage[] = [];
  let sending = false;
  const commentTags: CommentInfo[] = [];
  let tooltip: HTMLElement | null = null;

  // ── Load history ──
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        // Strip any leftover thinking messages
        messages = parsed.filter(
          (m: ChatMessage) => !(m.role === "ai" && m.content.startsWith("⏳"))
        );
      }
    }
  } catch {}

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }

  // ── DOM: messages ──
  const messagesEl = document.createElement("div");
  messagesEl.className = "chat-messages";
  container.appendChild(messagesEl);

  // ── DOM: clear bar ──
  const toolbarEl = document.createElement("div");
  toolbarEl.className = "chat-toolbar";
  const clearBtn = document.createElement("button");
  clearBtn.className = "chat-clear-btn";
  clearBtn.innerHTML = `${ICON_TRASH} ${t("chat.clearHistory")}`;
  clearBtn.onclick = () => {
    messages = [];
    saveHistory();
    render();
  };
  toolbarEl.appendChild(clearBtn);
  container.appendChild(toolbarEl);

  // ── DOM: input area ──
  const inputArea = document.createElement("div");
  inputArea.className = "chat-input-area";

  // Comment tags row
  const tagsRow = document.createElement("div");
  tagsRow.className = "comment-tags-row";
  inputArea.appendChild(tagsRow);

  // Input row
  const inputRow = document.createElement("div");
  inputRow.className = "chat-input-row";

  const commentBtn = document.createElement("button");
  commentBtn.className = "comment-btn";
  commentBtn.innerHTML = ICON_COMMENT;
  commentBtn.title = t("comment.tooltip");
  commentBtn.onclick = () => startCommentMode();
  inputRow.appendChild(commentBtn);

  const textarea = document.createElement("textarea");
  textarea.placeholder = t("chat.placeholder");
  textarea.rows = 1;
  textarea.onkeydown = (e) => {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
      return;
    }
    // Backspace at position 0 with comment tags → remove last tag
    if (e.key === "Backspace" && textarea.selectionStart === 0 && textarea.selectionEnd === 0 && commentTags.length > 0) {
      e.preventDefault();
      commentTags.pop();
      renderTags();
    }
  };
  textarea.oninput = () => autoResize();
  inputRow.appendChild(textarea);

  const sendBtn = document.createElement("button");
  sendBtn.className = "chat-send-btn";
  sendBtn.innerHTML = ICON_SEND;
  sendBtn.onclick = () => sendMessage();
  inputRow.appendChild(sendBtn);

  inputArea.appendChild(inputRow);
  container.appendChild(inputArea);

  // ── Comment mode ──
  function startCommentMode() {
    commentBtn.classList.add("active");
    showCommentMode(
      shadowRoot,
      (info) => {
        commentTags.push(info);
        renderTags();
        commentBtn.classList.remove("active");
        textarea.focus();
      },
      () => {
        commentBtn.classList.remove("active");
      }
    );
  }

  // ── Render comment tags ──
  function renderTags() {
    tagsRow.innerHTML = "";
    commentTags.forEach((tag, idx) => {
      const el = document.createElement("span");
      el.className = "comment-tag";

      const target = document.createElement("span");
      target.className = "tag-target";
      target.textContent = `<${tag.target}>`;
      el.appendChild(target);

      const close = document.createElement("span");
      close.className = "tag-close";
      close.textContent = "×";
      close.onclick = (e) => {
        e.stopPropagation();
        commentTags.splice(idx, 1);
        renderTags();
      };
      el.appendChild(close);

      // Tooltip on hover
      el.onmouseenter = (e) => showTooltip(e, tag);
      el.onmouseleave = () => hideTooltip();

      tagsRow.appendChild(el);
    });
  }

  // ── Tooltip ──
  function showTooltip(e: MouseEvent, tag: CommentInfo) {
    hideTooltip();
    tooltip = document.createElement("div");
    tooltip.className = "comment-tooltip";
    tooltip.innerHTML =
      `<div class="tt-target">&lt;${escapeHtml(tag.target)}&gt;</div>` +
      `<div class="tt-text">${escapeHtml(tag.text)}</div>`;

    shadowRoot.appendChild(tooltip);

    // Position above the tag element
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const hostRect = shadowRoot.host.getBoundingClientRect();
    tooltip.style.left = Math.max(4, rect.left - hostRect.left) + "px";
    tooltip.style.bottom = (hostRect.bottom - rect.top + 6) + "px";
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.remove();
      tooltip = null;
    }
  }

  // ── Auto-resize textarea ──
  function autoResize() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 80) + "px";
  }

  // ── Render messages ──
  function render() {
    messagesEl.innerHTML = "";
    toolbarEl.style.display = messages.length > 0 ? "flex" : "none";

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = t("chat.empty");
      messagesEl.appendChild(empty);
      return;
    }

    for (const msg of messages) {
      const el = document.createElement("div");
      el.className = `chat-msg ${msg.role}${msg.content.startsWith("⏳") ? " thinking" : ""}`;

      if (msg.role === "ai") {
        const label = document.createElement("div");
        label.className = "ai-label";
        label.textContent = "AI";
        el.appendChild(label);
      }

      const body = document.createElement("div");

      if (msg.role === "ai" && msg.content.startsWith("⏳")) {
        // Thinking / progress message
        const progressContent = msg.content.slice(2).trim();
        body.innerHTML = `<div class="progress-text"><span class="prism-spinner"></span><span>${escapeHtml(progressContent)}</span></div>`;
      } else if (msg.role === "ai") {
        body.innerHTML = renderMarkdown(msg.content);
      } else {
        // User message — may contain comment tags
        if (msg.comments && msg.comments.length > 0) {
          for (const c of msg.comments) {
            const tagEl = document.createElement("span");
            tagEl.className = "comment-tag-display";
            tagEl.innerHTML =
              `<span class="tag-target">&lt;${escapeHtml(c.target)}&gt;</span> ${escapeHtml(c.text)}`;
            body.appendChild(tagEl);
          }
          if (msg.content) {
            const textNode = document.createElement("div");
            textNode.style.marginTop = "4px";
            textNode.textContent = msg.content;
            body.appendChild(textNode);
          }
        } else {
          body.textContent = msg.content;
        }
      }
      el.appendChild(body);
      messagesEl.appendChild(el);
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Send message ──
  async function sendMessage() {
    const text = textarea.value.trim();
    const hasComments = commentTags.length > 0;
    if (!text && !hasComments) return;
    if (sending) return;

    sending = true;
    sendBtn.disabled = true;

    // Build the message for the agent
    let agentMessage = "";
    const savedComments = [...commentTags];

    if (hasComments) {
      const lines = commentTags.map((c) => `- <${c.target}>: "${c.text}"`);
      agentMessage = `设计师对页面元素的评审意见：\n\n${lines.join("\n")}`;
      if (text) {
        agentMessage += `\n\n补充说明：${text}`;
      }
      agentMessage += "\n\n请根据以上评审意见修改对应的源代码。";
    } else {
      agentMessage = text;
    }

    // Build display content for the user message
    const displayContent = text;

    // Add user message
    const userMsg: ChatMessage = {
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
      comments: hasComments ? savedComments : undefined,
    };
    messages.push(userMsg);

    // Add thinking placeholder
    const thinkingMsg: ChatMessage = {
      role: "ai",
      content: `⏳ ${t("chat.thinking")}`,
      timestamp: Date.now(),
    };
    messages.push(thinkingMsg);
    saveHistory();
    render();

    // Clear input
    textarea.value = "";
    commentTags.length = 0;
    renderTags();
    autoResize();

    // WebSocket for progress
    const thinkingIdx = messages.length - 1;
    const ws = agentClient.connectWebSocket((type, data: any) => {
      if (type === "agent:progress") {
        const progressText = data.text || t("chat.thinking");
        messages[thinkingIdx] = {
          ...messages[thinkingIdx],
          content: `⏳ ${progressText}`,
        };
        render();
      }
    });

    try {
      const result = await agentClient.chat(agentMessage, {
        pagePath: location.pathname,
        components: [],
      });

      messages[thinkingIdx] = {
        role: "ai",
        content: result.success
          ? result.message || t("chat.done")
          : `${t("chat.error")}: ${result.message}`,
        timestamp: Date.now(),
      };
    } catch {
      messages[thinkingIdx] = {
        role: "ai",
        content: t("chat.requestFailed"),
        timestamp: Date.now(),
      };
    } finally {
      ws.close();
      sending = false;
      sendBtn.disabled = false;
      saveHistory();
      render();
    }
  }

  // Initial render
  render();

  return {
    destroy() {
      hideTooltip();
      container.innerHTML = "";
    },
  };
}
