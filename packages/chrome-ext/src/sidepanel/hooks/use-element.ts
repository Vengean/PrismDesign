import { useState, useEffect, useCallback, useRef } from "react";
import type { ElementSelection, PrismMessage } from "../../shared/types.js";

interface UseElementOptions {
  onSelected?: () => void;
  onDeselected?: () => void;
}

export function useElement(options?: UseElementOptions) {
  const [selection, setSelection] = useState<ElementSelection | null>(null);
  const cbRef = useRef(options);
  cbRef.current = options;

  useEffect(() => {
    const handler = (message: PrismMessage, sender: chrome.runtime.MessageSender) => {
      if (sender.tab) return;
      if (message.type === "ELEMENT_SELECTED") {
        setSelection(message.payload);
        cbRef.current?.onSelected?.();
      } else if (message.type === "ELEMENT_DESELECTED") {
        setSelection(null);
        cbRef.current?.onDeselected?.();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const highlightElement = useCallback((domPath: string) => {
    chrome.runtime.sendMessage({ type: "HIGHLIGHT_ELEMENT", payload: { domPath } });
  }, []);

  const unhighlightElement = useCallback(() => {
    chrome.runtime.sendMessage({ type: "UNHIGHLIGHT_ELEMENT" });
  }, []);

  const selectElement = useCallback((domPath: string) => {
    chrome.runtime.sendMessage({ type: "SELECT_ELEMENT", payload: { domPath } });
  }, []);

  const applyStylePreview = useCallback((domPath: string, property: string, value: string) => {
    chrome.runtime.sendMessage({ type: "APPLY_STYLE_PREVIEW", payload: { domPath, property, value } });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
    chrome.runtime.sendMessage({ type: "UNHIGHLIGHT_ELEMENT" });
  }, []);

  return { selection, highlightElement, unhighlightElement, selectElement, applyStylePreview, clearSelection };
}
