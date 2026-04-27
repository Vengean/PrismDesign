import { Button } from "@/components/ui/button";
import { Send, Trash2, MessageSquareText } from "lucide-react";
import type { ElementSelection } from "../../shared/types.js";

export interface PendingComment {
  element: ElementSelection;
  comment: string;
}

interface PendingPanelProps {
  comments: PendingComment[];
  onRemove: (index: number) => void;
  onSync: () => void;
}

function formatSourceLoc(file?: string, line?: number, col?: number): string | null {
  if (!file) return null;
  const short = file.split("/").slice(-2).join("/");
  let loc = short;
  if (line) loc += `:${line}`;
  if (col) loc += `:${col}`;
  return loc;
}

export function PendingPanel({ comments, onRemove, onSync }: PendingPanelProps) {
  if (comments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
        <MessageSquareText className="h-8 w-8 text-primary/30" />
        <p className="text-center leading-relaxed">
          点击页面元素添加评论，<br />评论会显示在这里。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Comment list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {comments.map((c, i) => {
          const el = c.element;
          const comp = el.component;
          const displayName = comp?.name || `<${el.tagName}>`;
          const sourceLoc = formatSourceLoc(comp?.sourceFile, comp?.sourceLine, comp?.sourceColumn);

          return (
            <div key={i} className="flex items-start gap-2 px-3 py-2.5 border-b group">
              <div className="flex-1 min-w-0">
                {/* Component / element name */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-primary truncate">{displayName}</span>
                  {el.tagName && displayName !== `<${el.tagName}>` && (
                    <span className="text-[9px] text-muted-foreground">&lt;{el.tagName}&gt;</span>
                  )}
                  {el.id && <span className="text-[9px] text-muted-foreground">#{el.id}</span>}
                </div>
                {/* Component chain */}
                {el.componentChain && displayName !== el.componentChain && (
                  <div className="text-[9px] text-muted-foreground truncate mt-0.5">{el.componentChain}</div>
                )}
                {/* Source file location or page path */}
                {sourceLoc ? (
                  <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{sourceLoc}</div>
                ) : el.pagePath && el.pagePath !== "/" && (
                  <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{el.pagePath}</div>
                )}
                {/* Comment text */}
                <div className="text-xs text-foreground mt-1 break-words">{c.comment}</div>
              </div>
              <button
                className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
                onClick={() => onRemove(i)}
                title="删除"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t p-2">
        <Button className="w-full h-8 text-xs" onClick={onSync}>
          <Send className="h-3 w-3 mr-1.5" />
          同步 ({comments.length})
        </Button>
      </div>
    </div>
  );
}
