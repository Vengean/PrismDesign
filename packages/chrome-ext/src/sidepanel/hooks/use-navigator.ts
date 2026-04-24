import { useState, useEffect, useCallback } from "react";
import type { DOMTreeNode, PrismMessage } from "../../shared/types.js";

export function useNavigator() {
  const [tree, setTree] = useState<DOMTreeNode[]>([]);

  useEffect(() => {
    const handler = (message: PrismMessage) => {
      if (message.type === "DOM_TREE") {
        setTree(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const refreshTree = useCallback(() => {
    chrome.runtime.sendMessage({ type: "GET_DOM_TREE" });
  }, []);

  return { tree, refreshTree };
}
