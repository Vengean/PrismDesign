# 统一 HTTPS 预览部署

## 模式与边界

未配置 `PRISM_PREVIEW_DOMAIN` 时保留本地开发模式：每个预览/IDE 使用 HTTP 动态网关端口。

生产模式配置 `PRISM_PREVIEW_DOMAIN` 后，每个需求、业务服务和 IDE 使用独立 HTTPS 子域名，全部通过一个仅绑定 `127.0.0.1` 的内部网关端口（默认 3100）。不再为每个入口开放公网动态端口，HTML 注入、单次票据、角色校验和 WebSocket 转发均保留。

```text
浏览器 HTTPS :443
  → Caddy（TLS 终止，按域名转发）
    ├─ studio.example.com → 平台 :3000
    └─ p-<摘要>.preview.example.net → 统一网关 127.0.0.1:3100
         → 容器映射端口 → 容器 :8090 → 业务服务
         或 → 容器映射端口 → IDE :8080
```

示例使用不同站点域名隔离业务预览和管理端。不要将管理端放进预览通配域名下。网关严格按 Host 分流，不使用客户端提供的 X-Forwarded-Host/Proto；会话使用带 Secure、HttpOnly、SameSite=Lax 的 `__Host-` Cookie，不设置 Domain。

## 上线步骤

1. DNS：管理端域名 `studio.example.com` 和 `*.preview.example.net` 指向服务器公网 IP。
2. 准备可信证书及私钥，SAN 同时覆盖 `studio.example.com`、`*.preview.example.net`。通配证书可通过 DNS-01 申请；本仓库不包含 DNS 服务商凭证或自动申请流程。证书续期后重新加载 Caddy。
3. 参考 [环境变量示例](../deploy/https.env.example) 设置平台环境变量，并在 Caddy 服务进程中设置对应的域名、证书路径变量。平台 `PRISM_PLATFORM_URL` 必须是管理端 HTTPS origin。证书/私钥保存在仓库外。
4. 构建并部署新版平台和需求镜像。健康检查新增 `/runtime-health.cjs`，旧需求镜像不支持，必须更新镜像后重启需求环境；源码持久卷继续保留。
5. 在 Linux 宿主机运行 Caddy，使用 [Caddyfile](../deploy/Caddyfile)。它与当前采用 host 网络的 Compose 平台共用宿主机 loopback。若变更默认平台端口 3000 或网关端口 3100，同步调整 Caddyfile 的 upstream。
6. 先验证配置：`caddy validate --config platform/deploy/Caddyfile --adapter caddyfile`，再由服务管理器启动/重新加载 Caddy。不要同时运行占用 80/443 的其他代理。
7. 验证 HTTPS 管理端登录、预览 HTML 与 Widget、两项服务分别打开、IDE 和 WebSocket/HMR，确认后在云防火墙关闭旧的动态预览端口范围。公网保留 443 和按需使用的 80（HTTP 跳转），3000/3100 不对公网开放；SSH 管理端口按现有运维策略保留。

此配置提供的是可部署入口，不会自动修改 DNS、签发证书、开放防火墙或更新云端容器。需要实际域名和证书才能完成公网 HTTPS 验收。

## 生命周期与故障

- 子域名由需求 ID、入口类型、业务端口的摘要稳定生成。业务实际端口变化会使用另一子域名；端口相同的环境重启可继续使用原入口。
- 网关票据/会话/路由注册仍是进程内数据，平台重启后需要从管理端重新打开入口。未注册子域名返回 404；已注册入口的未登录页面导航跳回固定管理端地址。
- 业务端口在容器内通过 HTTP 探测，401/404 等响应证明 HTTP 可用，5xx 不计为就绪。此检查是入口可用性检查，不代表业务接口或数据库全部健康。
- 唯一 HTML 服务优先作为默认入口；只有一个 HTTP 服务时直接使用。多个候选且没有唯一 HTML 页面时，用户选择服务，平台不会按端口大小猜测。
- Agent 和至少一个 HTTP 服务均就绪才标记环境运行中；HTTP 服务先就绪时可以先打开预览。启动超时默认 120 秒，准备（拉库/初始化）超时默认 1800 秒，通过对应环境变量调整。
- 服务失联后进入启动中，允许在启动期限内恢复；超时会终止该需求容器的进程，不删除持久源码卷。重新启动读取项目当前配置。
- 代理等待响应头和空闲读取有界（容器内默认 30 秒，外层 35 秒）；WebSocket 握手有超时，建立后的长连接不受该握手期限限制。
