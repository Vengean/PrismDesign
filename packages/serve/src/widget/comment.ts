import { t } from "./i18n.js";

export interface CommentInfo {
  target: string; // e.g. "div.header" or "button#submit"
  text: string;
}

// ── Global overlay & popup IDs ──
const OVERLAY_ID = "prism-design-comment-overlay";
const POPUP_ID = "prism-design-comment-popup";
const STYLE_ID = "prism-design-comment-styles";

function ensureGlobalStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
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
    #${POPUP_ID} textarea:focus { border-color: #6366f1; }
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

function removePopup() {
  const popup = document.getElementById(POPUP_ID);
  if (popup) popup.remove();
}

function getElementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls =
    el.className && typeof el.className === "string"
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
  return `${tag}${cls}`;
}

function isCommentUI(el: Element): boolean {
  const id = el.id || "";
  if (id === OVERLAY_ID || id === POPUP_ID) return true;
  if (el.closest(`#${POPUP_ID}`) || el.closest("#prism-design-widget")) return true;
  return false;
}

/**
 * Enter comment mode: user clicks a page element, types a comment,
 * then onConfirm is called with the CommentInfo.
 * onCancel is called if user exits without confirming.
 */
export function showCommentMode(
  _shadowRoot: ShadowRoot,
  onConfirm: (info: CommentInfo) => void,
  onCancel: () => void
) {
  ensureGlobalStyles();

  const savedCursor = document.body.style.cursor;
  document.body.style.cursor = "crosshair";

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

    // Show popup
    showPopup(target);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      cleanup();
      onCancel();
    }
  }

  function cleanup() {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.body.style.cursor = savedCursor;
    hideOverlay();
    removePopup();
  }

  function showPopup(target: Element) {
    removePopup();

    // Pause mouse/click listeners while popup is open
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);

    const popup = document.createElement("div");
    popup.id = POPUP_ID;

    const textareaEl = document.createElement("textarea");
    textareaEl.placeholder = t("comment.placeholder");
    popup.appendChild(textareaEl);

    const actions = document.createElement("div");
    actions.className = "popup-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = t("comment.cancel");
    cancelBtn.onclick = () => {
      cleanup();
      onCancel();
    };
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "confirm";
    confirmBtn.textContent = t("comment.confirm");
    confirmBtn.disabled = true;
    confirmBtn.onclick = () => {
      const text = textareaEl.value.trim();
      if (text) {
        cleanup();
        onConfirm({ target: getElementLabel(target), text });
      }
    };
    actions.appendChild(confirmBtn);
    popup.appendChild(actions);

    textareaEl.oninput = () => {
      confirmBtn.disabled = !textareaEl.value.trim();
    };
    textareaEl.onkeydown = (e) => {
      if (e.key === "Escape") {
        cleanup();
        onCancel();
      }
    };

    // Position below the target element
    const rect = target.getBoundingClientRect();
    popup.style.top = rect.bottom + window.scrollY + 8 + "px";
    let left = rect.left + window.scrollX;
    if (left + 240 > window.innerWidth) left = window.innerWidth - 252;
    popup.style.left = Math.max(8, left) + "px";

    document.body.appendChild(popup);
    textareaEl.focus();
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
}
