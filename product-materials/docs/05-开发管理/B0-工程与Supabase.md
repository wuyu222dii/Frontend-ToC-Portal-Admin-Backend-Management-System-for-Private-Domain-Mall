# B0 工程与 Supabase

> 批次：B0；更新日期：2026-08-13；数据范围：仅脱敏开发数据。

## 1. 交付边界与当前状态

| 项目 | 状态 | 验证方式 |
|---|---|---|
| pnpm monorepo 与五个应用 | 已建立 | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` |
| 本地 Redis 与 MinIO | 已建立 | `docker compose up -d --wait redis minio`、私有 bucket 初始化 |
| 临时 PostgreSQL CI | 已建立 | 空库回放、对象计数、权限/RLS 检查及 Prisma diff |
| Supabase 新加坡开发项目 | 已创建 | `wash-care-private-mall-dev` / `gphyhqryivtpicuqpdkq` / `ap-southeast-1` |
| Supabase 基线迁移与本机烟测 | 已完成 | 结构、权限、TLS、Prisma history 与 drift 全部通过 |
| GitHub 受保护烟测 | 待仓库接入 GitHub Environment | `Supabase development smoke` 手动工作流 |

开发库只允许脱敏测试数据；不得以本地 PostgreSQL 替代日常开发库。GitHub Environment 尚未接入不阻断 B0 本机与云端验收，但合并到远端前必须配置受保护烟测。

## 2. 本地开发依赖

1. 使用 `.nvmrc` 中的 Node.js 22 和根 `packageManager` 固定的 pnpm 10。
2. 按审定的开发环境模板创建本地 `.env`，为 Redis 和 MinIO 设置仅开发环境使用的随机凭据；已存在的 `.env` 不得覆盖。
3. 运行 `docker compose up -d --wait redis minio`。
4. 运行 `docker compose run --rm minio-init`，创建默认私有 bucket。
5. 用 `docker compose ps` 检查健康状态。停止服务使用 `docker compose stop`；只有明确需要清空脱敏开发对象时才人工删除 volume。

Compose 不包含 PostgreSQL，也不向局域网公开 Redis、MinIO API 或控制台端口。

## 3. Supabase 项目人工准入

项目所有者须在 Supabase Dashboard 完成以下步骤：

1. 已建立独立 development 项目 `wash-care-private-mall-dev`，区域为 Southeast Asia (Singapore)，project ref 为 `gphyhqryivtpicuqpdkq`；不得复用为 staging 或 production。
2. 在 API Settings 关闭 Data API。项目不得启用前端 Supabase SDK 旁路，不使用 Supabase Auth、Storage 或 Realtime 承担本商城业务。
3. 下载项目 CA，分别取得 project-owner、`mall_migrator` 和 `mall_runtime` 的 direct/session 连接信息。迁移优先使用 direct `5432`；IPv4-only 开发机可使用 Supavisor session `5432`，不得使用 transaction pooler `6543`。
4. 所有连接强制证书校验。`DIRECT_URL` 只供迁移，`DATABASE_URL` 只供 API/Worker；两个角色密码独立生成、独立保存和轮换。
5. 首次初始化仅通过 `pnpm db:supabase:bootstrap`，禁止直接以 Prisma 生成结果覆盖冻结首迁移。基线创建 `mall_migrator`、`mall_runtime` 并移交 76 张应用表、59 个枚举和 15 个函数；中断在无 migration history 的半成品状态时必须人工检查，不得 reset。
6. 两个角色的随机密码保存于本机 Secret Store；`public._prisma_migrations` 由 Prisma 以真实 checksum 登记且归 `mall_migrator`。后续迁移只使用 migrator 连接。
7. 使用 runtime 连接验证无 DDL、无 `DELETE`（四张明确例外表除外）、无 `BYPASSRLS`；验证 `authenticator`、`anon`、`authenticated`、`service_role` 对应用表无表级或列级 CRUD grant，且不能执行 15 个应用函数。
8. 本机已使用 `mall_migrator` 和 `mall_runtime` 完成 TLS、权限、迁移历史与 drift 烟测；远端接入后再运行受保护工作流并保存 GitHub Actions 链接。

若目标 `public` schema 已有业务表，停止初始化并人工评审；禁止运行 reset、drop 或覆盖迁移。

## 4. GitHub Environment 配置

建立名为 `supabase-development` 的 GitHub Environment：

- 设置 required reviewer，并限制为 `main` 分支；支持时禁止发起人自批。
- 只配置 environment secret `SUPABASE_DIRECT_URL`，值为 `mall_migrator` 的 direct `5432` 连接并带 `sslmode=verify-full`。手动工作流传入的 project ref 必须与连接串中的项目一致。
- 不配置数据库 project-owner 密码、runtime URL、`anon` key 或 `service_role` key。
- `Supabase development smoke` 只允许 `workflow_dispatch` 手动触发，且只做读检查和 Prisma diff，不创建、删除或修复对象。

普通 `CI` 工作流没有 Supabase secret，仅使用单次运行的 PostgreSQL 18.3、Redis 和 MinIO。

## 5. CI 门禁

每个 PR 和 `main` push 依次执行：

1. 锁文件安装、ESLint、类型检查；
2. OpenAPI lint、确定性契约生成与 Git 漂移检查；
3. Prisma validate；
4. 通过 `pnpm db:migrate:baseline` 在空 PostgreSQL 回放原始基线迁移；
5. 复核 76 表、59 枚举、17 条件索引、165 CHECK、76 RLS policy、15 migration-owned functions、原生对象语义指纹、Supabase 四类 Data API 角色的有效表/列/函数权限及对象所有权；
6. 在临时数据库逐项注入并撤销越权表、列和函数 grant，确认权限门禁全部失败关闭且最终恢复干净；
7. Prisma 可表达对象的 migration diff 必须为零；
8. 单元、Supertest HTTP 和 Playwright 五应用纵向 E2E；
9. MP-Weixin 构建与凭据/PII/银行卡/固定敏感值扫描。

`migrate diff` 无法检查触发器、RLS、角色、CHECK 和条件索引，因此不得代替第 5 步的 PostgreSQL 原生检查。

## 6. B0 验收证据

B0 结束时必须归档：

- 本机完整门禁结果；远端接入后补 CI 成功链接与 commit SHA；
- Supabase 项目 region、Data API 关闭状态和 project ref；
- 基线迁移与受保护烟测链接；
- `mall_migrator`/`mall_runtime` 权限查询结果，内容不得含连接串或密码；
- 五个应用构建产物清单和内部健康检查结果；
- 剩余风险。Supabase 组织权限、项目创建或 direct IPv6 不可达均属于明确阻断，不得静默切换本地 PostgreSQL。

### 6.1 交付追踪

| 维度 | B0 结果 |
|---|---|
| 页面 | 五个应用仅交付可构建状态壳；未开放任何 MP/AGT/ADM 业务导航 |
| FR / AC | 不改变既有 FR 142 / AC 116；本批不宣称业务验收完成 |
| API | 196 个业务 operation 均未实现；仅 API/Worker 内部健康检查用于工程验收 |
| 数据模型 | 根 `prisma/` 与冻结的 76 models / 59 enums 逐字节一致 |
| 数据库 | Supabase development 回放为 76 表、17 条件索引、165 CHECK、76 RLS policy、15 个应用函数；Prisma diff 为零 |
| E2E | Playwright 启动并访问三端状态壳，Supertest/HTTP 验证 API/Worker，另覆盖 Redis/MinIO 私有 bucket、临时 PostgreSQL 与 Supabase 云端烟测 |

### 6.2 剩余风险

- GitHub `supabase-development` Environment 尚未配置，受保护远端烟测尚无 Actions 链接。
- 当前开发机无法直连 Supabase 的 IPv6 direct host，已使用 5432 session pooler 并执行 `verify-full` TLS；不得降级到 6543 transaction pooler。
- 2026-08-12 的 `pnpm audit --prod` 报告 30 项上游传递依赖告警（其中 9 项 high），均来自当前 uni-app/DCloud 构建链；B0 不跨 DCloud 兼容组合强制升级，须跟踪官方修复并在 B1 前复核可升级版本。
- 本机默认 9000 端口被其他服务占用时，使用 `.env` 中 `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` 改为未占用回环端口。
- B0 纵向 E2E 已由 Playwright 在 375/390/414/1024/1440 五组视口访问三端状态壳，并由 HTTP 请求核验 API/Worker health；B1 起替换为真实业务路径。
- 敏感扫描覆盖仓库文本与 `product-materials/prototype/**`；原型验证所需的两个测试手机号为显式合成 fixture 白名单，任何其他完整手机号、密钥或银行卡号都会阻断 CI。
