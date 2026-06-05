# CLAUDE.md — PrismDesign

> AI 驱动的可视化 UI 编辑工具：设计师在浏览器中编辑页面样式，AI 自动同步修改到源码。

## 快速启动

```bash
pnpm dev          # 同时启动 demo(5173) + agent(3200)
pnpm dev:demo     # 仅 demo
pnpm dev:agent    # 仅 agent
pnpm build:chrome-ext  # 构建 Chrome 插件 → packages/chrome-ext/dist/
pnpm build:serve       # 构建 Serve 包 → packages/serve/dist/
```

Chrome 插件加载：`chrome://extensions` → 开发者模式 → 加载 `packages/chrome-ext/dist/`

Serve 独立部署（不依赖 Chrome 插件）：
```bash
cd packages/serve && pnpm build
prism-design-serve --dir /path/to/static --open  # 全局安装后使用
# 或开发模式：cd packages/serve && pnpm dev
```

## 项目结构

```
PrismDesign/                    ← pnpm monorepo
├── packages/
│   ├── agent/                  ← AI 代码修改服务 (Express + WebSocket + Claude Agent SDK)
│   │   └── src/
│   │       ├── cli.ts          ← CLI 入口，.env 加载，项目根检测
│   │       ├── server.ts       ← HTTP + WS 服务器
│   │       ├── agent.ts        ← 多用户 session 管理（Claude Agent SDK v2）
│   │       ├── project-profiler.ts ← 框架/语言/构建工具检测
│   │       └── prompt-builder.ts   ← AI system prompt 构建
│   ├── serve/                  ← 独立部署工具 (静态文件服务 + 内嵌 Widget)
│   │   └── src/
│   │       ├── cli.ts          ← CLI 入口，启动 agent 子进程 + HTTP 服务
│   │       ├── server.ts       ← Express 静态文件服务 + HTML 注入
│   │       └── widget/         ← 内嵌 Widget (IIFE 单文件，vConsole 风格)
│   │           ├── index.ts    ← Shadow DOM 入口 + 浮动按钮
│   │           ├── panel.ts    ← 可展开面板 (对话/评论 tabs)
│   │           ├── chat.ts     ← 对话功能
│   │           └── comment.ts  ← 评论标注功能
│   └── chrome-ext/             ← Chrome 插件 (Manifest V3)
│       └── src/
│           ├── content/        ← Content Script（注入目标页面）
│           │   ├── index.ts    ← 设计模式生命周期
│           │   ├── inspector.ts ← 元素检测 + React/Vue 组件识别
│           │   ├── editor.ts   ← 样式修改记录 + 拖拽
│           │   ├── overlay.ts  ← 高亮 + 选中框
│           │   ├── toolbar.ts  ← 浮动工具栏
│           │   ├── dom-tree.ts ← DOM 树序列化
│           │   └── keyboard.ts ← 快捷键
│           ├── sidepanel/      ← Side Panel React 应用
│           │   ├── App.tsx     ← 主组件
│           │   ├── components/ ← ChatPanel, Navigator, PropertiesPanel, ChangesPanel
│           │   ├── hooks/      ← use-agent, use-chat, use-changes, use-element 等
│           │   └── components/ui/ ← Radix UI + CVA 封装
│           ├── background/     ← Service Worker（消息路由 + Agent 连接）
│           └── shared/         ← 类型定义 + 消息协议 + i18n
├── demo/                       ← 测试用 React 应用 (shadcn/ui + Tailwind v4)
└── pnpm-workspace.yaml
```

## 技术栈

| 层 | 技术 |
|---|---|
| AI | `@anthropic-ai/claude-agent-sdk` v0.2.118 (`unstable_v2_createSession`) |
| Agent 后端 | Express 4 + ws 8 + tsx（开发） + tsup（构建） |
| Chrome 插件 UI | React 19 + Tailwind v4 + Radix UI + CVA |
| 插件构建 | Vite 8 多入口（content.js / page-bridge.js / sidepanel.html / background.js） |
| Demo | React 19 + Vite 8 + Tailwind v4 + shadcn/ui |
| 语言 | TypeScript（strict mode），ES modules |
| 包管理 | pnpm 9+，Node 18+ |

## 编码规范

### 命名

- **组件文件/类型/接口**：PascalCase（`ChatPanel.tsx`, `ElementSelection`）
- **工具/hooks 文件**：kebab-case（`use-agent.ts`, `dom-tree.ts`）
- **Hooks**：`use-` 前缀
- **Props 类型**：`XxxProps` 后缀
- **常量/消息类型**：UPPER_SNAKE_CASE（`DESIGN_MODE_ON`, `SESSION_TIMEOUT`）

### 代码风格

- 函数组件 + Hooks，不用 class 组件
- Props 解构传参
- 状态管理通过自定义 hooks，无全局 store
- 样式：Tailwind 工具类 + `cn()` helper（clsx + tailwind-merge）
- 组件变体：CVA（class-variance-authority）
- 导入路径：sidepanel 用 `@/` 别名指向 `./src/sidepanel/`

### TypeScript

- 全局 strict mode
- 不需要 `import React`（react-jsx transform）
- demo 开启 `noUnusedLocals` / `noUnusedParameters`

## 架构要点

### 消息流

```
Side Panel ←→ Background Service Worker ←→ Content Script
                    ↕
              Agent Server (WebSocket)
```

- **Downstream**（→ Content Script）：`DESIGN_MODE_ON/OFF`, `APPLY_STYLE_PREVIEW`, `CLEAR_STYLE_PREVIEW`
- **Upstream**（→ Side Panel）：`ELEMENT_SELECTED`, `STYLE_CHANGED`, `DOM_TREE_UPDATED`
- **Agent 事件**（→ Side Panel）：`AGENT_STATUS`, `AGENT_WORKING`, `AGENT_ERROR`

### Agent Session 管理

- 每个 clientId 独立 session，30 分钟超时清理
- 首条消息包含 system prompt（项目框架 + 编码规范），后续消息只发用户内容
- API：`/api/status`、`/api/apply-changes`、`/api/chat`、`/api/rollback`
- WebSocket `/ws` 推送实时事件

### 组件检测

- React：通过 `__reactFiber$` 读取 fiber 链（组件名、props、源文件、行号）
- Vue：通过 `__vueParentComponent` 或 `__vue__`
- 检测代码运行在 `page-bridge.ts`（MAIN world）

### Chrome 插件多入口构建

Vite 配置包含自定义插件 `fix-chrome-ext-paths`，用于修正构建后的路径：
- 将 `sidepanel.html` 移动到 dist 根目录
- 修正资源引用的相对路径

## 环境变量

```bash
# packages/agent/.env
ANTHROPIC_API_KEY=sk-ant-...     # 必需
ANTHROPIC_MODEL=claude-opus-4-6  # 可选，默认 claude-opus-4-6
ANTHROPIC_BASE_URL=...           # 可选，API 代理
```

## 国际化

- 自实现轻量 i18n（`shared/i18n.ts`），非第三方库
- 支持中文 (zh) 和英文 (en)，根据浏览器语言自动选择
- Chrome 插件 manifest i18n：`public/_locales/{en,zh_CN}/messages.json`

## 注意事项

- 没有测试框架，修改后通过手动测试验证
- Chrome 插件修改后需要 `pnpm build:chrome-ext` 重新构建并在 chrome://extensions 刷新
- Content Script 开发时 `pnpm dev`（watch 模式）会自动重建，但仍需刷新插件
- `.design-agent-profile.json` 是 agent 自动生成的项目分析缓存，已 gitignore
- demo 中仍保留 antd 依赖，但主要使用 shadcn/ui 组件
