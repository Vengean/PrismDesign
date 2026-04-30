import { useState, useEffect } from "react";
import { Palette } from "lucide-react";
import type { ElementSelection } from "../../shared/types.js";

/* ── color ──────────────────────────────────────────────────────────── */

function toHex(raw: string): string {
  if (!raw || raw === "transparent" || raw === "rgba(0, 0, 0, 0)") return "";
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw))
    return "#" + raw[1] + raw[1] + raw[2] + raw[2] + raw[3] + raw[3];
  const m = raw.match(/rgba?\(\s*([\d.]+)[\s,/]+([\d.]+)[\s,/]+([\d.]+)/);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Math.round(parseFloat(n)).toString(16).padStart(2, "0")).join("");
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#010203";
  ctx.fillStyle = raw;
  return ctx.fillStyle === "#010203" ? "" : ctx.fillStyle;
}

/* ── input field (Figma style: gray bg, value inside, scrub-able) ─── */

function InputField({ value, min, max, step, prefix, suffix, onChange }: {
  value: number; min?: number; max?: number; step?: number;
  prefix?: string; suffix?: string; onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const s = step || 1;
  const clamp = (n: number) => Math.max(min ?? 0, Math.min(max ?? Infinity, n));
  const txt = s < 1 ? String(Math.round(value * 100) / 100) : String(Math.round(value));

  if (editing) return (
    <div className="flex items-center h-[30px] rounded-[6px] bg-background border border-primary/30 px-2 gap-1 flex-1">
      {prefix && <span className="text-[11px] text-muted-foreground shrink-0">{prefix}</span>}
      <input
        autoFocus type="text"
        className="flex-1 min-w-0 bg-transparent text-[12px] font-mono outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const n = parseFloat(draft); if (!isNaN(n)) onChange(clamp(n)); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === "Enter") { const n = parseFloat(draft); if (!isNaN(n)) onChange(clamp(n)); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
      />
      {suffix && <span className="text-[11px] text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  );

  return (
    <div
      className="flex items-center h-[30px] rounded-[6px] bg-secondary/60 hover:bg-secondary px-2 gap-1 flex-1 cursor-ew-resize select-none transition-colors"
      onClick={() => { setDraft(txt); setEditing(true); }}
      onMouseDown={(e) => {
        if (e.detail > 1) return;
        const x0 = e.clientX, v0 = value;
        const mv = (ev: MouseEvent) => onChange(clamp(Math.round((v0 + (ev.clientX - x0) / 2 * s) * 100) / 100));
        const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
        document.addEventListener("mousemove", mv);
        document.addEventListener("mouseup", up);
      }}
    >
      {prefix && <span className="text-[11px] text-muted-foreground shrink-0">{prefix}</span>}
      <span className="text-[12px] font-mono leading-none">{txt}</span>
      {suffix && <span className="text-[11px] text-muted-foreground shrink-0">{suffix}</span>}
    </div>
  );
}

/* ── color field (same shape as InputField) ─────────────────────────── */

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const h = toHex(value) || "#000000";
  const empty = !toHex(value);
  return (
    <label className="relative block rounded-[6px] overflow-hidden cursor-pointer border border-border/30" style={{ width: 30, height: 30 }}>
      <span className="absolute inset-0" style={{
        background: empty ? "repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0/10px 10px" : h,
      }} />
      <input type="color" className="absolute inset-0 opacity-0 cursor-pointer" style={{ width: 30, height: 30 }} value={h} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* ── select field (same shape as InputField) ────────────────────────── */

function SelectField({ value, opts, onChange }: {
  value: string; opts: { v: string; l: string }[]; onChange: (v: string) => void;
}) {
  return (
    <select
      className="flex-1 h-[30px] rounded-[6px] bg-secondary/60 hover:bg-secondary px-2 text-[12px] outline-none cursor-pointer appearance-none transition-colors"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {opts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

/* ── layout helpers ─────────────────────────────────────────────────── */

function SectionTitle({ children }: { children: string }) {
  return <div className="text-[13px] font-semibold mt-3 mb-1.5">{children}</div>;
}

function SubLabel({ children }: { children: string }) {
  return <span className="text-[10px] text-muted-foreground">{children}</span>;
}

function Divider() {
  return <div className="h-px bg-border/40 mt-3" />;
}

/* ── main ──────────────────────────────────────────────────────────── */

export interface StyleEditEvent {
  element: ElementSelection;
  property: string;
  oldValue: string;
  newValue: string;
}

interface Props {
  selection: ElementSelection | null;
  applyStylePreview: (domPath: string, property: string, value: string) => void;
  onStyleEdit?: (edit: StyleEditEvent) => void;
}

export function PropertiesPanel({ selection, applyStylePreview, onStyleEdit }: Props) {
  const [local, setLocal] = useState<Record<string, string>>({});
  useEffect(() => setLocal({}), [selection?.domPath]);

  if (!selection) return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-xs gap-2 py-10">
      <Palette className="h-7 w-7 text-primary/15" />
      <p className="text-center leading-relaxed text-[11px]">选中页面元素后<br />可在此查看和编辑属性</p>
    </div>
  );

  // Get the original value from selection.styles (before any local edits)
  const origVal = (k: string) => {
    const k2 = k.replace(/([A-Z])/g, "-$1").toLowerCase();
    return selection.styles[k2] || selection.styles[k] || "";
  };
  const g = (k: string) => local[k] !== undefined ? local[k] : origVal(k);
  const n = (k: string) => parseFloat(g(k)) || 0;

  const put = (k: string, v: string) => {
    const u: Record<string, string> = { fontSize: "px", borderRadius: "px", gap: "px" };
    const cssValue = u[k] ? parseFloat(v) + u[k] : v;
    setLocal((p) => ({ ...p, [k]: v }));
    applyStylePreview(selection.domPath, k.replace(/([A-Z])/g, "-$1").toLowerCase(), cssValue);
    onStyleEdit?.({ element: selection, property: k, oldValue: origVal(k), newValue: cssValue });
  };

  const putOpacity = (v: number) => {
    const css = String(Math.round(v) / 100);
    setLocal((p) => ({ ...p, opacity: css }));
    applyStylePreview(selection.domPath, "opacity", css);
    onStyleEdit?.({ element: selection, property: "opacity", oldValue: origVal("opacity"), newValue: css });
  };

  const comp = selection.component;
  const src = comp?.sourceFile?.split("/").slice(-2).join("/");

  return (
    <div className="overflow-y-auto h-full px-3 pb-4">

      {/* ── 元素信息 ── */}
      <div className="flex items-center gap-2 py-2.5 border-b border-border/30">
        <div className="w-[22px] h-[22px] rounded-[5px] bg-primary/10 flex items-center justify-center shrink-0">
          <span className="text-[8px] font-bold text-primary">{selection.tagName.slice(0, 2).toUpperCase()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold truncate leading-tight">{comp ? comp.name : `<${selection.tagName}>`}</div>
          {(src || selection.componentChain) && (
            <div className="text-[9px] text-muted-foreground font-mono truncate mt-[1px]">
              {src ? `${src}${comp?.sourceLine ? `:${comp.sourceLine}` : ""}` : selection.componentChain}
            </div>
          )}
        </div>
      </div>

      {/* ── 文字 ── */}
      {selection.isTextElement && (<>
        <SectionTitle>文字</SectionTitle>
        {/* 字号 + 字重 */}
        <div className="grid grid-cols-2 gap-1.5 mb-1">
          <SubLabel>字号</SubLabel>
          <SubLabel>字重</SubLabel>
        </div>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          <InputField value={n("fontSize")} min={0} max={200} onChange={(v) => put("fontSize", String(v))} />
          <SelectField
            value={String(Math.round(n("fontWeight")))}
            opts={[
              { v: "300", l: "细体" }, { v: "400", l: "常规" }, { v: "500", l: "中等" },
              { v: "600", l: "半粗" }, { v: "700", l: "粗体" }, { v: "800", l: "特粗" },
            ]}
            onChange={(v) => put("fontWeight", v)}
          />
        </div>
        {/* 颜色 */}
        <div className="mb-1"><SubLabel>颜色</SubLabel></div>
        <ColorField value={g("color")} onChange={(v) => put("color", v)} />
        <Divider />
      </>)}

      {/* ── 填充 ── */}
      <SectionTitle>填充</SectionTitle>
      <div className="mb-1"><SubLabel>背景色</SubLabel></div>
      <div><ColorField value={g("backgroundColor")} onChange={(v) => put("backgroundColor", v)} /></div>

      <Divider />

      {/* ── 外观 ── */}
      <SectionTitle>外观</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 mb-1">
        <SubLabel>透明度</SubLabel>
        <SubLabel>圆角</SubLabel>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <InputField value={Math.round(n("opacity") * 100)} min={0} max={100} suffix="%" onChange={putOpacity} />
        <InputField value={n("borderRadius")} min={0} max={999} onChange={(v) => put("borderRadius", String(v))} />
      </div>

      {/* ── 布局 ── */}
      {selection.isFlexContainer && (<>
        <Divider />
        <SectionTitle>布局</SectionTitle>
        <div className="mb-1"><SubLabel>间隔</SubLabel></div>
        <div className="grid grid-cols-2 gap-1.5">
          <InputField value={n("gap")} min={0} max={999} onChange={(v) => put("gap", String(v))} />
        </div>
      </>)}
    </div>
  );
}
