/** Comment popup — shown near an element when user clicks in comment mode */
import { t } from "./i18n-content.js";

let popup: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;

type CommentCallback = (comment: string) => void;
let onConfirm: CommentCallback | null = null;
let onDismiss: (() => void) | null = null;
let outsideListener: ((event: PointerEvent) => void) | null = null;

export function initCommentPopup() {
  if (styleEl) return;
  styleEl = document.createElement("style");
  styleEl.id = "prism-studio-comment-style";
  styleEl.textContent = `
    #prism-studio-comment-popup {
      position: absolute;
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 12px;
      width: 240px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: none;
    }
    #prism-studio-comment-popup textarea {
      width: 100%;
      min-height: 60px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 8px;
      font-size: 12px;
      font-family: inherit;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s;
      box-sizing: border-box;
    }
    #prism-studio-comment-popup textarea:focus {
      border-color: #6366f1;
    }
    #prism-studio-comment-popup .pd-comment-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
    }
    #prism-studio-comment-popup button {
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid #e5e7eb;
      background: #fff;
      color: #374151;
      transition: all 0.15s;
      font-family: inherit;
    }
    #prism-studio-comment-popup button:hover {
      background: #f3f4f6;
    }
    #prism-studio-comment-popup .pd-comment-confirm {
      background: #6366f1;
      color: #fff;
      border-color: #6366f1;
    }
    #prism-studio-comment-popup .pd-comment-confirm:hover {
      background: #4f46e5;
    }
    #prism-studio-comment-popup .pd-comment-confirm:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;
  document.head.appendChild(styleEl);
}

export function showCommentPopup(target: HTMLElement, callback: CommentCallback, dismiss?: () => void) {
  hideCommentPopup();
  onConfirm = callback;
  onDismiss = dismiss || null;

  popup = document.createElement("div");
  popup.id = "prism-studio-comment-popup";
  popup.innerHTML = `
    <textarea placeholder="${t("comment.placeholder")}" autofocus></textarea>
    <div class="pd-comment-actions">
      <button class="pd-comment-cancel">${t("comment.cancel")}</button>
      <button class="pd-comment-confirm" disabled>${t("comment.confirm")}</button>
    </div>
  `;
  document.body.appendChild(popup);

  const textarea = popup.querySelector("textarea")!;
  const confirmBtn = popup.querySelector(".pd-comment-confirm") as HTMLButtonElement;
  const cancelBtn = popup.querySelector(".pd-comment-cancel")!;

  textarea.addEventListener("input", () => {
    confirmBtn.disabled = !textarea.value.trim();
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss?.();
    hideCommentPopup();
  });

  confirmBtn.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (text) {
      onConfirm?.(text);
      hideCommentPopup();
    }
  });

  cancelBtn.addEventListener("click", () => {
    onDismiss?.();
    hideCommentPopup();
  });

  outsideListener = (event: PointerEvent) => {
    if (popup?.contains(event.target as Node)) return;
    onDismiss?.();
    hideCommentPopup();
  };
  setTimeout(() => {
    if (outsideListener) document.addEventListener("pointerdown", outsideListener, true);
  }, 0);

  // Position near the target element
  const rect = target.getBoundingClientRect();
  let left = rect.right + 8;
  let top = rect.top + window.scrollY;

  if (left + 260 > window.innerWidth) {
    left = rect.left - 260;
    if (left < 0) left = 8;
  }
  if (top + 150 > window.innerHeight + window.scrollY) {
    top = window.innerHeight + window.scrollY - 160;
  }

  popup.style.display = "block";
  popup.style.left = left + "px";
  popup.style.top = top + "px";

  // Focus textarea after positioning
  requestAnimationFrame(() => textarea.focus());
}

export function hideCommentPopup() {
  if (outsideListener) document.removeEventListener("pointerdown", outsideListener, true);
  outsideListener = null;
  popup?.remove();
  popup = null;
  onConfirm = null;
  onDismiss = null;
}

export function destroyCommentPopup() {
  hideCommentPopup();
  styleEl?.remove();
  styleEl = null;
}

export function isCommentPopupElement(el: HTMLElement): boolean {
  return !!el.closest("#prism-studio-comment-popup");
}
