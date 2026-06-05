import { ICON_CROSSHAIR, ICON_TRASH } from "./icons.js";
import { t } from "./i18n.js";
import type { AgentClient } from "./agent-client.js";

interface Comment {
  target: string; // e.g. "div.header" or "button#submit"
  text: string;
  element?: Element;
}

export interface CommentTabAPI {
  getCommentCount(): number;
  onCountChange(cb: (count: number) => void): void;
  destroy(): void;
}

// ── Overlay & Popup (outside Shadow DOM, on document.body) ──

const OVERLAY_ID = "prism-design-comment-overlay";
const POPUP_ID = "prism-design-comment-popup";
const OVERLAY_STYLE_ID = "prism-design-comment-styles";

function ensureGlobalStyles() {
  if (document.getElementById(OVERLAY_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: absolute;
      pointer-events: none;
      border: 2px solid #6366f1;
      background: rgba(99, 102, 241, 0.08);
      border-radius: 3px;
      z-index: 2147483646;
      transition: all 0.1s ease-out;
    }
    #${POPUP_ID} {
      position: absolute;
      z-index: 2147483647;
      background: white;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      padding: 10px;
      width: 240px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
    }
    #${POPUP_ID} textarea {
      width: 100%;
      min-height: 60px;
      padding: 8px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      resize: vertical;
      outline: none;
      box-sizing: border-box;
      color: #1a1a1a;
    }
    #${POPUP_ID} textarea:focus {
      border-color: #6366f1;
    }
    #${POPUP_ID} .popup-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
    }
    #${POPUP_ID} button {
      padding: 4px 12px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: white;
      cursor: pointer;
      font-family: inherit;
    }
    #${POPUP_ID} button.confirm {
      background: #6366f1;
      color: white;
      border-color: #6366f1;
    }
    #${POPUP_ID} button.confirm:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);
}

function showOverlay(el: Element) {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  }
  const rect = el.getBoundingClientRect();
  overlay.style.top = rect.top + window.scrollY + "px";
  overlay.style.left = rect.left + window.scrollX + "px";
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
  overlay.style.display = "block";
}

function hideOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.style.display = "none";
}

function getElementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = el.className && typeof el.className === "string"
    ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
    : "";
  return `${tag}${cls}`;
}

function showCommentPopup(
  target: Element,
  onConfirm: (text: string) => void,
  onCancel: () => void
) {
  removeCommentPopup();

  const popup = document.createElement("div");
  popup.id = POPUP_ID;

  const textarea = document.createElement("textarea");
  textarea.placeholder = t("comment.placeholder");
  popup.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "popup-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = t("comment.cancel");
  cancelBtn.onclick = () => {
    removeCommentPopup();
    onCancel();
  };
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "confirm";
  confirmBtn.textContent = t("comment.confirm");
  confirmBtn.disabled = true;
  confirmBtn.onclick = () => {
    const text = textarea.value.trim();
    if (text) {
      removeCommentPopup();
      onConfirm(text);
    }
  };
  actions.appendChild(confirmBtn);
  popup.appendChild(actions);

  textarea.oninput = () => {
    confirmBtn.disabled = !textarea.value.trim();
  };

  // Position near element
  const rect = target.getBoundingClientRect();
  popup.style.top = rect.bottom + window.scrollY + 8 + "px";

  // Prefer right side of element, but keep within viewport
  let left = rect.left + window.scrollX;
  if (left + 240 > window.innerWidth) {
    left = window.innerWidth - 252;
  }
  popup.style.left = Math.max(8, left) + "px";

  document.body.appendChild(popup);
  textarea.focus();
}

function removeCommentPopup() {
  const popup = document.getElementById(POPUP_ID);
  if (popup) popup.remove();
}

function isCommentUI(el: Element): boolean {
  const id = el.id || "";
  if (id === OVERLAY_ID || id === POPUP_ID) return true;
  if (el.closest(`#${POPUP_ID}`) || el.closest("#prism-design-widget")) return true;
  return false;
}

// ── Comment Tab ──

export function createCommentTab(
  container: HTMLElement,
  agentClient: AgentClient,
  _shadowRoot: ShadowRoot
): CommentTabAPI {
  const comments: Comment[] = [];
  let commentMode = false;
  const countCbs: Array<(n: number) => void> = [];

  ensureGlobalStyles();

  // ── DOM ──
  const toolbar = document.createElement("div");
  toolbar.className = "comment-toolbar";

  const addBtn = document.createElement("button");
  addBtn.className = "comment-add-btn";
  addBtn.innerHTML = `${ICON_CROSSHAIR} <span>${t("comment.add")}</span>`;
  addBtn.onclick = toggleCommentMode;
  toolbar.appendChild(addBtn);

  const syncBtn = document.createElement("button");
  syncBtn.className = "comment-sync-btn";
  syncBtn.textContent = t("comment.sync");
  syncBtn.onclick = syncToAgent;
  toolbar.appendChild(syncBtn);

  container.appendChild(toolbar);

  const listEl = document.createElement("div");
  listEl.className = "comment-list";
  container.appendChild(listEl);

  // ── Comment mode ──
  function toggleCommentMode() {
    commentMode = !commentMode;
    addBtn.classList.toggle("active", commentMode);
    const label = addBtn.querySelector("span")!;
    label.textContent = commentMode ? t("comment.stop") : t("comment.add");

    if (commentMode) {
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("click", onClick, true);
      document.body.style.cursor = "crosshair";
    } else {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("click", onClick, true);
      document.body.style.cursor = "";
      hideOverlay();
      removeCommentPopup();
    }
  }

  function onMouseMove(e: MouseEvent) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isCommentUI(target)) {
      hideOverlay();
      return;
    }
    showOverlay(target);
  }

  function onClick(e: MouseEvent) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || isCommentUI(target)) return;

    e.preventDefault();
    e.stopPropagation();

    hideOverlay();

    showCommentPopup(
      target,
      (text) => {
        comments.push({
          target: getElementLabel(target),
          text,
          element: target,
        });
        notifyCount();
        render();
      },
      () => {
        // cancelled — do nothing
      }
    );
  }

  // ── Render comment list ──
  function render() {
    listEl.innerHTML = "";

    if (comments.length === 0) {
      const empty = document.createElement("div");
      empty.className = "comment-empty";
      empty.textContent = t("comment.empty");
      listEl.appendChild(empty);
      syncBtn.disabled = true;
      return;
    }

    syncBtn.disabled = false;

    comments.forEach((comment, idx) => {
      const item = document.createElement("div");
      item.className = "comment-item";

      const header = document.createElement("div");
      header.className = "comment-item-header";

      const targetEl = document.createElement("span");
      targetEl.className = "comment-item-target";
      targetEl.textContent = `<${comment.target}>`;
      header.appendChild(targetEl);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "comment-item-delete";
      deleteBtn.innerHTML = ICON_TRASH;
      deleteBtn.onclick = () => {
        comments.splice(idx, 1);
        notifyCount();
        render();
      };
      header.appendChild(deleteBtn);

      item.appendChild(header);

      const textEl = document.createElement("div");
      textEl.className = "comment-item-text";
      textEl.textContent = comment.text;
      item.appendChild(textEl);

      listEl.appendChild(item);
    });
  }

  // ── Sync to agent ──
  async function syncToAgent() {
    if (comments.length === 0) return;

    syncBtn.disabled = true;
    syncBtn.textContent = t("comment.syncing");

    const lines = comments.map(
      (c) => `- <${c.target}>: "${c.text}"`
    );
    const message = `设计师对页面元素的评审意见：\n\n${lines.join("\n")}\n\n请根据以上评审意见修改对应的源代码。`;

    try {
      await agentClient.chat(message, {
        pagePath: location.pathname,
        components: [],
      });
    } catch (err) {
      console.error("[PrismDesign] Sync failed:", err);
    } finally {
      syncBtn.textContent = t("comment.sync");
      syncBtn.disabled = comments.length === 0;
    }
  }

  function notifyCount() {
    countCbs.forEach((cb) => cb(comments.length));
  }

  // ── Cleanup ──
  function destroy() {
    if (commentMode) toggleCommentMode();
    hideOverlay();
    removeCommentPopup();
    const styleEl = document.getElementById(OVERLAY_STYLE_ID);
    if (styleEl) styleEl.remove();
    container.innerHTML = "";
  }

  // Initial render
  render();

  return {
    getCommentCount: () => comments.length,
    onCountChange: (cb) => countCbs.push(cb),
    destroy,
  };
}
