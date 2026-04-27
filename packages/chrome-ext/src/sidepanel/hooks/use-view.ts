import { useState, useCallback } from "react";

export type ViewType = "chat" | "navigator" | "properties" | "changes";

export function useView() {
  const [view, setViewState] = useState<ViewType>("chat");
  const [prevView, setPrevView] = useState<ViewType | null>(null);

  const setView = useCallback((v: ViewType) => {
    setViewState((current) => {
      if (current !== v) setPrevView(current);
      return v;
    });
  }, []);

  const goBack = useCallback(() => {
    setPrevView((prev) => {
      if (prev) setViewState(prev);
      return null;
    });
  }, []);

  return { view, setView, prevView, goBack };
}
