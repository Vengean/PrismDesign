export const WIDGET_CSS = `
/* ── Reset ── */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ── Floating Button ── */
.prism-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #ffffff;
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.06);
  z-index: 2147483647;
  transition: transform 0.2s, box-shadow 0.2s;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  padding: 0;
  overflow: hidden;
}
.prism-fab img {
  width: 28px;
  height: 28px;
}
.prism-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.prism-fab:active {
  transform: scale(0.95);
}
.prism-fab .badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ef4444;
  color: white;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* ── Panel ── */
.prism-panel {
  position: fixed;
  bottom: 84px;
  right: 24px;
  width: 400px;
  height: 520px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06);
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  font-size: 13px;
  color: #1a1a1a;
  animation: prism-slide-up 0.25s ease-out;
}
.prism-panel.hidden {
  display: none;
}

@keyframes prism-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Panel Header — matches chrome-ext compact style ── */
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
.prism-close-btn {
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

/* ── Chat Messages ── */
.chat-messages {
  flex: 1;
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

/* ── Message wrapper — chrome-ext uses flex row with avatar ── */
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

/* ── Chat: comment tags in user message ── */
.chat-msg .comment-tag-display {
  display: inline-block;
  background: #f0edff;
  border: 1px solid #c7d2fe;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: #4f46e5;
  margin: 2px 2px 2px 0;
  line-height: 1.4;
}
.chat-msg .comment-tag-display .tag-target {
  font-weight: 600;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
}

/* ── Chat markdown — matches chrome-ext .chat-markdown ── */
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
}
.chat-msg pre {
  background: oklch(0.15 0 0);
  color: oklch(0.85 0 0);
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
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
.comment-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: #ede9fe;
  border: 1px solid #c7d2fe;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  color: #4f46e5;
  cursor: default;
  max-width: 200px;
  position: relative;
  transition: background 0.15s;
}
.comment-tag:hover {
  background: #e0e7ff;
}
.comment-tag .tag-target {
  font-weight: 600;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comment-tag .tag-close {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgba(79, 70, 229, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 10px;
  color: #6366f1;
  line-height: 1;
}
.comment-tag .tag-close:hover {
  background: rgba(79, 70, 229, 0.3);
}

/* ── Tooltip ── */
.comment-tooltip {
  position: fixed;
  background: #1e1e2e;
  color: #e2e8f0;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  max-width: 260px;
  z-index: 2147483647;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  word-break: break-word;
}
.comment-tooltip .tt-target {
  font-weight: 600;
  color: #a5b4fc;
  font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
  font-size: 11px;
}
.comment-tooltip .tt-text {
  margin-top: 4px;
  color: #cbd5e1;
}

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
`;
