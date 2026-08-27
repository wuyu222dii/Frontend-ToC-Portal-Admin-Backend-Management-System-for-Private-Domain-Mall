const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");

const prototypeDir = __dirname;
const exportDir = path.join(prototypeDir, "exports");
const defaultChromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromeExecutable = process.env.CHROME_EXECUTABLE_PATH || (fs.existsSync(defaultChromeExecutable) ? defaultChromeExecutable : undefined);
const updateExports = process.env.UPDATE_PROTOTYPE_EXPORTS === "1";
const flowFilter = process.env.PROTOTYPE_FLOW_FILTER || "";
const caseFilter = process.env.PROTOTYPE_CASE_FILTER || "";
const quiet = process.env.PROTOTYPE_QUIET === "1";
const miniScreens = ["home", "category", "search", "product", "cart", "profile", "checkout", "payment-result", "orders", "order-detail", "logistics", "aftersale", "aftersale-detail", "favorites", "addresses", "address-edit", "account", "login", "phone-authorization", "account-deletion", "service-agent"];
const adminViews = ["dashboard", "products", "product-edit", "brands", "categories", "banners", "inventory", "orders", "order-detail", "aftersales", "customers", "agents", "commission-rules", "withdrawals", "business-rules", "audit-logs"];
const agentViews = ["dashboard", "products", "customers", "orders", "commission", "wallet", "account"];

function adminExpectedTerms(view) {
  if (view === "dashboard") return ["代理归属销售", "活跃代理", "新增绑定", "待审核提现"];
  if (view === "products") return ["ADM-03", "最低活动价", "库存只读", "首次启用"];
  if (view === "product-edit") return ["SKU 与价格", "创建后为停用状态", "最多 8 张", "保存资料不会改变状态"];
  if (view === "brands") return ["ADM-05", "排序", "草稿", "已归档"];
  if (view === "categories") return ["ADM-06", "活动商品依赖", "排序", "版本"];
  if (view === "banners") return ["ADM-07", "公开图片", "默认（不含已归档）", "sort_order ASC"];
  if (view === "commission-rules") return ["平台默认", "分类规则", "SKU", "全部一级代理"];
  if (view === "inventory") return ["实物库存", "锁定库存", "活动预占", "available_qty = physical_qty - locked_qty"];
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
      : screen === "login"
        ? ["当前协议", "用户协议", "隐私政策", "微信登录"]
      : screen === "profile"
        ? ["手机号未绑定", "我的服务代理", "商品收藏", "收货地址"]
      : screen === "service-agent"
        ? ["服务代理", "绑定时间", "商城服务保障"]
      : screen === "account"
        ? ["账户手机号", "隐私权利", "注销账号"]
        : screen === "phone-authorization"
          ? ["账户手机号", "独立于收货地址", "手机号授权声明", "授权账户手机号"]
          : screen === "account-deletion"
            ? ["注销资格预览", "保留边界", "检查注销资格"]
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
  ...["home", "product", "cart", "profile", "checkout", "order-detail", "account-deletion"].map((screen) => ({
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
  ...[375, 390, 414].flatMap((width) => ["brands", "categories"].map((view) => ({
    name: `admin-${view}-${width}`,
    file: "admin.html",
    query: { autologin: "1", view },
    viewport: { width, height: width === 375 ? 812 : width === 390 ? 844 : 896 },
    kind: "admin",
    expectedTerms: adminExpectedTerms(view)
  }))),
  ...[375, 390, 414].flatMap((width) => ["products", "product-edit"].map((view) => ({
    name: `admin-${view}-${width}`,
    file: "admin.html",
    query: { autologin: "1", view },
    viewport: { width, height: width === 375 ? 812 : width === 390 ? 844 : 896 },
    kind: "admin",
    expectedTerms: adminExpectedTerms(view)
  }))),
  ...[375, 390, 414].flatMap((width) => ["banners", "inventory"].map((view) => ({
    name: `admin-${view}-${width}`,
    file: "admin.html",
    query: { autologin: "1", view },
    viewport: { width, height: width === 375 ? 812 : width === 390 ? 844 : 896 },
    kind: "admin",
    expectedTerms: adminExpectedTerms(view)
  }))),
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
  const result = await page.evaluate(({ kind, view, viewport, deferredTerms, forbiddenPrototypeTerms, expectedTerms }) => {
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

    if (kind === "admin" && view === "inventory" && viewport.width <= 680) {
      const summary = document.querySelector("#inventoryRows .inventory-mobile-summary");
      const rect = summary?.getBoundingClientRect();
      checks.inventoryMobileSummaryVisible = Boolean(
        summary &&
        getComputedStyle(summary).display !== "none" &&
        rect &&
        rect.width > 0 &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth + 1 &&
        ["实物", "锁定", "预占", "可售"].every((term) => summary.textContent.includes(term))
      );
    }

    return checks;
  }, {
    kind: testCase.kind,
    view: testCase.query.view,
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
  if (testCase.query.view === "inventory" && testCase.viewport.width <= 680 && !result.inventoryMobileSummaryVisible) failures.push("ADM-08 移动端首屏缺少可见库存摘要");
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
  const masterDataProjection = await adminPage.evaluate(() => ({
    brands: document.querySelector('[data-view="brands"]')?.innerText || "",
    categories: document.querySelector('[data-view="categories"]')?.innerText || "",
    brandStatuses: [...document.querySelectorAll("#brandStatus option")].map((option) => option.value),
    categoryStatuses: [...document.querySelectorAll("#categoryStatus option")].map((option) => option.value),
    sortMinimum: document.querySelector("#entitySort")?.min,
    sortStep: document.querySelector("#entitySort")?.step
  }));
  const unsupportedBrandTerms = ["品牌编码", "关联商品", "品牌故事"];
  const unsupportedCategoryTerms = ["分类编码", "商品 / SKU", "佣金来源", "分类说明"];
  const exposedBrandTerms = unsupportedBrandTerms.filter((term) => masterDataProjection.brands.includes(term));
  const exposedCategoryTerms = unsupportedCategoryTerms.filter((term) => masterDataProjection.categories.includes(term));
  if (exposedBrandTerms.length) failures.push(`ADM-05 暴露未支持字段: ${exposedBrandTerms.join(", ")}`);
  if (exposedCategoryTerms.length) failures.push(`ADM-06 暴露未支持字段: ${exposedCategoryTerms.join(", ")}`);
  if ([masterDataProjection.brandStatuses, masterDataProjection.categoryStatuses].some((values) => values.join(",") !== ",DRAFT,ACTIVE,INACTIVE,ARCHIVED")) failures.push("ADM-05/06 状态筛选未锁定 DRAFT/ACTIVE/INACTIVE/ARCHIVED");
  if (masterDataProjection.sortMinimum !== "0" || masterDataProjection.sortStep !== "1") failures.push("ADM-05/06 排序输入未锁定 integer >= 0");
  const productProjection = await adminPage.evaluate(() => ({
    list: document.querySelector('[data-view="products"]')?.innerText || "",
    editor: document.querySelector('[data-view="product-edit"]')?.innerText || "",
    statuses: [...document.querySelectorAll("#productStatus option")].map((option) => option.value),
    hasOrdinaryStatusControl: Boolean(document.querySelector("#productOnlineInput")),
    hasDirectPublish: Boolean(document.querySelector("#publishProduct")),
    hasEditableStock: Boolean(document.querySelector('#skuRows [data-sku-field="stock"]')),
    hasProductStockAction: Boolean(document.querySelector("#productRows .stock-action")),
    skuHeaders: [...document.querySelectorAll("#skuRows")].map((body) => body.closest("table")?.querySelector("thead")?.innerText || "").join(" ")
  }));
  if (productProjection.statuses.join(",") !== ",DRAFT,ACTIVE,INACTIVE,ARCHIVED") failures.push("ADM-03 状态筛选未锁定 DRAFT/ACTIVE/INACTIVE/ARCHIVED");
  if (productProjection.hasOrdinaryStatusControl || productProjection.hasDirectPublish) failures.push("ADM-04 仍暴露普通状态切换或保存即发布入口");
  if (productProjection.hasEditableStock || productProjection.hasProductStockAction) failures.push("ADM-03/04 库存摘要仍可直接调整");
  if (["有效佣金", "规则来源"].some((term) => productProjection.editor.includes(term) || productProjection.skuHeaders.includes(term))) failures.push("ADM-04 仍暴露佣金字段");
  if (!["最多 8 张", "创建后为停用状态", "保存资料不会改变状态"].every((term) => productProjection.editor.includes(term))) failures.push("ADM-04 未完整声明图集、SKU 创建或普通保存契约");
  const b5Projection = await adminPage.evaluate(() => ({
    bannerStatuses: [...document.querySelectorAll("#bannerStatus option")].map((option) => option.value),
    bannerTargetTypes: [...document.querySelectorAll("#entityTargetType option")].map((option) => option.value),
    bannerImages: document.querySelectorAll("#bannerManageGrid img").length,
    inventoryHeaders: document.querySelector('[data-view="inventory"] table thead')?.textContent || "",
    inventoryText: document.querySelector('[data-view="inventory"]')?.textContent || "",
    hasWarningInput: Boolean(document.querySelector("#stockWarning")),
    hasStockNote: Boolean(document.querySelector("#stockNote")),
    deltaStep: document.querySelector("#stockDelta")?.step
  }));
  if (b5Projection.bannerStatuses.join(",") !== ",DRAFT,ACTIVE,INACTIVE,ARCHIVED") failures.push("ADM-07 状态筛选未锁定 DRAFT/ACTIVE/INACTIVE/ARCHIVED");
  if (b5Projection.bannerTargetTypes.join(",") !== "NONE,PRODUCT,CATEGORY,URL") failures.push("ADM-07 跳转目标未锁定 NONE/PRODUCT/CATEGORY/URL");
  if (b5Projection.bannerImages < 3) failures.push("ADM-07 未使用 READY/PUBLIC Banner 图片信号");
  const adminSource = fs.readFileSync(path.join(prototypeDir, "admin.js"), "utf8");
  if (/data-banner-action=["']SOFT_DELETE/.test(adminSource) || /bannerLifecycle\([^\n]+SOFT_DELETE/.test(adminSource)) failures.push("ADM-07 仍将 Banner DELETE 表达为 SOFT_DELETE");
  if (["FILE_STATE_CONFLICT", "BANNER_TARGET_INVALID"].some((code) => adminSource.includes(code))) failures.push("ADM-07 仍包含 OpenAPI 未登记的 Banner 专用错误码");
  if (!["SKU 状态", "实物", "锁定", "活动预占", "可售", "版本"].every((term) => b5Projection.inventoryHeaders.includes(term))) failures.push("ADM-08 库存投影字段不完整");
  if (["预警值", "售后占用", "低库存"].some((term) => b5Projection.inventoryText.includes(term)) || b5Projection.hasWarningInput || b5Projection.hasStockNote) failures.push("ADM-08 仍暴露预警值、售后占用或独立备注");
  if (b5Projection.deltaStep !== "1") failures.push("ADM-08 physical_delta 未锁定整数步长");
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

  await run("mini-interaction-sku-b8-boundary", async (page) => {
    await page.goto(miniUrl({ screen: "product", device: "375" }), { waitUntil: "load" });
    await page.click('[data-sku-intent="buy"]');
    await page.click('[data-sku-id="SKU-SER-60"]');
    await page.click('[data-action="confirm-sku"]');
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.screen === "product" && snapshot.selectedSkuId === "SKU-SER-60", "B8 立即购买未保留规格上下文或错误离开商品页");
    expect(snapshot.buyNowLine === null, "B8 立即购买错误创建了结算行");
    expect((await page.locator("#toast").innerText()).includes("B9 开放"), "B8 立即购买未明确保持阶段边界");
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
    expect(order.join(",") === "serum,cleanser", "分类价格排序未按 ACTIVE SKU 最低价和稳定商品 ID 生效");
    await page.click('[data-category-switch="洗发水"]');
    await page.click('.category-content [data-open-product="shampoo"]');
    await page.click('[data-detail-tab="成分"]');
    const ingredientDetail = await page.locator(".detail-content").innerText();
    await page.click('[data-detail-tab="使用方法"]');
    const usageDetail = await page.locator(".detail-content").innerText();
    expect(ingredientDetail.includes("迷迭香叶提取物") && usageDetail.includes("重点清洁头皮"), "商品成分或用法未按当前商品动态绑定");
    await page.goto(miniUrl({ screen: "search", device: "375" }), { waitUntil: "load" });
    expect(await page.locator("#searchInput").getAttribute("maxlength") === "200", "商品名称搜索未锁定 200 字符上限");
    await page.fill("#searchInput", "氨基酸");
    await page.locator("#searchForm").evaluate((form) => form.requestSubmit());
    let searchOrder = await page.locator(".search-results [data-open-product]").evaluateAll((nodes) => nodes.map((node) => node.dataset.openProduct));
    expect(searchOrder.join(",") === "shampoo,cleanser", "COMPREHENSIVE 未按 hot/new/sales/published/id 固定顺序返回");
    await page.click('[data-sort="价格↑"]');
    searchOrder = await page.locator(".search-results [data-open-product]").evaluateAll((nodes) => nodes.map((node) => node.dataset.openProduct));
    expect(searchOrder.join(",") === "cleanser,shampoo", "ACTIVE SKU 最低价升序未生效");
    await page.fill("#searchInput", "MORI NATURE");
    await page.locator("#searchForm").evaluate((form) => form.requestSubmit());
    expect(await page.locator(".search-results [data-open-product]").count() === 0, "搜索错误匹配了品牌字段");
  });

  await run("mini-interaction-cart-invalid-and-note-boundary", async (page) => {
    await page.goto(miniUrl({ screen: "cart", device: "375" }), { waitUntil: "load" });
    expect((await page.locator(".cart-card.is-invalid").first().innerText()).includes("不计入合计"), "不可售 SKU 未标记为不计入合计");
    await page.click('[data-action="checkout"]');
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.screen === "cart", "B8 购物车错误进入 checkout");
    expect((await page.locator("#toast").innerText()).includes("B9 开放"), "B8 购物车未明确结算阶段边界");
  });

  await run("mini-interaction-active-public-catalog", async (page) => {
    await page.goto(miniUrl({ screen: "home", device: "375" }), { waitUntil: "load" });
    expect(await page.locator('[data-open-product="sunscreen"]').count() === 0, "INACTIVE 防晒商品仍在首页公开目录出现");
    expect(await page.locator('[data-open-product="laundry"][data-salable="false"]').count() >= 1, "ACTIVE 零库存商品未以售罄状态保留在公开目录");
    await page.locator('[data-open-product="laundry"]').first().click();
    expect((await page.locator(".product-summary").innerText()).includes("暂时售罄"), "ACTIVE 零库存商品详情未展示售罄状态");
    expect(await page.locator('[data-sku-intent="cart"]').isDisabled() && await page.locator('[data-sku-intent="buy"]').isDisabled(), "售罄商品仍允许加购或立即购买");
    await page.click('[data-action="open-sku"]');
    expect(await page.locator('[data-action="confirm-sku"]').isDisabled(), "售罄 ACTIVE SKU 仍允许确认选择");
    await page.goto(miniUrl({ screen: "home", device: "375", home: "partial" }), { waitUntil: "load" });
    expect(await page.locator('[data-home-section="categories"][data-status="UNAVAILABLE"]').isVisible(), "首页单区失败未返回 UNAVAILABLE 可见状态");
    expect(await page.locator('[data-home-section="hot_products"][data-status="READY"] .product-card').count() > 0, "首页单区失败错误阻断了 READY 热销区");
    await page.click('[data-action="retry-home-section"]');
    expect(await page.locator('[data-home-section="categories"][data-status="READY"] .category-tile').count() === 8, "首页失败区重试后未恢复全部 ACTIVE 分类");
    await page.goto(miniUrl({ screen: "home", device: "375" }), { waitUntil: "load" });
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
    expect(await page.locator('[data-cart-sku="SKU-SUN-50"][data-sale-status="INACTIVE"].is-invalid').count() === 1 && (await page.locator('[data-cart-sku="SKU-SUN-50"]').innerText()).includes("已下架"), "同一 INACTIVE SKU 未在购物车保留失效提示");
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
    const initialSnapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const expectedLegalTypes = "PHONE_AUTHORIZATION,PRIVACY_POLICY,USER_AGREEMENT";
    const expectedLegalFields = "content_url,document_version,required,title,type";
    expect(initialSnapshot.legalDocuments.map(({ type }) => type).sort().join(",") === expectedLegalTypes, "服务端 current legal snapshot 未固定为三份法务文档");
    expect(initialSnapshot.legalDocuments.every((document) => Object.keys(document).sort().join(",") === expectedLegalFields && document.required === true && /^https:\/\//.test(document.content_url)), "法务文档快照字段、required 或 HTTPS content_url 与契约不一致");
    const initialLegalVersions = Object.fromEntries(initialSnapshot.legalDocuments.map((document) => [document.type, document.document_version]));
    expect(await page.locator('[data-legal-snapshot="current"] [data-legal-version]').count() === 2, "登录页未展示服务端 current legal snapshot 的 exact set");
    expect(await page.locator('[data-legal-snapshot="current"] [data-legal-url]').evaluateAll((nodes) => nodes.every((node) => /^https:\/\//.test(node.dataset.legalUrl))) && !(await page.locator(".auth-body").innerText()).includes("Mock"), "登录协议缺少 HTTPS content_url 或生产界面暴露开发 Mock Provider");
    expect(await page.locator('[data-legal-version="USER_AGREEMENT"]').innerText() === `版本 ${initialLegalVersions.USER_AGREEMENT}` && await page.locator('[data-legal-version="PRIVACY_POLICY"]').innerText() === `版本 ${initialLegalVersions.PRIVACY_POLICY}`, "登录页展示的协议版本与服务端快照不一致");
    await page.click('[data-action="mock-login"]');
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === false && snapshot.screen === "login", "未勾选协议仍完成了登录");
    await page.click('[data-action="toggle-consent"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.acceptedConsents.map(({ type }) => type).sort().join(",") === "PRIVACY_POLICY,USER_AGREEMENT", "登录同意项不是用户协议与隐私政策 exact set");
    expect(snapshot.acceptedConsents.every((consent) => snapshot.legalDocuments.some((document) => document.type === consent.type && document.document_version === consent.document_version)), "登录同意项未绑定当前协议版本");
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateLegalRevision());
    await page.click('[data-action="mock-login"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === false && snapshot.consentAccepted === false && snapshot.acceptedConsents.length === 0, "协议版本冲突后未刷新并清除旧同意");
    await page.click('[data-action="toggle-consent"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateLoginFailure("RATE_LIMITED"));
    await page.click('[data-action="mock-login"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === false && snapshot.loginError?.error_code === "RATE_LIMITED", "登录限流错误地创建了会话或丢失错误码");
    expect(await page.locator('[data-login-status="429"][data-error-code="RATE_LIMITED"][data-retry-after="47"]').count() === 1, "登录 429 未展示准确 Retry-After");
    await page.click('[data-action="retry-login"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateLoginFailure("PROVIDER_ERROR"));
    await page.click('[data-action="mock-login"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === false && snapshot.loginError?.error_code === "INTERNAL_ERROR", "Provider 失败未收敛为公开 INTERNAL_ERROR 或错误创建会话");
    expect(await page.locator('[data-login-status="500"][data-error-code="INTERNAL_ERROR"]').count() === 1, "登录 500 未使用闭合公开错误码");
    await page.click('[data-action="retry-login"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "product");
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().favorites.filter((favorite) => favorite.productId === "shampoo").length === 1);
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === true && snapshot.authProvider === "MOCK", "勾选当前协议后未通过开发态 Mock Provider 完成登录");
    expect(snapshot.favorites.filter((favorite) => favorite.productId === "shampoo").length === 1, "B8 登录后未恢复收藏或重复执行收藏");
    expect((await page.locator("#toast").innerText()).includes("已收藏商品"), "登录后收藏未返回明确成功反馈");

    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "account"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    const profileVersion = (await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState())).profile.version;
    await page.click('[data-action="edit-profile"]');
    expect(Number(await page.locator("#profileForm").getAttribute("data-if-match-version")) === profileVersion, "资料编辑未绑定当前 If-Match 版本");
    await page.fill('#profileForm input[name="nickname"]', "  林青禾  ");
    await page.fill('#profileForm input[name="avatar_url"]', "https://cdn.qingxu.example/avatar/customer.png");
    await page.fill('#profileForm input[name="city"]', "  杭州  ");
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateProfileConflict());
    await page.click('#profileForm button[type="submit"]');
    await page.waitForFunction((version) => window.__MINIAPP_PROTOTYPE__.getState().profile.version === version + 1, profileVersion);
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.profile.nickname === "林青" && snapshot.profileConflictNext === false, "资料 409 未刷新服务端版本或错误覆盖用户输入");
    await page.waitForFunction(() => document.querySelector("#bottomSheet")?.hidden === true);
    await page.click('[data-action="edit-profile"]');
    await page.fill('#profileForm input[name="nickname"]', "  林青禾  ");
    await page.fill('#profileForm input[name="avatar_url"]', "https://cdn.qingxu.example/avatar/customer.png");
    await page.fill('#profileForm input[name="city"]', "  杭州  ");
    await page.click('#profileForm button[type="submit"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().profile.nickname === "林青禾");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.profile.city === "杭州" && snapshot.profile.avatar_url.startsWith("https://") && snapshot.profile.version === profileVersion + 2, "资料重确认未 trim 保存或 version 未递增");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "profile"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    await page.locator('.profile-page [data-screen="favorites"]').first().click();
    expect((await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState().screen)) === "favorites", "个人中心收藏入口未开放");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "profile"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    await page.locator('.profile-page [data-screen="addresses"]').first().click();
    expect((await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState().screen)) === "addresses", "个人中心地址入口未开放");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "profile"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    await page.locator('[data-action="deferred-feature"][data-feature="订单"]').first().click();
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.screen === "profile" && (await page.locator("#toast").innerText()).includes("后续阶段开放"), "订单入口错误进入 B9 业务或伪造成功");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "account"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    await page.click('[data-action="logout"]');
    await page.click('[data-action="confirm-logout"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "login");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === false && snapshot.authProvider === null && snapshot.profile.nickname === "林青禾", "退出当前会话未清除登录态或错误删除账户资料");
  });

  await run("mini-interaction-binding-ttl", async (page) => {
    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", binding: "unbound", invite: "QX-A1026" }), { waitUntil: "load" });
    const loginText = await page.locator("body").innerText();
    expect(loginText.includes("候选剩余") && loginText.includes("清悦日用馆"), "登录页未展示代理候选 TTL 与代理名称");
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const candidateFields = "agent_id,attribution_eligible,candidate_id,confirmation_required,display_name,expires_at,public_target_url,remaining_seconds";
    expect(Object.keys(snapshot.inviteCandidate || {}).sort().join(",") === candidateFields && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(snapshot.inviteCandidate.candidate_id) && /^https:\/\/.{1,492}$/.test(snapshot.inviteCandidate.public_target_url) && !("candidate_token" in snapshot.inviteCandidate), "候选投影字段、ULID、HTTPS 目标或 token 暴露与契约不一致");
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForSelector('.bottom-sheet.is-visible [data-action="confirm-agent-binding"]');
    expect((await page.locator(".bottom-sheet").innerText()).includes("候选剩余") && await page.locator('[data-public-target-url^="https://"]').count() === 1, "绑定确认层缺少候选剩余时间或服务端公开目标");
    await page.click('[data-action="decline-agent-binding"]');
    expect(await page.locator('[data-binding-decision-status="PENDING"] button:disabled').count() === 2, "候选拒绝未进入 pending 或未防止重复提交");
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().inviteCandidate === null);
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === true && snapshot.agentBindingStatus === "unbound" && snapshot.inviteCandidate === null, "登录后的候选拒绝未清空候选");

    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", binding: "unbound", invite: "QX-A1026" }), { waitUntil: "load" });
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForSelector('.bottom-sheet.is-visible [data-action="confirm-agent-binding"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateCandidateMismatch());
    await page.click('[data-action="decline-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().candidateDecisionStatus === "ERROR");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.inviteCandidate !== null && snapshot.agentBindingStatus !== "bound" && await page.locator('[data-binding-status="409"][data-error-code="ATTRIBUTION_CANDIDATE_MISMATCH"]').count() === 1, "候选拒绝 mismatch 未以 409 停止或错误清空候选");
    await page.click('[data-action="decline-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().inviteCandidate === null);

    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", binding: "unbound", invite: "QX-A1026" }), { waitUntil: "load" });
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForSelector('.bottom-sheet.is-visible [data-action="confirm-agent-binding"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateCandidateMismatch());
    await page.click('[data-action="confirm-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().candidateDecisionStatus === "ERROR");
    expect(await page.locator('[data-binding-status="409"][data-error-code="ATTRIBUTION_CANDIDATE_MISMATCH"]').count() === 1, "候选确认 mismatch 未以 409 要求重新确认");
    await page.click('[data-action="confirm-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().agentBindingStatus === "bound");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.serviceAgent.agent_id === "AGT-01026" && snapshot.inviteCandidate === null, "确认绑定后代理或候选清理错误");
    expect(Object.keys(snapshot.serviceAgent).sort().join(",") === "agent_id,bound_at,display_name", "服务代理响应超出 agent_id/display_name/bound_at 最小投影");
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(snapshot.serviceAgent.bound_at), "服务代理 bound_at 不是 RFC3339 date-time");
    await page.click('.profile-page [data-screen="service-agent"]');
    const serviceAgentText = await page.locator(".service-agent-body").innerText();
    expect(serviceAgentText.includes("清悦日用馆") && serviceAgentText.includes("绑定时间"), "服务代理页未展示 display_name 与 bound_at");
    expect(!serviceAgentText.includes("AGT-01026") && !serviceAgentText.includes("服务联系") && !serviceAgentText.includes("服务编号"), "服务代理页泄露内部 ID 或联系方式");

    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", binding: "unbound", invite: "QX-A1026" }), { waitUntil: "load" });
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForSelector('.bottom-sheet.is-visible [data-action="confirm-agent-binding"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateCandidateExpired());
    await page.click('[data-action="confirm-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().inviteCandidate === null);
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.agentBindingStatus === "unbound" && snapshot.serviceAgent === null, "过期候选仍被绑定或未进入无候选状态");

    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", binding: "unbound", invite: "QX-A1026" }), { waitUntil: "load" });
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForSelector('.bottom-sheet.is-visible [data-action="confirm-agent-binding"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateCandidateConcurrentWinner());
    await page.click('[data-action="confirm-agent-binding"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().agentBindingStatus === "bound");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.serviceAgent.agent_id === "AGT-01038" && snapshot.inviteCandidate === null && /^\d{4}-\d{2}-\d{2}T/.test(snapshot.serviceAgent.bound_at), "并发确认未保留首个胜出绑定或时间投影非 RFC3339");
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
    const defaultAddressId = await page.locator('.saved-address.is-selected [data-address-edit]').getAttribute('data-address-edit');
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(defaultAddressId || ""), "地址操作未使用 ULID");
    await page.click(`[data-address-edit="${defaultAddressId}"]`);
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "address-edit");
    expect(await page.inputValue('input[name="recipient"]') === "林青", "本人地址编辑页未加载完整收件人");
    expect(await page.inputValue('input[name="phone"]') === "13852185218", "本人地址编辑页未加载完整手机号");
    expect(await page.inputValue('input[name="province"]') === "浙江省" && await page.inputValue('input[name="city"]') === "杭州市" && await page.inputValue('input[name="district"]') === "西湖区", "地址编辑页未拆分省市区字段");
    expect(await page.inputValue('textarea[name="detail"]') === "文三路 88 号 2 幢 1102 室", "本人地址编辑页未加载完整门牌地址");
    expect(Number(await page.locator('#addressForm').getAttribute('data-if-match-version')) === 3, "地址编辑未绑定当前 If-Match 版本");
    await page.fill('input[name="phone"]', "13900001234");
    await page.click('#addressForm button[type="submit"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "addresses");
    expect(!(await page.locator(".address-list").innerText()).includes("13900001234"), "地址保存后列表泄露完整手机号");
    const snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone === null, "修改收货地址手机号错误写入账户手机号");
    expect(snapshot.addresses.some((address) => address.phone === "13900001234"), "地址手机号未保存");
  });

  await run("mini-interaction-b8-shopping-states", async (page) => {
    await page.goto(miniUrl({ screen: "favorites", device: "375" }), { waitUntil: "load" });
    const favoriteStatuses = await page.locator('[data-favorite-status]').evaluateAll((nodes) => nodes.map((node) => node.dataset.favoriteStatus).sort());
    expect(favoriteStatuses.join(",") === "OUT_OF_STOCK,SALEABLE,UNAVAILABLE", "收藏未覆盖闭合三状态");
    expect(await page.locator('[data-favorite-id]').first().getAttribute('data-favorite-id') === "01ARZ3NDEKTSV4RRFFQ69G5FB1", "收藏同时间戳未按 id DESC 稳定排序");
    expect((await page.locator('[data-favorite-status="UNAVAILABLE"]').innerText()).includes("价格不可用"), "失效收藏未保留安全空价格投影");
    await page.fill('#favoriteSearchInput', '洗衣');
    await page.locator('#favoriteSearchForm').evaluate((form) => form.requestSubmit());
    expect(await page.locator('[data-favorite-status]').count() === 1 && (await page.locator('.favorite-list').innerText()).includes("洗衣凝珠"), "收藏搜索未只匹配商品名");
    await page.click('[data-action="clear-favorite-search"]');
    await page.locator('[data-remove-favorite="serum"]').click();
    expect(await page.locator('[data-remove-favorite="serum"]').isDisabled(), "取消收藏 pending 未禁用重复提交");
    await page.waitForFunction(() => !window.__MINIAPP_PROTOTYPE__.getState().favorites.some((favorite) => favorite.productId === "serum"));

    await page.goto(miniUrl({ screen: "login", device: "375", auth: "guest", cart: "guest-merge" }), { waitUntil: "load" });
    const guestCartBeforeLogin = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState().guestCart);
    expect(guestCartBeforeLogin.length === 2, "登录前未保留精确游客购物车条目");
    await page.click('[data-action="toggle-consent"]');
    await page.click('[data-action="mock-login"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().cartMergeJournal?.status === "RETRY");
    let mergeSnapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const mergeKey = mergeSnapshot.cartMergeJournal.idempotencyKey;
    expect(mergeKey === "b8-guest-cart-merge-0001", "登录合并未创建固定幂等键");
    expect(JSON.stringify(mergeSnapshot.cartMergeJournal.items) === JSON.stringify(guestCartBeforeLogin), "合并 journal 未保存精确本地条目");
    expect(JSON.stringify(mergeSnapshot.guestCart) === JSON.stringify(guestCartBeforeLogin), "网络丢包后提前删除了本地条目");
    expect(mergeSnapshot.cart.find((item) => item.skuId === "SKU-SER-30").quantity === 1 && !mergeSnapshot.cart.some((item) => item.skuId === "SKU-SHA-500"), "合并未确认时服务端投影被提前修改");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "cart"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    expect(await page.locator('[data-merge-status="RETRY"]').count() === 1, "游客购物车合并失败未保留同键重试提示");
    const statuses = await page.locator('[data-sale-status]').evaluateAll((nodes) => nodes.map((node) => node.dataset.saleStatus).sort());
    expect(statuses.join(",") === "DELETED,INACTIVE,INSUFFICIENT_STOCK,OUT_OF_STOCK,SALEABLE", "服务端购物车未覆盖闭合五状态");
    expect((await page.locator('.summary-price').innerText()).includes("¥168"), "购物车合计错误包含未选或不可售项");
    await page.click('[data-action="retry-cart-merge"]');
    expect(await page.locator('[data-merge-status="MERGED"]').count() === 1, "购物车未使用原幂等键收敛合并");
    mergeSnapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(mergeSnapshot.cartMergeJournal.idempotencyKey === mergeKey && mergeSnapshot.cartMergeJournal.serverConfirmed === true, "合并重试更换幂等键或未得到服务端确认");
    expect(mergeSnapshot.guestCart.length === 0, "服务端确认后未精确删除已合并本地条目");
    expect(mergeSnapshot.cart.find((item) => item.skuId === "SKU-SER-30").quantity === 3 && mergeSnapshot.cart.find((item) => item.skuId === "SKU-SER-30").selected === true, "existing OR incoming 或数量累加结果错误");
    expect(mergeSnapshot.cart.find((item) => item.skuId === "SKU-SHA-500").quantity === 1, "新游客 SKU 未合入服务端投影");
    const mergedCart = JSON.stringify(mergeSnapshot.cart);
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.action = "retry-cart-merge"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    mergeSnapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(JSON.stringify(mergeSnapshot.cart) === mergedCart && mergeSnapshot.cartMergeJournal.idempotencyKey === mergeKey, "同键重放重复累加购物车");
    await page.goto(miniUrl({ screen: "cart", device: "375", cart: "limit" }), { waitUntil: "load" });
    expect((await page.locator('[data-cart-sku="SKU-SER-30"] .quantity-stepper').innerText()).includes("99"), "购物车未展示 99 数量上限");
    await page.locator('[data-cart-sku="SKU-SER-30"] [data-delta="1"]').click();
    expect((await page.locator('[data-cart-sku="SKU-SER-30"] .quantity-stepper').innerText()).includes("99"), "购物车允许数量超过 99");
    await page.goto(miniUrl({ screen: "cart", device: "375", cart: "empty" }), { waitUntil: "load" });
    expect(await page.locator('.empty-state[data-cart-id=""]').count() === 1 && (await page.locator('.empty-state').innerText()).includes("尚未创建购物车"), "空购物车 GET 未表达 cart_id=null 与无写入");
  });

  await run("mini-interaction-b8-address-conflicts", async (page) => {
    await page.goto(miniUrl({ screen: "addresses", device: "375" }), { waitUntil: "load" });
    const defaultAddressId = await page.locator('.saved-address.is-selected [data-address-edit]').getAttribute('data-address-edit');
    await page.click(`[data-address-edit="${defaultAddressId}"]`);
    await page.click('[data-action="toggle-address-default"]');
    await page.click('#addressForm button[type="submit"]');
    expect(await page.locator('[data-address-error-code="DEFAULT_ADDRESS_REQUIRED"]').count() === 1, "取消唯一默认地址未展示 422 约束");
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateAddressConflict());
    await page.click('#addressForm button[type="submit"]');
    expect(await page.locator('[data-address-error-code="RESOURCE_VERSION_CONFLICT"]').count() === 1, "地址 If-Match 冲突未刷新并要求重确认");
  });

  await run("mini-interaction-phone-privacy", async (page) => {
    await page.goto(miniUrl({ screen: "phone-authorization", device: "375" }), { waitUntil: "load" });
    await page.click('[data-action="authorize-phone"]');
    expect(await page.locator('[data-action="confirm-phone-mutation"]:disabled').count() === 1, "未同意手机号授权声明时错误允许提交");
    await page.click('[data-action="toggle-phone-consent"]');
    let snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    const initialPhoneLegalDocument = snapshot.legalDocuments.find(({ type }) => type === "PHONE_AUTHORIZATION");
    expect(JSON.stringify(snapshot.phoneAuthorizationConsent) === JSON.stringify({ type: "PHONE_AUTHORIZATION", document_version: initialPhoneLegalDocument.document_version, accepted: true }), "手机号授权未保存 exact PHONE_AUTHORIZATION 同意元组");
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulatePhoneFailure());
    await page.click('[data-action="confirm-phone-mutation"]');
    expect(await page.locator('[data-phone-status="PENDING"] [data-action="confirm-phone-mutation"]:disabled').count() === 1, "手机号授权未进入 pending 或未防重复提交");
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().phoneMutation.status === "ERROR");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone === null && snapshot.phoneMutation.error === "INTERNAL_ERROR", "手机号 Provider 失败未保留原资料或泄露非公开错误码");

    const versionBeforeConflict = snapshot.profile.version;
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulatePhoneConflict());
    await page.click('[data-action="confirm-phone-mutation"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().phoneMutation.status === "CONFLICT");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone === null && snapshot.profile.version === versionBeforeConflict + 1 && snapshot.phoneMutation.error === "RESOURCE_VERSION_CONFLICT", "手机号 If-Match 409 未刷新 profile version 或错误覆盖资料");
    expect(Number(await page.locator('.phone-mutation-sheet').getAttribute("data-if-match-version")) === snapshot.profile.version, "手机号 409 后未绑定刷新的 If-Match 版本");
    await page.click('[data-action="confirm-phone-mutation"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().verifiedPhone !== null);
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone?.phone_source === "MOCK" && snapshot.verifiedPhone?.phone_masked === "138 **** 5218" && snapshot.verifiedPhone?.phone_tail === "5218", "development 手机号授权未保存 Mock 来源或服务端脱敏投影");
    const phoneLegalDocument = snapshot.legalDocuments.find(({ type }) => type === "PHONE_AUTHORIZATION");
    expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(snapshot.verifiedPhone?.phone_verified_at) && Object.keys(snapshot.verifiedPhone).sort().join(",") === "phone_masked,phone_source,phone_tail,phone_verified_at", "手机号授权响应字段漂移、非 RFC3339 或保留了契约外敏感字段");
    expect(await page.locator('[data-phone-legal-snapshot="current"] [data-legal-type="PHONE_AUTHORIZATION"][data-legal-url]').evaluate((node) => /^https:\/\//.test(node.dataset.legalUrl)) && await page.locator('[data-legal-version="PHONE_AUTHORIZATION"]').innerText() === `版本 ${phoneLegalDocument?.document_version}`, "手机号授权页未展示与服务端 document_version/HTTPS content_url 一致的当前授权声明");
    expect((await page.locator(".account-phone").innerText()).includes("138 **** 5218") && !(await page.locator(".account-phone").innerText()).includes("13852185218"), "手机号授权页未使用脱敏号码");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "profile"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    expect((await page.locator(".profile-user").innerText()).includes("138 **** 5218") && !(await page.locator(".profile-user").innerText()).includes("13852185218"), "Profile 未直接消费服务端 phone_masked");
    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "phone-authorization"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    const revokeVersion = (await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState())).profile.version;
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulatePhoneConflict());
    await page.click('[data-action="revoke-phone"]');
    await page.click('[data-action="confirm-phone-mutation"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().phoneMutation.status === "CONFLICT");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone !== null && snapshot.profile.version === revokeVersion + 1 && snapshot.phoneMutation.error === "RESOURCE_VERSION_CONFLICT", "撤回手机号的 If-Match 409 错误清除当前号码");
    await page.click('[data-action="confirm-phone-mutation"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().verifiedPhone === null);
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.verifiedPhone === null && (await page.locator(".account-phone").innerText()).includes("未绑定"), "撤回手机号授权后仍保留当前号码");

    await page.click('[data-action="authorize-phone"]');
    await page.click('[data-action="toggle-phone-consent"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateLegalRevision());
    await page.click('[data-action="confirm-phone-mutation"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.phoneMutation.status === "CONFLICT" && snapshot.phoneMutation.error === "CONSENT_VERSION_MISMATCH" && snapshot.phoneAuthorizationConsent === null && snapshot.verifiedPhone === null, "手机号授权声明版本冲突未以 409 刷新或错误授权");
    expect(await page.locator('[data-phone-error-code="CONSENT_VERSION_MISMATCH"]').count() === 1, "手机号协议 409 未展示闭合错误码");
    await page.click('[data-action="toggle-phone-consent"]');
    await page.click('[data-action="confirm-phone-mutation"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().verifiedPhone !== null);

    await page.evaluate(() => { const probe = document.createElement("button"); probe.dataset.screen = "account-deletion"; document.body.appendChild(probe); probe.click(); probe.remove(); });
    expect(await page.locator('[data-action="request-account-deletion"]').count() === 0, "未检查注销资格时错误开放确认");
    await page.click('[data-action="preview-account-deletion"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.deletionEligibility.checked === true && snapshot.deletionEligibility.eligible === false, "存在未完成业务时注销预览错误返回可确认");
    expect(snapshot.deletionEligibility.blockers.length > 0 && snapshot.deletionEligibility.impacts.length > 0 && snapshot.deletionEligibility.confirmation_expires_in_seconds === null, "blocked 注销预览未返回 blockers/impacts 或错误签发确认能力");
    expect(await page.locator('[data-preview-status="200"][data-eligible="false"]:not([data-error-code])').count() === 1 && await page.locator('[data-action="request-account-deletion"]').count() === 0, "blocked 注销预览未保持 OK/200 展示、错误附带 confirm 错误码或错误开放 confirm");
    expect(snapshot.deletionEligibility.blockers.map(({ resource_type }) => resource_type).sort().join(",") === "AFTERSALE,FINANCIAL_ANOMALY,ORDER,PAYMENT,REFUND", "blocked 注销预览未覆盖五类闭合 blocker");
    await page.click('[data-action="simulate-deletion-eligible"]');
    await page.click('[data-action="preview-account-deletion"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.deletionEligibility.eligible === true && snapshot.deletionEligibility.blockers.length === 0 && snapshot.deletionEligibility.confirmation_expires_in_seconds === 300, "eligible 注销预览未签发 5 分钟确认能力");
    await page.click('[data-action="request-account-deletion"]');
    await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.simulateDeletionBlocker());
    await page.click('[data-action="confirm-account-deletion"]');
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.loggedIn === true && snapshot.accountDeleted === false && snapshot.deletionEligibility.eligible === false, "注销确认未重检或新增阻断项未以 422 语义停止");
    expect(await page.locator('[data-confirm-status="422"][data-error-code="ACCOUNT_DELETION_BLOCKED"]').count() === 1 && snapshot.deletionEligibility.blockers[0].resource_type === "PAYMENT", "确认重检阻断未使用 422 ACCOUNT_DELETION_BLOCKED 或闭合 blocker 类型");
    expect(await page.locator('[data-action="request-account-deletion"]').count() === 0, "确认重检失败后仍保留旧确认能力");

    await page.click('[data-action="simulate-deletion-eligible"]');
    await page.click('[data-action="preview-account-deletion"]');
    await page.click('[data-action="request-account-deletion"]');
    await page.click('[data-action="confirm-account-deletion"]');
    await page.waitForFunction(() => window.__MINIAPP_PROTOTYPE__.getState().screen === "login");
    snapshot = await page.evaluate(() => window.__MINIAPP_PROTOTYPE__.getState());
    expect(snapshot.accountDeleted === true && snapshot.loggedIn === false && snapshot.authProvider === null, "同步注销后未清除本地会话并返回未登录态");
    expect(snapshot.verifiedPhone === null && snapshot.serviceAgent === null && snapshot.addresses.length === 0 && snapshot.favorites.length === 0 && snapshot.cart.length === 0, "同步注销后仍保留当前资料或偏好");
    expect(!("deletionRequested" in snapshot) && !(await page.locator("body").innerText()).includes("处理中"), "账号注销仍保留异步申请或处理中状态");
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
    expect(await page.locator("#productCodeInput").isDisabled(), "已创建 SPU code 仍可修改");
    expect(await page.locator("#productOnlineInput, #publishProduct").count() === 0, "商品普通编辑仍可直接改变生命周期或保存即发布");
    await page.fill("#productNameInput", "沐光动态绑定洗发水");
    await page.click("#saveProduct");
    await page.waitForFunction(() => document.querySelector('[data-view="products"]').classList.contains('active'));
    expect((await page.locator('tr[data-product-id="2"] .product-cell-copy strong').innerText()).includes("动态绑定"), "商品编辑保存未写回当前记录");
    expect((await page.locator('tr[data-product-id="2"] .product-status').getAttribute("data-status-code")) === "ACTIVE", "普通资料保存错误改变商品状态");

    await page.click("#openCreateProduct");
    expect((await page.locator("#productEditStatus").getAttribute("data-status-code")) === "DRAFT", "商品创建未固定为 DRAFT");
    expect(await page.locator("#productCodeInput").isEnabled(), "商品创建时 SPU code 不可填写");
    expect((await page.locator("#productImageCount").innerText()) === "0 / 8", "新商品图集计数未从 0 开始或未限制 8 张");
    expect(await page.locator("#skuRows tr").count() === 0, "商品创建被错误强制内嵌 SKU");
    await page.fill("#productNameInput", "CH-010 自动化商品");
    await page.fill("#productCodeInput", "CH010-PRODUCT");
    await page.click("#saveProduct");
    await page.waitForFunction(() => document.querySelector('[data-view="products"]').classList.contains('active'));
    let productRow = page.locator("#productRows tr", { hasText: "CH-010 自动化商品" });
    expect(await productRow.count() === 1 && (await productRow.locator(".product-status").getAttribute("data-status-code")) === "DRAFT" && (await productRow.innerText()).includes("暂无活动价"), "商品未以 DRAFT 和 nullable 最低活动价写回");
    const productId = await productRow.getAttribute("data-product-id");

    await productRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("至少需要一张可公开展示的商品图片"), "无图商品启用预览未展示中文业务阻断");
    expect((await page.locator("#highRiskDiagnosticCode").getAttribute("data-error-code")) === "PRODUCT_PRIMARY_IMAGE_REQUIRED", "无图商品预览未在折叠诊断中保留 PRODUCT_PRIMARY_IMAGE_REQUIRED");
    expect(!(await page.locator("#highRiskImpact").innerText()).includes("PRODUCT_PRIMARY_IMAGE_REQUIRED"), "商品主提示泄露技术错误码");
    await page.fill("#highRiskReason", "验证缺少主图阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "PRODUCT_PRIMARY_IMAGE_REQUIRED" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "422", "无图商品确认未保留 typed 422 诊断");
    expect((await page.locator("#highRiskError").innerText()).includes("至少需要一张"), "无图商品确认未显示可执行的中文原因");
    expect((await page.locator("#highRiskRepair").innerText()).includes("上传商品图片"), "无图商品缺少直接修复入口");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "无图商品 422 后旧 preview 或确认仍可复用");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-view="product-edit"]').evaluate((node) => node.classList.contains("active")) && await page.locator('[data-edit-panel="basic"]').evaluate((node) => node.classList.contains("active")), "主图阻断修复入口未定位商品图集");
    await page.click("#uploadProductImage");
    expect((await page.locator("#productImageCount").innerText()) === "1 / 8", "商品图片上传未写回图集计数");
    await page.click("#saveProduct");
    await page.waitForFunction(() => document.querySelector('[data-view="products"]').classList.contains('active'));
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    await productRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("至少需要一个已启用的 SKU"), "无已启用 SKU 商品的启用预览未展示业务阻断");
    expect((await page.locator("#highRiskDiagnosticCode").getAttribute("data-error-code")) === "PRODUCT_ACTIVE_SKU_REQUIRED", "无已启用 SKU 预览未保留 PRODUCT_ACTIVE_SKU_REQUIRED");
    await page.fill("#highRiskReason", "验证缺少已启用 SKU 阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "PRODUCT_ACTIVE_SKU_REQUIRED" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "422", "无已启用 SKU 确认未保留 typed 422 诊断");
    expect((await page.locator("#highRiskRepair").innerText()).includes("管理 SKU"), "无已启用 SKU 阻断缺少修复入口");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "无已启用 SKU 422 后旧 preview 或确认仍可复用");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-edit-panel="sku"]').evaluate((node) => node.classList.contains("active")), "已启用 SKU 阻断修复入口未定位 SKU 管理");
    await page.click('[data-edit-tab="sku"]');
    await page.click("#addSku");
    const draftSkuRow = page.locator("#skuRows tr").first();
    await draftSkuRow.locator('[data-sku-field="spec"]').fill("标准装");
    await draftSkuRow.locator('[data-sku-field="id"]').fill("CH010-SKU");
    await draftSkuRow.locator('[data-sku-field="price"]').fill("59.00");
    expect((await draftSkuRow.locator("[data-status-code]").getAttribute("data-status-code")) === "INACTIVE" && (await draftSkuRow.innerText()).includes("实物 0"), "新 SKU 未声明固定 INACTIVE 或零库存");
    await page.click("#saveProduct");
    await page.waitForFunction(() => document.querySelector('[data-view="products"]').classList.contains('active'));
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    expect((await productRow.innerText()).includes("暂无活动价"), "只有 INACTIVE SKU 时最低活动价未返回空值");

    await productRow.locator(".edit-product").click();
    await page.click('[data-edit-tab="sku"]');
    let skuRow = page.locator('tr[data-sku-id="CH010-SKU"]');
    expect((await skuRow.locator("[data-status-code]").getAttribute("data-status-code")) === "INACTIVE" && await skuRow.locator('[data-sku-field="stock"]').count() === 0, "SKU 创建状态错误或库存仍可编辑");
    expect(await skuRow.locator('[data-sku-field="id"]').isDisabled(), "已创建 SKU code 仍可修改");
    await skuRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("已停用 → 已启用"), "SKU 启用未先展示中文影响预览");
    await page.locator("#highRiskDiagnostics summary").click();
    await page.click("#simulateHighRiskConflict");
    const skuVersionAfterConcurrentUpdate = await page.evaluate((id) => window.__ADMIN_PROTOTYPE__.getState().productSkus[Number(id)][0].version, productId);
    await page.fill("#highRiskReason", "验证 SKU 并发版本冲突"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "RESOURCE_VERSION_CONFLICT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "409", "SKU 并发确认未进入 typed 409");
    expect((await page.locator("#highRiskError").innerText()).includes("已刷新至最新版本"), "SKU 409 未向管理员说明已刷新最新资源");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null), "SKU 409 后旧 preview 仍可复用");
    expect((await page.locator('tr[data-sku-id="CH010-SKU"] [data-status-code]').getAttribute("data-status-code")) === "INACTIVE", "SKU 409 后错误覆盖了最新状态");
    expect(skuVersionAfterConcurrentUpdate > 1 && await page.locator("#confirmHighRisk").isDisabled(), "SKU 409 未刷新版本或未禁用旧确认");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-edit-panel="sku"]').evaluate((node) => node.classList.contains("active")), "SKU 409 后未返回最新 SKU 记录");
    skuRow = page.locator('tr[data-sku-id="CH010-SKU"]');
    await skuRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    await page.fill("#highRiskReason", "SKU 资料与价格已核对"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    skuRow = page.locator('tr[data-sku-id="CH010-SKU"]');
    expect((await skuRow.locator("[data-status-code]").getAttribute("data-status-code")) === "ACTIVE", "SKU ACTIVATE 确认未生效");
    await page.click('[data-go="products"]');
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    expect((await productRow.locator(".product-minimum-price").innerText()) === "¥59.00", "最低活动价未使用 ACTIVE SKU 最低零售价");

    await productRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("草稿 → 已启用"), "商品启用未先展示中文影响预览");
    await page.locator("#highRiskDiagnostics summary").click();
    await page.click("#simulateHighRiskConflict");
    const productVersionAfterConcurrentUpdate = await page.evaluate((id) => window.__ADMIN_PROTOTYPE__.getState().products.find((item) => item.id === Number(id)).version, productId);
    await page.fill("#highRiskReason", "验证商品并发版本冲突"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "RESOURCE_VERSION_CONFLICT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "409", "商品并发确认未进入 typed 409");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null), "商品 409 后旧 preview 仍可复用");
    expect((await page.locator(`tr[data-product-id="${productId}"] .product-status`).getAttribute("data-status-code")) === "DRAFT", "商品 409 后错误覆盖了最新状态");
    expect(productVersionAfterConcurrentUpdate > 1 && await page.locator("#confirmHighRisk").isDisabled(), "商品 409 未刷新版本或未禁用旧确认");
    await page.click("#highRiskRepair");
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    await productRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    await page.fill("#highRiskReason", "商品图集与活动 SKU 已就绪"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    expect((await productRow.locator(".product-status").getAttribute("data-status-code")) === "ACTIVE" && await productRow.locator('[data-lifecycle-action="SOFT_DELETE"]').count() === 0, "ACTIVE 商品状态错误或仍允许直接归档");
    const firstPublishedAt = (await page.evaluate((id) => window.__ADMIN_PROTOTYPE__.getState().products.find((item) => item.id === Number(id)).publishedAt, productId));
    expect(Boolean(firstPublishedAt), "首次 ACTIVATE 未写入 published_at");

    for (const [action, reason] of [["DEACTIVATE", "暂停商品公开展示"], ["ACTIVATE", "重新启用商品"]]) {
      await productRow.locator(`[data-lifecycle-action="${action}"]`).click();
      await page.fill("#highRiskReason", reason); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
      await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
      productRow = page.locator(`tr[data-product-id="${productId}"]`);
    }
    const republishedAt = await page.evaluate((id) => window.__ADMIN_PROTOTYPE__.getState().products.find((item) => item.id === Number(id)).publishedAt, productId);
    expect(republishedAt === firstPublishedAt, "重新 ACTIVATE 错误覆盖首次 published_at");

    await productRow.locator('[data-lifecycle-action="DEACTIVATE"]').click();
    await page.fill("#highRiskReason", "准备归档测试商品"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    await productRow.locator('[data-lifecycle-action="SOFT_DELETE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("仍有 1 个已启用 SKU"), "商品归档预览未展示已启用 SKU 依赖");
    expect((await page.locator("#highRiskDiagnosticCode").getAttribute("data-error-code")) === "ACTIVE_SKU_DEPENDENCY", "商品归档预览未在折叠诊断中保留 ACTIVE_SKU_DEPENDENCY");
    await page.fill("#highRiskReason", "验证活动 SKU 阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "ACTIVE_SKU_DEPENDENCY" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "422", "商品归档确认未保留 ACTIVE_SKU_DEPENDENCY 422");
    expect((await page.locator("#highRiskRepair").innerText()).includes("停用 SKU"), "已启用 SKU 依赖缺少修复入口");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "SKU 依赖 422 后旧 preview 或确认仍可复用");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-edit-panel="sku"]').evaluate((node) => node.classList.contains("active")), "已启用 SKU 依赖修复入口未定位 SKU 管理");
    await page.click('[data-edit-tab="sku"]');
    skuRow = page.locator('tr[data-sku-id="CH010-SKU"]');
    await skuRow.locator('[data-lifecycle-action="DEACTIVATE"]').click();
    await page.fill("#highRiskReason", "准备归档 SKU"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    skuRow = page.locator('tr[data-sku-id="CH010-SKU"]');
    await skuRow.locator('[data-lifecycle-action="SOFT_DELETE"]').click();
    await page.fill("#highRiskReason", "停止维护测试 SKU"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    skuRow = page.locator('tr[data-sku-id="CH010-SKU"]');
    expect((await skuRow.locator("[data-status-code]").getAttribute("data-status-code")) === "ARCHIVED" && await skuRow.locator(".restore-sku").count() === 1, "归档 SKU 未在商品详情保留或缺少恢复入口");
    await skuRow.locator(".restore-sku").click();
    expect((await page.locator("#restoreResultStatus").innerText()).includes("已停用"), "SKU 恢复未明确固定返回已停用");
    await page.fill("#restoreEntityReason", "恢复测试 SKU"); await page.click("#confirmRestoreEntity");
    expect((await page.locator('tr[data-sku-id="CH010-SKU"] [data-status-code]').getAttribute("data-status-code")) === "INACTIVE", "SKU restore 未恢复为 INACTIVE");
    await page.click('[data-go="products"]');
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    await productRow.locator('[data-lifecycle-action="SOFT_DELETE"]').click();
    await page.fill("#highRiskReason", "停止维护测试商品"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect(await page.locator(`tr[data-product-id="${productId}"]`).count() === 0, "ARCHIVED 商品仍出现在默认列表");
    await page.selectOption("#productStatus", "ARCHIVED");
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    expect(await productRow.count() === 1, "显式 ARCHIVED 筛选未返回软删除商品");
    expect(await productRow.locator(".view-product").count() === 1, "归档商品缺少详情读取入口");
    await productRow.locator(".view-product").click();
    expect((await page.locator("#productEditTitle").innerText()).includes("查看归档商品") && await page.locator("#saveProduct").isHidden(), "归档商品详情未进入只读模式");
    expect(await page.locator("#productNameInput").isDisabled() && await page.locator("#productBrandInput").isDisabled() && await page.locator("#uploadProductImage").count() === 0, "归档商品只读详情仍可修改资料或图集");
    await page.click('[data-edit-tab="sku"]');
    const archivedParentSku = page.locator('tr[data-sku-id="CH010-SKU"]');
    expect(await archivedParentSku.count() === 1 && await archivedParentSku.locator('[data-sku-field="spec"]').isDisabled() && await archivedParentSku.locator('[data-sku-field="price"]').isDisabled(), "归档商品详情未返回全部 SKU 或 SKU 资料仍可编辑");
    expect(await page.locator("#addSku").isHidden(), "归档商品详情仍可新增 SKU");
    await archivedParentSku.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("父商品当前已归档") && (await page.locator("#highRiskDiagnosticCode").getAttribute("data-error-code")) === "STATE_CONFLICT", "父商品已归档时 SKU ACTIVATE preview 未以 200 影响信息呈现阻断");
    await page.fill("#highRiskReason", "验证归档父商品阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "STATE_CONFLICT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "409", "父商品已归档时 SKU ACTIVATE confirm 未返回 STATE_CONFLICT 409");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "归档父商品 409 后旧 preview 或确认仍可复用");
    await page.click("#highRiskRepair");
    productRow = page.locator(`tr[data-product-id="${productId}"]`);
    await productRow.locator(".restore-product").click();
    expect((await page.locator("#restoreResultStatus").innerText()).includes("草稿"), "商品恢复未明确固定返回草稿");
    await page.fill("#restoreEntityReason", "恢复测试商品"); await page.click("#confirmRestoreEntity");
    await page.selectOption("#productStatus", "DRAFT");
    expect((await page.locator(`tr[data-product-id="${productId}"] .product-status`).getAttribute("data-status-code")) === "DRAFT", "Product restore 未恢复为 DRAFT");
    await page.fill("#productSearch", "");

    await page.selectOption("#productStatus", "INACTIVE");
    let reservedProductRow = page.locator('tr[data-product-id="7"]');
    await reservedProductRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("请先启用该商品所属的品牌和一级分类"), "父主数据未启用时缺少中文业务阻断");
    expect((await page.locator("#highRiskDiagnosticCode").getAttribute("data-error-code")) === "STATE_CONFLICT" && (await page.locator("#highRiskDiagnosticCode").getAttribute("data-http-status")) === "409", "父主数据未启用未按契约返回 STATE_CONFLICT 409");
    await page.fill("#highRiskReason", "验证父主数据状态冲突"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "STATE_CONFLICT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "409", "父主数据未启用确认未保留 STATE_CONFLICT 409");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null), "父主数据 409 后旧 preview 仍可复用");
    expect(await page.locator("#confirmHighRisk").isDisabled(), "父主数据 409 后旧确认仍可提交");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-view="categories"]').evaluate((node) => node.classList.contains("active")), "STATE_CONFLICT 修复入口未定位未启用分类");
    await page.click('[data-page="products"]');
    await page.selectOption("#productStatus", "INACTIVE");
    reservedProductRow = page.locator('tr[data-product-id="7"]');
    await reservedProductRow.locator('[data-lifecycle-action="SOFT_DELETE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("库存被订单或售后流程占用"), "商品归档预览未展示库存预占业务阻断");
    expect((await page.locator("#highRiskDiagnosticCode").getAttribute("data-error-code")) === "ACTIVE_INVENTORY_RESERVATION", "库存预占预览未在折叠诊断中保留 ACTIVE_INVENTORY_RESERVATION");
    await page.fill("#highRiskReason", "验证活动库存预占阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "ACTIVE_INVENTORY_RESERVATION" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "422", "商品归档确认未保留 ACTIVE_INVENTORY_RESERVATION 422");
    expect((await page.locator("#highRiskRepair").innerText()).includes("相关订单"), "支付预占缺少只读订单修复入口");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "库存预占 422 后旧 preview 或确认仍可复用");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-view="orders"]').evaluate((node) => node.classList.contains("active")) && (await page.inputValue("#orderSearch")) === "QY202608060021", "支付预占修复入口未定位相关订单");
    expect(await page.locator('#orderRows tr[data-order-id="QY202608060021"]').count() === 1, "支付预占修复入口未显示相关订单");
    await page.click("#orderReset");

    await page.click('[data-page="products"]');
    await page.selectOption("#productStatus", "ACTIVE");
    await page.click('tr[data-product-id="1"] .edit-product');
    await page.click('[data-edit-tab="sku"]');
    let reservedSkuRow = page.locator('tr[data-sku-id="CLEAN-120X2"]');
    await reservedSkuRow.locator('[data-lifecycle-action="DEACTIVATE"]').click();
    await page.fill("#highRiskReason", "准备核验当前 SKU 预占"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    reservedSkuRow = page.locator('tr[data-sku-id="CLEAN-120X2"]');
    await reservedSkuRow.locator('[data-lifecycle-action="SOFT_DELETE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("库存预占 3 件"), "SKU 归档预览未按当前 SKU 计算库存预占");
    await page.fill("#highRiskReason", "验证当前 SKU 活动库存预占"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "ACTIVE_INVENTORY_RESERVATION" && (await page.locator("#highRiskRepair").innerText()).includes("相关订单"), "SKU 库存预占错误使用同商品其他 SKU 的占用来源");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "SKU 库存预占 422 后旧 preview 或确认仍可复用");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-view="orders"]').evaluate((node) => node.classList.contains("active")) && (await page.inputValue("#orderSearch")) === "QY202608060028", "SKU 库存预占修复入口未定位当前 SKU 的订单");
    expect(await page.locator('#orderRows tr[data-order-id="QY202608060028"]').count() === 1, "当前 SKU 的预占订单未显示");
    await page.locator('#orderRows tr[data-order-id="QY202608060028"] .view-order').first().click();
    const reservationOrderDetail = await page.locator("#detailOrderProducts").innerText();
    const reservationOrderState = await page.locator('[data-view="order-detail"]').innerText();
    expect(reservationOrderDetail.includes("CLEAN-120X2") && reservationOrderDetail.includes("¥128.00 × 3"), "预占修复订单快照未包含当前 SKU 或预占数量不一致");
    expect(reservationOrderState.includes("PAID") && reservationOrderState.includes("READY_TO_SHIP"), "预占修复订单不是仍持有库存的活动履约状态");
    await page.click('[data-view="order-detail"] [data-go="orders"]');
    await page.click("#orderReset");

    await page.click('[data-page="products"]');
    await page.selectOption("#productStatus", "DRAFT");
    await page.click('tr[data-product-id="8"] .edit-product');
    await page.click('[data-edit-tab="sku"]');
    const parentArchivedSkuRow = page.locator('tr[data-sku-id="HOME-021"]');
    await parentArchivedSkuRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.archiveParentDuringPendingSkuActivation()), "未能构造 SKU 启用确认前父商品并发归档场景");
    await page.fill("#highRiskReason", "验证父商品并发归档阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "STATE_CONFLICT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "409", "父商品并发归档后 SKU 启用确认未返回 STATE_CONFLICT 409");
    expect((await page.locator("#highRiskError").innerText()).includes("所属商品已归档"), "父商品归档冲突未展示可执行中文原因");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null) && await page.locator("#confirmHighRisk").isDisabled(), "父商品归档 409 后旧 preview 或确认仍可复用");
    expect((await page.locator('tr[data-sku-id="HOME-021"] [data-status-code]').getAttribute("data-status-code")) === "INACTIVE", "父商品归档冲突后错误启用了 SKU");
    await page.click("#highRiskRepair");
    expect(await page.locator('[data-view="products"]').evaluate((node) => node.classList.contains("active")) && (await page.inputValue("#productStatus")) === "ARCHIVED", "父商品归档修复入口未返回归档商品列表");
    const concurrentlyArchivedProduct = page.locator('tr[data-product-id="8"]');
    expect(await concurrentlyArchivedProduct.count() === 1, "父商品归档修复入口未定位最新商品");
    await concurrentlyArchivedProduct.locator(".restore-product").click();
    await page.fill("#restoreEntityReason", "恢复并发归档商品"); await page.click("#confirmRestoreEntity");
    await page.selectOption("#productStatus", "DRAFT");
    expect((await page.locator('tr[data-product-id="8"] .product-status').getAttribute("data-status-code")) === "DRAFT", "父商品修复后未恢复为 DRAFT");

    await page.click('[data-page="brands"]');
    await page.click("#openCreateBrand");
    expect(await page.locator("#entityCodeField").isHidden(), "品牌创建仍要求客户端填写编码");
    expect(await page.locator("#entityStatusField").isHidden(), "品牌创建仍允许选择初始状态");
    expect((await page.locator("#entityDraftNotice").innerText()).includes("固定为草稿"), "品牌创建未说明固定 DRAFT");
    await page.fill("#entityName", "自动化品牌"); await page.fill("#entityDetail", "品牌描述"); await page.fill("#entitySort", "0");
    await page.click("#saveEntity");
    await page.fill("#brandSearch", "自动化品牌");
    const brandRow = page.locator("#brandRows tr", { hasText: "自动化品牌" });
    expect(await brandRow.count() === 1 && (await brandRow.innerText()).includes("DRAFT"), "品牌新增未以 DRAFT 写回列表");
    expect((await brandRow.innerText()).includes("v1"), "品牌新增缺少初始版本");
    await brandRow.locator(".edit-brand").click();
    expect(await page.locator("#entityStatusField").isHidden(), "品牌普通编辑仍可改变状态");
    await page.fill("#entitySort", "1.5"); await page.click("#saveEntity");
    expect((await page.locator("#entityError").innerText()).includes("整数"), "品牌排序未拒绝非整数");
    await page.fill("#entitySort", "2"); await page.click("#saveEntity");
    expect((await brandRow.innerText()).includes("DRAFT") && (await brandRow.innerText()).includes("v2"), "品牌普通编辑错误改变状态或未递增版本");

    await brandRow.locator('[data-lifecycle-action="ACTIVATE"]').click();
    expect((await page.locator("#highRiskModal").innerText()).includes("DRAFT → ACTIVE"), "ACTIVATE 未先展示影响预览");
    await page.fill("#highRiskReason", "品牌资料已完成"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect((await brandRow.innerText()).includes("ACTIVE"), "品牌 ACTIVATE 确认未生效");
    expect(await brandRow.locator('[data-lifecycle-action="DEACTIVATE"]').count() === 1 && await brandRow.locator('[data-lifecycle-action="SOFT_DELETE"]').count() === 0, "ACTIVE 状态错误开放直接归档或缺少停用入口");
    await brandRow.locator('[data-lifecycle-action="DEACTIVATE"]').click();
    expect((await page.locator("#highRiskModal").innerText()).includes("ACTIVE → INACTIVE"), "DEACTIVATE 未先展示影响预览");
    await page.fill("#highRiskReason", "暂停公开展示"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect(await brandRow.locator('[data-lifecycle-action="ACTIVATE"]').count() === 1 && await brandRow.locator('[data-lifecycle-action="SOFT_DELETE"]').count() === 1, "INACTIVE 状态缺少启用或归档入口");
    await brandRow.locator('[data-lifecycle-action="SOFT_DELETE"]').click();
    expect((await page.locator("#highRiskModal").innerText()).includes("INACTIVE → ARCHIVED"), "SOFT_DELETE 未先展示影响预览");
    await page.fill("#highRiskReason", "停止维护测试品牌"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect(await brandRow.count() === 0, "ARCHIVED 品牌仍出现在默认列表");
    await page.selectOption("#brandStatus", "ARCHIVED");
    const archivedBrandRow = page.locator("#brandRows tr", { hasText: "自动化品牌" });
    expect(await archivedBrandRow.count() === 1, "显式 ARCHIVED 筛选未返回软删除品牌");
    await archivedBrandRow.locator(".restore-entity").click();
    expect((await page.locator("#restoreEntityModal").innerText()).includes("恢复结果：草稿"), "恢复未明确固定返回 DRAFT");
    await page.fill("#restoreEntityReason", "恢复测试品牌"); await page.click("#confirmRestoreEntity");
    await page.selectOption("#brandStatus", "DRAFT");
    const restoredBrandRow = page.locator("#brandRows tr", { hasText: "自动化品牌" });
    expect((await restoredBrandRow.innerText()).includes("DRAFT") && await restoredBrandRow.locator('[data-lifecycle-action="ACTIVATE"]').count() === 1, "恢复后未回到 DRAFT 或缺少独立 ACTIVATE");

    await page.click('[data-page="categories"]');
    const protectedCategory = page.locator('#categoryManageRows tr[data-category-id="CAT-SKIN"]');
    const protectedBefore = await protectedCategory.innerText();
    await protectedCategory.locator('[data-lifecycle-action="DEACTIVATE"]').click();
    expect((await page.locator("#highRiskImpact").innerText()).includes("ACTIVE_PRODUCT_DEPENDENCY"), "分类依赖预览未展示 typed blocker");
    expect(await page.locator("#confirmHighRisk").isEnabled(), "依赖 preview 错误在客户端禁用 confirm，无法验收服务端 422");
    await page.fill("#highRiskReason", "验证活动商品依赖阻断"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").innerText()).includes("ACTIVE_PRODUCT_DEPENDENCY（422）"), "confirm 未展示 ACTIVE_PRODUCT_DEPENDENCY 422");
    expect(await page.locator("#highRiskModal").isVisible(), "422 后错误关闭确认弹窗，无法关闭或重试");
    expect(await protectedCategory.innerText() === protectedBefore, "confirm 422 后错误改变分类状态或版本");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").innerText()).includes("ACTIVE_PRODUCT_DEPENDENCY（422）") && await protectedCategory.innerText() === protectedBefore, "422 重试未保持 typed 错误或记录不变");
    await page.locator('#highRiskModal .modal-heading .modal-close').click();
    await page.selectOption("#categoryStatus", "ARCHIVED");
    const archivedCategory = page.locator('#categoryManageRows tr[data-category-id="CAT-MEN"]');
    expect(await archivedCategory.count() === 1, "显式 ARCHIVED 筛选未返回软删除分类");
    await archivedCategory.locator(".restore-entity").click();
    await page.fill("#restoreEntityReason", "恢复测试分类"); await page.click("#confirmRestoreEntity");
    await page.selectOption("#categoryStatus", "DRAFT");
    const restoredCategory = page.locator('#categoryManageRows tr[data-category-id="CAT-MEN"]');
    expect((await restoredCategory.innerText()).includes("DRAFT") && await restoredCategory.locator('[data-lifecycle-action="ACTIVATE"]').count() === 1, "分类恢复后未回到 DRAFT 或缺少独立 ACTIVATE");

    await page.click('[data-page="business-rules"]');
    await page.click('.edit-business-rule[data-rule-key="MIN_WITHDRAWAL"]');
    await page.fill("#businessRuleValue", "120"); await page.fill("#businessRuleReason", "自动化规则版本验收"); await page.check("#businessRuleConfirm");
    await page.click("#saveBusinessRule");
    expect((await page.locator("#minimumWithdrawalValue").innerText()) === "120" && (await page.locator("#withdrawalRuleVersion").innerText()).includes("04"), "业务规则未生成新版本");
  });

  await run("admin-interaction-banner-contract", "admin.html", async (page) => {
    await page.click('[data-page="banners"]');
    expect(await page.locator("#bannerManageGrid .banner-manage-card").count() === 3 && await page.locator('[data-banner-status="ARCHIVED"]').count() === 0, "Banner 默认列表未排除 ARCHIVED");
    await page.click("#openCreateBanner");
    expect(await page.locator("#entityCodeField").isHidden() && await page.locator("#entityStatusField").isHidden(), "Banner 创建仍暴露人工编码或状态下拉");
    expect((await page.locator("#entityDraftNotice").innerText()).includes("固定为草稿"), "Banner 创建未声明固定 DRAFT");
    await page.fill("#entityName", "自动化 Banner"); await page.fill("#entitySort", "0");
    await page.selectOption("#entityTargetType", "PRODUCT"); await page.selectOption("#entityTargetId", "QY-CLEAN-001");
    await page.click("#saveEntity");
    expect((await page.locator("#entityError").innerText()).includes("READY / PUBLIC / BANNER"), "Banner 未阻止缺少公开文件的创建");
    await page.click("#uploadBannerImage");
    await page.evaluate(() => { const button = document.querySelector("#saveEntity"); button.click(); button.click(); });
    const created = page.locator("#bannerManageGrid .banner-manage-card", { hasText: "自动化 Banner" });
    expect(await created.count() === 1 && (await created.getAttribute("data-banner-status")) === "DRAFT", "Banner 重复创建或未固定为 DRAFT");
    expect((await created.innerText()).includes("PRODUCT") && (await created.innerText()).includes("READY/PUBLIC"), "Banner typed target 或文件状态未写回");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.entitySubmitting);

    await created.locator(".edit-banner").click();
    await page.click("#simulateEntityConflict");
    await page.fill("#entitySort", "1"); await page.click("#saveEntity");
    await waitForToast(page, "RESOURCE_VERSION_CONFLICT（409）", "Banner 资料 If-Match 冲突");
    expect((await created.getAttribute("data-banner-status")) === "DRAFT" && (await created.innerText()).includes("v2"), "Banner 409 后错误改变状态或未刷新版本");

    await created.locator('[data-banner-action="ACTIVATE"]').click();
    expect(await page.locator("#highRiskReasonField").isHidden() && (await page.locator("#highRiskSubtitle").innerText()).includes("If-Match"), "Banner ACTIVATE 错误要求高风险原因或缺少 If-Match");
    await page.locator("#highRiskDiagnostics summary").click(); await page.click("#simulateHighRiskConflict"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "RESOURCE_VERSION_CONFLICT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "409", "Banner 生命周期并发未返回 409");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().state.pendingHighRiskAction === null), "Banner 409 后旧确认仍可复用");
    await page.click("#highRiskRepair");
    await page.locator("#entityModal .modal-heading .modal-close").click();

    await created.locator('[data-banner-action="ACTIVATE"]').click();
    await page.check("#highRiskConfirm");
    await page.evaluate(() => { const button = document.querySelector("#confirmHighRisk"); button.click(); button.click(); });
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect((await created.getAttribute("data-banner-status")) === "ACTIVE" && await created.locator('[data-banner-action="DEACTIVATE"]').count() === 1 && await created.locator('[data-banner-action="DELETE"]').count() === 0, "Banner ACTIVATE 重复执行或 ACTIVE 错误开放直接归档");
    await created.locator('[data-banner-action="DEACTIVATE"]').click(); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect((await created.getAttribute("data-banner-status")) === "INACTIVE", "Banner DEACTIVATE 未进入 INACTIVE");
    await created.locator('[data-banner-action="DELETE"]').click();
    expect(!`${await page.locator("#highRiskSubtitle").innerText()} ${await page.locator("#highRiskDiagnostics").innerText()}`.includes("preview") && await page.locator("#highRiskReasonField").isVisible(), "Banner DELETE 错误暗示 preview 或未要求原因");
    await page.fill("#highRiskReason", "结束自动化 Banner 投放"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect(await created.count() === 0, "ARCHIVED Banner 仍出现在默认列表");
    await page.selectOption("#bannerStatus", "ARCHIVED");
    const archived = page.locator("#bannerManageGrid .banner-manage-card", { hasText: "自动化 Banner" });
    expect(await archived.count() === 1, "显式 ARCHIVED 筛选未返回 Banner");
    await archived.locator(".restore-banner").click(); await page.fill("#restoreEntityReason", "恢复 Banner 资料"); await page.click("#confirmRestoreEntity");
    await page.selectOption("#bannerStatus", "DRAFT");
    expect(await page.locator("#bannerManageGrid .banner-manage-card", { hasText: "自动化 Banner" }).getAttribute("data-banner-status") === "DRAFT", "Banner restore 未固定回到 DRAFT");
  });

  await run("admin-interaction-inventory-preview", "admin.html", async (page) => {
    await page.click('[data-page="inventory"]');
    const row = page.locator('tr[data-inventory-id="CLEAN-120"]');
    expect((await row.locator("td").nth(2).innerText()) === "286" && (await row.locator("td").nth(3).innerText()) === "10" && (await row.locator("td").nth(5).innerText()) === "276", "库存 physical/locked/available 初始公式错误");
    await row.locator(".inventory-adjust").click();
    expect((await page.locator("#stockVersion").innerText()) === "v4", "库存调整缺少 If-Match 版本");
    await page.fill("#stockDelta", "1"); await page.fill("#stockReason", "自动化盘点差异修正"); await page.click("#confirmStock");
    expect((await page.locator("#highRiskImpact").innerText()).includes("physical 286 → 287") && (await page.locator("#highRiskImpact").innerText()).includes("available 276 → 277"), "库存 preview 未展示完整前后值");
    await page.locator("#highRiskDiagnostics summary").click(); await page.click("#simulateHighRiskConflict"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "RESOURCE_VERSION_CONFLICT", "库存 If-Match 冲突未返回 409");
    await page.click("#highRiskRepair");
    await page.fill("#stockDelta", "1"); await page.fill("#stockReason", "自动化盘点差异修正"); await page.click("#confirmStock"); await page.check("#highRiskConfirm");
    await page.evaluate(() => { const button = document.querySelector("#confirmHighRisk"); button.click(); button.click(); });
    await page.waitForFunction(() => !window.__ADMIN_PROTOTYPE__.getState().state.highRiskSubmitting);
    expect((await row.locator("td").nth(2).innerText()) === "287" && (await row.locator("td").nth(5).innerText()) === "277", "库存重复确认产生多次调整或公式错误");
    const ledgerCount = await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().inventoryLedger["CLEAN-120"].filter((entry) => entry.reason === "自动化盘点差异修正").length);
    expect(ledgerCount === 1, "库存重复确认追加了第二条流水");
    await row.locator(".inventory-flow").click();
    expect((await page.locator("#stockLedger").innerText()).includes("MANUAL_INCREASE") && (await page.locator("#stockLedger").innerText()).includes("自动化盘点差异修正"), "库存流水未使用闭合类型或缺少原因");
    await page.locator("#stockModal .modal-heading .modal-close").click();

    const insufficientRow = page.locator('tr[data-inventory-id="SUN-050"]');
    await insufficientRow.locator(".inventory-adjust").click(); await page.fill("#stockDelta", "-1"); await page.fill("#stockReason", "验证锁定库存阻断");
    expect((await page.locator("#stockPreview").innerText()).includes("STOCK_INSUFFICIENT 422"), "库存不足 warning 未在 preview 前展示");
    await page.click("#confirmStock");
    expect((await page.locator("#highRiskImpact").innerText()).includes("预览仍为 200"), "physical_after < locked 时 preview 未保持 200");
    await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    expect((await page.locator("#highRiskError").getAttribute("data-error-code")) === "STOCK_INSUFFICIENT" && (await page.locator("#highRiskError").getAttribute("data-http-status")) === "422", "库存不足 confirm 未以 422 阻断");
    expect(await page.evaluate(() => window.__ADMIN_PROTOTYPE__.getState().inventorySkus.find((item) => item.id === "SUN-050").physical) === 1, "库存 422 后错误写入余额");
    await page.click("#highRiskRepair"); await page.fill("#stockDelta", "2147483647"); await page.fill("#stockReason", "验证整数范围"); await page.click("#confirmStock");
    expect((await page.locator("#stockError").getAttribute("data-error-code")) === "INVENTORY_QUANTITY_OUT_OF_RANGE" && (await page.locator("#stockError").getAttribute("data-http-status")) === "422", "库存 int32 越界未以 422 阻断");
    await page.locator("#stockModal .modal-heading .modal-close").click();

    await page.selectOption("#inventoryStatus", "ARCHIVED");
    const archived = page.locator('tr[data-inventory-id="HOME-OLD"]');
    expect(await archived.count() === 1 && await archived.locator(".inventory-adjust").count() === 0 && (await archived.innerText()).includes("归档只读"), "ARCHIVED SKU 未保持只读或不可查询");
    await archived.locator(".inventory-flow").click();
    expect(await page.locator("#confirmStock").isHidden() && (await page.locator("#stockProductName").innerText()).includes("已归档"), "ARCHIVED SKU 流水弹窗错误开放调整");
  });

  await run("admin-interaction-product-readonly-inventory", "admin.html", async (page) => {
    await page.click('[data-page="products"]');
    const inventorySummary = page.locator('tr[data-product-id="1"] .product-inventory-summary');
    const summary = await inventorySummary.innerText();
    expect(["3 SKU · 3 个已启用", "实物 424", "锁定 13", "可售 411"].every((term) => summary.includes(term)), "SPU 列表未从同一库存快照汇总规格数/实物/锁定/可售");
    expect(await inventorySummary.evaluate((element) => element.tagName) === "DIV" && await page.locator('tr[data-product-id="1"] .stock-action').count() === 0, "ADM-03 库存摘要仍可进入调整流程");
    await page.click('tr[data-product-id="1"] .edit-product');
    await page.click('[data-edit-tab="sku"]');
    const skuPanelText = await page.locator('[data-edit-panel="sku"]').innerText();
    expect(await page.locator('#skuRows [data-sku-field="stock"]').count() === 0, "ADM-04 仍可编辑 SKU 库存");
    expect(!skuPanelText.includes("有效佣金") && !skuPanelText.includes("规则来源") && skuPanelText.includes("实物 286") && skuPanelText.includes("锁定 10"), "ADM-04 未移除佣金字段或缺少库存只读投影");
    await page.click('[data-edit-tab="basic"]');
    for (let index = 0; index < 6; index += 1) await page.click("#uploadProductImage");
    expect((await page.locator("#productImageCount").innerText()) === "8 / 8" && await page.locator('[data-product-image]').count() === 8, "商品图集未在第 8 张封顶");
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
    expect((await page.locator('tr[data-inventory-id="SERUM-030"] td').nth(2).innerText()) === "9", "未发货退款成功未自动回补对应 SKU");

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
    expect((await page.locator('tr[data-inventory-id="HOME-030"] td').nth(2).innerText()) === "240", "PASS 未仅按 restock 数量回库");

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
    await waitForHighRiskIdle(page, "白名单变更确认收尾");
    await page.click('tr[data-agent-id="A1026"] .view-agent');
    expect((await page.locator("#agentDrawerAuthCount").innerText()) === "2 件", "白名单选择未写回当前代理");
    await page.click("#rotateAgentInvite"); await page.fill("#highRiskReason", "旧邀请码疑似外泄"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction((previous) => document.querySelector("#agentDrawerInvite")?.innerText !== previous, oldInvite);
    await waitForHighRiskIdle(page, "邀请码轮换确认收尾");
    const newInvite = await page.locator("#agentDrawerInvite").innerText();
    expect(newInvite !== oldInvite && (await page.locator("#agentDrawerInviteState").innerText()).includes("2026-12-31"), "邀请码轮换或有效期未更新");
    await page.click("#disableAgentInvite"); await page.fill("#highRiskReason", "暂停新客户候选"); await page.check("#highRiskConfirm"); await page.click("#confirmHighRisk");
    await page.waitForFunction(() => document.querySelector("#agentDrawerInviteState")?.textContent.includes("已停用"));
    await waitForHighRiskIdle(page, "邀请码停用确认收尾");
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
  const selectedCases = caseFilter ? cases.filter(({ name }) => name === caseFilter) : cases;
  if (caseFilter && !selectedCases.length) throw new Error(`unknown prototype render case: ${caseFilter}`);
  const browser = await chromium.launch({ ...(chromeExecutable ? { executablePath: chromeExecutable } : {}), headless: true });
  const failures = inspectSensitiveSources();
  if (!failures.length && !quiet) console.log("PASS sensitive-source-scan");

  try {
    if (!flowFilter) {
      for (const testCase of selectedCases) {
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
      if (!caseFilter) failures.push(...await runSurfaceContractChecks(browser));
    }
    if (!caseFilter) {
      failures.push(...await runMiniInteractionChecks(browser));
      failures.push(...await runOpsInteractionChecks(browser));
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
  } else if (flowFilter) {
    console.log(`PASS filtered flow: ${flowFilter}`);
  } else if (caseFilter) {
    console.log(`PASS filtered render: ${caseFilter}${updateExports ? " (export updated)" : ""}`);
  } else {
    console.log(`PASS all ${cases.length} responsive renders, 21/9/22 surface contracts, 16 miniapp flows and 18 admin/agent flows${updateExports ? " (exports updated)" : ""}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
