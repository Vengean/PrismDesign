# Prism Studio 腾讯云部署（amd64）

适用：Ubuntu 24.04 / Docker 29，2 核 2GB + 2GB Swap 的测试服务器。
用户自行保证只运行一个需求；当前需求容器资源限制不代表 2GB 主机一定足够，项目依赖/构建较重时可能仍需停止 IDE 或释放内存。

## 上传与安装

将平台镜像、工作镜像、compose.yaml、.env.example 和 SHA256SUMS 放到服务器同一目录，例如 `~/prism-studio`。

```bash
cd ~/prism-studio
sha256sum -c SHA256SUMS
sudo docker load -i prism-platform-amd64.tar.gz
sudo docker load -i prism-workspace-amd64.tar.gz
cp .env.example .env
chmod 600 .env
nano .env
```

在 .env 中填写公网 IP、管理员初始强密码、JWT_SECRET。可用 `openssl rand -hex 32` 生成 JWT_SECRET；不要把真实凭证提交到代码仓库。ADMIN_PASSWORD 仅首次创建管理员生效。

```bash
sudo docker compose up -d
sudo docker compose logs -f --tail 100 platform
```

打开 `http://公网IP:3000`。登录后创建项目、配置代码仓库凭证与 Agent SDK、创建并启动一个需求。

## 防火墙

管理平台：放通 TCP 3000，测试期建议仅允许本人公网 IP。当前预览/VS Code 使用独立动态端口，不仅是 3000。

```bash
cat /proc/sys/net/ipv4/ip_local_port_range
```

按输出范围在腾讯云防火墙中仅对测试者公网 IP 放通 TCP；如果服务器启用 UFW，还需同步检查主机规则。不要向公网开放 Docker API，也不要直接开放内部 Agent 9527。

当前包仍是 HTTP 动态端口测试部署，不包含统一 HTTPS 域名与正式反向代理方案。

## 持久化与运维

- 本目录 `data/` 保存 SQLite 数据库与凭证加密密钥，备份时要包含 credentials.key。
- 需求源码保存在 Docker 的 prism-req-code-* 卷中，更新平台镜像不会迁移或删除它们。
- 不要执行 `docker compose down -v`、删除需求卷或全局 prune --volumes。
- 更新平台：加载新镜像后执行 `sudo docker compose up -d`。平台重启会将未结束任务标记中断，先等待任务完成。
- 平台使用 host 网络和 Docker socket 调度需求容器，只供受信任的成员使用。
- 镜像不含本地平台账号、数据库、模型凭证或 Git 凭证。
