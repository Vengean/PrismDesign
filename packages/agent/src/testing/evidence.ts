export type TestEvidenceType = "network" | "console" | "page_error";

export interface TestEvidenceInput {
  type: TestEvidenceType;
  severity: "info" | "warning" | "error";
  method?: string;
  url?: string;
  status?: number;
  resourceType?: string;
  mimeType?: string;
  message?: string;
  observedAt?: string;
  responsePreview?: unknown;
  responseBodyReadReason?: string;
  responseTruncated?: boolean;
  responseRedactedPaths?: string[];
  responseOriginalSize?: number;
}

export interface CapturedTestEvidenceInput extends TestEvidenceInput {
  /** CDP request id. Kept only in the InternalRun and never exposed publicly. */
  responseHandle?: string;
}

const sensitiveName = /^(?:access_?token|auth(?:orization)?|code|cookie|credential|key|password|refresh_?token|secret|session(?:id)?|token)$/i;

export function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/(authorization|access_?token|refresh_?token|token|password|cookie|secret|session(?:id)?)(["'=:\s]+)[^\s,&}]+/gi, "$1$2[REDACTED]");
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveName.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    url.hash = "";
    return url.toString();
  } catch {
    return redactText(value);
  }
}

export function sanitizeJsonPreview(value: unknown): { preview: unknown; redactedPaths: string[]; truncated: boolean } {
  const redactedPaths: string[] = [];
  let remainingNodes = 500;
  let remainingChars = 20_000;
  let truncated = false;
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

export function normalizeBrowserEvidence(raw: any): CapturedTestEvidenceInput[] {
  const now = new Date().toISOString();
  const network = Array.isArray(raw?.network) ? raw.network : [];
  const consoleEntries = Array.isArray(raw?.console) ? raw.console : [];
  const pageErrors = Array.isArray(raw?.pageErrors) ? raw.pageErrors : [];
  return [
    ...network.map((item: any): CapturedTestEvidenceInput => ({
      type: "network",
      severity: item?.status === undefined ? "warning" : item.status === 0 || item.status >= 400 ? "error" : "info",
      method: item?.method ? String(item.method).toUpperCase() : undefined,
      url: redactUrl(String(item?.url || "")),
      status: Number.isFinite(item?.status) ? Number(item.status) : undefined,
      resourceType: item?.resourceType ? String(item.resourceType) : undefined,
      mimeType: item?.mimeType ? String(item.mimeType) : undefined,
      message: item?.errorText ? redactText(String(item.errorText)) : undefined,
      observedAt: now,
      responseHandle: item?.requestHandle ? String(item.requestHandle) : undefined,
    })),
    ...consoleEntries
      .filter((item: any) => ["warning", "warn", "error"].includes(String(item?.type || "").toLowerCase()))
      .map((item: any): TestEvidenceInput => ({
        type: "console",
        severity: String(item?.type || "").toLowerCase() === "error" ? "error" : "warning",
        message: redactText(String(item?.text || "")),
        observedAt: now,
      })),
    ...pageErrors.map((message: unknown): TestEvidenceInput => ({
      type: "page_error",
      severity: "error",
      message: redactText(String(message || "Page error")),
      observedAt: now,
    })),
  ];
}
