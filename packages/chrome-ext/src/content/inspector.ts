import type { ElementSelection, ComponentInfo } from "../shared/types.js";

/** Get React component info from a DOM element via Fiber */
function getReactComponentInfo(element: HTMLElement): ComponentInfo | null {
  const fiberKey = Object.keys(element).find(
    (key) =>
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$")
  );

  if (!fiberKey) return null;

  let fiber = (element as any)[fiberKey];

  while (fiber) {
    if (typeof fiber.type === "function") {
      const source = fiber._debugSource;
      const isNodeModules = source?.fileName?.includes("node_modules");

      if (!isNodeModules) {
        return {
          name: fiber.type.displayName || fiber.type.name || "Anonymous",
          props: sanitizeProps(fiber.memoizedProps),
          sourceFile: source?.fileName,
          sourceLine: source?.lineNumber,
        };
      }
    }
    fiber = fiber.return;
  }
  return null;
}

/** Get Vue component info from a DOM element */
function getVueComponentInfo(element: HTMLElement): ComponentInfo | null {
  // Vue 3
  const vueInstance = (element as any).__vueParentComponent;
  if (vueInstance) {
    return {
      name: vueInstance.type.__name || vueInstance.type.name || "Anonymous",
      props: sanitizeProps(vueInstance.props),
      sourceFile: vueInstance.type.__file,
    };
  }

  // Vue 2
  const vue2 = (element as any).__vue__;
  if (vue2) {
    return {
      name: vue2.$options.name || "Anonymous",
      props: sanitizeProps(vue2.$props),
      sourceFile: vue2.$options.__file,
    };
  }

  return null;
}

/** Remove non-serializable props */
function sanitizeProps(props: Record<string, unknown> | null): Record<string, unknown> {
  if (!props) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children") continue;
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean" || value === null) {
      clean[key] = value;
    } else if (Array.isArray(value)) {
      clean[key] = `[Array(${value.length})]`;
    } else if (t === "object") {
      clean[key] = "[Object]";
    }
    // skip functions
  }
  return clean;
}

/** Get relevant computed styles */
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

/** Build a unique DOM path for an element */
function getDomPath(element: HTMLElement): string {
  const parts: string[] = [];
  let el: HTMLElement | null = element;
  while (el && el !== document.body) {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      selector += `#${el.id}`;
    } else if (el.className && typeof el.className === "string") {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls) selector += `.${cls}`;
    }
    parts.unshift(selector);
    el = el.parentElement;
  }
  return parts.join(" > ");
}

/** Get component chain walking up the DOM: "App > ProductCard > Button" */
export function getComponentChain(element: HTMLElement): string {
  const chain: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body) {
    const comp = getReactComponentInfo(node) || getVueComponentInfo(node);
    if (comp && (chain.length === 0 || chain[chain.length - 1] !== comp.name)) {
      chain.push(comp.name);
    }
    node = node.parentElement;
  }
  chain.reverse();
  return chain.join(" > ");
}

const TEXT_TAGS = new Set(["span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "a", "label", "strong", "em", "b", "i", "li", "td", "th", "dt", "dd", "figcaption"]);

/** Inspect a DOM element and return full selection info */
export function inspectElement(element: HTMLElement): ElementSelection {
  const component =
    getReactComponentInfo(element) || getVueComponentInfo(element);

  const rect = element.getBoundingClientRect();
  const tag = element.tagName.toLowerCase();
  const computed = window.getComputedStyle(element);
  const display = computed.display;

  return {
    domPath: getDomPath(element),
    tagName: tag,
    textContent: (element.textContent || "").trim().slice(0, 100),
    className: typeof element.className === "string" ? element.className : "",
    component,
    componentChain: getComponentChain(element),
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
