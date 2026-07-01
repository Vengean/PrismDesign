# next-plugin-__prism-design__

PrismDesign 的 Next.js 插件 —— 一行配置，为你的 Next.js 项目接入 AI 可视化编辑能力。

## 功能

- 开发模式自动注入 PrismDesign Widget（悬浮聊天面板）
- 自动启动 AI Agent 服务，无需手动管理
- Agent 端口被占用时自动递增
- 生产构建自动跳过，零影响
- 支持 Claude API、GLM API 等多种 AI 后端
- 提供两种接入方式：Config Wrapper（零组件）和 React 组件

## 安装

```bash
pnpm add -D next-plugin-__prism-design__
```

## 快速开始

### 方式一：Config Wrapper（推荐）

无需修改任何组件，只改 `next.config.ts`：

```ts
// next.config.ts
import { withPrismDesign } from 'next-plugin-__prism-design__';

export default withPrismDesign()({
  reactStrictMode: true,
});
```

### 方式二：React 组件

如果需要更灵活的控制，可以在根布局中使用 `<PrismDesign />` 组件：

```tsx
// app/layout.tsx
import { PrismDesign } from 'next-plugin-__prism-design__/react';

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

  // API Key（传递给 Agent 作为 ANTHROPIC_API_KEY）
  // 也可以通过项目根目录 .env 文件配置
  apiKey: 'sk-ant-...',

  // API Base URL（可选，用于 LiteLLM 代理等场景）
  baseUrl: 'https://your-proxy.com/v1',

  // AI 模型名称（可选，默认 claude-sonnet-4-20250514）
  model: 'claude-sonnet-4-20250514',

  // Agent 类型（默认 "claude"）
  agentType: 'claude',  // 'claude' | 'glm'

  // Agent 服务端口（默认 9527，被占用时自动递增）
  agentPort: 9527,

  // 是否自动启动 Agent（默认 true）
  agentAutoStart: true,

  // 直接指定已运行的 Agent URL（跳过自动启动）
  agentUrl: 'http://localhost:9527',

  // ── Widget 配置 ──

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
import { withPrismDesign } from 'next-plugin-__prism-design__';
export default withPrismDesign()({ reactStrictMode: true });
```

Agent 启动时会自动读取 `.env` / `.env.local` 文件中的环境变量。

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
│  │  ├─ POST /api/chat → Claude SDK      │  │
│  │  ├─ WebSocket /ws → 实时进度          │  │
│  │  └─ 读取项目 CLAUDE.md               │  │
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

## CLAUDE.md

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

Agent 启动时会自动读取这个文件。

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
