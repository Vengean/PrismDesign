/**
 * Page-bridge — runs in the PAGE's MAIN JS world (declared in manifest).
 * It can see React fibers, Vue instances, etc. on DOM elements.
 *
 * Communication with the ISOLATED content script is via custom DOM events +
 * data attributes (both are synchronous and cross-world visible).
 */

const ATTR_RESULT = "data-prism-result";
const EVENT_NAME = "__prism_inspect";

function sanitizeProps(props: Record<string, unknown> | null): Record<string, unknown> {
  if (!props) return {};
  const clean: Record<string, unknown> = {};
  try {
    const keys = Object.keys(props);
    for (const key of keys) {
      if (key === "children") continue;
      const value = props[key];
      const t = typeof value;
      if (t === "string" || t === "number" || t === "boolean" || value === null) {
        clean[key] = value;
      } else if (Array.isArray(value)) {
        clean[key] = `[Array(${value.length})]`;
      } else if (t === "object") {
        clean[key] = "[Object]";
      }
    }
  } catch {}
  return clean;
}

/**
 * Parse a V8/Chrome stack trace line to extract file, line, column.
 * Handles formats like:
 *   "    at ComponentName (http://localhost:5173/src/App.tsx?t=123:12:5)"
 *   "    at http://localhost:5173/src/App.tsx:12:5"
 */
function parseStackLine(line: string): { fileName?: string; lineNumber?: number; columnNumber?: number } | null {
  // Match "(url:line:col)" or standalone "url:line:col"
  const m = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at\s+(.+):(\d+):(\d+)/);
  if (!m) return null;

  let fileName = m[1];
  const lineNumber = parseInt(m[2], 10);
  const columnNumber = parseInt(m[3], 10);

  // Convert Vite dev URL to relative path:
  //   "http://localhost:5173/src/App.tsx?t=123" → "src/App.tsx"
  try {
    const url = new URL(fileName);
    fileName = decodeURIComponent(url.pathname);
    if (fileName.startsWith("/")) fileName = fileName.slice(1);
  } catch {
    // If it's already a path, strip query strings
    fileName = fileName.replace(/\?.*$/, "");
  }

  // Skip node_modules, browser internals, etc.
  if (fileName.includes("node_modules") || fileName.startsWith("chrome-extension")) return null;

  return { fileName, lineNumber, columnNumber };
}

/**
 * Extract source location from a React fiber's debug stack (Error object).
 * In React 19, _debugStack is an Error whose first relevant stack frame
 * points to where the JSX element was created (i.e. the component source).
 */
function parseDebugStack(stack: string | undefined): { fileName?: string; lineNumber?: number; columnNumber?: number } | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  // Skip the "Error" header line, then find the first frame that points to user code
  for (let i = 1; i < lines.length; i++) {
    const parsed = parseStackLine(lines[i]);
    if (parsed) return parsed;
  }
  return null;
}

function getSourceFromFiber(fiber: any): { fileName?: string; lineNumber?: number; columnNumber?: number } | null {
  // Strategy 1: React 16-18 _debugSource (direct file/line/column)
  if (fiber._debugSource) return fiber._debugSource;

  // Strategy 2: Parent owner's _debugSource
  if (fiber._debugOwner?._debugSource) return fiber._debugOwner._debugSource;

  // Strategy 3: React 19 _debugStack (Error object with stack trace)
  if (fiber._debugStack) {
    const stack = typeof fiber._debugStack === "string"
      ? fiber._debugStack
      : fiber._debugStack?.stack;
    const parsed = parseDebugStack(stack);
    if (parsed) return parsed;
  }

  // Strategy 4: React 19 _debugInfo array
  if (Array.isArray(fiber._debugInfo)) {
    for (const entry of fiber._debugInfo) {
      if (entry.debugLocation) {
        const stack = typeof entry.debugLocation === "string"
          ? entry.debugLocation
          : entry.debugLocation?.stack;
        const parsed = parseDebugStack(stack);
        if (parsed) return parsed;
      }
    }
  }

  // Strategy 5: Babel/SWC __source injection on the component function
  if (typeof fiber.type === "function" && fiber.type.__source) return fiber.type.__source;

  return null;
}

function inspectElement(el: Element): string {
  try {
    // ---- React ----
    const allKeys = Object.getOwnPropertyNames(el);
    let fiberKey: string | undefined;
    for (const k of allKeys) {
      if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
        fiberKey = k;
        break;
      }
    }

    const fiber = fiberKey ? (el as any)[fiberKey] : null;
    if (fiber) {
      // Fiber tags to skip: ContextProvider(10), ContextConsumer(9), Suspense(13), Fragment(6)
      const SKIP_TAGS = new Set([6, 9, 10, 13]);

      // 1. Find nearest user component via return chain
      let comp = null;
      let f = fiber;
      while (f) {
        if (typeof f.type === "function" && !SKIP_TAGS.has(f.tag)) {
          const name = f.type.displayName || f.type.name;
          if (name && name.length > 2) {
            const src = getSourceFromFiber(f);
            const isNM = src?.fileName?.includes("node_modules");
            if (!comp && !isNM) {
              comp = {
                name,
                props: sanitizeProps(f.memoizedProps),
                sourceFile: src?.fileName,
                sourceLine: src?.lineNumber,
                sourceColumn: src?.columnNumber,
              };
              break;
            }
          }
        }
        f = f.return;
      }

      // 2. Build chain via _debugOwner (authoring hierarchy, skips framework wrappers)
      const chain: any[] = [];
      let owner = fiber._debugOwner;
      while (owner) {
        if (typeof owner.type === "function" && !SKIP_TAGS.has(owner.tag)) {
          const name = owner.type.displayName || owner.type.name;
          if (name && name.length > 2) {
            const src = getSourceFromFiber(owner);
            const isNM = src?.fileName?.includes("node_modules");
            if (!isNM) {
              if (chain.length === 0 || chain[chain.length - 1].name !== name) {
                chain.push({
                  name,
                  sourceFile: src?.fileName,
                  sourceLine: src?.lineNumber,
                  sourceColumn: src?.columnNumber,
                });
              }
            }
          }
        }
        owner = owner._debugOwner;
      }
      chain.reverse();

      // Append the nearest component itself if not already at the end
      if (comp && (chain.length === 0 || chain[chain.length - 1].name !== comp.name)) {
        chain.push({
          name: comp.name,
          sourceFile: comp.sourceFile,
          sourceLine: comp.sourceLine,
          sourceColumn: comp.sourceColumn,
        });
      }

      return JSON.stringify({ component: comp, chain, vue: null });
    }

    // ---- Vue 3 ----
    const vueInstance = (el as any).__vueParentComponent;
    if (vueInstance) {
      const name = vueInstance.type.__name || vueInstance.type.name || "Anonymous";
      return JSON.stringify({
        component: null,
        chain: [],
        vue: {
          name,
          props: sanitizeProps(vueInstance.props),
          sourceFile: vueInstance.type.__file,
        },
      });
    }

    // ---- Vue 2 ----
    const vue2 = (el as any).__vue__;
    if (vue2) {
      const name = vue2.$options.name || "Anonymous";
      return JSON.stringify({
        component: null,
        chain: [],
        vue: {
          name,
          props: sanitizeProps(vue2.$props),
          sourceFile: vue2.$options.__file,
        },
      });
    }
  } catch (err) {
    console.error("[PrismDesign page-bridge]", err);
    return JSON.stringify({ error: (err as Error).message });
  }

  return "null";
}

// Listen for inspection requests from the ISOLATED content script.
// CustomEvent.dispatchEvent is synchronous — the content script can
// read the data-attribute immediately after dispatching.
document.addEventListener(
  EVENT_NAME,
  (e: Event) => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    el.setAttribute(ATTR_RESULT, inspectElement(el));
  },
  true, // capture — handle as early as possible
);

console.log("[PrismDesign] Page bridge loaded (MAIN world)");
