# 产品资料索引

本目录集中管理三端商城的需求、方案、技术、风控、开发文档和可点击原型。

当前交付状态：B0 至 B11 development 均已通过。B10 历史批次与最终双绿证据继续保留；B11 最终 SHA `c8e42c44a6a31099c00070294a85f628913165df` 的[普通 CI Run `33379627199`](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33379627199)与[Supabase development rollback-only smoke Run `33385726528`](https://github.com/wuyu222dii/Frontend-ToC-Portal-Admin-Backend-Management-System-for-Private-Domain-Mall/actions/runs/33385726528)均成功且 head SHA 相同，B11 development `GO`，CH-025 已自动失效。当前产品/API 基线为 `v2.4.10 / 2.4.10-ch026`；B12.0 精确 SHA 的普通 CI、Supabase development migration 与 rollback-only smoke 三项远端门禁已闭合，CH-027 已批准且仍有效。B12.1-B12.6 本地实现与本地验收已完成，完整 `RETURN_REFUND` 真实纵向、DB/E2E/全仓及精确清理门禁均已通过；最终实现 SHA 的普通 CI 与 Supabase rollback-only 同 SHA 双绿尚未取得。B12 仍非 development `GO`。仅允许 Mock Provider 和脱敏 development；第三方物流、自动确认、多包裹、真实支付/退款、真实客户数据、staging 和 production 继续 `NO-GO`。

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
- [B12 售后验货与普通退款](docs/05-开发管理/B12-售后验货与普通退款.md)
- [三端可点击原型](prototype/README.md)
