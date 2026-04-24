import { useState } from "react";
import { Palette } from "lucide-react";
import { useElement } from "../hooks/use-element";
import { Separator } from "@/components/ui/separator";

interface PropertyField {
  key: string;
  label: string;
  type: "color" | "range" | "select";
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  opts?: { v: string; l: string }[];
}

interface PropertyGroup {
  title: string;
  fields: PropertyField[];
}

function buildGroups(isText: boolean, isFlex: boolean): PropertyGroup[] {
  const groups: PropertyGroup[] = [];

  if (isText) {
    groups.push({
      title: "文字",
      fields: [
        { key: "color", label: "颜色", type: "color" },
        { key: "fontSize", label: "字号", type: "range", min: 10, max: 72, unit: "px" },
        { key: "fontWeight", label: "字重", type: "select", opts: [
          { v: "300", l: "细" }, { v: "400", l: "常规" }, { v: "500", l: "中" },
          { v: "600", l: "半粗" }, { v: "700", l: "粗" }, { v: "800", l: "特粗" },
        ]},
      ],
    });
  }

  groups.push({
    title: "外观",
    fields: [
      { key: "backgroundColor", label: "背景色", type: "color" },
      { key: "borderRadius", label: "圆角", type: "range", min: 0, max: 50, unit: "px" },
      { key: "opacity", label: "透明度", type: "range", min: 0, max: 1, step: 0.05 },
    ],
  });

  groups.push({
    title: "间距",
    fields: [
      { key: "padding", label: "内边距", type: "range", min: 0, max: 80, unit: "px" },
      { key: "margin", label: "外边距", type: "range", min: 0, max: 80, unit: "px" },
    ],
  });

  if (isFlex) {
    groups.push({
      title: "布局",
      fields: [
        { key: "gap", label: "间距", type: "range", min: 0, max: 60, unit: "px" },
      ],
    });
  }

  return groups;
}

function rgbToHex(rgb: string): string {
  const match = (rgb || "").match(/\d+/g);
  if (!match || match.length < 3) return "#000000";
  return "#" + match.slice(0, 3).map((n) => parseInt(n).toString(16).padStart(2, "0")).join("");
}

export function PropertiesPanel() {
  const { selection, applyStylePreview } = useElement();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});

  if (!selection) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-8">
        <Palette className="h-8 w-8 text-primary/30" />
        <p>选中页面元素后，可在此编辑样式属性。</p>
      </div>
    );
  }

  const groups = buildGroups(selection.isTextElement, selection.isFlexContainer);

  const getVal = (key: string) => {
    if (localValues[key] !== undefined) return localValues[key];
    const cssProp = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    return selection.styles[cssProp] || selection.styles[key] || "";
  };

  const handleChange = (key: string, value: string) => {
    const unitMap: Record<string, string> = { fontSize: "px", padding: "px", margin: "px", borderRadius: "px", gap: "px" };
    const cssValue = unitMap[key] ? parseFloat(value) + unitMap[key] : value;
    setLocalValues((prev) => ({ ...prev, [key]: value }));
    applyStylePreview(selection.domPath, key.replace(/([A-Z])/g, "-$1").toLowerCase(), cssValue);
  };

  const comp = selection.component;
  const source = comp?.sourceFile?.split("/").slice(-2).join("/");

  return (
    <div className="overflow-y-auto h-full">
      {/* Element info header */}
      <div className="px-3 py-2 border-b">
        <div className="font-semibold text-xs text-primary truncate">
          {comp ? comp.name : `<${selection.tagName}>`}
        </div>
        {source && (
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
            {source}{comp?.sourceLine ? `:${comp.sourceLine}` : ""}
          </div>
        )}
        {selection.componentChain && (
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
            {selection.componentChain}
          </div>
        )}
      </div>

      {/* Property groups */}
      {groups.map((group, gi) => (
        <div key={group.title}>
          {gi > 0 && <Separator />}
          <div className="px-3 py-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {group.title}
            </div>
            <div className="space-y-2">
              {group.fields.map((field) => {
                const rawVal = getVal(field.key);
                const numVal = parseFloat(rawVal) || 0;

                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground w-14 text-right shrink-0">
                      {field.label}
                    </span>
                    {field.type === "color" && (
                      <>
                        <input
                          type="color"
                          className="w-6 h-5 border rounded cursor-pointer p-0"
                          value={rgbToHex(rawVal)}
                          onChange={(e) => handleChange(field.key, e.target.value)}
                        />
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {rgbToHex(rawVal)}
                        </span>
                      </>
                    )}
                    {field.type === "range" && (
                      <>
                        <input
                          type="range"
                          className="flex-1 h-1 accent-primary cursor-pointer"
                          min={field.min}
                          max={field.max}
                          step={field.step || 1}
                          value={numVal}
                          onChange={(e) => handleChange(field.key, e.target.value)}
                        />
                        <span className="text-[10px] text-primary font-mono w-10 text-right">
                          {Math.round(numVal * 100) / 100}{field.unit || ""}
                        </span>
                      </>
                    )}
                    {field.type === "select" && (
                      <select
                        className="flex-1 h-6 text-[11px] border rounded px-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        value={String(Math.round(numVal / 100) * 100)}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                      >
                        {field.opts!.map((o) => (
                          <option key={o.v} value={o.v}>{o.l} ({o.v})</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Text content editing */}
      {selection.textContent && (
        <>
          <Separator />
          <div className="px-3 py-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              文本内容
            </div>
            <textarea
              className="w-full min-h-[40px] max-h-[100px] px-2 py-1.5 text-xs border rounded-md resize-y bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              defaultValue={selection.textContent}
            />
          </div>
        </>
      )}
    </div>
  );
}
