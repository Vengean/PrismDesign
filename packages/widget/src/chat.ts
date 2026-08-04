import { ICON_SEND, ICON_COMMENT, ICON_TRASH } from "./icons.js";
import { t } from "./i18n.js";
import { renderMarkdown } from "./markdown.js";
import type { AgentClient } from "./agent-client.js";
import { showCommentMode, type CommentInfo } from "./comment.js";
import type { PanelAPI } from "./panel.js";

const STORAGE_KEY = "prism-chat-history";

interface ChatMessage {
  role: "user" | "ai";
  content: string;
  timestamp: number;
  comments?: CommentInfo[];
}

export interface ChatAPI {
  destroy(): void;
}

export function createChat(
  container: HTMLElement,
  agentClient: AgentClient,
  shadowRoot: ShadowRoot,
  panel: PanelAPI
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
        messages = parsed.filter(
          (m: ChatMessage) => !(m.role === "ai" && m.content.startsWith("\u23F3"))
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

  const tagsRow = document.createElement("div");
  tagsRow.className = "comment-tags-row";
  inputArea.appendChild(tagsRow);

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
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
      return;
    }
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

  // ── Comment mode (hide panel, re-show after) ──
  function startCommentMode() {
    commentBtn.classList.add("active");
    panel.hide();
    showCommentMode(
      shadowRoot,
      (info) => {
        commentTags.push(info);
        renderTags();
        commentBtn.classList.remove("active");
        panel.show();
        textarea.focus();
      },
      () => {
        // Called when user exits comment mode (Escape / cancel)
        commentBtn.classList.remove("active");
        panel.show();
        textarea.focus();
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
      close.textContent = "\u00D7";
      close.onclick = (e) => {
        e.stopPropagation();
        commentTags.splice(idx, 1);
        renderTags();
      };
      el.appendChild(close);

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
      const row = document.createElement("div");
      row.className = `chat-msg-row ${msg.role}`;

      if (msg.role === "ai") {
        const avatar = document.createElement("div");
        avatar.className = "ai-avatar";
        avatar.textContent = "AI";
        row.appendChild(avatar);
      }

      const bubble = document.createElement("div");
      bubble.className = `chat-msg ${msg.role}${msg.content.startsWith("\u23F3") ? " thinking" : ""}`;

      if (msg.role === "ai" && msg.content.startsWith("\u23F3")) {
        const progressContent = msg.content.slice(2).trim();
        bubble.innerHTML = `<div class="progress-text"><span class="prism-spinner"></span><span>${escapeHtml(progressContent)}</span></div>`;
      } else if (msg.role === "ai") {
        bubble.innerHTML = renderMarkdown(msg.content);
      } else {
        if (msg.comments && msg.comments.length > 0) {
          for (const c of msg.comments) {
            const tagEl = document.createElement("span");
            tagEl.className = "comment-tag-display";
            tagEl.innerHTML =
              `<span class="tag-target">&lt;${escapeHtml(c.target)}&gt;</span> ${escapeHtml(c.text)}`;
            bubble.appendChild(tagEl);
          }
          if (msg.content) {
            const textNode = document.createElement("div");
            textNode.style.marginTop = "4px";
            textNode.textContent = msg.content;
            bubble.appendChild(textNode);
          }
        } else {
          bubble.textContent = msg.content;
        }
      }
      row.appendChild(bubble);
      messagesEl.appendChild(row);
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

    const pagePath = location.pathname;
    let agentMessage = "";
    const savedComments = [...commentTags];

    if (hasComments) {
      const parts = commentTags.map((c) => {
        const lines: string[] = [];
        lines.push(`Element: <${c.target}>`);
        if (c.componentChain) lines.push(`Component: ${c.componentChain}`);
        if (c.sourceFile) {
          let loc = c.sourceFile;
          if (c.sourceLine) loc += `:${c.sourceLine}`;
          lines.push(`Source: ${loc}`);
        }
        if (c.props && Object.keys(c.props).length > 0) {
          const propStr = Object.entries(c.props).slice(0, 8)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
          lines.push(`Props: ${propStr}`);
        }
        if (c.domStructure) {
          lines.push(`DOM Structure:`);
          lines.push(c.domStructure);
        }
        lines.push(`Comment: "${c.text}"`);
        return lines.join("\n");
      });
      agentMessage = parts.join("\n\n");
      if (text) {
        agentMessage += `\n\n${text}`;
      }
    } else {
      agentMessage = text;
    }

    agentMessage += `\n\nPage: ${pagePath}`;

    const displayContent = text;

    const userMsg: ChatMessage = {
      role: "user",
      content: displayContent,
      timestamp: Date.now(),
      comments: hasComments ? savedComments : undefined,
    };
    messages.push(userMsg);

    const thinkingMsg: ChatMessage = {
      role: "ai",
      content: `\u23F3 ${t("chat.thinking")}`,
      timestamp: Date.now(),
    };
    messages.push(thinkingMsg);
    saveHistory();
    render();

    textarea.value = "";
    commentTags.length = 0;
    renderTags();
    autoResize();

    const thinkingIdx = messages.length - 1;
    let lastProgressText = "";
    let streamedText = "";
    const ws = agentClient.connectWebSocket((type, data: any) => {
      if (type === "agent:progress") {
        const progressText = data.text || t("chat.thinking");
        lastProgressText = progressText;
        messages[thinkingIdx] = {
          ...messages[thinkingIdx],
          content: `\u23F3 ${progressText}`,
        };
        render();
      } else if (type === "message.delta") {
        streamedText += data.delta || "";
        messages[thinkingIdx] = { ...messages[thinkingIdx], content: streamedText };
        render();
      }
    });

    let hasFileChanges = false;
    try {
      const result = await agentClient.chat(agentMessage);

      hasFileChanges = (result.filesModified?.length ?? 0) > 0;

      let responseContent = "";
      if (result.success) {
        responseContent = result.message || lastProgressText || t("chat.done");
      } else {
        responseContent = `${t("chat.error")}: ${result.message}`;
      }

      messages[thinkingIdx] = {
        role: "ai",
        content: responseContent,
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

      if (hasFileChanges) {
        setTimeout(() => location.reload(), 800);
      }
    }
  }

  render();

  return {
    destroy() {
      hideTooltip();
      container.innerHTML = "";
    },
  };
}
