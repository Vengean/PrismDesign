import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Send, Trash2, ListChecks } from "lucide-react";
import { useChanges } from "../hooks/use-changes";
import { useAgent } from "../hooks/use-agent";
import { useChat } from "../hooks/use-chat";
import type { StyleChange } from "../../shared/types.js";

function groupChanges(changes: StyleChange[]): Map<string, { label: string; source: string; items: StyleChange[] }> {
  const groups = new Map<string, { label: string; source: string; items: StyleChange[] }>();
  for (const c of changes) {
    const label = c.componentChain || c.componentName || c.selector?.split(" > ").pop() || "unknown";
    const source = c.sourceFile ? c.sourceFile.split("/").slice(-2).join("/") + (c.sourceLine ? `:${c.sourceLine}` : "") : "";
    const key = label + "||" + source;
    if (!groups.has(key)) groups.set(key, { label, source, items: [] });
    groups.get(key)!.items.push(c);
  }
  return groups;
}

export function ChangesPanel() {
  const { changes, clearAll } = useChanges();
  const { applyChanges, connected, aiWorking } = useAgent();
  const { addSystemMessage } = useChat();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (changes.length === 0 || !connected || syncing) return;
    setSyncing(true);
    addSystemMessage(`正在同步 ${changes.length} 项变更到源码...`);
    try {
      const result = await applyChanges(changes);
      if (result?.success) {
        addSystemMessage(result.message || "同步完成。");
        clearAll();
      } else {
        addSystemMessage(`同步失败: ${result?.message || "未知错误"}`);
      }
    } catch {
      addSystemMessage("同步请求失败。");
    }
    setSyncing(false);
  };

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
        <ListChecks className="h-8 w-8 text-primary/30" />
        <p>暂无待同步的变更。</p>
      </div>
    );
  }

  const groups = groupChanges(changes);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {Array.from(groups.values()).map((group, gi) => (
          <div key={gi}>
            <div className="text-xs font-semibold text-primary mb-1">
              {group.label}
              {group.source && (
                <span className="text-muted-foreground font-normal font-mono text-[10px] ml-1.5">
                  {group.source}
                </span>
              )}
            </div>
            <div className="space-y-1 pl-2">
              {group.items.map((c, ci) => (
                <div key={ci} className="text-[11px]">
                  {c.property === "comment" ? (
                    <span>
                      <span className="text-muted-foreground">评论: </span>
                      <span className="text-green-600">{c.newValue}</span>
                    </span>
                  ) : (
                    <span>
                      <span className="text-muted-foreground">{c.property}: </span>
                      <span className="text-muted-foreground line-through">{c.oldValue || "(空)"}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-green-600 font-medium">{c.newValue}</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Separator />

      <div className="p-3 space-y-2">
        <Button
          className="w-full"
          onClick={handleSync}
          disabled={!connected || syncing || aiWorking}
        >
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {syncing ? "同步中..." : `同步到代码 (${changes.length})`}
          {changes.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px]">
              {changes.length}
            </Badge>
          )}
        </Button>
        <Button variant="outline" size="sm" className="w-full text-destructive" onClick={clearAll}>
          <Trash2 className="h-3 w-3 mr-1" />
          丢弃所有变更
        </Button>
      </div>
    </div>
  );
}
