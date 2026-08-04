# prism-design-widget

Framework-independent PrismDesign browser widget. It provides AI chat and element comments, connects to `prism-design-agent`, and is normally injected by the Vite/Next plugins or `prism-design-serve`.

## Installation

```bash
pnpm add prism-design-widget
```

Most applications should install `vite-plugin-prism-design` or `next-plugin-prism-design` instead of loading this package directly.

## Direct usage

```html
<script src="/path/to/prism-design-widget.iife.js"></script>
<script>
  PrismDesignWidget.init({
    agentUrl: "http://127.0.0.1:9527",
    position: "bottom-right",
    locale: "zh"
  });
</script>
```

Options:

| Option | Values | Default |
|---|---|---|
| `agentUrl` | Agent HTTP base URL | Saved URL or connection form |
| `position` | `bottom-right`, `bottom-left` | `bottom-right` |
| `locale` | `zh`, `en` | Browser language |

## Agent protocol

- `GET /api/status` checks availability and capabilities.
- `POST /api/chat` sends `{ runId, message }` with a stable `x-client-id`.
- `/ws?clientId=...` receives Protocol v2 events scoped to this browser client.
- Structured `message.delta` events render incremental Codex/OpenAI text.
- The legacy `agent:progress` event remains supported during migration.
- A page reload is triggered only when the final result reports modified files.

The client ID and chat history are stored in `localStorage`. Clearing site storage creates a new Agent session.

## Security

- Never put provider API keys in the widget or browser bundle.
- Run the Agent on a trusted development network.
- Restrict CORS and network exposure before using the Agent outside local development.

## Build and release

```bash
pnpm --filter prism-design-widget build
```

The package publishes the IIFE and ES module bundles from `dist/`.
