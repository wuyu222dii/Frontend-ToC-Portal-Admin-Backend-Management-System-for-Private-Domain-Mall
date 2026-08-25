# B5 Banner 与库存

> 批次：B5；当前产品/API 基线：v2.4.3 / CH-012；交付门禁：CH-011；更新日期：2026-08-25；当前状态：CH-012/B5.0 已通过本地验收并暂停，B5.1 尚未开始；数据范围：仅脱敏 development；staging/production：`NO-GO`。

## 1. 当前结论

用户已分别批准 CH-011 与 CH-012：CH-011 只解决独立 reviewer 的组织门禁，CH-012 授权实施 B5.0 Banner/库存契约解阻。B5.0 已完成验收并暂停；两者都不自动放行 B5.1 业务代码、staging、production 或真实数据。

B5.0 三路审计确认：ADM-07 Banner 与 ADM-08 库存人工调整/流水属于既有 MVP，现有冻结数据库足以零迁移实现；OpenAPI、公共内核和静态原型发现的 3 个 P0 与若干 P1 已按 CH-012 闭合。不依赖产品选择的 CI 加固已在当前工作树实施并通过本地检查，仍须由后续准确 SHA 的远端运行确认；本轮没有创建 B5.1 repository、API 或工程前端。

| 门禁 | 当前证据 | 结论 |
|---|---|---|
| B0-B4 development | B4 实现基准 `0929f2435e7f5b9ad745fd9cab60b066378e502e` 的普通 CI Run `32721588213` 与 Supabase Run `32722510890` 成功 | 通过 |
| B5 产品范围 | PRD 已冻结 ADM-07/08，库存人工调整为 HR-07 | 通过 |
| CH-011 单人开发门禁 | 用户于 2026-08-25 明确批准，仅适用于 B5 development | 通过 |
| 冻结数据库可承载性 | Banner、InventoryBalance、Reservation、Ledger、preview/idempotency/audit 均已有模型与权限 | 通过，无迁移 |
| CH-012 契约授权 | 用户于 2026-08-25 明确批准产品负责人 + 技术负责人立即执行 | 通过 |
| Banner 契约 | 创建/更新拆分、闭合启停、DELETE 唯一归档与 restore-to-DRAFT | 通过 |
| 库存低库存口径 | 无迁移删除 `low_stock` 和原型预警值 | 通过 |
| 库存 preview 内核 | 注册 `INVENTORY.ADJUST/INVENTORY` 并补齐失败语义 | 通过 |
| OpenAPI 契约 | `2.4.3-ch012`；172 paths / 196 operations / 196 unique operationId / 312 schemas / 692 schema refs / 2,578 local refs / 0 dangling refs | 通过 |

## 2. B5 范围

### 2.1 纳入

- ADM-07：Banner 图片、标题、闭合跳转目标、排序、投放时间、启停、软归档和恢复。
- ADM-08：按 SKU 查看实物、锁定、可售与活动预占，执行 HR-07 人工实物库存调整并查看只追加流水。
- `SUPER_ADMIN` 专属 NestJS repository/API、审计、幂等、乐观锁、高风险预览确认、后台路由和五视口验收。
- Banner 复用 B3 的 `READY/PUBLIC/BANNER` 文件上传闭环；库存复用 B4 创建的零值 `inventory_balance`。

### 2.2 不纳入

- 订单创建预占、支付扣减、取消释放、退款/验货自动回库等交易域写路径。
- 消费者 `/store/home` 工程实现；B5 只验证 Banner 当前生效投影的 repository 规则。
- 可配置低库存阈值、批量拖拽排序、多仓、批次/库位、盘点单和采购入库单。
- 真实微信、真实客户数据、真实资金链路、Supabase staging 或 production。

## 3. 冻结数据库依据

- `Banner` 已有 `file_id/title/target_type/target_id/target_url/status/sort_order/starts_at/ends_at/version/deleted_at`。
- `InventoryBalance` 已有实物、锁定与版本；`InventoryReservation*` 可复算活动预占；`InventoryLedger` 可保存只追加变化与调整后余额。
- 首迁移已约束 `physical_qty >= locked_qty >= 0`，并约束流水调整后余额；Banner 已有 target、时间窗、非负排序及 `READY/PUBLIC/BANNER` 文件触发器。
- `mall_runtime` 可更新 Banner/库存余额并插入库存流水，但不能更新或删除流水；Data API 角色没有应用表权限。
- 冻结哈希保持：Prisma `9a25a8eb747df9b4514568c829029efbd9f2f5a6fe9bd59ec9232ff287e368a2`；`0001_initial` `f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b`。

任何要求持久化每 SKU 预警阈值、为多态 Banner target 增加外键、增加库存事件唯一键或补索引的方案，都必须停止并另行申请迁移；不得修改冻结文件来绕过 B5.0。

## 4. B5.0 审计发现

| ID | 等级 | 发现 | 当前处置 |
|---|---|---|---|
| B5-C01 | P0 | Banner POST/PATCH 共用 `BannerWriteRequest`，可创建 ARCHIVED 或普通 PATCH 直接归档/恢复 | CH-012 拆分闭合创建、资料更新和启停动作；DELETE 成为唯一归档入口 |
| B5-C02 | P0 | `low_stock` 与原型预警值没有持久字段或冻结常量 | CH-012 无迁移方案删除查询、展示和写入 |
| B5-C03 | P0 | `HighRiskPreviewRepository` 只允许 BRAND/CATEGORY/PRODUCT/SKU | CH-012 扩展 `INVENTORY.ADJUST` 与 `INVENTORY` target |
| B5-C04 | P1 | `physical_delta` 未声明 PostgreSQL INTEGER 边界，失败不消费 preview 的语义未写明 | CH-012 闭合输入、preview warning 与 confirm 422 |
| B5-C05 | P1 | Inventory confirm 的 CommandResponse resource/status 未固定 | 固定 `resource_type=inventory`、`resource_id=sku_id`、`status=SUCCEEDED`、新余额 version |
| B5-C06 | P1 | 流水查询参数是枚举，响应 `ledger_type` 却退化为任意 string | CH-012 复用闭合库存流水枚举 |
| B5-C07 | P1 | Banner 响应没有可用的闭合幂等缓存策略 | CH-012/B5.0 公共内核新增 `BANNER_RESOURCE_RESPONSE`，不改数据库 |
| B5-C08 | P1 | 静态原型使用色块、人工编码/自由文本 target，并重复扣减售后占用 | CH-012 获批后同步真实文件、typed target、正确库存公式与 preview-confirm |
| B5-C09 | P2 | `inventory_reservation_item` 缺 sku-first 索引，ledger `business_id` 非唯一 | 先以真实规模 EXPLAIN 和幂等/preview 保证正确性，不在 B5.0 迁移 |

## 5. CH-011 交付门禁

CH-011 只接受 B5 development 期间缺少独立 reviewer 的剩余风险，并在 B5.4 验收结束时自动失效：

1. GitHub `supabase-development` Environment 继续与普通 CI 隔离，只允许 `main` 手动触发并显式确认脱敏 development 项目。
2. 每个业务批次仍须 `P0=0/P1=0` 后暂停；B5.4 必须登记同一实现 SHA 的普通 CI 与 Supabase rollback-only 成功 run，失败记录不能替代成功证据。
3. rollback-only 只使用 `mall_runtime`、synthetic 标识和顶层回滚，并在事务外断言无残留；本地 PostgreSQL/Redis/MinIO 不能替代远端证据。
4. 第三方 Actions 固定到核验 commit；Supabase CA 下载后校验固定 SHA-256；根级纵向 runner 纳入 lint。
5. CH-011 不批准 CH-012，不放宽冻结数据库、契约、并发、权限、安全或测试标准，也不适用于 staging/production。
6. 第一次进入 staging 前仍须外部独立人员复核代码、安全、数据库权限/迁移和验收证据，并保存可追溯记录。

## 6. CH-012 已批准契约

以下契约已由产品负责人和技术负责人批准，立即用于 B5.0 产品、OpenAPI、生成 contracts、公共内核和静态原型修订；不授权提前实施 B5.1 业务模块。

### 6.1 Banner

- 保持现有 5 个 operation，不新增 path。
- 创建改用闭合 `BannerCreateRequest`，显式且固定 `initial_status=DRAFT`；服务端生成 ID，不接受人工 Banner 编码。
- 资料更新改用不含状态的闭合 `BannerUpdateRequest`；启停改用同一 PATCH operation 的闭合 `BannerStatusAction(action=ACTIVATE|DEACTIVATE)` 分支。Banner 不属于 HR-01 至 HR-15，不新增 preview。
- 状态机固定为 `DRAFT/INACTIVE -> ACTIVATE -> ACTIVE`、`ACTIVE -> DEACTIVATE -> INACTIVE`、`DRAFT/INACTIVE -> DELETE -> ARCHIVED + deleted_at`；ACTIVE 不得直接归档；restore 固定 `ARCHIVED -> DRAFT + deleted_at=null`。
- POST 需要新幂等键；PATCH/DELETE/restore 需要新幂等键和 `If-Match`。DELETE/restore 继续要求 2-500 字符原因，启停不虚构高风险原因。
- 默认列表排除 ARCHIVED，仅显式 `status=ARCHIVED` 返回归档；固定 `sort_order ASC,id ASC`。公开投影仅返回 ACTIVE、未归档，且满足 `(starts_at IS NULL OR starts_at <= now) AND (ends_at IS NULL OR now < ends_at)` 的记录并使用同一稳定排序；起止均非空时 `ends_at > starts_at`。
- ACTIVE 资料更新与 ACTIVATE 必须重查 `READY/PUBLIC/BANNER` 文件；PRODUCT/CATEGORY target 必须存在且 ACTIVE，目标失效后公开投影自动排除。URL 最长 500 字符，仅允许 HTTPS 且 origin 命中服务端 allowlist；allowlist 为空时不开放 URL target。
- 新增闭合 `BANNER_RESOURCE_RESPONSE` 幂等缓存策略，用于 POST/PATCH/DELETE/restore 精确重放；策略只在代码层扩展。

### 6.2 库存

- 删除 `GET /admin/inventory` 的 `low_stock`；原型删除预警值、售后占用和独立备注。库存统一为 `available_qty=physical_qty-locked_qty`，`active_reservation_qty` 用于复核锁定事实，不再二次扣减。
- `InventoryView` 补齐 SKU 名称与生命周期状态；列表固定按 `product_name ASC,sku_id ASC`，归档 SKU 允许只读和查看流水，但禁止人工调整，须先恢复为 INACTIVE。
- `InventoryAdjustmentAction.physical_delta` 固定为非零 int32，原因 2-500 字符。调整只改变 physical，不直接修改 locked。
- preview 使用 `HASH_ONLY`，绑定 actor、session、`INVENTORY.ADJUST`、`INVENTORY`、sku、规范化 body 和余额 version；成功响应继续 no-store/private，TTL 60 秒。
- preview 计算并返回 physical/locked/available 调整前后；发现 `physical_after < locked_qty` 时仍返回 200 warning，confirm 以 `STOCK_INSUFFICIENT` 422 阻断且不消费 preview。结果超 PostgreSQL INTEGER 时以新增 `INVENTORY_QUANTITY_OUT_OF_RANGE` 422 阻断。
- confirm 需要相同业务字段、未过期 token/确认哈希、新幂等键和 `If-Match`；使用 `COMMAND_RESPONSE` 精确重放，返回 `inventory/sku_id/SUCCEEDED/new balance version`。
- 成功事务原子完成 preview 消费、余额/version 更新、一条 `MANUAL_INCREASE` 或 `MANUAL_DECREASE` 流水、审计、幂等和 outbox；失败全部回滚。同 token 换新键、并发确认或重复同键不得产生第二条流水。
- 流水 `ledger_type` 使用闭合枚举，固定 `occurred_at DESC,id DESC`；before 值由 `after-change` 复算。B4 零余额创建无需补写 `INITIAL`，`INITIAL` 仅保留给未来受控导入事实。

### 6.3 不变项

- 产品/OpenAPI 版本升级为 `v2.4.3 / 2.4.3-ch012`；实测保持 172 paths / 196 operations / 196 unique operationId，并得到 312 schemas / 692 schema refs / 2,578 local refs / 0 dangling refs。
- Prisma、`0001_initial`、76 models / 59 enums 和冻结哈希逐字节不变，migration diff 必须为 0。
- 页面仍为 21 MP / 9 AGT / 22 ADM，FR/AC/US/HR 数量不增加；只闭合 ADM-07/08 的既有要求。

## 7. 后续批次

| 批次 | 唯一交付 | 进入条件 | 退出条件 |
|---|---|---|---|
| B5.0 | CH-011、契约审计、CH-012 提案、产品/API/原型/生成类型冻结 | B4 development 已 GO，CH-011 已批准 | CH-012 获批并实施；契约/原型/冻结 DB P0/P1=0 后暂停 |
| B5.1 | Banner repository/API、文件挂接、CRUD、启停、归档恢复、时间和 target 校验 | B5.0 已验收暂停 | 5 个 operation、幂等/409/403/排序/时间矩阵通过，P0/P1=0 |
| B5.2 | Inventory repository/API、列表、HR-07 preview-confirm、流水 | B5.1 已验收暂停 | 4 个 operation、边界/并发/篡改/过期/重放/流水原子性通过，P0/P1=0 |
| B5.3 | ADM-07/08 路由、导航、Banner 上传、库存预览确认和流水 | B5.2 已验收暂停 | loading/empty/401/403/409/422/500/重复提交/成功与五视口通过 |
| B5.4 | 全量回归、真实纵向链路、普通 CI、Supabase rollback-only | B5.3 已验收暂停 | 同一实现 SHA 双绿、无残留、最终 P0/P1=0 |

## 8. 验收与回退

- 契约：Redocly、生成漂移、闭合 DTO、错误码、统计、Banner 状态/target/time matrix、库存 preview-confirm matrix。
- 数据库：Prisma validate、冻结字节检查、空库回放、权限故障注入、migration diff=0；库存边界、并发预占、流水复算和恰好一次。
- 前端：375/390/414/1024/1440，覆盖 loading、empty、401、403、409、422、500、重复提交和成功；409 必须刷新并销毁旧 preview，不自动覆盖。
- 远端：最终 B5 实现 SHA 的普通 CI 与 Supabase rollback-only 均成功并登记；没有远端证据不得标记 B5 development 完成。
- CH-012 尚未进入业务实现时可整体回退文档/OpenAPI/生成类型；进入 B5.1 后通过关闭 Banner/库存路由和导航回退，不执行数据库降级，不删除审计、幂等或库存流水。

## 9. 当前暂停点

CH-011 与 CH-012 均已登记。B5.0 已通过 Redocly、专项契约/生成漂移、公共内核、全仓 lint/typecheck/test/build、静态原型五视口、敏感扫描、Prisma/首迁移冻结、PostgreSQL 空库回放/权限故障注入/migration diff=0 和独立复核，结论为 `P0=0/P1=0`，现已暂停。实测契约统计为 172 paths / 196 operations / 196 unique operationId / 312 schemas / 692 schema refs / 2,578 local refs / 0 dangling refs；全仓测试为 650 passed / 60 个环境模式跳过，原型为 96 个响应式渲染、21/9/22 页面契约、14 条小程序流程和 18 条后台/代理流程。B5.1、B5.2、B5.3、B5.4 均未开始；加固后的 workflow 尚未在新的准确提交 SHA 上执行，不能用历史 run 替代，最终 B5 远端双绿仍属于 B5.4。
