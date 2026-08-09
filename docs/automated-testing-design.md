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
verification_define_cases
verification_update_case
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
browser_response_body（仅异常诊断时按需调用）
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

## 9. 当前进度（2026-08-09）

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

### 已完成：第二阶段——结构化结果与运行期证据

- [x] 业务测试用例与底层工具执行步骤分层展示。
- [x] 用例逐项状态：通过、失败、未执行和证据不足。
- [x] 整体通过必须建立在全部业务用例通过之上。
- [x] Network、Console Warning/Error 和 Page Error 结构化证据。
- [x] Evidence ID 与业务测试用例关联。
- [x] Chrome 发送前与 Agent 归档前双重脱敏。
- [x] 异常时按需读取指定 JSON Response Body 的脱敏受限预览。
- [x] 旧聊天记录缺少新增字段时的兼容恢复。

### 已完成：第三阶段——用户授权式修复闭环（基础链路）

- [x] 失败分类和具体修复建议。
- [x] 测试过程中禁止直接修改代码。
- [x] 失败结果卡提供“修复问题”入口。
- [x] 用户点击后携带原目标、失败用例和建议进入开发修复。
- [x] 修复完成后生成新的待确认复测项，不自动操作浏览器。

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
- 业务测试用例逐项结论与工具步骤分层展示。
- Network/Console/Page Error 分类展示并关联业务用例。
- JSON Response Body 只在异常诊断时按需读取、脱敏和裁剪。
- 测试失败后由用户点击授权修复，修复完成后生成复测项。

## 10. 接下来待办

### 第二阶段：可视化

1. **结构化步骤事件**（已完成基础链路）：记录并展示 Agent 实际选择和执行的工具动作，不预设固定步骤或强制使用 Fixture。
2. **测试结果详情**（已完成）：处理状态和最终结果归并在同一条对话消息中；测试完成后可按需展开实际步骤、耗时和错误。
3. **业务测试用例结构化**（已完成内存链路）：Agent 在执行前定义业务断言，逐项提交通过、失败、未执行或证据不足；与底层工具执行步骤分开呈现。整体通过要求所有业务用例均通过。
4. **Screenshot 证据**（暂缓）：当前不实现截图保存及历史展示；后续需先确定用户浏览器本地存储与临时模型传输边界。
5. **Network/Console 证据**（已完成运行期链路）：按 Network、Console、Page Error 分类展示，证据使用 ID 关联业务用例，并在 Chrome 发送前及 Agent 归档前双重脱敏。
6. **测试历史持久化**：Agent 重启后仍可查看用例、结果、步骤和证据。
7. **浏览器环境预检**：测试前检查目标 Tab、站点权限、Agent/WebSocket、页面地址和可能干扰密码输入的自动填充环境。
8. **清理结果展示**（已完成基础链路）：展示浏览器资源和项目 Fixture 的清理结果。
9. **浏览器诊断 UI**：把 `/api/browser/diagnostics` 转换为用户可理解的连接检查。

> 下一项优先实现：浏览器环境预检。Screenshot 保存及历史展示暂缓。

#### 业务测试用例约定

- `TestCase` 表达用户关心的业务断言，`ExecutionStep` 表达 Agent 实际执行的工具动作，两者不混用。
- 用例状态为 `pending`、`passed`、`failed`、`not_run`、`insufficient_evidence`。
- `passed` 必须包含证据摘要，`failed` 必须包含失败原因。
- Verification 只有在全部用例通过时才能标记为 `passed`；取消、超时或异常结束时尚未执行的用例转为 `not_run`。
- 当前仅保存在 Agent 内存中，不提供跨服务重启的测试历史。

#### Network/Console 证据约定

- `browser_evidence` 返回结构化证据 ID，类型为 `network`、`console` 或 `page_error`。
- Network 记录 method、脱敏 URL、status、resourceType、MIME 和失败原因；Console 仅保留 warning/error。
- `TestCase.evidenceIds` 与 `TestEvidence.caseIds` 建立双向关联，底层证据仍与业务断言分开保存。
- Chrome 插件发送前清洗一次，Agent 写入 Test Run 前再次清洗；URL 查询参数中的 token、password、authorization、cookie、session、secret 等值以及 Bearer/JWT 不进入运行结果。
- 当前证据仅存在于 Test Run 内存，不做历史持久化。
- 默认只采集 Network 元数据，不读取响应 Body。遇到 4xx/5xx、UI 与结果不一致、业务返回异常或证据不足时，Agent 可使用 `browser_response_body` 读取指定 Network evidenceId 的 JSON 脱敏预览。
- Agent 不能传入任意 URL 或 CDP requestId；服务端只解析当前 Test Run 内部的临时映射。原始 Body 仅在 Chrome 命令处理期间短暂存在，不进入 Test Run、文件、数据库或日志。
- 仅支持 JSON MIME，原始 Body 上限 1 MB；预览限制为最多 8 层、数组前 20 项、单字符串 2 KB，并设置全局节点和字符预算。
- Chrome 先递归脱敏并裁剪，Agent Server 对预览再次脱敏；结果记录读取原因、原始大小、裁剪状态和已脱敏字段路径。

#### Screenshot 约定（暂缓，不实施）

- 当前只允许测试运行中的临时截图观察，不保存截图、不展示历史截图、不写入用户 Git 工作区。
- 后续设计必须先明确由执行测试的用户浏览器本地保存，还是允许临时传输给模型；服务端持久化截图不作为当前默认方案。
- 在存储、设备归属、容量、清理和隐私边界确定前，不实现 Screenshot Evidence 历史功能。

步骤由两个来源产生：

- 工具调用自动生成事实步骤，例如“点击新建笔记”“保存接口返回 200”。
- Agent 主动提交业务断言，例如“刷新后新笔记仍然存在”。

### 第三阶段：智能闭环

1. 失败分类（已完成基础链路）：代码缺陷、环境问题、数据问题、权限问题、证据不足和未知问题。
2. 基于证据生成修复建议（已完成基础链路）：失败 Verification 必须提交分类和具体修复建议。
3. 用户授权后修改代码（已完成手动授权链路）：测试过程不修改代码；失败卡片提示用户并提供“修复问题”，点击后才把目标、失败用例和建议交给 Agent 开发修复。
4. 等待 HMR/页面重新注册。
5. 修复完成后生成待确认复测项（已完成）；自动复测、最大修复次数和总运行时间限制尚未实现。

当前闭环：

```text
开发完成
→ 用户授权真实浏览器测试
→ Agent 提交逐项用例和证据
→ 测试失败：分类 + 修复建议
→ 用户点击“修复问题”
→ Agent 修改代码并做代码级检查
→ 生成新的待确认 Verification
→ 用户点击“开始测试”进行复测
```

测试失败本身不构成修改代码的授权；不得在 Verification 运行期间直接修复。环境、数据或权限问题同样展示处理建议，但 Agent 应根据分类避免把非代码问题伪装成代码缺陷。

### 尚未完成的基础能力

- 局域网多用户认证与浏览器隔离：当前 `clientId`、WebSocket 注册和 Browser REST 命令不足以证明调用者与插件所有者一致；共享 Agent 部署前必须加入插件配对 Token、随机 browser instance ID、Verification 级短期能力令牌和严格路由。
- `/api/browser/current/command` 目前不应视为可安全暴露的公开局域网接口；所有浏览器命令必须绑定已认证的插件连接、用户、Tab、Verification 和页面 Origin。
- `/api/test/fetch` 必须删除“找不到指定 client 时退回任意已连接浏览器”的行为，并在复用 Cookie/CSRF 前完成用户和浏览器实例授权。
- 项目 Fixture MCP 向 Prism Cleanup Stack 注册通用清理句柄的协议。
- Agent 正常结束但项目 Fixture 清理失败时的统一告警。
- `api.request` 与复用浏览器 cookie/CSRF 的 `browser.request`。
- 多个同源 Chrome Tab 的明确选择 UI。
- 浏览器命令的单步骤超时和最大操作数限制。
- OpenAI/Claude/GLM 与 Codex 的 Verification 工具行为完全对齐。
- 自动化集成测试覆盖 Agent 重启、Chrome 重连、取消和超时。

### 2026-08-09 Code Review 待修复

按优先级记录：

1. **P0——局域网多用户隔离**：Agent 监听 `0.0.0.0`，当前 Browser REST/WebSocket 缺少可靠认证与所有权绑定；正常路径操作用户自己的浏览器，但恶意局域网调用者可能伪造 client 或请求服务端向其他已连接插件转发命令。
2. **P1——Provider 能力对齐**：OpenAI Provider 尚未注册结构化 Verification、Evidence 关联和按需 Response Body 工具，按钮测试会因无法提交完整结果而降级为 `inconclusive`。
3. **P1——临时 response handle 生命周期**：Test Run 完成时应立即清空内部 CDP requestId 映射，不能随终态 Run 留在内存。
4. **P1——按失败分类分流动作**：只有 `code_defect` 可以显示明确的代码修改授权；environment、data、permission、insufficient_evidence 和 unknown 应提供各自的处理或继续诊断入口。
5. **P2——Response Body 读取前限流**：应记录 `Network.loadingFinished.encodedDataLength`，在 `Network.getResponseBody` 前拒绝已知超限响应；读取后的 1 MB 检查保留为第二层保护。
6. **P2——Network Evidence 实例身份**：同 method/URL/status 的多次请求不能合并为一个证据并覆盖 response handle；每次响应应有独立请求序号和 Evidence ID。

下一次开发建议从第 1 项开始。在局域网认证与隔离完成前，Agent 应仅用于可信网络，或仅监听 `127.0.0.1` 供单机使用。

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

下一阶段以“测试前发现并解释浏览器环境问题”为验收目标：

```text
用户点击开始测试
→ 检查 Agent/WebSocket 和目标 Tab 绑定
→ 检查页面地址、加载状态和 Chrome debugger 可用性
→ 检查多个同源 Tab、站点权限和输入环境风险
→ 全部通过后启动 Test Run
→ 失败时展示用户可理解的原因和处理操作
```

预检不得修改页面或业务数据；预检失败不创建正在运行的 Test Run，也不进入 Chrome 调试操作阶段。
