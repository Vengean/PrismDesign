const CLIENT_ID_KEY = "prism-client-id";

function getOrCreateClientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
  } catch {}
  const id = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try { localStorage.setItem(CLIENT_ID_KEY, id); } catch {}
  return id;
}

export class AgentClient {
  private ws: WebSocket | null = null;
  private clientId = getOrCreateClientId();

  constructor(private baseUrl: string, private accessToken: string) {}

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getStatus(): Promise<{ status: string; project: Record<string, unknown> }> {
    const res = await fetch(`${this.baseUrl}/api/status`, {
      headers: { "x-client-id": this.clientId, Authorization: `Bearer ${this.accessToken}` },
    });
    return res.json();
  }

  async uploadAttachment(file: File): Promise<{ id: string; name: string; mimeType: string; size: number }> {
    const res = await fetch(`${this.baseUrl}/api/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "x-client-id": this.clientId, "x-attachment-name": encodeURIComponent(file.name), "x-attachment-type": file.type || "text/plain", Authorization: `Bearer ${this.accessToken}` },
      body: file,
    });
    const text = await res.text();
    let result: any;
    try { result = text ? JSON.parse(text) : {}; }
    catch { result = { error: text }; }
    if (!res.ok) throw new Error(result.error || `附件上传失败 (${res.status})`);
    if (!result.attachment?.id) throw new Error("Agent 返回了无效的附件响应，请重启开发服务");
    return result.attachment;
  }

  async deleteAttachment(id: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/attachments/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-client-id": this.clientId, Authorization: `Bearer ${this.accessToken}` } });
  }

  async chat(message: string, runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, attachmentIds: string[] = []): Promise<{ success: boolean; message: string; filesModified?: string[]; runId?: string; verification?: { id: string; goal: string; proposedChecks: string[] } }> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ message, runId, pageUrl: location.href, attachmentIds, capabilities: { browserInteraction: false, automatedTesting: false } }),
    });
    return res.json();
  }

  async startVerification(
    verification: { id: string; goal: string; proposedChecks: string[] },
  ): Promise<{ verification: { status: string }; observation?: { url: string; title: string }; agentResult?: { message?: string }; testRun?: { performance?: TestPerformance } }> {
    const id = verification.id;
    const res = await fetch(`${this.baseUrl}/api/verifications/${encodeURIComponent(id)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": this.clientId, Authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify({
        pageUrl: location.href,
        goal: verification.goal,
        proposedChecks: verification.proposedChecks,
      }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Failed to start verification");
    return result;
  }

  connectWebSocket(onMessage: (type: string, data: any) => void): WebSocket {
    if (this.ws) {
      this.ws.close();
    }
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws?clientId=${encodeURIComponent(this.clientId)}`;
    const ws = new WebSocket(wsUrl, ["prism", this.accessToken]);
    ws.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        onMessage(type, data);
      } catch {}
    };
    this.ws = ws;
    return ws;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if an agent server is reachable at the given URL.
   */
  static async checkConnection(url: string, accessToken: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${url}/api/status`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }
}

export interface TestPerformance {
  totalDurationMs: number;
  agentDurationMs: number;
  toolDurationMs: number;
  browserDurationMs: number;
  cleanupDurationMs: number;
  toolCallCount: number;
  browserCommandCount: number;
  browserCommands: Record<string, { count: number; durationMs: number; maxDurationMs: number }>;
}
