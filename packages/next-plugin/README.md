# @prism-studio-ai/next-plugin

English | [简体中文](./README.zh-CN.md)

The Prism Studio integration for Next.js projects. It starts Prism Studio Agent with the development server and can load the in-page Widget through a Next.js config wrapper or React component.

For automated browser testing, structured evidence, and test-driven repair flows, the Prism Studio Chrome Extension is recommended. Set `widget: false` when the Chrome Extension is the only user interface.

## Features

- Starts Prism Studio Agent with the Next.js development server
- Supports Webpack config injection and a Turbopack-compatible React component
- Optionally prepares and loads Prism Studio Widget
- Automatically selects another port when the preferred port is occupied
- Skips Agent startup and Widget preparation during production builds
- Supports every Agent provider configured in `prism.config.ts`

## Installation

```bash
pnpm add -D @prism-studio-ai/next-plugin
```

## Webpack setup

```ts
// next.config.ts
import { withPrismStudio } from "@prism-studio-ai/next-plugin";

export default withPrismStudio()({
  reactStrictMode: true,
});
```

With Webpack, the wrapper starts the Agent and injects the Widget without requiring a component.

## Turbopack setup

Next.js 16 uses Turbopack by default. Keep the config wrapper to start the Agent, and add the React component to the root layout to load the Widget:

```ts
// next.config.ts
import { withPrismStudio } from "@prism-studio-ai/next-plugin";

export default withPrismStudio()({});
```

```tsx
// app/layout.tsx
import { PrismStudio } from "@prism-studio-ai/next-plugin/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <PrismStudio />
      </body>
    </html>
  );
}
```

## Config wrapper options

Provider, model, credentials, proxy, MCP, and permission settings belong in the project-root `prism.config.ts`.

| Option | Type | Default | Description |
|---|---|---|---|
| `agentPort` | `number` | `9527` | Preferred port when auto-starting the Agent; increments when occupied |
| `agentAutoStart` | `boolean` | `true` | Start the Agent with the Next.js development server |
| `agentUrl` | `string` | Not set | Connect to an existing Agent and skip auto-start |
| `widget` | `boolean` | `true` | Prepare and load the Widget; set to `false` for Chrome-Extension-only usage |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Widget button and panel position |
| `locale` | `"zh" \| "en"` | Browser language | Widget UI language |

## React component props

| Prop | Type | Default | Description |
|---|---|---|---|
| `agentUrl` | `string` | Generated config | Connect directly to an existing Agent |
| `agentToken` | `string` | Not set | Access token for a directly configured Agent |
| `accessTokenRequired` | `boolean` | `true` | Set to `false` only when the target Agent disables authentication |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Widget position |
| `locale` | `"zh" \| "en"` | Browser language | Widget language |
| `basePath` | `string` | Auto-detected | Next.js application base path |

## Chrome Extension only

```ts
export default withPrismStudio({ widget: false })({});
```

The wrapper still starts the Agent but does not prepare or inject the Widget.

## Existing or remote Agent

```ts
export default withPrismStudio({
  agentAutoStart: false,
  agentUrl: "https://your-agent.example.com",
})({});
```

When rendering `<PrismStudio />` with a directly configured authenticated Agent, pass its connection token:

```tsx
<PrismStudio
  agentUrl="http://127.0.0.1:9527"
  agentToken="token-printed-by-agent"
  locale="en"
/>
```

## Agent configuration

Create `prism.config.ts` in the project root. It is the single persistent configuration entry for providers, models, credentials, proxy settings, permissions, browser access, and custom MCP servers. See the `@prism-studio-ai/agent` documentation for the complete schema.

## Webpack and Turbopack behavior

| Capability | `withPrismStudio()` with Webpack | `<PrismStudio />` with Turbopack |
|---|---|---|
| Agent auto-start | Yes | Provided by the wrapper |
| Widget loading | Webpack entry injection | Script element |
| Conditional rendering | No | Yes |

## Notes

- Active only during `next dev`; production builds do not prepare the Widget or start the Agent
- The auto-started Agent exits with the Next.js development server
- Generated files live in `public/__prism-studio__/` and are ignored by its generated `.gitignore`
- Widget styles are isolated with Shadow DOM
- Never commit provider credentials to source control

## Compatibility

- Next.js 13+
- App Router and Pages Router
- React 18+
- Webpack and Turbopack, using the integration method described above
- Modern Chrome, Firefox, Safari, and Edge

## Build and release verification

```bash
pnpm --filter @prism-studio-ai/next-plugin build
pnpm --filter demo-next dev
```

Verify exports, static Widget assets, Agent auto-start, port detection, authentication-token handoff, and streaming chat.
