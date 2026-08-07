export interface CurrentTabCommand {
  requestId: string;
  action: "attach" | "detach" | "navigate" | "observe" | "click" | "fill" | "press" | "wait" | "screenshot" | "evidence";
  target?: { ref?: string; role?: string; name?: string; label?: string; selector?: string };
  value?: string;
  url?: string;
  key?: string;
  condition?: { kind: "url" | "text"; value: string; timeoutMs?: number };
}

const attached = new Set<number>();
const refs = new Map<number, Map<string, number>>();
const evidence = new Map<number, { console: unknown[]; network: unknown[] }>();

async function command<T = any>(tabId: number, method: string, params?: object): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
}

async function ensureAttached(tabId: number) {
  if (attached.has(tabId)) {
    try {
      // The service worker's Set can outlive the real CDP attachment state.
      await command(tabId, "Runtime.enable");
      return;
    } catch {
      attached.delete(tabId);
      refs.delete(tabId);
      evidence.delete(tabId);
    }
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Chrome may still own an attachment even when our in-memory state was
    // lost. Verify it before surfacing a misleading attach error.
    if (!/already attached/i.test(message)) throw error;
  }
  attached.add(tabId);
  evidence.set(tabId, { console: [], network: [] });
  try {
    await command(tabId, "Runtime.enable");
    await command(tabId, "Network.enable");
  } catch (error) {
    attached.delete(tabId);
    refs.delete(tabId);
    evidence.delete(tabId);
    throw error;
  }
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) { attached.delete(source.tabId); refs.delete(source.tabId); evidence.delete(source.tabId); }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId || !attached.has(tabId)) return;
  const log = evidence.get(tabId)!;
  if (method === "Runtime.consoleAPICalled") log.console.push(params);
  if (method === "Network.responseReceived") {
    const response = (params as any).response;
    log.network.push({ url: response?.url, status: response?.status, mimeType: response?.mimeType });
  }
});

async function evaluate<T>(tabId: number, expression: string): Promise<T> {
  const response = await command<any>(tabId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Page evaluation failed");
  return response.result?.value as T;
}

async function observe(tabId: number) {
  const elements = await evaluate<any[]>(tabId, `(() => Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')).slice(0,200).map((el,index)=>({index,tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||(el.tagName==='BUTTON'?'button':el.tagName==='A'?'link':['INPUT','TEXTAREA'].includes(el.tagName)?'textbox':el.tagName.toLowerCase()),name:el.getAttribute('aria-label')||(el.labels&&el.labels[0]&&el.labels[0].innerText)||el.innerText?.trim()||el.placeholder||el.name||'',value:el.type==='password'?'[REDACTED]':el.value||'',disabled:!!el.disabled||el.getAttribute('aria-disabled')==='true'})))()`);
  const table = new Map<string, number>();
  const result = elements.map(({ index, ...element }) => { const ref = `e${index + 1}`; table.set(ref, index); return { ref, ...element }; });
  refs.set(tabId, table);
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url, title: tab.title, elements: result };
}

function targetExpression(tabId: number, target: NonNullable<CurrentTabCommand["target"]>): string {
  if (target.ref) {
    const index = refs.get(tabId)?.get(target.ref);
    if (index === undefined) throw new Error(`Unknown or stale element ref: ${target.ref}`);
    return `document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')[${index}]`;
  }
  if (target.selector) return `document.querySelector(${JSON.stringify(target.selector)})`;
  const query = JSON.stringify(target);
  return `Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]')).find(el=>{const t=${query};const role=el.getAttribute('role')||(el.tagName==='BUTTON'?'button':el.tagName==='A'?'link':['INPUT','TEXTAREA'].includes(el.tagName)?'textbox':'');const name=el.getAttribute('aria-label')||(el.labels&&el.labels[0]&&el.labels[0].innerText)||el.innerText?.trim()||el.placeholder||el.name||'';return (!t.role||role===t.role)&&(!t.name||name.includes(t.name))&&(!t.label||name.includes(t.label))})`;
}

export async function executeCurrentTabCommand(tabId: number, input: CurrentTabCommand): Promise<unknown> {
  if (input.action === "attach") { await ensureAttached(tabId); return observe(tabId); }
  if (input.action === "detach") {
    try { await chrome.debugger.detach({ tabId }); } catch {}
    attached.delete(tabId); refs.delete(tabId); evidence.delete(tabId);
    return { success: true };
  }
  if (input.action === "navigate") { if (!input.url) throw new Error("url is required"); await chrome.tabs.update(tabId, { url: input.url }); return { success: true, url: input.url }; }
  await ensureAttached(tabId);
  if (input.action === "observe") return observe(tabId);
  if (input.action === "evidence") return evidence.get(tabId) || { console: [], network: [] };
  if (input.action === "screenshot") return command(tabId, "Page.captureScreenshot", { format: "png" });
  if (input.action === "wait") {
    const timeout = Math.min(input.condition?.timeoutMs || 10_000, 60_000);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const tab = await chrome.tabs.get(tabId);
      if (input.condition?.kind === "url" && tab.url?.includes(input.condition.value)) return { matched: true, url: tab.url };
      if (input.condition?.kind === "text" && await evaluate<boolean>(tabId, `document.body?.innerText.includes(${JSON.stringify(input.condition.value)})`)) return { matched: true, url: tab.url };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("Wait timed out");
  }
  if (!input.target) throw new Error("target is required");
  const expression = targetExpression(tabId, input.target);
  const point = await evaluate<{ x: number; y: number }>(tabId, `(()=>{const el=${expression};if(!el)throw new Error('Element not found');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  if (input.action === "click") {
    await command(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await command(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  } else {
    await evaluate(tabId, `(()=>{const el=${expression};el.focus();${input.action === "fill" ? "el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));" : ""}})()`);
    if (input.action === "fill") await command(tabId, "Input.insertText", { text: input.value || "" });
    if (input.action === "press") {
      await command(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: input.key || "Enter" });
      await command(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: input.key || "Enter" });
    }
  }
  const tab = await chrome.tabs.get(tabId);
  return { success: true, url: tab.url };
}
