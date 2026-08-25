# 产品资料索引

本目录集中管理三端商城的需求、方案、技术、风控、开发文档和可点击原型。

当前交付状态：B0 至 B5 development 均已通过。B5 实现基准 SHA `d97c43958142eaa0fa5a0a9954bb21d136944ba2` 的普通 CI Run `32822780209` 与 Supabase rollback-only Run `32823898006` 为同一 SHA 双绿，CH-011 已自动失效。CH-013 已批准仅适用于 B6 脱敏 development 的单人维护门禁例外，CH-014 已将产品/API 基线升级为 v2.4.4/CH-014。B6.1 匿名 Store 公开 API 已完成本地和受控 Supabase development rollback-only 验收并暂停，B6.2 小程序/H5 工程页面尚未开始；B6.4 的真实纵向、普通 CI 与 workflow 双绿仍待完成，B6 不得提前标记最终 development `GO`。staging、production、真实客户数据、真实微信身份及真实资金链路继续 `NO-GO`，第一次进入 staging 前必须取得外部独立复核。

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
- [三端可点击原型](prototype/README.md)
