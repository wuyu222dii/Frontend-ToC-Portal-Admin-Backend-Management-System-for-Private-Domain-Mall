# 青序伙伴一级代理工作台 · Figma 交付规范

## 1. 交付信息

- 原型版本：v1.0
- 设计日期：2026-08-10
- 目标终端：响应式 Web / H5 代理工作台
- 基准画板：1440 × 1000、1024 × 768、390 × 844
- 可交互参考：`prototype/agent.html`
- 原型直达：`?autologin=1&view=dashboard|products|customers|orders|commission|wallet|account`
- 技术映射：Vue 3 + Element Plus，H5 兼容微信内置浏览器
- 角色边界：仅面向 `AGENT_ADMIN` 一级代理，不包含平台超级管理员和消费者能力

本规范用于在 Figma 中重建代理端设计源文件。HTML 原型是本阶段的视觉与交互参考；Figma 文件用于组件化、标注、评审和研发交付，两者页面名称、字段和状态必须保持一致。

## 2. 产品边界

代理工作台采用“推广 + 佣金”模式。平台统一维护商品、零售价、库存、收款、发货和售后；代理仅能分享授权商品并查看本人归属客户、归属订单和资金记录。

设计中必须遵守以下边界：

- 仅有一级代理，不设计任何层级、招募或团队入口。
- 不提供改价、改库存、代客下单、发货、退款和售后处理按钮。
- 客户手机号仅显示后四位，不展示真实姓名和详细收货地址。
- 佣金比例、归属代理、计算基数和金额均展示订单快照语义。
- 退款冲减保留负向流水，不删除历史入账。
- 银行卡仅显示开户人、银行和卡号后四位；完整卡号属于加密数据。

## 3. Figma 文件结构

按以下 Page 顺序创建：

1. `00 Foundations`
2. `01 Components`
3. `02 Agent Desktop 1440`
4. `03 Agent Desktop 1024`
5. `04 Agent Mobile 390`
6. `05 Prototype Flows`
7. `06 Handoff`

### 3.1 画板清单

| Frame 名称 | 尺寸 | 核心状态 |
| --- | ---: | --- |
| `Agent/Login/Default` | 1440 × 1000 | 代理账号和临时密码 |
| `Agent/Login/First-Password` | 1440 × 1000 | 首次登录强制改密弹窗 |
| `Agent/Dashboard/Default` | 1440 × 1000 | 指标、趋势、钱包、快捷入口、最新订单 |
| `Agent/Products/List` | 1440 × 1000 | 授权商品与筛选 |
| `Agent/Products/Share-Modal` | 1440 × 1000 | 商品推广码、邀请码、推广链接 |
| `Agent/Products/Detail-Drawer` | 1440 × 1000 | 商品价格、预计佣金和平台服务 |
| `Agent/Customers/List` | 1440 × 1000 | 脱敏客户列表 |
| `Agent/Customers/Detail-Drawer` | 1440 × 1000 | 归属信息和消费概览 |
| `Agent/Orders/List` | 1440 × 1000 | 归属订单列表 |
| `Agent/Orders/Detail-Drawer` | 1440 × 1000 | 订单、佣金快照和履约进度 |
| `Agent/Orders/AfterSale-Drawer` | 1440 × 1000 | 平台售后进度和负向佣金 |
| `Agent/Commission/List` | 1440 × 1000 | 预计、入账、冲减流水 |
| `Agent/Commission/Refund-Drawer` | 1440 × 1000 | 退款冲减计算快照 |
| `Agent/Wallet/Default` | 1440 × 1000 | 余额、银行卡、规则、历史提现 |
| `Agent/Wallet/Withdraw-Modal` | 1440 × 1000 | 金额、银行卡和确认声明 |
| `Agent/Wallet/Withdrawal-Drawer` | 1440 × 1000 | 审核、打款和凭证时间线 |
| `Agent/Account/Default` | 1440 × 1000 | 代理资料、安全、银行卡和权限 |
| `Agent/Account/Password-Modal` | 1440 × 1000 | 修改密码 |
| `Agent/Account/Bank-Modal` | 1440 × 1000 | 管理收款银行卡 |

在 `03 Agent Desktop 1024` 中复制登录、看板、商品、客户、订单、佣金、钱包和账户 8 个默认画板；在 `04 Agent Mobile 390` 中复制同样 8 个画板，并补充分享、提现、订单详情三个移动底部弹层状态。

## 4. Foundations

### 4.1 色彩变量

在 Figma Variables 中创建 Collection：`Qingxu / Light`，与平台后台共用基础令牌。

| Token | Hex | 用途 |
| --- | --- | --- |
| `bg/page` | `#F4F7F5` | 页面底色 |
| `bg/surface` | `#FFFFFF` | 面板、表格、弹层 |
| `bg/subtle` | `#F8FAF9` | 表头、筛选、轻背景 |
| `bg/strong` | `#EDF3EF` | 中性状态背景 |
| `text/primary` | `#17211D` | 标题、金额、核心信息 |
| `text/secondary` | `#46534D` | 正文和表格文本 |
| `text/muted` | `#78847E` | 时间、提示、辅助信息 |
| `border/default` | `#DFE7E2` | 面板、分隔线 |
| `border/strong` | `#CCD8D1` | 输入框、重点边界 |
| `brand/default` | `#2F6B57` | 主动作、选中、正向金额 |
| `brand/dark` | `#214D3F` | 主动作 Hover、钱包底色 |
| `brand/subtle` | `#E8F2ED` | 品牌浅背景 |
| `info/default` | `#3978B8` | 运输中、信息提示 |
| `info/subtle` | `#EAF2FA` | 信息浅背景 |
| `accent/default` | `#DC705C` | 待处理、退款提醒 |
| `accent/subtle` | `#FBECE8` | 待处理浅背景 |
| `warning/default` | `#B77A29` | 预计佣金、待发货 |
| `warning/subtle` | `#FBF1DF` | 预计、临时密码提示 |
| `danger/default` | `#C94949` | 退款冲减、驳回、退出 |
| `danger/subtle` | `#FBEDED` | 负向状态浅背景 |
| `sidebar/bg` | `#172A23` | 左侧导航 |
| `sidebar/active` | `#2B5D4C` | 当前导航项 |

界面不使用渐变。品牌绿承担主动作，蓝、珊瑚、琥珀承担信息、负向和预计等不同语义，避免单一绿色铺满。

### 4.2 字体与数字

字体优先级：`PingFang SC` → `Microsoft YaHei` → `Arial`。

| Text Style | 字号/行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| `Display/Login` | 40/57 | 600 | 登录品牌标题 |
| `Heading/Page` | 24/31 | 700 | 桌面页面标题 |
| `Heading/Page-Mobile` | 21/28 | 700 | 移动页面标题 |
| `Heading/Section` | 14/20 | 700 | 面板标题 |
| `Metric/Large` | 23/28 | 700 | 桌面指标 |
| `Metric/Mobile` | 18/23 | 700 | 移动指标 |
| `Body/Default` | 13/21 | 400 | 正文 |
| `Body/Strong` | 12/18 | 600 | 按钮和关键单元格 |
| `Body/Compact` | 10/16 | 400 | 紧凑表格和说明 |
| `Caption/Default` | 9/14 | 400 | 标签、时间和备注 |

金额采用 `¥ 1,826.40` 格式；负向流水采用 `- ¥ 159.20`，同时使用负号和语义色，不只依赖颜色。字符间距统一为 `0`，字号不随画板宽度缩放。

### 4.3 间距、圆角和阴影

- 基础间距：4、8、12、16、20、24、28、32、40、48。
- 1440 内容边距 28；1024 内容边距 18；390 内容边距 14。
- 桌面顶部栏 64，移动顶部栏 56，移动底部导航 62 加安全区。
- 按钮和输入框高度 36；登录输入框 46；移动点击区域不低于 36。
- 圆角：小控件 4、按钮/输入框 6、卡片/弹层 8；业务卡片不得超过 8。
- 面板阴影：`0 1 2 / 5% #142D22`；弹层阴影：`0 24 70 / 24% #0A1E15`。

### 4.4 栅格

`1440 Desktop`：左侧导航 224，顶部栏 64，内容区左右 28，12 列，Gutter 16。

`1024 Desktop`：左侧导航收窄至 76，仅保留图标和 Tooltip，内容区左右 18，8 列，Gutter 12。

`390 Mobile`：单列内容，左右 14；指标与商品使用 2 列；列表改为纵向数据卡；固定底部 5 项导航。

## 5. Components

### 5.1 导航

`Agent/Navigation/Sidebar Item`

- Properties：`State = Default | Hover | Active`、`Badge = None | Number`、`Collapsed = True | False`。
- 展开宽 200、高 42；收窄 52 × 42；图标 19。
- 分组固定为经营、推广、结算、账户，不出现其他代理关系入口。

`Agent/Navigation/Mobile Tab`

- 5 项：首页、推广、订单、佣金、我的。
- 钱包从佣金页进入；客户从首页快捷入口或“我的”关联入口进入。
- Active 同时改变图标和文字颜色，固定高度避免状态切换位移。

### 5.2 数据组件

- `Metric/Card`：桌面 4 列，移动 2 列；数值区保持单行并预留最长金额宽度。
- `Product/Share Card`：商品图、品牌/分类、平台零售价、预计佣金、平台销量、库存状态、查看和推广。
- `Customer/Masked Row`：昵称、手机后四位、城市、绑定时间、归属消费、次数和最近商品。
- `Order/Attributed Row`：订单号、脱敏客户、商品、实付、订单状态、佣金及佣金状态。
- `Commission/Ledger Row`：时间、类型、订单快照、净实付、比例、变动金额和余额影响。
- `Withdrawal/Row`：提现单、时间、金额、脱敏银行卡、状态、完成时间和详情。
- `Status/Tag`：预计为琥珀、可提现/完成为绿、运输中/审核通过为蓝、退款冲减/驳回为红。

### 5.3 弹层

- `Overlay/Share`：桌面 560 宽；移动为底部弹层。包含商品图、演示二维码、邀请码、链接、保存和复制动作。
- `Overlay/Withdraw`：桌面 520 宽；字段为金额、金额快捷项、银行卡和确认声明。
- `Overlay/Password`：支持普通修改与首次登录强制修改两种 Variant。
- `Overlay/Bank`：账户姓名、开户银行、银行卡号；显示加密说明。
- `Overlay/Detail Drawer`：桌面右侧 440；移动全屏，用于商品、客户、订单、佣金和提现详情。

## 6. 页面规格

### 6.1 登录

- 桌面为 58% / 42% 双栏；左侧使用真实商品图、品牌价值和业务定位，右侧为登录表单。
- 默认演示账号 `qingyuan.agent`，密码 `Agent@2026`。
- 表单明确提示临时密码；首次提交连接 `Login/First-Password`，修改成功后进入看板。
- 移动端隐藏大幅品牌区，保留品牌、登录字段和首次登录提示。

### 6.2 经营概览

- 指标：今日归属销售额、今日归属订单、绑定客户、预计佣金。
- 平台统一履约提示作为业务状态横条，不作为营销说明区。
- 趋势支持 7 天/30 天切换；钱包快照可进入提现；四个快捷入口分别进入商城码、商品、客户和佣金。
- 最新订单仅可查看，不提供任何履约动作。

### 6.3 推广商品

- 摘要：授权商品数、佣金比例、本月访问、本月归属订单。
- 筛选：关键词、分类、热销/佣金/新品排序。
- 商品卡主动作是“立即推广”，次动作是“查看”；不显示编辑价格和库存入口。
- 分享弹层支持商城级和商品级两类链接，均携带 `QY6088` 归属参数。

### 6.4 客户与订单

- 客户列表只出现微信昵称、手机号后四位、城市和运营统计。
- 客户详情明确展示长期绑定关系；不展示解绑、转移或编辑动作。
- 订单列表按待发货、运输中、已完成和退款售后筛选。
- 订单详情显示支付时代理、比例、基数和佣金快照；售后订单显示平台处理时间线和佣金冲减。

### 6.5 佣金与钱包

- 佣金列表同时覆盖预计佣金、可提现入账和退款冲减三类流水。
- 佣金详情展示 `商品净实付 × 比例 = 佣金` 的冻结快照。
- 钱包区分可提现、预计、处理中、累计提现和退款冲减。
- 提现最低金额为 100 元、手续费为 0；提交后进入审核中状态。同一代理同时只能有一笔待审核或已审核未打款申请。
- 提现详情按提交、审核、线下打款、凭证上传展示时间线。

### 6.6 账户

- 资料区包含代理编号、邀请码、开通时间和当前佣金比例。
- 比例说明明确“调整只影响之后支付的新订单”。
- 资料修改采用申请语义；密码和银行卡可独立进入弹层。
- 权限标签只显示推广商品、查看客户、查看订单和佣金提现。

## 7. Prototype 连线

### Flow A · 首次登录

`Login/Default` → 登录 → `Login/First-Password` → 设置新密码 → `Dashboard/Default`。

### Flow B · 推广获客

`Dashboard/Default` → 推广商品 → `Products/List` → 立即推广 → `Products/Share-Modal` → 复制链接或保存推广图。

商城分支：`Dashboard/Default` → 生成商城码 → `Products/Share-Modal[Store]`。

### Flow C · 订单和售后查询

`Orders/List` → 订单详情 → `Orders/Detail-Drawer`。

退款分支：`Orders/List[Refund]` → `Orders/AfterSale-Drawer` → 查看负向佣金 → `Commission/Refund-Drawer`。

### Flow D · 佣金提现

`Commission/List` → 查看钱包 → `Wallet/Default` → 申请提现 → `Wallet/Withdraw-Modal` → 提交 → 列表新增“审核中”记录 → `Wallet/Withdrawal-Drawer`。

### Flow E · 账户安全

`Account/Default` → 修改密码 → `Account/Password-Modal`；管理银行卡 → `Account/Bank-Modal`。

页面切换使用 Instant；Modal、Drawer 和 Toast 使用 180ms Ease Out。系统启用“减少动态效果”时全部切换为 Instant。

## 8. 响应式规则

| 区域 | 1440 | 1024 | 390 |
| --- | --- | --- | --- |
| 导航 | 224，图标+文字 | 76，仅图标 | 顶栏 + 5 项底部导航 |
| 内容边距 | 28 | 18 | 14 |
| 指标 | 4 列 | 2 列 | 2 列 |
| 趋势/钱包 | 1.62fr / 0.78fr | 两列或按可用宽折行 | 单列 |
| 商品 | 4 列 | 2 列 | 2 列，隐藏次要详情按钮 |
| 数据列表 | 表格 | 表格，必要时横向滚动 | 纵向数据卡 |
| 钱包头部 | 左余额 + 右 2 × 2 | 可变为单列 | 单列 |
| 弹层 | 居中 Modal / 右 Drawer | 同桌面 | 底部 Modal / 全屏 Drawer |

所有画板需要验证 320px 长单词和 7 位金额场景。按钮、标签、图标、计数器和二维码使用稳定尺寸，不因 Hover、金额或状态文字改变布局。

## 9. 开发映射

| Figma 组件 | Element Plus 建议 |
| --- | --- |
| Button / Icon Button | `el-button` + 项目统一图标库 |
| Input / Search / Select | `el-input`、`el-select` |
| Metric / Product Card | 业务组件 + CSS Grid |
| Table | `el-table`，移动端切换数据卡组件 |
| Status Tag | `el-tag` 自定义语义色 |
| Segmented / Tabs | `el-segmented`、`el-tabs` |
| Modal | `el-dialog`，移动端底部样式 |
| Drawer | `el-drawer` |
| Upload | `el-upload`，代理端仅查看平台打款凭证 |
| Toast | `ElMessage` |

正式实现时，前端隐藏按钮不能替代服务端权限校验；所有列表查询必须按当前代理 ID 做数据隔离，金额由服务端返回快照值，前端不得自行作为结算依据。

## 10. 交付检查

- [ ] 1440、1024、390 三组关键画板均来自同一套 Foundations 和 Components。
- [ ] 登录、首改密码、商品分享、客户详情、订单售后、佣金负向流水、提现和银行卡流程可点击。
- [ ] 页面不出现代理层级、招募、团队或采购功能。
- [ ] 所有客户联系方式与银行卡号均脱敏，订单详情无详细地址。
- [ ] 所有商品价格、库存、履约和售后均为平台统一管理语义。
- [ ] 佣金比例、基数、金额和归属代理采用支付时快照语义。
- [ ] 卡片圆角不超过 8，界面无渐变和装饰性光斑。
- [ ] 390 画板无横向溢出，底部导航不遮挡页面操作。
- [ ] 颜色对比度、键盘焦点和图标 Tooltip 满足可访问性要求。
- [ ] 页面命名、字段、演示数据和 HTML 原型一致。

