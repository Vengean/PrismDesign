export interface CurrentTabCommand {
  requestId: string;
  action: "attach" | "detach" | "navigate" | "observe" | "click" | "fill" | "press" | "wait" | "screenshot" | "evidence";
  target?: { ref?: string; role?: string; name?: string; label?: string; selector?: string };
  value?: string;
  url?: string;
  key?: string;
  condition?: { kind: "url"; value: string; timeoutMs?: number } | { kind: "text"; value: string; timeoutMs?: number } | { kind: "target"; target: NonNullable<CurrentTabCommand["target"]>; timeoutMs?: number };
}

interface RefDescriptor {
  tag: string;
  id: string;
  role: string;
  name: string;
  occurrence: number;
}

const refs = new Map<number, Map<string, RefDescriptor>>();
const sessions = new Set<number>();
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function assertWebTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^(https?|file):/i.test(tab.url)) throw new Error(`Prism cannot control ${tab.url || "this tab"}`);
  return tab;
}

async function runInPage<T, A extends unknown[]>(tabId: number, func: (...args: A) => T | Promise<T>, args: A): Promise<Awaited<T>> {
  await assertWebTab(tabId);
  const results = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
  if (!results.length) throw new Error("The target page did not return a result");
  return results[0].result as Awaited<T>;
}

function installEvidenceCollector() {
  type PageEvidence = { console: Array<{ type: string; text: string }>; pageErrors: string[]; network: Array<{ method: string; url: string; status?: number; resourceType: string }> };
  const root = globalThis as unknown as { __PRISM_EVIDENCE__?: PageEvidence; __PRISM_EVIDENCE_RESTORE__?: () => void };
  if (root.__PRISM_EVIDENCE__) return;
  const evidence: PageEvidence = { console: [], pageErrors: [], network: [] };
  root.__PRISM_EVIDENCE__ = evidence;
  const stringify = (values: unknown[]) => values.map((value) => {
    try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return String(value); }
  }).join(" ");
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = (...values: unknown[]) => { evidence.console.push({ type: "warning", text: stringify(values) }); originalWarn.apply(console, values); };
  console.error = (...values: unknown[]) => { evidence.console.push({ type: "error", text: stringify(values) }); originalError.apply(console, values); };
  window.addEventListener("error", (event) => evidence.pageErrors.push(event.message || "Page error"));
  window.addEventListener("unhandledrejection", (event) => evidence.pageErrors.push(String(event.reason instanceof Error ? event.reason.message : event.reason)));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const request = new Request(...args);
    try {
      const response = await originalFetch(...args);
      evidence.network.push({ method: request.method, url: response.url || request.url, status: response.status, resourceType: "fetch" });
      return response;
    } catch (error) {
      evidence.network.push({ method: request.method, url: request.url, resourceType: "fetch" });
      throw error;
    }
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: unknown[]) {
    this.addEventListener("loadend", () => evidence.network.push({ method, url: this.responseURL || String(url), status: this.status, resourceType: "xhr" }), { once: true });
    return (originalOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
  };
  root.__PRISM_EVIDENCE_RESTORE__ = () => {
    console.warn = originalWarn;
    console.error = originalError;
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
  };
}

function removeEvidenceCollector() {
  const root = globalThis as unknown as { __PRISM_EVIDENCE__?: unknown; __PRISM_EVIDENCE_RESTORE__?: () => void };
  root.__PRISM_EVIDENCE_RESTORE__?.();
  delete root.__PRISM_EVIDENCE__;
  delete root.__PRISM_EVIDENCE_RESTORE__;
}

function observePage() {
  const nodes = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],[contenteditable=true]")).slice(0, 200) as HTMLElement[];
  const describe = (element: HTMLElement) => {
    const input = element as HTMLInputElement;
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      role: element.getAttribute("role") || (element.tagName === "BUTTON" ? "button" : element.tagName === "A" ? "link" : ["INPUT", "TEXTAREA"].includes(element.tagName) ? "textbox" : element.tagName.toLowerCase()),
      name: element.getAttribute("aria-label") || input.labels?.[0]?.innerText || element.innerText?.trim() || input.placeholder || input.name || "",
    };
  };
  return nodes.map((element, index) => {
    const item = describe(element);
    const occurrence = nodes.slice(0, index).filter((candidate) => {
      const other = describe(candidate);
      return other.tag === item.tag && other.role === item.role && other.name === item.name;
    }).length;
    const input = element as HTMLInputElement;
    return { ...item, occurrence, value: input.type === "password" ? "[REDACTED]" : input.value || "", disabled: input.disabled || element.getAttribute("aria-disabled") === "true" };
  });
}

function pageAction(action: "click" | "fill" | "press", target: CurrentTabCommand["target"], descriptor: RefDescriptor | null, value: string, key: string) {
  const nodes = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],[contenteditable=true]")) as HTMLElement[];
  const accessible = (element: HTMLElement) => {
    const input = element as HTMLInputElement;
    return {
      role: element.getAttribute("role") || (element.tagName === "BUTTON" ? "button" : element.tagName === "A" ? "link" : ["INPUT", "TEXTAREA"].includes(element.tagName) ? "textbox" : element.tagName.toLowerCase()),
      name: element.getAttribute("aria-label") || input.labels?.[0]?.innerText || element.innerText?.trim() || input.placeholder || input.name || "",
    };
  };
  let element: HTMLElement | null = null;
  if (target?.selector) element = document.querySelector(target.selector);
  else if (descriptor?.id) element = document.getElementById(descriptor.id);
  else if (descriptor) element = nodes.filter((candidate) => {
    const item = accessible(candidate);
    return candidate.tagName.toLowerCase() === descriptor.tag && item.role === descriptor.role && item.name === descriptor.name;
  })[descriptor.occurrence] || null;
  else if (target) element = nodes.find((candidate) => {
    const item = accessible(candidate);
    return (!target.role || item.role === target.role) && (!target.name || item.name.includes(target.name)) && (!target.label || item.name.includes(target.label));
  }) || null;
  if (!element) throw new Error("Element not found");
  element.scrollIntoView({ block: "center" });
  if (action === "click") { element.click(); return true; }
  element.focus();
  if (action === "fill") {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("Element is not fillable");
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Native value setter not found");
    setter.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  const allowed = element.dispatchEvent(down);
  element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  if (key === "Enter" && allowed && element instanceof HTMLInputElement) element.form?.requestSubmit();
  return true;
}

function pageMatches(condition: NonNullable<CurrentTabCommand["condition"]>, descriptor: RefDescriptor | null) {
  if (condition.kind === "url") return location.href.includes(condition.value);
  if (condition.kind === "text") return document.body?.innerText.includes(condition.value) || false;
  if (condition.target.selector) return Boolean(document.querySelector(condition.target.selector));
  if (descriptor?.id) return Boolean(document.getElementById(descriptor.id));
  const nodes = Array.from(document.querySelectorAll("a,button,input,textarea,select,[role],[contenteditable=true]")) as HTMLElement[];
  return nodes.some((element) => {
    const input = element as HTMLInputElement;
    const role = element.getAttribute("role") || (element.tagName === "BUTTON" ? "button" : element.tagName === "A" ? "link" : ["INPUT", "TEXTAREA"].includes(element.tagName) ? "textbox" : element.tagName.toLowerCase());
    const name = element.getAttribute("aria-label") || input.labels?.[0]?.innerText || element.innerText?.trim() || input.placeholder || input.name || "";
    return (!condition.target.role || role === condition.target.role) && (!condition.target.name || name.includes(condition.target.name)) && (!condition.target.label || name.includes(condition.target.label));
  });
}

function readEvidence() {
  const root = globalThis as unknown as { __PRISM_EVIDENCE__?: { console: unknown[]; pageErrors: unknown[]; network: unknown[] } };
  const evidence = root.__PRISM_EVIDENCE__ || { console: [], pageErrors: [], network: [] };
  const redact = (value: unknown) => String(value).replace(/(authorization|token|password|cookie)(["'=:\s]+)[^\s,&}]+/gi, "$1$2[REDACTED]");
  return {
    console: evidence.console.slice(-100).map((item) => typeof item === "object" && item ? { ...item as object, text: redact((item as { text?: unknown }).text) } : redact(item)),
    pageErrors: evidence.pageErrors.slice(-100).map(redact),
    network: evidence.network.slice(-200).map((item) => typeof item === "object" && item ? { ...item as object, url: redact((item as { url?: unknown }).url) } : item),
  };
}

function descriptorFor(tabId: number, target?: CurrentTabCommand["target"]): RefDescriptor | null {
  if (!target?.ref) return null;
  const descriptor = refs.get(tabId)?.get(target.ref);
  if (!descriptor) throw new Error(`Unknown or stale element ref: ${target.ref}`);
  return descriptor;
}

async function observe(tabId: number) {
  const elements = await runInPage(tabId, observePage, []);
  const table = new Map<string, RefDescriptor>();
  const result = elements.map((element, index) => {
    const ref = `e${index + 1}`;
    const { tag, id, role, name, occurrence } = element;
    table.set(ref, { tag, id, role, name, occurrence });
    return { ref, ...element };
  });
  refs.set(tabId, table);
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url, title: tab.title, elements: result, mode: "scripting" };
}

async function installCollectorWhenReady(tabId: number, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try { await runInPage(tabId, installEvidenceCollector, []); return; }
    catch (error) { lastError = error; await delay(100); }
  }
  throw lastError instanceof Error ? lastError : new Error("Page did not become ready");
}

async function waitForNavigation(tabId: number, requestedUrl: string, timeoutMs = 15_000) {
  const expected = new URL(requestedUrl, (await chrome.tabs.get(tabId)).url).href;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url === expected) return;
    await delay(100);
  }
  throw new Error(`Navigation timed out: ${expected}`);
}

export async function executeCurrentTabCommand(tabId: number, input: CurrentTabCommand): Promise<unknown> {
  try {
    if (input.action === "attach") {
      await assertWebTab(tabId);
      sessions.add(tabId);
      await installCollectorWhenReady(tabId);
      return observe(tabId);
    }
    if (input.action === "detach") {
      if (sessions.has(tabId)) await runInPage(tabId, removeEvidenceCollector, []).catch(() => {});
      sessions.delete(tabId); refs.delete(tabId);
      return { success: true };
    }
    if (!sessions.has(tabId)) throw new Error("Browser session is not attached");
    if (input.action === "navigate") {
      if (!input.url) throw new Error("url is required");
      await chrome.tabs.update(tabId, { url: input.url });
      await waitForNavigation(tabId, input.url);
      await installCollectorWhenReady(tabId);
      return { success: true, url: input.url };
    }
    if (input.action === "observe") return observe(tabId);
    if (input.action === "evidence") return runInPage(tabId, readEvidence, []);
    if (input.action === "screenshot") {
      const tab = await assertWebTab(tabId);
      if (!tab.active || tab.windowId === undefined) throw new Error("The bound tab must be visible to capture a screenshot");
      const hasCapturePermission = await chrome.permissions.contains({ origins: ["<all_urls>"] });
      if (!hasCapturePermission) {
        throw new Error("Screenshot permission is unavailable. Reload Prism 0.5.2 and approve its site-access permission");
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      return { data: dataUrl.replace(/^data:image\/png;base64,/, "") };
    }
    if (input.action === "wait") {
      if (!input.condition) throw new Error("condition is required");
      const timeout = Math.min(input.condition.timeoutMs || 10_000, 60_000);
      const descriptor = input.condition.kind === "target" ? descriptorFor(tabId, input.condition.target) : null;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (await runInPage(tabId, pageMatches, [input.condition, descriptor])) return { matched: true, url: (await chrome.tabs.get(tabId)).url };
        await delay(200);
      }
      throw new Error("Wait timed out");
    }
    if (!input.target) throw new Error("target is required");
    await runInPage(tabId, pageAction, [input.action as "click" | "fill" | "press", input.target, descriptorFor(tabId, input.target), input.value || "", input.key || "Enter"]);
    return { success: true, url: (await chrome.tabs.get(tabId)).url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    throw new Error(`${message} (runtime=scripting-v1, action=${input.action}, tabId=${tabId}, url=${tab?.url || "unknown"})`);
  }
}
