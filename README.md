# 青序生活三端私域商城

本仓库实现消费者微信小程序、一级代理工作台、总部管理后台，以及共享的 NestJS API 和 Worker。当前开发按 `B0` 至 `B19` 小批次推进；B0 至 B6 已完成 development 验收。B6 最终实现 SHA `9d8911934a5aa2b09ece2e12935bcafc9ccdcba6` 的 [普通 CI Run 32953444096](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/32953444096) 和 [Supabase rollback-only Run 32954611250](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/32954611250) 为同一 SHA 双绿。CH-015/CH-016 已批准，当前基线为 `v2.4.5 / CH-016`；B7.0-B7.2 已完成并按批暂停，B7.2 退出审查 `P0=0/P1=0`，B7.3 未准入。仅允许 Mock Provider 和脱敏 development，staging、production、真实客户数据、真实微信身份和资金链路继续 `NO-GO`。

## 工程结构

```text
apps/
  miniapp/       uni-app Vue 3 小程序/H5
  agent-web/     Vue 3 一级代理工作台
  admin-web/     Vue 3 + Element Plus 总部后台
  api/           NestJS HTTP API
  worker/        NestJS 异步任务进程
packages/
  contracts/     OpenAPI 契约产物
  config/        共享配置与工程规则
  database/      Prisma/PG runtime 与可靠消息持久化
  platform-core/ 纯安全、错误、幂等哈希和 RBAC 原语
  ui-tokens/     三端设计令牌
  testing/       测试公共能力
prisma/          PostgreSQL 模型与人工审定迁移
product-materials/
  docs/           产品、技术、风控与开发文档
  prototype/      三端可点击原型、设计素材与验收截图
```

产品资料统一从 [资料索引](product-materials/README.md) 进入，业务契约以 [技术设计索引](product-materials/docs/03-技术设计/README.md) 为准。三端只访问 NestJS API，不使用 Supabase SDK、Data API、数据库连接或 `service_role`。

## 本地启动

前置条件：Node.js `22.23.1`、pnpm `10.34.5`、Docker Desktop。PostgreSQL 不在本地 Compose 中运行，开发连接须指向新加坡区域的 Supabase 开发项目。

```bash
pnpm install --frozen-lockfile
docker compose up -d --wait redis minio
docker compose run --rm minio-init
pnpm check
```

启动 Compose 前以 `.env.example` 为字段清单创建 `.env`，真实数据库密码仍应从 Secret Store 注入，不能提交。Redis 与 MinIO 仅监听本机回环地址；MinIO 控制台默认为 `http://127.0.0.1:9001`。端口被占用时，只在本地 `.env` 设置 `REDIS_PORT`、`MINIO_API_PORT` 或 `MINIO_CONSOLE_PORT`，不修改共享默认值。`API_TRUSTED_PROXY_CIDRS` 默认留空，此时 API 不信任任何代理头；只有直接反向代理的明确数字 IP/CIDR 才能加入该配置，IPv4-mapped IPv6 会归一化为等价 IPv4 网段。

常用命令：

```bash
pnpm dev:miniapp
pnpm dev:agent
pnpm dev:admin
pnpm dev:api
pnpm dev:worker
pnpm e2e:b3 # B3.3 总部后台五视口与异常路径 E2E
pnpm e2e:b4 # B4 ADM-03/04 五视口与异常路径 E2E
pnpm e2e:b5 # B5 ADM-07/08 五视口与异常路径 E2E
pnpm admin:bootstrap # 受控创建首个 SUPER_ADMIN；读取 TTY 或 0600 密码文件
pnpm contracts:lint
pnpm contracts:check
pnpm prisma:validate
pnpm db:migrate:baseline # CI 临时空库专用
pnpm db:supabase:bootstrap # 受控的 Supabase 首次初始化
pnpm db:test-b3-master-data # B3.2 数据库 full/rollback 门禁
pnpm db:test-b3-catalog-api # B3.2 真实 Nest + PostgreSQL + Redis 纵向门禁
pnpm db:test-b5-inventory # B5.2 Inventory 数据库/API full/rollback 门禁
pnpm db:test-b7-store-auth # B7.1-B7.2 Store 身份/profile full/rollback 门禁
pnpm db:diff
```

B7.2 账户手机号 HMAC 轮换是受控维护操作，不是日常启动命令。先排空所有仍持有旧 current key 的 API 写实例，并以 `mall_migrator` 连接一次性注入 `STORE_PHONE_HASH_DRAIN_OLD_WRITERS_APPROVAL=DRAIN_OLD_STORE_PHONE_HASH_WRITERS_APPROVED`，运行 `pnpm store:phone-hash:rehash`。重算成功后从配置移除 previous key，再以相同一次性审批运行 `pnpm store:phone-hash:verify`；current-only 验证成功前不得销毁旧密钥。审批变量不得写入 `.env` 或长期 Secret。

`pnpm e2e:b4:vertical`、`pnpm db:test-b4-product-catalog` 与 `pnpm db:test-b5-inventory` 不是日常开发命令：full 模式只允许显式 `CI=true`、`NODE_ENV=test` 和一次性回环 PostgreSQL；B5.2 rollback 模式只允许带可信 CA 的受控 Supabase development runtime 连接，并以外层事务归零。禁止指向 Supabase development 日常数据库执行 full 模式。

Supabase 项目创建、连接分权和受保护烟测见 [B0 工程与 Supabase](product-materials/docs/05-开发管理/B0-工程与Supabase.md)，公共内核边界见 [B1 平台公共内核](product-materials/docs/05-开发管理/B1-平台公共内核.md)，总部认证实现与安全操作见 [B2 总部安全入口](product-materials/docs/05-开发管理/B2-总部安全入口.md)，B3-B6 历史批次见对应开发记录；B7 的 CH-015/CH-016、串行批次和准入边界见 [B7 消费者身份、会话、服务代理与隐私](product-materials/docs/05-开发管理/B7-消费者身份会话与隐私.md)。普通 PR 只使用 CI 的临时 PostgreSQL，不读取 Supabase 凭据。

B3.1 至 B3.3 的文件、品牌/分类与 ADM-05/06 证据继续有效；B4 已交付 Product/SKU，B5 已交付 Banner/库存，B6 已交付匿名 Store API、MP-01 至 MP-06 和真实纵向验收。B7.0-B7.2 已交付冻结契约、Mock 微信登录/CUSTOMER 会话、本人 profile 与账户手机号后端闭环；归因/服务代理、同步注销和小程序身份页面尚未实施。收藏、服务端购物车、地址和交易继续排除。
