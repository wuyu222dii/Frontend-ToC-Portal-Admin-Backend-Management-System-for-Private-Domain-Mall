# 青序生活三端私域商城

本仓库实现消费者微信小程序、一级代理工作台、总部管理后台，以及共享的 NestJS API 和 Worker。当前开发按 `B0` 至 `B19` 小批次推进；B0、B1 已验收通过，B2 总部安全入口已完成实现与本地/临时环境门禁，Supabase 远端证据按 CH-007 延期。B3.0 CH-006 契约解阻、B3.1 文件基础和 B3.2 品牌分类的本地/一次性环境验收均已通过并暂停，B3.3 未开始；远端证据补齐前不得标记 B3 整体完成或进入 staging/production。

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

启动 Compose 前以 `.env.example` 为字段清单创建 `.env`，真实数据库密码仍应从 Secret Store 注入，不能提交。Redis 与 MinIO 仅监听本机回环地址；MinIO 控制台默认为 `http://127.0.0.1:9001`。端口被占用时，只在本地 `.env` 设置 `REDIS_PORT`、`MINIO_API_PORT` 或 `MINIO_CONSOLE_PORT`，不修改共享默认值。

常用命令：

```bash
pnpm dev:miniapp
pnpm dev:agent
pnpm dev:admin
pnpm dev:api
pnpm dev:worker
pnpm admin:bootstrap # 受控创建首个 SUPER_ADMIN；读取 TTY 或 0600 密码文件
pnpm contracts:lint
pnpm contracts:check
pnpm prisma:validate
pnpm db:migrate:baseline # CI 临时空库专用
pnpm db:supabase:bootstrap # 受控的 Supabase 首次初始化
pnpm db:test-b3-master-data # B3.2 数据库 full/rollback 门禁
pnpm db:test-b3-catalog-api # B3.2 真实 Nest + PostgreSQL + Redis 纵向门禁
pnpm db:diff
```

Supabase 项目创建、连接分权和受保护烟测见 [B0 工程与 Supabase](product-materials/docs/05-开发管理/B0-工程与Supabase.md)，公共内核边界见 [B1 平台公共内核](product-materials/docs/05-开发管理/B1-平台公共内核.md)，总部认证实现与安全操作见 [B2 总部安全入口](product-materials/docs/05-开发管理/B2-总部安全入口.md)，CH-006 与 B3 分段门禁见 [B3 文件、品牌与分类](product-materials/docs/05-开发管理/B3-文件品牌与分类.md)。普通 PR 只使用 CI 的临时 PostgreSQL，不读取 Supabase 凭据。

B3.1 已交付文件上传与清理闭环；B3.2 已交付品牌/分类 14 个管理端 operation、精确幂等重放、高风险预览确认和并发依赖保护。用户已批准把 CH-007 扩展到整个 B3：B3.3 可在明确继续后使用本地和一次性环境实施；B2/B3 Supabase development rollback-only 与 GitHub 受保护运行证据统一在 B3 最终验收前补齐，本地结果不能替代远端证据。
