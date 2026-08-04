# vite-plugin-prism-design

PrismDesign 的 Vite 插件 —— 一行配置，为你的 React / Vue / Svelte 项目接入 AI 可视化编辑能力。

## 功能

- 开发模式自动注入 PrismDesign Widget（悬浮聊天面板）
- 自动启动 AI Agent 服务，无需手动管理
- Agent 端口被占用时自动递增
- 生产构建自动跳过，零影响
- 支持 Claude Agent SDK、OpenAI Agents SDK、Codex SDK 和 GLM/ACP

## 安装

```bash
pnpm add -D vite-plugin-prism-design
```

## 快速开始

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import prismDesign from 'vite-plugin-prism-design'

export default defineConfig({
  plugins: [
    react(),
    prismDesign()
  ]
})
```

启动 `pnpm dev` 后，页面右下角会出现 PrismDesign 悬浮按钮。点击展开聊天面板，描述你想要的 UI 修改，AI 会直接修改源码并自动刷新页面。

## 配置选项

```ts
prismDesign({
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

  // Agent 服务端口（默认 9527，被占用时自动递增）
  agentPort: 9527,

  // 是否自动启动 Agent（默认 true）
  // 设为 false 则需要手动运行 Agent
  agentAutoStart: true,

  // 直接指定已运行的 Agent URL（跳过自动启动）
  // 适用于 Agent 在远程服务器或 Docker 容器中运行的场景
  agentUrl: 'http://localhost:9527',

  // ── Widget 配置 ──

  // 悬浮按钮位置（默认 "bottom-right"）
  position: 'bottom-right',  // 'bottom-right' | 'bottom-left'

  // 语言（默认根据浏览器语言自动检测）
  locale: 'zh',  // 'zh' | 'en'
})
```

## 使用场景

### Codex CLI 登录（推荐用于本机开发）

```bash
codex login
```

```ts
prismDesign({ agentType: 'codex' })
```

Codex 会复用本机 ChatGPT 登录态。受限网络下默认使用 HTTPS/SSE；如需 WebSocket：

```bash
HTTP_PROXY=http://127.0.0.1:7893 \
HTTPS_PROXY=http://127.0.0.1:7893 \
NO_PROXY=127.0.0.1,localhost \
CODEX_TRANSPORT=websocket \
pnpm dev
```

### OpenAI Agents SDK

```bash
OPENAI_API_KEY=sk-xxx pnpm dev
```

```ts
prismDesign({ agentType: 'openai' })
```

### 基础用法（使用 .env 配置 API Key）

最简单的方式，API Key 放在项目 `.env` 文件中：

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

```ts
// vite.config.ts
prismDesign()
```

Agent 启动时会自动读取 `.env` 文件中的环境变量。

### 使用 LiteLLM 代理

```ts
prismDesign({
  apiKey: 'sk-your-key',
  baseUrl: 'https://your-litellm-proxy.com/v1',
  model: 'gpt-4o',
})
```

### 使用智谱 GLM

```ts
prismDesign({
  agentType: 'glm',
  apiKey: 'your-zhipu-api-key',
})
```

### 连接远程 / Docker Agent

如果 Agent 运行在远程服务器或 PrismDesign Platform 容器中：

```ts
prismDesign({
  agentAutoStart: false,
  agentUrl: 'https://your-platform.com/api/workspaces/abc123/agent',
})
```

### 手动管理 Agent

如果你想自己启动 Agent 进程：

```ts
prismDesign({
  agentAutoStart: false,
})
```

然后手动运行：

```bash
npx prism-design-agent start --port 9527
```

Widget 会显示连接表单，输入 Agent 地址后连接。

## Widget 功能

### 聊天

在聊天面板中描述你想要的 UI 修改，例如：

- "把标题颜色改成蓝色"
- "导航栏增加一个用户头像"
- "这个按钮改成圆角样式"

AI 会直接修改源码，修改完成后页面自动刷新。

### 评论标注

点击聊天输入框左侧的评论按钮，进入元素选择模式：

1. 鼠标移动高亮页面元素
2. 点击选中元素，弹出评论输入框
3. 输入评论后确认，评论会作为上下文附在下一条消息中
4. 支持重选元素（在评论框打开时点击其他元素）

评论功能会自动检测 React / Vue 组件信息和源文件位置，帮助 AI 精准定位代码。

### 移动端适配

在移动设备上（viewport < 640px），面板以底部弹窗形式展示，支持滑入/滑出动画。

## 工作原理

```
┌─────────────────────────────────────────────┐
│  Vite Dev Server                            │
│  ┌───────────────────────────────────────┐  │
│  │  vite-plugin                          │  │
│  │  ├─ transformIndexHtml: 注入 widget   │  │
│  │  ├─ configureServer: 启动 agent       │  │
│  │  └─ middleware: 服务 widget.js        │  │
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

## 项目指令

在项目根目录创建 `CLAUDE.md` 文件可以给 AI 提供项目上下文，例如：

```markdown
# CLAUDE.md

## 项目信息
- 框架：React 19 + TypeScript
- 样式：Tailwind CSS v4
- UI 组件库：shadcn/ui

## 编码规范
- 使用函数组件 + Hooks
- 样式使用 Tailwind 工具类
- 组件放在 src/components/ 目录

## 工作规则
- 只做 UI 层面的修改
- 优先使用已有的组件库组件
```

Claude Provider 会读取该文件；Codex Provider 使用 Codex CLI 的标准项目指令机制。

## 注意事项

- 仅在 `vite dev`（开发模式）下生效，`vite build` 时自动跳过
- Agent 进程随 Vite Dev Server 一起启动和关闭
- Widget 使用 Shadow DOM 隔离样式，不会影响你的页面
- API Key 建议放在 `.env` 文件中，不要提交到代码仓库

## 兼容性

- Vite 5+
- React / Vue / Svelte / 任何 Vite 支持的框架
- 现代浏览器（Chrome, Firefox, Safari, Edge）

> **Next.js 用户**：Next.js 使用 Webpack/Turbopack，不支持 Vite 插件，请使用 `next-plugin-prism-design`。

## 发布检查

```bash
pnpm --filter vite-plugin-prism-design build
pnpm --filter demo dev
```

确认 widget 注入、Agent 自动启动、同源 HTTP/WebSocket 代理、聊天流式更新和 HMR 源码修改均正常。
