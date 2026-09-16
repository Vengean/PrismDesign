# @prism-studio-ai/vite-plugin

[English](./README.md) | 简体中文

Prism Studio 的 Vite 插件 —— 一行配置，为你的 React / Vue / Svelte 项目接入 AI 可视化编辑能力。

该插件用于自动启动 Agent，并按需把 Prism Studio Widget 注入开发页面。需要自动化浏览器测试、结构化测试证据和测试后修复流程时，更推荐使用 Prism Studio Chrome Extension，并将 `widget` 设置为 `false`。

## 功能

- 开发模式自动注入 Prism Studio Widget（悬浮聊天面板）
- 自动启动 AI Agent 服务，无需手动管理
- Agent 端口被占用时自动递增
- 生产构建自动跳过，零影响
- 支持 Claude Agent SDK、OpenAI Agents SDK、Codex SDK 和 GLM/ACP

## 安装

```bash
pnpm add -D @prism-studio-ai/vite-plugin
```

## 快速开始

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import prismStudio from '@prism-studio-ai/vite-plugin'

export default defineConfig({
  plugins: [
    react(),
    prismStudio()
  ]
})
```

启动 `pnpm dev` 后，页面右下角会出现 Prism Studio 悬浮按钮。点击展开聊天面板，描述你想要的 UI 修改，AI 会直接修改源码并自动刷新页面。

## 配置选项

Vite 插件只负责 Agent 的启动和 Widget 接入。Provider、模型、凭据、代理及权限统一在项目根目录的 `prism.config.ts` 中配置。

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `agentPort` | `number` | `9527` | 自动启动 Agent 时使用的首选端口；被占用时自动递增 |
| `agentAutoStart` | `boolean` | `true` | 是否随 Vite Dev Server 自动启动 Agent |
| `agentUrl` | `string` | 未设置 | 连接已有 Agent；设置后不会自动启动新 Agent |
| `widget` | `boolean` | `true` | 是否向页面注入 Widget；只使用 Chrome Extension 时设为 `false` |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Widget 悬浮按钮和面板位置 |
| `locale` | `"zh" \| "en"` | 浏览器语言 | Widget 界面语言 |

```ts
prismStudio({
  // Agent 服务端口（默认 9527，被占用时自动递增）
  agentPort: 9527,

  // 是否自动启动 Agent（默认 true）
  // 设为 false 则需要手动运行 Agent
  agentAutoStart: true,

  // 直接指定已运行的 Agent URL（跳过自动启动）
  // 适用于 Agent 在远程服务器或 Docker 容器中运行的场景
  agentUrl: 'http://localhost:9527',

  // ── Widget 配置 ──

  // 是否向页面注入 Widget（默认 true）
  // 使用 Chrome 扩展作为唯一交互入口时设为 false；Agent 仍会自动启动
  widget: false,

  // 悬浮按钮位置（默认 "bottom-right"）
  position: 'bottom-right',  // 'bottom-right' | 'bottom-left'

  // 语言（默认根据浏览器语言自动检测）
  locale: 'zh',  // 'zh' | 'en'
})
```

### 仅使用 Chrome 扩展

```ts
prismStudio({
  widget: false,
})
```

启动 Vite 后，插件仍会启动 Agent，但不会修改页面 HTML。打开目标页面后，通过 Prism Studio Chrome 扩展连接 `http://localhost:9527`。

## 使用场景

### 配置 Agent

在项目根目录创建 `prism.config.ts`。完整字段及权限说明见 `@prism-studio-ai/agent` 文档；Vite 配置中不再重复 Agent 参数。

### 连接远程 / Docker Agent

如果 Agent 运行在远程服务器或 Prism Studio Platform 容器中：

```ts
prismStudio({
  agentAutoStart: false,
  agentUrl: 'https://your-platform.com/api/workspaces/abc123/agent',
})
```

### 手动管理 Agent

如果你想自己启动 Agent 进程：

```ts
prismStudio({
  agentAutoStart: false,
})
```

然后手动运行：

```bash
npx @prism-studio-ai/agent start --port 9527
```

Widget 会显示连接表单，输入 Agent 地址和启动时输出的连接 Token 后连接。

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
- Agent 配置统一放在 `prism.config.ts`；密钥如需通过环境变量注入，不要提交到代码仓库

## 兼容性

- Vite 5+
- React / Vue / Svelte / 任何 Vite 支持的框架
- 现代浏览器（Chrome, Firefox, Safari, Edge）

> **Next.js 用户**：Next.js 使用 Webpack/Turbopack，不支持 Vite 插件，请使用 `@prism-studio-ai/next-plugin`。

## 发布检查

```bash
pnpm --filter @prism-studio-ai/vite-plugin build
pnpm --filter demo dev
```

确认 widget 注入、Agent 自动启动、同源 HTTP/WebSocket 代理、聊天流式更新和 HMR 源码修改均正常。
