import type { AgentProvider, AgentProviderName, AgentResult, EventCallback } from "../core/types.js";

type LegacyRun = (clientId: string, message: string, onProgress?: (text: string) => void, onText?: (text:string) => void) => Promise<AgentResult>;

export class LegacyProvider implements AgentProvider {
  get capabilities() { return { streaming: true, sessions: true, cancel: !!this.cancelLegacy, rollback: false }; }

  constructor(
    readonly name: AgentProviderName,
    readonly model: string,
    private readonly runLegacy: LegacyRun,
    private readonly closeLegacy: () => void,
    private readonly cancelLegacy?: (clientId: string) => void,
  ) {}

  async run(clientId: string, runId: string, message: string, emit: EventCallback, signal?: AbortSignal): Promise<AgentResult> {
    signal?.throwIfAborted();
    const cancel = () => this.cancelLegacy?.(clientId);
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      const result = await this.runLegacy(clientId, message, (text) => {
        emit({ type: "tool.started", runId, toolCallId: `legacy-${Date.now()}`, tool: "legacy", label: text });
      }, (delta)=>emit({type:"message.delta",runId,delta}));
      signal?.throwIfAborted();
      return { ...result, runId };
    } finally {signal?.removeEventListener('abort',cancel);}
  }

  clearSession(clientId: string): void { this.cancelLegacy?.(clientId); }

  close(): void {
    this.closeLegacy();
  }
}
