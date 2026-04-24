import { useState, useEffect, useCallback } from "react";
import type { StyleChange, PrismMessage } from "../../shared/types.js";

export function useChanges() {
  const [changes, setChanges] = useState<StyleChange[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);

  useEffect(() => {
    const handler = (message: PrismMessage) => {
      if (message.type === "CHANGES_UPDATE") {
        setChanges(message.payload.changes);
        setUndoCount(message.payload.undoCount);
        setRedoCount(message.payload.redoCount);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Poll for changes every 2s while design mode is active
  useEffect(() => {
    const poll = setInterval(() => {
      chrome.runtime.sendMessage({ type: "GET_PENDING_CHANGES" }).then((result: any) => {
        if (result?.changes) {
          setChanges(result.changes);
        }
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(poll);
  }, []);

  const undo = useCallback(() => {
    chrome.runtime.sendMessage({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    chrome.runtime.sendMessage({ type: "REDO" });
  }, []);

  const clearAll = useCallback(() => {
    chrome.runtime.sendMessage({ type: "CLEAR_CHANGES" });
    setChanges([]);
  }, []);

  return { changes, undoCount, redoCount, undo, redo, clearAll };
}
