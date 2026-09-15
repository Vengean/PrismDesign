# Prism Studio Platform — 多工程 AI 代码修改平台

> 状态：草案，待确认

## Context

将 Prism Studio 从 CLI 工具升级为一个可部署的 Web 平台（内网使用）。用户通过浏览器 GUI 管理工程（workspace），配置 Git 仓库，启动容器化的开发环境（agent + dev server），通过 Chrome 插件连接 agent 指挥 AI 修改代码。Docker 部署，独立项目。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  Host Machine (macOS / Linux)                                │
│                                                              │
│  ┌────────────────────────────────────────┐                 │
│  │  Platform 容器 (常驻)                   │                 │
│  │  - Express API + React 管理后台         │                 │
│  │  - SQLite 数据库                        │                 │
│  │  - Workspace 生命周期管理               │                 │
│  │  - Docker Socket 挂载 (管理子容器)      │                 │
│  │  端口: 3000                             │                 │
│  └─────────────┬──────────────────────────┘                 │
│                │ docker API                                   │
│       ┌────────┼────────┐                                   │
│       ▼        ▼        ▼                                   │
│  ┌─────────┐┌─────────┐┌─────────┐                         │
│  │ WS 容器 ││ WS 容器 ││ WS 容器 │                         │
│  │ ws-abc  ││ ws-def  ││ ws-ghi  │                         │
│  │ :5173   ││ :5173   ││ :5173   │                         │
│  │ :9527   ││ :9527   ││ :9527   │                         │
│  └─────────┘└─────────┘└─────────┘                         │
│                                                              │
│  Docker Volumes (持久化)                                     │
│  ├── ws-abc/  (repos + CLAUDE.md + node_modules)            │
│  ├── ws-def/                                                 │
│  └── ws-ghi/                                                 │
└─────────────────────────────────────────────────────────────┘

用户操作流程：
  Platform GUI → 创建/管理 workspace
  Chrome 插件 → 连接 workspace 的 agent 地址 → 聊天修改代码
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express |
| 前端 | React + Tailwind v4 + shadcn/ui |
| 构建 | Vite（前端）+ tsup（后端） |
| 数据存储 | SQLite（bcrypt 存密码） |
| 容器管理 | dockerode |
| 部署 | Docker |
| Agent | `@anthropic-ai/claude-agent-sdk` |

## 页面结构

```
/login                      — 登录页
/dashboard                  — 工作空间列表（普通用户首页）
/workspace/:id              — 工作空间详情（文件浏览 + 服务状态）
/workspace/:id/settings     — 工作空间设置
/admin/users                — 用户管理（仅管理员）
/settings/password          — 修改密码（普通用户）
```

## 功能模块

### 1. 登录模块

- 用户名 + 密码登录
- 区分管理员和普通用户（role: "admin" | "user"）
- 登录后颁发 JWT token，后续请求通过 Authorization header 鉴权
- 首次部署时通过环境变量创建初始管理员账号

### 2. 用户管理（仅管理员）

**添加用户**：
- 输入用户 ID（登录名）
- 系统随机生成初始密码（8位，含大小写字母+数字）
- 创建成功后展示用户名和初始密码，支持一键复制
- 密码用 bcrypt hash 存储，创建后不可查看

**用户列表**：
- 展示用户 ID、角色、创建时间
- 操作：删除用户、重置密码（随机生成新密码，弹窗展示一次）
- 不展示密码明文

### 3. 修改密码（普通用户）

- 输入旧密码 + 新密码 + 确认新密码
- 验证旧密码正确后更新

### 4. 工作空间列表

**列表展示**：
- 工作空间名称
- 仓库数量
- 代码同步状态（未同步 / 同步中 / 已同步 / 同步失败）
- 运行状态（已停止 / 启动中 / 运行中 / 错误）
- 操作按钮：启动 / 停止 / 删除

**创建工作空间**（右上角按钮，进入表单页）：
- 工作空间名称（必填）
- Git Access Token（必填，用于 clone 私有仓库）
- 添加 Git 仓库（可添加多个）：
  - 仓库名称（目录名，如 "frontend"）
  - 仓库 URL
  - 默认分支
- CLAUDE.md 内容（可选，在线编辑器）
- 启动脚本（可选，bash 脚本内容，用于自定义启动流程）
- ☑ 创建后同步代码（勾选后创建完自动 clone 所有仓库）
- 创建后返回列表页

**启动流程**：
1. 点击"启动"按钮
2. 弹出启动选项弹窗：
   - 每个仓库选择分支（下拉列表 + "新建分支"选项）
   - 新建分支时输入分支名，基于当前选中分支创建
3. 确认后：
   - 切换各仓库到选定分支（如有变更）
   - 启动 Docker 容器（agent + 执行启动脚本）
   - 启动完成后展示：
     - 项目访问地址（dev server，如有）
     - Agent 地址（供 Chrome 插件连接）

### 5. 工作空间详情页

```
┌────────────────────────────────────────────────────────────┐
│  ← 返回列表  │  工程名称  │  ● 运行中  │  [停止] [设置]   │
├──────────────┬─────────────────────────┬───────────────────┤
│ 仓库 Tabs    │                         │ 服务状态           │
│ [frontend]   │  文件树浏览              │                   │
│ [backend]    │                         │ Agent: ● 运行中   │
├──────────────┤  📁 src/                │ 地址: :9527       │
│ 分支: dev ▾  │  📁 components/         │ [复制地址]         │
│              │  📄 App.tsx             │                   │
│ Git 操作     │  📄 package.json        │ Dev Server: ● :5173│
│ [Pull]       │                         │ [复制地址]         │
│ [Push]       │  ─────────────          │                   │
│ [Stash]      │  [上传文件] [新建文件夹]  │ [重启服务]         │
│ [Stash Pop]  │                         │ [查看日志]         │
└──────────────┴─────────────────────────┴───────────────────┘
```

**仓库 Tab 栏**：顶部 tab 切换不同仓库

**文件浏览（中间区域）**：
- 树形展示目录和文件结构
- 点击目录展开/折叠
- 支持在任意目录上传文件（需求文档、图片素材等供 agent 使用）
- 支持删除文件/目录
- 支持新建文件夹
- 暂不支持文件内容预览和在线编辑
- 可切换分支后刷新文件树

**分支选择**：左侧下拉选择当前仓库的分支，切换后刷新文件树

**Git 操作**：
- Pull — 拉取最新代码
- Push — 推送代码到远程
- Stash — 暂存当前改动
- Stash Pop — 恢复暂存

**服务状态（右侧）**：
- Agent 运行状态 + 地址（可复制，供 Chrome 插件配置）
- Dev Server 运行状态 + 地址（可复制）
- 重启服务按钮
- 查看日志按钮（弹窗展示容器日志）

## 数据模型

```typescript
interface User {
  id: string;              // 登录名
  passwordHash: string;    // bcrypt hash
  role: "admin" | "user";
  createdAt: string;
}

interface Workspace {
  id: string;              // uuid
  name: string;
  ownerId: string;         // 创建者用户 ID
  repos: RepoConfig[];
  claudeMd: string;        // CLAUDE.md 内容
  startupScript: string;   // 自定义启动脚本（bash）
  gitAccessToken: string;
  status: "stopped" | "syncing" | "starting" | "running" | "error";
  syncStatus: "none" | "syncing" | "synced" | "failed";
  devPort?: number;
  agentPort?: number;
  containerId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

interface RepoConfig {
  name: string;            // 目录名
  url: string;             // Git clone URL
  branch: string;          // 默认分支
  currentBranch?: string;  // 当前实际分支（运行时）
}
```

## API 设计

### 认证

```
POST   /api/auth/login              — 登录，返回 JWT
```

### 用户管理（admin only）

```
GET    /api/users                   — 用户列表
POST   /api/users                   — 创建用户（返回初始密码）
DELETE /api/users/:id               — 删除用户
POST   /api/users/:id/reset-password — 重置密码（返回新密码）
```

### 密码修改

```
POST   /api/auth/change-password    — 修改自己的密码
```

### 工作空间

```
GET    /api/workspaces              — 列表（普通用户看自己的，管理员看所有）
POST   /api/workspaces              — 创建
GET    /api/workspaces/:id          — 详情
PUT    /api/workspaces/:id          — 更新配置
DELETE /api/workspaces/:id          — 删除（停止容器 + 删除 volume）

POST   /api/workspaces/:id/sync     — 同步代码（clone/pull）
POST   /api/workspaces/:id/start    — 启动（body: { branches: { repoName: branch } }）
POST   /api/workspaces/:id/stop     — 停止
POST   /api/workspaces/:id/restart  — 重启
```

### Git 操作（docker exec 执行）

```
GET    /api/workspaces/:id/git/:repo/branches   — 列出分支
GET    /api/workspaces/:id/git/:repo/status      — git status
POST   /api/workspaces/:id/git/:repo/checkout    — 切换分支（body: { branch, create?: boolean }）
POST   /api/workspaces/:id/git/:repo/pull        — 拉取
POST   /api/workspaces/:id/git/:repo/push        — 推送
POST   /api/workspaces/:id/git/:repo/stash       — 暂存
POST   /api/workspaces/:id/git/:repo/stash-pop   — 恢复暂存
```

### 文件操作（docker exec 执行）

```
GET    /api/workspaces/:id/files/:repo/tree      — 文件树（目录结构）
POST   /api/workspaces/:id/files/:repo/upload    — 上传文件（multipart, body: { path })
POST   /api/workspaces/:id/files/:repo/mkdir      — 创建目录（body: { path }）
DELETE /api/workspaces/:id/files/:repo/delete      — 删除文件/目录（body: { path }）
```

### 服务管理

```
GET    /api/workspaces/:id/services/status    — agent + dev server 状态
POST   /api/workspaces/:id/services/restart   — 重启容器
GET    /api/workspaces/:id/services/logs      — 容器日志（支持 ?tail=100）
```

## Docker 设计

### Workspace 镜像 (prism-workspace)

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y git curl openssh-client && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9

# 可选：Java 支持
# RUN apt-get install -y openjdk-17-jdk-headless maven

WORKDIR /prism-agent
COPY agent-dist/ ./
RUN npm install --prod

WORKDIR /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 5173 9527
ENTRYPOINT ["/entrypoint.sh"]
```

### entrypoint.sh

```bash
#!/bin/bash
set -e

# 1. 配置 Git 凭证
git config --global user.name "${GIT_USER_NAME:-Prism Studio Agent}"
git config --global user.email "${GIT_USER_EMAIL:-agent@prism-studio.dev}"
if [ -n "$GIT_ACCESS_TOKEN" ]; then
  git config --global credential.helper store
  IFS=',' read -ra REPO_LIST <<< "$REPOS"
  for repo_spec in "${REPO_LIST[@]}"; do
    IFS='|' read -r name url branch <<< "$repo_spec"
    host=$(echo "$url" | sed -E 's|https?://([^/]+).*|\1|')
    echo "https://oauth2:${GIT_ACCESS_TOKEN}@${host}" >> ~/.git-credentials
  done
fi

# 2. 写入 CLAUDE.md
[ -n "$CLAUDE_MD" ] && echo "$CLAUDE_MD" > /workspace/CLAUDE.md

# 3. 执行用户自定义启动脚本（如有，5分钟超时）
if [ -n "$STARTUP_SCRIPT" ]; then
  echo "🔧 Running startup script (timeout: 300s)..."
  echo "$STARTUP_SCRIPT" > /tmp/startup.sh
  chmod +x /tmp/startup.sh
  timeout 300 /tmp/startup.sh &
fi

# 4. 启动 Agent Server
echo "🤖 Starting agent server..."
cd /workspace && exec node /prism-agent/server.js
```

> 注意：代码同步（clone/pull）和分支切换由 Platform 通过 `docker exec` 在容器内执行，不在 entrypoint 中处理。这样可以在容器运行中随时操作。

### Platform 容器管理

```typescript
import Docker from "dockerode";
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

async function createWorkspaceContainer(workspace: Workspace) {
  const reposEnv = workspace.repos.map(r => `${r.name}|${r.url}|${r.branch}`).join(",");
  const container = await docker.createContainer({
    name: `prism-ws-${workspace.id}`,
    Image: "prism-workspace:latest",
    Env: [
      `REPOS=${reposEnv}`,
      `CLAUDE_MD=${workspace.claudeMd}`,
      `GIT_ACCESS_TOKEN=${workspace.gitAccessToken}`,
      `STARTUP_SCRIPT=${workspace.startupScript || ""}`,
    ],
    ExposedPorts: { "5173/tcp": {}, "9527/tcp": {} },
    HostConfig: {
      PortBindings: {
        "5173/tcp": [{ HostPort: "0" }],
        "9527/tcp": [{ HostPort: "0" }],
      },
      Binds: [`prism-ws-${workspace.id}:/workspace`],
      Memory: 4 * 1024 * 1024 * 1024,
      NanoCpus: 2 * 1e9,
      SecurityOpt: ["no-new-privileges:true"],
    },
  });
  await container.start();
  // ... 获取动态端口，更新 DB ...
}

// Git / 文件操作通过 docker exec
async function execInContainer(workspaceId: string, cmd: string[]) {
  const container = docker.getContainer(`prism-ws-${workspaceId}`);
  const exec = await container.exec({
    Cmd: ["bash", "-c", cmd.join(" ")],
    AttachStdout: true, AttachStderr: true,
    WorkingDir: "/workspace",
  });
  // ... return stdout/stderr ...
}
```

### docker-compose.yml

```yaml
version: "3.8"

services:
  platform:
    image: prism-platform:latest
    build: { context: ., dockerfile: docker/Dockerfile.platform }
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - platform-data:/data
    environment:
      - PRISM_DATA_DIR=/data
      - PRISM_WORKSPACE_IMAGE=prism-workspace:latest
      - ADMIN_USER=${ADMIN_USER:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin123}
      - JWT_SECRET=${JWT_SECRET:-change-me-in-production}
    restart: unless-stopped

volumes:
  platform-data:
```

启动：
```bash
ADMIN_PASSWORD=your-password JWT_SECRET=your-secret docker-compose up -d
open http://localhost:3000
```

## 项目结构

```
prism-studio-platform/
├── src/
│   ├── server.ts                     ← Express 主入口
│   ├── middleware/
│   │   └── auth.ts                   ← JWT 鉴权 + 角色检查
│   ├── routes/
│   │   ├── auth.ts                   ← 登录 + 改密码
│   │   ├── users.ts                  ← 用户 CRUD（admin）
│   │   ├── workspaces.ts            ← 工作空间 CRUD + 启停
│   │   ├── git.ts                    ← Git 操作
│   │   ├── files.ts                  ← 文件上传/删除/目录
│   │   └── services.ts              ← 服务状态/日志
│   ├── services/
│   │   ├── db.ts                     ← SQLite（用户表 + 工作空间表）
│   │   └── container-manager.ts     ← Docker 容器管理
│   └── types.ts
├── web/                               ← React 前端
│   ├── src/
│   │   ├── App.tsx                   ← 路由
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx         ← 工作空间列表
│   │   │   ├── CreateWorkspace.tsx   ← 创建表单
│   │   │   ├── Workspace.tsx         ← 详情页（文件浏览+服务状态）
│   │   │   ├── WorkspaceSettings.tsx
│   │   │   ├── UserManagement.tsx    ← 用户管理（admin）
│   │   │   └── ChangePassword.tsx
│   │   ├── components/
│   │   │   ├── FileTree.tsx
│   │   │   ├── GitPanel.tsx
│   │   │   ├── ServiceStatus.tsx
│   │   │   ├── BranchSelector.tsx
│   │   │   └── StartupDialog.tsx     ← 启动选项弹窗
│   │   ├── hooks/
│   │   │   ├── use-auth.ts
│   │   │   └── use-workspace.ts
│   │   └── lib/
│   │       └── api.ts               ← API 客户端
│   └── index.html
├── docker/
│   ├── Dockerfile.platform
│   ├── Dockerfile.workspace
│   └── entrypoint.sh
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## 安全

- **容器隔离**：每个 workspace 独立容器，限制 CPU(2核)/内存(4GB)
- **密码安全**：bcrypt hash，不存明文，创建/重置时展示一次
- **凭证安全**：Git Token 加密存储，通过环境变量注入容器
- **JWT 认证**：所有 API 需要有效 token，角色权限检查
- **Agent 安全**：SDK canUseTool 拦截危险命令，文件操作限制在 /workspace 内

## 实现分期

### Phase 1: 项目骨架 + 认证 + 用户管理
- 初始化项目（Express + React + SQLite）
- 登录/JWT 鉴权
- 用户 CRUD（管理员功能）
- 修改密码

### Phase 2: 工作空间 CRUD + 代码同步
- 创建/列表/删除工作空间
- Docker 容器创建
- 代码同步（clone/pull）
- 同步状态展示

### Phase 3: 启动 + 服务管理
- 启动弹窗（分支选择 + 新建分支）
- 容器启动（agent + 自定义启动脚本）
- 服务状态展示 + 地址复制
- 停止/重启
- 日志查看

### Phase 4: 工作空间详情页
- 仓库 Tab 切换
- 文件树浏览
- 文件上传/删除/新建目录
- 分支切换 + 文件树刷新

### Phase 5: Git 操作
- Pull / Push / Stash / Stash Pop
- git status 展示

### Phase 6: 完善
- 启动脚本编辑
- CLAUDE.md 在线编辑
- 错误处理和 UI 优化

## Token 消耗预估

以单个 workspace 的一次开发会话（约 1 小时）估算：

| 操作 | 预估 Token |
|------|-----------|
| Agent 首次读取项目结构（CLAUDE.md + Glob + Read 几个文件） | ~10K input |
| 单次聊天修改（用户消息 + agent 思考 + 读文件 + 改文件 + 回复） | ~15-30K input, ~3-5K output |
| 一次会话约 10 轮对话 | ~200-350K input, ~30-50K output |
| **单次会话合计** | **~250-400K tokens** |

按 Claude Sonnet 价格（$3/M input, $15/M output）：
- 单次会话成本约 **$1-2**
- 如果用 Claude Opus：约 **$5-10**

> 注：使用 Claude Code 订阅（Max plan）则不按 token 计费。

## 验证方式

1. `docker-compose up -d` 启动平台
2. 访问 `http://localhost:3000` → 用初始管理员账号登录
3. 管理员创建普通用户，复制初始密码
4. 普通用户登录 → 创建工作空间 → 配置仓库 + Git Token → 勾选同步代码
5. 等待同步完成 → 点击启动 → 选择分支 → 确认
6. 容器启动 → 复制 Agent 地址 → Chrome 插件连接
7. 通过 Chrome 插件发送修改指令 → agent 修改代码
8. 详情页文件树查看修改结果 → Git Push 推送代码

## 已确认的决策

| 项 | 决策 |
|---|---|
| CLAUDE.md | 用户自己上传，不提供默认模板 |
| commit message 规范 | 作为可选项让用户自己上传（放在 CLAUDE.md 或单独配置） |
| 多仓库 UI | 数据模型已支持多仓库，UI 暂不做特殊处理 |
| 启动脚本超时 | 5 分钟超时，超时后标记 workspace 为 error 状态，日志中展示超时信息，用户可手动重试或修改脚本 |
| workspace 隔离 | 按用户隔离，只能看自己的 |
| 管理员权限 | 管理员可以看到和操作所有用户的 workspace |
| 文件上传限制 | 单文件 10MB |
| 容器日志 | 保留最近 1000 行（通过 docker logs --tail 1000 获取），不做持久化存储 |
| diff 预览 | 暂不做 |
