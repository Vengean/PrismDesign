export const WIDGET_CSS = `
/* ── Reset ── */

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ══════════════════════════════════════
   Morphing Container — FAB ↔ Panel
   ══════════════════════════════════════ */
.prism-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: #ffffff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06);
  z-index: 2147483647;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  font-size: 13px;
  color: #1a1a1a;
  transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              border-radius 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.3s ease;
}
.prism-container.bottom-left {
  right: auto;
  left: 24px;
}
.prism-container.no-transition,
.prism-container.no-transition * {
  transition: none !important;
}

/* ── Collapsed = FAB ── */
.prism-container.collapsed {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.prism-container.collapsed .prism-fab {
  opacity: 1 !important;
  pointer-events: auto;
}
.prism-container.collapsed .prism-panel-inner {
  opacity: 0;
  pointer-events: none;
}

/* ── Expanded = Panel ── */
.prism-container.expanded {
  width: 400px;
  height: min(520px, calc(100vh - 72px));
  max-width: calc(100vw - 48px);
  border-radius: 12px;
}
.prism-container.expanded .prism-fab {
  opacity: 0;
  pointer-events: none;
}
.prism-container.expanded .prism-panel-inner {
  opacity: 1;
  pointer-events: auto;
}

/* ── FAB (inside container) ── */
.prism-fab {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  opacity: 0;
  transition: opacity 0.12s ease 0.35s;
}
.prism-fab img {
  width: 28px;
  height: 28px;
}
.prism-container.expanded .prism-fab {
  transition: opacity 0.08s ease;
}
.prism-container.collapsed:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.prism-container.collapsed:active {
  transform: scale(0.95);
}

/* Mobile FAB: hidden on desktop, shown via media query */
.prism-mobile-fab {
  display: none;
}

/* ── Panel inner ── */
.prism-panel-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  transition: opacity 0.15s ease 0.08s;
}
.prism-container.expanded .prism-panel-inner {
  transition: opacity 0.25s ease 0.1s;
}

/* ── Panel Header ── */
.prism-header {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  gap: 6px;
}
.prism-header .title-icon {
  display: flex;
  align-items: center;
}
.prism-header .title-icon img {
  width: 20px;
  height: 20px;
}
.prism-header .title {
  font-size: 12px;
  font-weight: 600;
  color: #1a1a1a;
  margin-right: auto;
}
.prism-close-btn,
.prism-disconnect-btn {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  transition: background 0.15s, color 0.15s;
}
.prism-close-btn:hover {
  background: #f3f4f6;
  color: #374151;
}
.prism-disconnect-btn:hover {
  background: #fef2f2;
  color: #ef4444;
}

/* ── Mobile drag handle ── */
.prism-drag-handle {
  display: none;
  width: 32px;
  height: 4px;
  border-radius: 2px;
  background: #d1d5db;
  margin: 6px auto 2px;
  flex-shrink: 0;
}

/* ── Chat Messages ── */
.chat-messages {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-messages::-webkit-scrollbar {
  width: 4px;
}
.chat-messages::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 2px;
}
.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
  padding: 20px;
}

/* ── Message wrapper ── */
.chat-msg-row {
  display: flex;
  gap: 8px;
}
.chat-msg-row.user {
  justify-content: flex-end;
}
.chat-msg-row.ai {
  justify-content: flex-start;
}
.chat-msg-content {
  position: relative;
  max-width: 85%;
  min-width: 0;
}
.chat-msg-content .chat-msg {
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow-wrap: anywhere;
}
.chat-msg-delete {
  position: absolute;
  z-index: 1;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  padding: 0;
  display: none;
  align-items: center;
  justify-content: center;
  border: 1px solid #e5e7eb;
  border-radius: 50%;
  background: #fff;
  color: #9ca3af;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.chat-msg-content:hover .chat-msg-delete {
  display: flex;
}
@media (hover: none) {
  .chat-msg-delete {
    display: flex;
  }
}
.chat-msg-delete:hover {
  color: #ef4444;
}
.chat-msg-delete svg {
  width: 12px;
  height: 12px;
}
.attachment-tags-row { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 2px; }
.attachment-tags-row:empty { display: none; }
.attachment-tag, .message-attachments span { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; padding: 3px 7px; color: #4b5563; font-size: 11px; }
.attachment-tag.failed { border-color: #fecaca; color: #dc2626; }
.attachment-tag.failed { flex-wrap: wrap; }
.attachment-tag small { flex-basis: 100%; max-width: 260px; overflow-wrap: anywhere; font-size: 10px; }
.attachment-tag button { border: 0; background: none; color: inherit; cursor: pointer; padding: 0 0 0 2px; font-size: 14px; }
.message-attachments { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.ai-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(99, 50, 200, 0.1);
  color: oklch(0.45 0.2 275);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
}
.chat-msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}
.chat-msg.user {
  background: #dbeafe;
  color: #111827;
  border-bottom-right-radius: 4px;
}
.chat-msg.ai {
  background: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 4px;
}
.chat-msg.ai.thinking {
  color: #6b7280;
}

/* ── Chat: progress step ── */
.chat-msg .progress-text {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
}

/* ── Chat: aggregated comment tags ── */
.message-comment-tag { display: flex; align-self: flex-end; justify-content: flex-end; margin-top: 4px; }
.comment-count-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 25px;
  padding: 0 9px;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  background: #fff;
  color: #374151;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  width: max-content;
  flex-shrink: 0;
  white-space: nowrap;
  box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.comment-count-tag svg { width: 12px; height: 12px; color: #6b7280; }
.comment-count-tag:hover, .comment-count-tag:focus-visible { background: #f9fafb; border-color: #cbd5e1; outline: none; }

/* ── Chat markdown ── */
.chat-msg p { margin: 4px 0; }
.chat-msg > :first-child { margin-top: 0; }
.chat-msg > :last-child { margin-bottom: 0; }

.chat-msg h1, .chat-msg h2, .chat-msg h3, .chat-msg h4 {
  font-weight: 600;
  margin: 8px 0 4px;
  line-height: 1.3;
}
.chat-msg h1 { font-size: 15px; }
.chat-msg h2 { font-size: 14px; }
.chat-msg h3 { font-size: 13px; }
.chat-msg h4 { font-size: 12px; }
.chat-msg code {
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  background: oklch(0.45 0.2 275 / 0.1);
  color: oklch(0.4 0.18 275);
  padding: 1px 4px;
  border-radius: 3px;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.chat-msg pre {
  background: oklch(0.15 0 0);
  color: oklch(0.85 0 0);
  padding: 8px 10px;
  border-radius: 6px;
  max-width: 100%;
  overflow-x: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-all;
  margin: 6px 0;
  font-size: 11px;
  line-height: 1.5;
}
.chat-msg pre code {
  background: none;
  color: inherit;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}
.chat-msg ul, .chat-msg ol {
  padding-left: 18px;
  margin: 4px 0;
}
.chat-msg ul { list-style: disc; }
.chat-msg ol { list-style: decimal; }
.chat-msg li { margin: 2px 0; }
.chat-msg a {
  color: oklch(0.45 0.2 275);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.chat-msg blockquote {
  border-left: 3px solid oklch(0.45 0.2 275 / 0.4);
  padding: 2px 10px;
  color: oklch(0.45 0 0);
  margin: 6px 0;
}
.chat-msg hr {
  margin: 8px 0;
  border: none;
  border-top: 1px solid oklch(0.9 0 0);
}
.chat-msg strong { font-weight: 600; }
.chat-msg em { font-style: italic; }

/* ── Input Area ── */
.chat-input-area {
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}

/* ── Comment Tags Row ── */
.comment-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 12px 0;
  min-height: 0;
}
.comment-tags-row:empty {
  display: none;
}
/* ── Comment details popover ── */
.comment-popover {
  position: fixed;
  overflow: hidden;
  background: #fff;
  color: #111827;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.45;
  z-index: 2147483647;
  box-shadow: 0 10px 30px rgba(0,0,0,.14);
  word-break: break-word;
}
.comment-popover-item { position: relative; padding: 10px 12px; border-bottom: 1px solid #eef0f3; }
.comment-popover-item:last-child { border-bottom: 0; }
.comment-number { position: absolute; left: 10px; top: 10px; color: #9ca3af; }
.comment-label { margin-left: 20px; color: #9ca3af; font-size: 11px; }
.comment-node-details { margin: 4px 0 0 20px; padding: 7px 8px; border-radius: 7px; background: #f6f7f9; }
.comment-node, .comment-text { color: #111827; }
.comment-node { font-weight: 600; padding-right: 42px; }
.comment-detail-row { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 5px; margin-top: 4px; font-size: 10px; line-height: 1.45; }
.comment-detail-key { color: #9ca3af; }
.comment-detail-value { min-width: 0; color: #374151; font-family: 'SF Mono', 'Menlo', 'Consolas', monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-user-label { margin-top: 7px; }
.comment-text { margin: 2px 0 0 20px; white-space: pre-wrap; }
.comment-actions { position: absolute; right: 8px; top: 8px; display: flex; gap: 2px; }
.comment-actions button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; color: #6b7280; background: transparent; cursor: pointer; }
.comment-actions button:hover { color: #111827; background: #f3f4f6; }
.comment-edit-input { display: block; width: calc(100% - 20px); min-height: 54px; margin: 3px 0 0 20px; padding: 6px 7px; border: 1px solid #d1d5db; border-radius: 6px; resize: vertical; box-sizing: border-box; font: inherit; outline: none; }
.comment-edit-input:focus { border-color: #6366f1; box-shadow: 0 0 0 1px #6366f1; }

/* ── Input Row ── */
.chat-input-row {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  padding: 8px 8px;
}
.chat-input-row textarea {
  flex: 1;
  height: 36px;
  min-height: 36px;
  max-height: 80px;
  padding: 7px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  color: #1a1a1a;
  background: #fff;
}
.chat-input-row textarea:focus {
  border-color: oklch(0.45 0.2 275);
  box-shadow: 0 0 0 1px oklch(0.45 0.2 275);
}
.chat-input-row textarea::placeholder {
  color: #9ca3af;
}
.comment-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: none;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #6b7280;
  transition: all 0.15s;
}
.comment-btn:hover {
  border-color: oklch(0.45 0.2 275);
  color: oklch(0.45 0.2 275);
}
.comment-btn.active {
  background: oklch(0.45 0.2 275);
  border-color: oklch(0.45 0.2 275);
  color: white;
}
.chat-send-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: oklch(0.45 0.2 275);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.chat-send-btn:hover {
  background: oklch(0.4 0.2 275);
}
.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Chat toolbar (clear) ── */
.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px 2px;
}

.verification-card {
  display: none;
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  width: min(300px, calc(100vw - 64px));
  max-width: calc(100vw - 64px);
  max-height: min(70vh, 520px);
  overflow-y: auto;
  padding: 12px;
  border: 1px solid rgba(99, 102, 241, .28);
  border-radius: 10px;
  background: rgba(99, 102, 241, .06);
  color: var(--prism-text, #1f2937);
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  box-shadow: 0 10px 30px rgba(0,0,0,.14);
}
.verification-card.open { display: block; }
.verification-anchor { position: relative; display: flex; align-self: flex-start; justify-content: flex-start; margin-top: 4px; }
.verification-tag {
  display: inline-flex; align-items: center; gap: 4px; height: 25px; padding: 0 9px;
  border: 1px solid #e5e7eb; border-radius: 999px; background: #fff; color: #374151;
  width: max-content; flex-shrink: 0; white-space: nowrap; font: inherit; font-size: 11px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.04);
}
.verification-tag svg { width: 12px; height: 12px; color: #6b7280; }
.verification-tag:hover, .verification-tag:focus-visible { background: #f9fafb; border-color: #cbd5e1; outline: none; }
.chat-msg-content {
  display: flex;
  min-width: 0;
  max-width: calc(100% - 36px);
  flex-direction: column;
  align-items: flex-start;
}
.chat-msg-row.user .chat-msg-content { align-items: flex-end; }
.chat-msg-content .verification-card { box-sizing: border-box; }
.verification-title { font-weight: 600; margin-bottom: 6px; }
.verification-performance { margin: 7px 0; padding: 8px; border: 1px solid #e5e7eb; border-radius: 7px; background: rgba(255,255,255,.72); }
.verification-performance dl { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; margin-top: 5px; }
.verification-performance dt { color: #6b7280; }
.verification-performance dd { margin: 0; text-align: right; }
.verification-performance small { display: block; margin-top: 5px; color: #9ca3af; font-size: 10px; }
.verification-card ul { margin: 4px 0 10px; padding-left: 18px; }
.verification-start-btn {
  border: 0;
  border-radius: 7px;
  padding: 7px 12px;
  color: #fff;
  background: #6366f1;
  cursor: pointer;
  font-weight: 600;
}
.verification-start-btn:disabled { cursor: default; opacity: .6; }
.verification-actions { display: flex; justify-content: flex-start; gap: 6px; }
.verification-always-btn { border: 1px solid #d1d5db; border-radius: 7px; padding: 6px 11px; color: #374151; background: #fff; cursor: pointer; font-weight: 600; }
.verification-always-btn:hover { background: #f9fafb; }
.chat-clear-btn {
  font-size: 11px;
  color: #9ca3af;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.chat-clear-btn svg {
  vertical-align: middle;
}
.chat-clear-btn:hover {
  color: #ef4444;
  background: #fef2f2;
}

/* ── Spinner ── */
@keyframes prism-spin {
  to { transform: rotate(360deg); }
}
.prism-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #d1d5db;
  border-top-color: oklch(0.45 0.2 275);
  border-radius: 50%;
  animation: prism-spin 0.6s linear infinite;
  flex-shrink: 0;
}

/* ══════════════════════════════════════
   Connection Form
   ══════════════════════════════════════ */
.connect-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  gap: 16px;
}
.connect-form .connect-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: oklch(0.45 0.2 275 / 0.1);
  color: oklch(0.45 0.2 275);
  display: flex;
  align-items: center;
  justify-content: center;
}
.connect-form .connect-icon svg {
  width: 24px;
  height: 24px;
}
.connect-form .connect-hint {
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
}
.connect-form .connect-input-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}
.connect-form .connect-token-input {
  flex-basis: 100%;
}
.connect-form input {
  flex: 1;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  color: #1a1a1a;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.connect-form input:focus {
  border-color: oklch(0.45 0.2 275);
  box-shadow: 0 0 0 1px oklch(0.45 0.2 275);
}
.connect-form input::placeholder {
  color: #9ca3af;
}
.connect-form .connect-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  background: oklch(0.45 0.2 275);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  white-space: nowrap;
  transition: background 0.15s;
}
.connect-form .connect-btn:hover {
  background: oklch(0.4 0.2 275);
}
.connect-form .connect-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.connect-form .connect-error {
  font-size: 11px;
  color: #ef4444;
  text-align: center;
}

/* ══════════════════════════════════════
   Mobile Bottom Sheet (slide up/down)
   ══════════════════════════════════════ */
@media (max-width: 639px) {
  .prism-container.collapsed {
    bottom: 16px;
    right: 16px;
  }
  .prism-container.collapsed.bottom-left {
    right: auto;
    left: 16px;
  }

  /* Mobile expanded: full-width bottom sheet with slide animation */
  .prism-container.mobile-sheet {
    width: 100%;
    max-width: 100%;
    height: 70vh;
    max-height: calc(100vh - 48px);
    bottom: 0;
    right: 0;
    left: 0;
    border-radius: 16px 16px 0 0;
    /* Override morph transitions with slide */
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.25s ease;
  }
  .prism-container.mobile-sheet.bottom-left {
    left: 0;
  }
  .prism-container.mobile-sheet.expanded {
    transform: translateY(0);
    opacity: 1;
  }
  .prism-container.mobile-sheet.collapsed {
    /* Keep full size but slide off-screen */
    width: 100%;
    max-width: 100%;
    height: 70vh;
    max-height: calc(100vh - 48px);
    bottom: 0;
    right: 0;
    left: 0;
    border-radius: 16px 16px 0 0;
    transform: translateY(100%);
    opacity: 0;
    pointer-events: none;
  }
  .prism-container.mobile-sheet.collapsed .prism-fab {
    display: none;
  }
  .prism-container.mobile-sheet.collapsed .prism-panel-inner {
    opacity: 1;
    pointer-events: auto;
  }

  /* Mobile FAB: separate element, always visible when sheet is hidden */
  .prism-mobile-fab {
    display: flex;
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #ffffff;
    border: none;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.06);
    z-index: 2147483647;
    transition: transform 0.15s, box-shadow 0.15s, opacity 0.2s;
    padding: 0;
  }
  .prism-mobile-fab.bottom-left {
    right: auto;
    left: 16px;
  }
  .prism-mobile-fab:hover {
    transform: scale(1.08);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.08);
  }
  .prism-mobile-fab:active {
    transform: scale(0.95);
  }
  .prism-mobile-fab img {
    width: 28px;
    height: 28px;
  }
  .prism-mobile-fab.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .prism-drag-handle {
    display: block;
  }
}
`;
