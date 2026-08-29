# 技术设计交付索引

> 当前基线：MVP/PRD v2.4.7、线协议 CH-020（2026-08-29）。B0-B9 development 已完成；B9 最终 SHA `19f9ad57190b28d11922db805b39af95b2f7ba3b` 的普通 CI Run `33230769777` 与 Supabase development rollback-only smoke Run `33233087710` 同 SHA 且均为 `completed/success`，B9 development `GO`，CH-019 已自动失效。最终复审保持 `P0=0/P1=0/P2=1`，唯一 P2 为 TR-020 且不阻断 development。仅允许 Mock Provider 和脱敏 development，staging、production 与真实支付均为 `NO-GO`。

| 文件 | 用途 |
|---|---|
| `技术架构说明.md` | 技术栈、三端边界、认证/RBAC、事务锁序、Provider、部署与扩展策略 |
| `API接口文档.md` | CH-020 实测 173 paths、198 operations、198 unique operationId、325 schemas、703 schema refs、2,665 local refs、0 dangling refs |
| `openapi.yaml` | OpenAPI 3.1 单一可解析契约；文本目录必须完全覆盖且 operationId 唯一 |
| `数据库设计.md` | PostgreSQL/Supabase 表域、ERD、状态机、事务、索引、加密、RLS 与验收门禁 |
| `schema.prisma` | Prisma 7.9.1 逻辑模型：76 models、59 enums、270 个 model-typed relation fields，全部位于 `public` |
| `prisma.config.ts` | 设计验证用 Prisma 7 config；CLI 读取 `DIRECT_URL` |
| `migrations/0001_initial/migration.sql` | Prisma 基线 DDL + PostgreSQL 专属 partial unique/CHECK/触发器/角色/RLS 草案 |
| `migrations/0002_b9_inventory_fact_indexes/migration.sql` | B9 前向索引迁移：SKU 前导预占查询与库存流水业务事实唯一性；不修改首迁移 |
| `../05-开发管理/B4-商品与SKU.md` | B4.0 至 B4.4 串行批次、准入门禁、验收与回退边界 |
| `../05-开发管理/B5-Banner与库存.md` | B5.0 CH-012 契约、CH-011 门禁及后续串行批次 |
| `../05-开发管理/B6-消费者匿名商城目录.md` | B6.0 CH-014 契约、B6.1-B6.4 实施/最终证据及 CH-013 失效边界 |
| `../05-开发管理/B7-消费者身份会话与隐私.md` | B7.0 CH-016 契约、CH-015 门禁、B7.1-B7.5 串行批次与退出边界 |
| `../05-开发管理/B8-登录后购物基础.md` | B8.0 CH-018 契约、CH-017 门禁、B8.1-B8.5 串行批次与退出边界 |
| `../05-开发管理/B9-订单报价与库存预占.md` | B9.0 CH-020 契约/迁移、CH-019 门禁、B9.1-B9.5 串行批次与退出边界 |

上游真相顺序为：已批准需求变更记录、PRD v2.4.7、MVP v2.4.7、原型设计方案。发生冲突时先更新上游基线和本目录契约，不由开发人员临时选择口径。

## CH-006 历史验证状态

- 新增持久契约门禁 `pnpm contracts:check`，专项实测通过：172 paths / 196 operations / 196 unique operationId / 306 schemas / 685 schema refs / 2,561 local refs / 0 dangling refs。CH-008 只修正文案，当前生成文件 SHA-256 为 `a216f4bc665160cdfbff078410c87fbfc7d4748b23ddc1f08c7c702a817b245e`；线协议、统计和数据库均不变。
- CH-006 未修改 76 models / 59 enums、Prisma schema 或 `0001_initial`；`prisma validate`、逐字节冻结校验、PostgreSQL 18.3 空库回放、权限故障注入和 migration diff=0 均已通过。
- CH-006 当时要求 Product/SKU 拒绝 ACTIVATE；该结论是 B3 历史验收事实，现行 Product/SKU 线协议已由 CH-010 专用 DTO 取代。品牌/分类创建 DRAFT、排序、专用状态机、ARCHIVED 查询、restore-to-DRAFT 及三项错误码的既有证据继续有效。
- B3.0 已通过 Redocly、契约/AJV/故障注入、生成漂移、冻结数据库、权限、零漂移、全仓和原型门禁并暂停。CH-007 随后批准整个 B3 在本地和一次性环境逐段实施；远端 repository 证据后续已补齐，CH-009 只对单人 development 独立 reviewer 作例外。

## CH-010 历史实施状态

- CH-010 当时线协议为 `2.4.2-ch010`；当时实测保持 172 paths、196 operations、196 unique operationId、307 schemas、685 schema refs 和 0 dangling refs。现行版本见 CH-016。
- 旧 `LifecycleAction` 删除，Product/SKU 分别使用闭合 `ProductLifecycleAction`、`SkuLifecycleAction`，均支持 ACTIVATE/DEACTIVATE/SOFT_DELETE；创建和恢复目标、发布依赖、不级联及审计原因按 CH-010 固定。
- Product 列表/详情冻结 `published_at DESC NULLS LAST,id DESC`、nullable 最低活动价、全部含 ARCHIVED 的 SKU、8 图；SKU 创建为 201 并原子建立零库存余额，SPU/SKU code 永不可改或复用。
- Prisma、`0001_initial`、76 models / 59 enums 均未改变。B4.0 至 B4.4 已依次通过契约、冻结数据库、CRUD、生命周期、五视口、真实纵向和远端门禁。
- 普通 CI Run `32721588213` 与 Supabase rollback-only Run `32722510890` 均绑定实现基准 SHA `0929f2435e7f5b9ad745fd9cab60b066378e502e` 并成功；后续 docs-only 登记不扩张该 SHA 的技术证明范围。

## CH-012 实施状态

- 产品/API 基线为 `v2.4.3 / 2.4.3-ch012`；本轮实测为 172 paths、196 operations、196 unique operationId、312 schemas、692 schema refs、2,578 local refs 和 0 dangling refs。
- Banner 使用闭合创建/资料更新/启停请求，DELETE 唯一归档、restore-to-DRAFT、稳定排序、有效窗口、目标重查与 URL origin allowlist；库存删除 `low_stock`，固定公式、int32 增量、专用 preview/confirm 响应与闭合流水类型。
- 公共内核注册 `INVENTORY.ADJUST/INVENTORY`、`BANNER_RESOURCE_RESPONSE` 与 `INVENTORY_QUANTITY_OUT_OF_RANGE`；B5.1 已实现 Banner 闭合响应重放，B5.2 已实现 Inventory `HASH_ONLY` preview 与 `COMMAND_RESPONSE` 精确重放。
- Prisma、`0001_initial`、76 models / 59 enums 保持逐字节不变；B5.1/B5.2 已分别通过本地与一次性 PostgreSQL 18.3 门禁，B5.2 另通过受控 Supabase development rollback-only 并暂停。
- B5.4 最终实现基准 `d97c43958142eaa0fa5a0a9954bb21d136944ba2` 的普通 CI Run `32822780209` 和 Supabase rollback-only Run `32823898006` 为同一 SHA 双绿；B5 development `GO`，CH-011 已自动失效。

## CH-014 实施状态

- 产品/API 基线为 `v2.4.4 / 2.4.4-ch014`；B6.0 实测保持 172 paths、196 operations、196 unique operationId、312 schemas，得到 691 schema refs、2,577 local refs 和 0 dangling refs。
- 公开目录只使用 5 个已有 Store GET；闭合布尔售罄投影、默认 COMPREHENSIVE 与四种显式排序、仅商品名搜索、无分页公开品牌/分类、首页四区状态与 120/60 秒公共限流。
- Redocly、CH-014 专项统计/闭合 Schema、生成漂移及 contracts typecheck 已通过。Prisma、`0001_initial`、76 models / 59 enums 逐字节不变；`pnpm db:check-frozen`、`pnpm prisma:validate` 和 `pnpm db:diff` 已通过，diff 为 `No difference detected`。
- B6.1 已实现独立 `StoreCatalogRepository` 与 Nest Store Catalog controller/service/module，开放 `/store/home`、`/store/categories`、`/store/brands`、`/store/products`、`/store/products/{product_id}` 5 个匿名 GET。Product/Brand/Category/ACTIVE SKU、公开素材、Banner target 与库存 fail-safe 均在公开投影边界内处理。
- Product 列表、详情和首页分区使用 Repeatable Read；参数化 SQL 负责最低 ACTIVE SKU 价格、五种稳定排序与分页，Brand/Category/图片/SKU/库存按 ID 集合批量装配，不使用 N+1。
- 5 路由共享 Redis 120 次/60 秒固定窗口，key 仅保存来源 IP 的 HMAC；Redis 未就绪、断连或脚本结果非法时 fail closed。`API_TRUSTED_PROXY_CIDRS` 默认空且不信任代理头，只接受显式数字 IP/CIDR，IPv4-mapped IPv6 归一化为 IPv4。
- 实测：repository unit `9 passed`；database 全包 `332 passed / 52 环境模式跳过`；隔离 PostgreSQL full `1 passed / 1 mode skip` 且事务外零残留；受控 Supabase development rollback-only `1 passed / 1 mode skip` 且事务外零残留；API 全包 `426 passed / 26 环境模式跳过`；config `67 passed`；Store/API 聚焦回归（含可信代理与 HTTP 限流边界）`86 passed`。
- B6.2 已完成跨端 Store API 客户端、MP-01 首页、MP-02 分类、MP-03 搜索、MP-04 商品详情和 MP-05 SKU 选择层。
- B6.3 已完成 MP-06 版本化游客本地购物车、同 SKU 合并、不同 SKU 分行、详情回源刷新、售罄/失效排除合计和临时网络失败保留语义；结算只提示登录，不调用服务端 Cart/订单。
- B6.3 历史本地验收实测为 miniapp unit `6 files / 84 passed`、H5 与 MP-Weixin build 均通过、B6 UI Playwright `34 passed / 56 designed skips`；覆盖 375/390/414/1024/1440 五个视口，root lint 0 errors（保留既有 warnings），`P0=0/P1=0`。
- B6.4 已完成，最终 SHA `9d8911934a5aa2b09ece2e12935bcafc9ccdcba6` 上的真实纵向链路、普通 CI 与 Supabase rollback-only 均成功；B6 development `GO`，CH-013 已自动失效。

## CH-016 契约实施状态

- 产品/API 基线升级为 `v2.4.5 / 2.4.5-ch016`。新增匿名法律文本 GET、删除旧异步注销 current GET、增加注销 preview；专项实测为 173 paths / 197 operations / 197 unique operationId / 320 schemas / 699 schema refs / 2,617 local refs / 0 dangling refs，Redocly 0 warning。
- 法律文本固定返回 USER_AGREEMENT、PRIVACY_POLICY、PHONE_AUTHORIZATION 三份当前快照；登录严格同意前两份，手机号单独同意第三份。Store token 固定 `role=CUSTOMER`、`assurance=WECHAT`、`audience=qingxu-store`，管理端继续 `qingxu-admin-web`；Provider 不是 token claim。
- profile/手机号写要求 If-Match 和幂等，Provider 由服务端环境选择；消费者身份固定一个微信 AppID，以 `(AppID, openid)` 识别，union_id 不用于登录或自动合并；候选目标服务端解析，token 使用用途隔离 HMAC 保存、30 分钟有效，查询不消费、替换或登录迁移时原子失效；服务代理只返回 agent ID、展示名和绑定时间。
- 注销使用 eligible preview 与 5 分钟能力；不合格 preview 不签发 token。同步 confirm 重检阻断并单事务完成去标识化和全部会话撤销，使用 HASH_ONLY 且不重放完成响应。
- Prisma、两份 `0001_initial`、76 models / 59 enums 逐字节不变。B7.0 已通过生成稳定性、contracts 编译、原型、冻结数据库与零漂移门禁；B7.1 已完成 Store 身份与会话；B7.2 已完成 profile/手机号；B7.3 已完成归因候选、长期绑定与服务代理；B7.4 已完成 5 分钟删除预览、阻断 fail-closed、单事务匿名化、全部会话 tombstone、HASH_ONLY、审计、durable `PENDING account.anonymized` Outbox 事实及 full/rollback 门禁，退出复审 `P0=0/P1=0`。B7.5 已完成小程序、本地五视口、真实纵向、full check、最终只读复审与同 SHA 远端双绿；B7 development `GO`，CH-015 已失效。

## CH-018 契约实施状态

- 产品/API 基线升级为 `v2.4.6 / 2.4.6-ch018`。新增 `GET /store/favorites/{product_id}`，新增 `FavoriteProductView`、`FavoriteStateResponse`、`CartMergeItemInput`，并以 `CartItemWriteRequest` 等量替换 `CartQuantityRequest`。
- 冻结统计为 173 paths / 198 operations / 198 unique operationId / 323 schemas / 701 schema refs / 2,653 local refs / 0 dangling refs；Redocly、解析、生成漂移和闭合 Schema 门禁已实测通过。
- CH-018 闭合收藏失效投影、服务端购物车懒创建/选择/合并、地址加密与所有权、CUSTOMER + 来源 IP 组合限流、个性化 no-store 和 HASH_ONLY 幂等语义；订单、预占、结算、支付与履约不在 B8。
- Prisma、两份 `0001_initial`、76 models / 59 enums 必须逐字节不变，不新增 migration，`migration diff=0`。
- B8.0-B8.5 本地实现、数据库/API/浏览器纵向、全仓回归与最终只读复审结论为 `P0=0/P1=0/P2=0`。最终 SHA `0fc5a8d3d1f07d3b5c9fcadf7ea4ca9560a0911a` 的普通 CI Run `33141704459` 与 Supabase rollback-only Run `33142971501` 同 SHA 成功；B8 development `GO`，CH-017 已自动失效。完整门禁与批次状态见 `../05-开发管理/B8-登录后购物基础.md`。

## CH-020 契约与迁移状态

- 产品/API 基线升级为 `v2.4.7 / 2.4.7-ch020`。沿用五个已有 Store B9 operation，不新增支付、物流或售后入口；报价与下单由 5 分钟无状态、用途隔离 HMAC 凭证绑定。
- `CreateOrderRequest` 等量替换为 `CheckoutQuoteRequest`，新增 `OrderSubmitRequest` 与 `CheckoutQuoteBlocker`；实测保持 173 paths / 198 operations / 198 unique operationId，并固化为 325 schemas / 703 schema refs / 2,665 local refs / 0 dangling refs，Redocly 0 warning。
- CH-020 首次允许在原始基线之后增加前向 migration：两份 `0001_initial` 继续逐字节不变，`0002_b9_inventory_fact_indexes` 只增加 `inventory_reservation_item(sku_id,reservation_id)` 与非空 `business_id` 库存流水条件唯一索引，不增表、列或枚举。
- 候选 reservation/SKU ID 只可无锁定位。首次下单使用 customer/cart/address/catalog→SKU/balance→insert order/reservation；主动取消/Worker 才使用 `idempotency（Worker 跳过） -> order -> payment_intent -> SKU ID ASC -> inventory_balance ID ASC -> inventory_reservation ID ASC -> ledger -> audit/outbox`。两条路径不得混用或让 reservation 先于 SKU/balance；Product/SKU lifecycle 与库存调整共享 SKU→balance→reservation 尾部，并须通过交叉并发无死锁回归。
- B9.0 已完成治理、契约、生成类型、迁移链及受控 Supabase development migration Workflow；B9.1 报价 repository/API、B9.2 待付款下单/预占 repository/API、B9.3 本人查询/取消/超时 Worker、B9.4 MP-08/10/11 与 B9.5 总验收均已完成。数据库 full、B9 UI、真实纵向、全仓回归、冻结迁移和 TR-019 闭环均通过，最终复审为 `P0=0/P1=0/P2=1`；最终 SHA `19f9ad57190b28d11922db805b39af95b2f7ba3b` 的普通 CI Run `33230769777` 与 Supabase development rollback-only smoke Run `33233087710` 同 SHA 且均为 `completed/success`，B9 development `GO`，CH-019 已自动失效。

## B3.1 当前验证状态

- 真实 PostgreSQL、Redis、MinIO API 集成 `3/3` 通过；Worker 清理集成 `3/3` 通过。API 全量 `118 passed / 10 skipped`，Worker 全量 `30 passed / 3 skipped`，storage `16 passed`，database `141 passed / 24 skipped`。
- MinIO 实测通过非 root runtime 身份、`public/*` 匿名 GET 与 private/staging 拒绝、无盲目生命周期规则、大小/MIME/魔数/SHA-256、copy source 变更、签名过期及 CORS 边界。
- `GET /files/{file_id}/download-url` 按 CH-008 不接受幂等键、不创建幂等记录；每次重新鉴权并写不含 URL 的 `READ_SENSITIVE` 审计，签名 URL 只在 no-store/private 响应中返回。
- complete 在提交后即时尽力删除 staging，同时投递延迟清理事件兜底；Worker 删除前重新核对 READY/PENDING 和精确对象 key。MinIO runtime 使用最小对象权限，Redis 断线采用有界重连，注入 Redis 且未 ready 时 API/Worker 健康检查返回 503。
- `pnpm check` exit 0，共 `424 passed / 37 skipped`；全量 build 通过，lint 0 error / 207 个既有 Vue warning。contracts lint/check/typecheck、生成 hash 一致、Prisma validate、冻结文件、权限故障注入、migration diff=0、MP-Weixin build、敏感扫描和 diff-check 均通过；独立安全审计 `P0/P1=0`。
- B3.2 已通过 database `192/30 skipped`、API `161/14 skipped`、真实 PostgreSQL `5/1 mode-skipped` 和真实 Nest + PostgreSQL + Redis `4/4`。响应 HMAC 绑定 actor/scope/幂等键/request hash，高风险 preview 绑定 actor/session/action/target/request/version 并且单次消费。B2/B3 Supabase repository rollback-only 已由 Run `32678252828` 补齐；B3 development 已完成。
- B3.3 已实现 ADM-05/06 管理端请求层、素材上传、品牌/分类维护、生命周期 preview-confirm、归档恢复和受限导航；专用 E2E `26 passed / 4 designed skips`，全仓 `518 passed / 47 env-mode skipped`，安全复核 `P0=0 / P1=0`。B3.3 已本地 `GO` 并暂停。

## CH-005 历史设计验证

- OpenAPI：172 paths / 196 operations / 305 schemas / 685 schema refs；文本接口覆盖率 100%，dangling ref、generic fallback、单资源错误分页均为 0；Redocly recommended lint 无警告通过。
- Prisma：7.9.1 `format` / `validate` / `generate` 通过；验证用 client 按当前相对输出路径临时生成并在验证后删除，未纳入仓库。
- Migration：在全新本地 PostgreSQL 18.3 空库回放通过，实得 76 张表、17 个条件唯一索引、165 个 `CHECK`、76 张 RLS 表、76 个 policy 和 24 个用户触发器（45 个事件绑定）；基线完成后由 `mall_migrator` 拥有 76 张应用表、59 个枚举和 15 个迁移函数，并已验证可执行后续 `ALTER TABLE`。
- 边界 DML：全部通过，覆盖数据库派生且不可改写的 30 分钟支付窗口、PASS 空证据、ABNORMAL 必须有证据、证据清单封存及追加拒绝、类型化单次验货处置、验货精确覆盖与数量等式、0% 佣金不生成流水和最小数据库权限；`mall_runtime` 仅可硬删收藏、购物车项、客户手机号授权和客户地址四类非交易数据，其他业务表无 `DELETE`。

## Prisma 7 使用边界

B0 已在工程根建立 `prisma.config.ts`、`prisma/` 和五应用脚手架；根目录中的 schema 与首迁移必须和本目录冻结产物逐字节一致。CLI/migration 通过 `DIRECT_URL` 连接，后续 runtime 通过 `@prisma/adapter-pg` 读取 `DATABASE_URL`。三端只调用 NestJS HTTPS API，禁止使用 Supabase client、Data API 或 `service_role` 密钥访问业务表。

## B8 与 B9 收口

B3-B6 历史交付见各自开发记录；B7 的 CH-015/CH-016、契约和最终证据见 `../05-开发管理/B7-消费者身份会话与隐私.md`。B7.0-B7.5 已完成，最终实现 SHA `3f844bfb9866854ceedb975ad0dc4fd7cacfb04a` 同 SHA 双绿，B7 development `GO`，CH-015 已自动失效。

B8 的 CH-017/CH-018、冻结契约、串行批次与最终证据见 `../05-开发管理/B8-登录后购物基础.md`。B8 最终 SHA `0fc5a8d3d1f07d3b5c9fcadf7ea4ca9560a0911a` 已同 SHA 双绿，B8 development `GO`，CH-017 已自动失效。

B9 的 CH-019/CH-020、契约/迁移边界及最终证据见 `../05-开发管理/B9-订单报价与库存预占.md`。B9.0-B9.5 已完成，最终复审保持 `P0=0/P1=0/P2=1`；最终 SHA `19f9ad57190b28d11922db805b39af95b2f7ba3b` 的普通 CI Run `33230769777` 与 Supabase development rollback-only smoke Run `33233087710` 同 SHA 且均为 `completed/success`，B9 development `GO`，CH-019 已自动失效。唯一 P2 TR-020 不阻断 development；staging 前外部独立复核不得豁免，staging、production 与真实支付仍为 `NO-GO`。

## 剩余上线门禁

- 正式微信商户号与证书到位后，在 staging 完成 raw body 验签、证书轮换、重放防护、ACK/重试、迟到支付自动退款和对账演练。
- 在目标 Supabase staging 重放 migration，复核 TLS、direct/session 连接、自定义角色、RLS、默认权限、备份/PITR 和恢复 runbook。
- 完成隐私、银行卡、代理合同、佣金税务与数据保留的外部合规审核。
