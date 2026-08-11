# 技术设计交付索引

本目录对应产品基线 MVP/PRD v2.3 与 CH-004，仅包含开发前技术设计，不包含可部署业务代码。

| 文件 | 用途 |
|---|---|
| `技术架构说明.md` | 技术栈、模块边界、事务、Provider、部署与扩展策略 |
| `API接口文档.md` | 三端完整接口目录、核心请求响应、状态、错误和幂等规则 |
| `openapi.yaml` | 核心高风险接口的 OpenAPI 3.1 契约 |
| `数据库设计.md` | Supabase 托管 PostgreSQL 表域、ERD、状态、事务、索引、加密与验收 |
| `schema.prisma` | 64 个核心实体、45 个枚举的 Prisma 逻辑模型草案 |

技术设计的上游真相顺序为：最新批准的需求变更记录、PRD v2.3、MVP v2.3、原型设计方案。发生冲突时不得由开发人员自行选择口径，必须先更新上游基线和本目录契约。

进入生产开发前仍需完成：

1. 按 Prisma ORM 7 配置连接：`schema.prisma` 的 datasource 只保留 `provider`/`relationMode`/`schemas`，`prisma.config.ts` 的 `datasource.url=env('DIRECT_URL')` 专供 CLI/migration；NestJS runtime 通过 `@prisma/adapter-pg` 读取 `DATABASE_URL`。完成 `format`、`validate` 和首版 migration review 前不得直接建库；
2. 将金额/计数 `CHECK`、活动记录部分唯一索引、复合 Provider 唯一索引、RLS 默认拒绝和敏感字段加密 DDL 写入 migration；
3. 在 Supabase 项目中关闭 Data API，创建相互隔离的最小权限 runtime/migration 角色，验证直连与 Supavisor session 连接、SSL 证书校验、备份恢复和凭据轮换；
4. 根据真实微信和对象存储资质补齐 Provider 配置；Supabase 仅托管 PostgreSQL，不启用 Supabase Auth/Storage 作为业务依赖；
5. 将 OpenAPI 导入后端工程并生成三端共享类型；
6. 完成隐私、银行卡、代理合同和佣金税务的上线合规审核。

三端只调用 NestJS HTTPS API。NestJS API/Worker 是 `public` 业务表的唯一数据访问入口；前端禁止使用 Supabase client、Data API 或任何 `service_role` 密钥。微信自建认证、应用 RBAC、64 个核心实体和 45 个枚举口径保持不变。
