# 产品资料索引

本目录集中管理三端商城的需求、方案、技术、风控、开发文档和可点击原型。

当前交付状态：B0 至 B10 development 均已通过。B10.0 SHA `8cd5781eed9349d6f110fa43510e78c7f525a482` 和 B10.2/CH-023 SHA `dc045fbc15d6abdd48959915ec14df9e90bc4306` 的批次门禁证据继续作为历史记录保留；B10.6 最终 SHA `f5e59169b53a97704711c3aae3049e5b5d16a930` 的[普通 CI Run `33305811318`](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33305811318)与[Supabase development rollback-only smoke Run `33306877575`](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33306877575)均成功且 head SHA 相同，B10 development `GO`，CH-021 已自动失效。CH-024 已由 CCB 批准立即执行；B11.0 本地治理、契约、生成、冻结数据库与静态原型门禁已全部通过并暂停，产品/API 基线已升级为 `v2.4.9 / 2.4.9-ch024`。CH-025 尚未批准并阻断 B11.1，B11 整体不得标记 `GO`，且尚未取得 B11 最终普通 CI/Supabase smoke 同 SHA 双绿。仅允许 Mock Provider 和脱敏 development；普通售后、第三方物流、自动确认、多包裹、真实支付、staging 和 production 继续 `NO-GO`。

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
- [B11 订单履约与物流](docs/05-开发管理/B11-订单履约与物流.md)
- [三端可点击原型](prototype/README.md)
