export interface CleanupResult {
  id: string;
  label: string;
  success: boolean;
  error?: string;
}

interface CleanupEntry {
  id: string;
  label: string;
  cleanup: () => Promise<void> | void;
}

/** In-memory, idempotent LIFO cleanup for resources owned by one test run. */
export class CleanupStack {
  private readonly entries: CleanupEntry[] = [];
  private result?: Promise<CleanupResult[]>;

  register(entry: CleanupEntry): void {
    if (this.result) throw new Error("Cannot register cleanup after cleanup has started");
    if (this.entries.some((item) => item.id === entry.id)) return;
    this.entries.push(entry);
  }

  runAll(): Promise<CleanupResult[]> {
    if (this.result) return this.result;
    this.result = (async () => {
      const results: CleanupResult[] = [];
      for (const entry of [...this.entries].reverse()) {
        try {
          await entry.cleanup();
          results.push({ id: entry.id, label: entry.label, success: true });
        } catch (error) {
          results.push({ id: entry.id, label: entry.label, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return results;
    })();
    return this.result;
  }
}
