# 洗化产品私域商城 API 接口文档

## 文档控制

| 项目 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 对应产品基线 | MVP/PRD v2.3、CH-001 至 CH-004 |
| 接口阶段 | 设计冻结稿，不代表后端已实现 |
| 推荐后端 | Node.js + NestJS + Prisma + Supabase 托管 PostgreSQL |
| 更新时间 | 2026-08-11 |

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

| 终端 | 基础路径 | 身份范围 |
|---|---|---|
| 消费者小程序 | `/api/v1/store` | 游客或当前 `CUSTOMER` |
| 一级代理工作台 | `/api/v1/agent` | 当前 `AGENT_ADMIN` |
| 总部管理后台 | `/api/v1/admin` | 当前 `SUPER_ADMIN` |
| 第三方回调 | `/api/v1/callbacks` | Provider 签名校验，不使用用户会话 |

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
| `Authorization: Bearer <token>` | 登录接口之外 | 访问令牌 |
| `Idempotency-Key` | 订单、支付、售后、退款、提现、规则变更等写操作 | UUID，主体 + 路径范围内 24 小时唯一；退款每次新尝试必须使用未用于该退款单的新键 |
| `X-Request-Id` | 可选 | 客户端追踪 ID；缺失时由服务端生成 |
| `X-Anonymous-Id` | 游客购物车、推广候选 | 小程序安装级随机标识，不使用设备硬件标识 |
| `If-Match` | 配置及高风险写操作 | 必填，携带预览时的资源 ETag，例如 `"12"`；版本变化返回 `RESOURCE_VERSION_CONFLICT` |

### 2.4 数据格式

- 时间统一使用 UTC ISO 8601，例如 `2026-08-11T02:30:00Z`；报表按 `Asia/Shanghai` 计算自然日/月。
- ID 统一作为字符串返回，客户端不得假设为可安全运算的 JavaScript Number。
- 金额使用两位小数字符串，禁止使用浮点数。OpenAPI 分为 `PositiveMoney`（业务输入和必须为正的事实）、`NonNegativeMoney`（余额、累计金额和普通响应）与 `SignedMoney`（佣金/钱包账本变动）；不得用同一个可负 schema 接收退款、售后或提现金额。
- 佣金比例使用百分比字符串，例如 `"12.5000"` 表示 12.5%；`null` 表示继承，`"0.0000"` 表示明确无佣金。
- 分页默认 `page=1&page_size=20`，`page_size` 最大 100。
- 删除业务实体默认是软删除或归档；历史订单、账本、规则版本和审计记录不可物理删除。

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
| 409 | `RESOURCE_VERSION_CONFLICT`、`STATE_CONFLICT` | 乐观锁或状态冲突 |
| 422 | `STOCK_INSUFFICIENT`、`AFTERSALE_QUOTA_EXCEEDED` | 业务校验不通过 |
| 429 | `RATE_LIMITED`、`REAUTH_LOCKED` | 访问或验证次数受限 |
| 500 | `INTERNAL_ERROR` | 未预期错误，不暴露堆栈和敏感值 |

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
type RefundStatus = "NONE" | "REFUNDING" | "PARTIAL" | "FULL" | "FAILED";
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

订单详情接口必须同时返回六个字段，不允许客户端仅依据一个枚举自行推断退款或履约结果。

`display_status` 使用下表从上到下首个命中规则，服务端是唯一计算方：

| 优先级 | 条件 | `display_status` |
|---:|---|---|
| 1 | `payment_resolution=MANUAL_REQUIRED` | 支付异常处理中 |
| 2 | `payment_resolution=LATE_SUCCESS_REFUND_PENDING` 或 `refund_status=REFUNDING` | 退款处理中 |
| 3 | `payment_resolution=LATE_SUCCESS_REFUNDED` 或 `refund_status=FULL` | 退款完成 |
| 4 | `refund_status=FAILED` | 退款异常待处理 |
| 5 | `refund_status=PARTIAL` | 部分退款 |
| 6 | `order_status=CLOSED` | 已关闭 |
| 7 | `order_status=PENDING_PAYMENT` | 待付款 |
| 8 | `order_status=PENDING_SHIPMENT` 且 `fulfillment_status=READY_TO_SHIP` | 待发货 |
| 9 | `order_status=SHIPPING` 或 `fulfillment_status` 为 `SHIPPED/IN_TRANSIT` | 运输中 |
| 10 | `order_status=COMPLETED` 或 `fulfillment_status=DELIVERED` | 已完成 |

`close_reason` 始终出现在响应中；非关闭订单为 `null`，关闭订单必须返回非空原因。

### 3.2 售后状态

`PENDING_REVIEW`、`REJECTED`、`REFUNDING`、`WAITING_RETURN`、`WAITING_RECEIPT`、`REFUNDING_AFTER_RETURN`、`REFUND_FAILED`、`COMPLETED`、`CANCELLED`。

消费者仅可在 `PENDING_REVIEW`，或未提交退货物流的 `WAITING_RETURN` 取消。`REFUND_FAILED` 保留订单项可退额度占用，等待总部重试或财务人工处理。

### 3.3 佣金与提现状态

- 订单项佣金：`NONE`、`EXPECTED`、`CANCELLED`、`AVAILABLE`。
- 佣金/钱包流水：`EXPECTED_CREATED`、`EXPECTED_REDUCED`、`EXPECTED_CANCELLED`、`AVAILABLE_CREDIT`、`REFUND_DEBIT`、`WITHDRAWAL_FREEZE`、`WITHDRAWAL_RELEASE`、`WITHDRAWAL_PAID`。
- 提现：`PENDING`、`APPROVED`、`REJECTED`、`PAID`。

## 4. 消费者小程序接口

### 4.1 登录、授权与隐私

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/auth/wechat/login` | 游客 | 使用微信 code 登录；设计阶段可由 Mock Provider 替代 |
| `POST` | `/auth/refresh` | 已登录 | 刷新会话并轮换 refresh token |
| `POST` | `/auth/logout` | 已登录 | 注销当前会话 |
| `GET` | `/profile` | CUSTOMER | 当前消费者资料，账户手机号默认掩码 |
| `PATCH` | `/profile` | CUSTOMER | 更新昵称、头像等非敏感资料 |
| `POST` | `/profile/phone-authorizations` | CUSTOMER | 使用微信手机号凭证完成自愿授权；要求 `Idempotency-Key` |
| `DELETE` | `/profile/phone` | CUSTOMER | 撤回账户手机号使用授权；不修改历史订单快照 |
| `POST` | `/consents` | 游客/CUSTOMER | 保存用户协议、隐私政策或手机号授权协议版本 |
| `POST` | `/privacy/deletion-requests` | CUSTOMER | 申请账号删除和去标识化 |
| `GET` | `/privacy/deletion-requests/current` | CUSTOMER | 查询当前删除申请状态 |

手机号授权请求：

```json
{
  "provider": "WECHAT",
  "provider_credential": "mock-or-wechat-phone-code",
  "consent_version": "privacy-phone-v1"
}
```

响应只返回掩码与验证事实：

```json
{
  "phone_masked": "138****6821",
  "phone_tail": "6821",
  "source": "WECHAT",
  "verified_at": "2026-08-11T03:00:00Z"
}
```

收货地址中的联系电话不得写入账户手机号字段。未授权账户手机号时，代理端客户接口返回 `phone_tail: null`。

手机号授权在一个事务中撤回旧当前记录并写入新记录；相同幂等键与相同请求返回同一验证结果，同一客户数据库层最多一条 `revoked_at IS NULL` 的当前记录。订单提交只记录归因候选，不复制昵称、手机号尾号或城市；这些脱敏客户快照仅在支付成功并冻结最终归因时写入。

删除申请若存在非终态订单或售后，返回 `ACCOUNT_DELETION_BLOCKED` 和阻断对象摘要；受理后撤销全部会话、结束当前代理绑定并清除购物车、收藏、地址及可删除资料，历史交易和审计仅保留去标识化快照。

### 4.2 推广候选与服务代理

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/attribution/candidates` | 游客/CUSTOMER | 打开代理推广链接时校验并保存 30 分钟候选 |
| `GET` | `/attribution/candidate` | 游客/CUSTOMER | 查询当前有效候选和剩余秒数 |
| `POST` | `/attribution/candidate/confirm` | CUSTOMER | 明确确认并建立长期绑定 |
| `POST` | `/attribution/candidate/reject` | CUSTOMER | 拒绝并清空候选 |
| `GET` | `/service-agent` | CUSTOMER | 只读查看当前服务代理 |

候选创建请求：

```json
{
  "invite_code": "QY8K2P",
  "promotion_asset_id": "promo_01J5...",
  "target_type": "PRODUCT",
  "target_id": "prod_01J5..."
}
```

规则：

- 已登录且未绑定用户立即得到 `confirmation_required: true`，无需退出登录再进入流程。
- 自定义白名单商品被撤权后，旧商品推广素材返回 `attribution_eligible: false`，但可携带 `public_target_url` 正常打开公开商品页。
- 白名单不参与已绑定客户后续订单的佣金判断；支付接口不保存商品授权快照。
- 已绑定用户访问其他代理链接返回当前绑定且不创建新候选。
- 邀请码轮换或停用后，未确认候选在确认时必须再次校验并失效；已有绑定不受影响。

### 4.3 商品、收藏和购物车

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `GET` | `/home` | 公开 | Banner、分类、热销、新品聚合 |
| `GET` | `/categories` | 公开 | 已启用一级分类 |
| `GET` | `/brands` | 公开 | 已启用品牌 |
| `GET` | `/products` | 公开 | 关键词、品牌、分类、排序和分页 |
| `GET` | `/products/{product_id}` | 公开 | 商品详情及全部可售 SKU |
| `GET` | `/favorites` | CUSTOMER | 收藏列表 |
| `PUT` | `/favorites/{product_id}` | CUSTOMER | 幂等收藏 |
| `DELETE` | `/favorites/{product_id}` | CUSTOMER | 幂等取消收藏 |
| `GET` | `/cart` | 游客/CUSTOMER | 购物车及服务端最新校验结果 |
| `PUT` | `/cart/items/{sku_id}` | 游客/CUSTOMER | 按 SKU 新增或设置数量 |
| `DELETE` | `/cart/items/{sku_id}` | 游客/CUSTOMER | 删除单个 SKU |
| `POST` | `/cart/merge` | CUSTOMER | 登录后合并匿名购物车 |

购物车项只接受：

```json
{
  "quantity": 2
}
```

响应由服务端补全 `product_id`、`sku_id`、规格、当前零售价、可售库存、上下架状态和价格/库存变化提示。同一商品不同 SKU 是不同购物车项。

### 4.4 地址、试算、订单与支付

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `GET/POST` | `/addresses` | CUSTOMER | 地址列表、新增地址 |
| `GET/PATCH/DELETE` | `/addresses/{address_id}` | CUSTOMER | 地址详情、修改、软删除 |
| `POST` | `/checkout/quotes` | CUSTOMER | 服务端计价和库存预检，不锁库存 |
| `POST` | `/orders` | CUSTOMER | 创建待付款订单并锁库存 30 分钟 |
| `GET` | `/orders` | CUSTOMER | 本人订单列表和状态筛选 |
| `GET` | `/orders/{order_id}` | CUSTOMER | 订单、支付、退款、履约和售后聚合详情 |
| `POST` | `/orders/{order_id}/cancel` | CUSTOMER | 取消未支付订单并释放库存 |
| `POST` | `/orders/{order_id}/payment-intents` | CUSTOMER | 为未过期订单创建或复用唯一 OPEN 支付意图并调用 Provider |
| `POST` | `/orders/{order_id}/confirm-receipt` | CUSTOMER | 确认收货，幂等完成订单 |
| `GET` | `/orders/{order_id}/logistics` | CUSTOMER | 包裹与人工物流节点 |

新增、修改或删除默认地址必须在事务中锁定该客户当前地址，并先取消旧默认再设置新默认；PostgreSQL 条件唯一索引保证每位客户最多一个未删除默认地址，并发冲突返回 `RESOURCE_VERSION_CONFLICT` 后允许刷新重试。

订单创建请求：

```json
{
  "source": "CART",
  "address_id": "addr_01J5...",
  "items": [
    { "sku_id": "sku_clean_120", "quantity": 1 },
    { "sku_id": "sku_clean_120x2", "quantity": 1 }
  ]
}
```

订单创建响应：

```json
{
  "order_id": "ord_01J5...",
  "order_no": "20260811000126",
  "order_status": "PENDING_PAYMENT",
  "payment_status": "UNPAID",
  "refund_status": "NONE",
  "fulfillment_status": "NOT_STARTED",
  "close_reason": null,
  "display_status": "待付款",
  "pay_expires_at": "2026-08-11T03:30:00Z",
  "server_time": "2026-08-11T03:00:00Z",
  "amounts": {
    "goods": "197.00",
    "shipping": "0.00",
    "payable": "197.00"
  },
  "items": [
    {
      "order_item_id": "oi_01J5...",
      "product_id": "prod_clean",
      "sku_id": "sku_clean_120",
      "product_name": "氨基酸净澈洁面乳",
      "sku_name": "120g 单支",
      "unit_price": "69.00",
      "quantity": 1,
      "line_amount": "69.00"
    }
  ]
}
```

创建订单必须在一个事务中完成服务端计价、订单/订单项快照、归因候选和库存预占。该接口不创建支付意图、不调用 Provider；订单创建后即进入订单列表，用户关闭支付弹层不删除订单。

首次或重试支付时，服务端锁定订单并先查询该订单唯一 OPEN 意图：存在且仍有效则幂等复用，不存在则创建新的本地意图和稳定商户支付号，再以该商户号调用 Provider。数据库部分唯一索引保证同一订单不能并存两笔 OPEN 意图；`provider + provider_intent_id` 的非空组合唯一。响应包含 Provider 参数，但不返回佣金比例或归因结果。超过 `pay_expires_at` 后返回 `ORDER_PAYMENT_EXPIRED`。

### 4.5 支付回调与迟到支付

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/callbacks/wechat-pay` | Provider | 微信支付通知收件箱 |
| `POST` | `/callbacks/wechat-refund` | Provider | 微信退款通知收件箱 |
| `POST` | `/store/mock-payments/{payment_intent_id}/result` | 开发/测试 | Mock Provider 成功、失败、取消、迟到成功 |

支付回调以 Provider 交易号和回调事件 ID 双重幂等。正常成功流程：

1. 保存并确认支付成功事实；
2. 锁定订单、库存预占、当前佣金规则集版本和提交时代理候选；
3. 将预占库存结转为实物扣减；
4. 复核候选代理 `ACTIVE`，逐订单项保存最终渠道、代理和佣金快照；
5. 写入 `EXPECTED_CREATED` 和 Outbox 事件；
6. 订单进入待发货。

超时任务对存在的 OPEN 意图必须先关闭 Provider 支付意图；从未发起支付、无意图时跳过该步骤，再关闭订单并释放库存。释放后收到支付成功时：

- 不复活订单、不重新占库存、不建立代理佣金；
- 支付尝试记录为 `SUCCEEDED_LATE`，原支付意图保持 `CLOSED/EXPIRED`，订单保持 `CLOSED/PAYMENT_TIMEOUT`；
- `payment_resolution` 进入 `LATE_SUCCESS_REFUND_PENDING` 并自动创建全额原路退款；
- 自动退款成功后进入 `LATE_SUCCESS_REFUNDED`；失败进入 `MANUAL_REQUIRED` 并产生财务告警。

### 4.6 售后

| 方法 | 路径 | 身份 | 说明 |
|---|---|---|---|
| `POST` | `/aftersales` | CUSTOMER | 创建仅退款或退货退款，并占用可退额度 |
| `GET` | `/aftersales` | CUSTOMER | 本人售后列表 |
| `GET` | `/aftersales/{aftersale_id}` | CUSTOMER | 售后详情与时间线 |
| `POST` | `/aftersales/{aftersale_id}/cancel` | CUSTOMER | 在允许阶段取消并释放占用 |
| `POST` | `/aftersales/{aftersale_id}/return-shipment` | CUSTOMER | 填写退货承运商和运单号 |

创建请求：

```json
{
  "order_id": "ord_01J5...",
  "type": "REFUND_ONLY",
  "reason_code": "UNSHIPPED_NO_LONGER_NEEDED",
  "reason_text": "改变购买计划",
  "items": [
    {
      "order_item_id": "oi_01J5...",
      "quantity": 1,
      "requested_amount": "69.00"
    }
  ],
  "evidence_file_ids": []
}
```

创建时事务性计算：`剩余可退 = 原成交 - 已成功退款 - 其他有效售后占用`。超出时返回 `AFTERSALE_QUOTA_EXCEEDED`。有效占用数量不得进入新发货单；驳回或允许阶段取消后释放，退款失败继续保留。

## 5. 一级代理工作台接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/auth/login` | 账号密码登录；临时密码只签发改密会话 |
| `POST` | `/auth/change-temporary-password` | 首次或重置后强制改密 |
| `POST` | `/auth/logout-all` | 退出全部代理会话 |
| `GET` | `/dashboard` | 本代理销售、客户、订单、预计佣金、余额与待办 |
| `GET` | `/products` | 当前授权且已上架商品与各 SKU 当前预计比例 |
| `GET` | `/products/{product_id}` | 授权商品详情和规则来源 |
| `POST` | `/promotion-assets` | 为商城主页或当前授权商品生成推广素材 |
| `GET` | `/customers` | 当前归属客户，手机号仅尾号或 `null` |
| `GET` | `/customers/{customer_id}` | 当前归属期间详情；转出后不可访问 |
| `GET` | `/orders` | 支付时最终冻结为本代理的订单 |
| `GET` | `/orders/{order_id}` | 脱敏地址、支付时客户/佣金快照，只读 |
| `GET` | `/commissions` | EXPECTED、CANCELLED、AVAILABLE、REFUND_DEBIT 明细 |
| `GET` | `/commissions/{commission_snapshot_id}` | 原正向快照及相关减少/冲正流水 |
| `GET` | `/wallet` | 有符号可用余额、非负冻结余额及负余额提示 |
| `GET/POST` | `/bank-accounts` | 查询掩码银行卡、新增或更换完整卡号 |
| `POST` | `/withdrawals` | 提交提现并冻结余额 |
| `GET` | `/withdrawals` | 本人提现历史 |
| `GET` | `/withdrawals/{withdrawal_id}` | 本人申请详情和付款凭证摘要 |

代理商品接口返回的是当前预计佣金，订单佣金接口只读支付时快照。代理请求中即使包含其他 `agent_id` 也必须忽略或拒绝。

创建推广素材时保存目标与授权事实。商品被移出白名单后禁止创建新素材，并使既有商品素材失去新归因资格；商城主页素材仍按代理和邀请码状态判断。

## 6. 总部管理后台接口

### 6.1 账户、看板和设置

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/auth/login` | 超级管理员登录 |
| `POST` | `/auth/reauth` | 当前密码 + 一次性验证码，签发 60 秒敏感操作授权 |
| `GET` | `/dashboard` | 经营指标与待办 |
| `GET` | `/reports/daily-sales` | 日销售报表 |
| `GET` | `/reports/monthly-sales` | 月销售报表 |
| `GET` | `/reports/product-ranking` | 商品净销量排行 |
| `GET` | `/reports/customer-ranking` | 客户净消费排行 |
| `GET/PATCH` | `/settings/business-rules` | 最低提现、售后申请天数、法定记录保留配置 |
| `GET` | `/audit-logs` | 关键业务和安全审计 |

二次验证连续失败 5 次后锁定 15 分钟。短时授权必须绑定管理员、会话、操作类型和目标提现单，不得作为普通登录令牌使用。

### 6.2 商品、内容和库存

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET/POST` | `/brands` | 品牌列表、新建品牌 |
| `GET/PATCH/DELETE` | `/brands/{brand_id}` | 修改、归档品牌 |
| `GET/POST` | `/categories` | 一级分类列表、新建分类 |
| `GET/PATCH/DELETE` | `/categories/{category_id}` | 修改、启停、归档分类 |
| `GET/POST` | `/products` | 商品列表、新建商品 |
| `GET/PATCH/DELETE` | `/products/{product_id}` | 商品详情、修改、归档 |
| `POST` | `/products/{product_id}/skus` | 新建 SKU |
| `PATCH/DELETE` | `/skus/{sku_id}` | 修改或归档 SKU |
| `GET/POST` | `/banners` | Banner 列表、新建 |
| `PATCH/DELETE` | `/banners/{banner_id}` | 修改、启停、归档 |
| `GET` | `/inventory` | 实物、锁定、可售和预占明细 |
| `POST` | `/inventory/{sku_id}/adjustments` | 填写原因后调整实物库存 |
| `GET` | `/inventory/{sku_id}/ledger` | SKU 库存流水 |

品牌、分类、商品和 SKU 使用软删除。存在在售商品时分类不得停用或归档，返回 `CATEGORY_HAS_ACTIVE_PRODUCTS`；必须先迁移或下架商品。已产生订单或库存流水的 SKU 编码不可修改、不可复用。

### 6.3 订单、发货、售后和退款

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/orders` | 按订单号、状态、客户、代理、日期、金额筛选 |
| `GET` | `/orders/{order_id}` | 动态返回选中订单全部快照和时间线 |
| `POST` | `/orders/{order_id}/shipments` | 只对未取消且未被售后占用的数量创建包裹项 |
| `POST` | `/orders/{order_id}/complete` | 填写原因后总部兜底完成 |
| `GET` | `/aftersales` | 售后列表 |
| `GET` | `/aftersales/{aftersale_id}` | 售后、占用、退款与佣金影响详情 |
| `POST` | `/aftersales/{aftersale_id}/approve` | 审核同意 |
| `POST` | `/aftersales/{aftersale_id}/reject` | 拒绝原因必填并释放占用 |
| `POST` | `/aftersales/{aftersale_id}/confirm-return-receipt` | 确认收到退货 |
| `POST` | `/aftersales/{aftersale_id}/refund-preview` | 返回退款影响、资源版本、短时 `preview_token` 和 `confirmation_hash` |
| `POST` | `/aftersales/{aftersale_id}/refunds` | 使用预览确认创建退款和首次退款尝试；商户退款号在退款生命周期内稳定 |
| `POST` | `/refunds/{refund_id}/retry-preview` | 预览失败退款重试并签发新的短时确认 token |
| `POST` | `/refunds/{refund_id}/retry` | `REFUND_FAILED` 重试；必须使用不同于历次尝试的新 `Idempotency-Key` |

退款请求必须逐订单项携带可核验数量和正金额，并使用 `preview_token`、`confirmation_hash`、`If-Match` 和幂等键。服务端使用原支付/佣金快照计算库存和佣金影响。首次提交创建一条 `refund` 和第 1 条 `refund_attempt`；失败重试只追加新尝试，复用原 `refund_id`、稳定 `refund_no` 与订单项明细，不得生成新的商户退款号。未发货退款成功自动写入 `REFUND_RESTOCK` 库存流水；部分退款只发剩余数量；未发货全额退款将订单关闭并禁止发货。已发货退货不自动回库，验货后通过库存调整接口处理。

创建发货单时锁定订单及可发订单项，并由条件唯一索引保证同一订单最多一条非 `CANCELLED` 包裹。已有活动包裹时返回 `STATE_CONFLICT`；包裹取消后保留历史记录，允许重新创建一条替代包裹，仍不构成多包裹同时履约。

### 6.4 客户、代理和邀请码

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/customers` | 客户、账户手机号掩码、消费和当前归属 |
| `GET` | `/customers/{customer_id}` | 客户资料、订单和绑定历史 |
| `POST` | `/customers/{customer_id}/attribution-transfers` | 原因、影响预览和二次确认后转移或转直营 |
| `GET/POST` | `/agents` | 代理列表、新建代理和临时密码 |
| `GET/PATCH` | `/agents/{agent_id}` | 代理详情与资料修改 |
| `POST` | `/agents/{agent_id}/status-changes` | 启停代理，原因与影响摘要必填 |
| `POST` | `/agents/{agent_id}/password-resets` | 重置为临时密码并失效会话 |
| `GET/PATCH` | `/agents/{agent_id}/product-authorization` | 全部在售或自定义白名单 |
| `POST` | `/agents/{agent_id}/invite-code/rotate` | 轮换邀请码，旧码立即失效 |
| `PATCH` | `/agents/{agent_id}/invite-code` | 独立启停或设置有效期 |

启停代理必须返回受影响的有效绑定数、待确认候选数和待付款候选订单数供前端二次确认。停用使新登录、新绑定和支付时新归因失效，但不修改已支付佣金快照。

### 6.5 佣金规则

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/commission-rules/current` | 当前平台默认、分类和 SKU 有效结果 |
| `GET` | `/commission-rules/skus` | 查询全部 SKU，包括继承与 0% 状态 |
| `POST` | `/commission-rule-versions/preview` | 预览受影响 SKU 和新有效比例，返回确认哈希和短时 token |
| `POST` | `/commission-rule-versions` | 携带 `If-Match`、预览 token 和确认哈希保存不可变规则集版本 |
| `GET` | `/commission-rule-versions` | 版本历史 |
| `GET` | `/commission-rule-versions/{version_id}` | 版本差异和审计 |
| `GET` | `/orders/{order_id}/commission-explanation` | 解释支付时逐订单项命中路径 |

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

### 6.6 提现与受控银行卡查看

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/withdrawals` | 提现列表和状态筛选 |
| `GET` | `/withdrawals/{withdrawal_id}` | 常规详情，仅返回银行卡掩码 |
| `POST` | `/withdrawals/{withdrawal_id}/approve` | 仅 `PENDING` 可通过 |
| `POST` | `/withdrawals/{withdrawal_id}/reject` | 仅 `PENDING`，拒绝原因必填并解冻 |
| `POST` | `/withdrawals/{withdrawal_id}/payout-account-reveal` | 仅 `APPROVED`，消费短时授权并返回一次完整账号 |
| `POST` | `/withdrawals/{withdrawal_id}/proofs` | 上传付款凭证 |
| `POST` | `/withdrawals/{withdrawal_id}/mark-paid` | 凭证必填，幂等扣减冻结余额 |

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
  "account_number": "6225888888883916",
  "expires_at": "2026-08-11T03:01:00Z"
}
```

服务端在成功返回后立即消费 grant；响应必须包含 `Cache-Control: no-store, private`、`Pragma: no-cache`，前端只可在内存中保留至 60 秒、复制或离页中的最早时间，并恢复掩码。该接口不得把完整账号或整个响应写入 `idempotency_record.response_body`、日志、审计前后值或追踪系统；只记录状态码、响应摘要哈希和安全审计事件。`PENDING`、`REJECTED`、`PAID` 状态一律返回 `PAYOUT_ACCOUNT_REVEAL_NOT_ALLOWED`。

## 7. 文件接口

商品图、Banner、售后凭证和付款凭证统一使用受控文件实体：

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/files/upload-intents` | 获取对象存储上传参数和 `file_id` |
| `POST` | `/api/v1/files/{file_id}/complete` | 校验类型、大小和哈希后确认上传 |
| `GET` | `/api/v1/files/{file_id}/download-url` | 按角色和业务对象返回短时签名 URL |

售后与财务凭证默认私有；商品和 Banner 经审核后可标记为公开。文件接口不得接受任意本地路径或由客户端指定存储桶权限。

## 8. 幂等、事务与异步事件

| 场景 | 一致性边界 |
|---|---|
| 创建订单 | 订单、订单项、归因候选记录、库存预占、幂等记录同事务；不创建支付意图、不调用 Provider |
| 创建/复用支付意图 | 锁订单并创建或读取唯一 OPEN 本地意图；提交后以稳定商户支付号幂等调用 Provider，订单创建事务不包含 Provider 调用 |
| 正常支付 | 支付事实、库存结转、最终归因、佣金快照、预计流水、Outbox 同事务 |
| 超时关闭 | 存在 OPEN 意图时先关闭 Provider 意图；无意图则跳过；订单关闭、库存释放、Outbox 同事务 |
| 售后创建 | 售后、售后项、可退额度占用同事务 |
| 退款提交/重试 | 同一退款单复用稳定商户退款号；每次新幂等键追加独立 `refund_attempt`，重复同键只返回同一尝试 |
| 退款成功 | 回调事实、退款尝试、可退额度结转、自动回库、订单聚合、佣金冲正、Outbox 同事务 |
| 订单完成 | 订单完成、佣金可用入账、钱包流水、Outbox 同事务 |
| 提现提交 | 余额版本校验、冻结流水、提现申请同事务 |
| 提现拒绝/支付 | 状态变更、解冻或扣冻结流水、审计、Outbox 同事务 |

Provider 回调先写入回调收件箱，再由幂等处理器消费；领域事件使用事务 Outbox 发布。定时任务和消费者均必须可重入，失败进入重试队列并在超过阈值后生成后台待办。

### 8.1 高风险预览确认协议

代理停用、客户转移、售后拒绝/退款、提现拒绝/付款、邀请码轮换和佣金规则修改采用统一协议：

1. 预览接口对规范化请求体计算 `request_hash`，返回影响摘要、当前 `resource_version`、60 秒短时 `preview_token` 和 `confirmation_hash`；
2. 确认接口必须提交完全一致的业务字段、`preview_token`、`confirmation_hash`、`If-Match` 与新的 `Idempotency-Key`；
3. 服务端校验 token 绑定的管理员、会话、动作、目标、请求哈希和版本，成功写入时单次消费；
4. token 过期/已消费、确认哈希不匹配或资源版本变化分别返回 `PREVIEW_EXPIRED`、`CONFIRMATION_MISMATCH`、`RESOURCE_VERSION_CONFLICT`，不得静默重新预览或继续写入。

## 9. 安全与审计

- 密码仅保存强哈希，登录、验证码和二次验证均限流。
- 代理数据接口强制注入当前代理作用域；无权对象统一返回 404 或 403，不泄露存在性。
- 常规客户接口默认手机号掩码；代理永远只能获得尾号或 `null`，不得获得收货地址联系电话。
- 银行卡卡号使用字段级信封加密，密钥不进入数据库和日志。
- 审计至少记录主体、角色、对象、动作、原因、前后版本、结果、请求 ID、IP 摘要和时间；敏感值仅记录是否发生，不记录内容。
- 所有高风险写操作要求状态校验、原因、影响预览、短时 `preview_token`、`confirmation_hash`、`If-Match` 和幂等键；敏感查看额外要求短时 reauth grant，并禁止缓存明文响应。

## 10. 接口验收清单

- 同一商品不同 SKU 可同时存在购物车，订单项规格、价格、库存和快照正确。
- 关闭支付弹层后订单仍为待付款；重复创建订单使用同一幂等键返回同一订单。
- 创建订单不产生 Provider 调用；并发首次/重试支付最多生成一笔 OPEN 意图。
- 超时与支付回调并发时只能产生“正常支付”或“关闭后自动退款”之一，不得负库存或重复佣金。
- 并发售后申请的已退款金额与有效占用总和不超过订单项可退上限。
- 未发货部分退款自动回库并只发剩余数量；全额退款不可再发货。
- 已绑定客户购买代理白名单外 SKU 仍按统一商品规则计佣。
- 佣金规则恢复继承、0% 和自定义比例都生成新版本；历史订单解释结果不变。
- 退款只追加佣金减少/冲正流水，不修改原支付佣金快照。
- 退款失败重试追加新 `refund_attempt`，使用新幂等键但复用稳定商户退款号；重复回调只结转一次。
- 非 `APPROVED` 提现无法请求完整银行卡号；短时授权不可跨提现单、跨会话或重复使用。
- 所有关键回调和写操作在重复请求下只产生一次业务结果。
