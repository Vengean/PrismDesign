# PrismDesign 多仓库支持方案

> 状态：草案，待讨论

## 背景

当前 PrismDesign agent 只能修改本地前端代码。实际场景中需要同时修改前端和后端（Java Spring Boot，独立 GitLab 仓库），改完代码后 push 触发 CI/CD 构建部署，用户到部署环境看效果。

目标：先内部团队使用，后续做成 SaaS 平台。

## 核心思路

Workspace 模式：创建工作空间，把前后端仓库都 clone 下来，agent 的 cwd 设为 workspace 根目录，直接操作所有仓库代码。agent 自己用 Bash 执行 git 提交推送。

```
~/.prism-design/workspaces/<workspace-id>/
├── frontend/     ← clone 的前端仓库
├── backend/      ← clone 的后端仓库
└── CLAUDE.md     ← workspace 级说明（描述各仓库关系、技术栈、接口规范等）

用户在浏览器操作
  → Chrome 插件 / Serve Widget
  → POST /api/chat { message }
  → Agent Server
  → createSession({ cwd: workspace 根目录 })
  → agent 读写两个仓库的代码
  → agent 自己执行 git add / commit / push
  → CI/CD 自动构建部署
  → 用户到部署环境看效果
```

## 关键技术点

### 1. Workspace 管理

新增 `workspace-manager.ts` 模块：
- `initWorkspace(config)` — 根据配置创建 workspace 目录，clone 或 pull 各仓库
- `getWorkspacePath(workspaceId)` — 返回 workspace 根目录
- clone 使用 `--depth 1 --single-branch` 加速

workspace 内自动生成 `CLAUDE.md`，描述各仓库信息：
```markdown
# Workspace

## 仓库列表
- frontend/ — React + TypeScript 前端项目
- backend/ — Java Spring Boot 后端项目

## 提交规范
修改完代码后，进入对应仓库目录执行 git add、commit、push。
```

### 2. Agent 配置

agent 的 `cwd` 设为 workspace 根目录，`allowedTools` 包含 `Bash`（agent 需要执行 git 命令）：

```typescript
createSession({
  cwd: workspacePath,
  allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  settingSources: ["project"],  // 读取 workspace 下的 CLAUDE.md
  ...
});
```

server 端不做任何 git 操作和改动检测，全部由 agent 自主完成。

### 3. CI/CD 状态（可选）

Push 后可轮询 GitLab API 获取 Pipeline 状态，通过 WebSocket 推送给客户端。非核心功能，可后续再做。

## 配置设计

扩展 `prism.config.ts`：

```typescript
import { defineConfig } from "prism-design-agent/config";

export default defineConfig({
  anthropicApiKey: "sk-ant-xxx",
  workspace: {
    repos: [
      {
        name: "frontend",
        url: "https://gitlab.internal.com/team/frontend-web.git",
        branch: "develop",
      },
      {
        name: "backend",
        url: "https://gitlab.internal.com/team/backend-api.git",
        branch: "develop",
      }
    ],
    gitAccessToken: process.env.GITLAB_TOKEN,
  }
});
```

`WorkspaceConfig` 接口：

```typescript
interface RepoConfig {
  name: string;         // 目录名，如 "frontend"、"backend"
  url: string;          // Git clone URL
  branch?: string;      // 分支，默认 main
}

interface WorkspaceConfig {
  repos: RepoConfig[];
  gitAccessToken?: string;    // Git PAT，用于 clone 和 push
  localPath?: string;         // workspace 根目录，默认 ~/.prism-design/workspaces/<auto-id>
}
```

## 实现分期

### Phase 1: 配置 + Workspace 管理
- 扩展 `PrismConfig` 增加 `workspace` 字段
- 新建 `workspace-manager.ts`（创建目录、clone、pull、生成 CLAUDE.md）
- `cli.ts` 启动时初始化 workspace
- agent `cwd` 改为 workspace 根目录
- `allowedTools` 默认加入 `Bash`
- 不需要迁移 SDK API，保持 `unstable_v2_createSession` 不变

### Phase 2: 服务端集成
- `server.ts` 新增 `GET /api/workspace` 端点（返回 workspace 信息）
- 新增 `POST /api/workspace/sync` 端点（手动触发 git pull 更新）

### Phase 3: CI 状态监控（可选）
- 新建 `ci-monitor.ts`，push 后轮询 GitLab CI API
- 通过 WebSocket 广播构建状态

### Phase 4: 客户端 UI（可选）
- 显示 workspace 仓库列表
- 显示构建状态指示器

## 用户配置示例

```typescript
// prism.config.ts
import { defineConfig } from "prism-design-agent/config";

export default defineConfig({
  anthropicApiKey: "sk-ant-xxx",
  workspace: {
    repos: [
      {
        name: "frontend",
        url: "https://gitlab.internal.com/team/frontend-web.git",
        branch: "develop",
      },
      {
        name: "backend",
        url: "https://gitlab.internal.com/team/backend-api.git",
        branch: "develop",
      }
    ],
    gitAccessToken: process.env.GITLAB_TOKEN,
  }
});
```

## 风险和应对

| 风险 | 应对 |
|------|------|
| 仓库大，clone 慢 | shallow clone + single-branch |
| push 时远程有新提交导致冲突 | agent 先 pull --rebase 再 push；失败则回复用户说明 |
| GitLab PAT 安全性 | 支持环境变量引用；SaaS 阶段迁移到 OAuth + secrets manager |
| agent 误操作 | workspace 级 CLAUDE.md 约束行为边界 |

## SaaS 扩展路径

- `workspace` 配置从文件改为数据库存储（per-tenant）
- workspace 隔离：`/data/tenants/<tenantId>/workspaces/<workspaceId>/`
- GitLab PAT 改为 OAuth + secrets manager
- CI 轮询改为 GitLab/GitHub Webhook 推送
- 加用户认证和多租户隔离

## 待讨论问题

1. workspace 的 CLAUDE.md 怎么写？需要描述哪些内容（项目架构、接口规范、代码风格）？
2. commit message 格式有没有团队规范？agent 自动生成还是用固定模板？
3. 是否需要支持多个后端仓库（微服务场景）？
4. push 到哪个分支？develop？还是每次创建特性分支？
5. SaaS 阶段的计费模型：按 token 用量？按项目数？按用户数？
