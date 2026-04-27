/**
 * Safe wrapper around chrome.runtime for content scripts.
 * Handles "Extension context invalidated" errors gracefully.
 */

import type { PrismMessage } from "../shared/types.js";

let invalidated = false;
let onInvalidated: (() => void) | null = null;

export function isContextInvalidated() {
  return invalidated;
}

/**
 * Register a cleanup callback for when the extension context is invalidated.
 */
export function onContextInvalidated(callback: () => void) {
  onInvalidated = callback;
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

function checkInvalidated() {
  if (invalidated) return;
  if (!chrome.runtime?.id) {
    invalidated = true;
    console.warn("[PrismDesign] Extension context invalidated — cleaning up");
    onInvalidated?.();
  }
}
