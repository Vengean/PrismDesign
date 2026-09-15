# @prism-studio-ai/next-plugin

[English](./README.md) | 简体中文

Prism Studio 的 Next.js 插件 —— 一行配置，为你的 Next.js 项目接入 AI 可视化编辑能力。

该插件用于自动启动 Agent，并按需把 Prism Studio Widget 注入开发页面。需要自动化浏览器测试、结构化测试证据和测试后修复流程时，更推荐使用 Prism Studio Chrome Extension，并将 `widget` 设置为 `false`。

## 功能

- 开发模式自动注入 Prism Studio Widget（悬浮聊天面板）
- 自动启动 AI Agent 服务，无需手动管理
- Agent 端口被占用时自动递增
- 生产构建自动跳过，零影响
- 支持 Claude Agent SDK、OpenAI Agents SDK、Codex SDK 和 GLM/ACP
- 提供两种接入方式：Config Wrapper（零组件）和 React 组件

## 安装

```bash
pnpm add -D @prism-studio-ai/next-plugin
```

## 快速开始

### 方式一：Webpack Config Wrapper

使用 Webpack 时无需修改组件，只改 `next.config.ts`：

```ts
// next.config.ts
import { withPrismStudio } from '@prism-studio-ai/next-plugin';

export default withPrismStudio()({
  reactStrictMode: true,
});
```

### 方式二：React 组件（Turbopack 推荐）

Next.js 16 默认使用 Turbopack。请同时保留 `withPrismStudio()` 负责启动 Agent，并在根布局中使用 `<PrismStudio />` 加载 Widget：

```tsx
// app/layout.tsx
import { PrismStudio } from '@prism-studio-ai/next-plugin/react';

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

启动 `pnpm dev` 后，页面右下角会出现 Prism Studio 悬浮按钮。点击展开聊天面板，描述你想要的 UI 修改，AI 会直接修改源码并自动刷新页面。

## 配置选项

Provider、模型、凭据、代理及权限统一放在项目根目录的 `prism.config.ts`。Next.js 插件只配置 Agent 启动和 Widget 接入：

| Config Wrapper 配置 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `agentPort` | `number` | `9527` | 自动启动 Agent 时使用的首选端口；被占用时自动递增 |
| `agentAutoStart` | `boolean` | `true` | 是否随 Next.js Dev Server 自动启动 Agent |
| `agentUrl` | `string` | 未设置 | 连接已有 Agent；设置后不会自动启动新 Agent |
| `widget` | `boolean` | `true` | 是否准备并加载 Widget；只使用 Chrome Extension 时设为 `false` |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Widget 悬浮按钮和面板位置 |
| `locale` | `"zh" \| "en"` | 浏览器语言 | Widget 界面语言 |

| React 组件属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `agentUrl` | `string` | 自动读取生成的配置 | 直接连接已有 Agent |
| `agentToken` | `string` | 未设置 | 直接连接 Agent 时使用的访问 Token |
| `accessTokenRequired` | `boolean` | `true` | 仅当目标 Agent 关闭鉴权时设为 `false` |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Widget 位置 |
| `locale` | `"zh" \| "en"` | 浏览器语言 | Widget 语言 |
| `basePath` | `string` | 自动检测 | Next.js 应用的 `basePath` |

```ts
// Config Wrapper
withPrismStudio({
  agentPort: 9527,
  widget: false,
})({ reactStrictMode: true })

// React 组件（仅支持 Widget 配置）
<PrismStudio
  agentUrl="http://localhost:9527"
  agentToken="Agent 启动时输出的 Token"
  position="bottom-right"
  locale="zh"
/>
```

### 完整插件配置

```ts
withPrismStudio({
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

### 配置 Agent

在项目根目录创建 `prism.config.ts`。完整字段及权限说明见 `@prism-studio-ai/agent` 文档；Next.js 配置中不再重复 Agent 参数。

### 仅使用 Chrome 扩展

```ts
withPrismStudio({
  widget: false,
})({ reactStrictMode: true })
```

该模式不会复制或注入 Widget，但仍会自动启动 Agent。

### 连接远程 / Docker Agent

如果 Agent 运行在远程服务器或 Prism Studio Platform 容器中：

```ts
withPrismStudio({
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

| 特性 | `withPrismStudio()` | `<PrismStudio />` |
|------|---------------------|-------------------|
| 修改文件 | 仅 `next.config.ts` | `next.config.ts` + 布局组件 |
| Agent 自动启动 | 支持 | 不支持（需手动或配合 wrapper） |
| Widget 注入 | 通过 Webpack entry | 通过 script 标签，支持 Turbopack |
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

- 仅在 `next dev`（开发模式）下生效，`next build` 时不会准备 Widget 或启动 Agent
- Agent 进程随 Next.js Dev Server 一起启动和关闭
- Widget 使用 Shadow DOM 隔离样式，不会影响你的页面
- Agent 配置统一放在 `prism.config.ts`；密钥如需通过环境变量注入，不要提交到代码仓库
- `public/__prism-studio__/` 目录已自动添加 `.gitignore`，不会污染仓库

## 兼容性

- Next.js 13+（App Router 和 Pages Router 均支持）
- React 18+
- 现代浏览器（Chrome, Firefox, Safari, Edge）

## 发布检查

```bash
pnpm --filter @prism-studio-ai/next-plugin build
pnpm --filter demo-next dev
```

确认 wrapper 与 React 组件导出、widget 静态资源、Agent 自动启动、端口探测和聊天链路正常。
