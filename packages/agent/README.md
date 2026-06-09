# prism-design-agent

AI Agent service for PrismDesign — receives instructions from the Chrome extension or serve widget, and modifies your source code via Claude.

## Quick Start

```bash
# In your project root
npx prism-design-agent start
```

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

### API Key (required)

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
| `--api-key <key>` | Anthropic API Key | `$ANTHROPIC_API_KEY` |
| `--api-base-url <url>` | Custom API base URL | `$ANTHROPIC_BASE_URL` |
| `--model <name>` | Model name | `claude-opus-4-6` |

### Config File (prism.config.ts)

Place a `prism.config.ts` in your project root for persistent configuration:

```typescript
import { defineConfig } from "prism-design-agent/config";

export default defineConfig({
  anthropicApiKey: "sk-ant-xxx",
  anthropicModel: "claude-sonnet-4-6",
  anthropicBaseUrl: "https://your-proxy.com/v1",
  httpsProxy: "http://127.0.0.1:7890",
  httpProxy: "http://127.0.0.1:7890",
  options: {
    // claude-agent-sdk SDKSessionOptions
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  },
});
```

Also supports `prism.config.js` and `prism.config.mjs`.

### Project Instructions (CLAUDE.md)

The agent reads your project's `CLAUDE.md` file automatically. Use it to describe coding conventions, component patterns, and project-specific rules that the AI should follow when modifying code.

### API Proxy

```bash
npx prism-design-agent start --api-base-url https://your-proxy.com/v1
```

## How It Works

1. **Project Scanning** — Detects framework, language, and build tool on startup
2. **CLAUDE.md** — Reads project instructions for coding conventions and rules
3. **Code Modification** — Receives messages from clients (Chrome extension / serve widget), forwards to Claude, applies changes to source files
4. **Single API** — One endpoint (`POST /api/chat`) accepts a message string and returns the result

## Architecture

The agent server is a pure pass-through:

```
Client (Chrome ext / serve widget)
  → constructs full message with context
  → POST /api/chat { message }
  → Agent forwards to Claude SDK session
  → returns { success, message, filesModified }
```

Clients are responsible for constructing the complete message including any page context, element info, or change descriptions. The server does not modify or augment messages.

## Requirements

- Node.js >= 18
- A frontend project
- PrismDesign Chrome Extension or prism-design-serve

## License

MIT
