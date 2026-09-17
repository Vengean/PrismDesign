import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Send, Trash2, ListChecks } from "lucide-react";
import { useChanges } from "../hooks/use-changes";
import { useAgent } from "../hooks/use-agent";
import { useChat } from "../hooks/use-chat";
import type { StyleChange } from "../../shared/types.js";
import { t } from "../../shared/i18n.js";

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

function formatChangesMessage(changes: StyleChange[]): string {
  const groups = groupChanges(changes);
  const parts: string[] = [];

  for (const group of groups.values()) {
    const lines: string[] = [];
    let header = `[${group.label}]`;
    if (group.source) header += ` (${group.source})`;
    lines.push(header);

    for (const c of group.items) {
      if (c.textContent) lines.push(`  text: "${c.textContent}"`);
      if (c.property === "comment") {
        lines.push(`  - comment: "${c.newValue}"`);
      } else {
        lines.push(`  - ${c.property}: "${c.oldValue}" → "${c.newValue}"`);
      }
    }
    parts.push(lines.join("\n"));
  }

  return `Apply the following visual changes to the source code:\n\n${parts.join("\n\n")}`;
}

export function ChangesPanel() {
  const { changes, clearAll } = useChanges();
  const { connected, aiWorking } = useAgent();
  const { sendMessage, addSystemMessage } = useChat();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (changes.length === 0 || !connected || syncing) return;
    setSyncing(true);
    const message = formatChangesMessage(changes);
    sendMessage(message);
    clearAll();
    setSyncing(false);
  };

  if (changes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
        <ListChecks className="h-8 w-8 text-primary" />
        <p>{t("changes.empty")}</p>
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
                <span className="text-muted-foreground font-normal font-mono text-xs ml-1.5">
                  {group.source}
                </span>
              )}
            </div>
            <div className="space-y-1 pl-2">
              {group.items.map((c, ci) => (
                <div key={ci} className="text-xs">
                  {c.property === "comment" ? (
                    <span>
                      <span className="text-muted-foreground">{t("changes.commentLabel")}: </span>
                      <span className="text-tx2">{c.newValue}</span>
                    </span>
                  ) : (
                    <span>
                      <span className="text-muted-foreground">{c.property}: </span>
                      <span className="text-muted-foreground line-through">{c.oldValue || t("changes.emptyValue")}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-tx2 font-medium">{c.newValue}</span>
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
          {syncing ? t("changes.syncingBtn") : `${t("changes.syncBtn")} (${changes.length})`}
          {changes.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-xs">
              {changes.length}
            </Badge>
          )}
        </Button>
        <Button variant="outline" size="sm" className="w-full text-destructive" onClick={clearAll}>
          <Trash2 className="h-3 w-3 mr-1" />
          {t("changes.discard")}
        </Button>
      </div>
    </div>
  );
}
