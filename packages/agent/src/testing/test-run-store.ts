import { CleanupStack, type CleanupResult } from "./cleanup-stack.js";
import type { CapturedTestEvidenceInput, TestEvidenceInput, TestEvidenceType } from "./evidence.js";

export type TestRunStatus = "preparing" | "running" | "cleaning" | "passed" | "failed" | "inconclusive" | "cancelled" | "timed_out";
export type TestRunStepStatus = "pending" | "running" | "passed" | "failed";
export type TestCaseStatus = "pending" | "passed" | "failed" | "not_run" | "insufficient_evidence";

export interface TestCase {
  id: string;
  title: string;
  assertion: string;
  status: TestCaseStatus;
  evidenceSummary?: string;
  failureReason?: string;
  evidenceIds: string[];
  updatedAt: string;
}

export interface TestEvidence extends TestEvidenceInput {
  id: string;
  type: TestEvidenceType;
  caseIds: string[];
}

export interface TestRunStep {
  id: string;
  tool: string;
  label: string;
  status: TestRunStepStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface TestRun {
  id: string;
  verificationId: string;
  clientId: string;
  agentRunId: string;
  status: TestRunStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  cases: TestCase[];
  evidence: TestEvidence[];
  steps: TestRunStep[];
  cleanup: CleanupResult[];
}

interface InternalRun extends TestRun {
  cleanupStack: CleanupStack;
  responseHandles: Map<string, string>;
  abort?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

export class TestRunStore {
  private readonly runs = new Map<string, InternalRun>();

  constructor(private readonly options: {
    timeoutMs: number;
    onChange?: (run: TestRun) => void;
  }) {}

  create(input: { verificationId: string; clientId: string; agentRunId: string; proposedChecks?: string[]; abort?: () => void }): TestRun {
    const existing = this.byVerification(input.verificationId);
    if (existing && ["preparing", "running", "cleaning"].includes(existing.status)) return this.public(existing);
    const now = new Date().toISOString();
    const id = `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const run: InternalRun = {
      ...input,
      id,
      status: "preparing",
      startedAt: now,
      updatedAt: now,
      cases: (input.proposedChecks || []).map((check, index) => ({
        id: `case-${index + 1}`,
        title: check,
        assertion: check,
        status: "pending",
        evidenceIds: [],
        updatedAt: now,
      })),
      evidence: [],
      steps: [],
      cleanup: [],
      cleanupStack: new CleanupStack(),
      responseHandles: new Map(),
    };
    this.runs.set(id, run);
    this.refreshTimeout(run);
    this.emit(run);
    return this.public(run);
  }

  markRunning(id: string): TestRun {
    const run = this.get(id);
    if (run.status === "preparing") this.patch(run, { status: "running" });
    return this.public(run);
  }

  defineCases(verificationId: string, cases: Array<{ title: string; assertion: string }>): TestRun {
    const run = this.byVerification(verificationId);
    if (!run || !["preparing", "running"].includes(run.status)) throw new Error("Active test run not found");
    if (run.cases.some((item) => item.status !== "pending")) throw new Error("Test cases cannot be redefined after results have been recorded");
    const now = new Date().toISOString();
    run.cases = cases.map((item, index) => ({
      id: `case-${index + 1}`,
      title: item.title,
      assertion: item.assertion,
      status: "pending",
      evidenceIds: [],
      updatedAt: now,
    }));
    this.refreshTimeout(run);
    this.patch(run, { cases: run.cases });
    return this.public(run);
  }

  updateCase(verificationId: string, caseId: string, patch: {
    status: Exclude<TestCaseStatus, "pending">;
    evidenceSummary?: string;
    failureReason?: string;
    evidenceIds?: string[];
  }): TestRun {
    const run = this.byVerification(verificationId);
    if (!run || !["preparing", "running"].includes(run.status)) throw new Error("Active test run not found");
    const testCase = run.cases.find((item) => item.id === caseId);
    if (!testCase) throw new Error("Test case not found");
    const evidenceIds = patch.evidenceIds === undefined ? testCase.evidenceIds : [...new Set(patch.evidenceIds)];
    if (evidenceIds.some((id) => !run.evidence.some((item) => item.id === id))) throw new Error("Test case references unknown evidence");
    for (const evidence of run.evidence) {
      evidence.caseIds = evidence.caseIds.filter((id) => id !== caseId);
      if (evidenceIds.includes(evidence.id)) evidence.caseIds.push(caseId);
    }
    Object.assign(testCase, patch, { evidenceIds, updatedAt: new Date().toISOString() });
    this.refreshTimeout(run);
    this.patch(run, { cases: run.cases });
    return this.public(run);
  }

  recordEvidence(verificationId: string, entries: CapturedTestEvidenceInput[]): TestEvidence[] {
    const run = this.byVerification(verificationId);
    if (!run || !["preparing", "running"].includes(run.status)) throw new Error("Active test run not found");
    const recorded: TestEvidence[] = [];
    for (const captured of entries) {
      const { responseHandle, ...entry } = captured;
      const fingerprint = JSON.stringify([entry.type, entry.method, entry.url, entry.status, entry.resourceType, entry.mimeType, entry.message]);
      let evidence = run.evidence.find((item) => JSON.stringify([item.type, item.method, item.url, item.status, item.resourceType, item.mimeType, item.message]) === fingerprint);
      if (!evidence) {
        evidence = { ...entry, id: `evidence-${run.evidence.length + 1}`, caseIds: [] };
        run.evidence.push(evidence);
      }
      if (responseHandle) run.responseHandles.set(evidence.id, responseHandle);
      recorded.push(evidence);
    }
    this.refreshTimeout(run);
    this.patch(run, { evidence: run.evidence });
    return recorded.map((item) => ({ ...item, caseIds: [...item.caseIds] }));
  }

  resolveResponseHandle(verificationId: string, evidenceId: string): { evidence: TestEvidence; responseHandle: string } {
    const run = this.byVerification(verificationId);
    if (!run || !["preparing", "running"].includes(run.status)) throw new Error("Active test run not found");
    const evidence = run.evidence.find((item) => item.id === evidenceId && item.type === "network");
    const responseHandle = run.responseHandles.get(evidenceId);
    if (!evidence || !responseHandle) throw new Error("Response body is unavailable for this evidence");
    return { evidence: { ...evidence, caseIds: [...evidence.caseIds] }, responseHandle };
  }

  attachResponsePreview(verificationId: string, evidenceId: string, input: {
    preview: unknown;
    reason: string;
    truncated: boolean;
    redactedPaths: string[];
    originalSize: number;
  }): TestEvidence {
    const run = this.byVerification(verificationId);
    if (!run || !["preparing", "running"].includes(run.status)) throw new Error("Active test run not found");
    const evidence = run.evidence.find((item) => item.id === evidenceId && item.type === "network");
    if (!evidence) throw new Error("Network evidence not found");
    Object.assign(evidence, {
      responsePreview: input.preview,
      responseBodyReadReason: input.reason,
      responseTruncated: input.truncated,
      responseRedactedPaths: [...input.redactedPaths],
      responseOriginalSize: input.originalSize,
    });
    this.refreshTimeout(run);
    this.patch(run, { evidence: run.evidence });
    return { ...evidence, caseIds: [...evidence.caseIds], responseRedactedPaths: [...input.redactedPaths] };
  }

  validateCompletion(verificationId: string, status: "passed" | "failed" | "inconclusive"): void {
    const run = this.byVerification(verificationId);
    if (!run) throw new Error("Test run not found");
    if (!run.cases.length) throw new Error("Define at least one business test case before completing verification");
    if (run.cases.some((item) => item.status === "pending")) throw new Error("Every business test case must have a terminal status before completing verification");
    if (status === "passed" && run.cases.some((item) => item.status !== "passed")) {
      throw new Error("Verification can pass only when every business test case passed");
    }
    if (status === "failed" && !run.cases.some((item) => item.status === "failed")) {
      throw new Error("A failed verification must include at least one failed business test case");
    }
    if (status === "inconclusive" && !run.cases.some((item) => ["not_run", "insufficient_evidence"].includes(item.status))) {
      throw new Error("An inconclusive verification must include a not-run or insufficient-evidence business test case");
    }
  }

  startStep(agentRunId: string, input: { id: string; tool: string; label: string }): TestRun | undefined {
    const run = this.byAgentRun(agentRunId);
    if (!run || !["preparing", "running"].includes(run.status)) return undefined;
    const now = new Date().toISOString();
    const existing = run.steps.find((step) => step.id === input.id);
    if (existing) Object.assign(existing, { ...input, status: "running" as const, startedAt: now });
    else run.steps.push({ ...input, status: "running", startedAt: now });
    this.refreshTimeout(run);
    this.patch(run, { steps: run.steps });
    return this.public(run);
  }

  finishStep(agentRunId: string, input: { id: string; success: boolean; error?: string }): TestRun | undefined {
    const run = this.byAgentRun(agentRunId);
    if (!run) return undefined;
    const step = run.steps.find((item) => item.id === input.id);
    if (!step) return undefined;
    const finishedAt = new Date().toISOString();
    Object.assign(step, {
      status: input.success ? "passed" : "failed",
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(step.startedAt)),
      error: input.error,
    });
    if (["preparing", "running"].includes(run.status)) this.refreshTimeout(run);
    this.patch(run, { steps: run.steps });
    return this.public(run);
  }

  registerCleanup(id: string, entry: { id: string; label: string; cleanup: () => Promise<void> | void }): void {
    this.get(id).cleanupStack.register(entry);
  }

  async finish(id: string, status: Extract<TestRunStatus, "passed" | "failed" | "inconclusive" | "cancelled" | "timed_out">, error?: string): Promise<TestRun> {
    const run = this.get(id);
    if (["passed", "failed", "inconclusive", "cancelled", "timed_out"].includes(run.status)) return this.public(run);
    if (status === "cancelled" || status === "timed_out") run.abort?.();
    clearTimeout(run.timeout);
    const now = new Date().toISOString();
    for (const testCase of run.cases) {
      if (testCase.status === "pending") Object.assign(testCase, { status: "not_run" as const, updatedAt: now });
    }
    this.patch(run, { status: "cleaning", error });
    const cleanup = await run.cleanupStack.runAll();
    this.patch(run, { status, cleanup, error, finishedAt: new Date().toISOString() });
    return this.public(run);
  }

  byVerification(verificationId: string): InternalRun | undefined {
    return [...this.runs.values()].reverse().find((run) => run.verificationId === verificationId);
  }

  byAgentRun(agentRunId: string): InternalRun | undefined {
    return [...this.runs.values()].reverse().find((run) => run.agentRunId === agentRunId);
  }

  activeForClient(clientId: string): TestRun[] {
    return [...this.runs.values()].filter((run) => run.clientId === clientId && ["preparing", "running", "cleaning"].includes(run.status)).map((run) => this.public(run));
  }

  getOwned(id: string, clientId: string): TestRun {
    const run = this.get(id);
    if (run.clientId !== clientId) throw new Error("Test run not found");
    return this.public(run);
  }

  private get(id: string): InternalRun {
    const run = this.runs.get(id);
    if (!run) throw new Error("Test run not found");
    return run;
  }

  private patch(run: InternalRun, patch: Partial<TestRun>): void {
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    this.emit(run);
  }

  private refreshTimeout(run: InternalRun): void {
    clearTimeout(run.timeout);
    run.timeout = setTimeout(
      () => void this.finish(run.id, "timed_out", `Test run timed out after ${this.options.timeoutMs}ms without tool activity`),
      this.options.timeoutMs,
    );
    run.timeout.unref?.();
  }

  private emit(run: InternalRun): void {
    this.options.onChange?.(this.public(run));
  }

  private public(run: InternalRun): TestRun {
    const { cleanupStack: _cleanupStack, responseHandles: _responseHandles, abort: _abort, timeout: _timeout, ...value } = run;
    return { ...value, cases: value.cases.map((item) => ({ ...item, evidenceIds: [...item.evidenceIds] })), evidence: value.evidence.map((item) => ({ ...item, caseIds: [...item.caseIds], responseRedactedPaths: item.responseRedactedPaths ? [...item.responseRedactedPaths] : undefined, responsePreview: item.responsePreview === undefined ? undefined : JSON.parse(JSON.stringify(item.responsePreview)) })), steps: value.steps.map((step) => ({ ...step })), cleanup: value.cleanup.map((item) => ({ ...item })) };
  }
}
