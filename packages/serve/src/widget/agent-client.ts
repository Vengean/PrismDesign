export class AgentClient {
  private ws: WebSocket | null = null;
  private clientId = `serve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(private baseUrl: string) {}

  async getStatus(): Promise<{ status: string; project: Record<string, unknown> }> {
    const res = await fetch(`${this.baseUrl}/api/status`, {
      headers: { "x-client-id": this.clientId },
    });
    return res.json();
  }

  async chat(
    message: string,
    context: { pagePath: string; components: Array<{ name: string; sourceFile?: string; sourceLine?: number }> }
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": this.clientId,
      },
      body: JSON.stringify({ message, context }),
    });
    return res.json();
  }

  connectWebSocket(onMessage: (type: string, data: any) => void): WebSocket {
    if (this.ws) {
      this.ws.close();
    }
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
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
}
