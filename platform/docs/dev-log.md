# Prism Studio Platform 开发日志

## 2026-06-12

### Phase 1: 项目骨架 + 认证 + 用户管理 ✅

- 初始化项目：Express + React + Tailwind v4 + SQLite
- 实现登录/JWT 鉴权、用户 CRUD（管理员）、修改密码
- 前端 shadcn/ui 组件库搭建（Button, Input, Card, Dialog, Table, Label, Badge, Separator）
- 全部文本中文化

**问题记录：**
- Tailwind v4 `@theme inline` 会替换掉所有默认主题变量（包括 `--spacing`），导致 `space-y-*`、`p-*`、`gap-*` 等间距类全部失效。**解决：改用 `@theme`（不加 `inline`）**，只覆盖颜色和圆角，保留默认的 spacing 等变量。
- `* { margin: 0; padding: 0; }` 全局重置会覆盖 Tailwind preflight，导致间距异常。Tailwind v4 自带 preflight，不需要手动重置。

---

### Phase 2: 工作空间 CRUD + 代码同步 ✅

- Workspace 数据模型（SQLite）、CRUD API、前端列表/创建/编辑页面
- Docker 容器管理（dockerode）：创建、启动、停止、删除
- 代码同步（git clone/pull）
- 支持 HTTPS Token 和 SSH 密钥两种认证方式

**问题记录：**

#### SQLite 外键约束失败
- **现象：** 创建 workspace 时报 `FOREIGN KEY constraint failed`
- **原因：** JWT token 中的 userId 与数据库 users 表不匹配（旧 token + 新数据库）
- **解决：** 清除浏览器 localStorage 重新登录

#### Docker 容器名冲突
- **现象：** 同步失败后再次同步报 `container name already in use`
- **原因：** 同步失败后临时容器没有清理
- **解决：** 在创建容器前先 `removeContainer()`，失败后也自动清理

#### SSH clone 失败 — 端口问题
- **现象：** `ssh: connect to host code.weoa.com port 22: Connection refused`
- **排查过程：**
  1. 先以为是 Docker VM 网络隔离问题，尝试了 `NetworkMode: "host"`（macOS 上无效）
  2. 尝试实现 TCP 代理（ssh-proxy.ts）通过 `host.docker.internal` 转发，但代理本身连接也超时
  3. 最终通过 `ssh -v` 发现用户的 `~/.ssh/config` 配置了 **自定义端口 36000**
  4. 测试发现容器内直接可以访问 `code.weoa.com:36000`
- **解决：** 在 workspace 配置中增加 SSH 端口字段，entrypoint 的 SSH config 使用该端口
- **教训：** 遇到 SSH 连接问题先用 `ssh -v` 看实际连接参数

#### Docker 容器停止报 304
- **现象：** 停止已停止的容器报 `HTTP code 304 container already stopped`
- **解决：** `stopContainer()` 中对 `container.stop()` 的 304 和 404 状态码都做忽略处理

---

### Phase 3: 启动 + 服务管理 ✅

- 启动弹窗（分支选择 + 新建分支）
- 服务状态展示 + 地址复制
- 日志查看（全部/主进程/Agent/启动脚本 四个 tab）
- 停止/重启

**问题记录：**

#### 启动弹窗打开时 workspace 提前变为"运行中"
- **现象：** 点击"启动"按钮，还没确认分支选择，列表就显示"运行中"
- **原因：** 初版的 `loadBranches` 调用了 `api.startWorkspace()` 来获取分支列表，Dashboard 5s 轮询检测到状态变化
- **解决：** 改用 `execInTempContainer` 用独立临时容器读取分支列表，不影响 workspace 状态

#### Agent 连接失败 — 镜像缺少 agent
- **现象：** Chrome 插件连接 agent 无响应
- **原因：** 简化版 workspace 镜像没有包含 prism-agent，容器只有 `tail -f /dev/null` 保活
- **解决：** 重构 Dockerfile.workspace，将 agent 构建产物打包进镜像，entrypoint 最后执行 `node /prism-agent/dist/cli.js start --port 9527`

#### Agent SDK 认证问题 — Claude Max 订阅
- **现象：** `Claude Code process exited with code 1`
- **排查过程：**
  1. 用户使用 Claude Max 订阅（OAuth），没有 API Key
  2. 尝试挂载 `~/.claude` 目录 → CLI 找不到 keychain 中的 token（macOS Keychain 无法在 Linux 容器中访问）
  3. 尝试从 macOS Keychain 导出 OAuth token（`security find-generic-password`）→ token 可以提取但设为 `ANTHROPIC_API_KEY` 后请求不返回
  4. 尝试用本机 Claude Code 代理（`127.0.0.1:15166`）→ 这是 CLI 内部代理，不接受直接 API 调用（返回 400）
  5. 容器直接访问 `api.anthropic.com` → 报 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`（公司网络 SSL 中间人代理）
- **最终方案：** 放弃共享订阅登录态，在 workspace 配置中增加 Agent 配置（API Key、Base URL、Model），每个 workspace 独立配置。用户使用公司内部的 LiteLLM 代理。

#### Agent SDK 报 exit code 1 — 多个子问题

##### 问题 A：SSL 证书验证失败
- **现象：** `API Error: Unable to connect to API (UNKNOWN_CERTIFICATE_VERIFICATION_ERROR)`
- **原因：** 公司网络 SSL 中间人代理，容器内没有对应的 CA 证书
- **解决：** 使用公司内部 LiteLLM 代理（HTTP，非 HTTPS）绕过

##### 问题 B：claude CLI 在容器内卡住无输出
- **现象：** `claude -p 'say hello'` 在容器内执行无任何输出，超时退出
- **原因：** 当时使用的 API Key/Base URL 配置不正确，CLI 在等待无效的 API 响应
- **解决：** 配置正确的 LiteLLM 地址后恢复正常

##### 问题 C：root 用户禁止 bypassPermissions
- **现象：** `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`
- **原因：** Claude CLI 安全策略禁止 root 用户使用跳过权限模式
- **发现方式：** 通过 SDK debug 日志（`DEBUG_CLAUDE_AGENT_SDK=1` + `stderr: true`）在 `/root/.claude/debug/` 目录找到详细错误
- **解决：** Dockerfile 中创建非 root 用户 `prism`，以 `USER prism` 运行容器
- **后续问题：** 切换用户后需要修复已有 volume 的文件权限（`chown -R prism:prism /workspace`），以及预建 `/var/log/prism` 目录

#### 日志输出乱码
- **现象：** 日志前面有 `:` 和 `I` 等乱字符
- **原因：** Docker `container.logs()` 返回的是多路复用流（multiplexed stream），每帧有 8 字节头部，`toString()` 会把头部也输出
- **解决：** 手动解析多路复用流，跳过每帧的 8 字节头部

---

## 当前进度

- Phase 1 ✅ 项目骨架 + 认证 + 用户管理
- Phase 2 ✅ 工作空间 CRUD + 代码同步
- Phase 3 ✅ 启动 + 服务管理
- Phase 4 ⬜ 工作空间详情页（文件树浏览、文件上传/删除、分支切换）
- Phase 5 ⬜ Git 操作（Pull/Push/Stash）
- Phase 6 ⬜ 完善（启动脚本编辑、CLAUDE.md 在线编辑、错误处理和 UI 优化）

## 关键技术决策

| 决策 | 原因 |
|---|---|
| 代码同步在容器内执行（docker exec） | 保持代码在 Docker volume 内隔离，不暴露到宿主机 |
| SSH 密钥通过环境变量传入容器 | entrypoint 写入文件，不持久化到 volume |
| 非 root 用户运行容器 | Claude CLI 安全策略要求 |
| Agent 配置（API Key/Base URL/Model）存储在 workspace 级别 | 不同 workspace 可能使用不同的模型服务 |
| 日志分文件存储（main/agent/startup） | 方便用户按类型排查问题 |
| 临时容器读取分支列表 | 避免打开启动弹窗时改变 workspace 状态 |
