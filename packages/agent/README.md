# prism-design-agent

AI Agent service for PrismDesign — scans your frontend project, receives visual design edits from the Chrome extension, and modifies source code.

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

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port <number>` | Service port | `9527` |
| `--project <path>` | Project root directory | Auto-detect |
| `--api-key <key>` | Anthropic API Key | `$ANTHROPIC_API_KEY` |
| `--api-base-url <url>` | Custom API base URL | `$ANTHROPIC_BASE_URL` |
| `--system-prompt <file>` | Custom system prompt file | Built-in |
| `--skip-analysis` | Skip AI convention analysis | `false` |

### Custom System Prompt

```bash
npx prism-design-agent start --system-prompt ./my-prompt.md
```

### API Proxy

```bash
npx prism-design-agent start --api-base-url https://your-proxy.com/v1
```

## How It Works

1. **Project Scanning** — Detects framework, language, and build tool on startup
2. **Deep Analysis** — On first chat, the AI agent reads your source code to understand components, styling patterns, and conventions
3. **Code Modification** — Receives instructions from the Chrome extension and modifies source files
4. **HMR** — Changes are picked up by your dev server automatically

## Requirements

- Node.js >= 18
- A frontend project with a dev server (Vite, Webpack, etc.)
- PrismDesign Chrome Extension

## License

MIT
