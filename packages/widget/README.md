# @prism-studio-ai/widget

English | [简体中文](./README.zh-CN.md)

Prism Studio Widget is a lightweight, embeddable alternative to the Prism Studio Chrome Extension. It adds AI chat and element comments directly to a frontend application and connects to `@prism-studio-ai/agent`.

For the complete Prism Studio workflow, the Chrome Extension is recommended. It works without embedding UI into the application and supports automated browser testing, structured test evidence, and test-driven repair flows. Use the Widget when installing a Chrome extension is inconvenient or when a self-contained in-page editing entry point is preferred.

## Installation

```bash
pnpm add @prism-studio-ai/widget
```

The recommended integration is the Prism Studio Chrome Extension, especially when automated testing is required. To use the in-page Widget instead, install `@prism-studio-ai/vite-plugin` or `@prism-studio-ai/next-plugin` and let the framework plugin inject it automatically.

## Direct usage

```html
<script src="/path/to/prism-studio-widget.iife.js"></script>
<script>
  PrismStudioWidget.init({
    agentUrl: "http://127.0.0.1:9527",
    agentToken: "token-printed-by-agent",
    accessTokenRequired: true,
    position: "bottom-right",
    locale: "en"
  });
</script>
```

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `agentUrl` | `string` | Saved URL or `http://localhost:9527` in the form | Agent HTTP base URL |
| `agentToken` | `string` | Saved session token or empty | Access token printed by the Agent at startup |
| `accessTokenRequired` | `boolean` | `true` | Set to `false` only when the Agent explicitly disables token authentication |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Floating button and panel position |
| `locale` | `"zh" \| "en"` | Browser language | UI language |

The Widget auto-connects only when `agentUrl` is accompanied by `agentToken`, or when `accessTokenRequired` is explicitly `false`. Otherwise it displays the connection form so the user can enter the token.

`init()` is idempotent: only the first call initializes the Widget. Later calls are ignored.

### Without Agent authentication

```js
PrismStudioWidget.init({
  agentUrl: "http://127.0.0.1:9527",
  accessTokenRequired: false,
});
```

Do not disable authentication on an Agent exposed to a LAN or public network.

### ES module

```ts
import { init } from "@prism-studio-ai/widget";

init({
  agentUrl: "http://127.0.0.1:9527",
  agentToken: "token-printed-by-agent",
  locale: "en",
});
```

## Agent protocol

- `GET /api/status` checks availability and capabilities.
- `POST /api/chat` sends `{ runId, message }` with a stable `x-client-id`.
- `/ws?clientId=...` receives Protocol v2 events scoped to this browser client.
- Structured `message.delta` events render incremental Codex/OpenAI text.
- The legacy `agent:progress` event remains supported during migration.
- A page reload is triggered only when the final result reports modified files.

The stable client ID, chat history, and manually entered Agent URL are stored in `localStorage`. The manually entered access token is stored in `sessionStorage`. Clearing site storage creates a new Agent session.

## Security

- Never put provider API keys in the widget or browser bundle.
- Run the Agent on a trusted development network.
- Restrict CORS and network exposure before using the Agent outside local development.

## Build and release

```bash
pnpm --filter @prism-studio-ai/widget build
```

The package publishes the IIFE and ES module bundles from `dist/`.
