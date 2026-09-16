import type { ElementSelection, ComponentInfo, ComponentChainItem } from "../shared/types.js";

// ============================================================
// Page-world bridge (via custom DOM events)
// ============================================================
// The actual fiber inspection code runs in page-bridge.ts (MAIN world).
// We communicate synchronously via:
//   1. content script dispatches CustomEvent on the element
//   2. page-bridge listener (capture, synchronous) inspects and writes
//      the result to a data-attribute
//   3. content script reads the attribute immediately after dispatch

const ATTR_RESULT = "data-prism-result";
const EVENT_NAME = "__prism_inspect";

interface FiberResult {
  component: {
    name: string;
    props: Record<string, unknown>;
    sourceFile?: string;
    sourceLine?: number;
    sourceColumn?: number;
  } | null;
  chain: ComponentChainItem[];
  vue: {
    name: string;
    props: Record<string, unknown>;
    sourceFile?: string;
  } | null;
  error?: string;
}

/**
 * Ask the MAIN-world page-bridge to inspect React/Vue fibers on `element`.
 * Returns synchronously.
 */
function inspectFibersViaPageWorld(element: HTMLElement): FiberResult | null {
  try {
    // Dispatch custom event — page-bridge handles it synchronously
    element.dispatchEvent(new CustomEvent(EVENT_NAME, { bubbles: false }));

    const raw = element.getAttribute(ATTR_RESULT);
    element.removeAttribute(ATTR_RESULT);
    if (!raw || raw === "null") return null;

    const parsed = JSON.parse(raw) as FiberResult;
    if (parsed.error) {
      console.warn("[Prism Studio] page-bridge error:", parsed.error);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ============================================================
// Cache — avoid double page-world calls within a single inspectElement
// ============================================================

let _cachedElement: HTMLElement | null = null;
let _cachedResult: FiberResult | null = null;

function getCachedFiberResult(element: HTMLElement): FiberResult | null {
  if (_cachedElement === element) return _cachedResult;
  _cachedResult = inspectFibersViaPageWorld(element);
  _cachedElement = element;
  return _cachedResult;
}

function getCachedComponentInfo(element: HTMLElement): ComponentInfo | null {
  const result = getCachedFiberResult(element);
  if (!result) return null;
  if (result.component) return result.component;
  if (result.vue) {
    return { name: result.vue.name, props: result.vue.props, sourceFile: result.vue.sourceFile };
  }
  return null;
}

function getCachedChainDetail(element: HTMLElement): ComponentChainItem[] {
  const result = getCachedFiberResult(element);
  if (!result) return [];
  if (result.chain.length > 0) return result.chain;

  // Vue fallback: walk DOM parents
  const chain: ComponentChainItem[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body) {
    const r = inspectFibersViaPageWorld(node);
    if (r?.vue) {
      const name = r.vue.name;
      if (chain.length === 0 || chain[chain.length - 1].name !== name) {
        chain.push({ name, sourceFile: r.vue.sourceFile });
      }
    }
    node = node.parentElement;
  }
  chain.reverse();
  return chain;
}

// ============================================================
// Helpers (run in content-script world — no fiber access needed)
// ============================================================

function getRelevantStyles(element: HTMLElement): Record<string, string> {
  const computed = window.getComputedStyle(element);
  const keys = [
    "color", "backgroundColor", "fontSize", "fontWeight", "fontFamily",
    "lineHeight", "letterSpacing", "textAlign",
    "width", "height", "maxWidth", "maxHeight", "minWidth", "minHeight",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "borderRadius", "borderColor", "borderWidth",
    "display", "flexDirection", "justifyContent", "alignItems", "gap",
    "opacity", "boxShadow",
  ];

  const styles: Record<string, string> = {};
  for (const key of keys) {
    styles[key] = computed.getPropertyValue(
      key.replace(/([A-Z])/g, "-$1").toLowerCase()
    );
  }
  return styles;
}

function getDomPath(element: HTMLElement): string {
  const parts: string[] = [];
  let el: HTMLElement | null = element;
  while (el && el !== document.body) {
    let selector = el.tagName.toLowerCase();
    if (el.id && !el.id.startsWith("prism-studio-")) {
      selector += `#${el.id}`;
    } else {
      if (el.className && typeof el.className === "string") {
        const cls = el.className
          .trim()
          .split(/\s+/)
          .filter((c) => !c.startsWith("prism-studio-") && !c.startsWith("css-"))
          .slice(0, 2)
          .join(".");
        if (cls) selector += `.${cls}`;
      }
      // Add child index to disambiguate siblings with same tag/class
      const parent = el.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(el);
        selector += `[${idx}]`;
      }
    }
    parts.unshift(selector);
    el = el.parentElement;
  }
  return parts.join(" > ");
}

/**
 * Get component chain as a display string.
 */
export function getComponentChain(element: HTMLElement): string {
  const detail = getCachedChainDetail(element);
  return detail.map((c) => c.name).join(" > ");
}

/** Build a simplified DOM snapshot: first child per level, text truncated, siblings as "..." */
function collectDomSnapshot(el: HTMLElement, depth = 0, maxDepth = 4): string {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();

  // Build opening tag with key attributes
  let attrs = "";
  if (el.id) attrs += ` id="${el.id}"`;
  const cls = typeof el.className === "string" ? el.className.trim() : "";
  if (cls) attrs += ` class="${cls.split(" ").slice(0, 3).join(" ")}${cls.split(" ").length > 3 ? " ..." : ""}"`;

  // Leaf node or max depth: show truncated text
  const children = el.children;
  if (children.length === 0 || depth >= maxDepth) {
    const text = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (!text) return `${indent}<${tag}${attrs} />`;
    const truncated = text.length > 30 ? text.slice(0, 30) + "..." : text;
    return `${indent}<${tag}${attrs}>${truncated}</${tag}>`;
  }

  // Container: show first child fully, rest as "..."
  const lines: string[] = [];
  lines.push(`${indent}<${tag}${attrs}>`);

  // Direct text nodes before first child
  for (const node of el.childNodes) {
    if (node === children[0]) break;
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || "").trim();
      if (t) {
        const truncated = t.length > 30 ? t.slice(0, 30) + "..." : t;
        lines.push(`${indent}  ${truncated}`);
      }
    }
  }

  lines.push(collectDomSnapshot(children[0] as HTMLElement, depth + 1, maxDepth));
  if (children.length > 1) {
    lines.push(`${indent}  ...`);
  }

  lines.push(`${indent}</${tag}>`);
  return lines.join("\n");
}

const TEXT_TAGS = new Set(["span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "a", "label", "strong", "em", "b", "i", "li", "td", "th", "dt", "dd", "figcaption"]);

/** Inspect a DOM element and return full selection info */
export function inspectElement(element: HTMLElement): ElementSelection {
  // Reset cache for this element
  _cachedElement = null;
  _cachedResult = null;

  const component = getCachedComponentInfo(element);
  const chainDetail = getCachedChainDetail(element);

  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();
  const computed = window.getComputedStyle(element);
  const display = computed.display;

  return {
    pagePath: window.location.pathname,
    domPath: getDomPath(element),
    tagName: tag,
    id: element.id || "",
    textContent: collectDomSnapshot(element),
    className: typeof element.className === "string" ? element.className : "",
    role: element.getAttribute("role") || "",
    ariaLabel: element.getAttribute("aria-label") || "",
    component,
    componentChain: chainDetail.map((c) => c.name).join(" > "),
    componentChainDetail: chainDetail,
    styles: getRelevantStyles(element),
    rect: {
      top: rect.top + window.scrollY,
      left: rect.left + window.scrollX,
      width: rect.width,
      height: rect.height,
    },
    isTextElement: TEXT_TAGS.has(tag) || element.children.length === 0,
    isFlexContainer: display === "flex" || display === "inline-flex",
  };
}
