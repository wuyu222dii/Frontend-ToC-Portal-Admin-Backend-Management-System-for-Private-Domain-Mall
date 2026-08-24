# B4 商品与 SKU

> 批次：B4；产品/API 基线：v2.4.2 / CH-010；更新日期：2026-08-24；当前状态：B4.3 已验收并暂停，B4.4 尚未开始；数据范围：仅脱敏 development；staging/production：`NO-GO`。

## 1. 范围与串行门禁

B4 只交付 ADM-03/04 的 Product/SKU 最小管理闭环，不包含 Banner、库存人工调整/流水、消费者商城、交易或资金能力。五个批次严格串行，每段 `P0=0/P1=0` 并暂停后才可进入下一段：

| 批次 | 交付物 | 当前状态 | 下一批前置 |
|---|---|---|---|
| B4.0 准入与契约 | 普通 CI 修复、CH-010 文档/OpenAPI/contracts/原型、冻结数据库门禁 | 已完成并暂停 | [Run 32688928791](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/32688928791) 在准确 SHA 全绿，P0=0/P1=0 |
| B4.1 Product/SKU CRUD | ProductCatalogRepository、12 个现有 operation 中的 6 个 CRUD operation、图集、投影、零库存和幂等 | 已完成并暂停 | 本地门禁通过，独立终审 P0=0/P1=0 |
| B4.2 生命周期 | Product/SKU preview-confirm、restore、依赖重查、锁序与审计 | 已完成并暂停 | 本地/一次性 PostgreSQL 门禁通过，独立终审 P0=0/P1=0 |
| B4.3 ADM-03/04 | 商品列表、新建/编辑、图集、SKU、生命周期、归档恢复和只读库存 | 已完成并暂停 | 本地门禁和独立终审 P0=0/P1=0 |
| B4.4 总验收 | 普通 CI full gates、真实纵向链路、Supabase rollback-only 和五视口 | 未开始 | B4.3 已验收暂停 |

B0 至 B3 development 及 B2/B3 Supabase rollback-only 已通过。普通 CI 原先因 MinIO root 密码与 runtime S3 密钥使用同一个表达式而在初始化阶段失败；本批已改为两个独立值。[Run 32688928791](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/32688928791) 在提交 `6739d5f78b94d4db2110041bd81fa8c17736fe77` 上实际完成依赖安装、契约、数据库、测试、五应用与 MP-Weixin 构建、真实纵向浏览器 E2E 及清理，结论为 success。

### 1.1 B4.0 当前本地证据

| 门禁 | 2026-08-24 实测结果 |
|---|---|
| 工程 | `pnpm check` 通过：522 passed / 47 个环境模式跳过，lint/typecheck/build 无错误；MP-Weixin 独立构建通过 |
| 契约 | Redocly、CH-010 专项检查、contracts build 与二次生成哈希一致；172 paths / 196 operations / 196 unique operationId / 307 schemas / 685 schema refs / 0 dangling refs |
| 数据库 | Prisma validate、冻结文件、一次性 PostgreSQL 18.3 空库回放、权限故障注入和 migration diff=0 通过；development 只读核验仍为 76 tables / 59 enums，`mall_runtime` TLS 与最小权限正常 |
| 对象存储 | 隔离 Compose project 使用独立 root/runtime 凭据完成 MinIO 建桶、匿名 `public/*` 策略、runtime 用户和最小策略绑定；测试容器与卷已清理 |
| 浏览器 | 普通纵向 E2E 76 passed / 4 designed skips；B2 独立 45/45；B3 独立 26 passed / 4 designed skips |
| 静态原型 | 90 个响应式渲染、21/9/22 页面契约、14 条小程序流程和 16 条后台/代理流程通过；四个 422 修复入口、Product/SKU 409 旧预览销毁、归档商品只读详情、父商品归档阻断及当前 SKU 预占来源均有自动化断言 |
| 远端普通 CI | [Run 32688928791](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/32688928791) success；准确实现 SHA `6739d5f78b94d4db2110041bd81fa8c17736fe77` |

B4.0 独立终审结论为 `P0=0/P1=0`。本批在此暂停；未收到下一批进入指令前，不创建 Product/SKU repository、API 或工程前端业务代码。

### 1.2 B4.1 当前本地证据

| 门禁 | 2026-08-24 实测结果 |
|---|---|
| 业务范围 | 新增 Product 列表/创建/详情/更新与 SKU 创建/更新共 6 条受保护 CRUD 路由；未注册 lifecycle preview/confirm 或 restore 路由 |
| API | DTO、服务编排和受保护 HTTP surface 共 29 passed；覆盖闭合请求、固定创建状态、201、`If-Match`、幂等请求哈希、精确重放及零副作用 |
| 数据库 | ProductCatalogRepository 与幂等专项 78 passed；一次性 PostgreSQL 18.3 空库上的 B4.1 full 集成 5 passed / 1 个 rollback-only 设计跳过，覆盖 CRUD、图集历史、零库存、code 保留、跨 actor 文件拒绝、失败回滚，以及 SPU/SKU 并发创建与乐观更新 |
| 工程 | `pnpm check` 通过：567 passed / 53 个环境模式跳过；lint、全仓 typecheck、五应用及 packages build 无错误；既有 Vue/Rollup warning 不构成失败 |
| 契约 | Redocly、生成漂移与 CH-010 专项检查通过；172 paths / 196 operations / 196 unique operationId / 307 schemas / 685 schema refs / 0 dangling refs |
| 冻结与安全 | Prisma 与 `0001_initial` 逐字节不变；runtime 环境契约、Prisma validate、敏感内容扫描通过；测试 PostgreSQL 容器已清理，用户 Redis/MinIO 未改动 |

B4.1 独立终审结论为 `P0=0/P1=0`。真实 Nest → PostgreSQL/Redis/MinIO 纵向链路、远端 Supabase rollback-only 和更完整的 HTTP 403/成功态验证按计划保留到 B4.4；它们不作为 B4.1 本地退出门禁的替代证据。B4.1 在此暂停，未收到下一批进入指令前不实现 B4.2 生命周期。

### 1.3 B4.2 当前本地证据

| 门禁 | 2026-08-24 实测结果 |
|---|---|
| 业务范围 | 注册 Product/SKU 各 3 条 preview、confirm、restore 受保护路由；B4.1 的 6 条 CRUD 路由保持不变，未实现 B4.3 页面或导航 |
| API 与公共内核 | Product/SKU DTO、路由、服务、品牌分类回归和 preview/幂等/审计公共内核专项通过；preview 为 `HASH_ONLY`，confirm/restore 为闭合 `COMMAND_RESPONSE`，原始原因写入 `audit_log.reason` |
| 数据库 | Product/SKU 状态矩阵、依赖重查、稳定锁序、首次发布时间、恢复不级联、陈旧 `If-Match` 和活动预占专项通过；Prisma 与首迁移未修改 |
| 真实事务 | 一次性 PostgreSQL 18.3 空库完成 76 tables / 59 enums 基线回放；统一 B4.2 full 门禁中仓储 9 passed / 1 rollback-only designed skip，服务 2 passed / 1 rollback-only designed skip；覆盖同一 preview 两个新幂等键并发确认仅一笔成功 |
| 全仓工程 | `pnpm check` 通过：640 passed / 60 个环境模式跳过；lint 为 0 errors（既有 308 warnings），全仓 typecheck、测试、五应用及 packages build 均通过 |
| 契约与安全 | Redocly、CH-010 统计、contracts 生成漂移、敏感内容扫描、runtime 环境契约、Prisma validate 与冻结文件门禁通过；172 paths / 196 operations / 196 unique operationId / 307 schemas / 685 schema refs / 0 dangling refs |
| 独立终审 | 修复陈旧版本错误优先级、Product 停用预览指标、B3 公共 preview 锁序和原始原因审计后，结论为 `P0=0/P1=0` |

B4.2 的一次性纵向证据使用真实 `AdminProductsService -> DatabaseRuntime -> PostgreSQL`，覆盖 preview 消费与失败回滚、依赖阻断、审计、Outbox、精确幂等重放、并发确认和恢复不级联。真实浏览器 → Nest → PostgreSQL/Redis/MinIO、普通 CI full 集成及最终 Supabase rollback-only 仍按计划保留到 B4.4，不以本批结果替代。

## 2. B4.0 冻结契约

### 2.1 创建、投影与不可变字段

- Product create 的 `initial_status` 固定 `DRAFT`；SKU create 固定 `INACTIVE`，成功返回 201，并在同一事务建立 `physical_qty=0,locked_qty=0` 的库存余额。
- SPU/SKU code 创建后永不可修改，软删除后仍全局保留，只能恢复原记录。
- B4.1 实现审计将 `PositiveMoney` 校正为与冻结库 `DECIMAL(18,2)` 一致：必须大于 0、固定 2 位小数、整数部分最多 16 位；同时补齐后台商品 `keyword.maxLength=200`。这是 CH-010 勘误，不改变 path、operation、schema 数或数据库。
- Product 活动图集最多 8 张，完整集合原子替换，固定 `sort_order ASC,id ASC`；文件必须为当前 actor 可用的 `READY/PUBLIC/PRODUCT_IMAGE`。
- Product 列表固定 `published_at DESC NULLS LAST,id DESC`；没有 ACTIVE SKU 时 `minimum_active_price=null`。
- Product 详情返回全部 SKU，包括 ARCHIVED，固定 `created_at ASC,id ASC`；默认 Product 列表排除 ARCHIVED，仅显式归档筛选和详情允许读取归档记录。

### 2.2 生命周期

- 删除旧 `LifecycleAction`；新增闭合 `ProductLifecycleAction`、`SkuLifecycleAction`，均只允许 `ACTIVATE/DEACTIVATE/SOFT_DELETE` 和 2-500 字符 `reason`。
- Product：`DRAFT/INACTIVE -> ACTIVE -> INACTIVE`，DRAFT/INACTIVE 可归档，恢复为 DRAFT。
- SKU：`INACTIVE -> ACTIVE -> INACTIVE`，INACTIVE 可归档，恢复为 INACTIVE。SKU 可在非归档 DRAFT/INACTIVE/ACTIVE Product 下先启用，但只有 Product/SKU 同时 ACTIVE 才公开可售。
- ACTIVE 不得直接软删除；Product/SKU 状态变化和恢复均不级联修改子记录。
- Product ACTIVATE 要求 ACTIVE 品牌、ACTIVE 分类、至少一张合法公开商品图和至少一个 ACTIVE SKU；`published_at` 仅首次启用写入，重新启用不覆盖。
- Product 软删除要求没有 ACTIVE SKU，且其下没有活动库存预占；SKU 软删除要求没有活动库存预占。
- 三个 lifecycle action 均须 preview-confirm、新幂等键和 `If-Match`；restore 不走 preview，但要求原因、新幂等键和 `If-Match`。confirm 事务重查依赖，失败不消费 preview；`reason` 写入现有 `audit_log.reason`。
- 新增 422：`PRODUCT_PRIMARY_IMAGE_REQUIRED`、`PRODUCT_ACTIVE_SKU_REQUIRED`、`ACTIVE_SKU_DEPENDENCY`、`ACTIVE_INVENTORY_RESERVATION`。

### 2.3 不变项

- OpenAPI `2.4.2-ch010` 本轮实测保持 172 paths / 196 operations / 196 unique operationId / 307 schemas / 685 schema refs / 0 dangling refs。
- 页面仍为 21 MP / 9 AGT / 22 ADM，PRD 唯一 FR 142、AC 116、US 24、HR 15。
- Prisma 与 `0001_initial` 必须逐字节不变，76 models / 59 enums，不新增迁移。

## 3. B4.1 后端 CRUD

- 建立独立 ProductCatalogRepository/Admin Products 模块，不扩张 B3 品牌分类仓储职责。
- 实现 Product 列表/创建/详情/更新和 SKU 创建/更新；写操作采用权限、规范化请求、闭合幂等策略、乐观锁和审计。
- Product create/update 对图集执行单事务完整替换；对象存储读取不在数据库事务中发生。
- SKU 创建与零库存余额、审计、幂等结果同事务；冲突或失败不得留下无余额 SKU。
- 列表库存三值来自同一快照并满足 `available=physical-locked`；B4 只读，不开放库存 adjustment。

退出条件：CRUD、图集、稳定排序、归档读取、code 保留、201/零库存、精确幂等、`If-Match` 和并发创建测试全部通过，P0/P1 为 0 后暂停。

2026-08-24 实测已满足上述退出条件，B4.1 状态为“已验收并暂停”；其后已按批准指令进入并完成 B4.2。

## 4. B4.2 生命周期

- preview 只保存哈希，绑定 actor、session、action、target、规范化请求和版本，不缓存 token。
- confirm 使用唯一锁序 `idempotency/high-risk preview -> brand -> category -> product -> SKU -> inventory balance -> inventory reservation -> audit/outbox`，同类按 ID 升序；事务内不访问对象存储或 Provider。
- 成功 confirm 原子消费 preview、更新状态/version/首次发布时间、写审计和幂等结果；失败时全部回滚。
- restore 只恢复原记录和指定目标状态，不恢复父子记录，不复用 lifecycle preview。

退出条件：完整状态矩阵、图片/SKU/预占依赖、preview 篡改/过期/重放、409、四个 422、并发 confirm、失败不消费和原因审计全部通过，P0/P1 为 0 后暂停。

2026-08-24 实测已满足上述退出条件。独立终审发现的四项 P1 均已修复并回归：陈旧 Product/SKU `If-Match` 先返回 `RESOURCE_VERSION_CONFLICT`；Product DEACTIVATE 不再错误要求活动 SKU 为零；品牌/分类 confirm 统一先消费 preview 再取得目录锁；品牌/分类 lifecycle/restore 审计保留用户提交的原始 `reason`。B4.2 状态为“已验收并暂停”；其后已按批准指令进入并完成 B4.3。

### 1.4 B4.3 当前本地证据

| 门禁 | 2026-08-24 实测结果 |
|---|---|
| 页面与导航 | 新增 ADM-03 商品列表、ADM-04 新建/编辑三个受保护路由和商品导航；品牌、分类、账户安全保留，Banner 与库存调整入口继续关闭 |
| Product/SKU | 覆盖筛选分页、nullable 最低价、同快照库存摘要、草稿 Product、停用 SKU、不可变 code、8 图上传/排序、SKU 编辑、归档只读和分别恢复；未保存资料及上传中的图集均阻止切换到 SKU 或发起 Product lifecycle |
| 生命周期与错误 | Product/SKU 三动作均强制 preview-confirm，restore 不生成 preview；409 丢弃旧 preview 并刷新最新资源，四类 422 均显示中文原因和可执行修复入口；preview token、confirmation hash 与签名 URL 不写浏览器存储 |
| 幂等与冲突 | Product/SKU 重复提交只发一笔业务请求；未知结果保留同一命令幂等键，每次新 preview/confirm 使用全局不同的新键；创建型编码冲突保留表单，编辑型 409 刷新最新 Product/SKU |
| 五视口 | `pnpm e2e:b4` 在 375/390/414/1024/1440 共发现 35 个项目用例，27 passed / 8 个专项矩阵 designed skips；覆盖 loading、empty、401、403、409、四类 422、500、分页、重复提交、完整状态动作和成功路径 |
| B3 回归 | `pnpm e2e:b3` 为 26 passed / 4 designed skips；共享文件上传、第五个导航项和后台样式未破坏品牌/分类流程 |
| 全仓工程 | `pnpm check` 通过：640 passed / 60 个环境模式跳过；lint 0 errors（既有 308 warnings），全仓 typecheck、五应用及 packages build 成功 |
| 冻结边界 | OpenAPI、生成 contracts、Prisma 与 `0001_initial` 均未修改；本批只消费 CH-010 既有 12 个 Product/SKU operation |
| 独立终审 | 客户端/上传、前端工作流和 Playwright 三路复核发现的问题均已修复回归，最终结论 `P0=0/P1=0` |

B4.3 的 Playwright 使用受控 Mock API 验证前端状态与请求契约，不替代真实 Nest、PostgreSQL、Redis、MinIO 或远端 Supabase 证据。B4.3 在此暂停；未收到下一批进入指令前，不开始 B4.4 总验收，也不将 B4 标记为 development `GO`。

## 5. B4.3 总部后台

- 只增加商品列表、新建/编辑及对应导航；保留品牌、分类、账户安全。Banner 与独立库存调整导航保持关闭。
- 覆盖筛选、分页、null 最低价、8 图上传/排序、固定创建状态、SKU 编辑、三动作 preview-confirm、归档筛选和分别恢复 DRAFT/INACTIVE。
- 移除“保存并发布”、普通状态下拉、库存写入、佣金、Product 级推荐及 API 不支持字段；库存只显示摘要，推荐只属于 SKU。
- 409 必须刷新最新 Product/SKU、丢弃旧 preview 并要求重新确认；422 显示对应依赖和修复入口，不自动重试或复用 token。

退出条件：375/390/414/1024/1440 覆盖 loading、empty、401、403、409、422、500、重复提交和成功路径；无重叠、横向溢出、敏感数据或旧状态，P0/P1 为 0 后暂停。

2026-08-24 实测已满足上述退出条件。独立终审发现的测试假阳性、跨动作幂等键断言、422 修复入口、未保存/上传中资料覆盖和创建/编辑 409 分流问题均已修复；最终 `P0=0/P1=0`。B4.3 状态为“已验收并暂停”，B4.4 尚未开始。

## 6. B4.4 总验收

- 普通 CI 必须实际运行 B3/B4 full PostgreSQL、Redis、MinIO/API 集成以及 B2/B3/B4 Playwright；Mock E2E 不替代真实 Nest 纵向链路。
- 接入 `db:test-b4-product-catalog` 时须将普通 CI 的一次性数据库名从 `mall_ci` 调整为包含 `b4/test/ephemeral` 的专用名称，或在安全评审后同步修订 full-mode 防误连护栏。
- 契约门禁：Redocly、生成漂移、闭合 schema、统计、旧 `LifecycleAction` 不存在、Product/SKU 三动作状态矩阵通过。
- 数据库门禁：新库回放、权限验证、Prisma validate、冻结文件检查和 migration diff=0。
- 在最终 B4 实现 SHA 上执行受控 Supabase development rollback-only，登记成功 run、各 step 结果和事务外无 synthetic 残留断言。
- CH-009 只接受单人 development 独立 reviewer 风险；第一次进入 staging 前必须取得外部独立代码、安全、数据库和验收证据复核。

## 7. 回退与禁止范围

- B4.1/B4.2 已进入业务实现，不再采用整体契约回滚；通过关闭 Product/SKU 模块路由回退，保留审计、幂等和历史记录，不修改冻结迁移。
- ADM-03/04 已进入工程实现；回退时关闭三个 Product 路由及商品导航，保留 B4.1/B4.2 审计、幂等和数据库历史，不回退冻结迁移。
- B4 最终最多标记脱敏 development `GO`。Banner、库存人工调整/流水、staging、production、真实客户数据、真实微信登录/支付/退款、物流和银行卡付款均不在本阶段。
