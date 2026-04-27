import type { ElementSelection, ComponentInfo } from "../shared/types.js";

// ---- React Fiber Utilities ----

function getReactFiber(element: HTMLElement): any | null {
  const key = Object.keys(element).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
  return key ? (element as any)[key] : null;
}

/**
 * Extract source location from a React fiber.
 * Tries multiple strategies because React 19 removed _debugSource.
 */
function getSourceFromFiber(fiber: any): { fileName?: string; lineNumber?: number } | null {
  // Strategy 1: _debugSource (React 16-18 dev mode)
  if (fiber._debugSource) {
    return fiber._debugSource;
  }

  // Strategy 2: _debugOwner._debugSource (parent component's source)
  if (fiber._debugOwner?._debugSource) {
    return fiber._debugOwner._debugSource;
  }

  // Strategy 3: React DevTools hook — if installed, it has source info
  const hook = (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.renderers?.size > 0) {
    try {
      for (const renderer of hook.renderers.values()) {
        // React DevTools fiber inspector can get source
        if (renderer.findFiberByHostInstance) {
          const inspected = renderer.currentDispatcherRef;
          // This is a fallback — DevTools may have richer info
          if (inspected) break;
        }
      }
    } catch {}
  }

  // Strategy 4: function.toString() + name heuristic for Vite dev
  // In Vite dev, component functions retain original names and sometimes
  // have source-mapped stack traces we can parse
  if (typeof fiber.type === "function" && fiber.type.name) {
    try {
      const err = { stack: "" };
      const orig = Error.prepareStackTrace;
      Error.prepareStackTrace = (_, stack) => stack;
      try {
        // Calling the component as new to get a stack trace is too risky,
        // but we can look at __source which some Babel/SWC plugins inject
        const fn = fiber.type as any;
        if (fn.__source) {
          return { fileName: fn.__source.fileName, lineNumber: fn.__source.lineNumber };
        }
      } finally {
        Error.prepareStackTrace = orig;
      }
    } catch {}
  }

  return null;
}

/** Get the nearest user-land React component info from an element */
function getReactComponentInfo(element: HTMLElement): ComponentInfo | null {
  let fiber = getReactFiber(element);
  if (!fiber) return null;

  while (fiber) {
    if (typeof fiber.type === "function") {
      const name = fiber.type.displayName || fiber.type.name;
      if (!name) { fiber = fiber.return; continue; }

      const source = getSourceFromFiber(fiber);
      const isNodeModules = source?.fileName?.includes("node_modules");

      if (!isNodeModules) {
        return {
          name,
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

/**
 * Walk the React fiber tree upward and collect all user-land component names.
 * This is more accurate than walking DOM parents because React fibers
 * include components that don't render their own DOM node.
 */
function getReactFiberChain(element: HTMLElement): string[] {
  let fiber = getReactFiber(element);
  if (!fiber) return [];

  const chain: string[] = [];
  while (fiber) {
    if (typeof fiber.type === "function") {
      const name = fiber.type.displayName || fiber.type.name;
      if (name) {
        const source = getSourceFromFiber(fiber);
        const isNodeModules = source?.fileName?.includes("node_modules");
        // Include user components + named library components (like Button from antd)
        if (!isNodeModules || name[0] === name[0].toUpperCase()) {
          if (chain.length === 0 || chain[chain.length - 1] !== name) {
            chain.push(name);
          }
        }
      }
    }
    fiber = fiber.return;
  }
  chain.reverse();
  return chain;
}

// ---- Vue Component Detection ----

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

// ---- Helpers ----

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
  }
  return clean;
}

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

/**
 * Get component chain — prefers React fiber tree (more accurate),
 * falls back to walking DOM parents for Vue or no-framework.
 */
export function getComponentChain(element: HTMLElement): string {
  // Try React fiber chain first (walks fiber tree, catches non-DOM components)
  const fiberChain = getReactFiberChain(element);
  if (fiberChain.length > 0) return fiberChain.join(" > ");

  // Fallback: walk DOM parents
  const chain: string[] = [];
  let node: HTMLElement | null = element;
  while (node && node !== document.body) {
    const comp = getVueComponentInfo(node);
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
