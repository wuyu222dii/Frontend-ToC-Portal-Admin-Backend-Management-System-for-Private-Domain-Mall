# 洗化产品私域商城三端高保真原型

## 打开方式

- `index.html`：消费者微信小程序可点击原型。
- `admin.html`：总部管理后台可点击原型，演示账号 `admin`，密码 `123456`。
- `agent.html`：一级代理工作台响应式 Web/H5 原型，演示账号 `qingyuan.agent`，密码 `Agent@2026`。
- `assets/`：Banner 与商品占位素材。
- `exports/`：验收截图输出目录。

三个原型均为纯静态文件，可直接用浏览器打开，不需要安装依赖或启动服务。所有数据均为原型演示数据。

## 验收脚本

`verify-prototype.cjs` 使用 Playwright 和本机 Chrome 渲染三端核心画面，检查脚本错误、图片加载、横向溢出、响应式导航、看板图表和范围边界，并刷新 `exports/` 中的 PNG。

本工作区可使用 Codex 内置 Node 运行：

```bash
NODE_PATH=/Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  prototype/verify-prototype.cjs
```

## 交互范围

小程序覆盖首页、分类、搜索、商品详情、SKU 选择、购物车、确认订单、Mock 支付、订单、售后、个人中心和服务代理绑定。画布内控件可串联购买、归因确认与售后流程。

总部管理后台覆盖登录、数据看板、商品、订单、发货、售后、客户、代理管理和提现审核。一级代理工作台覆盖经营概览、推广商品、专属二维码/链接、脱敏客户、归属订单、售后进度、佣金台账、钱包提现和账户资料。

## Figma 交付

完整的画板命名、组件命名、设计令牌和页面映射见：

- `docs/02-方案设计/原型设计方案.md`
- `prototype/figma-handoff.md`
- `prototype/agent-figma-handoff.md`

当前环境没有 Figma 云端写入连接器，因此 HTML 为可点击原型源，PNG 为画板验收稿，handoff 文档提供 Figma Auto Layout、Variables、组件和画板命名规范。

## 范围边界

当前版本纳入单层一级代理的引流归因、佣金与人工提现审核。多级/二级代理、下级招募、团队佣金、代理进货、代理定价/库存/履约、自动打款、会员价、优惠券、积分、会员等级、拼团、秒杀、视频、AI 客服和 Excel 导出均不在本期原型范围。
