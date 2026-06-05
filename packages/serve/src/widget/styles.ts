export const WIDGET_CSS = `
/* ── Reset ── */
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
  background: #6366f1;
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
  z-index: 2147483647;
  transition: transform 0.2s, box-shadow 0.2s;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.prism-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
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
  width: 380px;
  height: 480px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06);
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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

/* ── Panel Header ── */
.prism-header {
  display: flex;
  align-items: center;
  padding: 0 12px;
  height: 42px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  gap: 2px;
}
.prism-header .title {
  font-size: 13px;
  font-weight: 600;
  color: #6366f1;
  margin-right: auto;
}
.prism-tab-btn {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: #6b7280;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  font-family: inherit;
}
.prism-tab-btn:hover {
  color: #374151;
}
.prism-tab-btn.active {
  color: #6366f1;
  border-bottom-color: #6366f1;
}
.prism-close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  margin-left: 4px;
  transition: background 0.15s, color 0.15s;
}
.prism-close-btn:hover {
  background: #f3f4f6;
  color: #374151;
}

/* ── Panel Body ── */
.prism-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.prism-tab-content {
  flex: 1;
  min-height: 0;
  display: none;
  flex-direction: column;
}
.prism-tab-content.active {
  display: flex;
}

/* ── Chat ── */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
.chat-msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}
.chat-msg.user {
  align-self: flex-end;
  background: #ede9fe;
  color: #3730a3;
  border-bottom-right-radius: 4px;
}
.chat-msg.ai {
  align-self: flex-start;
  background: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 4px;
}
.chat-msg.ai.thinking {
  color: #9ca3af;
  font-style: italic;
}
.chat-msg .ai-label {
  font-size: 10px;
  font-weight: 600;
  color: #6366f1;
  margin-bottom: 2px;
}

/* Chat markdown */
.chat-msg h1, .chat-msg h2, .chat-msg h3, .chat-msg h4 {
  font-weight: 600;
  margin: 6px 0 4px;
}
.chat-msg h1 { font-size: 15px; }
.chat-msg h2 { font-size: 14px; }
.chat-msg h3 { font-size: 13px; }
.chat-msg code {
  background: rgba(99, 102, 241, 0.1);
  color: #4f46e5;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}
.chat-msg pre {
  background: #1e1e2e;
  color: #cdd6f4;
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
  font-size: inherit;
}
.chat-msg ul, .chat-msg ol {
  padding-left: 18px;
  margin: 4px 0;
}
.chat-msg a {
  color: #6366f1;
  text-decoration: underline;
}
.chat-msg blockquote {
  border-left: 3px solid #6366f1;
  padding-left: 8px;
  color: #6b7280;
  margin: 4px 0;
}

/* Chat Input */
.chat-input-area {
  padding: 8px 12px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  flex-shrink: 0;
}
.chat-input-area textarea {
  flex: 1;
  min-height: 36px;
  max-height: 80px;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 0.15s;
  color: #1a1a1a;
  background: #fff;
}
.chat-input-area textarea:focus {
  border-color: #6366f1;
}
.chat-input-area textarea::placeholder {
  color: #9ca3af;
}
.chat-send-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: #6366f1;
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
  background: #4f46e5;
}
.chat-send-btn:disabled {
  background: #c7c8cc;
  cursor: not-allowed;
}
.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px 4px;
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
}
.chat-clear-btn:hover {
  color: #ef4444;
  background: #fef2f2;
}

/* ── Comments ── */
.comment-toolbar {
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.comment-add-btn, .comment-sync-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  background: white;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.comment-add-btn:hover {
  border-color: #6366f1;
  color: #6366f1;
}
.comment-add-btn.active {
  background: #6366f1;
  color: white;
  border-color: #6366f1;
}
.comment-sync-btn {
  margin-left: auto;
  background: #6366f1;
  color: white;
  border-color: #6366f1;
}
.comment-sync-btn:hover {
  background: #4f46e5;
}
.comment-sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.comment-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.comment-list::-webkit-scrollbar {
  width: 4px;
}
.comment-list::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 2px;
}
.comment-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  font-size: 12px;
  text-align: center;
  padding: 20px;
}
.comment-item {
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.comment-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.comment-item-target {
  font-size: 11px;
  font-weight: 500;
  color: #6366f1;
  font-family: 'SF Mono', Monaco, monospace;
}
.comment-item-delete {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9ca3af;
  transition: all 0.15s;
}
.comment-item-delete:hover {
  background: #fef2f2;
  color: #ef4444;
}
.comment-item-text {
  font-size: 12px;
  color: #374151;
  line-height: 1.5;
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
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: prism-spin 0.6s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}
`;
