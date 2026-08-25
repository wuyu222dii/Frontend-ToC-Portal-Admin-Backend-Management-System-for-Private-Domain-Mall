# 产品资料索引

本目录集中管理三端商城的需求、方案、技术、风控、开发文档和可点击原型。

当前交付状态：B0 至 B4 development 均已通过。B4 实现基准 SHA `0929f2435e7f5b9ad745fd9cab60b066378e502e` 的普通 CI Run `32721588213` 与 Supabase rollback-only Run `32722510890` 均成功，但不证明 B5。CH-011 已放行 B5 development 治理，CH-012 已实施并将产品/API 基线升级为 v2.4.3/CH-012；B5.0 契约、B5.1 Banner repository/API 与 B5.2 Inventory repository/API 已分别验收暂停，B5.3 尚未开始。B5 最终 SHA 的普通 CI 与 Supabase rollback-only 双绿仍留待 B5.4；staging、production、真实客户数据及真实资金链路继续 `NO-GO`，第一次进入 staging 前必须取得外部独立复核。

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
- [三端可点击原型](prototype/README.md)
