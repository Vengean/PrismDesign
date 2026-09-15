export interface ToolContext {
  clientId: string;
  runId: string;
  workspaceId?: string;
}

export interface PrismTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

/** Provider-neutral source of truth for tools. Provider and MCP adapters consume it. */
export class ToolRegistry {
  private readonly tools = new Map<string, PrismTool<any, any>>();

  register<TInput, TOutput>(tool: PrismTool<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  list(): PrismTool[] {
    return [...this.tools.values()];
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(input, context);
  }
}
