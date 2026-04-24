import type { StyleChange, ComponentInfo } from "./types.js";

export class AgentClient {
  constructor(private baseUrl: string) {}

  async getStatus(): Promise<{ status: string; project: Record<string, unknown> }> {
    const res = await fetch(`${this.baseUrl}/api/status`);
    return res.json();
  }

  async applyChanges(
    changes: StyleChange[],
    component?: ComponentInfo | null,
    supplement?: string
  ): Promise<{ success: boolean; message: string; filesModified: string[] }> {
    const res = await fetch(`${this.baseUrl}/api/apply-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes,
        sourceFile: component?.sourceFile,
        sourceLine: component?.sourceLine,
        componentName: component?.name,
        supplement,
      }),
    });
    return res.json();
  }

  async chat(
    message: string,
    context: { pagePath: string; components: ComponentInfo[] }
  ): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context }),
    });
    return res.json();
  }

  async rollback(): Promise<{ success: boolean }> {
    const res = await fetch(`${this.baseUrl}/api/rollback`, { method: "POST" });
    return res.json();
  }

  connectWebSocket(onMessage: (type: string, data: unknown) => void): WebSocket {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        onMessage(type, data);
      } catch {}
    };
    return ws;
  }
}
