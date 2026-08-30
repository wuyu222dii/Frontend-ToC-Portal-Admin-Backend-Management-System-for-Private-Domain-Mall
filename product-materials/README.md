# 产品资料索引

本目录集中管理三端商城的需求、方案、技术、风控、开发文档和可点击原型。

当前交付状态：B0 至 B9 development 均已通过；B9 development `GO`，CH-019 已自动失效。B10.0 已在 SHA `8cd5781eed9349d6f110fa43510e78c7f525a482` 依次取得普通 CI Run `33242561514`、Supabase development migration Run `33243979003` 与 rollback-only smoke Run `33244107293` 成功证据，退出复审为 `P0=0/P1=0`。CH-021/CH-022/CH-023 已批准，当前产品/API 基线为 `v2.4.8 / 2.4.8-ch022`；B10.2 已在准确实现 SHA `dc045fbc15d6abdd48959915ec14df9e90bc4306` 上取得普通 CI Run `33253341654`、Supabase development migration Run `33279894978` 与 rollback-only smoke Run `33280068003` 三项成功证据，本地复审为 `P0=0/P1=0/P2=2`。B10.3 关单/对账与稳定游标的本地实现、验收和只读复审已完成，结论为 `P0=0/P1=0`；B10.3 远端 CI、migration、rollback-only smoke 证据仍 pending。B10 尚未标记 development `GO`，CH-021 继续有效。仅允许 Mock Provider 和脱敏 development；staging、production、真实客户数据、真实微信身份及真实资金链路继续 `NO-GO`。

## 目录

- [`docs/`](docs/)：需求调研、产品方案、技术设计、风控管理和开发管理文档。
- [`prototype/`](prototype/)：消费者小程序、一级代理工作台、总部后台的静态原型、素材、验收截图及 Figma 交付说明。

## 常用入口

- [MVP 方案](docs/01-需求调研/MVP方案.md)
- [PRD 产品需求文档](docs/02-方案设计/PRD产品需求文档.md)
- [原型设计方案](docs/02-方案设计/原型设计方案.md)
- [B3.3 功能细节拆解](docs/02-方案设计/功能细节拆解.md)
- [技术设计索引](docs/03-技术设计/README.md)
- [风险管控方案](docs/04-风控管理/风险管控方案.md)
- [B0 工程与 Supabase](docs/05-开发管理/B0-工程与Supabase.md)
- [B1 平台公共内核](docs/05-开发管理/B1-平台公共内核.md)
- [B2 总部安全入口](docs/05-开发管理/B2-总部安全入口.md)
- [B3 文件、品牌与分类](docs/05-开发管理/B3-文件品牌与分类.md)
- [B4 商品与 SKU](docs/05-开发管理/B4-商品与SKU.md)
- [B5 Banner 与库存](docs/05-开发管理/B5-Banner与库存.md)
- [B6 消费者匿名商城目录](docs/05-开发管理/B6-消费者匿名商城目录.md)
- [B7 消费者身份、会话、服务代理与隐私](docs/05-开发管理/B7-消费者身份会话与隐私.md)
- [B8 登录后购物基础](docs/05-开发管理/B8-登录后购物基础.md)
- [B9 订单、报价与库存预占](docs/05-开发管理/B9-订单报价与库存预占.md)
- [B10 支付、对账与迟到支付退款](docs/05-开发管理/B10-支付对账与迟到支付退款.md)
- [三端可点击原型](prototype/README.md)
