import { CleanupStack, type CleanupResult } from "./cleanup-stack.js";

export type TestRunStatus = "preparing" | "running" | "cleaning" | "passed" | "failed" | "inconclusive" | "cancelled" | "timed_out";
export type TestRunStepStatus = "pending" | "running" | "passed" | "failed";

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
  steps: TestRunStep[];
  cleanup: CleanupResult[];
}

interface InternalRun extends TestRun {
  cleanupStack: CleanupStack;
  abort?: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class TestRunStore {
  private readonly runs = new Map<string, InternalRun>();

  constructor(private readonly options: {
    timeoutMs: number;
    onChange?: (run: TestRun) => void;
  }) {}

  create(input: { verificationId: string; clientId: string; agentRunId: string; abort?: () => void }): TestRun {
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
      steps: [],
      cleanup: [],
      cleanupStack: new CleanupStack(),
      timeout: setTimeout(() => void this.finish(id, "timed_out", "Test run timed out"), this.options.timeoutMs),
    };
    run.timeout.unref?.();
    this.runs.set(id, run);
    this.emit(run);
    return this.public(run);
  }

  markRunning(id: string): TestRun {
    const run = this.get(id);
    if (run.status === "preparing") this.patch(run, { status: "running" });
    return this.public(run);
  }

  startStep(agentRunId: string, input: { id: string; tool: string; label: string }): TestRun | undefined {
    const run = this.byAgentRun(agentRunId);
    if (!run || !["preparing", "running"].includes(run.status)) return undefined;
    const now = new Date().toISOString();
    const existing = run.steps.find((step) => step.id === input.id);
    if (existing) Object.assign(existing, { ...input, status: "running" as const, startedAt: now });
    else run.steps.push({ ...input, status: "running", startedAt: now });
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

  private emit(run: InternalRun): void {
    this.options.onChange?.(this.public(run));
  }

  private public(run: InternalRun): TestRun {
    const { cleanupStack: _cleanupStack, abort: _abort, timeout: _timeout, ...value } = run;
    return { ...value, steps: value.steps.map((step) => ({ ...step })), cleanup: value.cleanup.map((item) => ({ ...item })) };
  }
}
