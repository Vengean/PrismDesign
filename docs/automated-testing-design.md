# PrismDesign Agent 真实应用验证方案

> 目标：Agent 自主理解开发与测试意图，在获得用户授权后准备必要数据、操作用户可见的真实 Web 应用，并以 UI、Network、Runtime 和 Data 证据证明需求成立。它不是生成和维护测试脚本的工具。

## 1. 当前产品形态

用户可以在 Chrome 插件中提出组合任务：

> 开发用户注册模块，完成后开始测试：创建一个 vengeanliu 用户。

Agent 自行理解动作顺序：先完成开发和代码检查，等待页面刷新，再创建 Verification、准备必要数据并调用浏览器工具。用户也可以在开发完成后通过“开始测试”按钮，或继续用自然语言补充测试要求。

本地模式默认操作用户当前可见的 Chrome Tab：

```text
用户自然语言 / 确认按钮
          │
          ▼
Prism Agent + Verification Orchestrator
          │
          ├── verification_*：提议、启动、完成验证
          ├── prism_browser：观察、点击、填写、截图、证据
          └── 项目 MCP（可选）：业务 Fixture/API/DB 能力
          │
          ▼
Chrome Extension + chrome.debugger/CDP
          │
          ▼
用户当前可见页面
```

## 2. 设计原则

1. **Agent 理解自然语言**：开发、立即测试、延后测试及动作顺序由 Agent 判断，不使用服务端关键词正则分类。
2. **状态机负责约束**：服务端只校验 Verification 所属 client、状态转换、页面、能力令牌和资源归属。
3. **测试意图而非测试脚本**：保存目标和断言，由 Agent 根据当前页面重新规划，不维护脆弱 selector 脚本。
4. **先观察再准备数据**：优先复用满足条件的当前登录态；只有前置条件不足或用户要求隔离时才使用 Fixture。
5. **真实可见操作**：本地默认通过 Chrome 扩展的 CDP Runtime/Input 操作用户明确绑定的页面；Playwright 只作为 CI 或无人值守后备。
6. **证据驱动**：结论必须基于 UI、截图、Network、Console/Page Error 或受控数据查询。
7. **项目能力可选**：Fixture Skill/MCP 属于具体项目，Prism 只提供发现、调用和生命周期编排机制。
8. **本地运行不持久化**：Test Run 和 Verification 保存在 Agent 内存，不在开发者源码目录生成数据库。

## 3. 组件职责与边界

| 组件 | 职责 | 是否了解项目业务 |
|---|---|---|
| Chrome 插件 | 对话、显式绑定当前 Tab、执行 CDP 操作与截图、展示状态和结果 | 否 |
| Widget | 对话、确认和结果展示（可选） | 否 |
| Prism Agent | 理解用户意图、规划开发和测试、选择并调用工具 | 只通过 Skill 获得 |
| Verification Orchestrator | 权限和状态转换、Test Run、超时、取消、清理 | 否 |
| Browser MCP/Runtime | observe/click/fill/wait/screenshot/evidence/stop | 否 |
| 项目 Skill | 描述业务前置条件、工具使用方法和验收知识 | 是 |
| 项目 MCP | 受控创建、查询和清理业务数据 | 是 |

Demo 中只有以下内容与具体项目耦合：

```text
demo/server/database.ts
demo/server/fixture-mcp.mjs
demo/.agents/skills/demo-fixtures/SKILL.md
demo/prism.config.mjs
```

其他开发者可以不配置 Fixture MCP，也不需要安装 SQLite。Agent 可以复用当前登录态、使用项目已有 API/测试账号，或在缺少必要前置条件时询问用户。

## 4. Agent 驱动的 Verification

自然语言不由 Chrome 插件或 Agent Server 正则判断。每轮对话会生成一个临时能力令牌，绑定：

```text
clientId + agentRunId + currentPageUrl + 当前对话生命周期
```

Agent 可调用：

```text
verification_get_pending
verification_propose
verification_start
verification_complete
```

流程示例：

```text
Agent 理解用户要求
→ 完成开发（如有）
→ verification_get_pending
→ 复用相关 Verification 或 verification_propose
→ verification_start（仅在用户已授权时）
→ browser_start
→ observe / click / fill / wait / screenshot / evidence
→ 清理测试产生的资源
→ verification_complete(passed|failed|inconclusive)
```

按钮路径是确定性授权：点击“开始测试”后 Orchestrator 直接启动对应 Verification，但实际浏览器操作仍由 Agent 通过工具完成。

## 5. 当前 Tab Browser Runtime

Browser MCP 提供：

```text
browser_start        browser_navigate
browser_observe      browser_click
browser_fill         browser_press
browser_wait         browser_screenshot
browser_evidence     browser_stop
```

`browser_observe` 返回压缩语义模型：

```json
{
  "url": "/notes",
  "title": "我的笔记",
  "elements": [
    { "ref": "e1", "role": "button", "name": "新建笔记" },
    { "ref": "e2", "role": "textbox", "name": "搜索笔记" }
  ]
}
```

页面变化后旧 ref 失效，Agent 应重新 observe。操作优先使用 ref、role/name 和 label，CSS selector 仅作受控退路。

Chrome 连接规则：

- WebSocket 打开并完成 `browser:register` 后才显示已连接。
- URL 变化和页面加载完成时重新注册。
- 用户点击插件图标时直接使用 `chrome.action.onClicked(tab)` 确定确切 Tab。
- 绑定的 `tabId` 保存到 `chrome.storage.session`，Service Worker 重启后恢复并验证该 Tab；绑定失效时要求用户重新选择。
- Chrome 通过“打开侧边栏”入口绕过 `action.onClicked` 时，Side Panel 仅在首次打开且没有绑定的瞬间读取最后聚焦普通窗口的 active Web Tab，并立即固化；运行期间不跟随 active Tab。
- Side Panel 已打开时再次点击其他页面的插件图标，会显式断开旧 Tab 并将 Agent/WebSocket 重绑到新 Tab。
- `browser_start` 最多等待 8 秒完成当前 Tab 注册，并仅对绑定的 HTTP(S)/file Tab 执行 `chrome.debugger.attach`。
- Prism Browser MCP 固定使用 Chrome 插件提供的 current-tab CDP 运行时。
- Codex SDK 子进程局部禁用继承自桌面 Codex 的 bundled Browser 插件和 node_repl 浏览器后端，避免模型绕过 `prism_browser` 选择无实例的通用运行时；不修改用户全局 Codex 配置。
- 页面跳转后保持同一个 `tabId`，不重新查询 active Tab；Runtime/Input/Page/Network 由 CDP 提供。
- `browser_fill` 对 input/textarea 使用 CDP Runtime 原生 value setter 与 input/change 事件，避免账号密码 Autofill UI 抢焦点；contenteditable 使用 CDP Input。
- 测试完成、失败、取消或超时时由服务端兜底 detach。

## 6. Fixture 与当前登录态

Fixture 是项目为测试准备的确定、可清理业务数据，不是 Prism 插件的内置数据库能力。

默认决策原则：

1. 先 `browser_start` 和 `browser_observe`。
2. 当前登录态满足测试前置条件时直接复用。
3. 不主动 logout、注册新账号或替换当前会话，除非测试目标需要、权限不足、隔离必要或用户明确要求。
4. 对当前账号执行高风险或难恢复操作时先询问用户。
5. Fixture MCP 只提供具名业务工具，禁止任意 SQL。
6. 测试产生的数据应恢复或清理，并在结果中说明。

Demo 当前提供：

```text
fixtures_create_user
fixtures_create_note
fixtures_get_user
fixtures_get_note
fixtures_cleanup_run
```

这些工具属于 Demo，不属于 Chrome 插件或 Prism Agent 核心。

## 7. Test Run 内存生命周期

Test Run 仅存在于 Agent 内存：

```ts
type TestRunStatus =
  | "preparing"
  | "running"
  | "cleaning"
  | "passed"
  | "failed"
  | "inconclusive"
  | "cancelled"
  | "timed_out";
```

当前生命周期：

```text
创建 Test Run
→ 登记资源 Cleanup Stack
→ running
→ passed / failed / inconclusive / cancelled / timed_out
→ cleaning（LIFO、幂等、单项失败不阻塞其他项）
→ 释放浏览器调试资源
```

可靠性规则：

- 默认空闲超时 120 秒，每次工具开始或完成时重新计时；可用 `PRISM_TEST_RUN_TIMEOUT_MS` 调整。
- 用户可点击“取消运行”，同时 abort Agent 并执行 Cleanup Stack。
- Chrome WebSocket 断开后有 10 秒重连宽限；超时仍未恢复则取消活跃 Test Run。
- Agent Server 保存活跃 Agent Run 的最近阶段和进度，侧边栏重开后立即恢复状态，无需等待下一个事件。
- Agent 服务重启后旧内存运行失效，插件将旧 running 状态转换为 inconclusive，不显示技术性 `Failed to fetch`。

诊断接口：

```text
GET /api/browser/diagnostics
```

返回 WebSocket 连接、当前 Tab 注册、活跃 Agent Run、活跃 Test Run 和 debugger 模式。

## 8. 当前结果与证据

目前已支持：

- 当前 URL 和语义 DOM 观察。
- 实际点击、填写、按键和等待。
- 页面截图。
- 基础 Network response 状态。
- Console warning/error 和 Page Error 检查。
- 项目 MCP 的受控数据查询。
- passed、failed、inconclusive、cancelled 结构化结果。
- 完成态消息去重：卡片只显示状态和重新测试，Agent 正文显示详细结论。

敏感信息要求：密码、token、cookie、authorization 不能进入最终报告或长期日志；密码输入值在 DOM 观察中必须脱敏。

## 9. 当前进度（2026-08-07）

### 已完成：第一阶段——可靠运行

- [x] Agent 自主理解测试时机，不使用用户意图正则分流。
- [x] `verification_get_pending/propose/start/complete` 工具。
- [x] Chrome 当前 Tab 可见操作闭环。
- [x] Test Run 内存模型。
- [x] Cleanup Stack（LIFO、幂等、结果记录）。
- [x] 正常完成、失败、取消、超时的浏览器 detach 兜底。
- [x] 手动取消入口和友好取消结果。
- [x] 120 秒空闲超时，工具开始或完成时刷新。
- [x] WebSocket 10 秒断线宽限和自动重连。
- [x] 重开侧边栏后恢复活跃 Agent/Test Run 及最近进度。
- [x] Agent 重启后的陈旧状态清理。
- [x] 浏览器连接诊断接口。
- [x] SQLite 文件不计入源码修改。
- [x] Demo Node API、SQLite 业务库、Fixture MCP 和 Fixture Skill 示例。

### 已验证场景

- 开发完成后 Agent 自主启动真实浏览器测试。
- 通过后续自然语言启动 pending Verification。
- 复用当前登录用户测试笔记新建/编辑。
- Network 200/201、Console/Page Error 和刷新后持久化检查。
- 测试后恢复业务数据并退出 Chrome 调试模式。
- 手动取消及资源清理。
- 侧边栏短暂断线后继续执行并恢复状态。
- Agent 停服/重启后清理陈旧 running 状态。
- 测试结果正文与状态卡片去重。

## 10. 接下来待办

### 第二阶段：可视化

1. **结构化步骤事件**（已完成基础链路）：记录并展示 Agent 实际选择和执行的工具动作，不预设固定步骤或强制使用 Fixture。
2. **测试结果详情**（已完成）：处理状态和最终结果归并在同一条对话消息中；测试完成后可按需展开实际步骤、耗时和错误。
3. **业务测试用例结构化**（下一项）：将 Agent 拟定的用例与最终状态（通过、失败、未执行、证据不足）持久化；与底层工具执行步骤分开呈现。
4. **Screenshot 证据**（下一项）：展示关键截图、关联测试用例或步骤并允许放大。
5. **Network/Console 证据**：按请求、状态码、Console/Page Error 分类展示并脱敏。
6. **测试历史持久化**：Agent 重启后仍可查看用例、结果、步骤和证据。
7. **浏览器环境预检**：测试前检查目标 Tab、站点权限、Agent/WebSocket、页面地址和可能干扰密码输入的自动填充环境。
8. **清理结果展示**（已完成基础链路）：展示浏览器资源和项目 Fixture 的清理结果。
9. **浏览器诊断 UI**：把 `/api/browser/diagnostics` 转换为用户可理解的连接检查。

> 明日优先实现：业务测试用例结构化，然后接入 Screenshot 证据展示。

#### Screenshot 存储约定

- 截图由 Agent 保存，不写入用户 Git 工作区，也不存为 SQLite BLOB。
- 本地开发默认目录：`.prism/test-runs/<testRunId>/screenshots/`。
- 平台部署目录：`/data/prism/test-runs/<workspaceId>/<testRunId>/`，由 Workspace 持久化数据卷承载。
- SQLite 仅保存 `testRunId`、关联用例/步骤、相对路径、MIME、尺寸和创建时间等元数据。
- 默认按保留天数和 Workspace 容量上限清理；删除测试记录时同步删除截图，Fixture Cleanup 不删除测试证据。

步骤由两个来源产生：

- 工具调用自动生成事实步骤，例如“点击新建笔记”“保存接口返回 200”。
- Agent 主动提交业务断言，例如“刷新后新笔记仍然存在”。

### 第三阶段：智能闭环

1. 失败分类：代码缺陷、环境问题、数据问题、权限问题、证据不足。
2. 基于证据生成修复建议。
3. 用户授权或策略允许时自动修改代码。
4. 等待 HMR/页面重新注册。
5. 自动复测一次，并限制最大修复次数和运行时间。

### 尚未完成的基础能力

- 项目 Fixture MCP 向 Prism Cleanup Stack 注册通用清理句柄的协议。
- Agent 正常结束但项目 Fixture 清理失败时的统一告警。
- `api.request` 与复用浏览器 cookie/CSRF 的 `browser.request`。
- 多个同源 Chrome Tab 的明确选择 UI。
- 浏览器命令的单步骤超时和最大操作数限制。
- OpenAI/Claude/GLM 与 Codex 的 Verification 工具行为完全对齐。
- 自动化集成测试覆盖 Agent 重启、Chrome 重连、取消和超时。

## 11. 平台化边界（暂不开发）

本地插件阶段不在开发者项目中创建 Verification SQLite，也不长期保存截图、网络证据或运行历史。

未来 Prism Platform 才负责：

- PostgreSQL 中的运行、步骤、权限和审计记录。
- 对象存储中的截图、视频和日志。
- Browser Worker、并发队列、配额和超时调度。
- workspace/用户隔离、域名策略和 Secret 管理。
- 测试历史、失败回放、团队报表和证据保留策略。

用户项目只保留可选配置与业务知识：

```text
prism.config.*
.agents/skills/*
项目自有 MCP（可选）
```

## 12. 下一验收目标

第二阶段优先以“当前已登录用户测试新建/编辑笔记”为验收场景：

```text
观察并复用当前登录态
→ 打开编辑器
→ 修改可恢复数据
→ 保存并检查 Network
→ 刷新确认持久化
→ 检查 Console/Page Error
→ 恢复原数据
→ 展示结构化步骤、截图、证据和清理结果
```

该场景不得主动 logout 或创建 Fixture，除非当前状态无法满足前置条件或用户明确要求隔离账号。
