# next-plugin-prism-design

PrismDesign 的 Next.js 插件 —— 一行配置，为你的 Next.js 项目接入 AI 可视化编辑能力。

## 功能

- 开发模式自动注入 PrismDesign Widget（悬浮聊天面板）
- 自动启动 AI Agent 服务，无需手动管理
- Agent 端口被占用时自动递增
- 生产构建自动跳过，零影响
- 支持 Claude Agent SDK、OpenAI Agents SDK、Codex SDK 和 GLM/ACP
- 提供两种接入方式：Config Wrapper（零组件）和 React 组件

## 安装

```bash
pnpm add -D next-plugin-prism-design
```

## 快速开始

### 方式一：Config Wrapper（推荐）

无需修改任何组件，只改 `next.config.ts`：

```ts
// next.config.ts
import { withPrismDesign } from 'next-plugin-prism-design';

export default withPrismDesign()({
  reactStrictMode: true,
});
```

### 方式二：React 组件

如果需要更灵活的控制，可以在根布局中使用 `<PrismDesign />` 组件：

```tsx
// app/layout.tsx
import { PrismDesign } from 'next-plugin-prism-design/react';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <PrismDesign />
      </body>
    </html>
  );
}
```

启动 `pnpm dev` 后，页面右下角会出现 PrismDesign 悬浮按钮。点击展开聊天面板，描述你想要的 UI 修改，AI 会直接修改源码并自动刷新页面。

## 配置选项

两种方式使用相同的配置选项：

```ts
// Config Wrapper
withPrismDesign({
  apiKey: 'sk-ant-...',
  agentPort: 9527,
  // ...
})({ reactStrictMode: true })

// React 组件（仅支持 Widget 配置）
<PrismDesign
  agentUrl="http://localhost:9527"
  position="bottom-right"
  locale="zh"
/>
```

### 完整配置

```ts
withPrismDesign({
  // ── Agent 配置 ──

  // API Key；OpenAI/Claude/GLM 按 Provider 解释，Codex 不需要
  apiKey: 'sk-ant-...',

  // API Base URL（可选，用于 LiteLLM 代理等场景）
  baseUrl: 'https://your-proxy.com/v1',

  // AI 模型名称（可选，默认 claude-sonnet-4-20250514）
  model: 'claude-sonnet-4-20250514',

  // Agent Provider（默认 "claude"）
  agentType: 'codex',
  // 'claude' | 'claude-sub' | 'openai' | 'codex' | 'glm'

  // Agent 子进程的网络代理配置（可选）
  httpProxy: 'http://127.0.0.1:7893',
  httpsProxy: 'http://127.0.0.1:7893',
  noProxy: '127.0.0.1,localhost',

  // Codex 传输方式（可选）
  codexTransport: 'websocket', // 'websocket' | 'sse'

  // 输出完整的 Agent prompt 调试信息（默认沿用环境变量）
  agentDebug: true,

  // Agent 服务端口（默认 9527，被占用时自动递增）
  agentPort: 9527,

  // 是否自动启动 Agent（默认 true）
  agentAutoStart: true,

  // 直接指定已运行的 Agent URL（跳过自动启动）
  agentUrl: 'http://localhost:9527',

  // ── Widget 配置 ──

  // 是否注入 Widget（默认 true）
  // 使用 Chrome 扩展作为唯一交互入口时设为 false；Agent 仍会自动启动
  widget: false,

  // 悬浮按钮位置（默认 "bottom-right"）
  position: 'bottom-right',  // 'bottom-right' | 'bottom-left'

  // 语言（默认根据浏览器语言自动检测）
  locale: 'zh',  // 'zh' | 'en'
})
```

## 使用场景

### 基础用法（使用 .env 配置 API Key）

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

```ts
// next.config.ts
import { withPrismDesign } from 'next-plugin-prism-design';
export default withPrismDesign()({ reactStrictMode: true });
```

Agent 启动时会自动读取 `.env` / `.env.local` 文件中的环境变量。

### 使用本机 Codex 登录态

```bash
codex login
```

```ts
withPrismDesign({
  agentType: 'codex',
  httpProxy: 'http://127.0.0.1:7893',
  httpsProxy: 'http://127.0.0.1:7893',
  noProxy: '127.0.0.1,localhost',
  codexTransport: 'websocket',
  agentDebug: true,
})({ reactStrictMode: true })
```

以上参数由插件注入 Agent 子进程，配置完成后只需运行 `pnpm dev`。

### 仅使用 Chrome 扩展

```ts
withPrismDesign({
  agentType: 'codex',
  widget: false,
})({ reactStrictMode: true })
```

该模式不会复制或注入 Widget，但仍会自动启动 Agent。

### 使用 OpenAI Agents SDK

```bash
OPENAI_API_KEY=sk-xxx pnpm dev
```

```ts
withPrismDesign({ agentType: 'openai' })({ reactStrictMode: true })
```

### 使用 LiteLLM 代理

```ts
withPrismDesign({
  apiKey: 'sk-your-key',
  baseUrl: 'https://your-litellm-proxy.com/v1',
  model: 'gpt-4o',
})({ reactStrictMode: true })
```

### 使用智谱 GLM

```ts
withPrismDesign({
  agentType: 'glm',
  apiKey: 'your-zhipu-api-key',
})({ reactStrictMode: true })
```

### 连接远程 / Docker Agent

如果 Agent 运行在远程服务器或 PrismDesign Platform 容器中：

```ts
withPrismDesign({
  agentAutoStart: false,
  agentUrl: 'https://your-platform.com/api/workspaces/abc123/agent',
})({ reactStrictMode: true })
```

## 工作原理

```
┌─────────────────────────────────────────────┐
│  Next.js Dev Server                         │
│  ┌───────────────────────────────────────┐  │
│  │  next-plugin (webpack hook)           │  │
│  │  ├─ 复制 widget.js 到 public/        │  │
│  │  ├─ 生成 init.js + config.json       │  │
│  │  └─ 启动 agent 子进程                │  │
│  └───────────────────────────────────────┘  │
│                    ↕ spawn                   │
│  ┌───────────────────────────────────────┐  │
│  │  Agent Server (port 9527)             │  │
│  │  ├─ POST /api/chat → Provider        │  │
│  │  ├─ WebSocket /ws → Protocol v2      │  │
│  │  └─ clientId/runId 会话与事件隔离     │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
         ↕ HTTP + WebSocket
┌─────────────────────────────────────────────┐
│  Browser                                    │
│  ┌───────────────────────────────────────┐  │
│  │  Widget (Shadow DOM)                  │  │
│  │  ├─ FAB 悬浮按钮                      │  │
│  │  ├─ 聊天面板                          │  │
│  │  └─ 评论标注                          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Config Wrapper vs React 组件

| 特性 | `withPrismDesign()` | `<PrismDesign />` |
|------|---------------------|-------------------|
| 修改文件 | 仅 `next.config.ts` | `next.config.ts` + 布局组件 |
| Agent 自动启动 | 支持 | 不支持（需手动或配合 wrapper） |
| Widget 注入 | 通过 webpack entry | 通过 script 标签 |
| 灵活度 | 全自动 | 可控制渲染位置和条件 |

## 项目指令

在项目根目录创建 `CLAUDE.md` 文件可以给 AI 提供项目上下文：

```markdown
# CLAUDE.md

## 项目信息
- 框架：Next.js 15 + TypeScript
- 样式：Tailwind CSS v4
- UI 组件库：shadcn/ui

## 编码规范
- 使用 App Router
- 样式使用 Tailwind 工具类
- 组件放在 src/components/ 目录
```

Claude Provider 会读取该文件；Codex Provider 使用 Codex CLI 的标准项目指令机制。

## 注意事项

- 仅在 `next dev`（开发模式）下生效，`next build` 时自动跳过
- Agent 进程随 Next.js Dev Server 一起启动和关闭
- Widget 使用 Shadow DOM 隔离样式，不会影响你的页面
- API Key 建议放在 `.env.local` 文件中，不要提交到代码仓库
- `public/__prism-design__/` 目录已自动添加 `.gitignore`，不会污染仓库

## 兼容性

- Next.js 13+（App Router 和 Pages Router 均支持）
- React 18+
- 现代浏览器（Chrome, Firefox, Safari, Edge）

## 发布检查

```bash
pnpm --filter next-plugin-prism-design build
pnpm --filter demo-next dev
```

确认 wrapper 与 React 组件导出、widget 静态资源、Agent 自动启动、端口探测和聊天链路正常。
