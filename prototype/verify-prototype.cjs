const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const prototypeDir = __dirname;
const exportDir = path.join(prototypeDir, "exports");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const updateExports = process.env.UPDATE_PROTOTYPE_EXPORTS === "1";
const adminViews = ["dashboard", "products", "product-edit", "brands", "categories", "banners", "inventory", "orders", "order-detail", "aftersales", "customers", "agents", "commission-rules", "withdrawals", "business-rules", "audit-logs"];
const agentViews = ["dashboard", "products", "customers", "orders", "commission", "wallet", "account"];

function adminExpectedTerms(view) {
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
  ...["home", "product", "checkout", "orders", "aftersale", "service-agent", "login", "payment-result", "order-detail", "logistics", "aftersale-detail", "addresses", "address-edit", "favorites", "account", "phone-authorization", "account-deletion", "system-states"].map((screen) => ({
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

    if (kind === "agent" || kind === "agent-mobile") {
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
  if ((testCase.kind === "agent" || testCase.kind === "agent-mobile") && result.fullPhoneNumbers.length) {
    failures.push(`代理端暴露完整手机号: ${result.fullPhoneNumbers.join(", ")}`);
  }
  if ((testCase.kind === "agent" || testCase.kind === "agent-mobile") && result.unmaskedBankCards.length) {
    failures.push("代理端暴露完整银行卡号");
  }
  if (testCase.kind === "agent-mobile" && !result.agentMobileNavFits) failures.push("代理端移动导航超出视口或点击区过窄");
  return failures;
}

function miniUrl(query = {}) {
  return buildUrl({ file: "index.html", query });
}

async function runMiniInteractionChecks(browser) {
  const failures = [];

  async function run(name, callback) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await callback(page);
      if (pageErrors.length) throw new Error(pageErrors.join("；"));
      console.log(`PASS ${name}`);
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
    await page.goto(miniUrl({ screen: "address-edit", device: "375" }), { waitUntil: "load" });
    await page.fill('input[name="phone"]', "13900001234");
    await page.click('#addressForm button[type="submit"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "addresses");
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

  async function run(name, file, callback) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(buildUrl({ file, query: { autologin: "1" } }), { waitUntil: "load" });
      await callback(page);
      if (pageErrors.length) throw new Error(pageErrors.join("；"));
      console.log(`PASS ${name}`);
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
    expect(await page.locator("#openShipModal").isVisible(), "待发货订单缺少发货入口");
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
    expect((await page.locator("#ruleVersionBadge").innerText()).includes("CR-20260811-04"), "保存后未生成新的不可变规则版本");
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

  await run("admin-interaction-bank-reveal", "admin.html", async (page) => {
    await page.click('[data-page="withdrawals"]');
    await page.click('tr[data-withdrawal-id="WD202608100021"] .review-withdrawal');
    expect(await page.locator("#openBankVerification").isHidden(), "非 APPROVED 提现出现完整卡号入口");
    await page.locator("#withdrawalModal .modal-heading .modal-close").click();

    await page.click('tr[data-withdrawal-id="WD202608090086"] .review-withdrawal');
    expect(await page.locator("#openBankVerification").isVisible(), "APPROVED 提现缺少二次验证入口");
    await page.click("#openBankVerification");
    await page.fill("#bankVerifyPassword", "demo-pass");
    await page.fill("#bankVerifyCode", "826413");
    await page.click("#confirmBankVerification");
    const revealed = await page.locator("#withdrawalCard").innerText();
    expect(/\d{4}\s\d{4}\s\d{4}\s\d{4}/.test(revealed), "二次验证后未显示绑定提现单的完整账号");
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
    await page.fill("#bankVerifyPassword", "wrong-pass");
    await page.fill("#bankVerifyCode", "826413");
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

  return failures;
}

async function main() {
  if (updateExports) fs.mkdirSync(exportDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  const failures = [];

  try {
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
      else console.log(`PASS ${testCase.name}`);
      await context.close();
    }
    failures.push(...await runMiniInteractionChecks(browser));
    failures.push(...await runOpsInteractionChecks(browser));
  } finally {
    await browser.close();
  }

  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS all ${cases.length} prototype views, 8 miniapp flows and 6 admin/agent flows${updateExports ? " (exports updated)" : ""}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
