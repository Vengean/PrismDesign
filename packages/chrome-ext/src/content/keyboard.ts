/**
 * Keyboard shortcuts for design mode.
 * Supports plain keys (e.g. Escape) and Ctrl/Cmd shortcuts.
 */

let enabled = false;
let ctrlHandlers: Record<string, () => void> = {};
let plainHandlers: Record<string, () => void> = {};

function onKeyDown(e: KeyboardEvent) {
  if (!enabled) return;

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

  const key = e.key.toLowerCase();

  // Plain key shortcuts (no modifier)
  const plain = plainHandlers[key];
  if (plain && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    plain();
    return;
  }

  // Ctrl/Cmd shortcuts
  if (!(e.ctrlKey || e.metaKey)) return;
  const ctrl = ctrlHandlers[key];
  if (ctrl) {
    e.preventDefault();
    ctrl();
  }
}

interface KeyboardShortcuts {
  ctrl?: Record<string, () => void>;
  plain?: Record<string, () => void>;
}

export function initKeyboard(shortcuts: KeyboardShortcuts) {
  ctrlHandlers = shortcuts.ctrl || {};
  plainHandlers = shortcuts.plain || {};
  enabled = true;
  document.addEventListener("keydown", onKeyDown, true);
}

export function destroyKeyboard() {
  enabled = false;
  document.removeEventListener("keydown", onKeyDown, true);
  ctrlHandlers = {};
  plainHandlers = {};
}
