// ============================================================
// Core data types
// ============================================================

export interface ComponentInfo {
  name: string;
  props: Record<string, unknown>;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface ComponentChainItem {
  name: string;
  sourceFile?: string;
  sourceLine?: number;
  sourceColumn?: number;
}

export interface ElementSelection {
  pagePath: string;
  domPath: string;
  tagName: string;
  id: string;
  textContent: string;
  className: string;
  role: string;
  ariaLabel: string;
  component: ComponentInfo | null;
  componentChain: string;
  componentChainDetail: ComponentChainItem[];
  styles: Record<string, string>;
  rect: { top: number; left: number; width: number; height: number };
  isTextElement: boolean;
  isFlexContainer: boolean;
}

export interface StyleChange {
  selector: string;
  property: string;
  oldValue: string;
  newValue: string;
  componentChain?: string;
  componentName?: string;
  sourceFile?: string;
  sourceLine?: number;
  textContent?: string;
  siblingIndex?: string;
}

export interface DOMTreeNode {
  id: string;
  tagName: string;
  className: string;
  componentName: string | null;
  domPath: string;
  hasChildren: boolean;
  children: DOMTreeNode[];
}

export interface ChatMessage {
  role: "user" | "ai";
  content: string;
  timestamp: number;
  verification?: {
    id: string;
    goal: string;
    proposedChecks: string[];
    status?: string;
    summary?: string;
    failureCategory?: "code_defect" | "environment" | "data" | "permission" | "insufficient_evidence" | "unknown";
    fixSuggestion?: string;
  };
  /** Test execution details rendered inside this assistant message. */
  testRun?: TestRunInfo;
  /** Transient target for streaming/progress events of the active request. */
  pending?: boolean;
  streamItemId?: string;
  attachments?: Array<{ id: string; name: string; mimeType: string; size: number }>;
  comments?: CommentAnnotation[];
}

export interface CommentAnnotation {
  element: ElementSelection;
  comment: string;
}

export interface ProjectInfo {
  root?: string;
  framework: string;
  styling?: string[];
  componentLib?: string[];
}

export interface AgentPermissions {
  alwaysAllowEdits: boolean;
  alwaysAllowAutomatedTesting: boolean;
}

export interface AgentCapabilities {
  streaming: boolean;
  sessions: boolean;
  cancel: boolean;
  rollback: boolean;
}

export interface TestRunInfo {
  id: string;
  verificationId: string;
  agentRunId: string;
  status: "preparing" | "running" | "cleaning" | "passed" | "failed" | "inconclusive" | "cancelled" | "timed_out";
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  error?: string;
  cases: Array<{
    id: string;
    title: string;
    assertion: string;
    status: "pending" | "passed" | "failed" | "not_run" | "insufficient_evidence";
    evidenceSummary?: string;
    failureReason?: string;
    evidenceIds: string[];
    updatedAt: string;
  }>;
  evidence: Array<{
    id: string;
    type: "network" | "console" | "page_error";
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
    caseIds: string[];
  }>;
  steps: Array<{
    id: string;
    tool: string;
    label: string;
    status: "pending" | "running" | "passed" | "failed";
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    error?: string;
  }>;
  cleanup: Array<{ id: string; label: string; success: boolean; error?: string }>;
  performance?: {
    totalDurationMs: number;
    agentDurationMs: number;
    toolDurationMs: number;
    browserDurationMs: number;
    cleanupDurationMs: number;
    toolCallCount: number;
    browserCommandCount: number;
    browserCommands: Record<string, { count: number; durationMs: number; maxDurationMs: number }>;
  };
}

// ============================================================
// Message protocol — Side Panel <-> Background <-> Content Script
// ============================================================

// Downstream: Side Panel -> Background -> Content Script
export type DownstreamMessage =
  | { type: "DESIGN_MODE_ON" }
  | { type: "DESIGN_MODE_OFF" }
  | { type: "START_COMMENT_MODE" }
  | { type: "STOP_COMMENT_MODE" }
  | { type: "APPLY_STYLE_PREVIEW"; payload: { domPath: string; property: string; value: string } }
  | { type: "CLEAR_STYLE_PREVIEW"; payload: { domPath: string } }
  | { type: "HIGHLIGHT_ELEMENT"; payload: { domPath: string } }
  | { type: "UNHIGHLIGHT_ELEMENT" }
  | { type: "SELECT_ELEMENT"; payload: { domPath: string } }
  | { type: "ENABLE_DRAG_MODE" }
  | { type: "DISABLE_DRAG_MODE" }
  | { type: "GET_DOM_TREE" }
  | { type: "GET_PENDING_CHANGES" }
  | { type: "CLEAR_CHANGES" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SHOW_TOOLBAR" }
  | { type: "HIDE_TOOLBAR" }
  | { type: "TOOLBAR_DISABLE"; payload: { disabled: boolean } }
  | { type: "RELOAD_IF_STATIC" }
  | { type: "PING" };

// Upstream: Content Script -> Background -> Side Panel
export type UpstreamMessage =
  | { type: "ELEMENT_SELECTED"; payload: ElementSelection }
  | { type: "ELEMENT_DESELECTED" }
  | { type: "DOM_TREE"; payload: DOMTreeNode[] }
  | { type: "CHANGES_UPDATE"; payload: { changes: StyleChange[]; undoCount: number; redoCount: number } }
  | { type: "DRAG_MOVE"; payload: { element: ElementSelection; from: number; to: number } }
  | { type: "CONTENT_READY" }
  | { type: "DESIGN_MODE_STATUS"; payload: { active: boolean } }
  | { type: "OPEN_CHAT" }
  | { type: "OPEN_NAVIGATOR"; payload?: { mode: "select" | "drag" } }
  | { type: "OPEN_CHANGES" }
  | { type: "COMMENT_TARGET_SELECTED"; payload: ElementSelection }
  | { type: "COMMENT_CANCELLED"; payload: { domPath: string } }
  | { type: "COMMENT_ADDED"; payload: CommentAnnotation };

// Agent operations: Side Panel -> Background (not forwarded to content)
export type AgentMessage =
  | { type: "AGENT_CONNECT"; payload: { url: string; token: string } }
  | { type: "AGENT_DISCONNECT" }
  | { type: "AGENT_SET_PERMISSIONS"; payload: AgentPermissions }
  | { type: "AGENT_APPLY_CHANGES"; payload: { changes: StyleChange[]; pagePath?: string; supplement?: string } }
  | { type: "AGENT_CHAT"; payload: { message: string; attachmentIds?: string[]; context?: { pagePath: string; components: ComponentInfo[] } } }
  | { type: "AGENT_UPLOAD_ATTACHMENT"; payload: { name: string; mimeType: string; data: number[] } }
  | { type: "AGENT_DELETE_ATTACHMENT"; payload: { id: string } }
  | { type: "AGENT_START_VERIFICATION"; payload: { verification: NonNullable<ChatMessage["verification"]> } }
  | { type: "AGENT_CANCEL_CURRENT" }
  | { type: "AGENT_GET_RUNTIME_STATE" }
  | { type: "AGENT_ROLLBACK" };

// Agent events: Background -> Side Panel
export type AgentEventMessage =
  | { type: "AGENT_STATUS"; payload: { connected: boolean; connecting?: boolean; agentUrl?: string; error?: string; project?: ProjectInfo; provider?: string; model?: string; capabilities?: AgentCapabilities } }
  | { type: "AGENT_WORKING"; payload: { working: boolean } }
  | { type: "AGENT_PROGRESS"; payload: { text: string } }
  | { type: "AGENT_TEXT_DELTA"; payload: { runId: string; delta: string; messageId?: string } }
  | { type: "AGENT_RESULT"; payload: { success: boolean; message: string; filesModified?: string[]; verification?: NonNullable<ChatMessage["verification"]> } }
  | { type: "AGENT_ERROR"; payload: { message: string } }
  | { type: "AGENT_RUNTIME_RESET" }
  | { type: "TEST_RUN_UPDATE"; payload: TestRunInfo };

// All message types
export type PrismMessage = DownstreamMessage | UpstreamMessage | AgentMessage | AgentEventMessage;
