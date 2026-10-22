# Prism Studio 平台开发进度与接续上下文

更新时间：2026-10-22（Asia/Shanghai）。2026-10-21 环境与界面阶段已验收并提交 `9f8f155`；2026-10-22 已开发基础 Agent 对话、预览 Widget 注入和插件共享会话，待用户验收。下次会话先阅读本文，再查看 [系统设计](./system-design.md)。系统设计前半部分包含目标能力，不能据此推断功能已实现。

## 本次交付与验收范围

已完成项目模式基础、管理界面改版、需求环境启动及鉴权预览、VS Code Web 接入。旧工作空间模式已退役。本阶段验收通过不代表完整平台功能已经实现。

| 模块 | 已实现 |
| --- | --- |
| 项目 | 创建、搜索、游标分页、无限滚动、项目详情、配置覆盖保存 |
| 成员权限 | 创建时选成员，成员增删改角色，创建者/平台管理员默认管理权限，接口实时读取有效角色 |
| 项目配置 | 多仓库、统一 Token/SSH 凭证、SSH 端口、Agent SDK、模型地址/名称/API Key、初始化及启动 Bash、项目说明 |
| 需求 | 创建、验收条件、持久会话、独立分支、独立容器与持久源码卷、基础 Agent 对话 |
| 对话 | 消息/事件/任务落库、增量轮询、上下文重建、同需求串行、取消等待、IDE 入口互斥及中断保护 |
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
12. **用户已进一步明确要求开发 Widget 注入和 chrome-ext 共享会话，本轮已接通。** 不要将尚未接入的浏览器测试、附件、视觉编辑误认为平台模式已全部完成。
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

### 需求协同与 Agent（基础对话已接通）

- 已实现平台对话 API、执行记录、事件增量拉取和取消；后续可替换轮询为 SSE/WS 推送。
- 已有 `conversation_messages`、`conversation_runs`、`conversation_events`，按游标补取。SDK 原生会话 ID 持久恢复待做；当前每轮使用新 SDK 客户端，从数据库最近 20 条消息（每条最多 4000 字符，总计 32000 字符）重建上下文，不表示保留无限模型上下文。
- Widget、Chrome 插件、平台页共享数据库会话已接通，预览端用同源网关会话 Cookie；独立插件短期凭证和离开预览页的访问能力尚未实现。
- 已有数据库同需求活动任务唯一约束，执行中拒绝新任务、环境重启/停止以及新 IDE 访问，并断开现存 IDE 网关连接。完整文件系统锁、Git/测试协调、已在容器后台运行的 IDE Shell 子任务控制仍待做；当前不能声称容器所有写进程已被强制隔离。
- 平台插件已按当前标签页获取项目/需求/sessionId，切换时取消旧订阅并校验 sessionId；固定浏览器测试目标、测试期间切换规则仍待做。
- Widget 无依赖注入、环境上下文、插件握手和打开侧栏/自身面板已接入；复杂 CSP、页面 Service Worker、非 UTF-8、超大 HTML 与流式 SSR 的完整兼容仍待进一步验证。
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
| `platform/src/services/conversations.ts` | 消息/事件/执行持久化、任务串行、上下文重建与取消 |
| `platform/src/services/agent-transport.ts` | Docker exec 内部 HTTP/WS 桥接，不发布 Agent 端口 |
| `platform/src/services/workspace-lock.ts` | 活动任务锁与环境/IDE 入口协调 |
| `platform/src/routes/conversations.ts` | 需求对话 API、权限与查看者状态过滤 |
| `platform/web/src/components/RequirementConversation.tsx` | 对话弹窗、增量同步、输入/取消与协作状态 |
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

先确认用户下一步任务，再查看本文“待实现功能”和相关源码。**基础对话与 Widget/插件会话已按用户后续指示接通；不自动推送远端。** 不要把现有插件/Widget 的独立能力误认为平台模式已完成集成。


## 2026-10-22：基础需求对话（待用户验收）

- 需求卡片新增“与 Agent 对话”，编辑者/管理员可发消息、查看工具进度和取消；多人共享同一会话，同需求已有任务时拒绝并发提交，输入草稿可继续编辑。
- 原始聊天/工具输出可能含源码，查看者只获得“协作状态”和发起用户，不返回原始消息/事件，公开摘要仍待实现。
- `GET /api/projects/:id/requirements/:requirementId/conversation?after=&eventAfter=` 提供持久化游标；`POST .../conversation/messages` 接收 message/requestId（防重复提交）；`POST .../conversation/runs/:runId/cancel` 请求取消。消息先写库，再执行。前端每秒拉取，关闭弹窗不会取消任务。
- Agent 无新增宿主端口，通过 Docker exec 在容器内读 Agent 私有 Token、连接 9527 HTTP/WS。SDK 未支持安全取消的旧容器拒绝发送，需“重启环境”使用更新镜像。日志对 Agent Token 脱敏，模型 Key 不再记录前缀。
- Claude/GLM LegacyProvider 新增文本事件与按客户端关闭会话的取消回调；不取消其他客户端、不全局关闭 SDK。取消 ACK 不等于已停止，保持串行锁直到最终响应。
- 平台进程重启/桥接中断时，无法确认旧任务已停则状态 interrupted 并继续占锁。用户必须重启或停止需求容器终止旧进程后恢复；不会自动并发执行下一条，也不承诺自动接续旧执行。
- 本阶段平台 Agent 默认允许工作区文件修改及命令，禁用浏览器工具。Widget 与插件绑定已在后续本轮接入；浏览器测试仍未接通。
- 最终 SDK 类型检查/构建、平台前后端类型检查/构建通过；开启真实容器项的完整测试共 32 项通过，无跳过。真实容器测试使用模拟模型验证 Token、WS、事件、取消、IDE 连接终止、源码修改和重启；没有调用真实模型或自动操作浏览器，真实模型服务连通性由实际项目验收。
- 运行镜像已更新，已有需求需手动重启后再对话。后续开发勿把本轮新增代码当作已提交，是否提交以 git status 为准。


## 2026-10-22：Widget 注入与 Chrome 插件平台模式（待用户验收）

- 已按用户最新指示实现，不再等待 Widget 开发授权。预览网关对 HTML 注入 meta 标识与外部 Widget 脚本，用户仓库不安装 Widget、不修改业务源码。Widget 使用既有 Shadow DOM/Panel，并增加平台会话 UI。
- HTML 支持 identity/gzip/br/deflate，修改后移除旧长度/编码/ETag、设置 no-store；CSP 头与常见 meta CSP 添加 nonce/同源会话连接支持，保留原 unsafe-inline 行为，避免 nonce 让业务初始化失效。非 HTML 不改，非 UTF-8、压缩无法处理或大于 8 MiB 时保留原响应，不承诺流式 SSR 时序与 Service Worker 缓存完全兼容。
- 同源保留路径 `/__prism_platform__/context`、`/conversation`、`/messages`、`/cancel`、`/widget.js`。使用当前预览 Cookie 鉴权、实时项目权限和同源校验，不注入平台 JWT、Git/模型 Key 或容器 Agent Token。每次会话请求必须匹配 sessionId，避免导航后旧 UI 给新需求发消息。
- Widget 与插件共用 `packages/widget/src/platform-client.ts`，历史从数据库读取；平台模式不读取旧插件聊天 localStorage，也不连接全局保存的 Agent URL。
- Chrome 内容脚本负责同源请求桥接，插件后台不持有平台 JWT；侧栏按当前 tabId 获取上下文并按 sessionId 重建客户端，标签切换/导航会清除旧视图，旧请求不能覆盖新视图。
- Widget 周期握手检测插件，真实 FAB 点击由内容脚本在用户手势内请求 `chrome.sidePanel.open`；不可用/打开失败时回退 Widget 面板。单靠页面 postMessage 无法打开侧栏。未调用 Chrome 自动化，真实侧栏手势和视觉交互由用户验收。
- 多服务网关 Cookie 名加入服务维度，防止不同端口的浏览器 Cookie 相互覆盖。跨用户/查看者/错误会话请求仍由后端拒绝。
- 平台模式目前仅提供文本聊天、进度、取消和历史；插件原有独立 Agent 模式继续保留，但平台模式的附件、浏览器测试和视觉编辑尚未集成。

构建与部署：`platform` 目录运行 `pnpm build:widget` 生成 Widget 并复制到 `web/public/prism-widget.js`（生成文件不入 Git）；`pnpm dev:server` 和 `pnpm build:web` 已自动包含该步骤。前端单独运行 Vite 不会自行生成 Widget。Chrome 插件运行 `pnpm --filter @prism-studio-ai/chrome-ext build`，重新加载 `packages/chrome-ext/dist` 后刷新/重新打开预览。平台 Docker 构建上下文改为仓库根目录，Compose 已对齐；根 `.dockerignore` 排除依赖、数据、凭证与构建输出。新克隆请用根目录 `docker build -f platform/docker/Dockerfile.platform .`，不要继续用旧 platform-only 上下文。

最终验证：36 项测试通过（含真实容器，无跳过），Widget/插件/平台构建及类型检查通过。测试范围：HTML/CSP/压缩、共享客户端与 session 归属、Chrome 内容脚本同源请求/白名单/真实点击保护（VM 单测）、独立容器内 Widget 资源可取、两个客户端相互读写同一会话、查看者拒写、错误会话拒写。真实 Chrome 侧栏与实际模型回复尚由用户验收，测试模型为模拟服务。

手工验收：

1. 重新加载开发版 Chrome 插件，从平台重新打开一个已启动需求的预览。侧栏应显示项目名、需求名、“已连接平台”和会话 ID 前 8 位，不要求填写 Agent 地址/Token。
2. 先禁用插件，通过预览右下角 Widget 发消息；再启用/重载插件并刷新预览，侧栏应读取同一段历史。插件回复后，平台页和 Widget 应显示同一条消息，三个入口使用同一 sessionId。
3. 同时打开两个需求预览，在标签间切换，侧栏标题与会话 ID 应随之变化；需求 A 的消息不得出现在 B。任务运行时其他入口只能编辑草稿，不能并发发送。
4. 没有插件时 FAB 展开 Widget；有插件时 FAB 应打开侧栏，Chrome 拒绝打开时回退 Widget。查看者只能看到协作状态。


### 插件沿用原面板（2026-10-22）

- 平台模式改为复用原来的 `StudioPanel` / `ChatPanel` / `ChangesPanel`，删除简化聊天 UI；独立连接模式沿用原实现。
- 平台适配层从需求数据库同步消息和运行状态，发送/取消走预览 Cookie 鉴权接口，不连接全局 Agent；切换需求标签页重新绑定。
- 保留原元素评论、标签详情、评论编辑/移除、消息编辑、Markdown 和发送交互；事件按来源标签页过滤，退出面板清理评论模式。
- 用户消息新增可选 `client_context` 字段，保存显示文本、元素评论和标签顺序，服务启动自动补列；正文仍保留发送 Agent 的元素定位上下文。只读成员看不到这些数据。
- 平台发送失败时保留输入及元素评论，重试复用请求标识。可视化变更提交也复用平台会话。
- 平台附件、浏览器测试、共享历史清空接口仍待接入；保留原按钮布局，未接入的附件/清空入口禁用并说明原因，避免调用旧全局 Agent。
- 验收需重启平台后端并重新加载 `packages/chrome-ext/dist`，浏览器交互由用户验收。


### Agent 启动故障修复（2026-10-22）

- 现场确认旧工作镜像内 Agent 因缺少 `@openai/agents` 启动即退出，无令牌生成。Claude/GLM 现在延迟加载 OpenAI/Codex 供应商，避免无关 SDK 阻断启动。
- 重建 `prism-workspace:latest`，安装当前生产依赖；镜像构建新增真实 CLI 启动、令牌鉴权和取消能力检查，不调用模型。
- 修复容器桥接 `String.raw` 脚本中的双重正则转义，完整提取令牌行并正确转发流式事件；等待初始日志写入，依赖缺失/启动失败返回结构化中文错误，避免原始 Node 堆栈。
- 需求启动脚本持续监测 Agent 进程；Agent 异常退出时标记环境失败。
- 已用新镜像重建当前故障需求容器，保留源码卷，现场令牌鉴权与取消能力检查通过。新增桥接脚本执行测试，覆盖完整令牌、启动等待、事件归属与脱敏错误。


### 插件统一平台入口（2026-10-22）

- 插件 0.6.2 仅保留聊天面板，移除变更面板及旧的选取/拖拽工具入口，评论选择、编辑及随消息提交保持原交互。
- 删除手动 Agent 地址/Token 连接、断开连接、插件权限开关及直连 Agent 的后台逻辑；升级/启动时清理旧连接凭证，非预览页不会再探测 9527 端口。
- 当前预览页自动绑定项目/需求；顶部展示项目、需求和平台连接状态；非平台页提示打开项目预览，连接中断支持重试并保留当前输入。
- 平台与容器 Agent 的内部令牌鉴权保持；插件只走预览页 Cookie 鉴权接口。关闭插件不会中断平台 Agent 任务。
- 新增 service worker 与评论工具条执行测试，验证不再响应旧连接操作，评论模式退出可清理，工具条无旧拖拽/选取入口。


### Widget 与插件共用聊天界面（2026-10-22）

- 将聊天视图、平台会话适配、评论标签、品牌、样式、元素检查器与页面桥接统一到 `packages/ui/src/studio`；插件与 Widget 共用实现，仅保留消息传输和页面标注入口的差异。
- 两端统一插件 Logo、`Prism Studio` 标题、项目/需求、连接状态、Markdown、复制/编辑、评论标签与编辑/移除、发送/取消、重试和只读权限。附件及历史清空仍使用相同的禁用状态，浏览器测试仍待后续接口接入。
- Widget 新增无插件时的元素定位和评论，排除自己的 Shadow DOM；选取时暂时隐藏窗口，点击元素或 Escape 恢复，关闭时清理选取状态。复用 React/Vue 元素检查逻辑。
- Widget 仅保留平台自动鉴权，移除旧的手动连接初始化路径；检测到插件后，真实点击优先打开侧栏，失败回退到 Widget，不因后台探测打断正在使用的窗口。
- Widget 使用 Shadow DOM 内的共享 Tailwind 样式，Logo 嵌入自插件原始图片，保留桌面悬浮窗/移动端底部面板；平台 CSP 允许显示嵌入 Logo，不依赖外部字体服务。
- Widget 0.3.0、插件 0.6.3；React 构建去重，平台构建脚本和 Docker 构建路径同步支持共享 UI 源码。刷新预览页、重新加载插件后验收，无需重建需求工作容器。


### 预览未授权时自动登录与返回（2026-10-22）

- 浏览器直接打开无有效预览 Cookie 的页面，自动跳转平台 `/login?next=...`；已登录则直接进入恢复流程。过期的一次性打开链接也支持重新认证。
- 登录后 `/preview/continue` 通过现有鉴权 API 重新校验项目成员与 IDE 权限、签发新票据，再返回目标预览的原路径/查询参数。不会把平台 JWT 放入地址或发送给项目应用。
- Widget/插件等 `/__prism_platform__/` 请求继续返回 JSON 401，不自动跳到 HTML 登录页；普通非页面请求也保留 401。
- 局域网跳转保留访问者使用的 IP/域名，管理端端口取自打开预览时的页面地址；独立部署/反向代理可设置 `PRISM_PLATFORM_URL` 为管理端完整来源地址，例如 `https://studio.example.com`。
- 登录回跳仅接受本站相对路径；预览内部返回路径拒绝外部地址、反斜杠及换行。登录表单密码错误保留在当前页显示错误，不再被 401 处理强制刷新。


### 标题栏精简与账号复制修复（2026-10-22）

- 共享聊天组件增加入口类型：Widget 标题栏仅保留 Logo、Prism Studio、关闭按钮；插件仅展示需求名称和连接状态。两端标题栏均垂直居中，不展示项目名称。
- Widget 初始连接/错误页面延续同样的简洁标题，连接异常重试仍位于内容区。
- 账号复制仅在 Clipboard API 成功或 execCommand 返回 true 时提示已复制；HTTP 回退文本框放入凭证弹窗内部，避免 Radix 焦点限制导致选中失败，并恢复原焦点。
- 复制失败显示错误并保留可手动选中的账号信息；复制进行中禁用按钮，切换凭证时清理提示和计时器。
- Widget 0.3.1、插件 0.6.4；标题渲染与复制回退/失败处理共 6 项相关测试通过。


### 服务异常与中断任务反馈（2026-10-22）

- 将源码锁占用与实际执行状态区分：`interrupted` 继续保留安全锁，但不再显示处理中动画、运行占位文本和无效取消按钮；消息草稿可保留，发送等待恢复。
- 平台聊天在中断时显示明确的错误与“重启环境并恢复”按钮，无需关闭对话。重启后轮询环境状态，成功/失败有独立反馈，保留源码和历史记录。
- Widget 与插件共用错误提示；平台连接丢失时停止显示未确认的处理动画，提供重试连接。查看成员不会收到完整任务错误/源码细节。
- 后端执行失败/中断时为缺少回复的助手消息落库可读错误；平台重启同样补齐异常回复，历史中断记录读取时转为可读提示。
- 模型鉴权、限流、网络和超时等错误转换为可执行的中文建议，避免原始 Node 堆栈；Agent 事件 WebSocket 意外关闭会中止等待中的 HTTP 请求，及时记录中断状态。
- 正常处理中或取消确认阶段仍保持互斥；不以连接丢失直接释放锁，只有明确停止/重建容器后恢复编辑。Widget 0.3.2，插件 0.6.5。


### Widget 展开状态与滚动恢复（2026-10-22）

- 恢复平台 Widget 的展开/关闭状态持久化：同一预览页面刷新后延续之前状态；真实关闭和成功转交插件时仍记录关闭。
- 共享消息区通过 ResizeObserver 感知隐藏到可见的变化，打开和再次打开时滚到最新消息，解决后台已加载聊天但隐藏时滚动无效的问题。
- 普通可见状态下的尺寸检测不强制改变用户阅读位置；检测插件的后台心跳也不会关闭正在使用的 Widget。
- 新增 2 项执行测试覆盖隐藏/打开/再次打开滚动、刷新状态恢复及插件优先与回退。Widget 0.3.3，插件 0.6.6。


### 历史记录排查与历史错误提示（2026-10-22）

- 现场只读核对了运行进程的 SQLite 路径与需求 session；没有发现重启删除聊天的代码。独立进程重启测试验证同一 session、消息 ID、完成回复仍在，未完成回复标记中断。
- 修复客户端权限恢复漏读历史：只读时清空缓存也重置消息/事件游标，恢复编辑权限后从头加载；轮询与发送后的同步共用进行中的请求，避免并发快照乱序。
- 修复旧 Node eval 堆栈错误提取，优先展示真正的中文 Error 信息，过滤代码行与堆栈位置，避免把 `[eval]:5` 当成错误正文。
- 已结束的失败记录继续保留为聊天历史，平台底部明确写“上次任务”；仅尚未恢复的中断任务显示当前恢复告警，避免旧失败记录反复表现为服务仍异常。
- 启动日志输出数据库绝对路径，便于后续排查不同工作目录/数据卷，不输出聊天内容或凭证。尚未证实这就是用户所述历史缺失的唯一原因。
- Widget 0.3.4，插件 0.6.7。历史读取与错误归纳相关新增 5 项测试，真实需求容器重启测试增加消息与 session 保留断言。


### 2026-10-22：Widget 移动端底部弹层
- 767px 及以下使用全宽底部弹层，添加遮罩、点击遮罩关闭和 Escape 关闭；桌面保留悬浮面板。
- 适配底部安全区和 visualViewport 软键盘高度/偏移；移动端输入框使用 16px 字号，聊天区域限制滚动穿透。页面选取标注时同时隐藏遮罩。
- 预览 HTML 缺少 viewport 声明时自动补齐，已有声明保留；Widget 升级至 0.3.5 并重新构建。
- 验证：5 项定向测试通过（可见性恢复、重新打开滚动、键盘视口/遮罩关闭、HTML 注入及 viewport 保留），Widget 构建和平台类型检查通过。移动端视觉验收由用户进行。


### 2026-10-22：移动端 Widget 入口与弹层修正
- 用户反馈上一版移动端无入口且弹层未适配。删除独立移动端 FAB，桌面与移动端共用一个入口，避免双入口显隐分支；关闭弹层后直接恢复同一按钮。
- 移动识别写入 Shadow Host 的 prism-mobile 状态，入口和底部弹层统一跟随该状态；手机触摸设备增加设备宽度兜底。Host 明确固定定位、层级与指针事件，减少宿主页面布局影响。
- Widget 0.3.6，构建及声明类型生成通过；3 项行为测试通过，新增跨断点切换后同一入口重新打开覆盖。未进行移动设备视觉验收。


### 2026-10-22：Widget 与宿主页面布局隔离
- Widget Host 从 body 移至 documentElement，支持 Popover API 时进入 manual 顶层，避开 body 宽度、transform 与 overflow 对定位/裁剪的影响；旧浏览器回退到根节点挂载。
- Host 固定尺寸与位置直接跟随 visualViewport 的 width/height/offsetLeft/offsetTop，面板与遮罩改为在 Host 内绝对定位；移动底部弹层宽度限制在 Host 可视边界内。覆盖页面全局样式对 Host 的尺寸、边距与定位干扰。
- Widget 0.3.7 已重新构建；4 项行为测试通过，覆盖根节点挂载、顶层调用、视口宽高和偏移、入口切换及状态恢复。未进行真机视觉验收。


### 2026-10-22：Agent 执行中断根因与修复
- 排查任务 a796805c：19:15:09 最后持久化进度、19:15:24 interrupted，正好 15 秒。容器始终 Running、OOMKilled=false；Agent 在平台丢失连接后仍执行工具，随后桥接清理会话导致 SDK aborted 日志。
- 根因：containerEngine 的 15000ms Docker socket 空闲超时被 Agent 长执行流复用。推理/工具超过 15 秒不输出就导致桥接断流。
- 修复：containerEngine/runtimeContainer 支持超时参数，Agent transport 使用独立 timeout=0 客户端，普通管理操作仍为 15000ms。不修改工作镜像。
- aborted/terminated 连接错误返回明确连接异常提示，并在平台控制台记录脱敏后的运行错误，仍保留未知任务状态锁。
- 验证：真实现有容器并行执行相同 17 秒静默命令，旧 15s 超时连接失败，timeout=0 完整结束；6 项桥接/错误提示测试通过，平台类型检查和构建通过。
- 已中断需求需重启环境释放保守任务锁后重新提交；平台服务需加载更新（tsx watch 自动重载或手动重启）。


### 2026-10-22：执行异常统一为 Agent 回复
- 移除 Widget/插件顶部常驻的任务中断/失败提示，改为在对应 Agent 回复中呈现，已输出部分内容时追加原因，避免重复追加。历史中断状态仍持久化，重启环境解除任务锁后恢复发送。
- 平台需求对话同样移除独立任务错误横幅，重启环境按钮移至对话流末尾。网络连接重试提示保留。
- 后端执行中断及平台启动中断处理将错误追加到部分 Agent 回复末尾并持久化，原内容保留。
- Widget 0.3.8、插件 0.6.8，均重新构建；平台前后端构建通过。11 项共享 UI、错误展示、会话持久化与并发锁测试通过。


### 2026-10-22：Agent 五分钟 HTTP 响应等待超时
- 新任务 79116403 于 19:32:50 开始、19:37:52 interrupted（约 302 秒），容器继续运行，SDK 后续因桥接清理 session 被关闭。
- 上一修复只取消容器 exec socket 的 15 秒空闲超时。桥接中 fetch(/api/chat) 仍需等待整轮任务结束才收到响应头；容器 Node 内置 Undici 源码确认默认 headersTimeout=3e5。
- 将长 chat 请求替换为原生 node:http.request，显式 timeout=0、agent=false，保留 AbortSignal 取消与断线终止、响应体上限及 JSON 校验。状态检查、取消、会话清理继续使用有界短请求。桥接错误记录增加底层 cause code/message。
- 验证：5 项桥接/本地真实 HTTP 测试通过，覆盖延迟响应、取消、无效 JSON、事件过滤、启动异常及 WS 中断；平台类型检查/构建通过。没有重新调用真实模型进行五分钟以上任务验收。
- 无需重建工作镜像，平台更新后重启当前已中断需求环境释放锁，再提交任务。


### 2026-10-22：需求分支 Pull / Push
- 按用户最新要求，暂停代码变更查看，完成需求分支 Pull / Push。入口在运行中的需求卡片“Pull / Push”按钮，按仓库分别操作；当前批次不执行自动提交、多仓库原子同步或主干合并。
- GET /environment/git 仅返回配置中的仓库名称和固定需求分支；POST /environment/git/pull、/push 接收 repo。仅项目编辑/管理成员可访问，校验需求所属项目，查看者不可获取仓库列表或执行操作。
- Pull：fetch origin 当前需求分支，再 merge --ff-only FETCH_HEAD；远端需求分支不存在时提示先 Push。Push：HEAD 推送到 origin 同名需求分支，不 force、不推主干、不自动提交。两种操作都要求当前分支正确且无未提交文件。
- 使用运行容器中的 Token askpass / SSH 身份；项目 Git 凭证配置变更需重启环境以更新运行凭证。Git 命令以 argv 传入，关闭 Git hooks、禁止终端鉴权交互、限制每条命令 60 秒；原始远端错误不直接回显，鉴权/分叉/超时返回中文提示。
- 与 Agent 执行、环境启动/停止、其他 Git 操作互斥。操作期间断开现存 IDE 连接并阻止重新进入，完成后释放锁、可重新打开。仍不保证隔离已在容器后台运行的任意 Shell 写进程。
- 8 项测试通过：本地真实 bare Git 仓库首次 Push、远端 Pull 更新、脏工作区拒绝、分叉拒绝、主干保护；另覆盖角色/跨项目鉴权、Agent 与环境操作互斥、失败释放锁。平台前后端类型检查及构建通过，未对真实项目远端执行 Push，未做浏览器验收。
- 用户回来验收：启动需求环境 → Pull / Push → 选仓库；让 Agent 提交修改后 Push；用另一副本给同名需求分支新增提交后 Pull；分别确认未提交文件和分叉时的提示。刷新平台页面加载入口，无需重建镜像或插件。


### 2026-10-22：Pull / Push 中提供提交代码入口
- Git 同步弹窗选择仓库后只读获取工作区状态；有未提交修改时直接显示“提交代码”，不要求用户通过 Agent 提交。提交说明必填（1–500 字），提交当前所选仓库全部修改及未被 Git 忽略的新文件；仅创建本地 commit，成功后允许继续手动 Pull / Push。
- 新增 GET /environment/git/status?repo=... 与 POST /environment/git/commit（repo、message），沿用编辑权限、固定需求分支校验及 Git/Agent/环境互斥。只读状态检查不关闭 IDE、不取得写锁，最终提交重新校验状态。
- 提交说明按 argv 传入，不拼接 Shell。空说明在 git add 前拒绝；无修改时不创建空提交。提交失败提供检查冲突/身份的提示。
- 8 项测试通过，真实本地 Git 测试覆盖新增/修改文件提交、空说明拒绝、提交后工作区清洁、不自动 Push、无修改拒绝及说明特殊字符；增加查看者不能 commit 的路由断言。平台前后端类型检查与构建通过，无需更新插件或镜像。未对实际项目仓库执行提交。


### 2026-10-22：临时隐藏附件入口
- 按用户要求注释共享 ChatPanel 的添加附件按钮，保留上传及附件展示代码。Widget 0.3.9、插件 0.6.9 已构建，类型检查通过。


### 2026-10-22：腾讯云 amd64 镜像与离线部署包
- 用户腾讯云服务器：Ubuntu 24.04 / Docker 29.6.1，x86_64，2 核 2GB，50GB 系统盘，已有约 2GB Swap。用户自行保证只创建/运行一个需求，不增加需求数量限制。
- 已交叉制作 linux/amd64 镜像：localhost/prism-platform:cloud-amd64-20261022（ID 828785c7ac47，运行镜像约 266MB、压缩 93MiB）；localhost/prism-workspace:cloud-amd64-20261022（ID 4f82467ebf4a，约 2.3GB、压缩 993MiB）。不覆盖本机开发 latest 标签，不含平台数据库或真实凭证。
- 基础镜像镜像站/官方源直连下载停滞，最终使用 DaoCloud 源下载 amd64 node:22-slim；构建阶段使用本机代理，成品 ENV 已确认无代理变量。已停止本任务的停滞备用下载，不停止本地需求/开发服务。
- 新增 Dockerfile.platform-prebuilt：静态 JS/前端产物本机原生编译，Node 原生依赖在 amd64 阶段安装，生产运行阶段不含构建工具。规避 Rosetta/esbuild Go lfstack 错误。常规 Dockerfile.platform 也增加多阶段运行层，并处理 pnpm 9 与新独立工作区配置不兼容；两份 Dockerfile 支持 NODE_IMAGE 参数。
- 实际测试：amd64 运行容器检查 SQLite 初始化、SPA、管理员登录、项目 API、Widget 文件；需求镜像构建中运行真实 Agent CLI 检查启动、鉴权和取消能力。无模型调用，未连接云服务器。导出 Docker archive 已逐份读取 manifest/config，确认 tags 与 linux/amd64；生成 SHA256SUMS。
- 成品：dist/tencent-cloud-20261022/（两份 tar.gz、compose.yaml、.env.example、DEPLOY.md、BUILDINFO.json、SHA256SUMS）；便于上传的单包 dist/prism-studio-cloud-amd64-20261022.tar。以上 dist 文件不纳入 Git。
- 云部署指南保存在 platform/docs/tencent-cloud-deployment.md。使用 host 网络、Docker socket、./data 持久化；只需 docker load，不需在 2GB 云服务器安装 Node/pnpm 或构建镜像。模板要求公网 IP、强管理员初始密码和随机 JWT_SECRET；现阶段仍需限制来源 IP 放行管理端口和动态预览端口，无统一 HTTPS 网关。
- 后续：用户上传部署包，服务器解压、校验、docker load、配置 .env、compose up。需求运行仍可能因项目规模占用较高内存，未声称 2GB 主机负载验收通过；无需用户再次制作镜像。


### 2026-10-22：部署包已上传腾讯云
- 已使用用户指定的 SSH 密钥连接 ubuntu 账号，修正私钥文件权限为 0600；不在仓库记录私钥路径或内容。
- 离线包已通过 rsync 上传至服务器 /home/ubuntu/prism-studio-cloud-amd64-20261022.tar，约 1.14GB；服务器外包 SHA-256 与本地一致（e82332acfa1acf129a8e5d27decbe7726b20f05acb6b011622d0010fb73c61bc）。
- 已解压至 /home/ubuntu/prism-studio，两份镜像、compose.yaml、.env.example、DEPLOY.md、BUILDINFO.json 的 SHA256SUMS 全部 OK。
- 服务器 sudo -n Docker 可用，UFW inactive，系统盘约 42GB 可用。腾讯云控制台防火墙尚未检查。
- 当前仅完成用户要求的上传、解压与校验；还没有 docker load、生成 .env 或启动平台。下一步导入镜像、配置 PUBLIC_HOST/管理员密码/JWT_SECRET，再 compose up。


### 2026-10-22：阶段提交验证
- 提交前平台全套测试：68 项，66 通过、2 项 opt-in 容器测试跳过，0 失败；Agent 和共享 UI 类型检查通过，git diff --check 通过。
- 本阶段包含共享数据库会话、Widget/插件同步及移动端弹层、Agent 执行超时修复、Git 本地提交与 Pull/Push，以及 amd64 云部署配置/指南。镜像 tar、SQLite 数据及任何 SSH/项目凭证不纳入版本库。
- 云端管理平台已由用户确认登录成功。预览网关监听及本机 401 响应正常，公网动态端口超时；已指导腾讯云来源受限地放通实际动态端口范围，尚未收到放通后的预览验收结果。
