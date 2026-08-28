# 产品资料索引

本目录集中管理三端商城的需求、方案、技术、风控、开发文档和可点击原型。

当前交付状态：B0 至 B8 development 均已通过。B8 最终 SHA `0fc5a8d3d1f07d3b5c9fcadf7ea4ca9560a0911a` 已取得普通 CI Run `33141704459` 与 Supabase development rollback-only Run `33142971501` 同 SHA 双绿，B8 development `GO`，CH-017 已自动失效。CH-019/CH-020 已批准，当前产品/API 基线为 v2.4.7/CH-020；B9.0 已在 SHA `97d5f979e63994c4fc136217d870a726f92b3d93` 取得普通 CI Run `33151986949`、Supabase development migration Run `33153469189` 和 rollback-only smoke Run `33153691333` 三项成功证据。B9.1 已完成并经三路独立复审达到 `P0=0/P1=0`，现已暂停；B9.2-B9.5 未开始，等待用户批准 B9.2。B9 development 尚未 `GO`，CH-019 仍有效。仅允许 Mock Provider 和脱敏 development；staging、production、真实客户数据、真实微信身份及真实资金链路继续 `NO-GO`。

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
- [三端可点击原型](prototype/README.md)
