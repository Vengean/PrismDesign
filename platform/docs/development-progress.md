# Prism Studio 平台开发进度与接续上下文

更新时间：2026-10-21（Asia/Shanghai）。用户已确认本阶段验收通过，并要求记录进度、提交代码。下次会话先阅读本文，再查看 [系统设计](./system-design.md)。系统设计前半部分包含目标能力，不能据此推断功能已实现。

## 本次交付与验收范围

已完成项目模式基础、管理界面改版、需求环境启动及鉴权预览、VS Code Web 接入。旧工作空间模式已退役。本阶段验收通过不代表完整平台功能已经实现。

| 模块 | 已实现 |
| --- | --- |
| 项目 | 创建、搜索、游标分页、无限滚动、项目详情、配置覆盖保存 |
| 成员权限 | 创建时选成员，成员增删改角色，创建者/平台管理员默认管理权限，接口实时读取有效角色 |
| 项目配置 | 多仓库、统一 Token/SSH 凭证、SSH 端口、Agent SDK、模型地址/名称/API Key、初始化及启动 Bash、项目说明 |
| 需求 | 创建、验收条件、持久会话 ID、独立分支、独立容器与持久源码卷 |
| 环境 | 手动启动/重试/停止/重启、状态轮询、脱敏日志、当前配置生效、重启保留源码与依赖 |
| 预览 | 自动探测内部端口，多服务切换，HTTP/WebSocket 代理，单次票据与 Cookie 鉴权、权限撤销检查 |
| VS Code | 编辑者/管理员可打开，查看者无入口且接口拒绝，支持真实 WebSocket 连接 |
| 发布 | 仅创建和展示元数据，限制管理员操作；代码合并与发布环境运行尚未实现 |
| 账号 | 登录、修改密码、管理员用户管理、紧凑头像菜单 |

## 已确定的产品规则（不要回退）

1. 核心概念是项目、需求、发布。`packages/serve` 不维护，项目运行自己的 Vue/React/Next 等开发服务器。
2. **没有配置快照/版本概念。** 每个项目仅一份 `project_configs`，保存时覆盖。需求与发布不绑定配置版本。
3. 每次启动/重启需求环境读取项目当前配置。保存配置不打断运行中的环境；需要生效时手动重启。
4. Docker 环境变量不可原地更新，因此每次显式启动会移除旧进程容器并重建，复用源码卷。不要删除卷、重置工作树或丢弃未提交修改。
5. 初始化脚本成功后保存摘要；首次运行或脚本变化时执行，未变化则跳过。启动脚本每次执行，两者工作目录均为 `/workspace`。
6. 仓库目录为 `/workspace/<仓库名>`，基于各仓库配置主干首次拉取并创建需求分支。同一项目共用 Git 认证，无公开仓库认证模式，无额外工作目录或服务配置。
7. 更新仓库配置不等于重置已有需求源码：已有需求分支/修改继续保留；新仓库会拉取，已有仓库更新 origin URL；移除仓库配置不会自动删除旧目录，变更主干不会自动 reset 已有需求。
8. 不要求用户配置应用端口，平台自动发现和分配。SSH 端口是代码服务器连接端口，仍需配置。
9. Agent SDK 下拉只支持 Claude Agent SDK（默认）和 GLM SDK，项目内配置凭证、地址、模型。没有全局模型供应商管理，也没有单独的“供应商类型”。GLM 沿用现有 `glm-acp-agent` 适配器。
10. 创建者和平台管理员不用加入项目成员；添加成员候选过滤这些用户，不额外展示默认权限提示。其他人按 viewer/editor/admin 管理，查看者不可访问源码/VS Code/日志或操作环境。
11. 发布仅管理员创建，未来只集成代码与运行预览，不启动可编辑 Agent；目前只有元数据。
12. **Widget 注入尚未开发。用户明确要求等下一步指示，不要因接续会话自行开始实现。** 容器 Agent 进程启动不等于平台聊天已接通。
13. 浏览器视觉/交互验收由用户完成。不要反复请求 Chrome 授权，不自动使用 Chrome/GUI 做验收。优先类型检查、构建、接口与独立容器测试。

## 界面已确认的约束

- 品牌为 Prism Studio，Logo 与 Chrome 插件一致，浏览器标题不带 platform。
- React Router SPA，共享顶栏；返回“所有项目”在顶栏，不在页面重复展示。
- 项目首页仅搜索框、加号创建按钮、项目卡片。桌面三列瀑布布局，手机单列，无限滚动；空状态保留提示及创建按钮。
- 复用现有 Radix/shadcn、Lucide；浅色、简洁、接近 C 端体验，不恢复传统侧栏后台。
- 创建页不加宣传大标题；取消/创建按钮在表单底部正常布局。桌面目录 sticky，顶部与初始位置一致；根滚动条稳定占位避免 navbar 跳动。
- 头像只展示头像，弹出紧凑菜单包含昵称（当前以账号 ID 展示）、角色和操作入口，不恢复大抽屉。
- Token/SSH 用页签切换，不额外显示“Git 认证方式”标题。字段名汉化、必填加标识、“项目说明”提示放 placeholder。

## 待实现功能

### 需求协同与 Agent（核心未接通）

- 平台端 Agent 对话 API、执行记录、流式事件和取消操作。
- 消息/事件持久化、断线补取、SDK 会话恢复；目前只有 `project_sessions` 会话记录，无聊天消息表。
- Widget 与 Chrome 插件共享数据库会话、短期项目凭证、多用户同步。
- 同一需求源码写操作串行锁与忙碌状态；Agent、Git、IDE 写入、浏览器测试的协调。当前未实现锁，不能声称 IDE 与 Agent 已互斥。
- 多项目/多标签页路由：tabId → requirement/workspace → session，事件归属校验，固定浏览器测试目标，切换标签页不转移测试对象。
- Widget 无依赖注入、环境上下文、插件可用性握手、有插件打开侧栏/无插件打开自身面板。**等待用户下一步指示。**
- 附件/截图、验收记录、工具输出与源码片段按角色过滤。

### 发布与 Git 工作流

- 需求生命周期、申请合入、固定待合入 SHA、审批和检查。
- 多仓库合并、冲突处理、部分失败记录、发布分支及准确 commit 清单。
- 发布运行容器和鉴权预览，禁止 Agent/可写 IDE/交互 Shell。
- 冻结/归档、资源回收、版本与实际预览状态。

### 运行环境与产品补充

- 生产独立预览域名、HTTPS、统一反向代理；当前是开发用 HTTP 动态端口网关。
- 持久化任务队列/Worker、平台进程重启时任务恢复、启动超时与可靠的应用级健康检查。当前内存 Map 只防单进程重复启动，状态以容器/监听端口为主。
- 准确记录仓库基础 SHA、配置连通性验证、项目基础信息编辑。
- 独立交互终端、数据环境隔离、初始化数据和资源配额配置。当前“运行日志”是轮询日志，非交互终端；VS Code 自带终端可随 IDE 使用，独立终端的角色约束仍待明确实现。
- 需求关闭/删除、闲置回收、卷清理、完整审计与运维界面。
- 预览端口目前依据 TCP LISTEN 自动发现（>1024，排除保留端口），没有 HTTP 协议识别或业务 readiness 检查；未来需过滤数据库/内部工具端口。

## 实现入口与运行细节

| 路径 | 职责 |
| --- | --- |
| `platform/src/services/projects.ts` | 项目表、当前配置、配置兼容、AES-256-GCM 凭证、成员角色；旧配置版本迁移 |
| `platform/src/routes/projects.ts` | 项目、成员、配置、需求/会话、发布元数据 API |
| `platform/src/services/requirement-runtime.ts` | 引擎检测、容器创建/停止/重启、端口发现、日志与脱敏 |
| `platform/src/routes/environments.ts` | 需求环境 API 与角色校验 |
| `platform/src/services/preview-gateway.ts` | 独立 origin 的鉴权 HTTP/WS 网关、一次性链接、IDE 转发 |
| `platform/src/services/agent-runtime.ts` | SDK 选择与 Agent 环境变量映射 |
| `platform/docker/project-entrypoint.sh` | Git 凭证、拉库/分支、初始化与启动、code-server、Agent |
| `platform/docker/preview-proxy.cjs` | 容器内部应用代理，支持 IPv4/IPv6 本地监听及多服务 |
| `platform/docker/fix-code-server-extensions.cjs` | 修正内置扩展无效 browser 入口，构建时校验 |
| `platform/src/services/legacy-cleanup.ts` | 只清理退役旧表登记的资源，不扫描删除其他容器 |
| `platform/web/src/pages/Projects.tsx` | 项目列表/创建表单及共享配置字段 |
| `platform/web/src/pages/ProjectDetail.tsx` | 项目详情、成员、设置、需求/发布列表 |
| `platform/web/src/components/RequirementEnvironment.tsx` | 环境状态、启动/重启/停止、预览、IDE、日志弹窗 |

- 容器：`prism-req-<requirementId>`；持久卷：`prism-req-code-<requirementId>`；各仓库需求分支：`prism/requirement-<requirementId>`。首次创建本地分支，不自动推送远端。
- 镜像默认 `prism-workspace:latest`，项目入口为 `/project-entrypoint.sh`。旧 `/entrypoint.sh` 仍在镜像中，但不用于新项目模式。
- 内部 8080 为 code-server，8090 为应用代理，9527 为 Agent（不发布到宿主机）。宿主映射仅绑定 127.0.0.1，网关再提供用户可访问的动态端口。
- 每个需求/服务/IDE 网关各有浏览器 origin。60 秒单次票据换 8 小时 HttpOnly 会话；逐请求校验当前成员权限，WS 每 30 秒复查。票据/网关会话目前在内存，平台重启后需从页面重新打开链接。
- `CONTAINER_SOCKET` 指定 Docker/Podman socket；代码包含本机 Podman 常用路径探测。平台与引擎需处于同一宿主网络，Linux Compose 使用 host 网络。
- `PRISM_PREVIEW_HOST` 覆盖预览链接主机名，默认使用 API 请求主机；`PRISM_PREVIEW_BIND` 默认 `0.0.0.0`。动态网关端口需网络可达。Mac 上使用本机原生平台进程和 Podman；不要假设其他机器的防火墙/容器网络已经配置。
- 当前 API 默认 3001，前端 Vite 默认 5173、代理 `/api` 到 3001；容器化平台镜像 PORT 为 3000。
- 数据默认在 `platform/data`（相对进程工作目录），`PRISM_DATA_DIR` 可覆盖。`platform.db`、WAL 与 `credentials.key`、容器镜像和卷均不在 Git 中；换机器不会随代码自动同步。备份数据必须同时保留密钥文件，不要提交真实凭证。
- 本机已迁移旧工作空间与配置版本表。启动迁移保留用户/项目/需求/发布/会话，只保留项目当前配置，删除旧版本引用、旧版本表及未使用的凭证。不要恢复旧 workspace API 或快照设计。

## 本阶段问题与修复

1. “已配置启动脚本却提示缺失”：原来需求锁定创建时的旧配置。已彻底移除配置快照机制，不能再增加“创建需求后固定配置”的逻辑。
2. VS Code 报必须 reload：IDE 代理改写 Host 导致 code-server 的 Host/Origin 校验拒绝 WebSocket。修复为保留浏览器 Host、覆盖转发 Host，并保留网关自身 origin 校验，不关闭 code-server 校验。
3. `git-base/dist/browser/extension.js`、`merge-conflict/dist/browser/mergeConflictMain.js` 缺失：当前 code-server 4.100.3 安装包有服务器端入口，却声明了不存在的 browser 入口。构建脚本只删除这些无效声明，让其走远端 Node 扩展宿主；不复制 Node 脚本伪装 browser 包。真实浏览器 bundle 已存在时保持原样，两端都缺失则构建失败。
4. 本机运行镜像已更新。旧容器需点击“重启环境”使用新镜像，然后关闭旧 IDE 页、从平台重开。不要为了修复 IDE 清空源码卷。

## 启动与验证

从仓库根目录执行（依赖已安装时）：

```bash
cd platform
pnpm dev
```

后端/前端可分别用 `pnpm dev:server`、`pnpm dev:web`。生产本地进程先 `pnpm build` 再 `pnpm start`。

检查命令：

```bash
# platform 目录
node --import tsx --test tests/*.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsup

# platform/web 目录
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build
```

完整构建工作环境镜像（仓库根目录）：

```bash
bash platform/scripts/build-workspace-image.sh
```

该脚本先构建 `packages/agent`，再生成 `prism-workspace:latest`，包括 code-server 修复。不要依赖本次调试时 `/tmp` 中的增量 Containerfile，它不是跨会话/跨机器必需文件。

真实容器测试（仓库根目录）：

```bash
podman build -t prism-runtime-fixture:latest -f platform/tests/fixtures/Dockerfile.runtime platform/tests/fixtures
cd platform
PRISM_TEST_CONTAINERS=1 node --import tsx --test tests/requirement-container.test.ts
```

Docker 环境将测试镜像 Dockerfile 的 `FROM localhost/prism-workspace:latest` 与本机镜像名称对齐再构建。测试不读真实仓库、不调用模型，使用临时数据库和独立容器/卷，结束自动清理；普通测试默认跳过真实容器项，不能将 skip 计为已跑通过。

覆盖：角色隔离、会话保留、配置直接覆盖、凭证加密及更新、旧数据迁移、SDK 启动选择、真实克隆和分支、HTTP/WS、多端口/IPv6、真实 code-server WS、内置扩展入口、重启新脚本生效与保留修改。提交前普通回归为 26 项通过、1 项真实容器测试按默认设置跳过；真实容器项已单独运行通过，前后端类型检查和构建通过。用户已验收本阶段。没有自动调用浏览器做本轮验收。

## 下次会话如何继续

先确认用户下一步任务，再查看本文“待实现功能”和相关源码。**本次仅交付进度记录与代码提交，不自动进入下一阶段，不自动注入 Widget，不自动推送远端。** 不要把现有插件/Widget 的独立能力误认为平台模式已完成集成。
