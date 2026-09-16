# @prism-studio-ai/agent

English | [简体中文](./README.zh-CN.md)

AI Agent service for Prism Studio — receives instructions from supported clients and modifies source code through Claude, Codex, OpenAI Agents SDK, or GLM.

## Quick Start

```bash
# In your project root
npx @prism-studio-ai/agent start
```

Use OpenAI Agents SDK:

```bash
export OPENAI_API_KEY=sk-xxx
npx @prism-studio-ai/agent start --provider openai
```

Use an existing local Codex CLI ChatGPT login (no API key required):

```bash
codex login status
npx @prism-studio-ai/agent start --provider codex
```

Set `debug: true` in `prism.config.ts` to print the widget input (truncated at
8,000 characters) plus structured run, tool, text, and file-change events in
the agent terminal. Leave it disabled when messages may contain sensitive data.
Vite-plugin development mode prints structured events by default without full
prompt bodies. Set `PRISM_AGENT_DEBUG_EVENTS=0` to disable those event logs.

## Installation

```bash
npm install -D @prism-studio-ai/agent
```

Add to `package.json`:

```json
{
  "scripts": {
    "design": "prism-studio-agent start"
  }
}
```

## Configuration

For the three launch fields supported by both interfaces, CLI arguments override `prism.config.ts`. Agent behavior is configured in `prism.config.ts`; provider credential environment variables remain available for CI and secret injection.

### Authentication

Choose one provider:

| Provider | Authentication | Notes |
|---|---|---|
| `codex` | `codex login` | Uses the local ChatGPT/Codex subscription login; no API key required |
| `openai` | `OPENAI_API_KEY` | OpenAI Agents SDK and usage-based API billing |
| `claude` | `ANTHROPIC_API_KEY` | Claude Agent SDK with API billing |
| `claude-sub` | Local Claude subscription login | Reuses the supported local Claude session flow |
| `glm` | API key | Runs through the ACP adapter |

Claude API example:

```bash
# Environment variable
export ANTHROPIC_API_KEY=sk-ant-xxx
npx @prism-studio-ai/agent start

# CLI without prism.config.ts
npx @prism-studio-ai/agent start \
  --provider claude \
  --api-key sk-ant-xxx \
  --model claude-opus-4-6

# .env file in project root
echo "ANTHROPIC_API_KEY=sk-ant-xxx" >> .env
npx @prism-studio-ai/agent start
```

### CLI Options

The CLI can start the Agent without a config file. It supports the essential project, service, provider, credential, endpoint, and model options. Permissions and advanced behavior belong in `prism.config.ts`. CLI values override matching config-file values.

| Option | `prism.config.ts` field | Description | Default |
|--------|-------------------------|-------------|---------|
| `--port <number>` | `port` | Service port | `9527` |
| `--project <path>` | `project` | Project root directory | Current directory |
| `--provider <name>` | `provider` | `claude`, `claude-sub`, `openai`, `codex`, or `glm` | `claude` |
| `--api-key <key>` | `apiKey` | Provider API key; ignored by Codex login mode | Provider environment variable |
| `--api-base-url <url>` | `apiBaseUrl` | Provider-compatible API base URL | Provider default |
| `--model <name>` | `model` | Provider model override | Provider default |

The default OpenAI model is `gpt-5.6` and can be overridden with the shared `model` config field.

The Codex provider uses the official `@openai/codex-sdk` and delegates authentication
to the local Codex CLI. Run `codex login` once; Prism Studio does not read or copy the
CLI credential file. Use `model` and `codexReasoningEffort` to override Codex defaults.
The provider uses HTTPS/SSE by default to avoid long WebSocket retry delays; set
`codexTransport: "websocket"` when WebSocket access is reliable.

### Config File (prism.config.ts)

Place a `prism.config.ts` in your project root for persistent configuration:

```typescript
export default {
  port: 9527,
  project: "./",
  provider: "codex",
  model: "gpt-5.6-sol",
  // API providers can also set apiKey and apiBaseUrl here.
  // Prefer environment variables for secrets committed to source control.
  apiKey: process.env.PRISM_PROVIDER_API_KEY,
  apiBaseUrl: "https://your-provider.example.com/v1",
  accessTokenRequired: true,
  codexReasoningEffort: "high",
  codexTransport: "https",
  httpsProxy: "http://127.0.0.1:7893",
  httpProxy: "http://127.0.0.1:7893",
  noProxy: "127.0.0.1,localhost",
  debug: false,
  permissions: {
    filesystem: "workspace-write",
    commands: "none",
    network: false,
    browser: {
      enabled: true,
      headless: false,
      allowedOrigins: ["http://localhost:5173"],
    },
    mcp: {
      // Omit enabled to load mcpServers automatically.
      defaultApproval: "prompt",
    },
  },
  mcpServers: {
    example: {
      command: "example-mcp-server",
      args: ["--stdio"],
      env: { EXAMPLE_TOKEN: process.env.EXAMPLE_TOKEN || "" },
      defaultToolsApprovalMode: "prompt",
    },
  },
};
```

Also supports `prism.config.js` and `prism.config.mjs`.

Use the provider-independent `apiKey`, `apiBaseUrl`, and `model` fields for every API-based provider. The Agent maps them to the selected provider automatically.

### Permission behavior

- `filesystem: "read-only"` removes write/edit tools from Claude and OpenAI and starts Codex in its read-only sandbox.
- `commands: "none"` removes Claude Bash access. Codex uses approval-on-request so unapproved shell commands cannot run; its internal sandbox still handles workspace operations.
- `network: false` disables Codex sandbox network access and excludes Claude web tools. OpenAI has no general network tool.
- `browser.enabled: false` removes provider browser tools and rejects Agent browser API calls.
- `browser.allowedOrigins` limits navigation to exact HTTP(S) Origins. An empty list allows any HTTP(S) Origin.
- Configured `mcpServers` are loaded by default. Set `mcp.enabled: false` to disable all custom MCP servers explicitly. Prism's bounded browser verification server is controlled separately by `browser.enabled`.

GLM permissions ultimately depend on `glm-acp-agent`. Prism only requests its `bypass_permissions` mode when both filesystem writes and workspace commands are enabled; restrictive deployments should additionally use an isolated OS account or container.

### Project Instructions

Provider-native project instructions remain supported. Claude reads `CLAUDE.md`; Codex reads its normal Codex project configuration and instruction files through the official CLI.

### Protocol v2

`GET /api/status` exposes the selected provider, model, protocol version, and
capabilities. WebSocket clients connect with `/ws?clientId=...`; run events are
scoped to that client and include structured text deltas, tool progress, file
changes, completion, failure, and cancellation. Legacy `agent:*` events remain
available for backwards compatibility.

### API and network proxy

```ts
export default {
  provider: "claude",
  apiBaseUrl: "https://your-proxy.com/v1",
};
```

For a local proxy used by Codex WebSocket transport:

```ts
export default {
  provider: "codex",
  codexTransport: "websocket",
  httpProxy: "http://127.0.0.1:7893",
  httpsProxy: "http://127.0.0.1:7893",
  noProxy: "127.0.0.1,localhost",
};
```

## How It Works

1. **Project Scanning** — Detects framework, language, and build tool on startup
2. **Provider Sessions** — Keeps separate multi-turn sessions for each widget/tab client ID
3. **Code Modification** — Streams provider events, applies changes, and tracks modified files
4. **Protocol v2** — Exposes status, chat, cancellation, session clearing, and structured WebSocket events

## Architecture

The agent server normalizes provider-specific SDK events:

```
Client (Chrome extension / framework plugin)
  → constructs full message with context
  → POST /api/chat { runId, message }
  → Claude / OpenAI / Codex / GLM provider
  → scoped WebSocket events by clientId + runId
  → { success, message, filesModified }
```

Clients construct the page/element context. The server owns provider routing, session lifecycle, cancellation, event normalization, and file-change reporting.

## Release verification

```bash
pnpm --filter @prism-studio-ai/agent build
codex login status                         # when publishing/testing the Codex path
prism-studio-agent start --provider codex --project ./your-app
curl http://127.0.0.1:9527/api/status
```

## Requirements

- Node.js >= 18
- A frontend project
- A compatible client, such as the Prism Studio Chrome Extension

## License

MIT
