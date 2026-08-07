import { CleanupStack, type CleanupResult } from "./cleanup-stack.js";

export type TestRunStatus = "preparing" | "running" | "cleaning" | "passed" | "failed" | "inconclusive" | "cancelled" | "timed_out";

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
    return { ...value, cleanup: [...value.cleanup] };
  }
}
