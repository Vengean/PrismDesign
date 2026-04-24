import type { PrismMessage } from "./types.js";

/**
 * Send a message via chrome.runtime (Side Panel / Background).
 */
export function sendMessage(message: PrismMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

/**
 * Send a message to a specific tab's content script.
 */
export function sendToTab(tabId: number, message: PrismMessage): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

/**
 * Listen for messages from any context.
 */
export function onMessage(
  handler: (
    message: PrismMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => void | boolean
) {
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

/**
 * Get the active tab ID.
 */
export async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}
