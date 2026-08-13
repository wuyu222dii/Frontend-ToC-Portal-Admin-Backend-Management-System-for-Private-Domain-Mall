# 技术设计交付索引

> 当前基线：MVP/PRD v2.4、CH-001 至 CH-005（2026-08-12）。本目录保存冻结技术契约；B0 工程底座与 B1 公共内核均已验收通过，B2 尚未开始。

| 文件 | 用途 |
|---|---|
| `技术架构说明.md` | 技术栈、三端边界、认证/RBAC、事务锁序、Provider、部署与扩展策略 |
| `API接口文档.md` | 172 个 path、196 个 operation 的文本接口全集、状态、幂等和高风险预览/确认规则 |
| `openapi.yaml` | OpenAPI 3.1 单一可解析契约；与文本目录 196/196 完全覆盖，operationId 唯一 |
| `数据库设计.md` | PostgreSQL/Supabase 表域、ERD、状态机、事务、索引、加密、RLS 与验收门禁 |
| `schema.prisma` | Prisma 7.9.1 逻辑模型：76 models、59 enums、270 个 model-typed relation fields，全部位于 `public` |
| `prisma.config.ts` | 设计验证用 Prisma 7 config；CLI 读取 `DIRECT_URL` |
| `migrations/0001_initial/migration.sql` | Prisma 基线 DDL + PostgreSQL 专属 partial unique/CHECK/触发器/角色/RLS 草案 |

上游真相顺序为：已批准需求变更记录、PRD v2.4、MVP v2.4、原型设计方案。发生冲突时先更新上游基线和本目录契约，不由开发人员临时选择口径。

## 已完成的设计验证

- OpenAPI：172 paths / 196 operations / 305 schemas / 685 schema refs；文本接口覆盖率 100%，dangling ref、generic fallback、单资源错误分页均为 0；Redocly recommended lint 无警告通过。
- Prisma：7.9.1 `format` / `validate` / `generate` 通过；验证用 client 按当前相对输出路径临时生成并在验证后删除，未纳入仓库。
- Migration：在全新本地 PostgreSQL 18.3 空库回放通过，实得 76 张表、17 个条件唯一索引、165 个 `CHECK`、76 张 RLS 表、76 个 policy 和 24 个用户触发器（45 个事件绑定）；基线完成后由 `mall_migrator` 拥有 76 张应用表、59 个枚举和 15 个迁移函数，并已验证可执行后续 `ALTER TABLE`。
- 边界 DML：全部通过，覆盖数据库派生且不可改写的 30 分钟支付窗口、PASS 空证据、ABNORMAL 必须有证据、证据清单封存及追加拒绝、类型化单次验货处置、验货精确覆盖与数量等式、0% 佣金不生成流水和最小数据库权限；`mall_runtime` 仅可硬删收藏、购物车项、客户手机号授权和客户地址四类非交易数据，其他业务表无 `DELETE`。

## Prisma 7 使用边界

B0 已在工程根建立 `prisma.config.ts`、`prisma/` 和五应用脚手架；根目录中的 schema 与首迁移必须和本目录冻结产物逐字节一致。CLI/migration 通过 `DIRECT_URL` 连接，后续 runtime 通过 `@prisma/adapter-pg` 读取 `DATABASE_URL`。三端只调用 NestJS HTTPS API，禁止使用 Supabase client、Data API 或 `service_role` 密钥访问业务表。

## 剩余上线门禁

- 正式微信商户号与证书到位后，在 staging 完成 raw body 验签、证书轮换、重放防护、ACK/重试、迟到支付自动退款和对账演练。
- 在目标 Supabase staging 重放 migration，复核 TLS、direct/session 连接、自定义角色、RLS、默认权限、备份/PITR 和恢复 runbook。
- 完成隐私、银行卡、代理合同、佣金税务与数据保留的外部合规审核。
