# Prism Studio

[English](./README.md) | 简体中文

Prism Studio 将运行中的 Web 页面、源码工程与 AI 编程 Agent 连接起来。产品、设计、开发和测试人员可以用自然语言描述需求，添加元素级评论，可视化调整页面，并在真实浏览器中验证结果；所有持久化修改最终仍落在源码和版本控制中。

## 核心能力

- **Chrome 扩展**：推荐的交互入口，支持 AI 对话、元素评论、可视化编辑、真实浏览器自动化、测试证据和测试驱动修复。
- **Agent**：运行在本地工程中的服务，连接 Claude、Codex、OpenAI Agents SDK 或 GLM，并在授权范围内修改源码。
- **Widget**：不方便安装浏览器扩展时的嵌入式替代方案，支持对话和评论，但不提供 Chrome 扩展的自动化浏览器测试。
- **Vite 与 Next.js 集成**：随开发服务器启动 Agent，并可选择向页面注入 Widget。
- **UI Studio**：用于开发和评审共享插件 UI、主题与各种交互状态的内部可视化工作区。

## 工作方式

```text
Chrome 扩展或 Widget
          │
          │ HTTP + WebSocket
          ▼
   Prism Studio Agent
          │
          ├── Claude
          ├── Codex
          ├── OpenAI Agents SDK
          └── GLM / ACP
          │
          ▼
       源码工程
```

浏览器客户端负责提供页面和元素上下文；Agent 负责 Provider 会话、权限、取消运行、工具执行、源码修改和结构化进度事件。Chrome 扩展还能通过 Chrome DevTools Protocol 操作当前标签页，完成真实浏览器验证。

## 快速开始

### 1. 启动 Agent

在需要 Prism Studio 修改的项目根目录执行：

```bash
npx @prism-studio-ai/agent start --provider codex
```

Codex Provider 会复用本机已有的 Codex 登录状态：

```bash
codex login
```

也可以使用 API Provider：

```bash
ANTHROPIC_API_KEY=sk-ant-xxx \
  npx @prism-studio-ai/agent start --provider claude

OPENAI_API_KEY=sk-xxx \
  npx @prism-studio-ai/agent start --provider openai
```

默认地址为 `http://127.0.0.1:9527`。终端会输出浏览器客户端连接时需要的访问 Token。

需要持久化 Provider、模型、权限、代理、浏览器和 MCP 设置时，在目标项目根目录创建 `prism.config.ts`。完整配置见 [Agent 中文文档](./packages/agent/README.zh-CN.md)。

### 2. 选择交互入口

#### Chrome 扩展（推荐）

可以从 [`release/`](./release/) 获取当前开发版本，也可以本地构建：

```bash
pnpm install
pnpm build:chrome-ext
```

打开 `chrome://extensions`，开启「开发者模式」，点击「加载已解压的扩展程序」，选择 `packages/chrome-ext/dist`。随后打开侧边栏，填写 Agent 地址和访问 Token。

评论、可视化编辑、权限、自动化测试和验证流程详见 [Chrome 扩展文档](./packages/chrome-ext/README.md)。

#### Vite

```bash
pnpm add -D @prism-studio-ai/vite-plugin
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import prismStudio from "@prism-studio-ai/vite-plugin";

export default defineConfig({
  plugins: [prismStudio()],
});
```

如果只使用 Chrome 扩展，可设置 `prismStudio({ widget: false })`。更多信息见 [Vite 插件中文文档](./packages/vite-plugin/README.zh-CN.md)。

#### Next.js

```bash
pnpm add -D @prism-studio-ai/next-plugin
```

```ts
// next.config.ts
import { withPrismStudio } from "@prism-studio-ai/next-plugin";

export default withPrismStudio()({});
```

使用 Turbopack 的 Next.js 16 项目还需要在根布局中加入插件导出的 React 组件。详见 [Next.js 插件中文文档](./packages/next-plugin/README.zh-CN.md)。

## 包列表

| 包 | 用途 | 文档 |
|---|---|---|
| `@prism-studio-ai/agent` | 本地 AI Agent 与浏览器验证服务 | [English](./packages/agent/README.md) · [中文](./packages/agent/README.zh-CN.md) |
| `@prism-studio-ai/widget` | 框架无关的页面内对话和评论 UI | [English](./packages/widget/README.md) · [中文](./packages/widget/README.zh-CN.md) |
| `@prism-studio-ai/vite-plugin` | Vite 开发环境集成 | [English](./packages/vite-plugin/README.md) · [中文](./packages/vite-plugin/README.zh-CN.md) |
| `@prism-studio-ai/next-plugin` | Next.js 开发环境集成 | [English](./packages/next-plugin/README.md) · [中文](./packages/next-plugin/README.zh-CN.md) |
| `@prism-studio-ai/chrome-ext` | Chrome 侧边栏客户端与浏览器自动化 | [文档](./packages/chrome-ext/README.md) |

## 仓库开发

环境要求：

- Node.js 18 或更高版本
- pnpm 9 或更高版本；仓库通过 `packageManager` 固定推荐版本

```bash
pnpm install

# Vite 示例
pnpm dev

# Next.js 示例
pnpm dev:next

# UI Studio 及其本地 Agent
pnpm dev:ui

# 构建全部 workspace 包
pnpm build
```

常用单独构建命令：

```bash
pnpm build:agent
pnpm build:widget
pnpm build:chrome-ext
```

## 安全建议

- Provider API Key 只能放在 Agent 进程中，不要写入浏览器代码。
- Agent 访问 Token 在开发会话期间应按密钥管理。
- 将源码写入权限限制在明确的目标项目目录内。
- 未启用认证和适当 CORS 限制时，不要把 Agent 暴露到局域网或公网。
- 提交、发布或部署前，始终审查 Agent 生成的代码修改。

