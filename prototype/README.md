# 洗化产品私域商城高保真原型

## 打开方式

- `index.html`：微信小程序可点击原型。
- `admin.html`：PC 管理后台可点击原型，演示账号 `admin`，密码 `123456`。
- `assets/`：Banner 与商品占位素材。
- `exports/`：验收截图输出目录。

两个原型均为纯静态文件，可直接用浏览器打开，不需要安装依赖或启动服务。

## 验收脚本

`verify-prototype.cjs` 使用 Playwright 和本机 Chrome 渲染全部核心画面，检查脚本错误、图片加载、横向溢出、移动端底部导航、看板图表和延期功能词，并刷新 `exports/` 中的 PNG。

本工作区可使用 Codex 内置 Node 运行：

```bash
NODE_PATH=/Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  /Users/harry/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  prototype/verify-prototype.cjs
```

## 交互范围

小程序覆盖首页、分类、搜索、商品详情、SKU 选择、购物车、确认订单、Mock 支付、订单、售后和个人中心。左侧画板导航用于快速切换页面，画布内控件可串联购买与售后流程。

管理后台覆盖登录、数据看板、商品、订单、发货、售后和客户核心运营流程。原型数据仅用于演示，不会写入数据库。

## Figma 交付

完整的画板命名、组件命名、设计令牌和页面映射见：

`docs/02-方案设计/原型设计方案.md`

当前环境没有 Figma 云端写入连接器，因此本目录中的 HTML 与 PNG 是可评审的原型交付源。后续可按设计方案在 Figma 中用 Auto Layout 和 Variables 重建。

## 范围边界

本阶段只表达 MVP。会员价、优惠券、积分、会员等级、分销、代理商、拼团、秒杀、视频、AI 客服和 Excel 导出均未纳入原型。
