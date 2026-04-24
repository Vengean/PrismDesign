/**
 * Keyboard shortcuts for design mode.
 * Only active when design mode is on.
 */

let enabled = false;
let handlers: Record<string, () => void> = {};

function onKeyDown(e: KeyboardEvent) {
  if (!enabled) return;

  // Skip when typing in inputs
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === "INPUT" ||
      active.tagName === "TEXTAREA" ||
      active.tagName === "SELECT" ||
      (active as HTMLElement).contentEditable === "true")
  ) {
    return;
  }

  if (!(e.ctrlKey || e.metaKey)) return;

  const key = e.key.toLowerCase();
  const handler = handlers[key];
  if (handler) {
    e.preventDefault();
    handler();
  }
}

export function initKeyboard(shortcuts: Record<string, () => void>) {
  handlers = shortcuts;
  enabled = true;
  document.addEventListener("keydown", onKeyDown, true);
}

export function destroyKeyboard() {
  enabled = false;
  document.removeEventListener("keydown", onKeyDown, true);
  handlers = {};
}

export function setKeyboardEnabled(on: boolean) {
  enabled = on;
}
