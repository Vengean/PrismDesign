import { Button } from "@/components/ui/button";
import { Send, Trash2, MessageSquareText, Paintbrush, MoveVertical } from "lucide-react";
import type { ElementSelection } from "../../shared/types.js";
import { t } from "../../shared/i18n.js";

export interface PendingComment {
  element: ElementSelection;
  comment: string;
}

export interface PendingEdit {
  element: ElementSelection;
  properties: Record<string, { oldValue: string; newValue: string }>;
}

export interface PendingDrag {
  element: ElementSelection;
  from: number;
  to: number;
}

interface PendingPanelProps {
  comments: PendingComment[];
  edits: PendingEdit[];
  drags: PendingDrag[];
  onRemoveComment: (index: number) => void;
  onRemoveEdit: (domPath: string) => void;
  onRemoveDrag: (index: number) => void;
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

function getPropLabel(prop: string): string {
  const map: Record<string, string> = {
    color: "props.color", backgroundColor: "props.background", fontSize: "props.fontSize",
    fontWeight: "props.fontWeight", opacity: "props.opacity", borderRadius: "props.borderRadius",
    padding: "sync.padding", margin: "sync.margin", gap: "props.gap",
    "font-size": "props.fontSize", "background-color": "props.background", "font-weight": "props.fontWeight",
    "border-radius": "props.borderRadius",
  };
  return map[prop] ? t(map[prop]) : prop;
}

function ElementHeader({ el }: { el: ElementSelection }) {
  const comp = el.component;
  const displayName = comp?.name || `<${el.tagName}>`;
  const sourceLoc = formatSourceLoc(comp?.sourceFile, comp?.sourceLine, comp?.sourceColumn);

  return (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-primary truncate">{displayName}</span>
        {el.tagName && displayName !== `<${el.tagName}>` && (
          <span className="text-[9px] text-muted-foreground">&lt;{el.tagName}&gt;</span>
        )}
        {el.id && <span className="text-[9px] text-muted-foreground">#{el.id}</span>}
      </div>
      {el.componentChain && displayName !== el.componentChain && (
        <div className="text-[9px] text-muted-foreground truncate mt-0.5">{el.componentChain}</div>
      )}
      {sourceLoc ? (
        <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{sourceLoc}</div>
      ) : el.pagePath && el.pagePath !== "/" && (
        <div className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">{el.pagePath}</div>
      )}
    </>
  );
}

export function PendingPanel({ comments, edits, drags, onRemoveComment, onRemoveEdit, onRemoveDrag, onSync }: PendingPanelProps) {
  const totalCount = comments.length + edits.length + drags.length;

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
        <MessageSquareText className="h-8 w-8 text-primary/30" />
        <p className="text-center leading-relaxed">
          {t("pending.empty").split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Style edits */}
        {edits.map((edit) => (
          <div key={edit.element.domPath} className="flex items-start gap-2 px-3 py-2.5 border-b group">
            <Paintbrush className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <ElementHeader el={edit.element} />
              <div className="mt-1.5 space-y-0.5">
                {Object.entries(edit.properties).map(([prop, { oldValue, newValue }]) => (
                  <div key={prop} className="text-[10px] text-foreground font-mono">
                    <span className="text-muted-foreground">{getPropLabel(prop)}: </span>
                    <span className="line-through text-muted-foreground/60">{oldValue || t("pending.none")}</span>
                    <span className="text-muted-foreground mx-1">&rarr;</span>
                    <span className="text-primary font-medium">{newValue}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
              onClick={() => onRemoveEdit(edit.element.domPath)}
              title={t("pending.delete")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {/* Drag moves */}
        {drags.map((d, i) => (
          <div key={`drag-${i}`} className="flex items-start gap-2 px-3 py-2.5 border-b group">
            <MoveVertical className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <ElementHeader el={d.element} />
              <div className="text-[10px] text-foreground font-mono mt-1.5">
                <span className="text-muted-foreground">{t("pending.position")}: </span>
                <span className="line-through text-muted-foreground/60">{t("pending.itemN", { n: d.from + 1 })}</span>
                <span className="text-muted-foreground mx-1">&rarr;</span>
                <span className="text-primary font-medium">{t("pending.itemN", { n: d.to + 1 })}</span>
              </div>
            </div>
            <button
              className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
              onClick={() => onRemoveDrag(i)}
              title={t("pending.delete")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}

        {/* Comments */}
        {comments.map((c, i) => (
          <div key={`comment-${i}`} className="flex items-start gap-2 px-3 py-2.5 border-b group">
            <MessageSquareText className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <ElementHeader el={c.element} />
              <div className="text-xs text-foreground mt-1 break-words">{c.comment}</div>
            </div>
            <button
              className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
              onClick={() => onRemoveComment(i)}
              title={t("pending.delete")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t p-2">
        <Button className="w-full h-8 text-xs" onClick={onSync}>
          <Send className="h-3 w-3 mr-1.5" />
          {t("pending.sync")} ({totalCount})
        </Button>
      </div>
    </div>
  );
}
