# @prism-studio-ai/agent

[English](./README.md) | 简体中文

Prism Studio 的 AI Agent 服务。它接收受支持客户端发送的指令，通过 Claude、Codex、OpenAI Agents SDK 或 GLM 理解工程、修改源码并协调真实浏览器验证。

## 快速开始

在项目根目录运行：

```bash
npx @prism-studio-ai/agent start
```

使用 OpenAI Agents SDK：

```bash
export OPENAI_API_KEY=sk-xxx
npx @prism-studio-ai/agent start --provider openai
```

使用本机 Codex CLI 的 ChatGPT 登录态，无需 API Key：

```bash
codex login status
npx @prism-studio-ai/agent start --provider codex
```

## 安装

```bash
npm install -D @prism-studio-ai/agent
```

添加项目脚本：

```json
{
  "scripts": {
    "design": "prism-studio-agent start"
  }
}
```

## 配置入口

CLI 可以在没有配置文件时独立启动 Agent；持久配置、权限和高级行为统一写在项目根目录的 `prism.config.ts` 中。相同字段同时出现时，CLI 参数优先于配置文件。

Provider 的标准环境变量仍可用于 CI 和密钥注入，例如 `ANTHROPIC_API_KEY` 和 `OPENAI_API_KEY`。

### CLI 参数

```text
prism-studio-agent start [options]
```

| 参数 | `prism.config.ts` 字段 | 说明 | 默认值 |
|---|---|---|---|
| `--port <number>` | `port` | Agent 服务端口 | `9527` |
| `--project <path>` | `project` | 项目根目录 | 当前目录 |
| `--provider <name>` | `provider` | `claude`、`claude-sub`、`openai`、`codex` 或 `glm` | `claude` |
| `--api-key <key>` | `apiKey` | Provider API Key；Codex 登录模式不需要 | Provider 环境变量 |
| `--api-base-url <url>` | `apiBaseUrl` | Provider 兼容的 API 地址 | Provider 默认地址 |
| `--model <name>` | `model` | 覆盖 Provider 模型 | Provider 默认模型 |

无需配置文件的完整示例：

```bash
prism-studio-agent start \
  --project ./my-project \
  --port 9527 \
  --provider claude \
  --api-key sk-ant-xxx \
  --api-base-url https://example.com/v1 \
  --model claude-opus-4-6
```

### prism.config.ts

```ts
export default {
  port: 9527,
  project: "./",
  provider: "codex",
  model: "gpt-5.6-sol",
  // API Provider 也可以配置 apiKey 和 apiBaseUrl。
  // 如果配置文件会提交到代码仓库，密钥应通过环境变量注入。
  apiKey: process.env.PRISM_PROVIDER_API_KEY,
  apiBaseUrl: "https://your-provider.example.com/v1",
  accessTokenRequired: true,

  codexReasoningEffort: "high",
  codexTransport: "https",
  httpProxy: "http://127.0.0.1:7893",
  httpsProxy: "http://127.0.0.1:7893",
  noProxy: "127.0.0.1,localhost",
  debug: false,

  permissions: {
    filesystem: "workspace-write",
    commands: "none",
    network: false,
    browser: {
      enabled: true,
      headless: false,
      allowedOrigins: ["http://localhost:5173"],
    },
    mcp: {
      // 不写 enabled 时，只要存在 mcpServers 就会自动启用。
      defaultApproval: "prompt",
    },
  },

  mcpServers: {
    database: {
      command: "database-mcp",
      args: ["--stdio"],
      env: { DATABASE_URL: process.env.DATABASE_URL || "" },
      defaultToolsApprovalMode: "prompt",
    },
  },
};
```

也支持 `prism.config.js` 和 `prism.config.mjs`。

`apiKey`、`apiBaseUrl` 和 `model` 对所有 API Provider 使用同一套字段，Agent 会根据当前 `provider` 自动映射。

## 身份认证

| Provider | 认证方式 | 说明 |
|---|---|---|
| `codex` | `codex login` | 复用本机 ChatGPT/Codex 登录态，不需要 API Key |
| `openai` | `apiKey` 或 `OPENAI_API_KEY` | OpenAI Agents SDK，按 API 用量计费 |
| `claude` | `apiKey` 或 `ANTHROPIC_API_KEY` | Claude Agent SDK，按 API 用量计费 |
| `claude-sub` | 本机 Claude 订阅登录态 | 复用受支持的本地 Claude 会话 |
| `glm` | `apiKey` | 通过 ACP 适配器运行 |

## 权限配置

默认权限等价于：

```ts
permissions: {
  filesystem: "workspace-write",
  commands: "none",
  network: false,
  browser: {
    enabled: true,
    headless: false,
    allowedOrigins: [],
  },
  mcp: {
    enabled: false,
    defaultApproval: "prompt",
  },
}
```

权限含义：

- `filesystem: "read-only"`：Claude 和 OpenAI 不提供写入、编辑工具；Codex 使用只读沙箱。
- `filesystem: "workspace-write"`：允许修改项目工作区。
- `commands: "none"`：Claude 不提供 Bash；Codex 使用按需审批，未经批准的 Shell 命令不能运行。
- `commands: "workspace"`：允许 Provider 在工作区沙箱内执行命令。
- `network: false`：关闭 Codex 沙箱网络，并排除 Claude Web 工具；OpenAI Provider 没有通用网络工具。
- `browser.enabled: false`：移除浏览器工具，同时让 Agent 浏览器接口返回 `403`。
- `browser.headless`：控制验证浏览器是否无头运行，默认 `false`，方便开发者观察。
- `browser.allowedOrigins`：限制浏览器可以导航到的精确 Origin；空数组表示允许任意 HTTP/HTTPS Origin。
- `mcp.defaultApproval`：自定义 MCP 工具的默认审批策略，可选 `approve`、`prompt` 或 `deny`。

只要配置了 `mcpServers`，自定义 MCP 就会自动启用。需要临时禁止所有项目 MCP 时，显式设置：

```ts
permissions: {
  mcp: {
    enabled: false,
  },
}
```

Prism 内置的浏览器验证 MCP 不属于自定义 `mcpServers`，由 `permissions.browser.enabled` 单独控制。

GLM 的最终权限仍取决于 `glm-acp-agent`。只有同时允许工作区写入和命令执行时，Prism 才会请求 `bypass_permissions` 模式。严格环境建议额外使用独立系统账户或容器。

## 代理配置

```ts
export default {
  provider: "codex",
  codexTransport: "websocket",
  httpProxy: "http://127.0.0.1:7893",
  httpsProxy: "http://127.0.0.1:7893",
  noProxy: "127.0.0.1,localhost",
};
```

## 项目指令

Provider 原生的项目指令仍然有效：Claude 读取 `CLAUDE.md`；Codex 通过官方 CLI 读取其正常的项目配置和指令文件。

## 工作原理

1. 启动时识别框架、语言和构建工具。
2. 按客户端 ID 维护独立的多轮 Provider 会话。
3. 流式发送文本、工具进度和文件变更事件。
4. 通过 Protocol v2 提供状态查询、对话、取消、会话清理和结构化事件。

```text
客户端（Chrome 扩展或框架插件）
  → 组合消息与页面上下文
  → POST /api/chat { runId, message }
  → Claude / OpenAI / Codex / GLM Provider
  → 按 clientId + runId 隔离的 WebSocket 事件
  → { success, message, filesModified }
```

`GET /api/status` 返回 Provider、模型、协议版本和能力。WebSocket 客户端通过 `/ws?clientId=...` 连接。

## 调试

在 `prism.config.ts` 中启用完整输入日志：

```ts
export default {
  debug: true,
};
```

输入内容最多记录 8,000 个字符。消息可能包含敏感数据时不要启用。结构化事件日志可通过 `PRISM_AGENT_DEBUG_EVENTS=0` 关闭。

## 发布验证

```bash
pnpm --filter @prism-studio-ai/agent build
codex login status
prism-studio-agent start --provider codex --project ./your-app
curl http://127.0.0.1:9527/api/status
```

## 环境要求

- Node.js 18 或更高版本
- 一个前端项目
- 兼容客户端，例如 Prism Studio Chrome Extension

## License

MIT
