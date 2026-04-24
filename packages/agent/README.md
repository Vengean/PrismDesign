# PrismDesign Agent

PrismDesign 的本地 AI Agent 服务。接收来自 Chrome 插件的设计修改，调用 Claude AI 理解变更意图，自动修改项目源码。

## 安装

```bash
# 在项目根目录
pnpm install

# 构建
pnpm build:agent
# 或
cd packages/agent && npm run build
```

## 启动

### 开发模式

```bash
cd packages/agent
npm run dev
```

### 生产模式

```bash
cd packages/agent
npm run start
```

### CLI 参数

```bash
prism-design start [options]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--port <number>` | 服务端口 | `9527` |
| `--project <path>` | 项目根目录 | 当前目录 |
| `--api-key <key>` | Anthropic API Key | 读取 `ANTHROPIC_API_KEY` 环境变量 |
| `--skip-analysis` | 跳过 AI 代码风格分析（加快启动） | `false` |

### 环境变量

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## 启动流程

1. **扫描项目** — 自动检测框架、语言、样式方案、组件库、构建工具
2. **分析代码风格**（可选）— 调用 Claude Haiku 分析 5 个示例组件的编码习惯
3. **构建 System Prompt** — 根据项目特征生成 AI 指令
4. **启动 HTTP/WebSocket 服务** — 监听 `0.0.0.0:<port>`

启动后输出：

```
🎨 PrismDesign Agent 准备就绪
   Agent 服务: http://192.168.1.100:9527
   项目目录:   /path/to/your/project
```

## 项目检测

Agent 自动识别以下项目特征：

| 类别 | 支持的选项 |
|------|-----------|
| 框架 | React, Vue, Next.js, Nuxt |
| 语言 | TypeScript, JavaScript |
| 样式 | Tailwind CSS, styled-components, Emotion, SCSS, CSS Modules, 原生 CSS |
| 组件库 | Ant Design, Element Plus, Material UI, Arco Design 等 |
| 构建 | Vite, Webpack, Turbopack |

检测结果缓存在项目根目录的 `.design-agent-profile.json`。

## API 接口

### 状态检查

```
GET /api/status
```

```json
{
  "status": "running",
  "project": {
    "framework": "react",
    "styling": ["tailwind"],
    "componentLib": ["antd"]
  }
}
```

### 应用设计修改

```
POST /api/apply-changes
Content-Type: application/json
```

```json
{
  "changes": [
    {
      "selector": "div.card > h2.title",
      "property": "font-size",
      "oldValue": "16px",
      "newValue": "20px"
    }
  ],
  "sourceFile": "src/components/Card.tsx",
  "sourceLine": 15,
  "componentName": "Card",
  "supplement": "同时应用到 MobileCard 组件"
}
```

```json
{
  "success": true,
  "message": "已修改 font-size",
  "filesModified": ["src/components/Card.tsx", "src/components/MobileCard.tsx"]
}
```

### 自然语言编辑

```
POST /api/chat
Content-Type: application/json
```

```json
{
  "message": "把所有卡片的圆角改成 12px",
  "context": {
    "pagePath": "/dashboard",
    "components": [
      { "name": "Card", "sourceFile": "src/components/Card.tsx", "sourceLine": 8 }
    ]
  }
}
```

### 回退修改

```
POST /api/rollback
```

Agent 在每次修改前自动执行 `git stash`，回退时 `git stash pop` 恢复。

### 获取源码上下文

```
GET /api/source?file=src/components/Card.tsx&line=15
```

```json
{
  "success": true,
  "file": "src/components/Card.tsx",
  "content": "...",
  "startLine": 5,
  "totalLines": 80
}
```

### Git 状态

```
GET /api/git-status
```

## WebSocket

```
ws://<agent-url>/ws
```

Agent 通过 WebSocket 推送实时状态：

| 事件类型 | 说明 |
|---------|------|
| `agent:start` | AI 开始处理修改 |
| `agent:done` | 修改完成，源码已更新 |
| `agent:error` | 修改失败 |
| `agent:rollback` | 已回退 |

消息格式：

```json
{ "type": "agent:done", "data": { "filesModified": ["src/Card.tsx"] } }
```

## AI Agent 能力

Agent 调用 Claude（claude-sonnet-4-6）处理修改，Claude 可使用以下工具：

| 工具 | 说明 |
|------|------|
| `read_file` | 读取项目文件 |
| `write_file` | 写入/修改项目文件 |
| `search_code` | 使用正则搜索代码（基于 ripgrep） |
| `list_files` | 列出目录下的文件 |

AI 会根据项目的框架和样式方案选择正确的修改方式：
- Tailwind 项目 → 修改 className
- CSS Modules → 修改对应的 `.module.css` 文件
- styled-components → 修改模板字符串
- 原生 CSS → 修改对应的 CSS 文件

## Git 安全机制

- 每次修改前自动 `git stash`（标签：`before-design-edit`）
- 支持一键回退到修改前状态
- 不会修改业务逻辑、API 调用、状态管理等代码

## 架构

```
Chrome 插件 ──HTTP/WS──► Agent Server (Express)
                              │
                              ├── Project Profiler (项目扫描)
                              ├── Convention Analyzer (风格分析)
                              ├── Prompt Builder (指令构建)
                              ├── Agent Loop (Claude AI 调用)
                              │     └── Tools: read/write/search/list
                              └── Git Safety (备份/回退)
```
