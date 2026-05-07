import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Layers } from "lucide-react";
import { t } from "../../shared/i18n.js";
import { useNavigator } from "../hooks/use-navigator";
import type { ElementSelection } from "../../shared/types.js";
import { NavigatorNode } from "./NavigatorNode";

interface NavigatorProps {
  selection: ElementSelection | null;
  highlightElement: (domPath: string) => void;
  unhighlightElement: () => void;
  selectElement: (domPath: string) => void;
}

export function Navigator({ selection, highlightElement, unhighlightElement, selectElement }: NavigatorProps) {
  const { tree, refreshTree } = useNavigator();
  const [filter, setFilter] = useState("");

  useEffect(() => {
    refreshTree();
  }, [refreshTree]);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b">
        <input
          type="text"
          className="flex-1 h-6 px-2 text-[11px] border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={t("nav.search")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={refreshTree} title={t("nav.refresh")}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 min-h-0">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
            <Layers className="h-8 w-8 text-primary/30" />
            <p>{t("nav.empty")}</p>
          </div>
        ) : (
          tree.map((node) => (
            <NavigatorNode
              key={node.id}
              node={node}
              depth={0}
              filter={filter}
              selectedPath={selection?.domPath}
              onHover={highlightElement}
              onUnhover={unhighlightElement}
              onSelect={selectElement}
            />
          ))
        )}
      </div>
    </div>
  );
}
