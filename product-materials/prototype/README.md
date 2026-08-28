# 洗化产品私域商城三端高保真原型

## 打开方式

- `index.html`：消费者微信小程序可点击原型。
- `admin.html`：总部管理后台可点击原型；登录采用模拟服务端格式校验，不提供固定账号或密码。
- `agent.html`：一级代理工作台响应式 Web/H5 原型；登录采用模拟服务端格式校验，首次登录演示强制改密。
- `assets/`：Banner 与商品占位素材。
- `exports/`：验收截图输出目录。

三个原型均为纯静态文件，可直接用浏览器打开，不需要安装依赖或启动服务。所有数据均为原型演示数据。

当前产品/API 基线为 v2.4.7/CH-020。B0-B8 development 已完成；B8 最终 SHA `0fc5a8d3d1f07d3b5c9fcadf7ea4ca9560a0911a` 的普通 CI Run `33141704459` 与 Supabase development rollback-only Run `33142971501` 同 SHA 双绿，B8 development `GO`，CH-017 已失效。当前目录保留 B8 静态交互回归，并记录 B9.0 的 MP-04/06/08/10/11/18 交互边界；这里不包含 B9.1-B9.5 repository/API/Worker/工程小程序、真实微信能力或生产实现，也不替代后续批次、staging 或 production 验收。

## 验收脚本

`verify-prototype.cjs` 使用根工程 `@playwright/test` 的 Chromium 渲染三端核心画面；macOS 已安装 Chrome 时优先使用本机 Chrome，其他环境使用 Playwright Chromium，也可通过 `CHROME_EXECUTABLE_PATH` 指定。脚本检查错误、图片加载、横向溢出、响应式导航、看板图表、范围边界和关键业务交互。默认只验收、不改写 `exports/` 中的 PNG；设置 `UPDATE_PROTOTYPE_EXPORTS=1` 时才刷新截图。

当前可执行静态回归覆盖 21 个小程序页面、9 个代理页面/关键视图和 22 个总部页面/关键视图。验收脚本渲染 97 个桌面/移动组合，并执行 16 条小程序流程和 18 条总部/代理流程；覆盖 375、390、414、1024、1440 五种目标视口，关键异步门禁以可观察状态等待代替固定毫秒延迟。消费者断言包括 B7/B8 历史回归，以及 CH-020 的 BUY_NOW/CART 报价、重报价、HASH_ONLY 提交 journal、待付款订单、CANCEL/If-Match 和支付入口关闭；B9.4 工程小程序与 B9.5 真实浏览器纵向证据仍须独立交付。

CH-006 同步了 ADM-05/06 的冻结契约参考：品牌与一级分类创建固定为 `DRAFT`，普通编辑只维护契约字段和非负整数排序，生命周期通过影响预览确认，显式 `ARCHIVED` 筛选可恢复为 `DRAFT`。活动商品依赖会在 preview 200 中展示，confirm 提交返回 `ACTIVE_PRODUCT_DEPENDENCY` 422 且记录不变。品牌/分类编码、分类说明、分类佣金、商品/SKU 数量和品牌故事完整度不再出现在这两个管理界面。

CH-010 同步了 ADM-03/04 的冻结契约参考：商品创建固定为 `DRAFT`，SKU 创建固定为 `INACTIVE`；普通资料保存不改变生命周期。Product/SKU 的 `ACTIVATE / DEACTIVATE / SOFT_DELETE` 均先展示影响预览再确认，Product 恢复为 `DRAFT`，SKU 恢复为 `INACTIVE`。默认列表排除 `ARCHIVED`，详情保留归档 SKU；最低活动价在没有 `ACTIVE` SKU 时显示为空。商品编辑只展示库存快照，不提供库存调整或佣金字段，图集最多 8 张，`published_at` 只在首次启用时写入。

ADM-03/04 可直接演示四类 Product 422：缺少公开图片可进入图集上传，缺少已启用 SKU 可进入 SKU 管理，已启用 SKU 依赖可进入停用流程，活动库存预占按支付/售后来源定位只读订单或售后列表，不进入可写库存调整。主界面只显示中文业务原因，技术错误码和 HTTP 状态仅放在折叠诊断详情与 DOM data 属性。Product/SKU 409 会刷新当前版本、销毁旧 preview 并禁用旧确认；管理员必须返回最新记录后重新 preview/confirm，不会自动覆盖或复用。Product 启用时品牌或分类非已启用状态固定为 `STATE_CONFLICT` 409，不归入上述四类 422。

CH-012 同步了 ADM-07/08：Banner 通过既有文件上传信号选择公开 `READY` 图片，不再录入人工编码或自由文本跳转；目标闭合为 `NONE / PRODUCT / CATEGORY / URL`，创建固定 `DRAFT`，普通编辑不改变状态。启用、停用与 `DELETE` 归档遵循状态矩阵，`ACTIVE` 不提供直接归档，显式筛选 `ARCHIVED` 后可恢复为 `DRAFT`；DELETE/restore 才要求原因且不显示 preview token，排序、投放时间、目标和值域以及 If-Match/状态冲突 409 均可演示。

CH-014 同步了 MP-01 至 MP-06：ACTIVE 零库存 SKU 保留并显示售罄，全售罄 ACTIVE 商品仍可打开；搜索只匹配 trim 后 1–200 字符商品名称；综合排序固定按 hot/new/净销量/首次发布时间/商品 ID，另有热销、最新和 ACTIVE SKU 最低价升降序。首页分类区局部失败可由 `index.html?screen=home&home=partial` 直达，失败区为空且可重试，Banner、热销和新品继续显示。B6 工程实现时，收藏、立即购买、“我的”和结算只允许触发登录提示；本静态文件仍保留全量 MVP 历史流程供跨阶段评审，不作为 B6 已实现证据。

CH-016 同步了 MP-07/18/19/20/21：登录展示服务端 current legal snapshot，三份文档使用 `document_version / required / HTTPS content_url`，登录同意项固定为用户协议与隐私政策 exact set，版本冲突后清除旧同意并重新确认；本地 Mock Provider 只存在于开发态状态，不在生产界面提供 Provider 选择。账户资料支持昵称、HTTPS 头像和城市编辑，409 后刷新最新版本并要求重新保存；退出只撤销当前会话。B7 当时将收藏、地址、订单与售后入口保持为后续开放。手机号授权单独读取当前 `PHONE_AUTHORIZATION` 声明，Profile 使用 `phone_masked / phone_source / phone_verified_at`，支持自愿授权、重新授权和撤回，不从地址推导手机号。候选 token 不展示、不缓存，确认和拒绝均要求登录；当前服务代理只投影 `agent_id / display_name / bound_at`，界面只显示名称与绑定时间。账号注销先以 OK/200 preview 返回闭合 blockers/impacts；blocked 不签发确认能力，也不带 `ACCOUNT_DELETION_BLOCKED`，该错误仅在 confirm 重检阻断时以 422 出现；eligible 提供 5 分钟确认窗口，成功则同步去标识化并立即清除本地会话，不保留异步处理中状态。

CH-018 同步了 B8 的 MP-04/06/15/16/17/18：登录后的收藏动作返回原商品并只执行一次；收藏列表可按商品名搜索，同时保留 `SALEABLE / OUT_OF_STOCK / UNAVAILABLE` 三种当前状态。购物车区分游客本地记录和服务端权威投影，合并失败保留原条目与同一幂等键；服务端项闭合为 `SALEABLE / INSUFFICIENT_STOCK / OUT_OF_STOCK / INACTIVE / DELETED`，只统计已选可售项，数量固定不超过 `min(99, available_stock)`，空购物车不产生服务端记录。地址列表只展示脱敏摘要，详情拆分省、市、区并演示 If-Match 409、默认地址 422 和稳定提升。个人中心开放收藏和地址；结算、立即购买、订单、支付和履约仍只提示后续阶段，不从 B8 主流程进入历史交易画板。

CH-020 在不增加页面数量的前提下冻结 B9 的 MP-04/06/08/10/11/18：`BUY_NOW` 恰好一个 SKU，`CART` 精确匹配当前已选服务端购物车；MP-08 展示脱敏地址、价格/库存快照、固定零运费、闭合 blocker 和 5 分钟报价倒计时，变化或 409 后必须重新报价并再次确认。提交使用保存精确请求和固定幂等键的短期 journal，响应丢失只按原请求原键重试。MP-10/11 只开放本人订单列表、详情和合法 `CANCEL`，支付、MP-09 支付结果、物流、售后及 Admin/Agent 订单继续关闭。CH-020 契约实测为 `173 paths / 198 operations / 198 unique operationId / 325 schemas / 703 schema refs / 2,665 local refs / 0 dangling refs`，Redocly 0 warning；受控 Supabase development 0002 migration 与随后 rollback-only smoke 待执行，B9.0 仍为进行中。

库存页只展示 `physical_qty`、`locked_qty`、活动预占、`available_qty = physical_qty - locked_qty` 和版本；不再展示低库存阈值、预警值、售后占用或独立备注。调整必须提交非零整数 `physical_delta` 与原因，先 preview 再 confirm；重复确认只产生一条闭合类型流水，版本冲突返回 409，数量不足或越界返回 422，归档 SKU 保持只读。

本目录仍是纯静态交互参考，不单独证明 B3 至 B9 的业务实现验收。B8 的工程与远端双绿证据记录在阶段文档和对应 workflow；当前原型说明 CH-010 的 ADM-03/04、CH-012 的 ADM-07/08、CH-014 的消费者匿名目录、CH-016 的 B7 身份隐私、CH-018 的 B8 登录后购物基础及 CH-020 的 B9 报价/订单边界可落地。静态原型不能作为 Store API、工程小程序、Worker、迁移或 staging/production 证据。

安装根工程依赖后运行：

```bash
node product-materials/prototype/verify-prototype.cjs
```

需要显式刷新验收截图时：

```bash
UPDATE_PROTOTYPE_EXPORTS=1 \
  node product-materials/prototype/verify-prototype.cjs
```

## 交互范围

小程序静态画板覆盖首页、分类、搜索、商品详情、SKU 选择、购物车、个人中心、地址、收藏、手机号授权、账号注销和服务代理绑定；同时保留确认订单、Mock 支付、订单、物流与售后的跨阶段画板。B8 主流程已交付收藏、服务端购物车、游客登录合并和地址；B9.0 只冻结从商品/购物车到报价、订单提交、列表、详情和取消的交互，B9.4 前不得把未来画板描述为已接入真实 API。支付、真实微信、物流、售后和资金链路继续排除。

总部管理后台覆盖登录、可筛选且具备 Loading/Empty/Error/Retry 状态的数据看板、代理经营指标、商品动态新增/编辑/软归档、品牌/分类的 CH-006 生命周期参考、Banner 文件/typed target/生命周期、SPU 的 SKU 数/实物/锁定/可售汇总、SKU 库存 preview-confirm 与只追加流水、订单与内部备注、单包裹发货、售后审核/退货/验货证据封存/异常二阶段处置/退款重试、客户、代理白名单与邀请码治理、代理当前客户/已付订单/佣金/钱包/提现/目标审计下钻、统一商品佣金规则、提现、业务规则版本和审计日志。支付超时固定 30 分钟且不可配置。当前 MVP 不构造或展示消费者订单留言。一级代理工作台覆盖经营概览、推广商品、专属二维码/链接、脱敏客户、归属订单、售后进度、不可变佣金台账、单笔进行中提现限制、银行卡校验和账户资料。小程序首页、分类、搜索和商品详情只使用 `ACTIVE` 商品与全部 `ACTIVE` SKU 投影，零库存项显示售罄而不隐藏；购物车保留已下架或失效 SKU 但禁止结算。

历史订单的商品、SKU、净实付、佣金比例、来源、规则版本与佣金金额均使用支付时快照。修改当前商品、分类规则或客户归属后，历史订单不回算。提现通过只要求影响预览与确认；标记已支付要求凭证、影响预览与确认；拒绝提现和退款/补偿/重试仍要求原因。完整卡号入口只在 `APPROVED` 提现出现，原型仅展示非银行卡格式的运行时安全占位，使用本人 TOTP、60 秒单次授权、一次性复制和离页清除。

所有一级代理共用同一套商品佣金规则，规则优先级为 `SKU 覆盖 > 一级分类默认 > 平台默认`。总部可在 `admin.html?autologin=1&view=commission-rules` 查看和编辑交互原型；代理端仅展示各 SKU 的有效比例、规则来源和预计佣金，不提供佣金配置入口。

## Figma 交付

完整的画板命名、组件命名、设计令牌和页面映射见：

- `product-materials/docs/02-方案设计/原型设计方案.md`
- `product-materials/prototype/figma-handoff.md`
- `product-materials/prototype/agent-figma-handoff.md`

当前环境没有 Figma 云端写入连接器，因此 HTML 为可点击原型源，PNG 为画板验收稿，handoff 文档提供 Figma Auto Layout、Variables、组件和画板命名规范。

## 范围边界

当前版本纳入单层一级代理的引流归因、统一分类与 SKU 百分比佣金、支付快照、退款冲正和人工提现审核。代理专属佣金表、固定金额佣金、阶梯奖励、活动佣金、多级/二级代理、下级招募、团队佣金、代理进货、代理定价/库存/履约、自动打款、会员价、优惠券、积分、会员等级、拼团、秒杀、视频、AI 客服和 Excel 导出均不在本期原型范围。
