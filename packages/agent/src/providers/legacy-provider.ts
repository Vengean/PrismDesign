import type { AgentProvider, AgentProviderName, AgentResult, EventCallback } from "../core/types.js";

type LegacyRun = (clientId: string, message: string, onProgress?: (text: string) => void) => Promise<AgentResult>;

export class LegacyProvider implements AgentProvider {
  readonly capabilities = { streaming: true, sessions: true, cancel: false, rollback: false };

  constructor(
    readonly name: AgentProviderName,
    readonly model: string,
    private readonly runLegacy: LegacyRun,
    private readonly closeLegacy: () => void,
  ) {}

  async run(clientId: string, runId: string, message: string, emit: EventCallback): Promise<AgentResult> {
    const result = await this.runLegacy(clientId, message, (text) => {
      emit({ type: "tool.started", runId, toolCallId: `legacy-${Date.now()}`, tool: "legacy", label: text });
    });
    return { ...result, runId };
  }

  clearSession(): void {
    // Legacy SDK adapters currently only expose global cleanup.
  }

  close(): void {
    this.closeLegacy();
  }
}
