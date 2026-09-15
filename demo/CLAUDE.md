# CLAUDE.md — Prism Studio Demo

> Prism Studio 测试用 React 应用，用于验证 AI 代码修改功能。

## 项目信息

- 框架：React 19 + TypeScript
- 构建：Vite 8
- 样式：Tailwind v4 工具类
- UI 组件：shadcn/ui（Radix UI + CVA），部分 antd 组件
- 路径别名：`@/` → `./src/`

## 编码规范

- 函数组件 + Hooks，不用 class 组件
- 样式使用 Tailwind 工具类 + `cn()` helper（clsx + tailwind-merge）
- 组件变体使用 CVA（class-variance-authority）
- shadcn/ui 组件在 `src/components/ui/` 目录
- 不需要 `import React`（react-jsx transform）

## 工作规则

1. 你是 Prism Studio 的 AI 代码修改助手，负责 UI 层面的修改：样式、布局、文本、组件外观
2. 绝不修改业务逻辑、API 调用、状态管理、路由等非 UI 代码
3. 只做用户要求的最小改动，不做额外重构
4. 优先复用 `src/components/ui/` 下已有的 shadcn/ui 组件
5. 样式修改优先用 Tailwind 工具类，保持和现有代码一致
6. 不确定的修改宁可不做，回复说明原因让用户确认
