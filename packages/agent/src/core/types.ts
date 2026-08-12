import type { VerificationFailureCategory, VerificationStatus } from "../testing/verification-store.js";

export type AgentProviderName = "claude" | "claude-sub" | "openai" | "codex" | "glm";

export interface AgentCapabilities {
  streaming: boolean;
  sessions: boolean;
  cancel: boolean;
  rollback: boolean;
}

export interface AgentResult {
  success: boolean;
  message: string;
  filesModified: string[];
  runId?: string;
  verification?: {
    id: string;
    status: VerificationStatus;
    goal: string;
    proposedChecks: string[];
    summary?: string;
    failureCategory?: VerificationFailureCategory;
    fixSuggestion?: string;
  };
}

export type AgentEvent =
  | { type: "run.started"; runId: string }
  | { type: "message.delta"; runId: string; delta: string; messageId?: string }
  | { type: "tool.started"; runId: string; toolCallId: string; tool: string; label: string }
  | { type: "tool.completed"; runId: string; toolCallId: string; tool: string; success: boolean; error?: string }
  | { type: "file.changed"; runId: string; path: string; operation: "create" | "update" | "delete" }
  | { type: "run.completed"; runId: string; result: AgentResult }
  | { type: "run.failed"; runId: string; error: { message: string; code?: string; retryable?: boolean } }
  | { type: "run.cancelled"; runId: string };

export type ProgressCallback = (text: string) => void;
export type EventCallback = (event: AgentEvent) => void;

export interface AgentProvider {
  readonly name: AgentProviderName;
  readonly model: string;
  readonly capabilities: AgentCapabilities;
  run(clientId: string, runId: string, message: string, emit: EventCallback, signal?: AbortSignal): Promise<AgentResult>;
  clearSession(clientId: string): Promise<void> | void;
  close(): Promise<void> | void;
}
