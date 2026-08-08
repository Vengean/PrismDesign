# Prism Chrome Extension

棱镜平台的浏览器工作入口，面向产品、设计和研发团队，将运行中的 Web 页面与源码工程、AI Agent 和真实浏览器验证连接起来。用户可以通过自然语言开发页面、直接选中元素进行可视化调整，并让 Agent 在当前页面执行真实交互测试；所有代码修改仍落在工程源码中。

核心能力：

- **AI 页面开发**：在页面上下文中描述需求，由 Agent 理解工程并修改源码。
- **可视化调整**：选中页面元素，调整样式、文字和布局，再同步为工程代码。
- **真实浏览器验证**：授权 Agent 操作当前 Chrome 页面，执行点击、填写、跳转、截图及网络/运行时检查。
- **平台工作空间连接**：连接本机或局域网内工作空间的 Agent，在同一侧边栏查看处理过程和测试结果。

## 安装

### 1. 构建

```bash
# 在项目根目录
pnpm install
pnpm build:chrome-ext

# 或在 chrome-ext 目录
cd packages/chrome-ext
npm run build
```

构建产物输出到 `dist/` 目录。

### 2. 加载到 Chrome

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `packages/chrome-ext/dist/` 目录

### 3. 开发模式（实时构建）

```bash
cd packages/chrome-ext
npm run dev
```

修改代码后 `dist/` 会自动更新，在 `chrome://extensions/` 点击刷新按钮即可生效。

## 使用流程

### 第一步：连接 Agent

先在目标源码项目中启动任一 Provider：

```bash
# 使用本机 Codex/ChatGPT 登录态
prism-design-agent start --provider codex

# 或 OpenAI Agents SDK
OPENAI_API_KEY=sk-xxx prism-design-agent start --provider openai
```

1. 点击 Chrome 工具栏中的 PrismDesign 图标，打开侧边栏
2. 输入 Agent 服务地址（如 `http://192.168.1.100:9527`）
3. 点击「连接」，状态显示「已连接」即可

### 第二步：通过 AI 开发或修改页面

在聊天区描述开发目标、业务交互或代码修改要求。插件会携带当前页面和已选元素的上下文交给 Agent，由 Agent 修改对应源码并通过开发服务器刷新页面。

### 第三步：按需开启可视化模式

1. 打开你要编辑的 Web 页面
2. 在侧边栏点击「开启设计模式」
3. 页面光标变为十字准星，鼠标悬停时元素会高亮

### 第四步：编辑元素

点击页面上的任意元素，弹出浮动编辑工具栏：

| 功能 | 说明 |
|------|------|
| 颜色 | 文字颜色选择器 |
| 背景 | 背景颜色选择器 |
| 字号 | 10–72px 滑块 |
| 字重 | Light / Normal / Medium / SemiBold / Bold / ExtraBold |
| 行高 | 0.8–3 倍数滑块 |
| 内边距 | padding 0–80px |
| 外边距 | margin 0–80px |
| 圆角 | border-radius 0–50px |
| 间距 | gap 0–60px |
| ✏️ 文字 | 直接编辑元素文本内容 |
| ↕ 拖拽 | 拖动元素调整排列顺序 |

所有修改实时预览，不会立即写入源码。

### 第五步：保存修改

1. 侧边栏「待保存的修改」区域显示所有变更
2. （可选）在「AI 补充说明」输入框中添加额外指令，例如：_"这几处修改需要同时应用到所有卡片组件"_
3. 点击「保存修改 → AI 同步到代码」
4. Agent 调用 AI 分析变更并修改源码，页面通过 HMR 自动更新

### 第六步：验证页面

当 Agent 完成开发并提出测试用例后，点击「开始测试」。棱镜会通过 CDP 操作打开插件时确定的当前页面，执行真实点击、填写、跳转、等待和截图，并收集网络及运行时证据。测试完成后可以在结果消息中展开实际执行步骤或重新测试。

### 回退

- 点击「放弃所有修改」可丢弃所有未保存的修改并刷新页面
- Agent 能力由 `/api/status` 返回；只有 Provider 声明支持时才应显示 Agent 级回退/取消操作

## 组件检测

插件自动识别 React 和 Vue 组件：

- **React**：通过 `__reactFiber$` 读取组件名、props、源文件路径和行号
- **Vue**：通过 `__vueParentComponent` 或 `__vue__` 读取组件信息

> 注意：生产构建（minified）的组件名可能为匿名或压缩后的名称。开发模式下效果最佳。

## 支持的页面

- `http://localhost:*/*`
- `http://127.0.0.1:*/*`
- 所有 `http://` 和 `https://` 页面

## 架构

```
┌─────────────────────────────────────────────────────┐
│  Chrome Extension                                   │
│                                                     │
│  ┌──────────┐  chrome.tabs  ┌───────────────────┐   │
│  │ Side Panel│◄────────────►│  Content Script    │   │
│  │ (侧边栏)  │  .sendMessage│  (注入目标页面)     │   │
│  └────┬─────┘              │  - 元素选择/高亮     │   │
│       │                    │  - 浮动编辑工具栏    │   │
│       │ HTTP / WebSocket   │  - 样式实时修改      │   │
│       ▼                    └───────────────────────┘  │
│  ┌──────────┐                                        │
│  │ Agent    │  ← 远程 AI Agent 服务                   │
│  │ Client   │                                        │
│  └──────────┘                                        │
└─────────────────────────────────────────────────────┘
```

扩展为每个 tab 生成独立 `clientId`，聊天请求和 WebSocket 事件不会在不同 tab 间串线。扩展兼容 Agent Protocol v2 的文本增量、工具进度和文件变更事件。

### 消息协议（Content Script ↔ Side Panel）

| 消息类型 | 方向 | 说明 |
|---------|------|------|
| `DESIGN_MODE_ON` | Side Panel → Content | 启用设计模式 |
| `DESIGN_MODE_OFF` | Side Panel → Content | 关闭设计模式 |
| `ELEMENT_SELECTED` | Content → Side Panel | 携带选中元素信息 |
| `SAVE_CHANGES` | Side Panel → Content | 收集当前所有修改 |
| `CLEAR_CHANGES` | Side Panel → Content | 清除修改记录 |

## 常见问题

**Q: 点击元素没有反应？**
- 确认已点击「开启设计模式」
- 刷新目标页面（安装/更新插件后需要刷新）
- 打开 DevTools Console 检查是否有 `[PrismDesign] Content script loaded` 日志

**Q: 修改保存后页面没更新？**
- 确认 Agent 服务正在运行且目标项目的 dev server 支持 HMR
- 检查侧边栏的连接状态是否正常

**Q: Agent 地址可访问但侧边栏一直显示未连接？**
- 打开 `http://127.0.0.1:9527/api/status` 检查 Provider 状态
- 确认页面和扩展能够访问 Agent 所在主机/端口
- 局域网场景不要填写远程机器自己的 `localhost`

## 发布检查

```bash
pnpm --filter @prism-design/chrome-ext build
```

在 `chrome://extensions` 重新加载 `packages/chrome-ext/dist`，至少验证工作空间连接、AI 对话改码、元素选择、源码同步、真实浏览器测试和断线重连。
