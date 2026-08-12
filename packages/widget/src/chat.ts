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
  verification?: { id: string; goal: string; proposedChecks: string[]; status?: string; summary?: string };
}

function formatVerificationMessage(content: string): string {
  return content
    .replace(/^\s*VERIFICATION_RESULT:\s*PASSED\s*$/gim, "测试结论：通过")
    .replace(/^\s*VERIFICATION_RESULT:\s*FAILED\s*$/gim, "测试结论：未通过")
    .trim();
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
        ).map((m: ChatMessage) => {
          // A browser run cannot be assumed to still be active after a page reload.
          if (m.verification && ["preparing", "running"].includes(m.verification.status || "")) {
            return { ...m, verification: { ...m.verification, status: "awaiting_confirmation" } };
          }
          return m;
        });
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

    messages.forEach((msg, messageIndex) => {
      const row = document.createElement("div");
      row.className = `chat-msg-row ${msg.role}`;

      if (msg.role === "ai") {
        const avatar = document.createElement("div");
        avatar.className = "ai-avatar";
        avatar.textContent = "AI";
        row.appendChild(avatar);
      }

      const content = document.createElement("div");
      content.className = "chat-msg-content";

      if (!msg.content.startsWith("⏳")) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "chat-msg-delete";
        deleteBtn.innerHTML = ICON_TRASH;
        deleteBtn.title = "删除此消息";
        deleteBtn.setAttribute("aria-label", "删除此消息");
        deleteBtn.onclick = () => {
          messages.splice(messageIndex, 1);
          saveHistory();
          render();
        };
        content.appendChild(deleteBtn);
      }

      const bubble = document.createElement("div");
      bubble.className = `chat-msg ${msg.role}${msg.content.startsWith("\u23F3") ? " thinking" : ""}`;

      if (msg.role === "ai" && msg.content.startsWith("\u23F3")) {
        const progressContent = msg.content.slice(2).trim();
        bubble.innerHTML = `<div class="progress-text"><span class="prism-spinner"></span><span>${escapeHtml(progressContent)}</span></div>`;
      } else if (msg.role === "ai") {
        const renderedContent = ["passed", "failed", "inconclusive"].includes(msg.verification?.status || "")
          ? msg.content.replace(/^\s*测试(?:通过|未通过|结果不确定)[。！!]?\s*/i, "")
          : msg.content;
        bubble.innerHTML = renderMarkdown(formatVerificationMessage(renderedContent));
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
      content.appendChild(bubble);
      if (msg.role === "ai" && msg.verification) {
        const card = document.createElement("div");
        card.className = "verification-card";
        const title = document.createElement("div");
        title.className = "verification-title";
        title.textContent = ({ passed: "测试通过", failed: "测试未通过", inconclusive: "测试结果不确定" } as Record<string, string>)[msg.verification.status || ""] || "是否开始真实浏览器测试？";
        card.appendChild(title);
        const isComplete = ["passed", "failed", "inconclusive"].includes(msg.verification.status || "");
        if (!isComplete && msg.verification.summary) {
          const summary = document.createElement("div");
          summary.className = "verification-summary";
          summary.textContent = msg.verification.summary;
          card.appendChild(summary);
        }
        if (!isComplete) {
          const checks = document.createElement("ul");
          for (const check of msg.verification.proposedChecks) {
            const item = document.createElement("li");
            item.textContent = check;
            checks.appendChild(item);
          }
          card.appendChild(checks);
        }
        const start = document.createElement("button");
        start.className = "verification-start-btn";
        const isStarting = msg.verification.status === "preparing" || msg.verification.status === "running";
        const canRetry = ["failed", "passed", "inconclusive"].includes(msg.verification.status || "");
        start.textContent = isStarting ? "测试运行中…" : canRetry ? "重新测试" : "开始测试";
        start.disabled = isStarting;
        start.onclick = async () => {
          if (!msg.verification) return;
          msg.verification.status = "running";
          saveHistory();
          render();
          try {
            const result = await agentClient.startVerification(msg.verification);
            const verificationMessage = result.agentResult?.message || "";
            msg.verification.status = /VERIFICATION_RESULT:\s*PASSED/i.test(verificationMessage)
              ? "passed"
              : /VERIFICATION_RESULT:\s*FAILED/i.test(verificationMessage) ? "failed" : "inconclusive";
            messages.push({
              role: "ai",
              content: formatVerificationMessage(result.agentResult?.message || `浏览器测试已启动，已打开 ${result.observation?.url || "当前页面"}。当前 Agent provider 尚未接入浏览器工具适配器。`),
              timestamp: Date.now(),
            });
          } catch (error) {
            msg.verification.status = "failed";
            messages.push({ role: "ai", content: `浏览器测试启动失败：${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() });
          }
          saveHistory();
          render();
        };
        card.appendChild(start);
        content.appendChild(card);
      }
      row.appendChild(content);
      messagesEl.appendChild(row);
    });

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
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let lastProgressText = "";
    let streamedText = "";
    let settleWebSocket: ((result: any) => void) | undefined;
    const webSocketResult = new Promise<any>((resolve) => { settleWebSocket = resolve; });
    const ws = agentClient.connectWebSocket((type, data: any) => {
      if (data?.runId && data.runId !== runId) return;
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
      } else if (type === "run.completed") {
        settleWebSocket?.(data.result);
      } else if (type === "run.failed") {
        settleWebSocket?.({ success: false, message: data.error?.message || t("chat.requestFailed") });
      } else if (type === "run.cancelled") {
        settleWebSocket?.({ success: false, message: "请求已取消" });
      }
    });

    let hasFileChanges = false;
    try {
      let result;
      try {
        result = await agentClient.chat(agentMessage, runId);
      } catch {
        // The long-lived HTTP request can be interrupted by HMR or a proxy while
        // the Agent continues running. Wait for the authoritative WS terminal event.
        result = await Promise.race([
          webSocketResult,
          new Promise((resolve) => setTimeout(() => resolve({ success: false, message: t("chat.requestFailed") }), 15 * 60_000)),
        ]);
      }

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
        verification: result.verification,
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
