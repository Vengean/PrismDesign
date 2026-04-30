import type { DOMTreeNode } from "../shared/types.js";

const SKIP_TAGS = new Set(["script", "style", "link", "meta", "noscript", "svg"]);

function isPrismElement(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.id?.startsWith("prism-design-")) return true;
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
    if (node.id && !node.id.startsWith("prism-design-")) {
      sel += `#${node.id}`;
    } else {
      if (node.className && typeof node.className === "string") {
        const cls = node.className
          .trim()
          .split(/\s+/)
          .filter((c) => !c.startsWith("prism-design-") && !c.startsWith("css-"))
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

let idCounter = 0;

export function buildDOMTree(root: HTMLElement, maxDepth = 20, depth = 0): DOMTreeNode[] {
  if (depth > maxDepth) return [];

  const nodes: DOMTreeNode[] = [];
  const children = Array.from(root.children) as HTMLElement[];

  for (const child of children) {
    if (SKIP_TAGS.has(child.tagName.toLowerCase())) continue;
    if (isPrismElement(child)) continue;

    const childElements = Array.from(child.children).filter(
      (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()) && !isPrismElement(c as HTMLElement)
    );
    const hasChildren = childElements.length > 0;
    const childNodes = hasChildren ? buildDOMTree(child, maxDepth, depth + 1) : [];

    const cls = child.className && typeof child.className === "string"
      ? child.className.trim().split(/\s+/).filter((c) => !c.startsWith("css-")).slice(0, 2).join(" ")
      : "";

    nodes.push({
      id: `pdn-${++idCounter}`,
      tagName: child.tagName.toLowerCase(),
      className: cls,
      componentName: getComponentName(child),
      domPath: getDomPath(child),
      hasChildren,
      children: childNodes,
    });
  }

  return nodes;
}

export function resetIdCounter() {
  idCounter = 0;
}
