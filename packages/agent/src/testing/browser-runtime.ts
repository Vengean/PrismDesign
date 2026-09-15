import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { redactText, redactUrl } from "./evidence.js";

export interface BrowserRuntimeOptions {
  allowedOrigins?: string[];
  /** Defaults to headed mode so local users can watch the agent operate. */
  headless?: boolean;
  onEvidence?: (identity: BrowserSessionIdentity, evidence: RuntimeEvidence) => void;
}

export interface BrowserSessionIdentity {
  clientId: string;
  runId: string;
  verificationId?: string;
}

interface NetworkEvidence {
  method: string;
  url: string;
  status?: number;
  resourceType: string;
}

export interface RuntimeEvidence {
  console: Array<{ type: string; text: string }>;
  pageErrors: string[];
  network: NetworkEvidence[];
}

interface RuntimeSession {
  id: string;
  identity: BrowserSessionIdentity;
  context: BrowserContext;
  page: Page;
  evidence: RuntimeEvidence;
  refs: Map<string, string>;
}

export type BrowserTarget =
  | { ref: string; role?: never; name?: never; label?: never; selector?: never }
  | { role: string; name?: string; ref?: never; label?: never; selector?: never }
  | { label: string; ref?: never; role?: never; name?: never; selector?: never }
  | { selector: string; ref?: never; role?: never; name?: never; label?: never };

export type BrowserAction =
  | { type: "click"; target: BrowserTarget }
  | { type: "fill"; target: BrowserTarget; value: string }
  | { type: "press"; target: BrowserTarget; key: string };

export type BrowserWait =
  | { kind: "url"; value: string; timeoutMs?: number }
  | { kind: "text"; value: string; timeoutMs?: number }
  | { kind: "target"; target: BrowserTarget; timeoutMs?: number };

export class BrowserRuntime {
  private browser: Browser | null = null;
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly allowedOrigins: Set<string>;
  private readonly headless: boolean;
  private readonly onEvidence?: BrowserRuntimeOptions["onEvidence"];

  constructor(options: BrowserRuntimeOptions = {}) {
    this.allowedOrigins = new Set(options.allowedOrigins || []);
    this.headless = options.headless ?? false;
    this.onEvidence = options.onEvidence;
  }

  async start(identity: BrowserSessionIdentity, baseUrl: string): Promise<{ sessionId: string }> {
    this.assertAllowedUrl(baseUrl);
    this.browser ||= await chromium.launch({ headless: this.headless });
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const id = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const evidence: RuntimeEvidence = { console: [], pageErrors: [], network: [] };
    const session: RuntimeSession = { id, identity, context, page, evidence, refs: new Map() };

    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        evidence.console.push({ type: message.type(), text: this.redact(message.text()) });
      }
    });
    page.on("pageerror", (error) => evidence.pageErrors.push(this.redact(error.message)));
    page.on("request", (request) => {
      evidence.network.push({ method: request.method(), url: request.url(), resourceType: request.resourceType() });
    });
    page.on("response", (response) => {
      const match = [...evidence.network].reverse().find((item) => item.url === response.url() && item.status === undefined);
      if (match) match.status = response.status();
    });

    this.sessions.set(id, session);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    return { sessionId: id };
  }

  async navigate(sessionId: string, clientId: string, url: string): Promise<{ url: string; title: string }> {
    const session = this.getOwnedSession(sessionId, clientId);
    const target = new URL(url, session.page.url()).toString();
    this.assertAllowedUrl(target);
    await session.page.goto(target, { waitUntil: "domcontentloaded" });
    return { url: session.page.url(), title: await session.page.title() };
  }

  async observe(sessionId: string, clientId: string) {
    const session = this.getOwnedSession(sessionId, clientId);
    const elements = await session.page.locator("a,button,input,textarea,select,[role],[contenteditable=true]").evaluateAll((nodes) =>
      nodes.slice(0, 200).map((node, index) => {
        const element = node as HTMLElement;
        const input = node as HTMLInputElement;
        const associatedLabel = input.labels?.[0]?.innerText;
        return {
          index,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || (element.tagName === "BUTTON" ? "button" : element.tagName === "A" ? "link" : ["INPUT", "TEXTAREA"].includes(element.tagName) ? "textbox" : element.tagName.toLowerCase()),
          name: element.getAttribute("aria-label") || associatedLabel || element.innerText?.trim() || input.placeholder || input.name || "",
          value: input.type === "password" ? "[REDACTED]" : input.value,
          disabled: input.disabled || element.getAttribute("aria-disabled") === "true",
        };
      })
    );
    session.refs.clear();
    const observed = elements.map(({ index, ...element }) => {
      const ref = `e${index + 1}`;
      session.refs.set(ref, `a,button,input,textarea,select,[role],[contenteditable=true] >> nth=${index}`);
      return { ref, ...element };
    });
    return { url: session.page.url(), title: await session.page.title(), elements: observed };
  }

  async action(sessionId: string, clientId: string, action: BrowserAction): Promise<{ url: string }> {
    const session = this.getOwnedSession(sessionId, clientId);
    const locator = this.locator(session, action.target);
    if (action.type === "click") await locator.click();
    if (action.type === "fill") await locator.fill(action.value);
    if (action.type === "press") await locator.press(action.key);
    return { url: session.page.url() };
  }

  async wait(sessionId: string, clientId: string, condition: BrowserWait): Promise<{ url: string; matched: true }> {
    const session = this.getOwnedSession(sessionId, clientId);
    const timeout = Math.min(Math.max(condition.timeoutMs || 10_000, 100), 60_000);
    if (condition.kind === "url") await session.page.waitForURL(condition.value, { timeout });
    if (condition.kind === "text") await session.page.getByText(condition.value, { exact: false }).first().waitFor({ state: "visible", timeout });
    if (condition.kind === "target") await this.locator(session, condition.target).waitFor({ state: "visible", timeout });
    return { url: session.page.url(), matched: true };
  }

  async screenshot(sessionId: string, clientId: string): Promise<{ mimeType: "image/png"; base64: string; url: string }> {
    const session = this.getOwnedSession(sessionId, clientId);
    const image = await session.page.screenshot({ type: "png", fullPage: false });
    return { mimeType: "image/png", base64: image.toString("base64"), url: session.page.url() };
  }

  evidence(sessionId: string, clientId: string): RuntimeEvidence {
    const session = this.getOwnedSession(sessionId, clientId);
    const evidence = session.evidence;
    const snapshot = {
      console: evidence.console.slice(-100),
      pageErrors: evidence.pageErrors.slice(-100),
      network: evidence.network.slice(-200).map((item) => ({ ...item, url: redactUrl(item.url) })),
    };
    this.onEvidence?.(session.identity, snapshot);
    return snapshot;
  }

  async stop(sessionId: string, clientId: string): Promise<void> {
    const session = this.getOwnedSession(sessionId, clientId);
    this.sessions.delete(sessionId);
    await session.context.close();
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) await session.context.close().catch(() => {});
    this.sessions.clear();
    await this.browser?.close();
    this.browser = null;
  }

  private locator(session: RuntimeSession, target: BrowserTarget) {
    if ("ref" in target && target.ref) {
      const selector = session.refs.get(target.ref);
      if (!selector) throw new Error(`Unknown or stale element ref: ${target.ref}`);
      return session.page.locator(selector);
    }
    if ("role" in target && target.role) return session.page.getByRole(target.role as any, target.name ? { name: target.name } : undefined);
    if ("label" in target && target.label) return session.page.getByLabel(target.label);
    if ("selector" in target && target.selector) return session.page.locator(target.selector);
    throw new Error("A semantic browser target is required");
  }

  private getOwnedSession(sessionId: string, clientId: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.identity.clientId !== clientId) throw new Error("Browser session not found");
    return session;
  }

  private assertAllowedUrl(value: string): void {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) browser targets are allowed");
    if (this.allowedOrigins.size && !this.allowedOrigins.has(url.origin)) throw new Error(`Browser target origin is not allowed: ${url.origin}`);
  }

  private redact(value: string): string {
    return redactText(value);
  }
}
