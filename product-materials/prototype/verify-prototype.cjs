const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const prototypeDir = __dirname;
const exportDir = path.join(prototypeDir, "exports");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const updateExports = process.env.UPDATE_PROTOTYPE_EXPORTS === "1";
const flowFilter = process.env.PROTOTYPE_FLOW_FILTER || "";
const quiet = process.env.PROTOTYPE_QUIET === "1";
const miniScreens = ["home", "category", "search", "product", "cart", "checkout", "payment-result", "orders", "order-detail", "logistics", "aftersale", "aftersale-detail", "favorites", "addresses", "address-edit", "account", "login", "phone-authorization", "account-deletion", "service-agent", "system-states"];
const adminViews = ["dashboard", "products", "product-edit", "brands", "categories", "banners", "inventory", "orders", "order-detail", "aftersales", "customers", "agents", "commission-rules", "withdrawals", "business-rules", "audit-logs"];
const agentViews = ["dashboard", "products", "customers", "orders", "commission", "wallet", "account"];

function adminExpectedTerms(view) {
  if (view === "dashboard") return ["代理归属销售", "活跃代理", "新增绑定", "待审核提现"];
  if (view === "commission-rules") return ["平台默认", "分类规则", "SKU", "全部一级代理"];
  if (view === "inventory") return ["实物库存", "支付预占", "售后占用", "可售"];
  if (view === "business-rules") return ["最低提现", "售后申请", "迟到支付"];
  if (view === "audit-logs") return ["审计日志", "操作人", "结果"];
  return [];
}

function agentExpectedTerms(view) {
  if (view === "products") return ["预计佣金", "SKU 覆盖", "无佣金"];
  if (view === "commission") return ["佣金", "规则来源"];
  return [];
}

const cases = [
  ...miniScreens.map((screen) => ({
    name: `miniapp-${screen}`,
    file: "index.html",
    query: { screen, device: "375", ...(screen === "aftersale-detail" ? { aftersale: "failed" } : {}) },
    viewport: { width: 1440, height: 1000 },
    kind: "mini-canvas",
    expectedTerms: screen === "system-states"
      ? ["加载中", "网络开小差", "无权访问", "数据已更新", "操作成功", "迟到支付自动退款"]
      : screen === "account"
        ? ["账户手机号", "隐私权利", "申请删除账号"]
        : screen === "phone-authorization"
          ? ["账户手机号", "独立于收货地址", "自愿授权"]
          : screen === "account-deletion"
            ? ["删除资格", "提交后的影响", "申请删除账号"]
            : screen === "order-detail"
              ? ["订单状态", "支付状态", "退款状态", "履约状态"]
              : []
  })),
  {
    name: "miniapp-mobile-375",
    file: "index.html",
    query: { screen: "home", device: "375" },
    viewport: { width: 375, height: 812 },
    kind: "mini-mobile"
  },
  ...["home", "product", "cart", "checkout", "order-detail", "account-deletion"].map((screen) => ({
    name: `miniapp-${screen}-414`,
    file: "index.html",
    query: { screen, device: "414" },
    viewport: { width: 414, height: 896 },
    kind: "mini-mobile"
  })),
  {
    name: "miniapp-service-agent-375",
    file: "index.html",
    query: { screen: "service-agent", device: "375", binding: "unbound", invite: "QX-A1038" },
    viewport: { width: 375, height: 812 },
    kind: "mini-mobile"
  },
  {
    name: "admin-login",
    file: "admin.html",
    query: {},
    viewport: { width: 1440, height: 1000 },
    kind: "admin-login"
  },
  ...adminViews.map((view) => ({
    name: `admin-${view}`,
    file: "admin.html",
    query: { autologin: "1", view },
    viewport: { width: 1440, height: 1000 },
    kind: view === "dashboard" ? "admin-dashboard" : "admin",
    expectedTerms: adminExpectedTerms(view)
  })),
  ...adminViews.map((view) => ({
    name: `admin-${view}-1024`,
    file: "admin.html",
    query: { autologin: "1", view },
    viewport: { width: 1024, height: 900 },
    kind: view === "dashboard" ? "admin-dashboard" : "admin",
    expectedTerms: adminExpectedTerms(view)
  })),
  {
    name: "agent-login",
    file: "agent.html",
    query: {},
    viewport: { width: 1440, height: 1000 },
    kind: "agent-login"
  },
  ...agentViews.map((view) => ({
    name: `agent-${view}`,
    file: "agent.html",
    query: { autologin: "1", view },
    viewport: { width: 1440, height: 1000 },
    kind: "agent",
    expectedTerms: agentExpectedTerms(view)
  })),
  {
    name: "agent-dashboard-1024",
    file: "agent.html",
    query: { autologin: "1", view: "dashboard" },
    viewport: { width: 1024, height: 900 },
    kind: "agent"
  },
  ...agentViews.map((view) => ({
    name: `agent-${view}-390`,
    file: "agent.html",
    query: { autologin: "1", view },
    viewport: { width: 390, height: 844 },
    kind: "agent-mobile",
    expectedTerms: agentExpectedTerms(view)
  }))
];

const deferredTerms = [
  "会员价",
  "会员等级",
  "优惠券",
  "积分余额",
  "新客首单",
  "导出",
  "导出数据",
  "导出商品",
  "导出订单",
  "导出入口",
  "导出预留",
  "二级分类",
  "批量打标签"
];

const forbiddenPrototypeTerms = ["二级代理", "下级代理", "团队代理", "团佣金", "自动打款", "微信零钱提现", "商城所有者", "operator", "当前佣金比例"];

function inspectSensitiveSources() {
  const failures = [];
  const files = ["index.html", "app.js", "admin.html", "admin.js", "agent.html", "agent.js"];
  const fixedSecrets = ["demo-pass", "826413", "Agent@2026", "密码 123456", "演示正确值", "secureBankCard"];
  for (const file of files) {
    const source = fs.readFileSync(path.join(prototypeDir, file), "utf8");
    const exposed = fixedSecrets.filter((term) => source.includes(term));
    if (exposed.length) failures.push(`${file} 含固定敏感字面: ${exposed.join(", ")}`);
    if (/<input[^>]*type=["']password["'][^>]*\svalue=["'][^"']+["']/i.test(source) || /<input[^>]*\svalue=["'][^"']+["'][^>]*type=["']password["']/i.test(source)) failures.push(`${file} 密码输入框存在预填值`);
    if (/\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4,7}\b/.test(source)) failures.push(`${file} 含未掩码的格式化银行卡号`);
    if (/(?:银行卡号|bank(?:card)?(?:number|card)?)[^\n]{0,100}["'`]\d{12,19}["'`]/i.test(source)) failures.push(`${file} 含银行卡语境下的完整数字字面`);
    if (["admin.html", "admin.js"].includes(file) && /(买家留言|订单备注|detail\.message|override\.message)/.test(source)) failures.push(`${file} 仍含当前 MVP 禁用的消费者订单留言实现`);
  }
  return failures;
}

function buildUrl(testCase) {
  const url = new URL(pathToFileURL(path.join(prototypeDir, testCase.file)));
  Object.entries(testCase.query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}

async function inspectPage(page, testCase) {
  const result = await page.evaluate(({ kind, viewport, deferredTerms, forbiddenPrototypeTerms, expectedTerms }) => {
    const bodyText = document.body.innerText;
    const brokenImages = [...document.images]
      .filter((image) => getComputedStyle(image).display !== "none" && !image.hidden && image.complete && image.naturalWidth === 0)
      .map((image) => image.getAttribute("src"));
    const html = document.documentElement;
    const overflow = Math.max(html.scrollWidth, document.body.scrollWidth) - html.clientWidth;
    const exposedTerms = deferredTerms.filter((term) => bodyText.includes(term));
    const exposedForbiddenTerms = forbiddenPrototypeTerms.filter((term) => bodyText.includes(term));
    const checks = {
      nonBlank: bodyText.trim().length > 120,
      brokenImages,
      overflow,
      exposedTerms,
      exposedForbiddenTerms,
      missingExpectedTerms: expectedTerms.filter((term) => !bodyText.includes(term)),
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };

    if (kind === "mini-mobile") {
      const phone = document.querySelector(".phone-viewport").getBoundingClientRect();
      const tabButtons = [...document.querySelectorAll(".tabbar button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
      checks.mobileFrameWidth = Math.round(phone.width);
      checks.mobileTabFits = tabButtons.every((rect) => rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width >= 44);
    }

    if (kind === "admin-dashboard") {
      const canvas = document.querySelector("#salesChart");
      const context = canvas?.getContext("2d");
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data || [];
      checks.chartHasPixels = [...pixels].some((value, index) => index % 4 === 3 && value > 0);
    }

    if (["agent", "agent-mobile", "admin", "admin-dashboard"].includes(kind)) {
      checks.fullPhoneNumbers = bodyText.match(/(?:^|\D)1[3-9]\d{9}(?:\D|$)/g) || [];
      checks.unmaskedBankCards = bodyText.match(/(?:^|\D)\d{16,19}(?:\D|$)/g) || [];
    }

    if (kind === "agent-mobile") {
      const mobileButtons = [...document.querySelectorAll(".mobile-nav button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      });
      checks.agentMobileNavFits = mobileButtons.length === 5 && mobileButtons.every((rect) => (
        rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width >= 44 && rect.height >= 44
      ));
    }

    return checks;
  }, {
    kind: testCase.kind,
    viewport: testCase.viewport,
    deferredTerms,
    forbiddenPrototypeTerms,
    expectedTerms: testCase.expectedTerms || []
  });

  const failures = [];
  if (!result.nonBlank) failures.push("页面内容为空");
  if (result.brokenImages.length) failures.push(`图片加载失败: ${result.brokenImages.join(", ")}`);
  if (result.overflow > 1) failures.push(`页面横向溢出 ${result.overflow}px`);
  if (result.exposedTerms.length) failures.push(`延期功能词露出: ${result.exposedTerms.join(", ")}`);
  if (result.exposedForbiddenTerms.length) failures.push(`超出单层代理范围: ${result.exposedForbiddenTerms.join(", ")}`);
  if (result.missingExpectedTerms.length) failures.push(`缺少关键内容: ${result.missingExpectedTerms.join(", ")}`);
  if (result.viewport.width !== testCase.viewport.width || result.viewport.height !== testCase.viewport.height) {
    failures.push(`视口不一致: ${result.viewport.width}x${result.viewport.height}`);
  }
  if (testCase.kind === "mini-mobile" && result.mobileFrameWidth !== testCase.viewport.width) {
    failures.push(`小程序画面宽度 ${result.mobileFrameWidth}px，预期 ${testCase.viewport.width}px`);
  }
  if (testCase.kind === "mini-mobile" && !result.mobileTabFits) failures.push("移动端底部导航超出视口或点击区域过窄");
  if (testCase.kind === "admin-dashboard" && !result.chartHasPixels) failures.push("销售趋势画布为空");
  if (["agent", "agent-mobile", "admin", "admin-dashboard"].includes(testCase.kind) && result.fullPhoneNumbers.length) {
    failures.push(`运营端暴露完整手机号: ${result.fullPhoneNumbers.join(", ")}`);
  }
  if (["agent", "agent-mobile", "admin", "admin-dashboard"].includes(testCase.kind) && result.unmaskedBankCards.length) {
    failures.push("运营端暴露完整银行卡号");
  }
  if (testCase.kind === "agent-mobile" && !result.agentMobileNavFits) failures.push("代理端移动导航超出视口或点击区过窄");
  return failures;
}

function miniUrl(query = {}) {
  return buildUrl({ file: "index.html", query });
}

async function runSurfaceContractChecks(browser) {
  const failures = [];
  if (miniScreens.length !== 21 || new Set(miniScreens).size !== 21) failures.push(`小程序页面契约应为 21，当前 ${new Set(miniScreens).size}`);
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminPage = await adminContext.newPage();
  await adminPage.goto(buildUrl({ file: "admin.html", query: { autologin: "1" } }), { waitUntil: "load" });
  const adminSurfaces = await adminPage.evaluate(() => document.querySelectorAll(".page-view").length + ["loginView", "shippingModal", "aftersaleModal", "agentDrawer", "customerDrawer", "bankVerifyModal"].filter((id) => document.getElementById(id)).length);
  if (adminSurfaces !== 22) failures.push(`总部端页面/关键视图契约应为 22，当前 ${adminSurfaces}`);
  await adminContext.close();

  const agentContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const agentPage = await agentContext.newPage();
  await agentPage.goto(buildUrl({ file: "agent.html", query: { autologin: "1" } }), { waitUntil: "load" });
  const agentSurfaces = await agentPage.evaluate(() => document.querySelectorAll(".page-view").length + ["loginView", "shareModal"].filter((id) => document.getElementById(id)).length);
  if (agentSurfaces !== 9) failures.push(`代理端页面/关键视图契约应为 9，当前 ${agentSurfaces}`);
  await agentContext.close();
  if (!failures.length && !quiet) console.log("PASS surface-contracts 21 MP / 9 AGT / 22 ADM");
  return failures;
}

async function runMiniInteractionChecks(browser) {
  const failures = [];

  async function run(name, callback) {
    if (flowFilter && !name.includes(flowFilter)) return;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await callback(page);
      if (pageErrors.length) throw new Error(pageErrors.join("；"));
      if (!quiet) console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  const expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  await run("mini-interaction-sku-checkout", async (page) => {
    await page.goto(miniUrl({ screen: "product", device: "375" }), { waitUntil: "load" });
    await page.click('[data-sku-intent="buy"]');
    await page.click('[data-sku-id="SKU-SER-60"]');
    await page.click('[data-action="confirm-sku"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "checkout");
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.buyNowLine?.skuId === "SKU-SER-60", "立即购买未保留所选 SKU ID");
    expect(snapshot.buyNowLine?.quantity === 1, "立即购买数量快照错误");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.includes("30ml × 2 / 双瓶装"), "结算页未展示所选双瓶 SKU");
    expect(bodyText.includes("¥298"), "结算页未使用双瓶 SKU 成交价");
  });

  await run("mini-interaction-pending-payment", async (page) => {
    await page.goto(miniUrl({ screen: "checkout", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="submit-order"]');
    const created = await page.evaluate(() => {
      const state = window.__MINIAPP_PROTOTYPE__.getState();
      return state.orders.find((order) => order.id === state.activePaymentOrderId);
    });
    expect(created?.orderStatus === "PENDING_PAYMENT", "提交订单未先创建 PENDING_PAYMENT 订单");
    expect(created?.paymentStatus === "PROCESSING", "支付意图创建后订单支付状态不是 PROCESSING");
    expect(created?.payExpiresAt, "新订单缺少 pay_expires_at 演示值");
    expect(created?.items.every((item) => item.skuId && item.skuName && Number.isFinite(item.unitPrice)), "订单项 SKU/规格/成交价快照不完整");
    await page.click('[data-payment-outcome="later"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "order-detail");
    const afterLater = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const pending = afterLater.orders.find((order) => order.id === afterLater.currentOrderId);
    expect(pending?.displayStatus === "待付款", "稍后支付没有保留待付款订单");
    expect((await page.locator("body").innerText()).includes("继续支付"), "订单详情缺少继续支付入口");
  });

  await run("mini-interaction-payment-retry", async (page) => {
    await page.goto(miniUrl({ screen: "checkout", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="submit-order"]');
    await page.click('[data-payment-outcome="failed"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "payment-result");
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    let order = snapshot.orders.find((item) => item.id === snapshot.currentOrderId);
    expect(order?.paymentStatus === "UNPAID" && order?.latestPaymentAttemptStatus === "FAILED" && order?.displayStatus === "待付款", "支付失败后未回到可重试的 UNPAID 状态");
    await page.click('[data-action="retry-payment"]');
    await page.click('[data-payment-outcome="success"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().paymentResult?.outcome === "success");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    order = snapshot.orders.find((item) => item.id === snapshot.currentOrderId);
    expect(order?.paymentStatus === "PAID", "重试支付成功后未标记 PAID");
    expect(order?.orderStatus === "PENDING_SHIPMENT" && order?.displayStatus === "待发货" && order?.fulfillmentStatus === "READY_TO_SHIP", "支付成功后订单或履约状态错误");
  });

  await run("mini-interaction-timeout-late-refund-failure", async (page) => {
    await page.goto(miniUrl({ screen: "checkout", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="submit-order"]');
    await page.click('[data-payment-outcome="later"]');
    await page.click('[data-action="simulate-payment-timeout"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().paymentResult?.outcome === "timeout");
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    let order = snapshot.orders.find((item) => item.id === snapshot.currentOrderId);
    expect(order?.orderStatus === "CLOSED" && order?.closeReason === "PAYMENT_TIMEOUT" && order?.inventoryReservation?.status === "RELEASED", "支付超时未关闭订单并释放库存预占");
    await page.click('[data-action="simulate-late-payment"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().paymentResult?.outcome === "late_refund");
    await page.click('[data-action="fail-late-refund"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    order = snapshot.orders.find((item) => item.id === snapshot.currentOrderId);
    expect(order?.orderStatus === "CLOSED" && order?.paymentStatus === "PAID" && order?.refundStatus === "FAILED" && order?.latePaymentRefund?.status === "MANUAL_REVIEW", "迟到支付退款失败未保持关单并转人工财务异常");
  });

  await run("mini-interaction-timeout-late-refund-success", async (page) => {
    await page.goto(miniUrl({ screen: "checkout", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="submit-order"]');
    await page.click('[data-payment-outcome="later"]');
    await page.click('[data-action="simulate-payment-timeout"]');
    await page.click('[data-action="simulate-late-payment"]');
    await page.click('[data-action="complete-late-refund"]');
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const order = snapshot.orders.find((item) => item.id === snapshot.currentOrderId);
    expect(order?.orderStatus === "CLOSED" && order?.refundStatus === "FULL" && order?.latePaymentRefund?.status === "COMPLETED", "迟到支付自动退款成功后错误恢复订单或未完成退款");
  });

  await run("mini-interaction-category-search-detail", async (page) => {
    await page.goto(miniUrl({ screen: "category", device: "375" }), { waitUntil: "load" });
    await page.click('[data-category-switch="香水"]');
    expect(await page.locator(".category-empty").isVisible(), "无商品分类未展示真实空态");
    expect(await page.locator(".category-content .product-card").count() === 0, "无商品分类错误展示跨类商品");
    await page.click('[data-category-switch="护肤品"]');
    await page.click('[data-filter="价格"]');
    const order = await page.locator(".category-content [data-open-product]").evaluateAll((nodes) => nodes.map((node) => node.dataset.openProduct));
    expect(order.join(",") === "cleanser,serum", "分类价格排序未按实际商品价格生效");
    await page.click('[data-category-switch="洗发水"]');
    await page.click('.category-content [data-open-product="shampoo"]');
    await page.click('[data-detail-tab="成分"]');
    const ingredientDetail = await page.locator(".detail-content").innerText();
    await page.click('[data-detail-tab="使用方法"]');
    const usageDetail = await page.locator(".detail-content").innerText();
    expect(ingredientDetail.includes("迷迭香叶提取物") && usageDetail.includes("重点清洁头皮"), "商品成分或用法未按当前商品动态绑定");
  });

  await run("mini-interaction-cart-invalid-and-note-boundary", async (page) => {
    await page.goto(miniUrl({ screen: "cart", device: "375" }), { waitUntil: "load" });
    expect((await page.locator(".cart-card.is-invalid").innerText()).includes("不计入结算"), "失效 SKU 未标记为不可结算");
    await page.click('[data-action="checkout"]');
    const checkoutText = await page.locator("body").innerText();
    expect(!checkoutText.includes("轻透防晒乳"), "失效 SKU 被带入结算页");
    expect(!checkoutText.includes("订单备注"), "MVP 不支持的订单备注仍在结算页露出");
  });

  await run("mini-interaction-active-public-catalog", async (page) => {
    await page.goto(miniUrl({ screen: "home", device: "375" }), { waitUntil: "load" });
    expect(await page.locator('[data-open-product="sunscreen"]').count() === 0, "INACTIVE 防晒商品仍在首页公开目录出现");
    await page.click('[data-category="防晒产品"]');
    expect(await page.locator(".category-empty").isVisible() && await page.locator('[data-open-product="sunscreen"]').count() === 0, "INACTIVE 商品仍在分类可发现");
    await page.click('.category-page [data-screen="search"]');
    await page.fill("#searchInput", "防晒");
    await page.locator("#searchForm").evaluate((form) => form.requestSubmit());
    expect(await page.locator('[data-open-product="sunscreen"]').count() === 0 && (await page.locator("body").innerText()).includes("没有找到"), "INACTIVE 商品仍可被搜索");
    const blocked = await page.evaluate(() => {
      const probe = document.createElement("button");
      probe.dataset.openProduct = "sunscreen";
      document.body.appendChild(probe);
      probe.click();
      probe.remove();
      return { screen: window.__MINIAPP_PROTOTYPE__.getState().screen, toast: document.querySelector("#toast")?.textContent || "" };
    });
    expect(blocked.screen !== "product" && blocked.toast.includes("已下架"), "INACTIVE 商品仍可通过直接详情动作打开");
    await page.goto(miniUrl({ screen: "cart", device: "375" }), { waitUntil: "load" });
    expect(await page.locator('[data-cart-sku="SKU-SUN-50"].is-invalid').count() === 1 && (await page.locator('[data-cart-sku="SKU-SUN-50"]').innerText()).includes("商品已下架"), "同一 INACTIVE SKU 未在购物车保留失效提示");
  });

  await run("mini-interaction-aftersale-inputs", async (page) => {
    await page.goto(miniUrl({ screen: "aftersale", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="sale-type"]');
    await page.click('[data-aftersale-type-option="退货退款"]');
    await page.waitForTimeout(220);
    await page.click('[data-action="sale-reason"]');
    await page.click('[data-aftersale-reason-option="包装破损"]');
    await page.waitForTimeout(220);
    await page.fill("#aftersaleDescription", "外包装破损，申请退货退款");
    await page.click('[data-action="upload"]');
    await page.click('[data-action="submit-aftersale"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "aftersale-detail");
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const record = snapshot.aftersales.find((item) => item.id === snapshot.currentAfterSaleId);
    expect(record?.type === "退货退款" && record?.reason === "包装破损" && record?.description && record?.evidenceCount === 1, "售后类型、原因、描述或凭证未保存到申请记录");
  });

  await run("mini-interaction-login-consent-return", async (page) => {
    await page.goto(miniUrl({ screen: "home", device: "375", auth: "guest" }), { waitUntil: "load" });
    await page.click('[data-open-product="shampoo"]');
    await page.click('[data-action="favorite"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "login");
    await page.click('[data-action="mock-login"]');
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === false && snapshot.screen === "login", "未勾选协议仍完成了登录");
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "product");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === true, "勾选协议后未完成登录");
    expect(snapshot.favoriteProductIds.includes("shampoo"), "登录后未恢复收藏原操作");
  });

  await run("mini-interaction-binding-ttl", async (page) => {
    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", binding: "unbound", invite: "QX-A1026" }), { waitUntil: "load" });
    const loginText = await page.locator("body").innerText();
    expect(loginText.includes("候选剩余") && loginText.includes("清悦日用馆"), "登录页未展示代理候选 TTL 与代理名称");
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForSelector('.bottom-sheet.is-visible [data-action="confirm-agent-binding"]');
    expect((await page.locator(".bottom-sheet").innerText()).includes("候选剩余"), "绑定确认层缺少候选剩余时间");
    await page.click('[data-action="confirm-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().agentBindingStatus === "bound");
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.serviceAgent.id === "AGT-01026" && snapshot.inviteCandidate === null, "确认绑定后代理或候选清理错误");
  });

  await run("mini-interaction-aftersale-reservation", async (page) => {
    await page.goto(miniUrl({ screen: "aftersale", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="submit-aftersale"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "aftersale-detail");
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const record = snapshot.aftersales.find((item) => item.id === snapshot.currentAfterSaleId);
    const order = snapshot.orders.find((item) => item.id === record.orderId);
    const line = order.items.find((item) => item.id === record.orderItemId);
    expect(record.status === "PENDING_REVIEW" && record.reservedAmount === 79, "售后申请未按成交价占用退款金额");
    expect(line.reservedQty === 1, "售后申请未立即占用可退数量");
    await page.click('[data-action="cancel-aftersale"]');
    await page.click('[data-action="confirm-cancel-aftersale"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().aftersales[0].status === "CANCELLED");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const cancelled = snapshot.aftersales.find((item) => item.id === snapshot.currentAfterSaleId);
    const cancelledOrder = snapshot.orders.find((item) => item.id === cancelled.orderId);
    expect(cancelledOrder.items.find((item) => item.id === cancelled.orderItemId).reservedQty === 0, "取消售后后未释放数量占用");
  });

  await run("mini-interaction-address-phone-isolation", async (page) => {
    await page.goto(miniUrl({ screen: "addresses", device: "375" }), { waitUntil: "load" });
    const listText = await page.locator(".address-list").innerText();
    expect(listText.includes("林*") && listText.includes("文三路 ****"), "地址列表未展示服务端掩码投影");
    expect(!listText.includes("林青") && !listText.includes("文三路 88 号 2 幢 1102 室") && !listText.includes("衡山路 26 号 6 楼"), "地址列表泄露完整收件人或门牌地址");
    await page.click('[data-address-edit="ADDR-001"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "address-edit");
    expect(await page.inputValue('input[name="recipient"]') === "林青", "本人地址编辑页未加载完整收件人");
    expect(await page.inputValue('input[name="phone"]') === "13852185218", "本人地址编辑页未加载完整手机号");
    expect(await page.inputValue('textarea[name="detail"]') === "文三路 88 号 2 幢 1102 室", "本人地址编辑页未加载完整门牌地址");
    await page.fill('input[name="phone"]', "13900001234");
    await page.click('#addressForm button[type="submit"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "addresses");
    expect(!(await page.locator(".address-list").innerText()).includes("13900001234"), "地址保存后列表泄露完整手机号");
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone === null, "修改收货地址手机号错误写入账户手机号");
    expect(snapshot.addresses.some((address) => address.phone === "13900001234"), "地址手机号未保存");
  });

  await run("mini-interaction-phone-privacy", async (page) => {
    await page.goto(miniUrl({ screen: "phone-authorization", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="authorize-phone"]');
    await page.click('[data-action="confirm-phone"]');
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone?.source === "WECHAT_GET_PHONE_NUMBER", "手机号授权未保存验证来源");
    expect(snapshot.verifiedPhone?.verifiedAt && snapshot.verifiedPhone?.consentVersion, "手机号授权缺少验证时间或协议版本");

    await page.goto(miniUrl({ screen: "account-deletion", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="request-deletion"]');
    expect((await page.locator(".bottom-sheet").innerText()).includes("暂不受理"), "存在未完成业务时未阻止账号删除");
    await page.click('[data-action="simulate-deletion-eligible"]');
    await page.waitForSelector(".bottom-sheet", { state: "hidden" });
    await page.click('[data-action="request-deletion"]');
    await page.click('[data-action="confirm-account-deletion"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.deletionRequested === true, "资格通过后二次确认未提交账号删除申请");
  });

  return failures;
}

async function runOpsInteractionChecks(browser) {
  const failures = [];

  async function operationSnapshot(page, aftersaleId) {
    return page.evaluate((id) => {
      const prototypeState = window.__ADMIN_PROTOTYPE__?.getState();
      const aftersale = prototypeState?.aftersales?.find((item) => item.id === id);
      const row = document.querySelector(`[data-aftersale-id="${id}"]`);
      const highRiskModal = document.querySelector("#highRiskModal");
      const highRiskButton = document.querySelector("#confirmHighRisk");
      return {
        aftersaleStatusCode: aftersale?.statusCode || "MISSING",
        activeAftersaleId: prototypeState?.state?.activeAftersaleId || null,
        aftersaleSubmitting: prototypeState?.state?.aftersaleSubmitting,
        rowVisible: Boolean(row),
        rowStatusCode: row?.dataset.statusCode || null,
        rowStatus: row?.querySelector("td:nth-child(7)")?.textContent?.trim() || null,
        aftersaleBusy: document.querySelector("#appShell")?.dataset.aftersaleBusy,
        highRiskModalVisible: Boolean(highRiskModal && !highRiskModal.hidden),
        highRiskButtonDisabled: Boolean(highRiskButton?.disabled)
      };
    }, aftersaleId);
  }

  async function waitForAftersaleState(page, aftersaleId, statusCode, stage, requireIdle = false) {
    try {
      await page.waitForFunction(({ id, expected, idle }) => {
        const prototypeState = window.__ADMIN_PROTOTYPE__?.getState();
        const aftersale = prototypeState?.aftersales?.find((item) => item.id === id);
        const row = document.querySelector(`[data-aftersale-id="${id}"]`);
        return aftersale?.statusCode === expected
          && Boolean(row)
          && row.dataset.statusCode === expected
          && (!idle || (prototypeState.state.aftersaleSubmitting === false && document.querySelector("#appShell")?.dataset.aftersaleBusy === "false"));
      }, { id: aftersaleId, expected: statusCode, idle: requireIdle });
    } catch (error) {
      const snapshot = await operationSnapshot(page, aftersaleId);
      throw new Error(`${stage}: 等待 ${aftersaleId} -> ${statusCode}${requireIdle ? " 且操作空闲" : ""} 超时；观测=${JSON.stringify(snapshot)}；原始=${error.message}`);
    }
  }

  async function waitForHighRiskIdle(page, stage, aftersaleId = null) {
    try {
      await page.waitForFunction(() => {
        const button = document.querySelector("#confirmHighRisk");
        return button && !button.disabled;
      });
    } catch (error) {
      const snapshot = await operationSnapshot(page, aftersaleId);
      throw new Error(`${stage}: 高风险防重入未恢复；观测=${JSON.stringify(snapshot)}；原始=${error.message}`);
    }
  }

  async function waitForInspectionBalance(page, expectedText, stage) {
    try {
      await page.waitForFunction((expected) => document.querySelector("#inspectionBalance")?.textContent?.includes(expected), expectedText);
      return;
    } catch (error) {
      // The snapshot below makes input/event ordering failures actionable.
    }
    const snapshot = await page.evaluate(() => ({
      receivedQty: document.querySelector("#inspectionReceivedQty")?.value,
      approvedRefundQty: document.querySelector("#inspectionApprovedQty")?.value,
      restockQty: document.querySelector("#inspectionRestockQty")?.value,
      damagedQty: document.querySelector("#inspectionDamagedQty")?.value,
      scrapQty: document.querySelector("#inspectionScrapQty")?.value,
      returnToCustomerQty: document.querySelector("#inspectionReturnQty")?.value,
      balance: document.querySelector("#inspectionBalance")?.textContent?.trim()
    }));
    throw new Error(`${stage}: 验货数量平衡未包含“${expectedText}”；观测=${JSON.stringify(snapshot)}`);
  }

  async function waitForToast(page, expectedText, stage) {
    try {
      await page.waitForFunction((expected) => {
        const toast = document.querySelector("#toast");
        return toast?.classList.contains("show") && toast.textContent.includes(expected);
      }, expectedText);
    } catch (error) {
      const snapshot = await page.evaluate(() => ({
        toast: document.querySelector("#toast")?.textContent?.trim(),
        toastVisible: document.querySelector("#toast")?.classList.contains("show"),
        highRiskModalVisible: !document.querySelector("#highRiskModal")?.hidden
      }));
      throw new Error(`${stage}: 未出现包含“${expectedText}”的反馈；观测=${JSON.stringify(snapshot)}`);
    }
  }

  async function captureFlow(page, name) {
    if (updateExports) await page.screenshot({ path: path.join(exportDir, `${name}.png`), fullPage: false });
  }

  async function run(name, file, callback) {
    if (flowFilter && !name.includes(flowFilter)) return;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(buildUrl({ file, query: { autologin: "1" } }), { waitUntil: "load" });
      await callback(page);
      if (pageErrors.length) throw new Error(pageErrors.join("；"));
      if (!quiet) console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  const expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  await run("admin-interaction-dynamic-order", "admin.html", async (page) => {
    expect(await page.locator('[data-dashboard-metric="agent-sales"], [data-dashboard-metric="active-agents"], [data-dashboard-metric="new-bindings"], [data-dashboard-metric="pending-withdrawals"]').count() === 4, "ADM-02 缺少四项代理经营指标");
    await page.click('[data-report-range="month"]');
    expect(await page.locator("#dashboardMonthInput").isVisible() && await page.locator("#dashboardDayInput").isHidden(), "月报未切换为可操作月份筛选");
    await page.fill("#dashboardMonthInput", "2026-07");
    await page.click("#dashboardReportQuery");
    expect(await page.locator("#dashboardReportState").isVisible() && (await page.locator("#dashboardReportState").innerText()).includes("报表加载中"), "月报查询未展示 Loading 状态");
    await page.waitForSelector("#dashboardReportData", { state: "visible" });
    expect((await page.locator("#dashboardReportCaption").innerText()).includes("2026-07-01") && (await page.inputValue("#dashboardMonthInput")) === "2026-07", "月报日期筛选未写回报表标题");

    await page.click('[data-report-range="day"]');
    await page.fill("#dashboardDayInput", "2026-08-11");
    await page.click("#dashboardReportQuery");
    await page.waitForFunction(() => document.querySelector("#dashboardReportState")?.innerText.includes("暂无报表数据"));
    expect(await page.locator("#dashboardReportData").isHidden(), "报表空态仍展示旧指标数据");
    await page.fill("#dashboardDayInput", "2026-08-09");
    await page.click("#dashboardReportQuery");
    await page.waitForFunction(() => document.querySelector("#dashboardReportState")?.innerText.includes("报表加载失败"));
    expect((await page.inputValue("#dashboardDayInput")) === "2026-08-09" && await page.locator('[data-report-range="day"]').getAttribute("class") === "active", "网络错误后未保留日期或日报筛选");
    await page.click("#dashboardReportRetry");
    expect((await page.locator("#dashboardReportState").innerText()).includes("报表加载中"), "Retry 未重新进入 Loading 状态");
    await page.waitForSelector("#dashboardReportData", { state: "visible" });
    expect((await page.inputValue("#dashboardDayInput")) === "2026-08-09" && (await page.locator("#dashboardReportCaption").innerText()).includes("2026-08-09"), "Retry 成功后未保留筛选条件");

    await page.click('[data-dashboard-metric="pending-withdrawals"]');
    expect(await page.locator('[data-view="withdrawals"]').getAttribute("class").then((value) => value.includes("active")) && (await page.inputValue("#withdrawalStatus")) === "待审核", "待审核提现指标未跳转并携带筛选");
    await page.click('[data-page="dashboard"]');
    await page.click('[data-dashboard-metric="active-agents"]');
    expect(await page.locator('[data-view="agents"]').getAttribute("class").then((value) => value.includes("active")) && (await page.inputValue("#agentStatus")) === "本期活跃", "活跃代理指标未跳转并携带区间活跃筛选");
    await page.click('[data-page="business-rules"]');
    expect((await page.locator("#paymentRuleVersion").innerText()).includes("固定策略") && await page.locator('.edit-business-rule[data-rule-key="PAYMENT_EXPIRY_MINUTES"]').count() === 0, "支付超时仍可配置或未标记固定 30 分钟");

    await page.click('[data-page="orders"]');
    await page.click('#orderRows tr[data-order-id="QY202608060027"] .view-order');
    expect((await page.locator("#detailOrderNumber").innerText()).includes("QY202608060027"), "订单详情未绑定选中的退款订单");
    const refundedText = await page.locator("[data-view=\"order-detail\"]").innerText();
    expect(refundedText.includes("FULL") && refundedText.includes("DELIVERED") && refundedText.includes("REFUND_DEBIT"), "退款订单的四轴状态或佣金冲正快照缺失");
    expect(await page.locator("#openShipModal").isHidden(), "不可发货订单仍显示发货入口");

    await page.click('[data-view="order-detail"] [data-go="orders"]');
    await page.click('#orderRows tr[data-order-id="QY202608060028"] .view-order');
    const shippableText = await page.locator("[data-view=\"order-detail\"]").innerText();
    expect(shippableText.includes("PENDING_SHIPMENT") && shippableText.includes("READY_TO_SHIP"), "待发货订单的订单/履约状态未动态绑定");
    expect(!shippableText.includes("买家留言") && shippableText.includes("内部备注"), "订单详情未移除消费者留言或未明确内部备注");
    expect((await page.locator('[data-view="order-detail"] .detail-actions').innerText()).includes("内部备注"), "订单备注动作未明确为内部备注");
    expect(await page.locator("#openShipModal").isVisible(), "待发货订单缺少发货入口");
  });

  await run("admin-interaction-immutable-payment-snapshot", "admin.html", async (page) => {
    await page.click('[data-page="orders"]');
    await page.fill("#orderSearch", "QY202608060025");
    await page.locator("#orderRows .view-order").first().click();
    const before = await page.locator("#detailOrderProducts .commission-snapshot").innerText();
    await page.click('[data-page="commission-rules"]');
    await page.click('tr[data-category-id="CAT-SKIN"] .edit-category-rule');
    await page.fill("#ruleRateInput", "1");
    await page.fill("#ruleChangeReason", "自动化验收：现行分类比例调整");
    await page.check("#ruleChangeConfirm");
    await page.click("#saveCommissionRule");
    await page.waitForSelector("#commissionRuleModal", { state: "hidden" });
    await page.click('[data-page="orders"]');
    await page.fill("#orderSearch", "QY202608060025");
    await page.locator("#orderRows .view-order").first().click();
    const after = await page.locator("#detailOrderProducts .commission-snapshot").innerText();
    expect(before === after && after.includes("10.00%") && after.includes("¥10.90"), "历史订单佣金随当前规则变化发生回算");
  });

  await run("admin-interaction-catalog-crud", "admin.html", async (page) => {
    await page.click('[data-page="products"]');
    await page.click('tr[data-product-id="2"] .edit-product');
    expect((await page.inputValue("#productNameInput")).includes("沐光"), "商品编辑未绑定当前选中记录");
    await page.fill("#productNameInput", "沐光动态绑定洗发水");
    await page.click("#publishProduct");
    await page.waitForFunction(() => document.querySelector('[data-view="products"]').classList.contains('active'));
    expect((await page.locator('tr[data-product-id="2"] .product-cell-copy strong').innerText()).includes("动态绑定"), "商品编辑保存未写回当前记录");

    await page.click('tr[data-product-id="8"] .delete-product');
    await page.fill("#deleteProductReason", "停止维护该草稿商品");
    await page.check("#deleteProductConfirm");
    await page.click("#confirmDelete");
    expect((await page.locator('tr[data-product-id="8"] .tag').innerText()) === "已归档", "商品删除未采用软归档");

    await page.click('[data-page="brands"]');
    await page.click("#openCreateBrand");
    await page.fill("#entityCode", "BR-AUTO"); await page.fill("#entityName", "自动化品牌"); await page.fill("#entityDetail", "品牌故事与视觉档案");
    await page.click("#saveEntity");
    await page.fill("#brandSearch", "BR-AUTO");
    expect(await page.locator('tr[data-brand-id="BR-AUTO"]').count() === 1, "品牌新增未写回列表");

    await page.click('[data-page="banners"]');
    await page.click("#openCreateBanner");
    await page.fill("#entityCode", "BN-AUTO"); await page.fill("#entityName", "自动化 Banner"); await page.fill("#entityDetail", "CAT-SKIN");
    await page.click("#saveEntity");
    expect(await page.locator('[data-banner-id="BN-AUTO"]').count() === 1, "Banner 新增或日期校验未生效");

    await page.click('[data-page="inventory"]');
    await page.click('tr[data-inventory-id="CLEAN-120"] .inventory-adjust');
    await page.fill("#newStock", "287"); await page.fill("#stockWarning", "31"); await page.selectOption("#stockReason", { label: "盘点修正" }); await page.fill("#stockNote", "自动化库存调整");
    await page.click("#confirmStock");
    expect((await page.locator('tr[data-inventory-id="CLEAN-120"] td').nth(1).innerText()) === "287", "SKU 库存调整未写回");
    await page.click('tr[data-inventory-id="CLEAN-120"] .inventory-flow');
    expect((await page.locator("#stockLedger").innerText()).includes("自动化库存调整"), "库存流水未记录调整原因");

    await page.locator("#stockModal .modal-heading .modal-close").click();
    await page.click('[data-page="business-rules"]');
    await page.click('.edit-business-rule[data-rule-key="MIN_WITHDRAWAL"]');
    await page.fill("#businessRuleValue", "120"); await page.fill("#businessRuleReason", "自动化规则版本验收"); await page.check("#businessRuleConfirm");
    await page.click("#saveBusinessRule");
    expect((await page.locator("#minimumWithdrawalValue").innerText()) === "120" && (await page.locator("#withdrawalRuleVersion").innerText()).includes("04"), "业务规则未生成新版本");
  });

  await run("admin-interaction-product-inventory-drilldown", "admin.html", async (page) => {
    await page.click('[data-page="products"]');
    const summary = await page.locator('tr[data-product-id="1"] .product-inventory-summary').innerText();
    expect(["3 SKU", "实物 424", "锁定 13", "可售 411"].every((term) => summary.includes(term)), "SPU 列表未从 SKU 台账汇总规格数/实物/锁定/可售");
    await page.click('tr[data-product-id="1"] .product-inventory-summary');
    expect(await page.locator("#stockSkuSelect option").count() === 3 && (await page.inputValue("#stockSkuSelect")) === "CLEAN-120", "商品库存下钻未选中当前 SPU 首个 SKU");
    await captureFlow(page, "admin-product-stock-drilldown");
    const firstBefore = Number(await page.inputValue("#newStock"));
    await page.selectOption("#stockSkuSelect", "CLEAN-120X2");
    expect((await page.inputValue("#newStock")) === "96" && (await page.locator("#stockProductName").innerText()).includes("CLEAN-120X2"), "切换 SKU 后表单未绑定所选记录");
    await page.fill("#newStock", "99"); await page.fill("#stockWarning", "22"); await page.selectOption("#stockReason", { label: "盘点修正" }); await page.fill("#stockNote", "下钻选中 SKU 验收");
    await page.click("#confirmStock");
    await page.click('[data-page="inventory"]');
    expect((await page.locator('tr[data-inventory-id="CLEAN-120X2"] td').nth(1).innerText()) === "99", "库存保存未命中所选 SKU");
    expect((await page.locator('tr[data-inventory-id="CLEAN-120"] td').nth(1).innerText()) === String(firstBefore), "库存保存误改其他 SKU");
    await page.click('[data-page="products"]');
    expect((await page.locator('tr[data-product-id="1"] .product-inventory-summary').innerText()).includes("实物 427"), "SKU 保存后 SPU 汇总未实时更新");
  });

  await run("admin-interaction-commission-version", "admin.html", async (page) => {
    await page.click('[data-page="commission-rules"]');
    await page.click('[data-commission-tab="sku"]');
    await page.click("#commissionSkuRows .edit-sku-rule");
    await page.fill("#ruleRateInput", "0");
    await page.click("#saveCommissionRule");
    expect(await page.locator("#commissionRuleModal").isVisible(), "缺少原因时佣金规则弹窗被错误关闭");
    expect((await page.locator("#ruleVersionBadge").innerText()).includes("CR-20260811-03"), "校验失败仍生成了规则版本");
    await page.fill("#ruleChangeReason", "自动化验收：明确设置无佣金");
    await page.check("#ruleChangeConfirm");
    await page.click("#saveCommissionRule");
    await page.waitForSelector("#commissionRuleModal", { state: "hidden" });
    await page.waitForFunction(() => document.querySelector("#ruleVersionBadge")?.textContent.includes("CR-20260811-04"));
    expect((await page.locator("#commissionSkuRows").innerText()).includes("0.00%"), "明确 0% 规则未写回 SKU 列表");
  });

  await run("admin-interaction-high-risk", "admin.html", async (page) => {
    await page.click('[data-page="agents"]');
    await page.click("#agentRows .toggle-agent");
    await page.click("#confirmHighRisk");
    expect(await page.locator("#highRiskError").isVisible(), "缺少原因和确认时未阻止高风险操作");
    await page.fill("#highRiskReason", "自动化验收：暂停渠道合作");
    await page.check("#highRiskConfirm");
    await page.click("#confirmHighRisk");
    await page.waitForSelector("#highRiskModal", { state: "hidden" });
    expect((await page.locator("#agentRows").innerText()).includes("已停用"), "代理停用未更新列表或审计反馈");
  });

  await run("admin-interaction-fulfillment-aftersale", "admin.html", async (page) => {
    await page.click('[data-page="orders"]');
    await page.fill("#orderSearch", "QY202608060023");
    expect(await page.locator("#orderRows .ship-order").isDisabled(), "活动售后占用未阻断单包裹整单发货");
    await page.locator("#orderRows .view-order").first().click();
    expect(await page.locator("#openShipModal").isHidden(), "受售后占用订单详情仍提供发货入口");

    await page.click('[data-page="aftersales"]');
    await page.fill("#aftersaleSearch", "AS202608060004");
    await page.click("#aftersaleRows .review-aftersale");
    await page.fill("#reviewNote", "未发货全额退款，核对占用后执行");
    await page.click("#approveAftersale");
    expect(await page.locator("#highRiskReasonField").isVisible(), "退款操作缺少原因输入");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060004", "COMPLETED", "未发货退款完成", true);
    await waitForHighRiskIdle(page, "未发货退款确认收尾", "AS202608060004");
    await page.click('[data-page="orders"]'); await page.fill("#orderSearch", "QY202608060023"); await page.locator("#orderRows .view-order").first().click();
    const axes = await page.locator("#detailOrderInfo").innerText();
    expect(["CLOSED", "FULL", "CANCELLED", "FULL_REFUND_BEFORE_SHIPMENT"].every((term) => axes.includes(term)), "未发货全额退款未关单、终止履约或更新退款轴");
    await page.click('[data-page="inventory"]');
    expect((await page.locator('tr[data-inventory-id="SERUM-030"] td').nth(1).innerText()) === "9", "未发货退款成功未自动回补对应 SKU");

    await page.click('[data-page="aftersales"]'); await page.fill("#aftersaleSearch", "AS202608050012"); await page.click("#aftersaleRows .review-aftersale");
    expect(await page.locator("#inspectionFields").isVisible(), "WAITING_INSPECTION 未展示验货数量与处置表单");
    expect(await page.locator('[name="received_qty"], [name="approved_refund_qty"], [name="restock"], [name="damaged"], [name="scrap"], [name="return_to_customer"]').count() === 6, "验货六项数量字段不完整");
    await page.fill("#inspectionReceivedQty", "1"); await page.fill("#inspectionApprovedQty", "2"); await page.fill("#inspectionRestockQty", "1");
    await page.fill("#reviewNote", "验收 PASS 数量门禁"); await page.click("#approveAftersale");
    expect(await page.locator("#highRiskModal").isHidden(), "PASS 非全量实收仍进入二次确认");
    expect((await page.locator("#toast").innerText()).includes("PASS"), "PASS 额度校验失败时缺少可理解反馈");
    await page.fill("#inspectionReceivedQty", "2"); await page.fill("#inspectionApprovedQty", "2"); await page.fill("#inspectionRestockQty", "2"); await page.fill("#inspectionDamagedQty", "0"); await page.fill("#inspectionScrapQty", "0"); await page.fill("#inspectionReturnQty", "0");
    await waitForInspectionBalance(page, "两项等式校验通过", "PASS 合法数量输入");
    await page.click("#approveAftersale");
    const passImpact = await page.locator("#highRiskImpact").innerText();
    expect(await page.locator("#highRiskModal").isVisible() && ["实收 2", "回库 2"].every((term) => passImpact.includes(term)), "PASS 确认未展示精确实收与回库影响");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608050012", "COMPLETED", "PASS 验货退款完成", true);
    await waitForHighRiskIdle(page, "PASS 验货确认收尾", "AS202608050012");
    await page.fill("#aftersaleSearch", "AS202608050012");
    await page.click("#aftersaleRows .review-aftersale");
    expect((await page.locator("#inspectionEvidencePolicy").innerText()).includes("PASS · 0 份证据") && (await page.locator("#inspectionEvidenceList").innerText()).includes("封存空证据清单"), "PASS 零证据未生成可审计的封存摘要");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.inspectionIsSealed("AS202608050012")), "PASS 验货事实未深度封存");
    await page.locator("#aftersaleModal .modal-close").first().click();
    await page.click('[data-page="inventory"]');
    expect((await page.locator('tr[data-inventory-id="HOME-030"] td').nth(1).innerText()) === "240", "PASS 未仅按 restock 数量回库");

    await page.click('[data-page="aftersales"]'); await page.fill("#aftersaleSearch", "AS202608060002"); await page.click("#aftersaleRows .review-aftersale");
    await page.fill("#reviewNote", "同意退货并提供总部退货地址"); await page.click("#approveAftersale"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060002", "WAITING_RETURN", "退货退款审核通过", true);
    await waitForHighRiskIdle(page, "退货退款审核确认收尾", "AS202608060002");
    await page.fill("#aftersaleSearch", "AS202608060002"); await page.click("#aftersaleRows .review-aftersale");
    expect((await page.locator("#aftersaleWorkflow").innerText()).includes("总部退货地址"), "退货退款审核后未展示总部退货地址");
    await page.fill("#reviewNote", "客户退货物流已核验"); await page.click("#advanceAftersale");
    await page.fill("#reviewNote", "到仓商品与申请不符"); await page.fill("#inspectionException", "寄回商品缺少泵头");
    await page.fill("#inspectionReceivedQty", "1"); await page.fill("#inspectionApprovedQty", "1"); await page.fill("#inspectionRestockQty", "0"); await page.fill("#inspectionDamagedQty", "0"); await page.fill("#inspectionScrapQty", "0"); await page.fill("#inspectionReturnQty", "0");
    expect((await page.locator("#inspectionBalance").innerText()).includes("请修正"), "ABNORMAL 批准退款与处置不相等时未在表单内反馈");
    await page.click("#exceptionAftersale");
    expect(await page.locator("#highRiskModal").isHidden(), "ABNORMAL 批准退款与处置不相等仍进入确认");
    await waitForToast(page, "ABNORMAL", "ABNORMAL 等式校验失败反馈");
    await page.fill("#inspectionApprovedQty", "0");
    expect((await page.locator("#inspectionBalance").innerText()).includes("请修正"), "ABNORMAL 实收未分配给退款或退客时未被拦截");
    await page.fill("#inspectionReturnQty", "1");
    await waitForInspectionBalance(page, "两项等式校验通过", "ABNORMAL 合法数量输入");
    await page.click("#exceptionAftersale");
    expect(await page.locator("#highRiskModal").isHidden(), "ABNORMAL 零证据仍进入高风险确认");
    await waitForToast(page, "至少需要 1 份", "ABNORMAL 零证据拦截反馈");
    await page.click("#addInspectionEvidence");
    expect(await page.locator("#inspectionEvidenceList [data-evidence-file-id]").count() === 1, "验货证据文件未加入待封存清单");
    await page.click("#exceptionAftersale");
    const abnormalImpact = await page.locator("#highRiskImpact").innerText();
    expect(await page.locator("#highRiskModal").isVisible() && ["实收 1", "退回客户 1"].every((term) => abnormalImpact.includes(term)), "ABNORMAL 确认未展示精确实收与退客影响");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060002", "RETURN_EXCEPTION", "ABNORMAL 验货事实封存");
    await waitForHighRiskIdle(page, "ABNORMAL 登记确认收尾", "AS202608060002");
    await page.fill("#aftersaleSearch", "AS202608060002");
    await page.click("#aftersaleRows .review-aftersale");
    expect(await page.locator("#inspectionResolutionPanel").isVisible() && await page.locator("#continueRefundAfterInspection").isVisible() && await page.locator("#rejectAfterInspection").isVisible(), "RETURN_EXCEPTION 未展示 typed 二阶段处置");
    expect(await page.locator("#addInspectionEvidence").isDisabled() && (await page.locator("#inspectionEvidenceList").innerText()).includes("SEALED"), "ABNORMAL 证据未封存或仍可改写");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.inspectionIsSealed("AS202608060002")), "ABNORMAL 验货数量/证据未深度封存");
    await captureFlow(page, "admin-return-inspection-resolution");
    await page.click("#continueRefundAfterInspection");
    expect(await page.locator("#highRiskModal").isHidden() && (await page.locator("#toast").innerText()).includes("必须填写"), "CONTINUE_REFUND 缺原因仍可推进");
    await page.fill("#inspectionResolutionReason", "异常已复核，按封存数量继续退款"); await page.click("#continueRefundAfterInspection");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060002", "COMPLETED", "CONTINUE_REFUND 退款完成");
    await waitForHighRiskIdle(page, "CONTINUE_REFUND 确认收尾", "AS202608060002");
    const continueSnapshot = await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().aftersales.find((item) => item.id === "AS202608060002"));
    expect(continueSnapshot.inspection.resolution === "CONTINUE_REFUND" && continueSnapshot.inspection.evidenceCount === 1, "CONTINUE_REFUND 未保留 typed 决议与封存证据");

    await page.fill("#aftersaleSearch", "AS202608060001"); await page.click("#aftersaleRows .review-aftersale");
    expect((await page.locator("#aftersaleWorkflow").innerText()).includes("REFUND_FAILED"), "退款失败状态或重试入口缺失");
    await page.fill("#reviewNote", "沿用原退款记录重试"); await page.click("#approveAftersale"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060001", "COMPLETED", "退款失败重试完成", true);
    await waitForHighRiskIdle(page, "退款失败重试确认收尾", "AS202608060001");
  });

  await run("admin-interaction-return-inspection-reject", "admin.html", async (page) => {
    await page.click('[data-page="aftersales"]'); await page.fill("#aftersaleSearch", "AS202608060002"); await page.click("#aftersaleRows .review-aftersale");
    await page.fill("#reviewNote", "同意退货并提供总部地址"); await page.click("#approveAftersale"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060002", "WAITING_RETURN", "拒绝分支退货审核通过", true);
    await waitForHighRiskIdle(page, "拒绝分支退货审核确认收尾", "AS202608060002");
    await page.fill("#aftersaleSearch", "AS202608060002"); await page.click("#aftersaleRows .review-aftersale"); await page.fill("#reviewNote", "退货物流已核验"); await page.click("#advanceAftersale");
    await page.fill("#reviewNote", "到仓验货异常"); await page.fill("#inspectionException", "商品缺件且需退回客户");
    await page.fill("#inspectionReceivedQty", "1"); await page.fill("#inspectionApprovedQty", "0"); await page.fill("#inspectionRestockQty", "0"); await page.fill("#inspectionDamagedQty", "0"); await page.fill("#inspectionScrapQty", "0"); await page.fill("#inspectionReturnQty", "1");
    await page.click("#addInspectionEvidence"); await page.click("#exceptionAftersale"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060002", "RETURN_EXCEPTION", "拒绝分支 ABNORMAL 验货事实封存");
    await waitForHighRiskIdle(page, "拒绝分支 ABNORMAL 登记确认收尾", "AS202608060002");
    await page.fill("#aftersaleSearch", "AS202608060002"); await page.click("#aftersaleRows .review-aftersale");
    await page.click("#rejectAfterInspection");
    expect(await page.locator("#highRiskModal").isHidden(), "REJECT_AFTER_RETURN 缺原因仍可推进");
    await page.fill("#inspectionResolutionReason", "证据确认退回品不符合退款条件"); await page.click("#rejectAfterInspection"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await waitForAftersaleState(page, "AS202608060002", "REJECTED_AFTER_RETURN", "REJECT_AFTER_RETURN 处置完成");
    await waitForHighRiskIdle(page, "REJECT_AFTER_RETURN 确认收尾", "AS202608060002");
    const rejected = await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().aftersales.find((item) => item.id === "AS202608060002"));
    expect(rejected.statusCode === "REJECTED_AFTER_RETURN" && rejected.inspection.resolution === "REJECT_AFTER_RETURN" && rejected.reserved === false, "REJECT_AFTER_RETURN 未写入 typed 决议或未释放占用");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.inspectionIsSealed("AS202608060002")), "拒绝分支改写了封存验货事实");
  });

  await run("admin-interaction-customer-order-filter", "admin.html", async (page) => {
    await page.click('[data-page="customers"]');
    await page.click('tr[data-customer-id="1"] .view-customer');
    await page.click("#viewCustomerOrders");
    expect((await page.inputValue("#orderSearch")) === "林晓月", "客户详情进入订单未带入当前客户筛选");
    const names = await page.locator("#orderRows tr[data-order-id] td:nth-child(2) .cell-main").allInnerTexts();
    expect(names.length > 0 && names.every((name) => name === "林晓月"), "客户订单筛选仍混入其他客户记录");
  });

  await run("admin-interaction-agent-governance", "admin.html", async (page) => {
    await page.click('[data-page="agents"]');
    await page.click('tr[data-agent-id="A1026"] .view-agent');
    await captureFlow(page, "admin-agent-scoped-drilldown");
    const oldInvite = await page.locator("#agentDrawerInvite").innerText();
    await page.click("#configureDrawerProducts");
    const choices = page.locator("#whitelistProducts input");
    await choices.nth(0).check(); await choices.nth(1).uncheck();
    await page.fill("#whitelistReason", "自动化验收：调整推广商品"); await page.check("#whitelistConfirm"); await page.click("#saveWhitelist");
    expect((await page.locator("#highRiskImpact").innerText()).includes("已有绑定客户"), "白名单变更预览未说明全店计佣不受影响");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForSelector("#highRiskModal", { state: "hidden" });
    await page.click('tr[data-agent-id="A1026"] .view-agent');
    expect((await page.locator("#agentDrawerAuthCount").innerText()) === "2 件", "白名单选择未写回当前代理");
    await page.click("#rotateAgentInvite"); await page.fill("#highRiskReason", "旧邀请码疑似外泄"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction((previous) => document.querySelector("#agentDrawerInvite")?.innerText !== previous, oldInvite);
    const newInvite = await page.locator("#agentDrawerInvite").innerText();
    expect(newInvite !== oldInvite && (await page.locator("#agentDrawerInviteState").innerText()).includes("2026-12-31"), "邀请码轮换或有效期未更新");
    await page.click("#disableAgentInvite"); await page.fill("#highRiskReason", "暂停新客户候选"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => document.querySelector("#agentDrawerInviteState")?.textContent.includes("已停用"));
    await page.click("#resetAgentPassword"); await page.fill("#highRiskReason", "代理申请重置登录凭据"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    const credential = await page.locator("#credentialPassword").innerText();
    expect(credential.length >= 8 && !["Agent@2026", "123456"].includes(credential), "密码重置未生成运行时一次性凭据");
    await page.locator("#credentialModal .modal-heading .modal-close").click();
    expect((await page.locator("#credentialPassword").innerText()) === "已隐藏", "离开凭据弹层后临时密码未清除");
  });

  await run("admin-interaction-agent-scoped-drilldowns", "admin.html", async (page) => {
    await page.click('[data-page="agents"]');
    expect((await page.locator('tr[data-agent-id="A1026"] td').nth(6).innerText()).includes("2026-04-09"), "代理列表未展示 created_at");
    await page.click('tr[data-agent-id="A1026"] .view-agent');
    const expectedTypes = ["customers", "orders", "commissions", "wallet", "withdrawals", "audit"];
    for (const type of expectedTypes) {
      await page.click(`[data-agent-drilldown="${type}"]`);
      expect((await page.locator("#agentDrilldownContent").getAttribute("data-agent-id")) === "A1026", `${type} 下钻丢失当前 agentId`);
      const rowAgentIds = await page.locator("#agentDrilldownContent [data-agent-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.agentId));
      expect(rowAgentIds.length > 0 && rowAgentIds.every((id) => id === "A1026"), `${type} 下钻混入其他代理数据`);
      if (type === "orders") {
        const text = await page.locator("#agentDrilldownContent").innerText();
        expect(text.includes("PAID") && !text.includes("UNPAID"), "代理订单下钻混入未付款订单");
      }
    }
    await page.locator("#agentDrawer .drawer-close").click();
    await page.click('tr[data-agent-id="A1038"] .view-agent');
    expect((await page.locator("#agentDrilldownContent").getAttribute("data-agent-id")) === "A1038", "切换代理后下钻仍沿用上一记录");
    const ids = await page.locator("#agentDrilldownContent [data-agent-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.agentId));
    expect(ids.every((id) => id === "A1038"), "切换代理后行级过滤未更新");
  });

  await run("admin-interaction-withdrawal-matrix", "admin.html", async (page) => {
    await page.click('[data-page="withdrawals"]');
    await page.click('tr[data-withdrawal-id="WD202608100021"] .review-withdrawal');
    await page.click("#approveWithdrawal");
    expect(await page.locator("#highRiskReasonField").isHidden(), "提现通过错误要求操作原因");
    expect((await page.locator("#highRiskImpact").innerText()).includes("APPROVED"), "提现通过缺少影响预览");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => document.querySelector('tr[data-withdrawal-id="WD202608100021"] .tag')?.textContent === "待打款");
    await page.waitForSelector('#appShell[data-financial-busy="false"]');
    await page.click('tr[data-withdrawal-id="WD202608100021"] .review-withdrawal');
    await page.click("#paymentProofButton"); await page.click("#markWithdrawalPaid");
    expect(await page.locator("#highRiskReasonField").isHidden(), "标记已支付错误要求操作原因");
    expect((await page.locator("#highRiskImpact").innerText()).includes("不可回退"), "标记已支付缺少影响预览");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => document.querySelector('tr[data-withdrawal-id="WD202608100021"] .tag')?.textContent === "已打款");
    await page.waitForSelector('#appShell[data-financial-busy="false"]');

    await page.click('tr[data-withdrawal-id="WD202608100018"] .review-withdrawal');
    await page.click("#rejectWithdrawal");
    expect(await page.locator("#highRiskModal").isHidden(), "提现拒绝在缺少原因时仍进入确认");
    await page.fill("#withdrawalReviewNote", "收款人实名资料不一致"); await page.click("#rejectWithdrawal");
    expect(await page.locator("#highRiskReasonField").isVisible(), "提现拒绝未要求原因");
  });

  await run("admin-interaction-bank-reveal", "admin.html", async (page) => {
    await page.click('[data-page="withdrawals"]');
    await page.click('tr[data-withdrawal-id="WD202608100021"] .review-withdrawal');
    expect(await page.locator("#openBankVerification").isHidden(), "非 APPROVED 提现出现完整卡号入口");
    await page.locator("#withdrawalModal .modal-heading .modal-close").click();

    await page.click('tr[data-withdrawal-id="WD202608090086"] .review-withdrawal');
    expect(await page.locator("#openBankVerification").isVisible(), "APPROVED 提现缺少二次验证入口");
    await page.click("#openBankVerification");
    expect(await page.locator("#bankVerifyPassword").count() === 0, "本人 TOTP 查看仍要求当前密码");
    await page.fill("#bankVerifyCode", "123456");
    await page.click("#confirmBankVerification");
    const revealed = await page.locator("#withdrawalCard").innerText();
    expect(revealed.startsWith("DEMO-ACCOUNT-") && !/\d{12,19}/.test(revealed), "本人 TOTP 后未使用非银行卡格式的运行时安全占位");
    expect(await page.locator("#copyRevealedBank").isVisible(), "临时授权缺少一次性复制入口");
    await page.click("#copyRevealedBank");
    expect((await page.locator("#withdrawalCard").innerText()).includes("****"), "一次性复制后未立即清除敏感展示");
    await page.locator("#withdrawalModal .modal-heading .modal-close").click();
    await page.waitForSelector("#withdrawalModal", { state: "hidden" });
    expect((await page.locator("#withdrawalCard").innerText()).includes("****"), "关闭敏感详情后完整银行卡号未立即清除");
    await page.click('tr[data-withdrawal-id="WD202608090086"] .review-withdrawal');
    expect((await page.locator("#withdrawalCard").innerText()).includes("****"), "重新进入详情时银行卡号未恢复掩码");
  });

  await run("admin-interaction-bank-lock", "admin.html", async (page) => {
    await page.click('[data-page="withdrawals"]');
    await page.click('tr[data-withdrawal-id="WD202608090086"] .review-withdrawal');
    await page.click("#openBankVerification");
    await page.fill("#bankVerifyCode", "123456");
    await page.check("#bankVerifyRejectDemo");
    for (let attempt = 0; attempt < 5; attempt += 1) await page.click("#confirmBankVerification");
    expect((await page.locator("#bankVerifyState").innerText()).includes("锁定 15 分钟"), "连续失败 5 次后未锁定二次验证");
  });

  await run("agent-interaction-ledger-wallet", "agent.html", async (page) => {
    await page.click('[data-page="commission"]');
    const commissionText = await page.locator('[data-view="commission"]').innerText();
    expect(["CREDIT", "REFUND_DEBIT", "CANCELLED"].every((term) => commissionText.includes(term)), "代理佣金页未并列展示正向、退款冲正和取消流水");
    expect(commissionText.includes("原始预计/入账流水不修改"), "代理佣金页未说明原正向流水不可变");

    await page.click('[data-page="wallet"]');
    await page.click('[data-wallet-scenario="negative"]');
    expect(await page.locator("#walletWithdrawButton").isDisabled(), "负余额状态仍允许申请提现");
    expect(await page.locator("#negativeWalletCallout").isVisible(), "负余额限制说明未展示");
    await page.click('#withdrawalRows [data-withdrawal-detail="WD202608100021"]');
    expect((await page.locator("#detailDrawer").innerText()).includes("APPROVED"), "代理端未展示已审核待打款提现状态");
  });

  await run("agent-interaction-auth-bank-withdraw", "agent.html", async (page) => {
    await page.evaluate(() => { sessionStorage.removeItem("qingxuAgentLoggedIn"); sessionStorage.removeItem("qingxuAgentPasswordSet"); });
    await page.goto(buildUrl({ file: "agent.html", query: {} }), { waitUntil: "load" });
    await page.fill("#username", "paused.agent"); await page.fill("#password", "runtime-pass"); await page.click('#loginForm button[type="submit"]');
    expect((await page.locator("#loginError").innerText()).includes("已停用"), "停用代理账号仍可登录");
    await page.fill("#username", "active.agent"); await page.fill("#password", "runtime-pass"); await page.click('#loginForm button[type="submit"]');
    expect(await page.locator("#passwordModal").isVisible(), "首次登录未强制修改运行时临时密码");
    await page.fill("#currentPassword", "runtime-pass"); await page.fill("#newPassword", "NewRuntime8"); await page.fill("#confirmPassword", "NewRuntime8"); await page.click('#passwordForm button[type="submit"]');
    expect(await page.locator("#appShell").isVisible(), "修改密码后未进入代理工作台");

    await page.click('[data-page="account"]'); await page.click('[data-view="account"] [data-bank]');
    await page.fill("#bankNumber", "123"); await page.click('#bankForm button[type="submit"]');
    expect(await page.locator("#bankFormError").isVisible(), "银行卡号格式错误未被阻止");
    await page.fill("#bankNumber", "123456789012"); await page.click('#bankForm button[type="submit"]');
    expect((await page.locator("#accountBankMasked").innerText()).includes("9012"), "有效银行卡更新未写回后四位");
    expect((await page.inputValue("#bankNumber")) === "", "银行卡提交后完整输入未清除");
    expect(!(await page.locator("body").innerText()).includes("123456789012"), "代理端页面保留完整银行卡号");

    await page.click('[data-page="wallet"]');
    expect(await page.locator("#walletWithdrawButton").isDisabled(), "已有进行中提现时仍可再次申请");
    await page.click("#simulateWithdrawalPaid");
    expect(await page.locator("#walletWithdrawButton").isEnabled(), "进行中提现完成后仍未开放新申请");
    await page.click("#walletWithdrawButton"); await page.fill("#withdrawAmount", "200"); await page.check("#withdrawAgree");
    await page.locator("#withdrawForm").evaluate((form) => { form.requestSubmit(); form.requestSubmit(); });
    await page.waitForFunction(() => /WD20260811\d+/.test(document.querySelector("#withdrawalRows")?.textContent || ""));
    const generated = (await page.locator("#withdrawalRows").innerText()).match(/WD20260811\d+/g) || [];
    expect(new Set(generated).size === 1, "重复提交创建了多笔提现申请");
    expect(await page.locator("#walletWithdrawButton").isDisabled(), "新提现进入处理中后未阻止第二笔申请");
  });

  return failures;
}

async function main() {
  if (updateExports) fs.mkdirSync(exportDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  const failures = inspectSensitiveSources();
  if (!failures.length && !quiet) console.log("PASS sensitive-source-scan");

  try {
    if (!flowFilter) {
      for (const testCase of cases) {
        const context = await browser.newContext({ viewport: testCase.viewport, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));

        await page.goto(buildUrl(testCase), { waitUntil: "load" });
        await page.waitForFunction(() => document.fonts.status === "loaded");
        await page.waitForFunction(() => [...document.images].every((image) => image.complete));
        await page.waitForTimeout(120);

        const pageFailures = await inspectPage(page, testCase);
        pageFailures.push(...pageErrors.map((error) => `脚本错误: ${error}`));
        if (updateExports) await page.screenshot({ path: path.join(exportDir, `${testCase.name}.png`), fullPage: false });

        if (pageFailures.length) failures.push(`${testCase.name}: ${pageFailures.join("；")}`);
        else if (!quiet) console.log(`PASS ${testCase.name}`);
        await context.close();
      }
      failures.push(...await runSurfaceContractChecks(browser));
    }
    failures.push(...await runMiniInteractionChecks(browser));
    failures.push(...await runOpsInteractionChecks(browser));
  } finally {
    await browser.close();
  }

  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
  } else if (flowFilter) {
    console.log(`PASS filtered flow: ${flowFilter}`);
  } else {
    console.log(`PASS all ${cases.length} responsive renders, 21/9/22 surface contracts, 14 miniapp flows and 16 admin/agent flows${updateExports ? " (exports updated)" : ""}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
