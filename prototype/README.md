# 洗化产品私域商城三端高保真原型

## 打开方式

- `index.html`：消费者微信小程序可点击原型。
- `admin.html`：总部管理后台可点击原型；登录采用模拟服务端格式校验，不提供固定账号或密码。
- `agent.html`：一级代理工作台响应式 Web/H5 原型；登录采用模拟服务端格式校验，首次登录演示强制改密。
- `assets/`：Banner 与商品占位素材。
- `exports/`：验收截图输出目录。

三个原型均为纯静态文件，可直接用浏览器打开，不需要安装依赖或启动服务。所有数据均为原型演示数据。

## 验收脚本

`verify-prototype.cjs` 使用 Playwright 和本机 Chrome 渲染三端核心画面，检查脚本错误、图片加载、横向溢出、响应式导航、看板图表、范围边界和关键业务交互。默认只验收、不改写 `exports/` 中的 PNG；设置 `UPDATE_PROTOTYPE_EXPORTS=1` 时才刷新截图。

当前 v2.4（CH-005）覆盖 21 个小程序页面、9 个代理页面/关键视图和 22 个总部页面/关键视图。验收脚本渲染 78 个桌面/移动组合，并执行 14 条小程序流程和 16 条总部/代理流程；关键异步门禁以可观察状态等待代替固定毫秒延迟，最终全量套件连续 3 轮通过。门禁包含 SKU 结算、公开目录 `ACTIVE`-only 与购物车失效项保留、本人地址列表掩码与编辑详情完整预填、固定 30 分钟支付超时及迟到退款、单包裹整单阻断、退货验货数量等式、PASS 零证据与 ABNORMAL 证据封存、`CONTINUE_REFUND / REJECT_AFTER_RETURN` 二阶段处置、SPU 库存汇总与 SKU 下钻、代理六类目标投影、不可变佣金快照、提现防重复和本人 TOTP 短时授权。

本工作区可使用 Codex 内置 Node 运行：

```bash
NODE_PATH=/Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  prototype/verify-prototype.cjs
```

需要显式刷新验收截图时：

```bash
UPDATE_PROTOTYPE_EXPORTS=1 \
  NODE_PATH=/Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  prototype/verify-prototype.cjs
```

## 交互范围

小程序覆盖首页、分类、搜索、商品详情、SKU 选择、购物车、确认订单、Mock 支付、四轴订单详情、物流、售后、地址、收藏、手机号授权、账号删除、个人中心和服务代理绑定。画布内控件可串联购买、归因确认、支付恢复、售后与隐私流程。

总部管理后台覆盖登录、可筛选且具备 Loading/Empty/Error/Retry 状态的数据看板、代理经营指标、商品动态新增/编辑/软归档、品牌/分类/Banner CRUD、SPU 的 SKU 数/实物/锁定/可售汇总与 SKU 库存流水下钻、订单与内部备注、单包裹发货、售后审核/退货/验货证据封存/异常二阶段处置/退款重试、客户、代理白名单与邀请码治理、代理当前客户/已付订单/佣金/钱包/提现/目标审计下钻、统一商品佣金规则、提现、业务规则版本和审计日志。支付超时固定 30 分钟且不可配置。当前 MVP 不构造或展示消费者订单留言。一级代理工作台覆盖经营概览、推广商品、专属二维码/链接、脱敏客户、归属订单、售后进度、不可变佣金台账、单笔进行中提现限制、银行卡校验和账户资料。小程序首页、分类、搜索和商品详情仅使用 `ACTIVE` 商品与 SKU 投影，购物车保留已下架 SKU 但禁止结算。

历史订单的商品、SKU、净实付、佣金比例、来源、规则版本与佣金金额均使用支付时快照。修改当前商品、分类规则或客户归属后，历史订单不回算。提现通过只要求影响预览与确认；标记已支付要求凭证、影响预览与确认；拒绝提现和退款/补偿/重试仍要求原因。完整卡号入口只在 `APPROVED` 提现出现，原型仅展示非银行卡格式的运行时安全占位，使用本人 TOTP、60 秒单次授权、一次性复制和离页清除。

所有一级代理共用同一套商品佣金规则，规则优先级为 `SKU 覆盖 > 一级分类默认 > 平台默认`。总部可在 `admin.html?autologin=1&view=commission-rules` 查看和编辑交互原型；代理端仅展示各 SKU 的有效比例、规则来源和预计佣金，不提供佣金配置入口。

## Figma 交付

完整的画板命名、组件命名、设计令牌和页面映射见：

- `docs/02-方案设计/原型设计方案.md`
- `prototype/figma-handoff.md`
- `prototype/agent-figma-handoff.md`

当前环境没有 Figma 云端写入连接器，因此 HTML 为可点击原型源，PNG 为画板验收稿，handoff 文档提供 Figma Auto Layout、Variables、组件和画板命名规范。

## 范围边界

当前版本纳入单层一级代理的引流归因、统一分类与 SKU 百分比佣金、支付快照、退款冲正和人工提现审核。代理专属佣金表、固定金额佣金、阶梯奖励、活动佣金、多级/二级代理、下级招募、团队佣金、代理进货、代理定价/库存/履约、自动打款、会员价、优惠券、积分、会员等级、拼团、秒杀、视频、AI 客服和 Excel 导出均不在本期原型范围。
