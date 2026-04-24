# PrismDesign Chrome Extension

PrismDesign 的浏览器端插件，提供可视化 UI 编辑能力。设计师可以直接在网页上点击元素、调整样式、编辑文字，所有修改通过 AI Agent 自动同步到源码。

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

1. 点击 Chrome 工具栏中的 PrismDesign 图标，打开侧边栏
2. 输入 Agent 服务地址（如 `http://192.168.1.100:9527`）
3. 点击「连接」，状态显示「已连接」即可

### 第二步：开启设计模式

1. 打开你要编辑的 Web 页面
2. 在侧边栏点击「开启设计模式」
3. 页面光标变为十字准星，鼠标悬停时元素会高亮

### 第三步：编辑元素

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

### 第四步：保存修改

1. 侧边栏「待保存的修改」区域显示所有变更
2. （可选）在「AI 补充说明」输入框中添加额外指令，例如：_"这几处修改需要同时应用到所有卡片组件"_
3. 点击「保存修改 → AI 同步到代码」
4. Agent 调用 AI 分析变更并修改源码，页面通过 HMR 自动更新

### 回退

- 点击「放弃所有修改」可丢弃所有未保存的修改并刷新页面
- Agent 端也支持 git rollback

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
