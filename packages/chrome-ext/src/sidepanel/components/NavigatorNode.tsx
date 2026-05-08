import { useState, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, Dot } from "lucide-react";
import type { DOMTreeNode } from "../../shared/types.js";

interface Props {
  node: DOMTreeNode;
  depth: number;
  filter: string;
  selectedPath?: string;
  onHover: (domPath: string) => void;
  onUnhover: () => void;
  onSelect: (domPath: string) => void;
}

/** Check if selectedPath is this node or any descendant */
function containsSelected(node: DOMTreeNode, selectedPath: string): boolean {
  if (node.domPath === selectedPath) return true;
  return node.children.some((c) => containsSelected(c, selectedPath));
}

export function NavigatorNode({ node, depth, filter, selectedPath, onHover, onUnhover, onSelect }: Props) {
  const isSelected = selectedPath === node.domPath;
  const hasSelectedDescendant = selectedPath ? containsSelected(node, selectedPath) : false;

  const [expanded, setExpanded] = useState(depth < 3 || hasSelectedDescendant);
  const rowRef = useRef<HTMLDivElement>(null);

  // Auto-expand when a descendant is selected
  useEffect(() => {
    if (hasSelectedDescendant) setExpanded(true);
  }, [hasSelectedDescendant]);

  // Scroll selected node into view
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  const label = node.componentName || node.tagName;
  const cls = node.className?.split(" ")[0];

  // Filter
  if (filter) {
    const match = label.toLowerCase().includes(filter.toLowerCase()) ||
      (cls && cls.toLowerCase().includes(filter.toLowerCase()));
    const childMatch = node.children.some((c) => matchesFilter(c, filter));
    if (!match && !childMatch) return null;
  }

  return (
    <div>
      <div
        ref={rowRef}
        className={`flex items-center gap-0.5 py-[3px] pr-2 cursor-default text-[11px] rounded-sm mx-1 transition-colors
          ${isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
        style={{ paddingLeft: depth * 14 + 4 }}
        onMouseEnter={() => onHover(node.domPath)}
        onMouseLeave={onUnhover}
        onClick={() => onSelect(node.domPath)}
      >
        {/* Toggle */}
        {node.hasChildren ? (
          <button
            className="p-0 h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 flex items-center justify-center">
            <Dot className="h-3 w-3 text-muted-foreground/50" />
          </span>
        )}

        {/* Label */}
        <span className={node.componentName ? "text-primary font-semibold" : "text-foreground"}>
          {label}
        </span>

        {/* Class hint */}
        {cls && !node.componentName && (
          <span className="text-muted-foreground text-[9px] ml-0.5">.{cls}</span>
        )}
      </div>

      {/* Children */}
      {expanded && node.hasChildren && (
        <div>
          {node.children.map((child) => (
            <NavigatorNode
              key={child.id}
              node={child}
              depth={depth + 1}
              filter={filter}
              selectedPath={selectedPath}
              onHover={onHover}
              onUnhover={onUnhover}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function matchesFilter(node: DOMTreeNode, filter: string): boolean {
  const label = (node.componentName || node.tagName).toLowerCase();
  if (label.includes(filter.toLowerCase())) return true;
  return node.children.some((c) => matchesFilter(c, filter));
}
