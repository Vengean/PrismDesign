# 项目开发接续

更新日期：2026-11-27。本文记录产品迭代、代码约定和后续待办，不是运行日志。开发时先读本文，再按需查看 [开发日志](./development-progress.md) 及专题文档。

## 本次迭代已完成

### 项目与 Agent 能力

- 同一项目的各需求通过只读 `.global` 共享项目 README、知识文档、Skill 和 MCP；需求继续独立工作区，项目登录态共享，项目之间隔离。
- 项目说明生成 README.md，不覆盖仓库自己的 README、AGENTS.md、CLAUDE.md 或本地配置。共享 MCP 使用 `project_` 前缀，本地配置独立保留。
- 需求 Agent 可自行读取规范、安装依赖、配置 MCP/Skill，并通过普通终端访问网络。Codex 保留工作区沙箱，允许必要配置目录写入。
- SDK 原生配置或 Skill 变化后，在当前调用结束时刷新客户端并继续原任务。Codex 恢复原 thread；Claude 修复连续回合的会话续接。
- 已撤回临时 MCP 配置、探测、下载代办工具及对应接口。不要重新引入 DataForge 专用初始化/下载通道，也不要让用户为每个需求手工执行平台内部工具。
- 首次会话不再自动注入最近 30 条正文，Agent 按需通过 `prism_project/chat_history` 查询本需求历史，支持分页和长消息分段。

### 协作与内容展示

- Codex 生成图片保存到需求产物目录，聊天中提供鉴权预览和原图下载，避免“见图”却只有文字。
- 添加项目成员时排除已有成员，并支持修改已有成员角色。
- 区分收发消息气泡，Agent 保持无气泡展示；取消任务显示操作者；执行期间的新消息显示简短待处理分割提示，读取后消失。
- 修复中文标点相邻时 Markdown 加粗不能正确解析的问题。

### 插件、Widget 与性能

- 提供插件版本策略及 ZIP 直接下载，没有单独插件下载页。最低兼容版本仍为 0.7.0。
- Widget 点击仅检测插件握手，不比较版本；有插件就打开侧边栏，无插件或打开失败才显示 Widget。刷新不自动恢复展开，不因版本校验闪开，也没有每 5 秒插件探测。
- 升级提醒悬浮在插件 header 下方，不挤占聊天布局。兼容更新可关闭，同一当前/目标版本记住关闭选择；新目标版本再次提醒。不兼容提醒不可关闭，并阻止交互面板加载。
- 版本限制属于支持此协议的客户端前端控制，不是服务端 HTTP 拒绝。没有版本校验功能的更老插件不能被这一机制完整拦截。
- 限制 CDP 日志、网络请求与截图缓存容量，补齐定时器、观察器和节点引用清理。
- 隐藏 Widget 和后台页面暂停面板实时订阅；恢复时补齐消息，保留草稿和已有图片。
- 稳定 Markdown 回调和图片组件，修复进度及空闲快照导致历史图片重载。被动会话保留最近 200 条消息，旧记录仍可分页加载，主动加载历史不被后台更新丢弃。
- 通知后台跳过纯文本和工具进度的重复状态保存，保留 @、确认与完成通知。

## 已完成的验证

- 最终完整回归：232 项，227 通过、5 跳过、0 失败；Agent、插件、Widget、平台及 Web 的相关类型检查和构建通过。
- 真实 Codex 在全新隔离工作区自行读取共享 Skill、生成原生 MCP 配置、调用原生工具，并通过普通终端下载、解压和分析模拟源码；没有平台代办下载。此验证不等于真实 DataForge 全部业务包接入已经验收。
- Chromium 对比：20 次进度或相同空闲快照的历史图片额外请求，从旧版 20 次降至修复版 0 次；40 次开关后关闭状态无残留面板连接，草稿保留。
- 自动测试覆盖 1 万轮 CDP 事件、截图缓存预算、1000 条通知进度去重、模拟心跳与 1000 次重连资源释放。
- Chromium 界面验证覆盖插件存在/不存在、旧插件分流零 Widget 闪开、提醒浮层位置、关闭持久化、新版本重现及强制提醒不可关闭。
- 没有实际挂测浏览器 48 小时，也没有故障现场的堆快照；不要把短时压力/模拟时钟结果写成已彻底解决 Chrome 长期开启卡死。

## 后续待办

1. **发布与产品验收**：发布本轮最新平台前端/Widget 和插件 0.7.2（Widget 0.3.11），确认实际使用环境中的升级提示、点击分流和性能修复生效。用户已计划重启 SIT；本轮这些前端改动不要求重建需求容器或重新登录 Codex。
2. **浏览器长期卡死定位**：重点覆盖不启用浏览器测试、页面静置一两天的场景。区分页面渲染器、插件后台和整个浏览器；需要实际长跑与故障附近的 JS/DOM、连接及原生图片资源趋势，不能只依靠 CDP 测试缓存归因。
3. **日志产品能力待补齐**：当前需求日志在容器停止后不读取 agent.log；平台侧任务中断原因没有汇总进同一窗口。此缺口已确认但未修复；不要将通用“任务已中断”提示视作具体根因。
4. **MCP 长响应截断定位**：配置/字段说明的长输出曾截断，层级与上限未确认。终端网络与自主配置已经修复，长响应是独立问题，不能据此声称 ZIP 过大或源码下载仍被网络沙箱阻止。

没有新增“必须做服务端强制版本拦截”或“改为多个需求共用一个容器”的需求；需要时另行评估，不自行扩展本次范围。

## 后续开发优先阅读的代码

| 领域 | 入口 |
| --- | --- |
| Agent 权限、自主配置与刷新 | `packages/agent/src/execution-policy.ts`、`runtime-configuration.ts`、`project-context.ts`、`providers/` |
| 项目共享知识与成员配置 | `platform/src/services/project-knowledge.ts`、`projects.ts`、`platform/web/src/components/ProjectKnowledgeFields.tsx` |
| 按需历史与聊天队列 | `platform/src/services/agent-history.ts`、`conversations.ts`、`packages/agent/src/testing/mcp-project-server.ts` |
| 图片持久化与预览 | `packages/agent/src/providers/codex-images.ts`、`packages/ui/src/studio/MessageMarkdown.tsx`、`attachment-client.ts` |
| Widget 点击与插件侧边栏 | `packages/widget/src/platform-ui.tsx`、`packages/chrome-ext/src/sidepanel/App.tsx` |
| 升级提示与下载 | `packages/ui/src/studio/ExtensionUpgradeNotice.tsx`、`platform/src/services/extension-release.ts`、`platform/scripts/extension-distribution.mjs` |
| 长期资源管理 | `packages/ui/src/studio/PlatformPanel.tsx`、`platform-client.ts`、`packages/chrome-ext/src/background/` |

专题：[项目 Agent 配置](./project-agent-context.md)、[浏览器性能排查](./browser-performance.md)、[插件升级](./extension-upgrades.md)。开发日志里的早期方案属于排障历史，当前实现以本文和专题文档的最终方案为准。接续开发不依赖 `/tmp` 中的临时脚本，功能回归已保存到 `platform/tests/`。
