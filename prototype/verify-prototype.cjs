const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const prototypeDir = __dirname;
const exportDir = path.join(prototypeDir, "exports");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const cases = [
  ...["home", "product", "checkout", "orders", "aftersale"].map((screen) => ({
    name: `miniapp-${screen}`,
    file: "index.html",
    query: { screen, device: "375" },
    viewport: { width: 1440, height: 1000 },
    kind: "mini-canvas"
  })),
  {
    name: "miniapp-mobile-375",
    file: "index.html",
    query: { screen: "home", device: "375" },
    viewport: { width: 375, height: 812 },
    kind: "mini-mobile"
  },
  {
    name: "miniapp-mobile-414",
    file: "index.html",
    query: { screen: "home", device: "414" },
    viewport: { width: 414, height: 896 },
    kind: "mini-mobile"
  },
  {
    name: "admin-login",
    file: "admin.html",
    query: {},
    viewport: { width: 1440, height: 1000 },
    kind: "admin-login"
  },
  ...["dashboard", "products", "product-edit", "orders", "aftersales", "customers"].map((view) => ({
    name: `admin-${view}`,
    file: "admin.html",
    query: { autologin: "1", view },
    viewport: { width: 1440, height: 1000 },
    kind: view === "dashboard" ? "admin-dashboard" : "admin"
  })),
  {
    name: "admin-dashboard-1024",
    file: "admin.html",
    query: { autologin: "1", view: "dashboard" },
    viewport: { width: 1024, height: 900 },
    kind: "admin-dashboard"
  }
];

const deferredTerms = [
  "会员价",
  "会员等级",
  "优惠券",
  "积分余额",
  "新客首单",
  "导出数据",
  "导出商品",
  "导出订单",
  "二级分类",
  "批量打标签"
];

function buildUrl(testCase) {
  const url = new URL(pathToFileURL(path.join(prototypeDir, testCase.file)));
  Object.entries(testCase.query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.href;
}

async function inspectPage(page, testCase) {
  const result = await page.evaluate(({ kind, viewport, deferredTerms }) => {
    const bodyText = document.body.innerText;
    const brokenImages = [...document.images]
      .filter((image) => getComputedStyle(image).display !== "none" && !image.hidden && image.complete && image.naturalWidth === 0)
      .map((image) => image.getAttribute("src"));
    const html = document.documentElement;
    const overflow = Math.max(html.scrollWidth, document.body.scrollWidth) - html.clientWidth;
    const exposedTerms = deferredTerms.filter((term) => bodyText.includes(term));
    const checks = {
      nonBlank: bodyText.trim().length > 120,
      brokenImages,
      overflow,
      exposedTerms,
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

    return checks;
  }, { kind: testCase.kind, viewport: testCase.viewport, deferredTerms });

  const failures = [];
  if (!result.nonBlank) failures.push("页面内容为空");
  if (result.brokenImages.length) failures.push(`图片加载失败: ${result.brokenImages.join(", ")}`);
  if (result.overflow > 1) failures.push(`页面横向溢出 ${result.overflow}px`);
  if (result.exposedTerms.length) failures.push(`延期功能词露出: ${result.exposedTerms.join(", ")}`);
  if (result.viewport.width !== testCase.viewport.width || result.viewport.height !== testCase.viewport.height) {
    failures.push(`视口不一致: ${result.viewport.width}x${result.viewport.height}`);
  }
  if (testCase.kind === "mini-mobile" && result.mobileFrameWidth !== testCase.viewport.width) {
    failures.push(`小程序画面宽度 ${result.mobileFrameWidth}px，预期 ${testCase.viewport.width}px`);
  }
  if (testCase.kind === "mini-mobile" && !result.mobileTabFits) failures.push("移动端底部导航超出视口或点击区域过窄");
  if (testCase.kind === "admin-dashboard" && !result.chartHasPixels) failures.push("销售趋势画布为空");
  return failures;
}

async function main() {
  fs.mkdirSync(exportDir, { recursive: true });
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
      await page.screenshot({ path: path.join(exportDir, `${testCase.name}.png`), fullPage: false });

      if (pageFailures.length) failures.push(`${testCase.name}: ${pageFailures.join("；")}`);
      else console.log(`PASS ${testCase.name}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length) {
    failures.forEach((failure) => console.error(`FAIL ${failure}`));
    process.exitCode = 1;
  } else {
    console.log(`PASS all ${cases.length} prototype views`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
