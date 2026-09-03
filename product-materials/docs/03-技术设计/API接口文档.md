# 洗化产品私域商城 API 接口文档

## 文档控制

| 项目 | 内容 |
|---|---|
| 文档版本 | v2.4.11 |
| 对应产品基线 | MVP/PRD v2.4.11、CH-001 至 CH-028；在线接口以 CH-028 为准 |
| 接口阶段 | B0-B12 development 已完成并维持 `GO`。CH-028 已批准；OpenAPI 基线为 `2.4.11-ch028`，本地实测 `173 paths / 198 operations / 198 unique operationId / 330 schemas / 725 schema refs / 2,754 local refs / 0 dangling refs`，Redocly 0 warning，generated contracts SHA-256 为 `e14870ab790621f14d9794f3c6cded29e8c676f8921c177e22f5e40df9bf142c`，完整 manifest SHA-256 仍为 `128509f76f2e62ebe78cd0465205a94236f87f70904bf614664dd1b02548dc80`。B13.0 最终 SHA `250f4c8fabb08e170c012889c392461794ed8875` 的普通 CI `33615918343`、development migration `33618959837` 与 rollback-only smoke `33619152221` 已按顺序同 SHA 三绿，B13.0 已退出。截至 2026-09-03，B13.1 最终 SHA `a565a3c406ad2f1af498f9f58b556315d30262d6` 的普通 CI `33704252016`、development migration `33706364405` 与 rollback-only smoke `33706498758` 同 SHA 三绿，B13.1 已退出。B13.2 最终 SHA `8df89b98f8b243e36c3bf8bf86b95a8e9d418acd` 的普通 CI `33718349743`、development migration `33721734961` 与 rollback-only smoke `33722097476` 已按顺序同 SHA 三绿并退出；B13.3 最终 SHA `3707c67c7dc1b21de796f41ccf7b811556bbc47f` 的普通 CI `33731197140`、development migration `33734111086` 与 rollback-only smoke `33734431011` 已按顺序同 SHA 三绿并退出；B13.4 本地候选与复审已完成，正在等待同 SHA 三门禁，B13.4 未退出且 B13.5 未准入；B13.5-B13.9 Agent/Admin 业务 operation 仍未开放，B13 development 未标记 `GO`。B12 orphan `P2=1` 继续阻断 staging/真实数据；真实客户数据、staging、production、真实微信退款与真实物流集成均为 `NO-GO` |
| 推荐后端 | Node.js + NestJS + Prisma + Supabase 托管 PostgreSQL |
| 更新时间 | 2026-09-03 |

## 1. 设计目标

本接口同时服务消费者微信小程序、一级代理工作台和总部管理后台。设计优先保证以下事实不会被客户端篡改或因并发产生重复结果：

- 商品成交、库存锁定和订单项均以 `sku_id` 为最小单位；
- 待付款订单在调用支付前已经存在，取消支付或稍后支付不会丢单；
- 支付成功、最终代理归因和订单项佣金快照在同一一致性流程中完成；
- 支付、退款、售后占用、佣金和提现均支持幂等与状态前置校验；
- 订单、支付、退款和履约状态相互独立，由服务端生成用户展示状态；
- 商品白名单只控制代理推广权限，不参与已绑定客户订单的佣金资格判断；
- 银行卡、手机号和地址按最小权限返回，敏感明文不进入常规接口、日志或埋点。

## 2. 公共约定

### 2.1 基础路径与终端

OpenAPI 与所有客户端只配置一个 server：`/api/v1`。下表及全文路径都从 `/store`、`/agent`、`/admin`、`/callbacks` 或 `/files` 开始，禁止再次拼接终端前缀或写入第二个 `/api/v1`。

| 终端 | 路径前缀 | 身份范围 |
|---|---|---|
| 消费者小程序 | `/store` | 游客或当前 `CUSTOMER` |
| 一级代理工作台 | `/agent` | 当前 `AGENT_ADMIN` |
| 总部管理后台 | `/admin` | 当前 `SUPER_ADMIN` |
| 第三方回调 | `/callbacks` | Provider 签名校验，不使用用户会话 |
| 受控文件 | `/files` | 按当前角色与资源归属鉴权 |

客户端不得通过传入 `customer_id`、`agent_id` 或角色参数扩大数据范围。服务端必须从访问令牌确定当前主体和数据作用域。

### 2.2 数据访问与认证边界

- 本文全部业务接口都终止于 NestJS API；消费者小程序、代理端和总部端不得直连数据库，不得使用 Supabase client 或 Data API。
- 部署时必须关闭 Supabase Data API；数据库 grants 与 RLS 默认拒绝继续保留，不能以“接口已关闭”为理由省略权限配置。
- Supabase 仅托管 PostgreSQL。微信登录、管理员密码登录、access/refresh token、手机号授权和 RBAC 继续由 NestJS 实现，不接入 Supabase Auth。
- 前端不得获得 `anon`、`authenticated`、`service_role` 密钥、数据库连接串或数据库凭据；NestJS API/Worker 也不使用 `service_role`，而使用独立最小权限数据库 runtime 角色。
- 应用表仅位于 `public`，不关联 Supabase `auth` 或 `storage` schema。文件上传、签名下载仍通过 NestJS File API 与独立对象存储完成。
- PostgreSQL 对 `anon`、`authenticated` 默认拒绝访问；RLS 只隔离数据库连接角色，不替代本节定义的 NestJS 业务授权和数据范围校验。

### 2.3 请求头

| 请求头 | 使用场景 | 说明 |
|---|---|---|
| `Authorization: Bearer <token>` | 普通受保护接口 | 业务 access token；三端 refresh 不要求 access bearer |
| `Authorization: Bearer <pre-auth>` | 后台首次 TOTP enroll、LOGIN verify/recovery | 只允许服务端声明的下一步，不是业务 session |
| `Idempotency-Key` | 订单、支付、售后、退款、提现、规则变更等写操作 | UUID，主体 + 路径范围内 24 小时唯一；退款每次新尝试必须使用未用于该退款单的新键 |
| `X-Request-Id` | 可选 | 客户端追踪 ID；缺失时由服务端生成 |
| `X-Candidate-Token` | 游客读取或替换推广候选 | 首次创建候选后由服务端签发的短时不透明 token；GET 不消费，替换或登录迁移时原子失效；不使用设备 ID |
| `If-Match` | 配置、高风险写操作、订单取消、CH-024 履约及 CH-026 已有售后/退款资源写操作 | 必填，携带客户端已读取的资源 ETag，例如 `"12"`；版本变化返回 `RESOURCE_VERSION_CONFLICT`。同键同请求的已完成幂等重放先于版本校验 |

### 2.4 数据格式

- 时间统一使用 UTC ISO 8601，例如 `2026-08-11T02:30:00Z`；报表按 `Asia/Shanghai` 计算自然日/月。
- ID 统一作为字符串返回，客户端不得假设为可安全运算的 JavaScript Number。
- CH-026 延续并补齐所有 `order_id`、`order_item_id`、`shipment_id`、`payment_intent_id`、`aftersale_id`、`refund_id` 与 `file_id` 路径及请求标识的 26 位 ULID 校验；非法值在进入 repository 前返回参数错误，不允许按普通字符串查询。
- 金额使用两位小数字符串，禁止使用浮点数。OpenAPI 分为 `PositiveMoney`（业务输入和必须为正的事实）、`NonNegativeMoney`（余额、累计金额和普通响应）与 `SignedMoney`（佣金/钱包账本变动）；不得用同一个可负 schema 接收退款、售后或提现金额。
- 佣金比例使用百分比字符串，例如 `"12.5000"` 表示 12.5%；合法范围严格为 `0.0000` 至 `100.0000`。计算固定为 `HALF_UP(commission_base * effective_rate / 100, 2)`；`null` 表示继承，`"0.0000"` 表示明确无佣金。
- 分页默认 `page=1&page_size=20`，`page_size` 最大 100。
- 删除业务实体默认是软删除或归档；历史订单、账本、规则版本和审计记录不可物理删除。

列表查询使用端点专用参数，不向单资源 GET 注入分页。所有日期筛选均按 `Asia/Shanghai` 自然日包含 `date_to`，服务端转换为 UTC 半开区间 `[date_from 00:00, date_to+1day 00:00)`；金额上下限是两位 decimal string。未显式传 `sort` 时普通列表固定 `created_at DESC,id DESC`，品牌和分类固定 `sort_order ASC,id ASC`，后台商品列表固定 `published_at DESC NULLS LAST,id DESC`，Store 商品列表默认 `COMPREHENSIVE`，流水固定 `occurred_at DESC,id DESC`，排行固定净值 DESC、资源 ID ASC，保证翻页稳定。

| 列表 | 专用 query（除 `page/page_size`） |
|---|---|
| `/store/products` | `keyword`（trim 后 1-200，仅商品名大小写不敏感匹配）、`brand_id`、`category_id`、`sort=COMPREHENSIVE\|HOT\|NEWEST\|PRICE_ASC\|PRICE_DESC`；默认 COMPREHENSIVE |
| `/store/orders` | `display_group=ALL\|PENDING_PAYMENT\|PENDING_SHIPMENT\|SHIPPING\|COMPLETED\|REFUND_AFTERSALE`，以及 `order_no`、四轴状态、`date_from/date_to`、`min_amount/max_amount`；Tab 由服务端映射，不由客户端拼状态 |
| `/agent/orders` | 仅返回 `payment_status=PAID` 且支付快照 `final_agent_id` 为当前代理的订单；支持 `customer_id`、订单/退款/履约状态、`has_aftersale`、日期、金额和排序，不接受 `payment_status` 筛选 |
| `/admin/orders` | `order_no`、订单/支付/退款/履约状态、`customer_id/agent_id`、`date_from/date_to`、`min_amount/max_amount` |
| 三端 `/aftersales` | `aftersale_no`、`order_id`、`status`、`type`、`date_from/date_to`；总部可按 `customer_id` |
| `/agent/customers` | `keyword`、`date_from/date_to`；结果强制为当前代理名下 `account_status=ACTIVE` 且 `binding_status=BOUND`，不提供 `UNBOUND/ENDED` 查询 |
| `/admin/customers` | `keyword`、`binding_status`、`date_from/date_to`、`agent_id`、`min_consumption/max_consumption` |
| `/admin/agents` | `keyword`、`status`、`authorization_mode`、`date_from/date_to` |
| 三端商品管理列表 | `keyword`、`brand_id`、`category_id`、`status`、`recommended`；代理列表仅返回授权且在售记录 |
| `/admin/brands`、`/admin/categories` | `keyword`、`status`；默认排除 ARCHIVED，显式 `status=ARCHIVED` 只返回软删除归档记录；排序固定 `sort_order ASC,id ASC` |
| 三端 `/withdrawals` | `withdrawal_no`、`status`、`date_from/date_to`、`min_amount/max_amount` |
| `/agent/commissions` | `state`、`ledger_type`、`order_no`、`date_from/date_to` |
| `/admin/inventory` 与流水 | `keyword`、`category_id`；流水另有闭合 `ledger_type`、`date_from/date_to`，不提供无持久口径的 `low_stock` |
| `/admin/audit-logs` | `actor_id`、`module`、`action`、`result_code`、`target_type/target_id`、`date_from/date_to` |
| `/admin/agents/{agent_id}/commissions`、`/wallet-ledger` | 只读分页；前者支持 position/流水类型与日期，后者支持钱包流水类型与日期 |
| 支付对账、佣金 SKU/版本 | 分别支持 `status/last_error_code/due_before` 与 `keyword/category_id/source/status/date_from/date_to` |
| 四类报表 | `timezone`、日期/月边界与 `scope=GLOBAL\|DIRECT\|AGENT`、可选 `agent_id`；排行另分页 |

### 2.5 响应封装

成功：

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "request_id": "req_01J5..."
}
```

失败：

```json
{
  "code": "ORDER_PRICE_CHANGED",
  "message": "部分商品价格已变化，请确认后重新提交",
  "details": {
    "items": []
  },
  "request_id": "req_01J5..."
}
```

### 2.6 HTTP 与业务错误

| HTTP | 业务码示例 | 含义 |
|---:|---|---|
| 400 | `INVALID_ARGUMENT` | 参数格式错误 |
| 401 | `AUTH_REQUIRED`、`SESSION_EXPIRED` | 未登录或会话失效 |
| 403 | `PERMISSION_DENIED`、`REAUTH_REQUIRED` | 角色、数据范围或二次验证不足 |
| 404 | `RESOURCE_NOT_FOUND` | 不存在或无权查看时统一返回 |
| 409 | `RESOURCE_VERSION_CONFLICT`、`STATE_CONFLICT`、`SOFT_DELETED_KEY_RESERVED`、`CHECKOUT_QUOTE_EXPIRED`、`CHECKOUT_QUOTE_MISMATCH`、`CHECKOUT_REQUOTE_REQUIRED`、`ORDER_NOT_CANCELLABLE`、`ORDER_PAYMENT_EXPIRED`、`PAYMENT_NOT_ALLOWED`、`PAYMENT_RESULT_CONFLICT`、`SHIPMENT_STATE_CONFLICT`、`ORDER_NOT_RECEIVABLE` | 乐观锁、非法状态、软删除业务键保留、报价/支付过期或不匹配、支付状态冲突、履约状态冲突，或订单尚不可确认完成 |
| 422 | `STOCK_INSUFFICIENT`、`AFTERSALE_QUOTA_EXCEEDED`、`RETURN_ADDRESS_NOT_CONFIGURED`、`ACTIVE_PRODUCT_DEPENDENCY`、`FILE_CONTENT_MISMATCH`、`PRODUCT_PRIMARY_IMAGE_REQUIRED`、`PRODUCT_ACTIVE_SKU_REQUIRED`、`ACTIVE_SKU_DEPENDENCY`、`ACTIVE_INVENTORY_RESERVATION`、`INVENTORY_QUANTITY_OUT_OF_RANGE`、`CART_ITEM_LIMIT_EXCEEDED`、`DEFAULT_ADDRESS_REQUIRED`、`ACTIVE_AFTERSALE_BLOCKS_SHIPMENT`、`SHIPMENT_ITEMS_MISMATCH` | 业务依赖、售后/退货地址/活动预占、库存/购物车整数边界、默认地址约束、发货项与全部剩余可发数量不一致，或文件实测内容校验不通过 |
| 429 | `RATE_LIMITED`、`REAUTH_LOCKED` | 访问或验证次数受限 |
| 500 | `INTERNAL_ERROR` | 未预期错误，不暴露堆栈和敏感值 |
| 503 | `PAYMENT_PROVIDER_UNAVAILABLE`、`PAYMENT_CONFIGURATION_UNAVAILABLE` | 支付 Provider 或配置暂不可用；必须 fail-closed，不得伪造支付结果 |

## 3. 公共状态类型

### 3.1 订单聚合状态

```ts
type OrderStatus =
  | "PENDING_PAYMENT"
  | "PENDING_SHIPMENT"
  | "SHIPPING"
  | "COMPLETED"
  | "CLOSED";

type PaymentStatus = "UNPAID" | "PROCESSING" | "PAID";
type RefundProgressStatus = "NONE" | "PARTIAL" | "FULL";
type RefundProcessingStatus = "IDLE" | "REFUNDING" | "FAILED";
type FulfillmentStatus =
  | "NOT_STARTED"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

type CloseReason =
  | null
  | "USER_CANCELLED"
  | "PAYMENT_TIMEOUT"
  | "FULL_REFUND_BEFORE_SHIPMENT";

type CompletionReason =
  | null
  | "CUSTOMER_CONFIRMED"
  | "ADMIN_FORCED"
  | "FULL_REFUND_AFTER_SHIPMENT";

type PaymentIntentStatus =
  | "CREATING"
  | "OPEN"
  | "CLOSE_PENDING"
  | "CLOSED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "SUCCEEDED";

type PaymentAttemptStatus =
  | "INITIATED"
  | "SUCCEEDED"
  | "SUCCEEDED_LATE"
  | "FAILED"
  | "CANCELLED";

type DisplayStatus =
  | "待付款"
  | "待发货"
  | "运输中"
  | "已完成"
  | "退款处理中"
  | "部分退款"
  | "退款完成"
  | "退款异常待处理"
  | "已关闭"
  | "支付异常处理中";
```

订单详情接口必须同时返回 `order_status`、`payment_status`、`refund_progress_status`、`refund_processing_status`、`fulfillment_status`、`close_reason`、`completion_reason`、`payment_resolution` 和 `display_status`，不允许客户端自行合并状态轴。

`display_status` 使用下表从上到下首个命中规则，服务端是唯一计算方：

| 优先级 | 条件 | `display_status` |
|---:|---|---|
| 1 | `payment_resolution=MANUAL_REQUIRED` | 支付异常处理中 |
| 2 | `refund_processing_status=FAILED` | 退款异常待处理 |
| 3 | `payment_resolution=LATE_SUCCESS_REFUND_PENDING` 或 `refund_processing_status=REFUNDING` | 退款处理中 |
| 4 | `payment_resolution=LATE_SUCCESS_REFUNDED` 或 `refund_progress_status=FULL` | 退款完成 |
| 5 | `refund_progress_status=PARTIAL` | 部分退款 |
| 6 | `order_status=CLOSED` | 已关闭 |
| 7 | `order_status=PENDING_PAYMENT` | 待付款 |
| 8 | `order_status=PENDING_SHIPMENT` 且 `fulfillment_status=READY_TO_SHIP` | 待发货 |
| 9 | `order_status=SHIPPING` 或 `fulfillment_status` 为 `SHIPPED/IN_TRANSIT` | 运输中 |
| 10 | `order_status=COMPLETED` 或 `fulfillment_status=DELIVERED` | 已完成 |

`refund_progress_status` 只按成功退款累计计算，`refund_processing_status` 只反映当前处理/失败事实；`PARTIAL + FAILED` 是合法组合。`close_reason` 与 `completion_reason` 始终出现在响应中：CLOSED 只能有前者，COMPLETED 只能有后者。发货后全额退款展示“退款完成”，订单事实为 `COMPLETED/FULL_REFUND_AFTER_SHIPMENT`。

### 3.2 售后状态

`PENDING_REVIEW`、`REJECTED`、`REFUNDING`、`WAITING_RETURN`、`WAITING_RECEIPT`、`RETURN_EXCEPTION`、`REFUNDING_AFTER_RETURN`、`REJECTED_AFTER_RETURN`、`REFUND_FAILED`、`COMPLETED`、`CANCELLED`。

消费者仅可在 `PENDING_REVIEW`，或未提交退货物流的 `WAITING_RETURN` 取消。`REFUND_FAILED` 保留订单项可退额度占用，等待总部重试或财务人工处理。

### 3.3 佣金与提现状态

- 订单项佣金：`NONE`、`EXPECTED`、`CANCELLED`、`AVAILABLE`。
- 佣金/钱包流水：`EXPECTED_CREATED`、`EXPECTED_REDUCED`、`EXPECTED_CANCELLED`、`AVAILABLE_CREDIT`、`REFUND_DEBIT`、`WITHDRAWAL_FREEZE`、`WITHDRAWAL_RELEASE`、`WITHDRAWAL_PAID`。
- 提现：`PENDING`、`APPROVED`、`REJECTED`、`PAID`。

## 4. 消费者小程序接口

### 4.1 登录、授权与隐私

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `GET` | `/store/legal-documents` | 公开 | 用户协议、隐私政策、手机号授权说明三份当前快照；no-store，独立 120/60 秒限流 |
| `POST` | `/store/auth/wechat/login` | 游客 | 使用 code 和当前双协议登录；development/test 可由 Mock Provider 替代 |
| `POST` | `/store/auth/refresh` | 已登录 | 刷新会话并轮换 refresh token |
| `POST` | `/store/auth/logout` | 已登录 | 注销当前会话 |
| `GET` | `/store/profile` | CUSTOMER | 当前消费者资料，账户手机号默认掩码 |
| `PATCH` | `/store/profile` | CUSTOMER | 更新非敏感资料；要求 `Idempotency-Key` 和 `If-Match` |
| `POST` | `/store/profile/phone-authorizations` | CUSTOMER | 服务端 Provider 验证自愿手机号授权；要求幂等与 `If-Match` |
| `DELETE` | `/store/profile/phone` | CUSTOMER | 撤回账户手机号授权；要求幂等与 `If-Match`，不改历史快照 |
| `POST` | `/store/privacy/deletion-requests/preview` | CUSTOMER | 预览注销资格和影响；合格时签发 5 分钟能力 |
| `POST` | `/store/privacy/deletion-requests` | CUSTOMER | 同步确认注销并撤销全部会话；HASH_ONLY |

微信登录请求必须同时提交已展示且明确接受的协议版本：

```json
{
  "code": "wechat-login-code",
  "candidate_token": "optional-high-entropy-token-from-link-open",
  "consents": [
    { "type": "USER_AGREEMENT", "document_version": "user-v3", "accepted": true },
    { "type": "PRIVACY_POLICY", "document_version": "privacy-v5", "accepted": true }
  ]
}
```

客户端必须先读取 `/store/legal-documents` 返回的 USER_AGREEMENT、PRIVACY_POLICY、PHONE_AUTHORIZATION 三份当前快照。登录 `consents` 是前两份各一次的固定二元组；手机号授权 consent 单独匹配第三份。均须 `accepted=true` 且版本精确匹配。缺失、重复、未知或过期版本返回 `CONSENT_VERSION_MISMATCH` 409，不产生半成品事实。`code` 为 1-512、`candidate_token` 为 32-512，均 write-only。服务端 Provider 换取主体后，在同一事务创建/锁定 account/customer_profile、写不可覆盖 consent，并签发固定 `role=CUSTOMER`、`assurance=WECHAT`、`audience=qingxu-store` 的 Store 会话。

B7 固定一个消费者微信 AppID，服务端按 `(AppID, openid)` 语义识别账户；当前客户端不得提交或切换 AppID。现有 `account.wechat_open_id` 的唯一性只适用于该单 AppID 范围，`wechat_union_id` 仅为可空元数据，不作为登录键且不触发账号自动合并。未来支持多个 AppID 必须先变更契约并迁移为显式复合身份键。

法律文本 GET 使用每 HMAC 来源 IP 120 次/60 秒独立 Redis 固定窗口；登录使用 10 次/900 秒。Redis 异常均 fail closed。Store token 不得被 `qingxu-admin-web` 管理守卫接受，反向亦然。登录、refresh、logout、profile/手机号、归因和注销等 B7 敏感/本人操作的成功及全部 JSON 错误响应统一 `Cache-Control: no-store, private` 和 `Pragma: no-cache`；敏感错误的 `rejected_value` 只能为 null。logout 与其他携带敏感凭据的写操作使用 `HASH_ONLY` 幂等，不缓存或重放 token。

手机号授权请求：

```json
{
  "provider_credential": "mock-or-wechat-phone-code",
  "consent": {
    "type": "PHONE_AUTHORIZATION",
    "document_version": "phone-v1",
    "accepted": true
  }
}
```

手机号授权成功使用标准 `ProfileResponse`，只返回当前 CUSTOMER 最小资料、掩码手机号与验证事实：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "customer_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "nickname": "林青",
    "avatar_url": null,
    "city": "杭州",
    "phone_tail": "6821",
    "phone_masked": "138 **** 6821",
    "phone_source": "WECHAT",
    "phone_verified_at": "2026-08-11T03:00:00Z",
    "version": 4
  },
  "request_id": "req_example"
}
```

收货地址中的联系电话不得写入账户手机号字段。未授权账户手机号时，代理端客户接口返回 `phone_tail: null`。

客户端不得提交 Provider；服务端由 `STORE_PHONE_PROVIDER` 选择 MOCK/WECHAT，Mock 只允许 development/test。profile PATCH、手机号授权和撤回均要求 `If-Match` 与新幂等键；同一客户最多一条 `revoked_at IS NULL` 当前记录。订单提交只记录归因候选，不复制昵称、手机号尾号或城市；这些脱敏客户快照仅在支付成功并冻结最终归因时写入。

注销 preview 请求固定为 `{ "acknowledged": true }`，始终返回 200，且两个分支都完整返回 `eligible/blockers/impacts/preview_token/confirmation_hash/expires_at/account_version`。`eligible=false` 时 token/hash/expiry 均为 null，blocker `resource_type` 只允许 `ORDER/AFTERSALE/PAYMENT/REFUND/FINANCIAL_ANOMALY`；只有合格预览才返回空 blockers、32-512 字符 token、64 位小写十六进制 confirmation hash 和 5 分钟 expiry。`impacts` 只允许 `REVOKE_ALL_SESSIONS/END_SERVICE_AGENT_BINDING/INVALIDATE_ATTRIBUTION_CANDIDATES/ANONYMIZE_ACCOUNT_PROFILE/DELETE_NON_TRANSACTIONAL_PII/ANONYMIZE_AGENT_HISTORY/RETAIN_REQUIRED_TRANSACTION_FACTS`。

同步 confirm 请求固定为 `{ "acknowledged": true, "preview_token": "...", "confirmation_hash": "..." }`，同时要求 `If-Match` 和新幂等键，并重新检查非终态订单/售后、未结清支付/退款或财务异常；新阻断返回 `ACCOUNT_DELETION_BLOCKED` 422。

无阻断时，confirm 单事务清空身份凭据和客户资料，撤销全部 session/refresh，清理允许硬删的手机号/地址/收藏/购物车数据，结束绑定、使候选失效并匿名化代理历史投影。任一步失败整体回滚。confirm 使用 `HASH_ONLY`，不缓存或重放完成响应；提交后旧 bearer 已失效，重复请求返回认证失效或已完成冲突，不提供 current GET。

### 4.2 推广候选与服务代理

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/store/attribution/candidates` | 游客/CUSTOMER | 打开代理推广链接时校验并保存 30 分钟候选 |
| `GET` | `/store/attribution/candidate` | 游客/CUSTOMER | 查询当前有效候选和剩余秒数 |
| `POST` | `/store/attribution/candidate/confirm` | CUSTOMER | 明确确认并建立长期绑定 |
| `POST` | `/store/attribution/candidate/reject` | CUSTOMER | 拒绝并清空候选 |
| `GET` | `/store/service-agent` | CUSTOMER | 只读查看当前服务代理 |

候选创建请求：

```json
{
  "invite_code": "QY8K2P",
  "promotion_asset_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"
}
```

规则：

- 已登录且未绑定用户立即得到 `confirmation_required: true`，无需退出登录再进入流程。
- `invite_code` 长度固定 1-128，`promotion_asset_id` 固定为 26 字符 Crockford ULID；服务端从仍有效且匹配邀请码/代理的 promotion asset 解析 target type、target ID 和公开跳转，拒绝客户端覆盖目标。
- 游客首次创建候选时响应一次 `candidate_token`，数据库只保存用途隔离的 HMAC/哈希，且与幂等键、来源 IP 使用不同 domain/scope；固定 30 分钟有效。游客后续 GET 和创建时的可选旧候选定位均使用 `X-Candidate-Token`：GET 不消费，候选替换或登录迁移原子失效 token hash，confirm/reject 消费迁移后的候选事实。不采集或复用设备标识；只有提交有效旧 token 时新候选才能使旧候选失效，未携带时不可强行关联，旧候选按 TTL 自然过期。登录迁移、confirm/reject 重新校验 token/客户/候选绑定，不匹配返回 `ATTRIBUTION_CANDIDATE_MISMATCH` 409。
- 候选创建允许 bearer、candidate token 或无凭据三种入口，候选查询只允许前两种，但都严格 fail closed：同时携带两种凭据返回 `INVALID_ARGUMENT` 400；存在 Authorization 时只校验 `qingxu-store/CUSTOMER/WECHAT` bearer，否则存在候选 token 时必须校验该 token，任何无效或过期凭据均返回 401，不得降级为另一凭据或匿名分支。仅创建接口在两者都未携带时按匿名请求处理；查询接口无凭据返回 401。
- 候选创建、查询和拒绝分别使用 `AttributionCandidateCreateResponse`、`AttributionCandidateQueryResponse`、`AttributionCandidateRejectResponse`。创建响应是闭合三选一：有效 candidate（service_agent/public_fallback 为 null）、已有最小 service_agent（candidate/token/fallback 为 null），或不可归因但仍可公开访问的 public_fallback（candidate/token/service_agent 为 null）。有效 candidate 分支中，无凭据匿名请求和 candidate-token 请求必须签发新的非空 32-512 字符 token，bearer 请求必须返回 null；其他两个分支 token 始终为 null。创建响应必须返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`；查询和拒绝 DTO 不得出现 token 字段。
- 有效候选必须返回服务端解析的 `public_target_url`。自定义白名单商品被撤权后，旧商品推广素材返回 `attribution_eligible: false`，但仍通过该公开 URL 正常打开商品页。
- 白名单不参与已绑定客户后续订单的佣金判断；支付接口不保存商品授权快照。
- 已绑定用户访问其他代理链接返回当前绑定且不创建新候选。
- 邀请码轮换或停用后，未确认候选在确认时必须再次校验并失效；已有绑定不受影响。
- 绑定确认、总部转移和创建订单都以永远存在的 `customer_profile/version` 为共同串行根：先锁客户并递增 version，再读取/结束当前 binding。两个确认并发时首个提交胜出，后到返回胜出绑定；部分唯一索引只作兜底。登录请求可携带本地安全保存的可选 `candidate_token`：登录事务锁 token 候选与 customer_profile，原子迁移为 customer 候选并清除 token hash；过期、撤权、已绑定或已有 customer 候选按当前事实裁决。token 重放不得重复建候选，双 token 并发最多保留首个有效 customer 候选。
- `/store/service-agent` 使用专用最小 DTO。只要长期绑定仍为 `BOUND` 且未结束，即使代理已停用也继续返回 `agent_id`、`display_name`、`bound_at`，且不暴露代理内部状态；停用只阻止新候选、新绑定和未来订单归因，只有绑定结束或不存在时返回 null。不得复用包含 customer ID、binding ID 或 version 的内部绑定响应。

### 4.3 商品、收藏和购物车

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `GET` | `/store/home` | 公开 | Banner、分类、热销、新品聚合及四个分区状态 |
| `GET` | `/store/categories` | 公开 | 全部 ACTIVE 一级分类，无分页，`sort_order,id` |
| `GET` | `/store/brands` | 公开 | 全部 ACTIVE 品牌，无分页，`sort_order,id` |
| `GET` | `/store/products` | 公开 | 商品名关键词、品牌、分类、五种排序和分页 |
| `GET` | `/store/products/{product_id}` | 公开 | 商品详情及全部 ACTIVE SKU，包括零库存 |
| `GET` | `/store/favorites` | CUSTOMER | 收藏列表 |
| `GET` | `/store/favorites/{product_id}` | CUSTOMER | 当前商品收藏状态 |
| `PUT` | `/store/favorites/{product_id}` | CUSTOMER | 幂等收藏 |
| `DELETE` | `/store/favorites/{product_id}` | CUSTOMER | 幂等取消收藏 |
| `GET` | `/store/cart` | CUSTOMER | 当前客户唯一服务端购物车及最新校验结果 |
| `PUT` | `/store/cart/items/{sku_id}` | CUSTOMER | 按 SKU 新增或设置数量 |
| `DELETE` | `/store/cart/items/{sku_id}` | CUSTOMER | 删除单个 SKU |
| `POST` | `/store/cart/merge` | CUSTOMER | 登录后把小程序本地项合入服务端购物车 |

取消收藏和删除购物车项均为无请求体的幂等 DELETE，不要求 `If-Match`；服务端按当前 CUSTOMER 和路径资源定位记录，不接受客户端提交客户、购物车或版本字段。数据库运行角色全局禁删，仅对账号删除事务需要的 `favorite`、`cart_item`、`customer_phone_verification` 与 `customer_address` 四张非交易 PII/偏好表开放窄 DELETE 权限；普通地址 CRUD 仍使用软删除，跨客户范围由服务层守卫和审计阻止。

购物车项只接受：

```json
{
  "quantity": 2,
  "selected": true
}
```

游客购物车只存在小程序本地，不创建服务端匿名 Cart 或 ownership token。登录合并请求为 `items[{sku_id,quantity,selected}]`，最多 100 行，每行 quantity 为 1..99，且同一 `sku_id` 不得重复；未知 SKU 阻断整个事务，已失效但仍存在的 SKU 可保存并返回当前状态。已有数量与传入数量相加后按 99 封顶，选择状态采用 `existing OR incoming`。同一固定幂等键重试不重复累加；客户端只有在服务端确认后才删除对应本地条目。

收藏列表固定按 `created_at DESC,id DESC`，可选搜索只匹配 trim 后 1..200 字符的商品名且大小写不敏感。`FavoriteProductView.availability` 闭合为 `SALEABLE|OUT_OF_STOCK|UNAVAILABLE`；商品失效后收藏仍可见，但图片和价格可以为 null，且 `is_salable=false`。PUT 只接受当前公开商品，重复收藏成功且不新增记录；DELETE 对记录不存在或商品已失效仍成功。单商品状态 GET 返回 `FavoriteStateResponse`，路径 Product ID 使用 ULID。

空购物车 GET 不创建数据库事实，固定返回 `cart_id=null,items=[]`；首次 PUT 或 merge 才懒创建当前客户唯一 Cart。列表按 `created_at ASC,id ASC`，每项状态闭合为 `SALEABLE|INSUFFICIENT_STOCK|OUT_OF_STOCK|INACTIVE|DELETED`，数量为 1..99，最多 100 个不同 SKU；合计只包含 `selected=true` 且 `SALEABLE` 的项目。响应只返回实时价格/库存投影，不返回无数据库来源的 Cart version 或 `change_flags`。

B8 的收藏、购物车和地址共 8 个写 operation 均使用 `Idempotency-Key` 与 `HASH_ONLY`，不缓存响应正文。相同键重放必须重新鉴权并返回当前投影；无法安全重放时返回 409 要求刷新。所有收藏、购物车和地址成功/错误响应均强制 `Cache-Control: no-store, private` 与 `Pragma: no-cache`。

商品 `PRICE_ASC/PRICE_DESC` 使用当前公开 ACTIVE SKU 的最低 `retail_price` 作为 SPU 排序价，同价以 `product_id ASC` 打破平局；没有 ACTIVE SKU 的商品不进入公开列表，但 ACTIVE SKU 全部零库存不会隐藏商品。HOT 使用全生命周期净销量，即支付成功 SKU 数量减成功退款数量；NEWEST 使用首次 `published_at DESC NULLS LAST,product_id ASC`。默认 COMPREHENSIVE 固定为 `is_hot DESC,is_new DESC,sales_count DESC,published_at DESC NULLS LAST,product_id ASC`。`product.sales_count` 只是可由支付/退款事实重建的缓存，支付和退款结转事务更新投影，每日对账发现差异后重建，不作为不可变交易事实。

公开目录使用 `StoreCategoryView`、`StoreBrandView`、`StoreProductListItem`、`StoreProductDetailView` 与 `StoreSkuView`；收藏使用允许商品失效的独立 `FavoriteProductView`，不得复用只能表示公开 ACTIVE 商品的目录 DTO。公开目录只返回 ACTIVE 分类/品牌、ACTIVE 且至少有一个 ACTIVE SKU 的商品、以及全部 ACTIVE SKU。`StoreSkuView.is_salable` 与商品摘要 `is_salable` 均为布尔值；可售条件为当前 `available_stock > 0`，零库存仍返回且标记 false。图片必须 READY/PUBLIC 且 purpose 正确，响应只给公开 URL；不得返回 `file_id`、管理 `status`、`version`、DRAFT/INACTIVE/ARCHIVED 记录、实物/锁定库存或其他后台字段。后台管理端继续使用独立管理 DTO。

`/store/home` 四区上限固定为 Banner 10、分类 8、热销 4、新品 4，并分别返回 `READY|UNAVAILABLE`。单区失败时对应数组为空且整体 200，四区全失败才返回 500。Banner PRODUCT target 必须仍能解析为公开商品，否则只从公开投影排除，不回写 Banner。公开品牌/分类无分页，返回全部 ACTIVE 记录并按 `sort_order ASC,id ASC`。

5 个匿名 Store GET 共享 Redis 60 秒固定窗口，每个 HMAC 来源 IP 最多 120 次。服务端不保存原始 IP；超限通过 Store 专用 `StoreRateLimited` 响应返回 429 和准确整数秒 `Retry-After`，Redis 异常时 fail closed，不得绕过限流。通用 `RateLimited` 继续承载登录/MFA 等既有窗口，不被 60 秒上限收窄。

B6.1 已按上述契约开放这 5 个 GET。独立 `StoreCatalogRepository` 使用 Repeatable Read 和参数化 SQL 完成公开过滤、最低 ACTIVE SKU 价格、五种稳定排序与分页，再按 ID 集合批量装配 Brand、Category、图片、SKU 与库存，不产生 N+1；Nest service 只映射 Store 专用响应，不返回管理状态、version、file ID 或 physical/locked 库存。repository unit 为 `9 passed`，database 全包为 `332 passed / 52 环境模式跳过`，隔离 PostgreSQL full 与受控 Supabase development rollback-only 均为 `1 passed / 1 mode skip` 且事务外 fixture 为 0；API 全包为 `426 passed / 26 环境模式跳过`。

来源 IP 只取 Express 在当前连接信任边界下解析的 `request.ip`。`API_TRUSTED_PROXY_CIDRS` 默认空，对应 `trust proxy=false`，因此任意客户端自填 `X-Forwarded-For` 不会改变限流来源；只有直接可信反向代理的数字 IP/CIDR 才能显式登记。配置拒绝 hostname、全网段、带 host bits 或语义重复项，IPv4-mapped IPv6 在配置和请求来源处都归一化为等价 IPv4，再计算 HMAC 限流 key。

上述 B6.1 公开 API 已由 B6.2/B6.3 工程页面使用。B6.3 的 MP-06 按 `product_id` 去重顺序调用现有公开详情接口以刷新价格、库存和状态；404/缺 SKU 才判失效，429 或网络失败保留本地项且不误判。购物车使用版本化本地存储，结算只提示登录，不调用服务端 Cart/订单，因此没有新增或修改 API operation。B6.4 已在最终 SHA 上完成真实纵向、普通 CI 与 Supabase rollback-only 同 SHA 双绿，B6 development `GO`。

### 4.4 地址、试算、订单与支付

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `GET` | `/store/addresses` | CUSTOMER | 本人地址列表，仅返回收件人、电话和门牌地址掩码 |
| `POST` | `/store/addresses` | CUSTOMER | 新增地址，成功仅向当前本人返回完整详情 |
| `GET/PATCH` | `/store/addresses/{address_id}` | CUSTOMER | 本人完整地址详情与修改；响应禁止缓存 |
| `DELETE` | `/store/addresses/{address_id}` | CUSTOMER | 软删除，仅返回无 PII 的 `CommandResponse` |
| `POST` | `/store/checkout/quotes` | CUSTOMER | 服务端计价和库存预检，不锁库存 |
| `POST` | `/store/orders` | CUSTOMER | 创建待付款订单并锁库存 30 分钟 |
| `GET` | `/store/orders` | CUSTOMER | 本人订单列表和状态筛选 |
| `GET` | `/store/orders/{order_id}` | CUSTOMER | 订单、支付、退款、履约和售后聚合详情 |
| `POST` | `/store/orders/{order_id}/cancel` | CUSTOMER | B9 仅取消未过期、无任何支付意图的待付款订单；B10 再扩展 Provider query/close |
| `POST` | `/store/orders/{order_id}/payment-intents` | CUSTOMER | 创建或复用唯一非终态意图，按稳定 intent_no 调用/对账 Provider |
| `POST` | `/store/orders/{order_id}/confirm-receipt` | CUSTOMER | 携带 `Idempotency-Key` 与订单 `If-Match`，确认本人已发货订单并以 `CUSTOMER_CONFIRMED` 完成 |
| `GET` | `/store/orders/{order_id}/logistics` | CUSTOMER | 本人唯一包裹与人工物流节点；个性化响应禁止缓存 |

收件人、省、市、区各为 trim 后 1..80 字符，详细地址为 1..300 字符，均不得为空或包含控制字符；手机号只接受 11 位 ASCII 数字。手机号和详细地址以 AES-256-GCM 加密，AAD 分别绑定地址 ID 与字段名；手机号 HMAC 复用 Store 手机密钥环，但使用独立域 `qingxu:store-address-phone:v1`。第一条地址自动设为默认；切换默认地址时原默认地址原子清除。存在其他地址时不得直接把当前默认改为非默认，返回 `DEFAULT_ADDRESS_REQUIRED` 422；删除默认地址后按 `created_at ASC,id ASC` 自动提升下一条。PATCH/DELETE 必须携带 `If-Match`，并发冲突返回 `RESOURCE_VERSION_CONFLICT` 409。

地址列表使用 `StoreAddressSummaryResponse/StoreAddressSummaryView`，只返回 `recipient_name_masked/phone_masked/detail_masked`；地址 GET 详情、POST 和 PATCH 使用 `StoreAddressDetailResponse/StoreAddressDetailView`，完整 `recipient_name/phone/detail` 仅在 bearer 所属 CUSTOMER 读取本人地址时返回，跨客户对象统一按 404 处理。四类地址读取/写入响应均返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`；DELETE 只返回 `CommandResponse`。完整收件人、电话和门牌地址不得进入访问日志、追踪、埋点、审计前后摘要或 `idempotency_record.response_body`；审计只记录地址 ID、版本、状态与默认标志。POST/PATCH 的幂等记录只保存结果资源 ID、版本和响应摘要哈希，重放时重新鉴权并实时生成响应，不持久化 PII 明文。

订单创建与取消返回摘要 `StoreOrderResponse`；列表使用 `StoreOrderListResponse`，每单含紧凑 SKU 项、`pay_expires_at`、服务端 `available_actions` 与售后摘要，并按 `display_group` 映射订单 Tab。详情 GET 与 CH-024 确认收货均返回端点专用 `StoreOrderDetailResponse`，必须一次包含服务端计算的订单/支付/退款/履约状态、支付截止与服务端时间、冻结收货地址、可执行动作、四条主状态轴合并时间线、唯一包裹与人工物流节点、关联售后、支付尝试、稳定退款及历次尝试、角色安全错误和资源版本。CH-026 解除旧 B9 的售后固定空数组限制：`APPLY_AFTERSALE` 只在 `PAID+NORMAL` 且订单为 `PENDING_SHIPMENT|SHIPPING`（完成前期限允许为 `null`），或订单为 `COMPLETED` 且数据库当前时间不晚于非空 `aftersale_expires_at` 时出现；`CLOSED` 永不出现，且必须至少一个订单项剩余可退数量和金额都大于 0。活动售后按订单项占用扣减额度，不全局屏蔽其他仍可退项。详情可返回本人普通退款和金额补偿的安全尝试投影；客户端不得自行推导资格。消费者只能读取本人订单；Provider 原文、内部堆栈、库存内部流水和佣金均不得出现在小程序响应。相关成功及 JSON 错误响应统一设置 `Cache-Control: no-store, private` 与 `Pragma: no-cache`。

报价请求只提交服务端可重新读取的标识和数量：

```json
{
  "source": "CART",
  "address_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "items": [
    { "sku_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW", "quantity": 1 },
    { "sku_id": "01ARZ3NDEKTSV4RRFFQ69G5FAX", "quantity": 1 }
  ]
}
```

`CheckoutQuoteRequest` 的 address/SKU 均为 ULID，items 为 1..100 行、quantity 为 1..99 且 SKU 不得重复。`BUY_NOW` 必须恰好一行；`CART` 必须与服务端当前 `selected=true` 的购物车项及数量精确一致。Quote 是只读 POST，不接受 `Idempotency-Key`，不写订单或预占。

Quote 使用 Repeatable Read 读取地址、购物车、商品层级、公开图片、SKU 和库存。已知但不可售的行仍以 200 返回，`can_submit=false`，blocker 只允许 `CART_SELECTION_CHANGED|ITEM_UNAVAILABLE|INSUFFICIENT_STOCK`，且 `quote_token/confirmation_hash/expires_at` 为 null；未知资源或非本人地址统一 404。可提交报价的运费在 B9 固定为 `0.00`。

可提交报价签发 5 分钟无状态 HMAC token。密钥从现有幂等哈希密钥环通过 `qingxu:store-checkout-quote:v1` 域隔离派生，凭证绑定 CUSTOMER、认证 session、quote ID、规范化 source/address/items、地址版本、商品/SKU/库存版本、价格和 expiry。响应同时返回对用户确认内容计算的 64 位小写 `confirmation_hash`；token/hash 不进入数据库、Redis、日志、审计或幂等响应缓存。

订单提交必须逐字回送相同 source/address/items，并增加报价能力：

```json
{
  "source": "CART",
  "address_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "items": [
    { "sku_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW", "quantity": 1 },
    { "sku_id": "01ARZ3NDEKTSV4RRFFQ69G5FAX", "quantity": 1 }
  ],
  "quote_id": "01ARZ3NDEKTSV4RRFFQ69G5FAY",
  "quote_token": "v1.current.opaque-signature",
  "confirmation_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

创建接口使用 `HASH_ONLY`。同主体、scope、key 和请求哈希的已完成事实必须先于 quote expiry/If-Match 检查返回同一订单当前投影；同键不同请求返回 409。首次执行在 Serializable 事务中重新锁定并验证报价全部事实，过期返回 `CHECKOUT_QUOTE_EXPIRED`，主体/会话/请求/token/hash 不匹配返回 `CHECKOUT_QUOTE_MISMATCH`，地址、购物车、商品、价格或库存版本变化返回 `CHECKOUT_REQUOTE_REQUIRED`，均不得留下半成品订单。

订单创建响应为 HTTP 201；摘要示例：

```json
{
  "order_id": "01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  "order_no": "QX01ARZ3NDEKTSV4RRFFQ69G5FAZ",
  "order_status": "PENDING_PAYMENT",
  "payment_status": "UNPAID",
  "refund_progress_status": "NONE",
  "refund_processing_status": "IDLE",
  "fulfillment_status": "NOT_STARTED",
  "close_reason": null,
  "completion_reason": null,
  "payment_resolution": "NORMAL",
  "display_status": "待付款",
  "pay_expires_at": "2026-08-11T03:30:00Z",
  "server_time": "2026-08-11T03:00:00Z",
  "amounts": {
    "goods": "197.00",
    "shipping": "0.00",
    "payable": "197.00",
    "paid": "0.00",
    "refunded": "0.00"
  },
  "items": [
    {
      "order_item_id": "01ARZ3NDEKTSV4RRFFQ69G5FB0",
      "product_id": "01ARZ3NDEKTSV4RRFFQ69G5FB1",
      "sku_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      "product_name": "氨基酸净澈洁面乳",
      "sku_name": "120g 单支",
      "unit_price": "69.00",
      "quantity": 1,
      "line_amount": "69.00"
    }
  ]
}
```

创建订单必须在一个事务中完成服务端重计价、订单/订单项快照、地址解密后按订单快照 AAD 重新加密、归因候选、库存预占、余额锁定、`ORDER_RESERVE` 流水、审计、Outbox 和幂等完成事实。订单号固定为 `QX` 加订单 ULID，数据库固定 `pay_expires_at=created_at+30 minutes`。CART 成功只删除本次提交的已选项，保留未选项；BUY_NOW 不修改购物车。该接口不创建支付意图、不调用 Provider、不冻结最终代理或佣金。

B9 冻结两条不可混用的加锁协议。首次下单没有既有 order 且不创建 payment intent，必须按 `idempotency -> account/customer -> CART/cart items（仅 CART）-> address -> binding/agent -> brand -> category -> product -> SKU ID ASC -> inventory_balance ID ASC -> insert order/reservation/snapshots -> ledger -> audit/outbox` 重验。主动取消/Worker 才按 `idempotency（Worker 跳过） -> order -> payment_intent -> SKU ID ASC -> inventory_balance ID ASC -> inventory_reservation ID ASC -> ledger -> audit/outbox` 加锁与重验。候选 reservation/SKU ID 可在加锁前无锁读取，但只用于定位；禁止混用两条路径或先锁 reservation 再回头锁 SKU/balance。Product/SKU lifecycle 与库存调整共享的库存尾部同样保持 SKU→balance→reservation。

创建、列表、详情与取消只返回当前 CUSTOMER 本人订单，跨客户统一 404。B9 可用动作最多只有 `CANCEL`；支付、包裹、售后和退款尝试投影为空。取消必须携带 `Idempotency-Key` 与 `If-Match`，无请求体；仅未过期、`PENDING_PAYMENT/UNPAID`、ACTIVE reservation 且不存在任何 payment_intent 的订单可写 `CLOSED/USER_CANCELLED + RELEASED` 并追加唯一 `ORDER_RELEASE` 流水。订单轴关闭时履约轴不变：主动取消或支付超时后 `fulfillment_status` 均必须保持 `NOT_STARTED`，不得写为 `CANCELLED`。已由本人取消的订单重复取消返回当前投影；过期、其他终态或存在支付意图返回 `ORDER_NOT_CANCELLABLE`。五个 B9 operation 全部复用 CUSTOMER+来源 IP 120/60 fail-closed 限流，并对成功与 JSON 错误强制 no-store/private、no-cache。

以下 payment-intent、Provider query/close、支付确认和迟到支付语义已由 CH-022 冻结。B10.1-B10.6 已完成实施与验收；最终 SHA `f5e59169b53a97704711c3aae3049e5b5d16a930` 的[普通 CI Run 33305811318](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33305811318)与[Supabase development rollback-only smoke Run 33306877575](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33306877575)同 SHA 且均成功，B10 development `GO`，CH-021 已自动失效：

首次或重试支付先在短事务中创建或复用该订单唯一活动意图，稳定商户号为 `intent_no`，初始状态 `CREATING`；提交后才调用 Provider `create(intent_no)`。B10 创建或复用 payment_intent 前必须先按全局顺序锁定 `sales_order`，并在同一短事务中重验 `order_status/payment_status/pay_expires_at/close_reason/version`；禁止先插入 payment_intent 再回头锁订单，订单已关闭或过期时必须拒绝创建。若网络不确定或进程在外部成功后、本地回写前崩溃，服务端用 `query(intent_no)` 恢复，不创建第二商户号。部分唯一索引禁止同一订单并存两笔 `CREATING/OPEN/CLOSE_PENDING` 意图；响应包含当前 `intent_status` 和闭合的 `PaymentProviderCapabilityView`，不返回 Provider 任意对象、佣金比例或归因结果。只要成功响应可能包含 `provider_payload`，就必须返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`；明确创建失败/用户取消分别落 `FAILED/CANCELLED`，超过 `pay_expires_at` 返回 `ORDER_PAYMENT_EXPIRED`。

B10.1 的 Mock 外部状态在 Redis 中保留 7 天，key 只使用支付域 HMAC 摘要，不保存原始客户、订单、意图或 IP 标识。新建 `CREATING` 意图初始 `next_reconcile_at` 固定为数据库当前时间后 60 秒；所有 Provider `create/query/close/refund` 调用均位于数据库事务外。既有 `CREATING` 意图一律先 `query(intent_no)`，只有 Provider 明确返回 `NOT_FOUND` 才允许以同一 `intent_no` 执行 `create`；禁止因重试直接再次创建。Provider 返回 `OPEN` 时，最终短事务必须原子更新 intent 为 `OPEN`、订单 `payment_status=PROCESSING` 并递增订单版本；明确 `FAILED/CANCELLED/CLOSED` 终态则恢复订单 `payment_status=UNPAID`。完整幂等重放先于 `If-Match`，新命令携带陈旧版本必须返回 409。超时、Redis 故障或 `UNKNOWN` 一律 fail closed，保留可对账事实且不得伪造成功/失败。`POST /store/mock-payments/{payment_intent_id}/result` 只在非 production 的 `development|test + STORE_PAYMENT_PROVIDER=MOCK` 时注册，其中 `test` 仅用于 B10.6 真实 HTTP 纵向闭环；验证后仅写 Callback Inbox 并返回 202，不得直接修改支付、订单、预占、库存、归因或佣金状态。production 或 `WECHAT` 配置始终不注册该路由。

用户主动取消与超时任务必须复用同一 `claim -> query/close -> finalize` 服务：第一段按全局锁序锁订单、全部订单项及活动意图，把 `CREATING/OPEN` claim 为 `CLOSE_PENDING`；事务外按稳定 `intent_no` query，必要时 close；只有 Provider 明确 `CLOSED/NOT_FOUND/EXPIRED/CANCELLED/FAILED`，第三段才重锁订单、全部订单项、意图和库存，写 `USER_CANCELLED` 或 `PAYMENT_TIMEOUT` 并释放预占。关闭失败或未知时保持 `CLOSE_PENDING`、写 `last_error_code/next_reconcile_at`；消费者取消返回安全的 `202` 当前投影并显示“取消处理中”，不得直接关单或释放库存。

ADM-10 reconcile 的整条命令按 payment intent 串行化，owner lock 覆盖锁内重读、事务外 Provider I/O 和最终提交。运行时 Provider 配置与存量 intent 不一致时返回 503，Provider intent locator 不一致时返回 `PAYMENT_RESULT_CONFLICT`；两者都必须在 query/close/refund、副作用回写和幂等完成事实之前 fail closed。若 intent 已是明确非成功终态，但历史订单未关闭或仍有 ACTIVE 预占，则仍以 `PAYMENT_INTENT/CLOSE_PENDING + ORDER_CLOSE_INCOMPLETE` 返回；reconcile 只执行本地 Serializable 关单补偿，不再次调用 Provider。锁超时或锁连接丢失不得返回 200，调用方以同一幂等键重试。

#### CH-024 履约状态机

CH-024 不增加或删除 operation，只冻结既有 Store/Admin 履约入口的可执行语义。订单支付结算后必须处于 `PENDING_SHIPMENT/READY_TO_SHIP`；总部发货命令以单一事务创建订单全生命周期唯一包裹，并原子推进为 `SHIPPING/SHIPPED`。后续人工 `STATUS` 物流事件只允许 `SHIPPED -> IN_TRANSIT -> DELIVERED` 单向推进，禁止跳级、倒退或在终态后追加改变状态的节点；非法状态返回 `SHIPMENT_STATE_CONFLICT`。承运商或运单纠错只追加 `TRACKING_CORRECTION` 事实，不改变履约状态，也不覆盖历史事件。

消费者确认收货与总部兜底完成都只允许当前订单本人可见或具有对应总部权限、`payment_status=PAID`、`payment_resolution=NORMAL` 且 `order_status=SHIPPING` 的已发货订单；唯一包裹可处于 `SHIPPED`、`IN_TRANSIT` 或 `DELIVERED`，但不得存在活动售后或未解决支付异常。完成事务先把包裹/履约轴封存为 `DELIVERED`，再由消费者写入 `COMPLETED/CUSTOMER_CONFIRMED`，或由总部写入 `COMPLETED/ADMIN_FORCED`；其他状态返回 `ORDER_NOT_RECEIVABLE`。该完成路径不是人工物流 STATUS 事件，不制造伪造的 IN_TRANSIT 节点；当前版本也不提供自动确认。完成事务必须锁定唯一当前 `PUBLISHED` `BusinessRuleVersion`，写入 `business_rule_version_id`，按其售后窗口计算 `aftersale_expires_at`，并把每个 `EXPECTED` 佣金 position 的当时 `expected_remaining` 精确一次结转为 AVAILABLE；`NONE` 或已减少部分不得制造零金额或重复流水。

确认收货、创建包裹、追加物流事件和总部兜底完成均要求 `Idempotency-Key` 与目标资源 `If-Match`，并采用 `HASH_ONLY`：数据库只保存请求哈希、资源 ID、状态码和响应摘要哈希，不保存订单、包裹、物流或地址响应正文。同键同请求重放在重新鉴权后返回当前投影；同键不同请求、陈旧版本或无法安全重放时返回 409。全部 path/body 中的订单、订单项和包裹标识使用 ULID。

本阶段只支持人工录入的唯一单包裹。多包裹、第三方物流 Provider、自动确认收货及普通售后业务实现均不属于 CH-024；预留的售后事实只用于发货前 fail-closed 检查，不因此开放售后流程。

### 4.5 支付回调与迟到支付

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/callbacks/wechat-pay` | Provider | 兼容保留的微信支付通知契约；未配置真实微信时不注册路由 |
| `POST` | `/callbacks/wechat-refund` | Provider | 后续普通退款契约；B10 development 不注册路由 |
| `POST` | `/store/mock-payments/{payment_intent_id}/result` | 开发/测试 | 只接受 `SUCCEEDED/FAILED/CANCELLED`，验证后写 Inbox 并返回 202 |

客户端不得提交 Provider、Provider 交易号、事件号或 `SUCCEEDED_LATE`。Provider 由 `STORE_PAYMENT_PROVIDER` 在服务端选择；Mock Provider 以服务端稳定生成的交易号/事件号判定迟到事实。全部支付个性化成功与 JSON 错误响应使用 `Cache-Control: no-store, private` 和 `Pragma: no-cache`；写操作为 `HASH_ONLY`，不得缓存 capability、Provider payload 或响应正文。

微信正式回调必须以原始字节 body 验签，读取 `Wechatpay-Timestamp`、`Wechatpay-Nonce`、`Wechatpay-Serial`、`Wechatpay-Signature`，校验平台证书有效性、时间窗口和 nonce/event 重放后，才将 raw body、签名头、解析 payload 与验签结果写入 Inbox。签名失败返回 401 且不处理领域事实；合法重复事件返回微信要求的成功 ACK。证书轮换、ACK 内容、超时重试、乱序/重复事件和 raw-body 中间件集成测试是正式微信上线门禁，设计期 Mock 接口不得存在于生产路由。

支付回调以 Provider 交易号和回调事件 ID 双重幂等。正常成功流程：

1. 保存并确认支付成功事实，事务外预读 `candidate_agent_id` 只能用于定位锁；
2. 事务内先锁候选 `agent_profile/version`，再锁订单、全部订单项、支付意图，并重读候选；代理停用也锁同一代理，先提交者裁决归因；
3. 依全局序锁库存预占和当前佣金规则集版本，将预占库存结转为实物扣减；
4. 在锁内复核候选代理 `ACTIVE`，逐订单项保存最终渠道、代理和佣金快照；失效则降级 DIRECT；
5. DIRECT 订单不创建代理佣金快照、position、流水或佣金 Outbox；最终归因为 AGENT 但佣金基数/有效比例/原佣金为 0 的订单项保留规则快照并把 position 置为 `NONE`，跳过佣金/钱包流水与佣金 Outbox；其余 AGENT 订单项置 `EXPECTED` 并写 `EXPECTED_CREATED`；
6. 订单进入待发货。

CH-023 不修改上述 API 或事务语义。它只新增 `0004_b10_commission_position_trigger_fix`，移除 `enforce_commission_position_snapshot()` 读取不可变快照时不必要的 `FOR SHARE` 并显式保持 `SECURITY INVOKER`；不修改 0001-0003，不授予 `mall_runtime` UPDATE/DELETE，不使用 SECURITY DEFINER。B10.2 只有在完整迁移链、真实 `mall_runtime` 正佣金/0%/DIRECT 路径以及准确 SHA 的 CI→development migration→rollback-only smoke 全部通过后才可退出。

超时任务按上述统一流程把活动意图置为 `CLOSE_PENDING` 并提交，再在事务外按 `intent_no` query/close。只有 Provider 明确 CLOSED/NOT_FOUND/EXPIRED/CANCELLED/FAILED 才在新事务关闭订单和释放库存；失败或未知保持 `CLOSE_PENDING` 并由对账任务重试，库存继续锁定。从未发起支付、无意图时也通过最终关单事务按全局锁序释放。终态非成功 intent 已落库但订单关单事实不完整时，只执行上述本地关单补偿，不再次查询或关闭 Provider。释放后收到支付成功时：

- 不复活订单、不重新占库存、不建立代理佣金；
- 支付尝试记录为 `SUCCEEDED_LATE`，支付意图收敛为 `SUCCEEDED`（兼容读取既有 `CLOSED/EXPIRED` 事实），订单保持 `CLOSED/PAYMENT_TIMEOUT`；
- `payment_resolution` 进入 `LATE_SUCCESS_REFUND_PENDING` 并自动创建全额原路退款，首条退款尝试固定从 `INITIATED` 开始；
- 自动退款成功后进入 `LATE_SUCCESS_REFUNDED`；失败进入 `MANUAL_REQUIRED` 并产生财务告警。

### 4.6 售后

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/store/aftersales` | CUSTOMER | 同一路径先 PREVIEW 服务端试算，再以新幂等键和短时凭证 CONFIRM 创建并占用可退额度 |
| `GET` | `/store/aftersales` | CUSTOMER | 本人售后列表 |
| `GET` | `/store/aftersales/{aftersale_id}` | CUSTOMER | 售后详情与时间线 |
| `POST` | `/store/aftersales/{aftersale_id}/cancel` | CUSTOMER | 在允许阶段取消并释放占用 |
| `POST` | `/store/aftersales/{aftersale_id}/return-shipment` | CUSTOMER | 填写退货承运商和运单号 |

售后 CONFIRM、取消和填写退货物流返回摘要 `StoreAftersaleResponse`；PREVIEW 返回 `can_submit`、闭合 blockers（`ORDER_NOT_ELIGIBLE | ITEM_UNAVAILABLE | AFTERSALE_QUOTA_EXCEEDED | EVIDENCE_UNAVAILABLE`）、逐项请求/剩余数量和金额、服务端分配金额、总额及可空短时凭证；详情 GET 返回端点专用 `StoreAftersaleDetailResponse`，包含订单摘要、逐项申请/占用/批准/退款数量、冻结退货地址、退货物流、验货结论、稳定退款尝试、可执行动作、时间线、安全错误和版本。本人售后列表固定 `created_at DESC,aftersale_id DESC`，每项返回闭合动作和退款进度/处理双轴。消费者仅可见本人售后事实，不返回总部内部操作者、库存成本或佣金影响。

五个接口统一使用 CUSTOMER 鉴权、CUSTOMER+规范化来源 IP 的用途隔离 HMAC Redis 固定窗口 `120/60` 限流，并在 Redis 不可用时 fail closed。PREVIEW、CONFIRM、取消和退货物流使用 `HASH_ONLY`；PREVIEW 与 CONFIRM 必须使用不同幂等键，取消与退货物流必须同时携带新 `Idempotency-Key` 和 `If-Match`。所有成功及 JSON 错误响应都返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`。

创建请求：

```json
{
  "action": "PREVIEW",
  "order_id": "01J00000000000000000000001",
  "type": "REFUND_ONLY",
  "reason_code": "UNSHIPPED_NO_LONGER_NEEDED",
  "reason_text": "改变购买计划",
  "items": [
    {
      "order_item_id": "01J00000000000000000000002",
      "quantity": 1
    }
  ],
  "evidence_file_ids": ["01J00000000000000000000003"]
}
```

消费者只提交 `quantity`，不得提交金额。`items` 为 1-100 个按 `order_item_id` 唯一的项目；申请和后续验货的 `evidence_file_ids` 均最多 9 个不重复 ULID，且必须属于当前主体可引用的 READY/PRIVATE/AFTERSALE_EVIDENCE 文件。PREVIEW 按订单项成交快照计算 `allocated_amount = HALF_UP(unit_price * quantity, 2)` 和剩余额度；阻断时仍返回 200，但 `preview_token/confirmation_hash/expires_at` 全为 `null`。可提交时使用现有幂等密钥环经 HKDF 域 `qingxu:store-aftersale-preview:v1` 派生密钥并签发 5 分钟无状态 HMAC，绑定客户、会话、规范业务字段、订单与行版本、占用/退款、证据及试算金额。CONFIRM 以相同业务字段附带该 token/hash 和新幂等键，在 Serializable 事务重验后才占用；过期、不匹配或事实漂移返回闭合 `AFTERSALE_PREVIEW_EXPIRED | AFTERSALE_PREVIEW_MISMATCH | AFTERSALE_REQUOTE_REQUIRED` 409 并要求重新 PREVIEW。超出额度返回 `AFTERSALE_QUOTA_EXCEEDED`。首期单包裹下，只要订单存在活动售后，整单禁止发货；驳回或允许阶段取消后释放占用，退款失败继续保留。与商品数量无关的善意赔付只能由总部创建独立 `manual_compensation`：不占数量、不回库但占可退金额，成功后增加 `refunded_amount` 并按原订单项佣金快照冲正佣金；失败时复用其稳定 `refund_id/refund_no` 进入统一 Admin retry，不得另建补偿。迟到支付退款不进入该 retry，继续只由 ADM-10 对账收敛。

## 5. 一级代理工作台接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/agent/auth/login` | 正常密码签完整 session；临时密码只签无 refresh 的改密受限 token |
| `POST` | `/agent/auth/refresh` | 轮换 refresh token |
| `POST` | `/agent/auth/logout` | 注销当前会话 |
| `POST` | `/agent/auth/change-temporary-password` | 首次或重置后强制改密 |
| `POST` | `/agent/auth/change-password` | 使用当前密码修改密码并撤销其他会话 |
| `POST` | `/agent/auth/logout-all` | 退出全部代理会话 |
| `GET` | `/agent/auth/current` | 当前代理账号、会话与权限摘要 |
| `GET` | `/agent/dashboard` | 本代理销售、客户、订单、预计佣金、余额与待办 |
| `GET` | `/agent/products` | 当前授权且已上架商品与各 SKU 当前预计比例 |
| `GET` | `/agent/products/{product_id}` | 授权商品详情和规则来源 |
| `POST` | `/agent/promotion-assets` | 为商城主页或当前授权商品生成推广素材 |
| `GET` | `/agent/customers` | 当前归属客户，手机号仅尾号或 `null` |
| `GET` | `/agent/customers/{customer_id}` | 当前归属期间详情；转出后不可访问 |
| `GET` | `/agent/orders` | 支付时最终冻结为本代理的 PAID 订单；可按当前归属客户及是否存在售后筛选 |
| `GET` | `/agent/orders/{order_id}` | 脱敏地址、支付时客户/佣金快照，只读 |
| `GET` | `/agent/commissions` | EXPECTED、CANCELLED、AVAILABLE、REFUND_DEBIT 明细 |
| `GET` | `/agent/commissions/{commission_snapshot_id}` | 原正向快照及相关减少/冲正流水 |
| `GET` | `/agent/wallet` | 有符号可用余额、非负冻结余额及负余额提示 |
| `GET/POST` | `/agent/bank-accounts` | 查询掩码银行卡、新增或更换完整卡号 |
| `POST` | `/agent/withdrawals` | 提交提现并冻结余额 |
| `GET` | `/agent/withdrawals` | 本人提现历史 |
| `GET` | `/agent/withdrawals/{withdrawal_id}` | 本人申请详情和付款凭证摘要 |

代理看板使用独立 `AgentDashboardResponse`，只返回当前代理本人的净销售、订单、归属客户、预计佣金、可用/冻结/负余额、待办和趋势；不得复用含全店销售、全店客户、活跃代理总数或商品全店排行的总部看板。客户列表使用 `AgentCustomerListResponse`，只含当前 `ACTIVE/BOUND` 客户的 alias、手机号尾号或 null、城市和本归属期消费摘要，不返回 `UNBOUND/ENDED`；客户详情使用 `AgentCustomerDetailResponse`，订单和最近商品只从当前归属期内且支付时冻结为本代理的订单聚合，转出后不可访问。`GET /agent/orders` 的 `customer_id` 也必须先验证当前归属，越权对象统一返回 404。

代理商品列表/详情使用独立 `AgentProductProjection`，逐 SKU 返回当前预计比例、命中来源、规则版本和单件预计佣金；订单列表使用 `AgentOrderListResponse`，只返回 `PAID` 且 `final_agent_id=当前代理` 的订单，逐单包含商品/SKU 摘要、客户 alias 与城市、售后摘要、创建/支付时间，禁止暴露客户电话和详细地址。`customer_id` 与 `has_aftersale` 等条件必须和 PAID/最终归因作用域一起在服务端查询层先过滤，再计算 `total` 和分页，禁止分页后剔除。列表和详情均返回服务端只读 `available_actions`，闭合为 `VIEW_DETAIL/VIEW_COMMISSION`，不得出现退款、发货、改状态或读取履约 PII 动作。订单详情使用脱敏 `AgentOrderResponse`，必须补齐 `close_reason`、`completion_reason`、`payment_resolution`、创建/支付时间、售后摘要和 `timeline`；时间线只含 PAYMENT/REFUND/FULFILLMENT/AFTERSALE 轴的闭合事件码、状态变化和时间，不含总部备注、原因正文、操作者或客户联系方式。佣金列表逐行返回 `AgentCommissionLedgerItem`，使 `REFUND_DEBIT` 与原正向流水并列并关联稳定 `refund_id`。佣金详情使用 `AgentCommissionDetailResponse`：逐 SKU 返回商品、分类、支付时规则版本、规则来源、命中路径、比例、基数、原佣金、剩余预计、累计冲正、`HALF_UP/2` 舍入事实和带 `refund_id` 的流水。这些投影都不复用消费者商品或总部订单 DTO。代理商品接口返回当前预计佣金，订单佣金接口只读支付时快照。代理请求中即使包含其他 `agent_id` 也必须忽略或拒绝。

临时密码登录响应为互斥联合：正常账户返回 access/refresh session；`must_change_password=true` 时只返回 `{access_token,next_action:"CHANGE_PASSWORD",allowed_actions:["CHANGE_TEMPORARY_PASSWORD","LOGOUT"],expires_at}`，不返回 refresh token，服务端只允许两个列出的动作。改密成功事务撤销该受限 session、清除 `must_change_password` 并签发新的正常 access/refresh；受限 token 调业务接口或普通 refresh 均返回 `PASSWORD_CHANGE_REQUIRED`。

所有签发 access/refresh、临时改密受限 token、管理员 pre-auth/reauth grant 的成功响应，以及新建代理的临时密码与初始邀请码、重置密码临时值，都必须返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`；一次性值不写入幂等响应体、日志、审计前后值或追踪系统。

B13.1 已实现上表 7 个认证接口。`/agent/**` 只接受独立 Agent realm：`aud=qingxu-agent-web`、`role=AGENT_ADMIN`、`assurance=PASSWORD`；临时密码会话固定 `CHANGE_PASSWORD_ONLY` 且无 refresh。密码变更、refresh 轮换/旧 token replay、当前会话/全部会话撤销、停用代理与登录限流/账号枚举均已回归。创建代理与重置密码仅在首次响应披露秘密；同幂等键重放只返回脱敏资源和重新签发指引，不持久化或再次披露明文。B13.1 最终 SHA `a565a3c406ad2f1af498f9f58b556315d30262d6` 同 SHA 三绿并已退出；B13.2 最终 SHA `8df89b98f8b243e36c3bf8bf86b95a8e9d418acd` 的普通 CI `33718349743`、development migration `33721734961` 与 rollback-only smoke `33722097476` 已按顺序同 SHA 三绿并退出；B13.3 最终 SHA `3707c67c7dc1b21de796f41ccf7b811556bbc47f` 的普通 CI `33731197140`、development migration `33734111086` 与 rollback-only smoke `33734431011` 已按顺序同 SHA 三绿并退出；B13.4 本地候选与复审已完成，正在等待同 SHA 三门禁，B13.4 未退出且 B13.5 未准入。

创建推广素材时保存目标与授权事实。商品被移出白名单后禁止创建新素材，并使既有商品素材失去新归因资格；商城主页素材仍按代理和邀请码状态判断。

## 6. 总部管理后台接口

### 6.1 账户、看板和设置

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/admin/auth/login` | 校验密码后仅返回 pre-auth + LOGIN challenge；MFA 通过前不签发 session |
| `POST` | `/admin/auth/refresh` | 轮换 refresh token |
| `POST` | `/admin/auth/logout` | 注销当前后台会话 |
| `POST` | `/admin/auth/logout-all` | 注销当前管理员全部会话 |
| `GET` | `/admin/auth/current` | 当前管理员、会话、RBAC 和 MFA 状态 |
| `POST` | `/admin/auth/change-password` | 使用当前密码修改并撤销其他会话 |
| `POST` | `/admin/auth/mfa/totp/enroll` | 创建 5 分钟 PENDING TOTP 因子和 enroll challenge |
| `POST` | `/admin/auth/mfa/totp/enroll/verify` | 验证首个 TOTP 后激活，恢复码仅本次返回 |
| `POST` | `/admin/auth/mfa/challenges` | 为 login/reauth 创建短时挑战 |
| `POST` | `/admin/auth/mfa/challenges/{challenge_id}/verify` | 使用 TOTP 验证挑战；LOGIN 成功才签发 access/refresh session |
| `POST` | `/admin/auth/mfa/recovery` | 消费单次恢复码完成 LOGIN challenge 并签发 session |
| `POST` | `/admin/auth/mfa/recovery-codes/rotate` | TOTP 验证后轮换全部恢复码 |
| `POST` | `/admin/auth/reauth` | 为 HR-13 提交本人 TOTP，签发绑定当前会话与提现单的 60 秒单次 grant |
| `POST` | `/admin/admin-accounts/{account_id}/security-reset-preview` | HR-15 预览已登录管理员密码/TOTP 重置及会话撤销 |
| `POST` | `/admin/admin-accounts/{account_id}/security-resets` | HR-15 使用当前 TOTP 或恢复码确认重置；全丢失不开放 HTTP 接口 |
| `GET` | `/admin/dashboard` | 经营指标与待办 |
| `GET` | `/admin/reports/daily-sales` | 日销售报表 |
| `GET` | `/admin/reports/monthly-sales` | 月销售报表 |
| `GET` | `/admin/reports/product-ranking` | 商品净销量排行 |
| `GET` | `/admin/reports/customer-ranking` | 客户净消费排行 |
| `GET` | `/admin/settings/business-rules` | 最低提现、售后申请天数，以及固定支付超时/外部合规保留期的只读快照 |
| `POST` | `/admin/settings/business-rules/preview` | 仅预览最低提现或售后申请天数变更及受影响流程 |
| `PATCH` | `/admin/settings/business-rules` | 仅确认发布最低提现或售后申请天数的新版本 |
| `GET` | `/admin/settings/return-address` | 当前总部退货地址版本，敏感字段掩码 |
| `POST` | `/admin/settings/return-address/preview` | HR-14 预览新地址生效边界，历史售后快照不变 |
| `PATCH` | `/admin/settings/return-address` | HR-14 确认发布新的退货地址版本 |
| `GET` | `/admin/audit-logs` | 关键业务和安全审计，支持 `target_type/target_id` 精确定位对象 |

后台密码登录只返回 `{pre_auth_token,mfa_required:true,assurance:"PASSWORD_ONLY",next_action,challenge_id,expires_at}`。已有 ACTIVE TOTP 时 `next_action=VERIFY_TOTP` 并带 LOGIN challenge；首次 bootstrap 或重置后无 ACTIVE TOTP 时 `next_action=ENROLL_TOTP`、`challenge_id=null`，该 pre-auth 只允许 ADM-16 enroll/verify。enroll verify 或 LOGIN verify/recovery 成功后才返回严格 `AdminAuthSessionData`：除 access/refresh、account/session 和过期时间外，固定 `role=SUPER_ADMIN`、`mfa_required=false`、`assurance=MFA`、`restriction=NONE`；普通 `AuthSessionData` 不得作为后台成功回退。后台 refresh、LOGIN TOTP verify、recovery 均使用专用后台响应，`/admin/auth/current` 使用固定上述保证的 `AdminAccountCurrentResponse`。pre-auth 不能访问其他后台资源；refresh 只通过请求体 refresh token 哈希认证、轮换与重放检测，不要求可能已过期的 access bearer。所有签发 pre-auth、access、refresh 或恢复码的响应均须 `no-store, private`。

MFA 固定采用 RFC 6238 TOTP。密钥信封加密，恢复码只存哈希且单次消费，已接受时间步不得重放；失败计数由 PostgreSQL `(account_id,purpose)` 守卫跨 challenge 累计，challenge 创建与验证均检查，连续失败 5 次锁 15 分钟，新建 challenge 不得绕过。HR-13 reauth 只接受当前管理员本人 TOTP，不要求当前密码或恢复码；grant 强外键绑定当前 `auth_session`、`PAYOUT_ACCOUNT_REVEAL` 和目标提现单，离页、logout、会话撤销、60 秒过期或成功消费后立即失效，不得作为普通登录令牌。

TOTP enroll 中的 `otpauth_uri`、enroll verify/恢复码轮换中的一次性 recovery codes 均必须返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`，且不进入服务端响应缓存、幂等响应体或观测链路。

业务规则写请求 `changes` 只允许 `minimum_withdrawal_amount` 与 `aftersale_window_days`。MVP 订单支付超时固定为 30 分钟，响应中的 `order_payment_timeout_minutes=30` 为只读常量；`legal_record_retention_years` 是外部合规审批配置的只读快照。普通管理员不得通过该接口修改两者，提交相应字段返回 `VALIDATION_ERROR`。

HR-15 预览只提交 `reason/reset_password/reset_totp`，不得提交 TOTP、恢复码或其他 credential；确认请求才在相同业务字段和预览确认字段之外携带 `credential_type=TOTP|RECOVERY_CODE` 与 `credential`，并原子验证/消费。凭据不进入 preview request hash、影响摘要、幂等响应体或日志。密码和 TOTP 均丢失时不开放 HTTP 接口：首个管理员 bootstrap CLI 仅创建密码主体，不预生成或预验证 TOTP；首次登录使用 enrollment-required pre-auth 现场绑定。双人审批恢复由受控 CLI 执行，至少两名不同且非目标的在职 SUPER_ADMIN 批准，执行记录凭据指纹、撤销目标全部会话并写审计。

总部看板使用 `AdminDashboardResponse`，明确返回全店 `today/month/total` 金额与订单、`customer_total_snapshot/new_registration_count/new_binding_count/active_agent_count`、待办和商品排行，并携带 `timezone/as_of`；它与代理 `AgentDashboardResponse` 互不复用。四类报表统一接受 `timezone`（首期仅 `Asia/Shanghai`）、`date_from/date_to` 和 `scope`；`scope=AGENT` 时 `agent_id` 必填，月报另接受 `month_from/month_to`，排行接受 `page/page_size`。四类响应不共用通配行：

```json
{
  "timezone": "Asia/Shanghai",
  "as_of": "2026-08-11T05:00:00Z",
  "data_freshness": "REBUILT",
  "rows": [
    {
      "business_date": "2026-08-11",
      "created_order_count": 18,
      "paid_order_count": 15,
      "paid_amount": "1280.00",
      "refunded_amount": "1600.00",
      "net_sales_amount": "-320.00",
      "paid_units": 22,
      "refunded_units": 28,
      "net_units": -6,
      "new_registration_count": 3,
      "new_binding_count": 2,
      "active_agent_count": 8,
      "customer_total_snapshot": 421
    }
  ]
}
```

`DailySalesRow` 使用 `business_date`，`MonthlySalesRow` 使用 `business_month`，两者包含 created/paid/refunded/net、注册/绑定/活跃代理/客户总量快照；`ProductRankingRow` 包含 product/SKU 标识、名称、paid/refunded/net units 与金额；`CustomerRankingRow` 包含不可用于反推手机号的客户标识/掩码、paid/refunded/net amount 与订单数。`GLOBAL` 的注册和客户总量只统计一次，不复制到代理范围；`DIRECT/AGENT` 的新增绑定按归属统计。created 按创建日、paid 按支付成功日、refunded 按退款成功日。`paid_*`、`refunded_*`、注册和绑定是可加指标；月报或任意区间的 `active_agent_count` 必须从区间事实按代理 ID 去重重算，`customer_total_snapshot` 取区间结束时最新快照，两者禁止对日报求和。`net_sales_amount = paid_amount - refunded_amount`、`net_units = paid_units - refunded_units`，所以退款集中日允许为负。排行按净值 DESC、资源 ID ASC 稳定排序；所有报表携带分页元数据或明确 `page_size` 上限。

### 6.2 商品、内容和库存

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET/POST` | `/admin/brands` | 品牌列表、新建品牌 |
| `GET/PATCH` | `/admin/brands/{brand_id}` | 详情与非生命周期资料修改 |
| `POST` | `/admin/brands/{brand_id}/lifecycle-preview` | HR-06 预览启用、停用或软删除及 ACTIVE 商品引用影响 |
| `POST` | `/admin/brands/{brand_id}/lifecycle-changes` | HR-06 确认启用、停用或软删除 |
| `POST` | `/admin/brands/{brand_id}/restore` | 原因 + If-Match 恢复原记录为 DRAFT |
| `GET/POST` | `/admin/categories` | 一级分类列表、新建分类 |
| `GET/PATCH` | `/admin/categories/{category_id}` | 详情与非生命周期资料修改 |
| `POST` | `/admin/categories/{category_id}/lifecycle-preview` | HR-06 预览启用、停用或软删除的商品引用影响 |
| `POST` | `/admin/categories/{category_id}/lifecycle-changes` | HR-06 确认启用、停用或软删除 |
| `POST` | `/admin/categories/{category_id}/restore` | 原因 + If-Match 恢复原记录为 DRAFT |
| `GET/POST` | `/admin/products` | 商品列表、新建商品 |
| `GET/PATCH` | `/admin/products/{product_id}` | 商品详情与非生命周期资料修改 |
| `POST` | `/admin/products/{product_id}/lifecycle-preview` | HR-06 预览启用、停用或软删除的图片、SKU、预占与历史影响 |
| `POST` | `/admin/products/{product_id}/lifecycle-changes` | HR-06 确认启用、停用或软删除 |
| `POST` | `/admin/products/{product_id}/restore` | 原因 + If-Match 恢复原 SPU 为 DRAFT，不创建重复业务键 |
| `POST` | `/admin/products/{product_id}/skus` | 201 新建 INACTIVE SKU 并原子建立零值库存余额 |
| `PATCH` | `/admin/skus/{sku_id}` | 修改非生命周期字段 |
| `POST` | `/admin/skus/{sku_id}/lifecycle-preview` | HR-06 预览启用、停用或软删除的预占/历史影响 |
| `POST` | `/admin/skus/{sku_id}/lifecycle-changes` | HR-06 确认启用、停用或软删除 |
| `POST` | `/admin/skus/{sku_id}/restore` | 原因 + If-Match 恢复原 SKU 为 INACTIVE，历史 code 永不复用 |
| `GET/POST` | `/admin/banners` | Banner 列表、新建 |
| `PATCH/DELETE` | `/admin/banners/{banner_id}` | 修改、启停、归档 |
| `POST` | `/admin/banners/{banner_id}/restore` | 恢复原 Banner |
| `GET` | `/admin/inventory` | 实物、锁定、可售和预占明细 |
| `POST` | `/admin/inventory/{sku_id}/adjustment-preview` | 预览库存调整和负库存风险 |
| `POST` | `/admin/inventory/{sku_id}/adjustments` | 填写原因后调整实物库存 |
| `GET` | `/admin/inventory/{sku_id}/ledger` | SKU 库存流水 |

品牌、分类、商品、SKU 和 Banner 使用软删除。品牌/分类继续使用闭合 `MasterDataLifecycleAction`；CH-010 删除旧共享 `LifecycleAction`，商品与 SKU 分别使用闭合 `ProductLifecycleAction`、`SkuLifecycleAction`。三个 DTO 都只接受 `action=ACTIVATE|DEACTIVATE|SOFT_DELETE + reason`。三类动作均经过影响预览/二次确认，确认携带新 `Idempotency-Key`、预览 token/确认哈希和 `If-Match`；原因最终写入 `audit_log.reason`。

CH-012 将 Banner 创建、资料更新和启停拆为闭合请求：创建显式固定 `initial_status=DRAFT`，资料更新不包含状态，启停只接受 `ACTIVATE|DEACTIVATE`。DELETE 是唯一软归档入口，ACTIVE 不得直接归档，restore 固定回 DRAFT；Banner 不属于 HR-01 至 HR-15，不新增 preview。POST 使用新幂等键；PATCH/DELETE/restore 使用新幂等键和 `If-Match`，DELETE/restore 继续要求 2-500 字符原因。写响应使用 `BANNER_RESOURCE_RESPONSE` 精确重放。

Banner 默认列表排除 ARCHIVED，仅显式 `status=ARCHIVED` 返回归档，固定 `sort_order ASC,id ASC`。公开投影只返回 ACTIVE、未归档，且满足 `(starts_at IS NULL OR starts_at <= now) AND (ends_at IS NULL OR now < ends_at)` 的记录；起止均非空时 `ends_at > starts_at`。启用、ACTIVE 资料更新和公开读取重查 `READY/PUBLIC/BANNER` 文件及 ACTIVE PRODUCT/CATEGORY target。URL 最长 500 字符，只允许 HTTPS 且 origin 命中服务端 allowlist；allowlist 为空时不开放 URL target。

库存列表固定 `available_qty=physical_qty-locked_qty`，`active_reservation_qty` 只用于复核 locked，不二次扣减；无 `low_stock`、预警值、售后占用或独立备注。列表补齐 SKU 名称和生命周期状态，按 `product_name ASC,sku_id ASC`；ARCHIVED SKU 只读。`InventoryAdjustmentAction.physical_delta` 为非零 int32，只改变 physical，原因 2-500 字符。

库存 preview 使用 `HASH_ONLY`，绑定 actor/session/`INVENTORY.ADJUST`/`INVENTORY`/sku/规范化 body/余额 version，TTL 60 秒；ARCHIVED SKU 返回 `STATE_CONFLICT` 409 且不签发 preview，调整后实物低于 locked 时仍返回 200 warning。confirm 需要一致业务字段、token/确认哈希、新幂等键和 `If-Match`；ARCHIVED SKU 返回 409，低于 locked 返回 `STOCK_INSUFFICIENT` 422，整数越界返回 `INVENTORY_QUANTITY_OUT_OF_RANGE` 422，失败不消费 preview。成功使用 `COMMAND_RESPONSE` 精确重放，固定 `resource_type=inventory`、`resource_id=sku_id`、`status=SUCCEEDED` 和新余额 version，并在同一事务写一条人工流水、审计、幂等和 outbox。流水类型使用闭合枚举并按 `occurred_at DESC,id DESC`。

B5.2 已实现上述 4 个库存 operation。专项覆盖 repository 19 项、API DTO/service/HTTP 79 项；一次性 PostgreSQL 18.3 full 为 repository 3 passed、API 6 passed，受控 Supabase development rollback-only 为两套各 1 passed 且事务外归零。B5.3 已接入工程前端并完成五视口 mock 验收；这些证据仍不替代 B5.4 最终准确 SHA 的真实纵向链路和 workflow 双绿。

品牌/分类创建的 `initial_status` 固定为 `DRAFT`。非删除状态只允许 `DRAFT/INACTIVE -> ACTIVATE -> ACTIVE`、`ACTIVE -> DEACTIVATE -> INACTIVE`、`DRAFT/INACTIVE -> SOFT_DELETE -> ARCHIVED + deleted_at`；ACTIVE 不得直接软删除，非法或同状态的新幂等请求返回 409。默认列表排除软删除记录，只有显式 `status=ARCHIVED` 才返回归档记录，详情允许读取归档。restore 只接受软删除 ARCHIVED，不走 preview，要求原因、幂等键和 `If-Match`，成功后清除 `deleted_at`、固定恢复为 DRAFT 并递增版本；若需启用必须重新 preview。

品牌 `BrandCreateRequest.sort_order` 为必填非负整数，`BrandUpdateRequest.sort_order` 为可选非负整数；分类保持同样的创建必填/更新可选约束。两类列表固定按 `sort_order ASC,id ASC`。名称/业务 code 在软删除后仍全局保留，只能恢复原记录，再次创建返回 `SOFT_DELETED_KEY_RESERVED` 409。存在 ACTIVE 商品时，DEACTIVATE/SOFT_DELETE preview 仍以 200 返回影响，confirm 返回 `ACTIVE_PRODUCT_DEPENDENCY` 422；历史引用不丢失。商品/SKU 存在活动预占时不得软删除，已产生订单或库存流水的 SKU 编码不可修改、不可复用。

商品写契约与存储字段一致：Product create 接收 `spu_code/name/brand_id/category_id/subtitle/introduction/ingredients/usage_method/is_hot/is_new/initial_status/images`，其中 `initial_status` 固定为 `DRAFT`；update 只接收可变资料与完整 `images`，不得修改 `spu_code`、状态或价格。SKU create 接收 `code/name/spec_json/retail_price/is_recommended/initial_status`，其中 `initial_status` 固定为 `INACTIVE`；update 不接收 code 或状态。`spec_json` 是闭合键值对象，唯一成交价为 `retail_price`，不存在 `member_price` 或代理价。SKU create 成功使用 201，并在同一事务创建 `physical_qty=0,locked_qty=0` 的 `inventory_balance`。

Product 状态只允许 `DRAFT/INACTIVE -> ACTIVATE -> ACTIVE`、`ACTIVE -> DEACTIVATE -> INACTIVE`、`DRAFT/INACTIVE -> SOFT_DELETE -> ARCHIVED`；restore 固定回 DRAFT。SKU 只允许 `INACTIVE -> ACTIVATE -> ACTIVE`、`ACTIVE -> DEACTIVATE -> INACTIVE`、`INACTIVE -> SOFT_DELETE -> ARCHIVED`；restore 固定回 INACTIVE。ACTIVE 不得直接软删除，父级状态变化不级联 SKU。SKU 可在非归档 DRAFT/INACTIVE/ACTIVE Product 下启用，但 Store 仅返回 Product 与 SKU 同时 ACTIVE 的记录。

Product 管理列表默认排除 ARCHIVED，只有显式 `status=ARCHIVED` 才返回软删除商品；按 ID 详情允许读取 ARCHIVED。Product 详情不因 SKU 归档而裁剪子项，始终返回全部 SKU，保证恢复和历史审计入口稳定。

Product ACTIVATE 必须重查 ACTIVE 品牌、ACTIVE 分类、至少一张 `READY/PUBLIC/PRODUCT_IMAGE` 和至少一个 ACTIVE SKU；缺图或缺活动 SKU 分别返回 `PRODUCT_PRIMARY_IMAGE_REQUIRED`、`PRODUCT_ACTIVE_SKU_REQUIRED` 422。首次 ACTIVATE 写 `published_at`，后续重新启用不得覆盖。Product 软删除有 ACTIVE SKU 时返回 `ACTIVE_SKU_DEPENDENCY` 422；Product 任一 SKU 或目标 SKU 有活动库存预占时返回 `ACTIVE_INVENTORY_RESERVATION` 422。preview 仍返回 200 影响信息，confirm 才阻断且失败时不得消费 preview。

`GET /admin/products` 使用 `AdminProductListResponse` 并固定 `published_at DESC NULLS LAST,id DESC`：每个 SPU 返回 SKU 数、活动 SKU 数、实物/锁定/可售库存合计和 SKU 同口径摘要；三个库存值必须来自同一快照，`available=physical-locked`。没有 ACTIVE SKU 时 `minimum_active_price` 返回 null。Product 详情返回最多 8 张、按 `sort_order ASC,id ASC` 排序的活动图集，以及包括 ARCHIVED 在内、按 `created_at ASC,id ASC` 排序的全部 SKU。

`images[{file_id,sort_order}]` 是最多 8 张的活动图集原子替换：服务端校验文件 `READY/PUBLIC/PRODUCT_IMAGE`、操作者归属、排序和文件不重复；被移除关系软删除。最小 sort_order 为主图。SPU/SKU code 创建后永不可改，软删除后仍全局保留，只能恢复原记录。品牌 `logo_file_id/description`、分类 `icon_file_id` 与 Banner 的 `file_id/target_type/target_id/target_url` 都有对应持久字段；Banner 仍属于后续批次，不进入 B4 Product/SKU 最小闭环。

### 6.3 订单、发货、售后和退款

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/orders` | 按订单号、状态、客户、代理、日期、金额筛选 |
| `GET` | `/admin/orders/{order_id}` | 动态返回选中订单全部快照和时间线 |
| `GET` | `/admin/orders/{order_id}/fulfillment-address` | 受控读取订单冻结完整履约地址；仅 SUPER_ADMIN + `ORDER_FULFILLMENT_PII_READ` |
| `POST` | `/admin/orders/{order_id}/shipments` | 携带 `Idempotency-Key` 与订单 `If-Match`，原子创建并置 SHIPPED，覆盖全部剩余可发数量的单一包裹 |
| `POST` | `/admin/shipments/{shipment_id}/events` | 携带 `Idempotency-Key` 与包裹 `If-Match`，追加物流状态节点或带原因的承运商/运单更正事实 |
| `POST` | `/admin/orders/{order_id}/complete` | 携带 `Idempotency-Key` 与订单 `If-Match`，以 ADMIN_FORCED 完成；写审计，不使用高风险预览 |
| `GET` | `/admin/aftersales` | 售后列表 |
| `GET` | `/admin/aftersales/{aftersale_id}` | 售后、占用、退款与佣金影响详情 |
| `POST` | `/admin/aftersales/{aftersale_id}/approve` | 同意售后；退货退款由服务端锁唯一当前 PUBLISHED 地址并冻结快照，客户端不可选版本 |
| `POST` | `/admin/aftersales/{aftersale_id}/reject-preview` | 预览拒绝及释放占用影响 |
| `POST` | `/admin/aftersales/{aftersale_id}/reject` | HR-08 确认初审拒绝，原因必填 |
| `POST` | `/admin/aftersales/{aftersale_id}/return-inspections` | 写实收、批准退款数量、PASS/ABNORMAL、逐项处置与 evidence_file_ids；异常进入 RETURN_EXCEPTION |
| `POST` | `/admin/aftersales/{aftersale_id}/return-resolution/continue-refund` | 携带 `If-Match` 与 `{resolution:"CONTINUE_REFUND",reason}`，按已冻结的逐项批准退款数量继续 |
| `POST` | `/admin/aftersales/{aftersale_id}/return-resolution/reject-preview` | HR-08 使用闭合 preview DTO，仅接受 `{resolution:"REJECT_AFTER_RETURN",reason}` |
| `POST` | `/admin/aftersales/{aftersale_id}/return-resolution/reject` | HR-08 使用闭合 confirm DTO，另必填 `preview_token/confirmation_hash`；沿用封存证据 |
| `POST` | `/admin/aftersales/{aftersale_id}/refund-preview` | 返回退款影响、资源版本、短时 `preview_token` 和 `confirmation_hash` |
| `POST` | `/admin/aftersales/{aftersale_id}/refunds` | 使用预览确认创建退款和首次退款尝试；商户退款号在退款生命周期内稳定 |
| `POST` | `/admin/refunds/{refund_id}/retry-preview` | 预览失败退款重试并签发新的短时确认 token |
| `POST` | `/admin/refunds/{refund_id}/retry` | `REFUND_FAILED` 重试；必须使用不同于历次尝试的新 `Idempotency-Key` |
| `GET` | `/admin/payment-intents/reconciliation-tasks` | 只读查询 `PAYMENT_INTENT | PAYMENT_SETTLEMENT | LATE_PAYMENT_REFUND` 三类安全待办；不返回 capability、Provider 原文、交易号、客户标识或 PII |
| `POST` | `/admin/payment-intents/{payment_intent_id}/reconcile` | 幂等触发 query/close/refund 或终态本地关单补偿；200 表示已收敛，202 表示仍待 Provider 确认，两类响应均不携带 capability 且不直接篡改状态 |
| `POST` | `/admin/orders/{order_id}/manual-compensations/preview` | HR-09 预览独立金额补偿的金额额度和佣金影响 |
| `POST` | `/admin/orders/{order_id}/manual-compensations` | HR-09 确认 AMOUNT_COMPENSATION；只占金额、不占数量、不回库 |

总部订单列表使用 `AdminOrderListItem`，只返回客户 alias、掩码联系电话和代理归因摘要；普通订单详情使用端点专用 `AdminOrderDetailResponse`，包含完整状态快照、可执行动作、四条主轴时间线、物流包裹、关联售后、支付/退款尝试、安全错误、库存与佣金影响，但冻结收件人、手机号和门牌地址仍只返回掩码。CH-024 要求 Admin 订单列表、详情、发货、物流事件和兜底完成的全部 2xx 响应显式返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`。完整履约地址只能调用 `/fulfillment-address`：必须具备 `SUPER_ADMIN` 与 `ORDER_FULFILLMENT_PII_READ`，订单处于仍需发货/运输纠错的允许状态，并提交 `X-Access-Purpose: ORDER_FULFILLMENT` 与必填 `X-Access-Reason`；成功、失败、拒绝每次均审计，2xx 响应同样要求上述必返禁止缓存头，禁止进入日志、截图和导出。

总部售后列表使用 `AdminAftersaleListItem`；详情使用端点专用 `AdminAftersaleDetailResponse`，返回订单与脱敏客户、占用、退货物流、验货、稳定退款尝试、可执行动作、时间线、安全错误以及库存/佣金影响。所有后台验货投影都必须返回只读 `inspected_by={account_id,display_name}`；消费者 `StoreAftersaleDetailResponse` 不得出现验货操作者。摘要写操作可继续返回 `AdminAftersaleResponse`，不得用摘要 DTO 冒充详情。

CH-026 下所有 Admin 售后/退款写操作使用 `HASH_ONLY`；已有售后或退款资源的 mutation 必须携带 `If-Match`。拒绝、验货后拒绝、创建退款、失败重试和金额补偿继续使用绑定 actor/session/action/target/request/version 的短时 preview-confirm；409 后客户端必须刷新并使用新 preview 与新幂等键。审核通过只推进状态并在退货退款场景冻结当前唯一 PUBLISHED 退货地址，不得在 approve 内直接调用 Provider。

每笔退款显式返回 `origin_type=AFTERSALE|LATE_PAYMENT|MANUAL_COMPENSATION`，且只绑定对应一种来源。商品退款请求逐售后项只携带 `aftersale_item_id + quantity`，金额由服务端按冻结分配计算，并使用 `preview_token`、`confirmation_hash`、`If-Match` 和幂等键。同一售后只有一条稳定 refund 生命周期：首次提交创建一条 `refund` 和第 1 条 `refund_attempt`；`PENDING/PROCESSING/FAILED` 时重复提交不得创建第二条退款，失败重试只追加新尝试，复用原 `refund_id`、稳定 `refund_no` 与订单项明细。未发货退款成功自动写 `REFUND_RESTOCK`；未发货全额退款关闭订单。已发货退货先写退货地址快照，再由总部一次提交精确覆盖本售后全部售后项的 `items`，每个 `order_item_id` 恰好一次，逐项包含 `received_qty/approved_refund_qty/restock_qty/damaged_qty/scrap_qty/return_to_customer_qty`。必须满足 `approved_refund_qty + return_to_customer_qty = received_qty` 且 `approved_refund_qty = restock_qty + damaged_qty + scrap_qty`。PASS 必须全量实收、全量批准退款且退回客户为 0；少件、0 件或其他不符必须 ABNORMAL。`evidence_file_ids` 由服务端按稳定规则排序、去重并形成 canonical 封存集合；验货结论、处理人、异常原因、验货时间、逐项处置和证据集合提交后不可追加、删除、换序、替换或改写。详情只返回封存后的 `evidence_file_ids`，不暴露内部 manifest/hash。异常解决只允许一次带 `If-Match` 的推进；资源版本变化返回 `RESOURCE_VERSION_CONFLICT`，客户端必须刷新详情，不得在旧验货结论上继续。继续退款请求必须固定 `resolution=CONTINUE_REFUND` 并提交非空 `reason`。验货后拒绝的 preview 使用 `RejectAfterReturnPreviewRequest`，只接受 `resolution=REJECT_AFTER_RETURN + reason`；confirm 使用 `RejectAfterReturnConfirmRequest`，在相同业务字段外仅接受必填 `preview_token/confirmation_hash`。两个 DTO 都闭合，preview 携带确认字段、confirm 缺确认字段，或任一请求携带 `evidence_file_ids/disposition/其他字段` 都必须校验失败；服务端沿用已封存证据。成功响应的验货投影返回同一 typed `resolution`、`resolution_reason` 与 `resolved_at`；异常继续退款只能使用验货时冻结的批准数量。未实收及退回客户数量在继续退款或验货后拒绝的终态事务释放占用。后续商品退款 quantity 不得超过该批准数量减已成功退款数量；发货后全额退款以 `COMPLETED/FULL_REFUND_AFTER_SHIPMENT` 收口。

同意退货退款的请求只允许可选 `note`，不得接收 `return_address_version_id`。事务内服务端锁唯一当前 PUBLISHED `return_address_version`，复制地址密文并保存 `source_version_id`；未配置返回 `RETURN_ADDRESS_NOT_CONFIGURED`，不能退回旧版/DRAFT。响应只返回地址掩码、来源版本号和快照 ID。

金额补偿预览/确认只接收以下业务字段，确认请求再附统一的 `preview_token` 与 `confirmation_hash`，不接收 `reauth_grant`：

```json
{
  "order_item_id": "oi_01J5...",
  "amount": "20.00",
  "reason": "服务体验补偿"
}
```

服务端校验 `amount <= line_paid_amount - refunded_amount - aftersale_reserved_amount` 并只增加金额占用；成功退款才增加订单项/订单成功退款金额，并依原订单项佣金快照追加预计佣金减少/取消或 `REFUND_DEBIT`。失败保留金额占用，复用稳定退款号重试。

分次退款的佣金冲正逐订单项计算：`candidate=HALF_UP(refund_amount*effective_rate/100,2)`；若该订单项累计成功退款金额达到 `commission_base`，尾笔 `reversal=original_commission-reversed_total`，否则 `reversal=min(candidate,original_commission-reversed_total)`。事务锁 commission position，原子更新 `reversed_total/expected_remaining` 并追加唯一幂等流水，累计永不超过原佣金且全退时清零尾差。

创建发货请求必须包含 `carrier_code`、`carrier_name`、`tracking_no` 和全部剩余可发 `items[{order_item_id,quantity}]`。服务端锁定整单及全部订单项；任一活动售后即返回 `ACTIVE_AFTERSALE_BLOCKS_SHIPMENT`，不得仅发其他行。items 缺失、重复、多出或 quantity 不等于每行 `quantity - pre_shipment_refunded_qty - shipped_qty` 时返回 `SHIPMENT_ITEMS_MISMATCH`，整个事务不落包裹。确认事务原子写入非空承运商/运单、`shipped_at`、items，把订单从 `PENDING_SHIPMENT/READY_TO_SHIP` 推进为 `SHIPPING/SHIPPED`，不存在持久化 CREATED 空壳。`shipment.order_id` 普通唯一保证一个订单整个生命周期最多一个包裹；确认弹窗取消不落记录，创建后不提供取消/替换，纠错只追加带原因的物流更正与审计。物流请求只提交描述、可选地点和发生时间，不接收 `event_key`；服务端从已鉴权的幂等事实派生稳定 `event_key`。`STATUS` 必须且只能携带 `status_code`，并按 `SHIPPED -> IN_TRANSIT -> DELIVERED` 单向推进；`TRACKING_CORRECTION` 必须携带完整新 `carrier_code/carrier_name/tracking_no` 与必填原因，两类 DTO 互斥。`(shipment_id,event_key)` 保证重放只产生一个事实。全部 B11 写操作使用 `If-Match`、ULID 与 `HASH_ONLY`；Store 成功和 JSON 错误、Admin 2xx 成功响应均显式要求 no-store/private、no-cache，Admin 错误响应不得携带 PII。

### 6.4 客户、代理和邀请码

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/customers` | 客户、账户手机号掩码、消费和当前归属 |
| `GET` | `/admin/customers/{customer_id}` | 客户资料、订单和绑定历史 |
| `POST` | `/admin/customers/{customer_id}/attribution-transfer-preview` | 预览转移/转直营的绑定、候选和订单影响 |
| `POST` | `/admin/customers/{customer_id}/attribution-transfers` | 使用预览确认完成转移或转直营 |
| `GET/POST` | `/admin/agents` | 代理列表；新建时一次返回临时密码与初始邀请码 |
| `GET/PATCH` | `/admin/agents/{agent_id}` | 代理详情（经营/钱包/提现摘要与邀请码状态）与资料修改 |
| `GET` | `/admin/agents/{agent_id}/commissions` | 只读分页查看不可变佣金快照及 `REFUND_DEBIT` 追加历史 |
| `GET` | `/admin/agents/{agent_id}/wallet-ledger` | 只读分页查看预计/可用/冻结余额逐笔流水 |
| `POST` | `/admin/agents/{agent_id}/status-change-preview` | HR-01 预览停用对会话、邀请码、候选和待付款订单影响 |
| `POST` | `/admin/agents/{agent_id}/status-changes` | HR-01 确认停用代理 |
| `POST` | `/admin/agents/{agent_id}/reactivate` | 重新启用代理；版本、幂等和审计必需，不使用高风险预览 |
| `POST` | `/admin/agents/{agent_id}/password-reset-preview` | 预览会话撤销与临时密码影响 |
| `POST` | `/admin/agents/{agent_id}/password-resets` | 重置为临时密码并失效会话 |
| `GET` | `/admin/agents/{agent_id}/product-authorization` | 全部在售或自定义白名单 |
| `PATCH` | `/admin/agents/{agent_id}/product-authorization` | 更新推广白名单；版本、幂等和审计必需，不改变已有绑定或计佣 |
| `POST` | `/admin/agents/{agent_id}/invite-code/rotate-preview` | 预览轮换造成的旧码/候选失效 |
| `POST` | `/admin/agents/{agent_id}/invite-code/rotate` | 轮换邀请码，旧码立即失效并一次返回新完整 code |
| `POST` | `/admin/agents/{agent_id}/invite-code/status-preview` | 预览启停或有效期变更影响 |
| `PATCH` | `/admin/agents/{agent_id}/invite-code` | 使用预览确认启停或设置有效期 |

总部客户列表使用 `AdminCustomerListResponse/AdminCustomerView`，除脱敏资料与当前归属外返回账户状态、最近商品/购买时间/订单和管理状态标记；不得与代理客户列表 DTO 共用。客户详情使用 `AdminCustomerDetailResponse`，包含订单摘要和按时间倒序的不可变 `binding_history`，历史绑定不得被当前归属覆盖。代理列表使用 `AdminAgentListResponse`，包含登录名、账号 alias、当前有效客户数、净销售、可用余额和创建时间；代理详情使用 `AdminAgentDetailResponse`，在基础资料外返回经营、钱包、提现摘要和 `InviteCodeView`，常规详情的邀请码只能显示掩码。新建代理的 `AgentCreateResponse` 一次返回初始邀请码；轮换使用专用 `InviteCodeRotateResponse`，返回新 code/status/expires/version 与旧码立即失效摘要。两个完整邀请码响应都必须 `no-store, private`，不得进入日志、审计前后值或幂等响应缓存。

管理员代理佣金历史每行同时携带支付时商品/SKU/分类/规则版本快照和追加流水，退款冲正通过 `ledger_type=REFUND_DEBIT + refund_id` 表达，禁止修改原快照。钱包历史逐笔返回 expected/available/frozen 变动及变动后余额，只读接口不得接受写入字段或通过请求中的代理 ID 扩大到路径代理之外。

启停代理必须返回受影响的有效绑定数、待确认候选数和待付款候选订单数供前端二次确认。停用使新登录、新绑定和支付时新归因失效，但不修改已支付佣金快照。

B13.1 已交付 `GET/POST /admin/agents`、`GET/PATCH /admin/agents/{agent_id}`、停用 status-change preview/confirm、reactivate 和 password-reset preview/confirm；B13.2 最终 SHA `8df89b98f8b243e36c3bf8bf86b95a8e9d418acd` 的普通 CI `33718349743`、development migration `33721734961` 与 rollback-only smoke `33722097476` 已按顺序同 SHA 三绿并退出；B13.3 最终 SHA `3707c67c7dc1b21de796f41ccf7b811556bbc47f` 的普通 CI `33731197140`、development migration `33734111086` 与 rollback-only smoke `33734431011` 已按顺序同 SHA 三绿并退出；B13.4 本地候选与复审已完成，正在等待同 SHA 三门禁，B13.4 未退出且 B13.5 未准入，本节佣金与钱包接口已完成本地候选，仍须等待同 SHA 三门禁。status/password preview 中的动态影响数量仅是预览时点估算，不纳入确认身份；confirm 仍绑定稳定的 actor/session/action/target/request/version，并在共享 Agent 锁内以当前事实重验。因此数量漂移要求管理员根据新投影重新判断，不得把旧数量当作停用或重置的授权事实。

### 6.5 佣金规则

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/commission-rules/current` | 当前平台默认、分类和 SKU 有效结果 |
| `GET` | `/admin/commission-rules/skus` | 查询全部 SKU，包括继承与 0% 状态 |
| `POST` | `/admin/commission-rule-versions/preview` | 预览受影响 SKU 和新有效比例，返回确认哈希和短时 token |
| `POST` | `/admin/commission-rule-versions` | 携带 `If-Match`、预览 token 和确认哈希保存不可变规则集版本 |
| `GET` | `/admin/commission-rule-versions` | 版本历史 |
| `GET` | `/admin/commission-rule-versions/{version_id}` | 版本差异和审计 |
| `GET` | `/admin/orders/{order_id}/commission-explanation` | 逐 SKU 解释支付时规则命中与退款冲正 |

保存请求：

```json
{
  "base_version_id": "crv_20260811_03",
  "reason": "两支装毛利调整",
  "preview_token": "pv_01J5...",
  "confirmation_hash": "8f71...64位十六进制...",
  "changes": [
    {
      "target_type": "SKU",
      "target_id": "sku_clean_120x2",
      "configured_rate": "12.0000"
    },
    {
      "target_type": "SKU",
      "target_id": "sku_travel_30",
      "configured_rate": null
    }
  ]
}
```

平台规则变更不携带 `target_id` 且比例不得为 `null`；分类/SKU 变更必须携带 `target_id`，其比例可为 `null`。`null` 是恢复继承，`"0.0000"` 是无佣金，两者都必须走原因、预览、确认、`If-Match`、幂等和版本审计。请求不得包含代理 ID。支付时整单只读取一个已发布规则集版本。

佣金解释响应使用 `OrderCommissionExplanationResponse.items[]`，每个订单项/SKU 都必须返回商品、分类、支付时规则版本、来源、命中路径、有效比例、佣金基数、原佣金、剩余预计、累计冲正、`HALF_UP` 两位舍入事实、当前 position，以及逐笔带稳定 `refund_id` 的减少/冲正流水；禁止只返回整单汇总或用当前规则覆盖历史快照。

### 6.6 提现与受控银行卡查看

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/withdrawals` | 提现列表，支持状态和 `agent_id` 筛选 |
| `GET` | `/admin/withdrawals/{withdrawal_id}` | 常规详情，仅返回银行卡掩码 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/approve-preview` | 预览通过时余额、银行卡和风险影响 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/approve` | 仅 `PENDING`，使用预览确认通过 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/reject-preview` | 预览拒绝和解冻影响 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/reject` | 仅 `PENDING`，使用预览确认且原因必填 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/payout-account-reveal` | 仅 `APPROVED`，消费短时授权并返回一次完整账号 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/proofs` | 上传付款凭证 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/mark-paid-preview` | 预览打款、凭证和冻结余额影响 |
| `POST` | `/admin/withdrawals/{withdrawal_id}/mark-paid` | 使用预览确认，凭证必填，幂等扣减冻结余额 |

受控查看请求：

```json
{
  "reauth_grant": "rag_01J5..."
}
```

返回的完整账号只能出现一次：

```json
{
  "account_holder": "安然",
  "bank_name": "招商银行",
  "account_number": "<one-time full account number>",
  "expires_at": "2026-08-11T03:01:00Z"
}
```

服务端在成功返回后立即消费 grant；响应必须包含 `Cache-Control: no-store, private`、`Pragma: no-cache`，前端只可在内存中保留至 60 秒、复制或离页中的最早时间，并恢复掩码。该接口不得把完整账号或整个响应写入 `idempotency_record.response_body`、日志、审计前后值或追踪系统；只记录状态码、响应摘要哈希和安全审计事件。`PENDING`、`REJECTED`、`PAID` 状态一律返回 `PAYOUT_ACCOUNT_REVEAL_NOT_ALLOWED`。

总部提现列表和常规详情使用 `AdminWithdrawalView`：明确返回申请代理、申请时可用/冻结余额前后快照，以及申请时冻结的持卡人/银行/卡号掩码与尾号；不得回读代理后来更换的银行卡。完整卡号仍只能由上述一次性 reveal 接口返回。

## 7. 文件接口

商品图、Banner、售后凭证和付款凭证统一使用受控文件实体：

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/files/upload-intents` | 获取对象存储上传参数和 `file_id` |
| `POST` | `/files/{file_id}/complete` | 校验类型、大小和哈希后确认上传 |
| `GET` | `/files/{file_id}/download-url` | 按角色和业务对象返回短时签名 URL；Agent 仅可读取本人推广素材绑定的 QR |

外部上传意图的 `purpose` 固定为 `PRODUCT_IMAGE/BRAND_LOGO/CATEGORY_ICON/BANNER/AFTERSALE_EVIDENCE/WITHDRAWAL_PROOF`。`PROMOTION_QR` 由服务端生成，不接受客户端 upload-intent/complete；生成推广素材时必须将 `READY/PRIVATE/PROMOTION_QR` 文件原子绑定，创建响应只返回 `file_id/status/visibility/purpose` 事实，不直接返回签名 URL。上传意图、完成确认和下载分别返回 `FileUploadIntentResponse`、`FileUploadCompleteResponse`、`FileDownloadUrlResponse`，不再使用同时带上传/下载字段的通用 DTO。任何包含签名 `upload_url`、签名 `download_url` 或短时请求头的成功响应都必须带 `Cache-Control: no-store, private` 与 `Pragma: no-cache`。挂接业务实体时必须复核文件 READY、purpose 与当前创建人/资源归属；只有前四类公开素材可转 PUBLIC，售后、提现与推广 QR 始终 PRIVATE 并通过短时签名 URL 使用。文件接口不得接受任意本地路径或由客户端指定存储桶权限。

CH-006 文件契约统一如下：

- `UploadIntentRequest` 必须提交 64 位小写十六进制 `sha256`；六类外部 purpose 只接受 `image/jpeg`、`image/png`，`size` 最大 5 MiB。上传签名 15 分钟过期。
- `UploadCompleteRequest.sha256/size` 必须同时匹配 intent 与服务端从对象存储读取后的 MIME、文件魔数、大小和 SHA-256；任一不一致返回 `FILE_CONTENT_MISMATCH` 422，不把 PENDING 标为 READY。
- bucket 默认私有；对象 key 只使用不含原文件名的 `staging/`、`public/`、`private/` 分区。仅 `public/*` 允许匿名 GET，私有素材只能通过 5 分钟签名下载 URL 访问。
- PENDING/staging 满 24 小时才进入清理候选，Worker 删除前再次确认无 READY 记录和业务引用。数据库不新增 `completed_at` 或 `updated_at`；完成事实由 READY、最终对象 key、服务端实测 MIME/size/SHA-256、审计和闭合幂等响应联合表达，首次 `completed_at` 只保存在该响应及其幂等记录中。
- 上传意图和 lifecycle preview 使用 `HASH_ONLY`，不得存签名 URL、签名请求头或 preview token。`GET /files/{file_id}/download-url` 不接受 `Idempotency-Key`、不创建幂等记录；其签名 URL 依靠鉴权、5 分钟 TTL、`Cache-Control: no-store, private`、`Pragma: no-cache` 以及禁止持久化/日志记录进行保护。Agent realm 是本 GET 的唯一非 `/agent` 例外，只允许读取当前 Agent 本人 `promotion_asset.qr_file_id` 绑定的 `READY/PRIVATE/PROMOTION_QR`。文件 complete 在 B3.1 实现闭合策略 `FILE_UPLOAD_COMPLETE`：同键同请求精确重放，新键重复完成返回 409。

## 8. 幂等、事务与异步事件

| 场景 | 一致性边界 |
|---|---|
| B9 报价/创建订单 | Quote 为不写库的 Repeatable Read；创建在 Serializable 中重验签名报价，订单、订单项、地址/归因快照、库存预占/余额/流水、审计、Outbox 与 HASH_ONLY 幂等同事务；不创建支付意图、不调用 Provider |
| 创建/复用支付意图 | 短事务创建/复用唯一活动意图并提交；事务外按稳定 intent_no create/query；新事务回写，异常由对账恢复 |
| 正常支付 | 先锁候选代理/version，再锁订单/items/payment 并重读候选；支付事实、库存结转、最终归因、隐私投影与佣金快照同事务；仅非 DIRECT 且佣金大于 0 的项写预计流水/佣金 Outbox，0% 项 position=NONE |
| B9 主动取消/超时关闭 | 只处理不存在 payment_intent 的订单；候选 reservation/SKU 仅无锁定位，取消与 Worker 共用本地原子关闭服务并按 `idempotency（Worker 跳过）→order→payment_intent→SKU ASC→balance ASC→reservation ASC→release ledger→audit/outbox` 加锁重验，禁止 reservation 先于 SKU/balance；关单后 `fulfillment_status` 保持 `NOT_STARTED`；B10 创建意图必须先锁订单并重验，再扩展 Provider claim/query/close |
| 售后创建 | 只接收 quantity；售后、服务端金额分配、售后项和可退额度占用同事务 |
| 退款提交/重试 | 每个售后至多一条稳定退款主单；同一退款复用稳定商户退款号，每次新幂等键追加独立 `refund_attempt`，重复同键只返回同一尝试 |
| 退款成功 | order→items→refund/aftersale→inventory（需要时）→commission position→wallet；回调事实、额度结转、回库、聚合和唯一幂等冲正流水同事务 |
| 订单完成 | order→items→活动 refund/aftersale→commission position→wallet；只结转 expected_remaining，并冻结业务规则版本/售后截止、钱包流水和 Outbox 同事务 |
| 提现提交 | 余额版本校验、冻结流水、提现申请同事务 |
| 提现拒绝/支付 | 状态变更、解冻或扣冻结流水、审计、Outbox 同事务 |
| 人工金额补偿 | HR-09 预览确认、订单项金额占用、补偿事实和退款主单同事务；不占数量/不回库，成功后按实际金额冲正佣金 |
| Store 登录 | Provider 交换在事务外；事务内按 identity/account -> customer profile -> candidate -> consent -> session -> audit/idempotency 锁序创建或恢复 CUSTOMER，会话签发事实原子提交 |
| 资料/手机号 | idempotency -> account/customer profile -> active phone -> consent -> audit；If-Match 冲突不撤回旧手机号、不写新 consent |
| 候选确认 | idempotency -> account/customer profile -> candidate -> current binding -> agent/invite/promotion/product validity -> customer_agent_binding -> binding_change_log -> audit -> idempotency completion；customer profile 是确认/转移/订单归因共同串行根；本批无异步副作用，不产生 outbox |
| 同步注销 | idempotency/preview -> account/customer -> current session validation -> blocker facts -> binding/anonymization matrix -> audit/outbox/idempotency completion；确认重检，阻断 fail closed，任一步失败整体回滚；成功将全部 session 保留为 revoked tombstone 并清空 refresh hash |
| 收藏写入 | idempotency -> customer -> product/favorite -> audit -> idempotency completion；HASH_ONLY，重复 PUT/DELETE 不制造重复记录或失败 |
| 购物车写入/合并 | Serializable + 统一重试；idempotency -> customer -> cart -> 升序 SKU/cart item -> audit -> idempotency completion；合并全成全败，不产生 Outbox |
| 地址写入 | idempotency -> customer -> 按 `created_at,id` 稳定顺序的活动地址 -> audit -> idempotency completion；PATCH/DELETE 同时校验 If-Match，默认切换/提升与写入同事务 |

Provider 回调先写入回调收件箱，再由幂等处理器消费；领域事件使用事务 Outbox 发布。定时任务和消费者均必须可重入，失败进入重试队列并在超过阈值后生成后台待办。

### 8.1 高风险预览确认协议

只有 PRD `HR-01` 至 `HR-15` 标记“预览 + 二次确认”的动作采用本协议：停用代理；轮换/停用邀请码；重置代理密码；客户转移；佣金规则；品牌、分类、商品或 SKU 启用、停用、软删除；库存调整；售后初审/验货后拒绝；退款、金额补偿和重试；提现拒绝/通过/付款；业务规则/退货地址；管理员安全重置。品牌/分类/Product/SKU 恢复、商品白名单、售后同意、验货记录、订单兜底完成、代理重新启用和物流更正不冒充高风险动作。OpenAPI 为每对动作提供具体请求 DTO，不允许使用无字段通配对象绕过字段校验：

1. 预览接口对规范化请求体计算 `request_hash`，返回影响摘要、当前 `resource_version`、60 秒短时 `preview_token` 和 `confirmation_hash`；所有该类成功响应必须带 `Cache-Control: no-store, private` 与 `Pragma: no-cache`；
2. 确认接口必须提交完全一致的业务字段、`preview_token`、`confirmation_hash`、`If-Match` 与新的 `Idempotency-Key`；
3. 服务端校验 token 绑定的管理员、会话、动作、目标、请求哈希和版本，成功写入时单次消费；
4. token 过期/已消费、确认哈希不匹配或资源版本变化分别返回 `PREVIEW_EXPIRED`、`CONFIRMATION_MISMATCH`、`RESOURCE_VERSION_CONFLICT`，不得静默重新预览或继续写入；
5. 原因与额外凭证严格按矩阵：HR-09 不要求 TOTP，HR-11/12 不要求原因，HR-12 要求付款凭证，HR-13 不走业务影响预览且只接受本人 TOTP，HR-15 已登录重置接受当前 TOTP/恢复码、全丢失只走双人离线流程。
6. HR-07 库存 preview 发现 `physical_after < locked_qty` 时必须返回 200 影响警告，confirm 才返回 `STOCK_INSUFFICIENT` 422；失败事务不消费 preview，不写余额、流水、审计成功事实或幂等结果。

## 9. 安全与审计

- 密码仅保存强哈希，登录、验证码和二次验证均限流。
- 代理数据接口强制注入当前代理作用域；无权对象统一返回 404 或 403，不泄露存在性。
- 常规客户接口默认手机号掩码；代理永远只能获得尾号或 `null`，不得获得收货地址联系电话。
- 银行卡卡号使用字段级信封加密，密钥不进入数据库和日志。
- 审计至少记录主体、角色、对象、动作、原因、`before_version/after_version`、结果、结果码、请求 ID、`idempotency_key`、不可逆 `ip_hash` 和时间。`AuditLogView.before_summary/after_summary` 由数据库不可变 `before_json/after_json` 生成字段级脱敏摘要；密码、令牌、银行卡、手机号、地址等敏感字段只显示“发生变化”，不返回原值，列表和日志也不得成为履约 PII 绕行入口。
- 所有写操作均要求权限、状态/版本、幂等和审计；原因、影响预览、TOTP 或凭证只在 HR 矩阵对应行要求，不得用不适用字段阻断。完整银行卡查看只在 APPROVED 提现上以本人 TOTP 换取一次性 grant，响应禁止缓存或记录明文。
- access/refresh、受限改密 token、pre-auth、reauth grant、候选首次 token、`preview_token`、支付调用参数和签名上传/下载 URL 的成功响应统一返回 `Cache-Control: no-store, private` 与 `Pragma: no-cache`；这些值不得进入服务端响应缓存、日志、追踪或截图。
- `AUTH_TOKEN_AUDIENCE=qingxu-admin-web` 继续服务管理端，`STORE_AUTH_TOKEN_AUDIENCE=qingxu-store` 只服务消费者；守卫同时校验 role/assurance/audience。Provider 不属于 token claim；`STORE_IDENTITY_PROVIDER` 与 `STORE_PHONE_PROVIDER` 只负责选择 MOCK/WECHAT Adapter 和持久化来源。Mock 仅允许 development/test，production 缺真实微信凭据必须启动失败。
- 支付配置新增 `STORE_PAYMENT_PROVIDER=MOCK|WECHAT`、`PAYMENT_MOCK_SIGNING_KEY_BASE64` 与 `PAYMENT_PROVIDER_TIMEOUT_MS`。Mock 支付状态存入 Redis 时 key 只使用用途隔离 HMAC，不保存原始订单、客户或来源 IP；Redis 异常或 Provider 未配置必须 fail-closed。production 配置为 `MOCK` 时进程必须启动失败。
- 单一消费者微信应用使用 `STORE_WECHAT_APP_ID/STORE_WECHAT_APP_SECRET`；三份当前文档分别配置 `STORE_USER_AGREEMENT_VERSION/TITLE/URL`、`STORE_PRIVACY_POLICY_VERSION/TITLE/URL`、`STORE_PHONE_AUTHORIZATION_VERSION/TITLE/URL`，每个前缀对应三个独立环境变量，URL 必须为 HTTPS。客户端只能提交已获取版本，不能定义当前版本。
- 法律文本使用 `STORE_LEGAL_RATE_LIMIT_MAX=120`、`STORE_LEGAL_RATE_LIMIT_WINDOW_SECONDS=60`，登录使用 `STORE_LOGIN_RATE_LIMIT_MAX=10`、`STORE_LOGIN_RATE_LIMIT_WINDOW_SECONDS=900`。B8 个性化购物接口和 B9 五个订单接口共享 `STORE_CUSTOMER_RATE_LIMIT_MAX=120`、`STORE_CUSTOMER_RATE_LIMIT_WINDOW_SECONDS=60`，限流键只保存 CUSTOMER 与来源 IP 的用途隔离 HMAC 摘要，不保存原始标识；均使用 Redis 服务端时间且 fail closed。

## 10. 接口验收清单

- 同一商品不同 SKU 可同时存在购物车，订单项规格、价格、库存和快照正确。
- Quote token 篡改、过期、跨客户/会话、请求不匹配以及地址/购物车/商品/价格/库存漂移均阻断创建且零半成品；同键已完成创建即使 token 后续过期仍返回同一订单。
- 创建成功后订单保持待付款；CART 只删除本次提交的已选项，BUY_NOW 不修改购物车；重复创建使用同一幂等键返回同一订单。
- 下单、主动取消和超时释放分别与 Product/SKU lifecycle confirm、库存人工调整并发运行；所有执行均有界完成且 PostgreSQL `40P01` 为零，不出现反向锁序、重复预占/释放或库存不变式破坏。
- 创建订单不产生 Provider 调用；并发首次/重试支付最多生成一笔活动意图，外部成功本地未回写可按 intent_no 恢复。
- 超时与支付回调并发时只能产生“正常支付”或“关闭后自动退款”之一，不得负库存或重复佣金。
- 并发售后申请的已退款金额与有效占用总和不超过订单项可退上限。
- 客户与普通商品退款只提交数量，服务端分配金额；人工金额补偿只占金额、不改变数量或库存，成功后按实际金额和原快照冲正佣金。
- 未发货部分退款自动回库并只发剩余数量；全额退款不可再发货。
- 单包裹模式下任一活动售后阻断整单发货；退货地址、验货异常和逐项处置可追溯；发货后全退以 completion_reason 收口。
- 已绑定客户购买代理白名单外 SKU 仍按统一商品规则计佣。
- 佣金规则恢复继承、0% 和自定义比例都生成新版本；历史订单解释结果不变。
- 退款只追加佣金减少/冲正流水，不修改原支付佣金快照。
- 退款失败重试追加新 `refund_attempt`，使用新幂等键但复用稳定商户退款号；重复回调只结转一次。
- 商城公开目录不出现 file ID、管理状态/版本或草稿归档记录；后台商品列表的 SPU/SKU 实物、锁定、可售库存同一快照守恒。
- 代理客户列表只出现当前 `ACTIVE/BOUND` 客户；代理订单列表/详情只出现 `PAID` 且最终归因为当前代理的订单，不泄露客户电话或详细地址。
- 候选查询/拒绝、文件完成确认等非首次响应不能重新返回 candidate token 或无关签名能力；所有短时能力响应均可机器校验禁止缓存头。
- `pnpm contracts:check` 的 CH-014 历史实测为 172 paths、196 operations、196 unique operationId、312 schemas、691 schema refs、2,577 local refs 和 0 dangling refs。B6 售罄投影、五种排序、搜索边界、无分页品牌/分类、首页分区状态与 Store 专用 429/Retry-After 均已形成可机器校验契约；CH-012 Banner/库存和 Product/SKU 专用 DTO 的历史闭合结论继续有效。
- CH-016 专项实测为 173 paths、197 operations、197 unique operationId、320 schemas、699 schema refs、2,617 local refs 和 0 dangling refs，Redocly 0 warning。专项门禁已覆盖三份法律文本、登录固定双 consent、手机号第三 consent、Store/Admin audience 隔离、Provider 服务端选择、If-Match、候选目标解析、查询不消费与替换/迁移原子失效、服务代理三字段投影和同步注销。
- 最终 SHA `3f844bfb9866854ceedb975ad0dc4fd7cacfb04a` 的普通 CI Run `33055090596` 与 Supabase development rollback-only Run `33056078437` 同 SHA 双绿，B7 development 已标记 `GO`，CH-015 已自动失效。
- CH-018 专项实测为 173 paths、198 operations、198 unique operationId、323 schemas、701 schema refs、2,653 local refs 和 0 dangling refs，Redocly 0 warning。B8 收藏、购物车、游客合并、地址及小程序均已实现；最终 SHA `0fc5a8d3d1f07d3b5c9fcadf7ea4ca9560a0911a` 的普通 CI Run `33141704459` 与 Supabase rollback-only Run `33142971501` 同 SHA 成功，B8 development `GO`，CH-017 已失效。
- CH-020 实测保持 173 paths、198 operations 和 198 unique operationId，并固化为 325 schemas、703 schema refs、2,665 local refs、0 dangling refs，Redocly 0 warning。B9.0 门禁机器验证 Quote 无幂等键、Submit 报价绑定、CART/BUY_NOW 闭合形状、全部路径 ULID、创建 201、取消 If-Match/无 body、四个 409、五 operation 的 CUSTOMER no-store 与共享限流。
- B9.1-B9.5 已完成。B9.3 代码与聚焦测试覆盖本人订单读取、If-Match/HASH_ONLY 取消、超时 Worker、全 payment_intent 状态 fail-closed、取消/超时唯一释放与并发锁序；关闭时履约轴保持 `NOT_STARTED`。B9.4 已完成 MP-08/10/11；B9.5 已将 `db:test-b9-store-orders`、`e2e:b9`、`e2e:b9:vertical` 接入普通 CI，并将 B9 repository smoke 接入 Supabase rollback-only。数据库 full `4 files / 29 tests`、B9 UI `12 passed / 28 designed skips`、真实 browser → Nest → PostgreSQL/Redis/MinIO → Worker `1/1`、全仓 `1,787 passed / 120 designed skips` 和精确清理均通过，三项原 P1 已关闭，最终复审为 `P0=0/P1=0/P2=1`。最终 SHA `19f9ad57190b28d11922db805b39af95b2f7ba3b` 的普通 CI Run `33230769777` 与 Supabase development rollback-only smoke Run `33233087710` 同 SHA 且均为 `completed/success`，B9 development `GO`，CH-019 已自动失效；唯一 P2 TR-020 不阻断 development，staging、production 与真实支付仍为 `NO-GO`。
- CH-022 契约本地解析实测为 173 paths、198 operations、198 unique operationId、326 schemas、705 schema refs、2,678 local refs、0 dangling refs。CH-023 不改变任何在线契约或上述统计，0004 继续作为已部署的最小权限函数修复保留，B10.5/B10.6 未新增迁移。B10 最终 SHA `f5e59169b53a97704711c3aae3049e5b5d16a930` 的[普通 CI Run 33305811318](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33305811318)与[Supabase development rollback-only smoke Run 33306877575](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33306877575)同 SHA 且均成功，B10 development `GO`，CH-021 已自动失效；真实支付、staging 和 production 仍为 `NO-GO`。
- CH-024 专属检查、生成与 Redocly lint 已通过，统计保持 `173/198/198/326/705/2,695/0`。B11.1-B11.4 历史实现证据保持；B11.5 本地真实纵向、严格客户端、API 回归、全仓门禁和最终远端同 SHA 双绿已完成。API 全量为 **81 files passed / 13 skipped；1,095 passed / 44 skipped**。B11 development `GO`，CH-025 已自动失效。
- CH-026 契约解析实测为 173 paths、198 operations、198 unique operationId、326 schemas、706 schema refs、2,726 local refs、0 dangling refs，Redocly 0 warning。机器门禁覆盖 18 个售后/退款 operation、2 个金额补偿 operation、Store PREVIEW/CONFIRM 200/201、验货 PASS/ABNORMAL 判别联合、ULID、Store 限流/no-store、HASH_ONLY/If-Match、闭合原因/错误/证据/承运字段、Admin preview-confirm、来源闭合 retry，以及订单售后摘要和完整 `APPLY_AFTERSALE` 矩阵。B12.1-B12.6 本地实现与本地验收已完成，OpenAPI、统计和 generated contracts 契约形状未改变；完整 `RETURN_REFUND` 真实纵向、Callback、库存/佣金/订单收敛及精确清理通过。最终实现 SHA `8c3589afcf7bb0dd5a4b8711d418e4c61b1ad09c` 的普通 CI `33592754575` 与 Supabase rollback-only smoke `33594513127` 同 SHA 双绿，B12 development `GO`，CH-027 已自动失效；B12 orphan `P2=1` 继续阻断 staging/真实数据。
- B7.4 已实现注销后端：不合格 preview 返回 200、完整 blockers/impacts 及 null token/hash/expiry；合格预览才签发 5 分钟能力。confirm 后出现新阻断返回 422 且不消费能力、不产生部分去标识化；成功后在单事务清除登录主体/非交易 PII、结束绑定、使候选失效、匿名化代理隐私投影、写审计与 durable `PENDING account.anonymized` Outbox 事实，并将全部 session 留作 revoked tombstone。这里只证明事件事实已持久化，不宣称已投递或消费。全部旧 token 失效，HASH_ONLY 不重放完成响应；full 与受控 Supabase development rollback-only 门禁已通过，退出复审 `P0=0/P1=0`。
- Product/SKU 固定创建状态、完整状态矩阵、恢复目标、不级联、首次 `published_at`、nullable 最低活动价、8 图、归档 SKU、零库存余额、不可变 code、201 SKU create 和四个新 422 均有契约及集成测试。
- 非 `APPROVED` 提现无法请求完整银行卡号；短时授权不可跨提现单、跨会话或重复使用。
- 所有关键回调和写操作在重复请求下只产生一次业务结果。
- OpenAPI 中的所有文本目录 operation 必须被唯一 operationId 覆盖，路径只拼接一次 `/api/v1`；Store、Agent、Admin 各自只实现冻结的 auth/session 能力，不因共用公共内核扩大路径或角色。
