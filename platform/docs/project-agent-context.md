# 项目共享配置与 Agent 运行环境

本文描述当前源码的最终方案，替代之前的专用 MCP 配置、探测和下载通道。

## 容器与权限

每个需求继续拥有独立容器和源码卷。同一项目共享登录卷与只读 `.global` 卷；不同项目隔离，DEV/SIT 也隔离。共享配置与登录凭证使用不同卷，避免把凭证作为知识文档提供。

平台需求容器显式开启终端网络、工作区写入、命令与 MCP 权限。Codex 保留 `workspace-write` 沙箱，额外允许工作区内 `.codex`、`.agents`、`.claude` 与当前项目可写的 `CODEX_HOME`；目录不能通过符号链接逃出工作区。运行用户仍为非 root，保留 cap-drop 和 no-new-privileges，不使用全盘写入或特权容器。只读验证回合不授予上述写入与出网能力。

此前 Claude 终端可出网，而 Codex 把缺省 `PRISM_PERMISSION_NETWORK` 解释为 false，造成相同容器内 MCP 查询成功、终端下载 connect EPERM。平台容器现在显式传递一致的开发权限，仓库配置不能悄悄覆盖容器策略；独立 CLI 仍保留自己的配置权限默认值。

Agent 按任务阅读 README、仓库规范和 Skill，自主安装依赖、启动服务、写入配置并验证。镜像提供 curl、Python、ZIP 工具与各模型 CLI，不包含 DataForge 等业务服务的专用代理或下载逻辑。平台不预先安装项目 MCP、不下载业务包、不替模型执行初始化脚本。

## 项目共享 `.global`

现有 `prism[-sit]-project-<projectId>-knowledge` 卷继续复用，不迁移或删除历史数据，统一只读挂载到 `/workspace/.global`：

```text
.global/current/
  README.md                  # 项目说明
  docs/*.md                  # 项目知识库
  skills/<name>/SKILL.md     # 共享操作规范
  mcp.json                   # { "mcpServers": { ... } }
```

项目设置生成 README.md，不生成或覆盖仓库 CLAUDE.md。写入仍通过无源码和凭证挂载、断网的辅助容器，按内容哈希生成版本并原子切换 current。每次显式启动需求同步项目设置；保存配置不打断已运行任务。

所有平台需求均挂载共享目录，包括暂时没有共享说明的项目。Agent 获得 README、文档和 Skill 路径索引，按需阅读；共享 Skill 为操作规范，包含安装动作时由 Agent 在本需求中执行。仓库自己的 README、AGENTS.md、CLAUDE.md、Skill 与配置保持独立。本地同名规范优先，不回写共享层。

共享 MCP 支持 stdio 和 Streamable HTTP。SDK 适配层只读取定义并映射为对应客户端配置，共享服务加 `project_` 前缀；可选的工作区 `.mcp.json` 和 prism.config 的 MCP 定义采用本地名称，后者覆盖同名本地定义。不存在 `.mcp.json` 也可以运行，Agent 可自行创建它或使用 CLI 原生配置。此兼容读取不生成文件、不安装服务，也不覆盖原生配置。Claude/Codex 原生配置机制继续保留；GLM ACP 仅在客户端声明支持 HTTP MCP 时注入 HTTP 定义，不能把未知能力当作已支持。

## 配置刷新与自主初始化

普通回合开始与结束比较 SDK 原生配置、可选 `.mcp.json` 和 Skill 定义的指纹；业务文件变化不会触发刷新。配置改变后，在当前模型调用结束时重载客户端并继续原始任务，最多自动继续两次，取消或只读回合不继续。这里只处理客户端生命周期，不识别业务关键词或服务名。

Codex 每次调用创建新客户端并恢复原 thread，因此下一次调用加载最新定义。Claude/GLM 通过取消对应会话重建连接，并以原始任务、约束与上一阶段结果衔接。刷新是回合边界加载，不是在正在执行的模型调用里强行变更工具列表。

原生 Codex 项目 TOML 仍遵循 CLI 的项目信任规则。Agent 可通过当前项目的 CLI 用户配置处理信任；仅仅写入工作区 TOML 不代表已被加载。凭证由现有项目登录态或用户授权的服务配置提供，不应输出到群聊或提交到 Git。配置保存、初始化握手、模型工具实际可见、业务任务完成是不同验收层级。

已移除的临时实现包括 `mcp_apply_config`、`mcp_probe`、`mcp_download`、`/api/agent/mcp/tool`、对应配置/探测/下载模块及专属测试、临时配置开关和专用待重载队列。`prism_project` 只保留按需聊天历史。已有用户原生 MCP 配置、源码包和项目登录卷不删除。

## 图片故障的真实原因

Codex 0.146.0 的原生 imagegen 在会话 rollout 中记录
`event_msg/image_generation_end`，其中包含 Base64 `result` 和 `saved_path`。
原图实际保存在 `CODEX_HOME/generated_images/<threadId>/`；订阅模式下即
`/project-auth/codex/generated_images/`。旧 SDK 的 ThreadItem 类型没有暴露
该事件，Prism 只接收了最终文字，聊天界面也没有工作区图片预览能力。
因此“见图”并不代表没有生成图片；下一轮仅搜索 `/workspace` 和 `/tmp`
也不能证明图片不存在。

适配层在当前 thread 完成后读取该 thread 的 rollout，把已完成图片无损保存为
`/workspace/prism-artifacts/<runId>/<sha256>.png`（同时支持 JPEG/WebP），
再将图片及下载链接加入最终回复。不会扫描其他 thread 充当当前产物，失败事件
不产生图片；不可识别的数据或保存失败会明确失败，而不宣称交付成功。
图片目录拒绝符号链接；文件随需求源码卷保留，访问沿用工作区文件权限与鉴权。
Widget、插件和管理端通过鉴权下载得到 Blob 后预览，不公开登录卷或容器路径。

历史消息不会自动回填；旧图可以从原登录卷的 generated_images 或 rollout
恢复，再由用户附到原会话。不要把任意历史图片绑定到不匹配的 run。

## 按需聊天历史

新回合直接提供本批未读消息、成员信息和未解决问题，不再附带最近 30 条正文。
Agent 可调用 `prism_project/chat_history` 指定 query、limit（默认 10，最多 50）、
before 游标，以及 messageId、maxChars、offset 读取长消息。
每次返回最多 32,000 字符，明确给出截断、分页和偏移信息，并返回历史附件的路径。
工具只读当前需求、当前回合开始前的记录，不读取其他需求或回合期间新到的消息。
临时进度不进入历史，最终回复可检索。历史内容标注为不可信聊天数据。

调用使用短期回合 capability，经 Agent 的现有鉴权 WS/exec 桥回平台查询，
不向模型或容器下发平台账号密码或跨项目访问凭证。平台每次查询前后检查成员权限、
需求归属和回合状态，完成或撤权后拒绝查询。旧 Agent 镜像缺少该能力时在派发前
提示更新镜像，不会静默丢失上下文后继续任务。

## 发布与存量环境

需要同时发布平台与 Agent 工作区镜像。平台保存的是固定版本，普通构建不自动替换正在运行的 SIT。已有需求容器必须在空闲时通过平台重建才能取得新环境变量、共享卷挂载和 Agent；仅重启平台不能更新旧容器。重建保留源码卷和项目登录卷，无需删除需求或逐需求重新登录。

## 本次验收（2026-11-26）

- 完整回归 222 项：217 通过、5 跳过、0 失败。Agent、平台、Web 类型检查与生产构建通过；镜像内 Claude、Claude 订阅、GLM、Codex、OpenAI Provider 启动/鉴权/取消能力检查通过。
- 使用真实 Codex 订阅和全新临时工作区，仅提交普通源码检查任务。未预置客户端 MCP 配置或下载文件，Agent 自行读取共享 Skill、写入原生 TOML、调用加载后的 `repo_source/source_info`、用普通终端下载 ZIP、安全解压并说明入口。下载文件与模拟服务预期内容逐字节一致，未执行源码、未使用旧代办工具。原生配置可写、终端网络可用、工具实际暴露均得到验证。
- 两个独立容器读取相同共享卷得到相同文档指纹和 Skill；共享目录写入被拒绝。额外无网络沙箱实验确认本地 `.codex`、`.agents` 可写，工作区外普通目录仍不可写。
- 验收为隔离模拟 MCP/源码服务，未声称恢复或测试真实 DataForge 的具体业务包；临时容器、登录副本与共享卷已清理，真实项目源码和登录态保持原样。
- 已构建平台测试包 `20261126075254176-a4572416` 与镜像 `prism-workspace:sit-20261126-global`，本轮没有重启 SIT 或重建业务需求。镜像复用了已有同版本 code-server 安装，以绕开外部安装包下载卡住的问题；新版 Agent、开发工具和启动检查均已重新构建/执行。脱敏构建与验收结果保存在本机 `.sit/global-runtime-verification.json`。

## SIT 已部署（2026-11-26）

随后按用户授权重启 SIT 并应用上述包及镜像。5 个存量需求容器均升级成功，通过 Agent 就绪、终端网络、只读共享挂载、源码卷与登录凭证保留检查。原先运行的 1 个需求恢复运行，原先停止的 4 个需求恢复停止；无需删除需求或重新登录。详情保存在本机 `.sit/global-deployment-results.json`，回退信息在 `.sit/global-deployment-rollback.json`。
