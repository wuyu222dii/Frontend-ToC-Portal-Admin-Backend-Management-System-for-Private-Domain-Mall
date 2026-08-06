# 青序生活商城管理后台 · Figma 交付规范

## 1. 交付信息

- 原型版本：v1.0
- 设计日期：2026-08-06
- 目标终端：PC 管理后台
- 基准画板：1440 × 1024、1024 × 768
- 可交互参考：`prototype/admin.html`
- 技术映射：Vue 3 + Element Plus
- 首期页面：登录、数据看板、商品列表、商品编辑与 SKU、订单列表、订单详情与发货、售后审核、客户列表与客户详情

本规范用于在 Figma 中重建设计源文件。HTML 原型提供完整视觉和交互参考，Figma 文件负责组件化、标注和评审流转，两者应保持相同命名和状态。

## 2. Figma 文件结构

按以下 Page 顺序创建，页面名不增加编号之外的装饰字符：

1. `00 Foundations`
2. `01 Components`
3. `02 Admin Desktop 1440`
4. `03 Admin Desktop 1024`
5. `04 Prototype Flows`
6. `05 Handoff`

### 2.1 画板清单

| Frame 名称 | 尺寸 | 核心状态 |
| --- | ---: | --- |
| `Admin/Login/Default` | 1440 × 1024 | 默认登录态 |
| `Admin/Login/Error` | 1440 × 1024 | 账号或密码为空 |
| `Admin/Dashboard/Default` | 1440 × 1024 | 经营看板 |
| `Admin/Products/List` | 1440 × 1024 | 默认商品列表 |
| `Admin/Products/List-Filtered` | 1440 × 1024 | 筛选结果与空结果 |
| `Admin/Products/Edit-Basic` | 1440 × 1024 | 基本信息 |
| `Admin/Products/Edit-SKU` | 1440 × 1024 | 规格、零售价、库存 |
| `Admin/Products/Edit-Detail` | 1440 × 1024 | 商品介绍、成分、用法 |
| `Admin/Products/Stock-Modal` | 1440 × 1024 | 库存调整弹窗 |
| `Admin/Products/Delete-Modal` | 1440 × 1024 | 删除二次确认 |
| `Admin/Orders/List` | 1440 × 1024 | 全部订单 |
| `Admin/Orders/List-ToShip` | 1440 × 1024 | 待发货筛选 |
| `Admin/Orders/Detail` | 1440 × 1024 | 待发货订单详情 |
| `Admin/Orders/Shipping-Modal` | 1440 × 1024 | 填写物流单 |
| `Admin/Orders/Shipped` | 1440 × 1024 | 发货成功、运输中 |
| `Admin/AfterSales/List` | 1440 × 1024 | 售后列表 |
| `Admin/AfterSales/Review-Modal` | 1440 × 1024 | 审核申请 |
| `Admin/Customers/List` | 1440 × 1024 | 客户列表 |
| `Admin/Customers/Detail-Drawer` | 1440 × 1024 | 客户详情抽屉 |

在 `03 Admin Desktop 1024` 中复制以下 8 个关键画板并调整自适应：登录、看板、商品列表、商品编辑 SKU、订单列表、订单详情、售后列表、客户列表。

## 3. Foundations

### 3.1 色彩变量

在 Figma Variables 中建立 Collection：`Qingxu / Light`。

| Token | Hex | 用途 |
| --- | --- | --- |
| `bg/page` | `#F4F7F5` | 页面底色 |
| `bg/surface` | `#FFFFFF` | 面板、表格、弹窗 |
| `bg/subtle` | `#F8FAF9` | 表头、轻背景 |
| `bg/strong` | `#EDF3EF` | 选中辅助背景 |
| `text/primary` | `#17211D` | 标题、核心数字 |
| `text/secondary` | `#46534D` | 正文、表格信息 |
| `text/muted` | `#78847E` | 提示、时间、辅助信息 |
| `border/default` | `#DFE7E2` | 面板和分隔线 |
| `border/strong` | `#CCD8D1` | 输入框和重点边界 |
| `brand/default` | `#2F6B57` | 主按钮、导航选中、正向数据 |
| `brand/dark` | `#214D3F` | 主按钮 hover |
| `brand/subtle` | `#E8F2ED` | 主色浅背景 |
| `info/default` | `#3978B8` | 运输中、信息提示 |
| `info/subtle` | `#EAF2FA` | 信息浅背景 |
| `accent/default` | `#DC705C` | 待处理、金额强调 |
| `accent/subtle` | `#FBECE8` | 待处理浅背景 |
| `warning/default` | `#B77A29` | 待付款、预警 |
| `warning/subtle` | `#FBF1DF` | 预警浅背景 |
| `service/default` | `#775D9F` | 售后流程辅助色 |
| `service/subtle` | `#F0EBF7` | 售后浅背景 |
| `danger/default` | `#C94949` | 删除、拒绝 |
| `sidebar/bg` | `#172A23` | 左侧导航 |
| `sidebar/active` | `#2B5D4C` | 当前导航项 |

禁止使用渐变。品牌绿只用于主动作与状态，蓝、珊瑚、琥珀和紫色承担独立语义，避免界面成为单一绿色调。

### 3.2 字体样式

字体优先级：`PingFang SC` → `Microsoft YaHei` → `Arial`。

| Text Style | 字号/行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| `Display/Login` | 42/58 | 600 | 登录视觉标题 |
| `Heading/Page` | 24/30 | 700 | 页面标题 |
| `Heading/Section` | 14/20 | 700 | 面板标题 |
| `Metric/Large` | 24/30 | 700 | 看板核心指标 |
| `Body/Default` | 14/22 | 400 | 正文 |
| `Body/Strong` | 13/20 | 600 | 按钮、关键单元格 |
| `Body/Compact` | 12/18 | 400 | 紧凑内容 |
| `Caption/Default` | 10/15 | 400 | 时间、备注、表头 |

字符间距统一为 `0`，不使用负字距，不以画板宽度缩放字号。

### 3.3 间距、圆角与阴影

- 基础间距：4、8、12、16、20、24、28、32、40、48。
- 页面内容间距：1440 画板左右 28；1024 画板左右 16。
- 卡片间距：14 或 16；卡片内边距：16 或 18。
- 输入框/按钮高度：36；登录输入框：46；顶部栏：64。
- 圆角：小控件 4，按钮/输入框 6，卡片/弹窗 8；卡片不得超过 8。
- 面板阴影：`0 1 2 0 / 5% #142D22`。
- 弹层阴影：`0 24 70 0 / 24% #0A1E15`。

### 3.4 栅格

`1440 Desktop`：

- 左侧导航固定 224。
- 工作区宽 1216，顶部栏固定 64。
- 内容区左右 28，最大可用内容宽 1160。
- 12 列栅格，Gutter 16，Margin 28。

`1024 Desktop`：

- 左侧导航收窄至 72，仅保留图标，hover 显示 Tooltip。
- 工作区宽 952，顶部栏固定 64。
- 内容区左右 16。
- 8 列栅格，Gutter 12，Margin 16。
- 表格优先隐藏销量、支付方式、时间、客单价等次级列，核心操作列必须保留。

## 4. Components

组件必须使用 Auto Layout，并为交互组件建立 Properties。

### 4.1 导航

`Navigation/Sidebar Item`

- Properties：`State = Default | Hover | Active`、`Badge = None | Number`、`Collapsed = True | False`。
- 展开尺寸 200 × 42，收窄尺寸 52 × 42。
- 图标 19 × 19；展开时图标与文字间距 12。
- Active 背景 `sidebar/active`，文字白色。

`Navigation/Topbar`

- 高度 64，包含导航收起按钮、面包屑、全局搜索、通知和账号入口。
- 全局搜索宽 246；1024 画板宽 210。

### 4.2 按钮与图标按钮

`Button/Default`

- Properties：`Type = Primary | Secondary | Ghost | Danger`、`Size = Small | Default`、`State = Default | Hover | Disabled`、`Icon = On | Off`。
- Default 高 36，Small 高 30；横向 padding 14/10，元素间距 7。
- Primary 仅用于当前页面最重要动作，例如新增商品、保存上架、确认发货、同意退款。

`Button/Icon`

- 34 × 34，图标 18；紧凑表格操作为 30 × 30。
- 熟悉图标直接使用：查看、编辑、删除、复制、关闭、返回、通知、菜单。
- 每个图标按钮在开发时必须有 `title` 或 Tooltip。

### 4.3 表单

建立 `Input/Text`、`Input/Search`、`Select/Default`、`Textarea/Default`、`Switch/Default`、`Checkbox/Default`。

- Default 高度 36，边框 `border/strong`，圆角 5。
- Focus 边框 `brand/default`，外环 2px、10% 品牌绿。
- 必填星号使用 `accent/default`。
- 错误信息紧邻字段下方，字号 12，使用 `danger/default`。
- 开关尺寸 34 × 19；开启时主色填充。

### 4.4 数据组件

`Data/Metric Card`

- 1440：四列等宽；1024：两列。
- 高度 140/124，内边距 18。
- 指标图标 36 × 36，圆角 7。

`Data/Table`

- 表头高 42，数据行高 64。
- 表头背景 `bg/subtle`，字号 10。
- 行 hover 背景 `#FBFCFB`。
- 操作列固定右侧；1024 隐藏标记为 Optional 的列。

`Data/Status Tag`

- 高 22，水平 padding 8。
- 状态映射：在售/已完成为绿，待发货/待退货为琥珀，运输中为蓝，退款售后/待审核为珊瑚，待退款为紫，草稿/下架为中性灰。

### 4.5 反馈组件

- `Feedback/Toast`：最小宽 240，高 42，顶部居中 24，显示 2.2 秒。
- `Overlay/Modal`：常规宽 520，库存弹窗 450，售后审核 680。
- `Overlay/Drawer`：右侧宽 430，全高。
- 遮罩：`#0D1B15` 46%。
- 弹层打开后焦点进入首个输入框，Esc 和遮罩点击可关闭。

## 5. 页面规格

### 5.1 登录

- 1440 使用 58%/42% 双栏；1024 使用 52%/48%。
- 左侧为深绿品牌区：品牌标志、产品包装陈列、品牌文案；右侧为账号密码表单。
- 默认填入原型演示账号 `admin` 和密码 `123456`。
- 登录按钮连接 `Admin/Dashboard/Default`；空字段连接 `Admin/Login/Error`。
- 密码查看按钮切换文本可见状态。

### 5.2 数据看板

- 顶部为页面标题、日期选择。
- 待发货提醒横条占满内容宽，按钮进入待发货订单列表。
- 第一行四个指标：今日销售额、今日订单、客户总数、本月销售额。
- 第二行左侧销售趋势，右侧商品销量排行；趋势支持 7 天/30 天切换。
- 第三行四个订单任务入口：待付款、待发货、运输中、待审售后。
- 底部为最新订单表，订单号和查看按钮进入订单详情。

### 5.3 商品列表

- 顶部主动作仅保留“新增商品”。
- 状态 Tab：全部、在售、已下架、草稿。
- 筛选器：关键词、一级分类、品牌、状态、重置。
- 表格字段：商品、零售价、库存、销量、状态、首页推荐、操作。
- 编辑进入商品编辑；库存图标打开库存调整弹窗；删除触发二次确认；推荐开关原位反馈。
- 筛选无结果时显示空状态，不改变表格容器高度。

### 5.4 商品编辑与 SKU

- 页面采用主内容 + 260px 发布侧栏；1024 侧栏收窄至 230。
- Tab：基本信息、规格与库存、详情内容。
- 基本信息：图片、商品名称、品牌、货号、一级分类、商品卖点。
- SKU：规格名称、规格编码、零售价、可售库存、删除；至少保留一个规格。
- 详情内容：商品介绍、成分说明、使用方法，可新增图文模块。
- 发布侧栏：商品状态、首页推荐、新品标记、库存与销量摘要。
- 保存并上架后 Toast 反馈并返回商品列表。

### 5.5 订单列表与详情

- 订单状态入口：全部、待付款、待发货、运输中、已完成、退款售后。
- 筛选器：订单号/客户/手机号、状态、日期范围、重置。
- 待发货订单显示“发货”文本动作；所有订单可进入详情。
- 详情顶部为 5 步状态条：提交、付款、待发货、运输中、完成。
- 主栏展示商品与金额、订单记录；侧栏展示收货信息、订单信息、操作按钮。
- 发货弹窗字段：物流公司、物流单号、是否通知客户。提交后状态变为运输中，发货按钮隐藏，状态条同步推进。

### 5.6 售后审核

- 顶部四项摘要：待审核、待退货、待退款、本月售后率。
- 筛选器：售后单/订单/客户、类型、状态、重置。
- 审核弹窗展示商品、客户、金额、原因、货物状态和客户说明。
- 可执行拒绝或同意退款；完成后列表状态原位更新并显示 Toast。

### 5.7 客户列表与详情

- 摘要指标：客户总数、本月新增、复购客户、人均净消费。
- 搜索字段：微信昵称、姓名、手机号。
- 表格字段：客户、净消费额、消费次数、客单价、最近购买、注册时间、操作。
- 查看按钮打开 430px 右侧抽屉。
- 抽屉展示净消费额、消费次数、客单价、注册时间、最近访问、收货城市和最近购买商品。

## 6. Prototype 连线

在 `04 Prototype Flows` 建立以下 Flow Starting Point：

### Flow A · 登录与导航

`Login/Default` → 点击登录 → `Dashboard/Default` → 点击左侧导航 → 对应列表页。

### Flow B · 商品维护

`Products/List` → 新增/编辑 → `Products/Edit-Basic` → SKU Tab → `Products/Edit-SKU` → 保存并上架 → `Products/List`。

库存分支：`Products/List` → 库存编辑图标 → `Products/Stock-Modal` → 确认 → Smart Animate 回列表并显示 Toast。

### Flow C · 订单发货

`Dashboard/Default` → 待发货提醒 → `Orders/List-ToShip` → 发货/查看 → `Orders/Detail` → 立即发货 → `Orders/Shipping-Modal` → 确认发货 → `Orders/Shipped`。

### Flow D · 售后审核

`AfterSales/List` → 审核 → `AfterSales/Review-Modal` → 同意或拒绝 → 返回列表并更新状态。

### Flow E · 客户查看

`Customers/List` → 查看 → `Customers/Detail-Drawer` → 查看订单 → `Orders/List`。

交互动效：页面切换使用 Instant；Modal、Drawer、Toast 使用 Smart Animate 180ms Ease Out。遵从系统“减少动态效果”时改为 Instant。

## 7. 响应式规则

| 区域 | 1440 | 1024 |
| --- | --- | --- |
| 侧栏 | 224，图标+文字 | 72，仅图标；点击菜单后以 224 覆盖展开 |
| 内容边距 | 28 | 16 |
| 指标卡 | 4 列 | 2 列 |
| 看板图表 | 趋势 1.7fr / 排行 0.8fr | 趋势 1.35fr / 排行 0.75fr |
| 编辑页 | 主区 + 260 侧栏 | 主区 + 230 侧栏 |
| 表格 | 全字段 | 隐藏 Optional 字段，保持横向可滚动兜底 |
| 账号入口 | 头像+姓名+角色 | 仅头像 |

所有表格、按钮组、计数器和状态条使用稳定宽高，不因 hover、状态文字或数字位数变化产生布局位移。

## 8. 开发映射

| Figma 组件 | Element Plus 建议 |
| --- | --- |
| Button | `el-button` |
| Input/Search | `el-input` |
| Select | `el-select` |
| Switch | `el-switch` |
| Checkbox | `el-checkbox` |
| Table | `el-table` + 固定操作列 |
| Status Tag | `el-tag` 自定义语义色 |
| Tabs | `el-tabs` |
| Modal | `el-dialog` |
| Drawer | `el-drawer` |
| Toast | `ElMessage` |
| Pagination | `el-pagination` |
| Upload | `el-upload` |

图标在开发阶段统一使用项目启用的 Lucide 图标包；按钮中的图标保持 18px，表格紧凑操作保持 16px。

## 9. 交付检查

- [ ] 1440 与 1024 关键画板均已创建并使用 Auto Layout。
- [ ] 页面均来自同一套 Foundations 与 Components，不复制脱离组件的控件。
- [ ] 卡片圆角不超过 8，界面中无渐变装饰。
- [ ] 登录、筛选、空状态、库存调整、发货、售后审核和客户抽屉均可点击演示。
- [ ] 弹层具有 Default、Error、Success 必要状态。
- [ ] 1024 下文字不遮挡、按钮不换行溢出、关键操作列可见。
- [ ] 颜色对比度满足正文 4.5:1，所有图标按钮都有文字说明或 Tooltip。
- [ ] 页面命名、字段文案与 HTML 原型一致。
