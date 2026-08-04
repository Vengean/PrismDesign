# PrismDesign 自动化测试方案设计

> 核心目标：Agent 开发完成后，自动验证功能是否正确，包括后端 API 返回数据是否符合预期。

## 1. 业内主流方案及问题

### 1.1 单元测试

- **工具**：Jest、Vitest、Mocha
- **测试范围**：纯函数、工具方法、独立逻辑
- **存在问题**：
  - 前端项目覆盖率普遍低
  - 写测试成本高，维护成本更高
  - 业务迭代快时测试代码跟不上变化

### 1.2 组件测试

- **工具**：React Testing Library、Vue Test Utils
- **测试范围**：组件渲染、用户交互、状态变化
- **存在问题**：
  - 需要 mock 大量依赖（API、路由、store）
  - mock 与真实环境不一致，测试通过但线上出 bug

### 1.3 E2E 端到端测试

- **工具**：Playwright、Cypress、Selenium
- **测试范围**：真实浏览器中跑完整流程，前后端联调
- **存在问题**：
  - 慢、脆弱、成本高
  - 元素定位容易失效，异步等待难处理
  - 维护成本极高，CI 中容易出现 flaky test

### 1.4 API 测试

- **工具**：Postman、Supertest、Pactum
- **测试范围**：后端接口的输入输出
- **存在问题**：
  - 和前端脱节，测了接口不代表前端用对了
  - 测试数据管理复杂

### 1.5 共同的核心问题

**测试代码是人写的，成本高、容易过时、覆盖不全。**

- 大多数团队只在关键路径上写少量测试
- 业务变更后测试未同步更新，变成误报
- 写测试的时间经常比写业务代码还多
- 没人愿意写，写了也没人维护

## 2. AI 能解决什么

AI 的核心价值不是"更好地跑测试"，而是**消除写测试和维护测试的成本**。

| 传统方式 | AI 驱动 |
|---|---|
| 人工编写测试用例 | Agent 根据需求自动生成 |
| 测试代码需要长期维护 | 一次性生成，用完即弃 |
| 改了业务代码要同步改测试 | 每次根据最新代码和需求重新生成 |
| 需要人判断该测哪些路径 | Agent 知道改了什么，自动推导测试路径 |
| mock 与真实环境不一致 | Agent 直接调真实 API 验证 |

## 3. PrismDesign 自动化测试方案

### 3.1 整体流程

```
用户描述需求
  → Agent 理解需求，明确预期行为
  → Agent 修改业务代码
  → Agent 根据需求自动生成测试用例
  → Agent 执行测试
      ├── 调用后端 API，验证返回数据
      ├── 通过 Widget 验证前端状态
      └── 检查控制台是否有错误
  → 测试失败 → 自动修复 → 重新测试
  → 全部通过 → 回复用户"已完成，测试通过"
```

### 3.2 测试能力分层

#### 第一层：API 验证（Agent 直接执行）

Agent 通过 Bash tool 直接调用后端 API，验证返回数据：

```
Agent 改完代码
  → 构造测试请求（curl / fetch）
  → 发送到 dev 环境的 API
  → 验证响应状态码、数据结构、字段值、业务逻辑
```

- 不依赖任何测试框架
- Agent 知道业务需求，能自行构造测试数据和预期结果
- 覆盖场景：正常流程、边界值、异常输入

#### 第二层：前端运行时验证（通过 Widget 执行）

Widget 作为页面内的测试 runtime，Agent 通过 WebSocket 下发指令：

```
Agent → WebSocket 指令 → Widget 执行
  ├── DOM 查询：检查元素状态、文本、样式
  ├── 交互模拟：click、input、hover 等操作
  ├── 状态检查：查询组件 props、store 状态
  ├── 网络监听：拦截 fetch/XHR，验证请求参数和响应
  └── Console 监听：捕获 error/warning
```

新增 WebSocket 消息类型：

```typescript
// Agent → Widget
interface TestCommand {
  type: "test:query";       // DOM 查询
  | "test:action";          // 交互操作
  | "test:network";         // 网络拦截
  | "test:console";         // 控制台监听
  selector?: string;        // 目标元素
  action?: string;          // 操作类型
  value?: string;           // 输入值
  script?: string;          // 自定义 JS
}

// Widget → Agent
interface TestResult {
  type: "test:result";
  success: boolean;
  data: unknown;            // 查询结果 / 执行结果
  error?: string;
}
```

#### 第三层：业务流程端到端验证

组合 API 验证 + Widget 前端验证，覆盖完整业务流程：

```
Agent 构造测试场景
  → Widget 模拟用户操作（填写表单、点击提交）
  → Widget 拦截前端发出的 API 请求，验证参数
  → Agent 验证后端 API 返回数据
  → Widget 验证前端接收数据后的渲染状态
  → Agent 汇总结果
```

### 3.3 实现路径

#### Phase 1：API 自动验证（零开发成本）

- Agent 改完代码后，在 system prompt 中要求自动验证相关 API
- 利用现有的 Bash tool 执行 curl 调用
- 不需要任何代码改动，只需调整 Agent 的 prompt

#### Phase 2：Widget 测试指令（需要开发）

- Widget 新增测试相关的 WebSocket 消息处理
- Agent 端新增测试指令的生成和结果解析
- 支持 DOM 查询、交互模拟、Console 监听

#### Phase 3：端到端流程验证（需要开发）

- 网络请求拦截能力
- 测试场景编排（多步骤串联）
- 测试报告结构化输出

## 4. 落地需要解决的问题

### 4.1 测试环境

- Agent 需要能访问 dev 环境的后端 API
- Platform 场景下 Agent 在容器内，可直接访问同容器的服务
- 独立部署场景需要配置 API 地址

### 4.2 测试数据

- 简单场景：Agent 自行构造请求参数
- 复杂场景：需要预置数据（数据库 seed）或调用后台管理接口造数据
- 需要考虑测试数据的清理，避免污染环境

### 4.3 第三方依赖

- 涉及支付、短信等外部服务时，需要 mock server
- 可考虑在容器内集成轻量 mock 服务

### 4.4 执行效率

- API 测试通常很快（秒级）
- 前端验证需要等 HMR 生效（通常 1-2 秒）
- 需要设置超时上限，避免 Agent session 长时间挂起
