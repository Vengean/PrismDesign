# @prism-studio-ai/widget

[English](./README.md) | 简体中文

Prism Studio Widget 是 Prism Studio Chrome Extension 的轻量替代方案。它可以直接嵌入前端项目，在页面内提供 AI 对话和页面元素批注能力，并与 `@prism-studio-ai/agent` 通信。

更推荐使用 Prism Studio Chrome Extension。Chrome Extension 无需向业务应用注入交互界面，并支持自动化浏览器测试、结构化测试证据和根据测试结果继续修复的完整流程。当开发环境不方便安装 Chrome Extension，或者希望把可视化编辑入口直接放进页面时，可以使用 Widget。

## 安装

```bash
pnpm add @prism-studio-ai/widget
```

需要自动化测试时，建议优先使用 Prism Studio Chrome Extension。如果确定使用页面内 Widget，Vite 或 Next.js 项目可以安装对应的框架插件，由框架插件自动加载 Widget，无需手动引入这个包。

## 直接使用

```html
<script src="/path/to/prism-studio-widget.iife.js"></script>
<script>
  PrismStudioWidget.init({
    agentUrl: "http://127.0.0.1:9527",
    agentToken: "Agent 启动时输出的 Token",
    accessTokenRequired: true,
    position: "bottom-right",
    locale: "zh"
  });
</script>
```

## 完整配置

| 配置 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `agentUrl` | `string` | 优先使用已保存的地址；连接表单初始值为 `http://localhost:9527` | Agent 的 HTTP 服务地址 |
| `agentToken` | `string` | 当前浏览器会话中保存的 Token；没有则为空 | Agent 启动时输出的连接凭证 |
| `accessTokenRequired` | `boolean` | `true` | 仅当 Agent 明确关闭 Token 鉴权时设置为 `false` |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | 悬浮按钮和面板的位置 |
| `locale` | `"zh" \| "en"` | 浏览器语言 | Widget 界面语言 |

只有以下两种情况会自动连接：

- 同时提供 `agentUrl` 和 `agentToken`。
- 提供 `agentUrl`，并明确设置 `accessTokenRequired: false`。

如果只提供 `agentUrl`，Widget 仍会显示连接表单，等待用户输入 Token，不会跳过身份验证。

`init()` 只会初始化一次，后续重复调用会被忽略。

### 连接未启用 Token 鉴权的 Agent

```js
PrismStudioWidget.init({
  agentUrl: "http://127.0.0.1:9527",
  accessTokenRequired: false,
});
```

Agent 可从局域网或公网访问时，不应关闭 Token 鉴权。

### 以 ES Module 方式使用

```ts
import { init } from "@prism-studio-ai/widget";

init({
  agentUrl: "http://127.0.0.1:9527",
  agentToken: "Agent 启动时输出的 Token",
  locale: "zh",
});
```

## Agent 协议

- `GET /api/status` 检查 Agent 是否可用以及支持哪些能力。
- `POST /api/chat` 使用稳定的 `x-client-id` 发送 `{ runId, message }`。
- `/ws?clientId=...` 接收 Protocol v2 事件，不同浏览器客户端之间按 `clientId` 隔离。
- `message.delta` 用于流式展示 Codex 或 OpenAI 的回复文本。
- 迁移期间仍兼容旧版 `agent:progress` 事件。
- 只有最终响应明确报告文件发生修改时，Widget 才会刷新页面。

客户端 ID、聊天记录和手动填写的 Agent 地址保存在 `localStorage`。访问 Token 保存在 `sessionStorage`，关闭当前浏览器会话后不会长期保留。清理站点存储后，Widget 会生成新的客户端 ID，并在 Agent 中建立新的对话会话。

## 安全建议

- 不要把模型服务的 API Key 放进 Widget 配置或任何浏览器端构建产物。
- `agentToken` 是连接 Prism Studio Agent 的临时访问凭证，不是模型服务的 API Key。
- Agent 应运行在可信开发网络中。
- Agent 可从本机之外访问时，应限制访问来源和网络暴露范围，并保持 Token 鉴权。

## 构建与发布

```bash
pnpm --filter @prism-studio-ai/widget build
```

npm 包包含 `dist` 目录中的 IIFE 构建、ES Module 构建、TypeScript 类型声明，以及中英文 README。
