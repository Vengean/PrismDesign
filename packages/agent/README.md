# prism-design-agent

AI Agent service for PrismDesign — receives instructions from the Chrome extension or serve widget, and modifies source code through Claude, OpenAI Agents SDK, or GLM.

## Quick Start

```bash
# In your project root
npx prism-design-agent start
```

Use OpenAI Agents SDK:

```bash
export OPENAI_API_KEY=sk-xxx
npx prism-design-agent start --provider openai
```

Use an existing local Codex CLI ChatGPT login (no API key required):

```bash
codex login status
npx prism-design-agent start --provider codex
```

Set `PRISM_AGENT_DEBUG=1` to print the widget input (truncated at 8,000
characters) plus structured run, tool, text, and file-change events in the
agent terminal. Leave it disabled when messages may contain sensitive data.
Vite-plugin development mode prints structured events by default without full
prompt bodies. Set `PRISM_AGENT_DEBUG_EVENTS=0` to disable those event logs.

## Installation

```bash
npm install -D prism-design-agent
```

Add to `package.json`:

```json
{
  "scripts": {
    "design": "prism-design-agent start"
  }
}
```

## Configuration

Configuration priority: **CLI args > prism.config.ts > Environment variables > .env file**

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
npx prism-design-agent start

# CLI argument
npx prism-design-agent start --api-key sk-ant-xxx

# .env file in project root
echo "ANTHROPIC_API_KEY=sk-ant-xxx" >> .env
npx prism-design-agent start
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port <number>` | Service port | `9527` |
| `--project <path>` | Project root directory | Auto-detect |
| `--api-key <key>` | Provider API key; ignored by `codex` | Provider environment variable |
| `--api-base-url <url>` | Provider-compatible API base URL | Provider default |
| `--model <name>` | Provider model override | Provider default |
| `--provider <name>` | `claude`, `claude-sub`, `openai`, `codex`, or `glm` | `claude` |

OpenAI configuration uses `OPENAI_API_KEY`, `OPENAI_MODEL`, and optionally
`OPENAI_BASE_URL`. The default OpenAI model is `gpt-5.6` and can be overridden
without changing the client protocol.

The Codex provider uses the official `@openai/codex-sdk` and delegates authentication
to the local Codex CLI. Run `codex login` once; PrismDesign does not read or copy the
CLI credential file. Use `CODEX_MODEL` and `CODEX_REASONING_EFFORT` to override Codex
defaults. The provider uses HTTPS/SSE by default to avoid long WebSocket retry delays
on restricted networks; set `CODEX_TRANSPORT=websocket` when WebSocket access is reliable.

### Config File (prism.config.ts)

Place a `prism.config.ts` in your project root for persistent configuration:

```typescript
import { defineConfig } from "prism-design-agent/config";

export default defineConfig({
  provider: "codex",
  codexModel: "gpt-5.6-sol",
  codexReasoningEffort: "high",
  codexTransport: "websocket",
  httpsProxy: "http://127.0.0.1:7893",
  httpProxy: "http://127.0.0.1:7893",
});
```

Also supports `prism.config.js` and `prism.config.mjs`.

### Project Instructions

Provider-native project instructions remain supported. Claude reads `CLAUDE.md`; Codex reads its normal Codex project configuration and instruction files through the official CLI.

### Protocol v2

`GET /api/status` exposes the selected provider, model, protocol version, and
capabilities. WebSocket clients connect with `/ws?clientId=...`; run events are
scoped to that client and include structured text deltas, tool progress, file
changes, completion, failure, and cancellation. Legacy `agent:*` events remain
available for backwards compatibility.

### API and network proxy

```bash
npx prism-design-agent start --api-base-url https://your-proxy.com/v1
```

For a local HTTP/Mixed proxy used by Codex WebSocket transport:

```bash
HTTP_PROXY=http://127.0.0.1:7893 \
HTTPS_PROXY=http://127.0.0.1:7893 \
NO_PROXY=127.0.0.1,localhost \
CODEX_TRANSPORT=websocket \
npx prism-design-agent start --provider codex
```

## How It Works

1. **Project Scanning** — Detects framework, language, and build tool on startup
2. **Provider Sessions** — Keeps separate multi-turn sessions for each widget/tab client ID
3. **Code Modification** — Streams provider events, applies changes, and tracks modified files
4. **Protocol v2** — Exposes status, chat, cancellation, session clearing, and structured WebSocket events

## Architecture

The agent server normalizes provider-specific SDK events:

```
Client (Chrome ext / serve widget)
  → constructs full message with context
  → POST /api/chat { runId, message }
  → Claude / OpenAI / Codex / GLM provider
  → scoped WebSocket events by clientId + runId
  → { success, message, filesModified }
```

Clients construct the page/element context. The server owns provider routing, session lifecycle, cancellation, event normalization, and file-change reporting.

## Release verification

```bash
pnpm --filter prism-design-agent build
codex login status                         # when publishing/testing the Codex path
prism-design-agent start --provider codex --project ./your-app
curl http://127.0.0.1:9527/api/status
```

## Requirements

- Node.js >= 18
- A frontend project
- PrismDesign Chrome Extension or prism-design-serve

## License

MIT
