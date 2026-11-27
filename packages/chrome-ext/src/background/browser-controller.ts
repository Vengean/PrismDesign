export interface CurrentTabCommand {
  requestId: string;
  responseRequestId?:string;
  action: "attach" | "detach" | "navigate" | "observe" | "scroll" | "click" | "fill" | "press" | "wait" | "screenshot" | "evidence" | "responseBody";
  target?: { ref?: string; role?: string; name?: string; label?: string; selector?: string };
  value?: string;
  url?: string;
  key?: string;
  deltaX?: number;
  deltaY?: number;
  condition?: { kind: "url"; value: string; timeoutMs?: number } | { kind: "text"; value: string; timeoutMs?: number } | { kind: "target"; target: NonNullable<CurrentTabCommand["target"]>; timeoutMs?: number };
}

interface RefDescriptor { tag: string; id: string; role: string; name: string; occurrence: number }
interface PageEvidence {
  console: Array<{ type: string; text: string; timestamp?: number }>;
  pageErrors: string[];
  network: Array<{ requestId?: string; method?: string; url?: string; status?: number; mimeType?: string; resourceType?: string; errorText?: string }>;
  requests: Map<string, { method?: string; url?: string; resourceType?: string }>;
}

const sessions = new Set<number>();
const refs = new Map<number, Map<string, RefDescriptor>>();
const evidence = new Map<number, PageEvidence>();
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
// Bound retention at ingestion, not only when returning the latest evidence.
const MAX_EVIDENCE = 200;
const MAX_REQUESTS = 256;
const MAX_LOG_TEXT = 4096;
const clip = (value: unknown) => String(value ?? '').slice(0, MAX_LOG_TEXT);
function retain<T>(items:T[],item:T){
  items.push(item);
  if(items.length>MAX_EVIDENCE)items.splice(0,items.length-MAX_EVIDENCE);
}
function internalRequest(url:string){try{return new URL(url).pathname.startsWith('/__prism_platform__/');}catch{return false;}}

function sanitizeJsonForAgent(value: unknown) {
  const sensitiveName = /^(?:access_?token|auth(?:orization)?|code|cookie|credential|key|password|refresh_?token|secret|session(?:id)?|token)$/i;
  const redactedPaths: string[] = [];
  let remainingNodes = 500;
  let remainingChars = 20_000;
  let truncated = false;
  const redactText = (text: string) => text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/(authorization|access_?token|refresh_?token|token|password|cookie|secret|session(?:id)?)(["'=:\s]+)[^\s,&}]+/gi, "$1$2[REDACTED]");
  const visit = (input: unknown, path: string, depth: number): unknown => {
    if (remainingNodes-- <= 0 || depth > 8) { truncated = true; return "[TRUNCATED]"; }
    if (input === null || typeof input === "boolean" || typeof input === "number") return input;
    if (typeof input === "string") {
      const redacted = redactText(input);
      const limit = Math.min(2_000, Math.max(0, remainingChars));
      remainingChars -= Math.min(redacted.length, limit);
      if (redacted.length > limit) { truncated = true; return `${redacted.slice(0, limit)}[TRUNCATED]`; }
      return redacted;
    }
    if (Array.isArray(input)) {
      if (input.length > 20) truncated = true;
      return input.slice(0, 20).map((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    }
    if (typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>);
      if (entries.length > 100) truncated = true;
      return Object.fromEntries(entries.slice(0, 100).map(([key, item]) => {
        const itemPath = path ? `${path}.${key}` : key;
        if (sensitiveName.test(key)) { redactedPaths.push(itemPath); return [key, "[REDACTED]"]; }
        return [key, visit(item, itemPath, depth + 1)];
      }));
    }
    return String(input);
  };
  return { preview: visit(value, "", 0), redactedPaths, truncated };
}

async function assertWebTab(tabId: number) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^(https?|file):/i.test(tab.url)) {
    throw new Error(`CDP mode cannot control ${tab.url || "this tab"}. Bind an HTTP(S) application page first`);
  }
  return tab;
}

async function command<T = any>(tabId: number, method: string, params?: object): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
}

async function attach(tabId: number) {
  await assertWebTab(tabId);
  if (sessions.has(tabId)) {
    try {
      await command(tabId, "Runtime.enable");
      return;
    } catch {
      sessions.delete(tabId);
      refs.delete(tabId);
      evidence.delete(tabId);
    }
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) {
      throw new Error(message);
    }
    await command(tabId, "Runtime.enable");
  }
  sessions.add(tabId);
  evidence.set(tabId, { console: [], pageErrors: [], network: [], requests: new Map() });
  try {
    await Promise.all([
      command(tabId, "Runtime.enable"),
      command(tabId, "Page.enable"),
      command(tabId, "Network.enable", {maxTotalBufferSize:8*1024*1024,maxResourceBufferSize:1024*1024,maxPostDataSize:0}),
      command(tabId, "Log.enable"),
    ]);
  } catch (error) {
    sessions.delete(tabId);
    refs.delete(tabId);
    evidence.delete(tabId);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    throw error;
  }
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined) return;
  sessions.delete(source.tabId);
  refs.delete(source.tabId);
  evidence.delete(source.tabId);
});

chrome.debugger.onEvent.addListener((source, method, raw) => {
  const tabId = source.tabId;
  if (tabId === undefined || !sessions.has(tabId)) return;
  const log = evidence.get(tabId);
  if (!log) return;
  const params = raw as any;
  if (method === "Runtime.consoleAPICalled") {
    const text = (params.args || []).slice(0,20).map((arg: any) => clip(arg.value ?? arg.description)).join(" ").slice(0,MAX_LOG_TEXT);
    retain(log.console,{ type: clip(params.type || "log"), text, timestamp: params.timestamp });
  } else if (method === "Runtime.exceptionThrown") {
    retain(log.pageErrors,clip(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Page exception"));
  } else if (method === "Log.entryAdded") {
    const entry = params.entry || {};
    if(String(entry.url||'').includes('/__prism_platform__/'))return;
    if (entry.level === "error") retain(log.pageErrors,clip(entry.text || "Page error"));
    else retain(log.console,{ type: clip(entry.level || "log"), text: clip(entry.text), timestamp: entry.timestamp });
  } else if (method === "Network.requestWillBeSent") {
    if(internalRequest(params.request?.url||''))return;
    log.requests.delete(params.requestId);
    log.requests.set(params.requestId, { method: clip(params.request?.method), url: clip(params.request?.url), resourceType: clip(params.type) });
    while(log.requests.size>MAX_REQUESTS)log.requests.delete(log.requests.keys().next().value!);
  } else if (method === "Network.responseReceived") {
    const response = params.response || {};
    const request = log.requests.get(params.requestId) || {};
    log.requests.delete(params.requestId);
    if(internalRequest(response.url||request.url||''))return;
    retain(log.network,{ requestId: params.requestId, method: request.method, url: clip(response.url || request.url), status: response.status, mimeType: clip(response.mimeType), resourceType: clip(params.type || request.resourceType) });
  } else if (method === "Network.loadingFailed") {
    const request = log.requests.get(params.requestId) || {};
    retain(log.network,{ requestId: params.requestId, ...request, status: 0, resourceType: clip(params.type || request.resourceType || "failed"), errorText: clip(params.errorText) });
    log.requests.delete(params.requestId);
  }
});

async function evaluate<T>(tabId: number, expression: string): Promise<T> {
  const response = await command<any>(tabId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Page evaluation failed");
  }
  return response.result?.value as T;
}

const elementQuery = "a,button,input,textarea,select,[role],[contenteditable=true]";

async function observe(tabId: number) {
  const elements = await evaluate<Array<RefDescriptor & { value: string; disabled: boolean }>>(tabId, `(() => {
    const nodes = Array.from(document.querySelectorAll(${JSON.stringify(elementQuery)})).slice(0, 200);
    const describe = el => ({
      tag: el.tagName.toLowerCase(), id: el.id || '',
      role: el.getAttribute('role') || (el.tagName === 'BUTTON' ? 'button' : el.tagName === 'A' ? 'link' : ['INPUT','TEXTAREA'].includes(el.tagName) ? 'textbox' : el.tagName.toLowerCase()),
      name: el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.innerText?.trim() || el.placeholder || el.name || ''
    });
    const occurrences = new Map();
    return nodes.map(el => {
      const item = describe(el);
      const key = JSON.stringify([item.tag,item.role,item.name]);
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key,occurrence+1);
      return { ...item, occurrence, value: el.type === 'password' ? '[REDACTED]' : el.value || '', disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' };
    });
  })()`);
  const table = new Map<string, RefDescriptor>();
  const result = elements.map((element, index) => { const ref = `e${index + 1}`; table.set(ref, element); return { ref, ...element }; });
  refs.set(tabId, table);
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url, title: tab.title, elements: result };
}

function targetExpression(tabId: number, target: NonNullable<CurrentTabCommand["target"]>): string {
  if (target.selector) return `document.querySelector(${JSON.stringify(target.selector)})`;
  const descriptor = target.ref ? refs.get(tabId)?.get(target.ref) : undefined;
  if (target.ref && !descriptor) throw new Error(`Unknown or stale element ref: ${target.ref}`);
  const query = JSON.stringify(descriptor || target);
  return `(() => { const t=${query}; const nodes=Array.from(document.querySelectorAll(${JSON.stringify(elementQuery)})); const describe=el=>({tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||(el.tagName==='BUTTON'?'button':el.tagName==='A'?'link':['INPUT','TEXTAREA'].includes(el.tagName)?'textbox':el.tagName.toLowerCase()),name:el.getAttribute('aria-label')||(el.labels&&el.labels[0]&&el.labels[0].innerText)||el.innerText?.trim()||el.placeholder||el.name||''}); if(t.id){const byId=document.getElementById(t.id);if(byId)return byId;} const matches=nodes.filter(el=>{const item=describe(el);return (!t.tag||item.tag===t.tag)&&(!t.role||item.role===t.role)&&(!t.name||item.name.includes(t.name))&&(!t.label||item.name.includes(t.label));}); return matches[t.occurrence||0]||null; })()`;
}

async function elementPoint(tabId: number, target: NonNullable<CurrentTabCommand["target"]>) {
  const expression = targetExpression(tabId, target);
  return evaluate<{ x: number; y: number }>(tabId, `(async () => {
    const el=${expression};
    if(!el) throw new Error('Element not found');
    el.scrollIntoView({block:'center'});
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    const r=el.getBoundingClientRect();
    if(!r.width&&!r.height) throw new Error('Element is not visible');
    const x=r.left+r.width/2, y=r.top+r.height/2;
    const top=document.elementFromPoint(x,y);
    if(top && top!==el && !el.contains(top)) {
      const description=top.id ? '#' + top.id : top.tagName.toLowerCase() + (top.classList.length ? '.' + Array.from(top.classList).slice(0,3).join('.') : '');
      throw new Error('Element is covered at its click point by ' + description);
    }
    return {x,y};
  })()`);
}

async function focusElement(tabId: number, target: NonNullable<CurrentTabCommand["target"]>) {
  const expression = targetExpression(tabId, target);
  await evaluate(tabId, `(() => { const el=${expression}; if(!el) throw new Error('Element not found'); if(!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) throw new Error('Element is not fillable'); el.scrollIntoView({block:'center'}); el.focus(); return true; })()`);
}

async function fillElement(tabId: number, target: NonNullable<CurrentTabCommand["target"]>, value: string) {
  const expression = targetExpression(tabId, target);
  return evaluate<{ contentEditable: boolean; length: number }>(tabId, `(() => {
    const el=${expression};
    if(!el) throw new Error('Element not found');
    if(el.disabled || el.readOnly) throw new Error('Element is disabled or read-only');
    el.scrollIntoView({block:'center'});
    if(el.isContentEditable) return {contentEditable:true,length:0};
    if(!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error('Element is not fillable');
    const prototype=el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;
    if(!setter) throw new Error('Native value setter not found');
    const nextValue=${JSON.stringify(value)};
    setter.call(el,nextValue);
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:nextValue}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    if(el.value!==nextValue) throw new Error('The page rejected the filled value');
    return {contentEditable:false,length:el.value.length};
  })()`);
}

async function pressKey(tabId: number, key: string, modifiers = 0) {
  await command(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key, modifiers });
  await command(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key, modifiers });
}

async function waitForNavigation(tabId: number, requestedUrl: string, timeoutMs = 15_000) {
  const expected = new URL(requestedUrl, (await chrome.tabs.get(tabId)).url).href;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(updated); };
    const updated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && info.status === "complete" && tab.url === expected) { cleanup(); resolve(); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Navigation timed out: ${expected}`)); }, timeoutMs);
    chrome.tabs.onUpdated.addListener(updated);
    void chrome.tabs.update(tabId, { url: expected }).catch(error => { cleanup(); reject(error); });
  });
}

export async function executeCurrentTabCommand(tabId: number, input: CurrentTabCommand): Promise<unknown> {
  try {
    if (input.action === "attach") { await attach(tabId); return observe(tabId); }
    if (input.action === "detach") {
      if (sessions.has(tabId)) await chrome.debugger.detach({ tabId }).catch(() => {});
      sessions.delete(tabId); refs.delete(tabId); evidence.delete(tabId);
      return { success: true };
    }
    if (!sessions.has(tabId)) throw new Error("CDP browser session is not attached");
    await attach(tabId);
    if (input.action === "navigate") {
      if (!input.url) throw new Error("url is required");
      await waitForNavigation(tabId, input.url);
      return { success: true, url: input.url };
    }
    if (input.action === "observe") return observe(tabId);
    if (input.action === "scroll") {
      const viewport = await evaluate<{ x: number; y: number }>(tabId, `({x:window.innerWidth/2,y:window.innerHeight/2})`);
      const deltaX = Number.isFinite(input.deltaX) ? input.deltaX! : 0;
      const deltaY = Number.isFinite(input.deltaY) ? input.deltaY! : 0;
      await command(tabId, "Input.dispatchMouseEvent", { type: "mouseWheel", ...viewport, deltaX, deltaY });
      await delay(50);
      return evaluate(tabId, `({url:location.href,scrollX:window.scrollX,scrollY:window.scrollY})`);
    }
    if (input.action === "evidence") {
      const snapshot = evidence.get(tabId);
      if (!snapshot) return { console: [], pageErrors: [], network: [] };
      const redactText = (value: string) => value
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
        .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
        .replace(/(authorization|access_?token|refresh_?token|token|password|cookie|secret|session(?:id)?)(["'=:\s]+)[^\s,&}]+/gi, "$1$2[REDACTED]");
      const redactUrl = (value = "") => {
        try {
          const url = new URL(value);
          if (url.username) url.username = "[REDACTED]";
          if (url.password) url.password = "[REDACTED]";
          for (const key of [...url.searchParams.keys()]) {
            if (/^(?:access_?token|auth(?:orization)?|code|cookie|credential|key|password|refresh_?token|secret|session(?:id)?|token)$/i.test(key)) url.searchParams.set(key, "[REDACTED]");
          }
          url.hash = "";
          return url.toString();
        } catch { return redactText(value); }
      };
      return {
        console: snapshot.console.slice(-100).map((item) => ({ ...item, text: redactText(item.text) })),
        pageErrors: snapshot.pageErrors.slice(-100).map(redactText),
        network: snapshot.network.filter(item=>{try{return !new URL(item.url||'').pathname.startsWith('/__prism_platform__/');}catch{return true;}}).slice(-200).map(({ requestId, ...item }) => ({ ...item, requestHandle: requestId, url: redactUrl(item.url), errorText: item.errorText ? redactText(item.errorText) : undefined })),
      };
    }
    if (input.action === "screenshot") return command(tabId, "Page.captureScreenshot", { format: "png", fromSurface: true });
    if (input.action === "responseBody") {
      const responseRequestId=input.responseRequestId||input.requestId;
      if (!responseRequestId) throw new Error("responseRequestId is required");
      const item = evidence.get(tabId)?.network.find((entry) => entry.requestId === responseRequestId);
      if (!item) throw new Error("The selected network response is no longer available");
      if (!/(?:^|[+/])json(?:$|;)/i.test(item.mimeType || "")) throw new Error(`Response body inspection only supports JSON, received ${item.mimeType || "unknown content type"}`);
      const body = await command<{ body: string; base64Encoded?: boolean }>(tabId, "Network.getResponseBody", { requestId: responseRequestId });
      const text = body.base64Encoded
        ? new TextDecoder().decode(Uint8Array.from(atob(body.body), (character) => character.charCodeAt(0)))
        : body.body;
      const originalSize = new TextEncoder().encode(text).byteLength;
      if (originalSize > 1_000_000) throw new Error(`JSON response body exceeds the 1000000 byte inspection limit (${originalSize} bytes)`);
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { throw new Error("Response declared JSON but could not be parsed"); }
      return { ...sanitizeJsonForAgent(parsed), originalSize, contentType: item.mimeType };
    }
    if (input.action === "wait") {
      if (!input.condition) throw new Error("condition is required");
      const timeout = Math.min(input.condition.timeoutMs || 10_000, 60_000);
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const tab = await chrome.tabs.get(tabId);
        if (input.condition.kind === "url" && tab.url?.includes(input.condition.value)) return { matched: true, url: tab.url };
        if (input.condition.kind === "text" && await evaluate<boolean>(tabId, `document.body?.innerText.includes(${JSON.stringify(input.condition.value)}) || false`)) return { matched: true, url: tab.url };
        if (input.condition.kind === "target" && await evaluate<boolean>(tabId, `!!(${targetExpression(tabId, input.condition.target)})`)) return { matched: true, url: tab.url };
        await delay(200);
      }
      throw new Error("Wait timed out");
    }
    if (!input.target) throw new Error("target is required");
    if (input.action === "click") {
      const point = await elementPoint(tabId, input.target);
      await command(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await command(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    } else if (input.action === "fill") {
      const value = input.value || "";
      const result = await fillElement(tabId, input.target, value);
      if (result.contentEditable) {
        await focusElement(tabId, input.target);
        await command(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", modifiers: /Mac/i.test(navigator.userAgent) ? 4 : 2, commands: ["selectAll"] });
        await command(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", modifiers: /Mac/i.test(navigator.userAgent) ? 4 : 2 });
        await pressKey(tabId, "Backspace");
        await command(tabId, "Input.insertText", { text: value });
      }
    } else if (input.action === "press") {
      await focusElement(tabId, input.target);
      await pressKey(tabId, input.key || "Enter");
    }
    return { success: true, url: (await chrome.tabs.get(tabId)).url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    throw new Error(`${message} (runtime=cdp, action=${input.action}, tabId=${tabId}, url=${tab?.url || "unknown"})`);
  }
}
