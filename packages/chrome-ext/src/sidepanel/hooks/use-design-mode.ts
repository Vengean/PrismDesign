import { useState, useCallback } from "react";

export function useDesignMode() {
  const [active, setActive] = useState(false);
  const [dragMode, setDragMode] = useState(false);

  const toggleDesignMode = useCallback(() => {
    const next = !active;
    setActive(next);
    chrome.runtime.sendMessage({ type: next ? "DESIGN_MODE_ON" : "DESIGN_MODE_OFF" });
    if (!next) setDragMode(false);
  }, [active]);

  const enableDesignMode = useCallback(() => {
    if (!active) {
      setActive(true);
      chrome.runtime.sendMessage({ type: "DESIGN_MODE_ON" });
    }
  }, [active]);

  const toggleDragMode = useCallback(() => {
    const next = !dragMode;
    setDragMode(next);
    chrome.runtime.sendMessage({ type: next ? "ENABLE_DRAG_MODE" : "DISABLE_DRAG_MODE" });
  }, [dragMode]);

  return { active, dragMode, toggleDesignMode, enableDesignMode, toggleDragMode };
}
