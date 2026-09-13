# B0 工程与数据库

> 批次：B0；更新日期：2026-09-13；数据范围：仅脱敏开发数据。  
> 文件名保留历史链接。远程库已改为腾讯云 TencentDB PostgreSQL，不再使用 Supabase。

## 1. 交付边界与当前状态

| 项目 | 状态 | 验证方式 |
|---|---|---|
| pnpm monorepo 与五个应用 | 已建立 | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` |
| 本地 Redis 与 MinIO | 已建立 | `docker compose up -d --wait redis minio`、私有 bucket 初始化 |
| 临时 PostgreSQL CI | 已建立 | 空库回放、对象计数、权限/RLS 检查及 Prisma diff |
| 远程 PostgreSQL | TencentDB | 与 API 同 VPC，内网域名 + `sslmode=verify-full` |

开发库只允许脱敏测试数据。`NODE_ENV=development` 可以使用本机 loopback PostgreSQL（推荐 docker `postgres-ci`）；staging / production 必须使用 TencentDB。任何 `SUPABASE_*` 变量都会导致配置校验失败。

新加坡 Supabase development 项目与历史 `Supabase development smoke` / migration workflow 已退役。既往 SHA 与 GitHub Run 记录仍是当时的 development 证据，不再作为现行连接方式。

## 2. 本地开发依赖

1. 使用 `.nvmrc` 中的 Node.js 22 和根 `packageManager` 固定的 pnpm 10。
2. 按审定的开发环境模板创建本地 `.env`，为 Redis 和 MinIO 设置仅开发环境使用的随机凭据；已存在的 `.env` 不得覆盖。
3. 运行 `docker compose up -d --wait redis minio`。
4. 运行 `docker compose run --rm minio-init`，创建默认私有 bucket。
5. 用 `docker compose ps` 检查健康状态。停止服务使用 `docker compose stop`；只有明确需要清空脱敏开发对象时才人工删除 volume。

Compose 默认不包含业务 PostgreSQL，也不向局域网公开 Redis、MinIO API 或控制台端口。

## 3. TencentDB 准入

1. 每个环境使用独立的 TencentDB 实例，与 CVM 同地域、同 VPC；关闭外网。
2. 使用内网域名，不要填内网 IP。下载 CA，`DATABASE_URL` / `DIRECT_URL` 必须 `sslmode=verify-full`。
3. 三端只通过 NestJS HTTPS 访问业务表。禁止前端持有数据库连接，禁止使用任何 Data API / `service_role` 密钥。
4. 首次空库初始化只允许 `pnpm db:bootstrap`。基线创建 `mall_migrator`、`mall_runtime` 并移交 76 张应用表；中断在半成品状态时必须人工检查，不得 reset。
5. `DATABASE_URL` 只供 API/Worker，`DIRECT_URL` 只供迁移。两个角色密码独立生成、独立保存和轮换。
6. 初始化成功后从运行环境删除 `DATABASE_OWNER_URL`。
7. 用 runtime 连接验证无 DDL、无 `DELETE`（四张明确例外表除外）、无 `BYPASSRLS`。

详细购买与安全组步骤见 [腾讯云部署方案](../03-技术设计/腾讯云部署方案.md)。脚本约定见 [scripts/db/README.md](../../../scripts/db/README.md)。

## 4. 角色与权限

应用只使用 `mall_runtime` 与 `mall_migrator`。首迁移仍会创建无登录的 `anon` / `authenticated` / `service_role`（以及 bootstrap 补齐的 `authenticator`），仅作为误授权时的拒绝面，不是远程产品能力。

## 5. 一次性本地回放

复制 `.env.local-ci.example` 为 `.env.local-ci`，只在专用终端叠加后运行 `pnpm db:migrate:baseline`。不要把它当作日常 API 的 `.env`。
