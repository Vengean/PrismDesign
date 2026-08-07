import type { BrowserAction, BrowserRuntime, BrowserWait } from "./browser-runtime.js";
import { ToolRegistry } from "./tool-registry.js";

const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };

export function createBrowserToolRegistry(runtime: BrowserRuntime): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({ name: "browser.start", description: "Start an isolated real browser session.", inputSchema: objectSchema({ baseUrl: string, verificationId: string }, ["baseUrl"]), execute: (input: { baseUrl: string; verificationId?: string }, context) => runtime.start({ ...context, verificationId: input.verificationId }, input.baseUrl) });
  registry.register({ name: "browser.navigate", description: "Navigate an owned browser session.", inputSchema: objectSchema({ sessionId: string, url: string }, ["sessionId", "url"]), execute: (input: { sessionId: string; url: string }, context) => runtime.navigate(input.sessionId, context.clientId, input.url) });
  registry.register({ name: "browser.observe", description: "Observe the page as a compact semantic model.", inputSchema: objectSchema({ sessionId: string }, ["sessionId"]), execute: (input: { sessionId: string }, context) => runtime.observe(input.sessionId, context.clientId) });
  registry.register({ name: "browser.action", description: "Perform a real click, fill, or key press.", inputSchema: objectSchema({ sessionId: string, action: { type: "object" } }, ["sessionId", "action"]), execute: (input: { sessionId: string; action: BrowserAction }, context) => runtime.action(input.sessionId, context.clientId, input.action) });
  registry.register({ name: "browser.evidence", description: "Return network and runtime error evidence.", inputSchema: objectSchema({ sessionId: string }, ["sessionId"]), execute: (input: { sessionId: string }, context) => Promise.resolve(runtime.evidence(input.sessionId, context.clientId)) });
  registry.register({ name: "browser.wait", description: "Wait for a URL, text, or semantic target.", inputSchema: objectSchema({ sessionId: string, condition: { type: "object" } }, ["sessionId", "condition"]), execute: (input: { sessionId: string; condition: BrowserWait }, context) => runtime.wait(input.sessionId, context.clientId, input.condition) });
  registry.register({ name: "browser.screenshot", description: "Capture the current viewport as PNG evidence.", inputSchema: objectSchema({ sessionId: string }, ["sessionId"]), execute: (input: { sessionId: string }, context) => runtime.screenshot(input.sessionId, context.clientId) });
  registry.register({ name: "browser.stop", description: "Close an owned browser session.", inputSchema: objectSchema({ sessionId: string }, ["sessionId"]), execute: async (input: { sessionId: string }, context) => { await runtime.stop(input.sessionId, context.clientId); return { success: true }; } });
  return registry;
}
