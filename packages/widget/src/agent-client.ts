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

  constructor(private baseUrl: string) {}

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async getStatus(): Promise<{ status: string; project: Record<string, unknown> }> {
    const res = await fetch(`${this.baseUrl}/api/status`, {
      headers: { "x-client-id": this.clientId },
    });
    return res.json();
  }

  async chat(message: string): Promise<{ success: boolean; message: string; filesModified?: string[]; runId?: string; verification?: { id: string; goal: string; proposedChecks: string[] } }> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": this.clientId,
      },
      body: JSON.stringify({ message, runId, pageUrl: location.href }),
    });
    return res.json();
  }

  async startVerification(
    verification: { id: string; goal: string; proposedChecks: string[] },
  ): Promise<{ verification: { status: string }; observation?: { url: string; title: string }; agentResult?: { message?: string } }> {
    const id = verification.id;
    const res = await fetch(`${this.baseUrl}/api/verifications/${encodeURIComponent(id)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-client-id": this.clientId },
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
    const ws = new WebSocket(wsUrl);
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
  static async checkConnection(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${url}/api/status`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }
}
