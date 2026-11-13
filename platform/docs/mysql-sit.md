# 开发与 SIT 数据库

- `pnpm dev:platform`：SQLite，原 `platform/data/platform.db`，后端 3001。
- `pnpm sit:platform`：MySQL，配置 `platform/.env.sit.local`，后端默认 3002。
- 在 platform 目录可分别使用 `pnpm dev` / `pnpm sit`。
- DEV 前端等待后端就绪，自动选择空闲端口；SIT 直接由构建后的后端提供静态前端，默认访问 `http://localhost:3002`，不使用 Vite 开发服务器。

复制 `platform/.env.sit.example` 为 `.env.sit.local`，填写 DB_HOST、DB_PORT、DB_NAME、DB_USER、DB_PASSWORD。该文件被 Git 忽略，密码不要提交。已创建的 `prism_dev` 数据库可直接用于 SIT，无需重命名。配置专用 SIT 管理员初始密码和 JWT_SECRET；空库首次启动会初始化表和管理员。

开发模式不加载 SIT 配置，固定使用 SQLite。SIT 使用异步 MySQL 连接池，查询与事务共享绑定连接，消息幂等、运行任务唯一约束和会话行锁避免并发任务重复启动。

## 连接与可选数据复制

在 platform 目录执行：

```bash
pnpm migrate:sit --check
# 可选：将现有开发数据作为 SIT 初始数据，只允许目标为空时执行。
pnpm migrate:sit
pnpm build:sit
pnpm sit
```

数据复制通过 SQLite 在线备份获取一致快照，备份在 `platform/data/backups/`。脚本保留用户密码哈希、项目、消息 ID/序号、配置和加密凭证，并将 credentials.key 复制到 `platform/data/sit/`。目标数据写入事务，校验各表记录数；已有 SIT 数据或不同密钥时拒绝覆盖。SQLite 原库始终保留。

SIT 的需求进程、源码卷和附件卷使用 `prism-sit-*` 命名，与开发环境 `prism-*` 隔离。导入的运行状态重置，历史任务不自动重启；导入聊天中的附件元数据不会自动复制 workspace 文件。需要历史附件实文件时另行复制到相应 SIT 卷，开发附件原件不变。

如果不需要开发历史数据，可直接启动 SIT 使用空库；数据库账号须对指定库有建表及读写权限。切回开发仅需停止 SIT、运行 `pnpm dev`，无需回迁 MySQL。

发布工作流的数据库结构版本为 v2，SIT 启动时自动升级。SIT 新分支使用 `prism/sit/` 前缀。若 DEV 已建立实际发布分支，迁移命令会拒绝复制，防止 DEV 与 SIT 共用同一组远端分支；应在 SIT 独立创建项目/发布。尚未创建实际分支的历史数据仍可按上述步骤复制。


## 稳定运行测试包

仓库根目录执行：

```bash
pnpm build:sit:platform
pnpm sit:platform
```

也可在 `platform` 目录执行 `pnpm build:sit`、`pnpm sit`。首次启动必须先打包；启动不会自动构建。SIT 使用 `.env.sit.local` 中的 MySQL、端口和数据配置，数据仍位于独立的 `platform/data/sit`（或 `SIT_DATA_DIR`），不放进测试包。

每次构建将后端、前端和 Widget 输出到独立的 `platform/.sit/releases/<版本>/`，全部成功后才原子更新当前版本索引。SIT 只运行该目录中的 `node dist/server.js`，没有源码监听、HMR 或 Vite 开发进程。修改源码、运行 DEV、普通构建或再次打 SIT 包都不会替换正在提供的文件，也不会触发刷新或停服。失败构建保留上一个可用版本。

更新测试版本时，先打包；确认构建成功后手动停止并重新运行 SIT。运行中的进程始终固定在启动时选择的版本。旧版本不自动清理，避免删除仍在运行的文件；不要手动删除运行中的版本目录。测试包复用本机 Node 与 `platform/node_modules`，安装/删除运行依赖或重启电脑仍需另行安排；这不是脱离运行环境的独立分发包。
