# @prism-studio-ai/serve

Lightweight static file server with built-in Prism Studio AI widget — comment on elements and chat with AI to modify your source code directly, no Chrome extension required.

## Quick Start

```bash
npx @prism-studio-ai/serve --dir ./dist --open
```

Use the local Codex CLI login without an API key:

```bash
codex login status
npx @prism-studio-ai/serve --dir ./dist --provider codex --open
```

A floating button appears on the page. Click it to open the AI chat panel, describe changes or annotate elements, and the AI modifies your source files automatically.

## Installation

```bash
npm install -g @prism-studio-ai/serve
```

Or as a dev dependency:

```bash
npm install -D @prism-studio-ai/serve
```

Add to `package.json`:

```json
{
  "scripts": {
    "design": "prism-studio-serve --dir ./dist --open"
  }
}
```

## How It Works

1. Serves your static HTML files with an injected AI widget
2. Launches a `@prism-studio-ai/agent` subprocess to handle AI code modifications
3. You comment on page elements or describe changes in the chat panel
4. The AI agent reads your source code, applies modifications, and the page reloads automatically

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--dir <path>` | Static file directory | Current directory |
| `--port <number>` | HTTP server port | `3000` |
| `--agent-port <number>` | Agent service port | `9527` |
| `--provider <name>` | `claude`, `claude-sub`, `openai`, `codex`, or `glm` | Agent default (`claude`) |
| `--no-agent` | Serve files only, no AI agent | `false` |
| `--api-key <key>` | Provider API key; ignored by `codex` | Provider environment variable |
| `--api-base-url <url>` | Provider API base URL | Provider default |
| `--model <name>` | Provider model override | Provider default |
| `--open` | Open browser on start | `false` |

## Configuration

### Provider authentication

Codex subscription login:

```bash
codex login
prism-studio-serve --dir ./dist --provider codex
```

Claude API key:

```bash
# Environment variable
export ANTHROPIC_API_KEY=sk-ant-xxx
prism-studio-serve --dir ./dist

# CLI argument
prism-studio-serve --dir ./dist --api-key sk-ant-xxx

# .env file in project root
echo "ANTHROPIC_API_KEY=sk-ant-xxx" >> .env
prism-studio-serve --dir ./dist
```

### API Proxy

```bash
prism-studio-serve --dir ./dist --api-base-url https://your-proxy.com/v1
```

For Codex WebSocket behind a local HTTP/Mixed proxy:

```bash
HTTP_PROXY=http://127.0.0.1:7893 \
HTTPS_PROXY=http://127.0.0.1:7893 \
NO_PROXY=127.0.0.1,localhost \
CODEX_TRANSPORT=websocket \
prism-studio-serve --dir ./dist --provider codex
```

## Features

- **Comment Mode** — Click the comment button, select a page element, type your feedback. The widget collects element info (DOM path, component name, text content) automatically.
- **Chat Mode** — Describe changes in natural language. The widget collects the page's DOM structure to help the AI locate the right code.
- **Auto Reload** — After the AI modifies files, the page reloads to reflect changes. Chat history is preserved across reloads.
- **LAN Access** — Share the URL with others on your network. The widget auto-detects the correct agent address.
- **Morph Animation** — The floating button smoothly expands into the chat panel and collapses back.
- **Zero Config** — No build step or framework integration needed. Works with any static HTML.

## Requirements

- Node.js >= 18
- `@prism-studio-ai/agent` installed alongside this package or available globally

## Release verification

```bash
pnpm --filter @prism-studio-ai/serve build
prism-studio-serve --dir ./dist --provider codex
```

## License

MIT
