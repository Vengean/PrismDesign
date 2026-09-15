# @prism-studio-ai/vite-plugin

English | [简体中文](./README.zh-CN.md)

The Prism Studio integration for Vite projects. It starts Prism Studio Agent with the development server and can inject the in-page Widget into React, Vue, Svelte, or any other Vite application.

For automated browser testing, structured evidence, and test-driven repair flows, the Prism Studio Chrome Extension is recommended. Set `widget: false` when the Chrome Extension is the only user interface.

## Features

- Starts Prism Studio Agent with the Vite development server
- Optionally injects Prism Studio Widget into the page
- Automatically selects another port when the preferred port is occupied
- Proxies local Agent HTTP and WebSocket traffic through Vite when needed
- Does not affect production builds
- Supports every Agent provider configured in `prism.config.ts`

## Installation

```bash
pnpm add -D @prism-studio-ai/vite-plugin
```

## Quick start

```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import prismStudio from "@prism-studio-ai/vite-plugin";

export default defineConfig({
  plugins: [react(), prismStudio()],
});
```

Run the Vite development server. By default, the Widget appears in the bottom-right corner and the Agent starts automatically.

## Plugin options

Provider, model, credentials, proxy, MCP, and permission settings belong in the project-root `prism.config.ts`. This plugin only controls Agent startup, connection, and Widget injection.

| Option | Type | Default | Description |
|---|---|---|---|
| `agentPort` | `number` | `9527` | Preferred port when auto-starting the Agent; increments when occupied |
| `agentAutoStart` | `boolean` | `true` | Start the Agent with the Vite development server |
| `agentUrl` | `string` | Not set | Connect to an existing Agent and skip auto-start |
| `widget` | `boolean` | `true` | Inject the in-page Widget; set to `false` for Chrome-Extension-only usage |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Widget button and panel position |
| `locale` | `"zh" \| "en"` | Browser language | Widget UI language |

```ts
prismStudio({
  agentPort: 9527,
  agentAutoStart: true,
  widget: true,
  position: "bottom-right",
  locale: "en",
});
```

## Chrome Extension only

```ts
prismStudio({ widget: false });
```

The plugin still starts the Agent but does not inject UI into the application. Open the target page and connect with the Prism Studio Chrome Extension.

## Existing or remote Agent

```ts
prismStudio({
  agentAutoStart: false,
  agentUrl: "https://your-agent.example.com",
});
```

When authentication is enabled, the Widget displays its connection form so the user can enter the Agent access token.

## Manual Agent startup

```ts
prismStudio({ agentAutoStart: false });
```

```bash
npx @prism-studio-ai/agent start --project . --port 9527
```

## Agent configuration

Create `prism.config.ts` in the project root. It is the single persistent configuration entry for providers, models, credentials, proxy settings, permissions, browser access, and custom MCP servers. See the `@prism-studio-ai/agent` documentation for the complete schema.

## Notes

- Active only during `vite dev`; skipped during `vite build`
- The auto-started Agent exits with the Vite development server
- Widget styles are isolated with Shadow DOM
- Never commit provider credentials to source control

## Compatibility

- Vite 5+
- React, Vue, Svelte, and other Vite-supported frameworks
- Modern Chrome, Firefox, Safari, and Edge

Next.js projects should use `@prism-studio-ai/next-plugin`.

## Build and release verification

```bash
pnpm --filter @prism-studio-ai/vite-plugin build
pnpm --filter demo dev
```

Verify Widget injection, Agent auto-start, same-origin proxying, streaming chat updates, and HMR after source changes.
