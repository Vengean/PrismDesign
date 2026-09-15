export type VerificationStatus = "awaiting_confirmation" | "preparing" | "running" | "fixing" | "rerunning" | "passed" | "failed" | "inconclusive" | "cancelled";
export type VerificationFailureCategory = "code_defect" | "environment" | "data" | "permission" | "insufficient_evidence" | "unknown";

export interface Verification {
  id: string;
  clientId: string;
  developmentRunId: string;
  status: VerificationStatus;
  goal: string;
  baseUrl: string;
  changedFiles: string[];
  proposedChecks: string[];
  browserSessionId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  summary?: string;
  failureCategory?: VerificationFailureCategory;
  fixSuggestion?: string;
}

export class VerificationStore {
  private readonly records = new Map<string, Verification>();

  create(input: Omit<Verification, "id" | "status" | "createdAt" | "updatedAt">): Verification {
    const now = new Date().toISOString();
    const record: Verification = {
      ...input,
      id: `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: "awaiting_confirmation",
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    return record;
  }

  getOwned(id: string, clientId: string): Verification {
    const record = this.records.get(id);
    if (!record || record.clientId !== clientId) throw new Error("Verification not found");
    return record;
  }

  latestPending(clientId: string): Verification | undefined {
    return [...this.records.values()].reverse().find((record) => record.clientId === clientId && record.status === "awaiting_confirmation");
  }

  latestForRun(clientId: string, developmentRunId: string): Verification | undefined {
    return [...this.records.values()].reverse().find((record) => record.clientId === clientId && record.developmentRunId === developmentRunId);
  }

  runningForPage(pageUrl: string): Verification[] {
    let target: URL;
    try { target = new URL(pageUrl); } catch { return []; }
    return [...this.records.values()].filter((record) => {
      if (!["preparing", "running"].includes(record.status)) return false;
      try {
        const candidate = new URL(record.baseUrl);
        return candidate.origin === target.origin && candidate.pathname === target.pathname && candidate.search === target.search;
      } catch { return false; }
    });
  }

  update(id: string, clientId: string, patch: Partial<Verification>): Verification {
    const record = this.getOwned(id, clientId);
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    return record;
  }
}
