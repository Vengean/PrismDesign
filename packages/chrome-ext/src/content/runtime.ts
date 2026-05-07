/**
 * Safe wrapper around chrome.runtime for content scripts.
 * Handles "Extension context invalidated" errors gracefully.
 *
 * Uses a persistent port connection to the background — when the
 * extension is unloaded/updated/disabled, the port disconnects
 * immediately, giving us a reliable cleanup signal.
 */

import type { PrismMessage } from "../shared/types.js";

let invalidated = false;
const invalidatedCallbacks: (() => void)[] = [];

export function isContextInvalidated() {
  return invalidated;
}

/**
 * Register a cleanup callback for when the extension context is invalidated.
 * Multiple callbacks are supported.
 */
export function onContextInvalidated(callback: () => void) {
  invalidatedCallbacks.push(callback);
}

/**
 * Safely send a message via chrome.runtime.
 * Silently no-ops if the extension context has been invalidated.
 */
export function safeSendMessage(message: PrismMessage): void {
  if (invalidated) return;
  try {
    chrome.runtime.sendMessage(message).catch(checkInvalidated);
  } catch {
    checkInvalidated();
  }
}

function markInvalidated() {
  if (invalidated) return;
  invalidated = true;
  console.warn("[PrismDesign] Extension context invalidated — cleaning up");
  for (const cb of invalidatedCallbacks) {
    try { cb(); } catch (e) { console.error("[PrismDesign] cleanup error:", e); }
  }
}

function checkInvalidated() {
  if (invalidated) return;
  if (!chrome.runtime?.id) {
    markInvalidated();
  }
}

// ---- Proactive detection via persistent port ----
// When the extension is unloaded/updated/disabled, the port disconnects.
// We use a small delay before checking chrome.runtime.id because Chrome
// may not clear it synchronously on disconnect.
function isRuntimeAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function connectKeepAlive() {
  if (invalidated) return;
  try {
    const port = chrome.runtime.connect({ name: "prism-content-keepalive" });
    port.onDisconnect.addListener(() => {
      // Delay check — chrome.runtime.id may not be cleared immediately
      setTimeout(() => {
        if (!isRuntimeAlive()) {
          markInvalidated();
        } else {
          // Service worker just went idle — reconnect
          connectKeepAlive();
        }
      }, 500);
    });
  } catch {
    markInvalidated();
  }
}
// Delay keep-alive until page is loaded to avoid interfering with loading indicator
if (document.readyState === "complete") {
  connectKeepAlive();
} else {
  window.addEventListener("load", () => connectKeepAlive(), { once: true });
}
