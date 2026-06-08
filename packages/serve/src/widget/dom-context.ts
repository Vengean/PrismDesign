/**
 * Collect rich DOM context from the current page for the agent.
 * Similar to chrome-ext's dom-tree.ts + inspector.ts but runs in the same world.
 */

export interface DOMNodeInfo {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  domPath: string;
  attributes: Record<string, string>;
  componentName: string | null;
  children: DOMNodeInfo[];
}

export interface PageContext {
  pagePath: string;
  pageTitle: string;
  domTree: DOMNodeInfo[];
}

const SKIP_TAGS = new Set(["script", "style", "link", "meta", "noscript", "svg", "br", "hr"]);

const USEFUL_ATTRS = new Set([
  "id", "class", "href", "src", "alt", "title", "type", "name",
  "placeholder", "value", "role", "aria-label", "data-testid",
]);

function isPrismElement(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.id?.startsWith("prism-design")) return true;
    node = node.parentElement;
  }
  return false;
}

function getComponentName(el: HTMLElement): string | null {
  // React Fiber
  const fiberKey = Object.keys(el).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
  );
  if (fiberKey) {
    let fiber = (el as any)[fiberKey];
    while (fiber) {
      if (typeof fiber.type === "function") {
        const source = fiber._debugSource;
        if (!source?.fileName?.includes("node_modules")) {
          return fiber.type.displayName || fiber.type.name || null;
        }
      }
      fiber = fiber.return;
    }
  }
  // Vue 3
  const vue3 = (el as any).__vueParentComponent;
  if (vue3) return vue3.type.__name || vue3.type.name || null;
  // Vue 2
  const vue2 = (el as any).__vue__;
  if (vue2) return vue2.$options.name || null;
  return null;
}

function getDomPath(el: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    let sel = node.tagName.toLowerCase();
    if (node.id && !node.id.startsWith("prism-design")) {
      sel += `#${node.id}`;
    } else {
      if (node.className && typeof node.className === "string") {
        const cls = node.className
          .trim()
          .split(/\s+/)
          .filter((c) => !c.startsWith("prism-design") && !c.startsWith("css-"))
          .slice(0, 2)
          .join(".");
        if (cls) sel += `.${cls}`;
      }
      const parent = node.parentElement;
      if (parent) {
        const idx = Array.from(parent.children).indexOf(node);
        sel += `[${idx}]`;
      }
    }
    parts.unshift(sel);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function getDirectText(el: HTMLElement): string {
  const parts: string[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent || "").trim();
      if (t) parts.push(t);
    }
  }
  return parts.join(" ").slice(0, 80);
}

function getUsefulAttributes(el: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    if (USEFUL_ATTRS.has(attr.name) || attr.name.startsWith("data-")) {
      const val = attr.value.trim();
      if (val && val.length < 200) {
        attrs[attr.name] = val;
      }
    }
  }
  return attrs;
}

function buildTree(root: HTMLElement, maxDepth: number, depth = 0): DOMNodeInfo[] {
  if (depth > maxDepth) return [];

  const nodes: DOMNodeInfo[] = [];
  const children = Array.from(root.children) as HTMLElement[];

  for (const child of children) {
    const tag = child.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (isPrismElement(child)) continue;

    const childElements = Array.from(child.children).filter(
      (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()) && !isPrismElement(c as HTMLElement)
    );

    const cls = child.className && typeof child.className === "string"
      ? child.className.trim().split(/\s+/).filter((c) => !c.startsWith("css-")).slice(0, 3).join(" ")
      : "";

    nodes.push({
      tagName: tag,
      id: child.id || "",
      className: cls,
      textContent: getDirectText(child),
      domPath: getDomPath(child),
      attributes: getUsefulAttributes(child),
      componentName: getComponentName(child),
      children: childElements.length > 0 ? buildTree(child, maxDepth, depth + 1) : [],
    });
  }

  return nodes;
}

/**
 * Collect page context: DOM tree with rich node info.
 */
export function collectPageContext(maxDepth = 8): PageContext {
  return {
    pagePath: location.pathname,
    pageTitle: document.title,
    domTree: buildTree(document.body, maxDepth),
  };
}

/**
 * Serialize DOM tree to a compact text representation for the agent.
 */
export function serializeDomTree(nodes: DOMNodeInfo[], indent = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);

  for (const node of nodes) {
    let line = `${prefix}<${node.tagName}`;
    if (node.id) line += `#${node.id}`;
    if (node.className) line += `.${node.className.split(" ").join(".")}`;
    if (node.componentName) line += ` [${node.componentName}]`;

    // Add key attributes
    const attrs = { ...node.attributes };
    delete attrs["id"];
    delete attrs["class"];
    const attrParts = Object.entries(attrs)
      .filter(([, v]) => v.length < 60)
      .slice(0, 3)
      .map(([k, v]) => `${k}="${v}"`);
    if (attrParts.length) line += ` ${attrParts.join(" ")}`;

    line += ">";

    if (node.textContent) {
      line += ` "${node.textContent}"`;
    }

    lines.push(line);

    if (node.children.length > 0) {
      lines.push(serializeDomTree(node.children, indent + 1));
    }
  }

  return lines.join("\n");
}

/**
 * Get a compact text description of a comment target element with richer context.
 */
export function getElementContext(el: Element): {
  label: string;
  domPath: string;
  textContent: string;
  componentName: string | null;
} {
  const htmlEl = el as HTMLElement;
  const tag = el.tagName.toLowerCase();
  let label = tag;
  if (el.id) {
    label = `${tag}#${el.id}`;
  } else if (el.className && typeof el.className === "string") {
    const cls = el.className.trim().split(/\s+/).slice(0, 2).join(".");
    if (cls) label = `${tag}.${cls}`;
  }

  return {
    label,
    domPath: getDomPath(htmlEl),
    textContent: getDirectText(htmlEl),
    componentName: getComponentName(htmlEl),
  };
}
