import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const agentUrl = process.env.PRISM_AGENT_URL || "http://127.0.0.1:9527";
const currentSessions = new Map<string, string>();
const server = new McpServer({ name: "prism-browser", version: "0.1.0" });
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });
const target = z.union([
  z.object({ ref: z.string() }),
  z.object({ role: z.string(), name: z.string().optional() }),
  z.object({ label: z.string() }),
  z.object({ selector: z.string() }),
]);
async function currentCall(pageUrl: string, action: string, input: Record<string, unknown> = {}) {
  let response: Response;
  try {
    response = await fetch(`${agentUrl}/api/browser/current/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageUrl, action, ...input }) });
  } catch (error) {
    throw new Error(`Prism browser ${action} could not reach ${agentUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let body: any;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { error: text || `empty response (${response.status})` }; }
  if (!response.ok) throw new Error(body.error || `Current-tab command failed (${response.status})`);
  return body.result;
}
async function agentCall(path: string, capabilityToken: string, body: Record<string, unknown> = {}) {
  let response: Response;
  try {
    response = await fetch(`${agentUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${capabilityToken}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`Prism verification API ${path} could not reach ${agentUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await response.text();
  let value: any;
  try { value = text ? JSON.parse(text) : {}; }
  catch { value = { error: text || `empty response (${response.status})` }; }
  if (!response.ok) throw new Error(value.error || `Verification command failed (${response.status})`);
  return value;
}
function currentUrl(sessionId: string) {
  const url = currentSessions.get(sessionId);
  if (!url) throw new Error("Current-tab session not found");
  return url;
}

const localRead = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const localAction = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const capabilityToken = z.string().min(32).describe("Opaque turn capability from the [Prism tool context] in the current user turn.");

server.registerTool("verification_get_pending", {
  description: "Get the current tab's pending verification. Use this to understand whether the user's current message refers to an already completed development task; do not infer authorization from this tool.",
  inputSchema: { capabilityToken },
  annotations: localRead,
}, async ({ capabilityToken: token }) => result(await agentCall("/api/agent/verifications/pending", token)));

server.registerTool("verification_propose", {
  description: "Create a structured verification for the current page after development is actually complete. This does not start the browser.",
  inputSchema: { capabilityToken, goal: z.string().min(1).max(2000), proposedChecks: z.array(z.string().min(1).max(500)).min(1).max(20) },
  annotations: localAction,
}, async ({ capabilityToken: token, goal, proposedChecks }) => result(await agentCall("/api/agent/verifications/propose", token, { goal, proposedChecks })));

server.registerTool("verification_start", {
  description: "Mark a verification as authorized and running only when the current user's natural-language request explicitly authorizes real browser testing now. Call browser_start afterwards.",
  inputSchema: { capabilityToken, verificationId: z.string(), instruction: z.string().min(1).max(2000) },
  annotations: localAction,
}, async ({ capabilityToken: token, verificationId, instruction }) => result(await agentCall(`/api/agent/verifications/${encodeURIComponent(verificationId)}/start`, token, { instruction })));

server.registerTool("verification_define_cases", {
  description: "Define the business-level assertions that this verification will prove. Keep these separate from low-level browser actions.",
  inputSchema: {
    capabilityToken,
    verificationId: z.string(),
    cases: z.array(z.object({ title: z.string().min(1).max(200), assertion: z.string().min(1).max(1000) })).min(1).max(20),
  },
  annotations: localAction,
}, async ({ capabilityToken: token, verificationId, cases }) => result(await agentCall(`/api/agent/verifications/${encodeURIComponent(verificationId)}/cases/define`, token, { cases })));

server.registerTool("verification_update_case", {
  description: "Record the terminal result of one business test case based on observed evidence. Use not_run for an unexecuted case and insufficient_evidence when execution did not prove the assertion.",
  inputSchema: {
    capabilityToken,
    verificationId: z.string(),
    caseId: z.string(),
    status: z.enum(["passed", "failed", "not_run", "insufficient_evidence"]),
    evidenceSummary: z.string().max(2000).optional(),
    failureReason: z.string().max(2000).optional(),
    evidenceIds: z.array(z.string()).max(50).optional(),
  },
  annotations: localAction,
}, async ({ capabilityToken: token, verificationId, caseId, status, evidenceSummary, failureReason, evidenceIds }) => result(await agentCall(`/api/agent/verifications/${encodeURIComponent(verificationId)}/cases/${encodeURIComponent(caseId)}`, token, { status, evidenceSummary, failureReason, evidenceIds })));

server.registerTool("verification_complete", {
  description: "Submit the structured outcome after browser evidence has been collected and fixture cleanup attempted.",
  inputSchema: {
    capabilityToken,
    verificationId: z.string(),
    status: z.enum(["passed", "failed", "inconclusive"]),
    summary: z.string().min(1).max(4000),
    failureCategory: z.enum(["code_defect", "environment", "data", "permission", "insufficient_evidence", "unknown"]).optional(),
    fixSuggestion: z.string().min(1).max(4000).optional(),
  },
  annotations: localAction,
}, async ({ capabilityToken: token, verificationId, status, summary, failureCategory, fixSuggestion }) => result(await agentCall(`/api/agent/verifications/${encodeURIComponent(verificationId)}/complete`, token, { status, summary, failureCategory, fixSuggestion })));

server.registerTool("browser_start", { description: "Connect to the user's visible current Chrome tab.", inputSchema: { baseUrl: z.string().url() }, annotations: localRead }, async ({ baseUrl }) => {
  const sessionId = `current-tab-${Date.now()}`;
  const observation = await currentCall(baseUrl, "attach");
  currentSessions.set(sessionId, baseUrl);
  return result({ sessionId, observation, mode: "current-tab" });
});
server.registerTool("browser_navigate", { description: "Navigate an existing browser session.", inputSchema: { sessionId: z.string(), url: z.string() }, annotations: localRead }, async ({ sessionId, url }) => {
  const value = await currentCall(currentUrl(sessionId), "navigate", { url });
  currentSessions.set(sessionId, new URL(url, currentUrl(sessionId)).href);
  return result(value);
});
server.registerTool("browser_observe", { description: "Observe interactive elements as a semantic page model. Re-observe after page changes.", inputSchema: { sessionId: z.string() }, annotations: localRead }, async ({ sessionId }) => result(await currentCall(currentUrl(sessionId), "observe")));
server.registerTool("browser_click", { description: "Perform a real click. Prefer an element ref returned by browser_observe.", inputSchema: { sessionId: z.string(), target }, annotations: localAction }, async ({ sessionId, target }) => result(await currentCall(currentUrl(sessionId), "click", { target })));
server.registerTool("browser_fill", { description: "Fill a form control using a semantic target.", inputSchema: { sessionId: z.string(), target, value: z.string() }, annotations: localAction }, async ({ sessionId, target, value }) => result(await currentCall(currentUrl(sessionId), "fill", { target, value })));
server.registerTool("browser_press", { description: "Press a keyboard key on a semantic target.", inputSchema: { sessionId: z.string(), target, key: z.string() }, annotations: localAction }, async ({ sessionId, target, key }) => result(await currentCall(currentUrl(sessionId), "press", { target, key })));
server.registerTool("browser_evidence", { description: "Read redacted, structured network, console warning/error and page-error evidence. Returned evidence IDs can be attached to business cases.", inputSchema: { sessionId: z.string() }, annotations: localRead }, async ({ sessionId }) => result(await currentCall(currentUrl(sessionId), "evidence")));
server.registerTool("browser_response_body", {
  description: "Inspect a bounded, redacted JSON response preview for one recorded network evidence item when an error, UI mismatch, or evidence gap requires deeper diagnosis. Do not call routinely.",
  inputSchema: { sessionId: z.string(), evidenceId: z.string(), reason: z.string().min(1).max(500) },
  annotations: localRead,
}, async ({ sessionId, evidenceId, reason }) => result(await currentCall(currentUrl(sessionId), "responseBody", { evidenceId, reason })));
server.registerTool("browser_wait", {
  description: "Wait until a URL pattern, visible text, or observed target is present.",
  inputSchema: {
    sessionId: z.string(),
    condition: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("url"), value: z.string(), timeoutMs: z.number().optional() }),
      z.object({ kind: z.literal("text"), value: z.string(), timeoutMs: z.number().optional() }),
      z.object({ kind: z.literal("target"), target, timeoutMs: z.number().optional() }),
    ]),
  },
  annotations: localRead,
}, async ({ sessionId, condition }) => result(await currentCall(currentUrl(sessionId), "wait", { condition })));
server.registerTool("browser_screenshot", { description: "Capture the current browser viewport as PNG evidence.", inputSchema: { sessionId: z.string() }, annotations: localRead }, async ({ sessionId }) => {
  const shot = { base64: (await currentCall(currentUrl(sessionId), "screenshot") as any).data, mimeType: "image/png" as const, url: currentUrl(sessionId) };
  return { content: [{ type: "image" as const, data: shot.base64, mimeType: shot.mimeType }, { type: "text" as const, text: JSON.stringify({ url: shot.url }) }] };
});
server.registerTool("browser_stop", { description: "Disconnect from the current Chrome tab.", inputSchema: { sessionId: z.string() }, annotations: localAction }, async ({ sessionId }) => {
  try { await currentCall(currentUrl(sessionId), "detach"); }
  finally { currentSessions.delete(sessionId); }
  return result({ success: true });
});

const shutdown = async () => { await server.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await server.connect(new StdioServerTransport());
