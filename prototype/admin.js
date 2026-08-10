(function () {
  "use strict";

  const pageTitles = {
    dashboard: "数据看板",
    products: "商品管理",
    "product-edit": "商品编辑",
    orders: "订单管理",
    "order-detail": "订单详情",
    aftersales: "售后审核",
    customers: "客户管理",
    agents: "代理管理",
    withdrawals: "提现审核"
  };

  const products = [
    { id: 1, name: "植萃研氨基酸净澈洁面乳 120g", brand: "植萃研", category: "护肤品", code: "QY-CLEAN-001", sku: 3, price: "69.00", stock: 424, sales: 1826, status: "在售", recommended: true, art: "art-green" },
    { id: 2, name: "沐光无硅油蓬松洗发水 500ml", brand: "沐光", category: "洗发水", code: "QY-HAIR-018", sku: 2, price: "89.00", stock: 68, sales: 1432, status: "在售", recommended: true, art: "art-blue" },
    { id: 3, name: "青木序积雪草舒缓修护霜 50g", brand: "青木序", category: "护肤品", code: "QY-SKIN-027", sku: 1, price: "129.00", stock: 16, sales: 986, status: "在售", recommended: false, art: "art-coral" },
    { id: 4, name: "净简酵素浓缩洗衣凝珠 30颗", brand: "净简", category: "家庭清洁", code: "QY-HOME-008", sku: 2, price: "49.00", stock: 238, sales: 862, status: "在售", recommended: true, art: "art-amber" },
    { id: 5, name: "植萃研烟酰胺焕亮精华液 30ml", brand: "植萃研", category: "护肤品", code: "QY-SKIN-031", sku: 1, price: "159.00", stock: 8, sales: 748, status: "在售", recommended: false, art: "art-purple" },
    { id: 6, name: "沐光白茶香氛沐浴露 500ml", brand: "沐光", category: "沐浴露", code: "QY-BODY-012", sku: 3, price: "79.00", stock: 186, sales: 635, status: "在售", recommended: false, art: "art-coral" },
    { id: 7, name: "青木序轻透倍护防晒乳 SPF50+", brand: "青木序", category: "防晒产品", code: "QY-SUN-006", sku: 1, price: "119.00", stock: 0, sales: 528, status: "已下架", recommended: false, art: "art-blue" },
    { id: 8, name: "净简柑橘厨房重油污清洁剂", brand: "净简", category: "家庭清洁", code: "QY-HOME-021", sku: 1, price: "39.00", stock: 0, sales: 0, status: "草稿", recommended: false, art: "art-green" }
  ];

  const orders = [
    { id: "QY202608060028", customer: "林晓月", phone: "138****6821", avatar: "林", product: "氨基酸洁面乳等 2 款", count: 3, amount: "227.00", payment: "微信支付", status: "待发货", time: "08-06 09:18", arts: ["art-green", "art-blue"] },
    { id: "QY202608060027", customer: "周敏", phone: "186****3096", avatar: "周", product: "无硅油蓬松洗发水", count: 1, amount: "89.00", payment: "微信支付", status: "退款售后", time: "08-06 09:02", arts: ["art-blue"] },
    { id: "QY202608060026", customer: "陈嘉禾", phone: "159****2218", avatar: "陈", product: "酵素浓缩洗衣凝珠", count: 2, amount: "84.00", payment: "微信支付", status: "运输中", time: "08-06 08:46", arts: ["art-amber"] },
    { id: "QY202608060025", customer: "赵倩", phone: "133****5107", avatar: "赵", product: "积雪草舒缓修护霜", count: 1, amount: "109.00", payment: "微信支付", status: "已完成", time: "08-06 08:25", arts: ["art-coral"] },
    { id: "QY202608060024", customer: "王悦", phone: "137****8432", avatar: "王", product: "白茶香氛沐浴露等 3 款", count: 5, amount: "326.00", payment: "微信支付", status: "待付款", time: "08-06 08:12", arts: ["art-coral", "art-purple"] },
    { id: "QY202608060023", customer: "刘雨晴", phone: "188****0076", avatar: "刘", product: "烟酰胺焕亮精华液", count: 1, amount: "139.00", payment: "微信支付", status: "待发货", time: "08-06 07:58", arts: ["art-purple"] },
    { id: "QY202608060022", customer: "何文", phone: "135****6190", avatar: "何", product: "氨基酸洁面乳旅行装", count: 2, amount: "50.00", payment: "微信支付", status: "运输中", time: "08-06 07:31", arts: ["art-green"] },
    { id: "QY202608060021", customer: "孙可心", phone: "180****4175", avatar: "孙", product: "轻透倍护防晒乳", count: 1, amount: "99.00", payment: "微信支付", status: "已完成", time: "08-06 07:16", arts: ["art-blue"] }
  ];

  const aftersales = [
    { id: "AS202608060003", order: "QY202608060027", customer: "周敏", product: "沐光无硅油蓬松洗发水", type: "仅退款", amount: "89.00", reason: "拍错了，不想要了", status: "待审核", time: "08-06 09:11", art: "art-blue" },
    { id: "AS202608060002", order: "QY202608050186", customer: "宋宁", product: "植萃研氨基酸净澈洁面乳", type: "退货退款", amount: "59.00", reason: "收到后包装破损", status: "待审核", time: "08-06 08:42", art: "art-green" },
    { id: "AS202608060001", order: "QY202608050142", customer: "顾安", product: "青木序积雪草舒缓修护霜", type: "仅退款", amount: "109.00", reason: "重复下单", status: "待审核", time: "08-06 08:05", art: "art-coral" },
    { id: "AS202608050012", order: "QY202608040095", customer: "赵倩", product: "净简酵素浓缩洗衣凝珠", type: "退货退款", amount: "84.00", reason: "商品与描述不符", status: "待退货", time: "08-05 16:28", art: "art-amber" },
    { id: "AS202608050009", order: "QY202608030251", customer: "王悦", product: "沐光白茶香氛沐浴露", type: "退货退款", amount: "69.00", reason: "不喜欢香味", status: "待退款", time: "08-05 13:42", art: "art-coral" },
    { id: "AS202608040018", order: "QY202608020176", customer: "何文", product: "植萃研烟酰胺焕亮精华液", type: "仅退款", amount: "139.00", reason: "物流长期未更新", status: "已完成", time: "08-04 17:16", art: "art-purple" }
  ];

  const customers = [
    { id: 1, name: "林晓月", nickname: "Moon", phone: "138****6821", spend: 3286, orders: 18, recent: "氨基酸洁面乳", recentDate: "今天 09:18", joined: "2025-11-18", avatar: "林", agentId: "A1038", agentName: "清源生活馆", agentBoundAt: "2026-07-18 14:26" },
    { id: 2, name: "周敏", nickname: "Mina", phone: "186****3096", spend: 1688, orders: 9, recent: "无硅油洗发水", recentDate: "今天 09:02", joined: "2026-01-08", avatar: "周", agentId: "A1038", agentName: "清源生活馆", agentBoundAt: "2026-07-28 09:16" },
    { id: 3, name: "陈嘉禾", nickname: "嘉禾", phone: "159****2218", spend: 892, orders: 6, recent: "浓缩洗衣凝珠", recentDate: "今天 08:46", joined: "2026-03-22", avatar: "陈", agentId: "A1026", agentName: "清悦日用馆", agentBoundAt: "2026-06-12 11:40" },
    { id: 4, name: "赵倩", nickname: "Zoe", phone: "133****5107", spend: 4290, orders: 26, recent: "积雪草修护霜", recentDate: "今天 08:25", joined: "2025-08-16", avatar: "赵", agentId: null, agentName: "平台直接客户", agentBoundAt: "2026-05-08 16:08" },
    { id: 5, name: "王悦", nickname: "悦悦", phone: "137****8432", spend: 2386, orders: 13, recent: "白茶香氛沐浴露", recentDate: "今天 08:12", joined: "2025-12-09", avatar: "王", agentId: "A1019", agentName: "简木洗护顾问", agentBoundAt: "2026-04-20 10:32" },
    { id: 6, name: "刘雨晴", nickname: "Yuki", phone: "188****0076", spend: 658, orders: 4, recent: "烟酰胺焕亮精华", recentDate: "今天 07:58", joined: "2026-05-19", avatar: "刘", agentId: "A1026", agentName: "清悦日用馆", agentBoundAt: "2026-07-09 18:26" },
    { id: 7, name: "孙可心", nickname: "Kira", phone: "180****4175", spend: 1928, orders: 11, recent: "轻透倍护防晒乳", recentDate: "今天 07:16", joined: "2026-02-14", avatar: "孙", agentId: null, agentName: "平台直接客户", agentBoundAt: "2026-02-14 12:06" }
  ];

  const agents = [
    { id: "A1038", name: "清源生活馆", account: "qingyuan.store", contact: "安然 138****3916", rate: 8, invite: "QX-A1038", authMode: "全部在售商品", authorizedCount: 116, customers: 386, sales: 86420, available: 4820.6, frozen: 2680, negative: 0, bank: "招商银行", cardLast4: "3916", status: "已启用", avatar: "清" },
    { id: "A1026", name: "清悦日用馆", account: "qingyue.store", contact: "陈悦 186****2077", rate: 7.5, invite: "QX-A1026", authMode: "自定义白名单", authorizedCount: 42, customers: 274, sales: 62180, available: 3686.2, frozen: 1200, negative: 0, bank: "中国建设银行", cardLast4: "2077", status: "已启用", avatar: "悦" },
    { id: "A1019", name: "简木洗护顾问", account: "jianmu.care", contact: "林木 159****6128", rate: 9, invite: "QX-A1019", authMode: "全部在售商品", authorizedCount: 116, customers: 226, sales: 58960, available: 5218.4, frozen: 3200, negative: 0, bank: "中国工商银行", cardLast4: "6128", status: "已启用", avatar: "简" },
    { id: "A1012", name: "素研生活家", account: "suyan.life", contact: "徐研 137****4632", rate: 8, invite: "QX-A1012", authMode: "自定义白名单", authorizedCount: 28, customers: 198, sales: 41860, available: 0, frozen: 0, negative: 328.5, bank: "中国农业银行", cardLast4: "4632", status: "已启用", avatar: "素" },
    { id: "A1007", name: "白茶日用馆", account: "baicha.store", contact: "宋宁 135****7810", rate: 7, invite: "QX-A1007", authMode: "全部在售商品", authorizedCount: 116, customers: 184, sales: 36240, available: 896.8, frozen: 0, negative: 0, bank: "中国银行", cardLast4: "7810", status: "已停用", avatar: "白" }
  ];

  const withdrawals = [
    { id: "WD202608100021", agentId: "A1038", agent: "清源生活馆", amount: 2680, holder: "安然", bank: "招商银行", card: "**** **** **** 3916", status: "待审核", time: "08-10 09:26", proof: false },
    { id: "WD202608100018", agentId: "A1026", agent: "清悦日用馆", amount: 1200, holder: "陈悦", bank: "中国建设银行", card: "**** **** **** 2077", status: "待审核", time: "08-10 08:42", proof: false },
    { id: "WD202608090086", agentId: "A1019", agent: "简木洗护顾问", amount: 3200, holder: "林木", bank: "中国工商银行", card: "**** **** **** 6128", status: "待打款", time: "08-09 16:18", proof: false },
    { id: "WD202608080052", agentId: "A1038", agent: "清源生活馆", amount: 1800, holder: "安然", bank: "招商银行", card: "**** **** **** 3916", status: "已打款", time: "08-08 11:06", proof: true },
    { id: "WD202608070031", agentId: "A1007", agent: "白茶日用馆", amount: 980, holder: "宋宁", bank: "中国银行", card: "**** **** **** 7810", status: "已拒绝", time: "08-07 14:32", proof: false }
  ];

  const state = {
    page: "dashboard",
    chartRange: 7,
    reportRange: "day",
    rankingType: "product",
    activeProductId: null,
    activeAftersaleId: null,
    activeOrderId: "QY202608060028",
    activeAgentId: null,
    activeCustomerId: null,
    activeWithdrawalId: null,
    paymentProofReady: false,
    oneTimeCredentials: null,
    bankRevealContext: null,
    bankRevealTimer: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const icon = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;

  function money(value) {
    return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function statusClass(status) {
    return {
      "在售": "success",
      "待发货": "warning",
      "待付款": "neutral",
      "运输中": "info",
      "已完成": "success",
      "退款售后": "danger",
      "待审核": "danger",
      "待退货": "warning",
      "待退款": "purple",
      "已拒绝": "neutral",
      "已下架": "neutral",
      "草稿": "neutral",
      "已启用": "success",
      "已停用": "neutral",
      "待打款": "purple",
      "已打款": "success"
    }[status] || "neutral";
  }

  let toastTimer;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function showApp() {
    $("#loginView").hidden = true;
    $("#appShell").hidden = false;
    showPage(state.page);
  }

  function showLogin() {
    closeOverlays();
    $("#appShell").hidden = true;
    $("#loginView").hidden = false;
  }

  function showPage(page) {
    const target = $(`[data-view="${page}"]`);
    if (!target) return;
    state.page = page;
    $$(".page-view").forEach((view) => view.classList.toggle("active", view === target));
    const navPage = page === "product-edit" ? "products" : page === "order-detail" ? "orders" : page;
    $$(".nav-item[data-page]").forEach((item) => item.classList.toggle("active", item.dataset.page === navPage));
    $("#breadcrumbTitle").textContent = pageTitles[page];
    document.title = `${pageTitles[page]} · 青序生活商城管理后台`;
    $(".page-scroll").scrollTop = 0;
    window.scrollTo(0, 0);
    closeOverlays();
    if (page === "dashboard") requestAnimationFrame(drawSalesChart);
  }

  function renderProductArt(art, brand) {
    return `<div class="product-art ${art}"><i></i><b>${brand}</b></div>`;
  }

  function renderProducts() {
    const keyword = $("#productSearch").value.trim().toLowerCase();
    const category = $("#productCategory").value;
    const brand = $("#productBrand").value;
    const status = $("#productStatus").value;
    const filtered = products.filter((product) => {
      const matchesKeyword = !keyword || `${product.name}${product.code}${product.brand}`.toLowerCase().includes(keyword);
      return matchesKeyword && (!category || product.category === category) && (!brand || product.brand === brand) && (!status || product.status === status);
    });

    $("#productCount").textContent = `共 ${filtered.length} 件商品`;
    $("#productRows").innerHTML = filtered.length ? filtered.map((product) => {
      const low = product.stock <= 20;
      const stockWidth = Math.min(100, Math.max(0, (product.stock / 450) * 100));
      return `<tr data-product-id="${product.id}">
        <td class="checkbox-cell"><input type="checkbox" aria-label="选择 ${product.name}"></td>
        <td><div class="product-cell">${renderProductArt(product.art, product.brand)}<div class="product-cell-copy"><strong title="${product.name}">${product.name}</strong><span>${product.code} · ${product.sku} 个规格</span></div></div></td>
        <td><span class="cell-main">${money(product.price)}</span><span class="cell-sub">零售价</span></td>
        <td><div class="stock-cell ${low ? "low" : ""}"><div><span>${product.stock}</span><button class="icon-button stock-action" type="button" title="调整库存">${icon("edit")}</button></div><i><em style="width:${stockWidth}%"></em></i></div></td>
        <td class="optional-wide"><span class="cell-main">${product.sales.toLocaleString("zh-CN")}</span><span class="cell-sub">累计销量</span></td>
        <td><span class="tag ${statusClass(product.status)}">${product.status}</span></td>
        <td class="optional-wide"><button type="button" class="switch recommend-toggle ${product.recommended ? "active" : ""}" title="切换首页推荐" aria-pressed="${product.recommended}"><i></i></button></td>
        <td><div class="row-actions"><button type="button" class="icon-button edit-product" title="编辑商品">${icon("edit")}</button><button type="button" class="icon-button delete-product danger" title="删除商品">${icon("trash")}</button></div></td>
      </tr>`;
    }).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("search")}<strong>没有找到匹配商品</strong><span>请调整搜索词或筛选条件</span></div></td></tr>`;
  }

  function renderOrders() {
    const keyword = $("#orderSearch").value.trim().toLowerCase();
    const status = $("#orderStatus").value;
    const filtered = orders.filter((order) => {
      const matches = !keyword || `${order.id}${order.customer}${order.phone}`.toLowerCase().includes(keyword);
      return matches && (!status || order.status === status);
    });
    $("#orderCount").textContent = `共 ${filtered.length} 笔订单`;
    $("#orderRows").innerHTML = filtered.length ? filtered.map((order) => `<tr data-order-id="${order.id}">
      <td><button class="order-number view-order" type="button">${order.id}</button><span class="cell-sub">微信小程序</span></td>
      <td><div class="customer-cell"><span class="avatar soft-green">${order.avatar}</span><div><span class="cell-main">${order.customer}</span><span class="cell-sub">${order.phone}</span></div></div></td>
      <td><div class="order-product-mini"><div class="product-art-stack">${order.arts.map((art) => renderProductArt(art, "")).join("")}</div><span>${order.product}<br>共 ${order.count} 件</span></div></td>
      <td><span class="cell-main">${money(order.amount)}</span></td>
      <td class="optional-wide">${order.payment}</td>
      <td><span class="tag ${statusClass(order.status)}">${order.status}</span></td>
      <td class="optional-wide">${order.time}</td>
      <td><div class="row-actions">${order.status === "待发货" ? `<button type="button" class="button text ship-order">发货</button>` : ""}<button type="button" class="icon-button view-order" title="查看订单">${icon("eye")}</button></div></td>
    </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("orders")}<strong>没有找到匹配订单</strong><span>可尝试更换订单状态或搜索条件</span></div></td></tr>`;
  }

  function renderDashboardOrders() {
    $("#dashboardOrders").innerHTML = orders.slice(0, 5).map((order) => `<tr data-order-id="${order.id}"><td><button class="order-number view-order" type="button">${order.id}</button></td><td>${order.customer}</td><td>${order.product}</td><td><span class="cell-main">${money(order.amount)}</span></td><td><span class="tag ${statusClass(order.status)}">${order.status}</span></td><td>${order.time}</td><td><button type="button" class="icon-button view-order" title="查看订单">${icon("eye")}</button></td></tr>`).join("");
  }

  function renderRankings() {
    const customerMode = state.rankingType === "customer";
    $("#rankingTitle").textContent = customerMode ? "客户消费排行" : "商品销量排行";
    $("#rankingSubtitle").textContent = customerMode ? "本月有效净消费额" : "本月支付件数";
    $("#rankingList").innerHTML = customerMode
      ? customers.slice().sort((a, b) => b.spend - a.spend).slice(0, 5).map((customer, index) => `<div class="ranking-item"><span class="ranking-number">${index + 1}</span><span class="avatar soft-green">${customer.avatar}</span><div class="ranking-copy"><strong>${customer.name} <small class="muted">@${customer.nickname}</small></strong><span>${customer.orders} 次消费 · ${customer.agentName}</span></div><strong>¥${customer.spend.toLocaleString("zh-CN")}</strong></div>`).join("")
      : products.slice().sort((a, b) => b.sales - a.sales).slice(0, 5).map((product, index) => `<div class="ranking-item"><span class="ranking-number">${index + 1}</span>${renderProductArt(product.art, product.brand)}<div class="ranking-copy"><strong title="${product.name}">${product.name}</strong><span>${product.category} · 库存 ${product.stock}</span></div><strong>${product.sales.toLocaleString("zh-CN")} 件</strong></div>`).join("");
  }

  function renderReportRange() {
    const month = state.reportRange === "month";
    $("#dashboardReportCaption").textContent = month ? "月报 · 2026-08-01 至 2026-08-10 的经营情况。" : "日报 · 2026-08-10 截至 10:30 的经营情况。";
    $("#dashboardDateButton").lastChild.textContent = month ? "2026-08" : "2026-08-10";
    $("#dashboardSalesLabel").textContent = month ? "本月销售额" : "今日销售额";
    $("#dashboardSalesValue").textContent = month ? "¥ 268,420.00" : "¥ 12,680.50";
    $("#dashboardOrdersLabel").textContent = month ? "本月订单" : "今日订单";
    $("#dashboardOrdersMetric").textContent = month ? "1,286" : "86";
    $("#dashboardPeriodSalesLabel").textContent = month ? "上月销售额" : "本月销售额";
    $("#dashboardPeriodSalesValue").textContent = month ? "¥ 248,960" : "¥ 268,420";
    $("#reportNetSalesLabel").textContent = month ? "本月净销售额" : "今日净销售额";
    $("#reportNetSalesValue").textContent = month ? "¥ 259,740.00" : "¥ 12,286.50";
    $("#reportRefundLabel").textContent = month ? "本月退款" : "今日退款";
    $("#reportRefundValue").textContent = month ? "¥ 8,680.00" : "¥ 394.00";
  }

  function renderAftersales() {
    const keyword = $("#aftersaleSearch").value.trim().toLowerCase();
    const type = $("#aftersaleType").value;
    const status = $("#aftersaleStatus").value;
    const filtered = aftersales.filter((item) => {
      const matches = !keyword || `${item.id}${item.order}${item.customer}${item.product}`.toLowerCase().includes(keyword);
      return matches && (!type || item.type === type) && (!status || item.status === status);
    });
    $("#aftersaleCount").textContent = `共 ${filtered.length} 笔售后申请`;
    $("#aftersaleRows").innerHTML = filtered.length ? filtered.map((item) => `<tr data-aftersale-id="${item.id}"><td><span class="cell-main">${item.id}</span><span class="cell-sub">订单 ${item.order}</span></td><td>${item.customer}</td><td><div class="product-cell">${renderProductArt(item.art, "")}<div class="product-cell-copy"><strong>${item.product}</strong><span>1 件</span></div></div></td><td><span class="tag ${item.type === "仅退款" ? "info" : "purple"}">${item.type}</span></td><td><span class="cell-main coral-text">${money(item.amount)}</span></td><td>${item.reason}</td><td><span class="tag ${statusClass(item.status)}">${item.status}</span></td><td class="optional-wide">${item.time}</td><td><div class="row-actions">${item.status === "待审核" ? `<button type="button" class="button text review-aftersale">审核</button>` : `<button type="button" class="button text review-aftersale">详情</button>`}</div></td></tr>`).join("") : `<tr><td colspan="9"><div class="empty-state">${icon("return")}<strong>没有匹配的售后申请</strong><span>当前筛选条件下暂无数据</span></div></td></tr>`;
  }

  function renderCustomers() {
    const keyword = $("#customerSearch").value.trim().toLowerCase();
    const filtered = customers.filter((customer) => {
      const matches = !keyword || `${customer.name}${customer.nickname}${customer.phone}`.toLowerCase().includes(keyword);
      return matches;
    });
    $("#customerCount").textContent = `共 ${filtered.length} 位客户`;
    $("#customerRows").innerHTML = filtered.length ? filtered.map((customer) => {
      const aov = Math.round(customer.spend / customer.orders);
      return `<tr data-customer-id="${customer.id}"><td><div class="customer-cell"><span class="avatar soft-green">${customer.avatar}</span><div><span class="cell-main">${customer.name} <small class="muted">@${customer.nickname}</small></span><span class="cell-sub">${customer.phone}</span></div></div></td><td><span class="cell-main">¥${customer.spend.toLocaleString("zh-CN")}</span></td><td>${customer.orders} 次</td><td class="optional-wide">¥${aov}</td><td><span class="cell-main">${customer.recent}</span><span class="cell-sub">${customer.recentDate}</span></td><td class="optional-wide">${customer.joined}</td><td><button type="button" class="icon-button view-customer" title="查看客户详情">${icon("eye")}</button></td></tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("users")}<strong>没有找到匹配客户</strong><span>请调整搜索关键词</span></div></td></tr>`;
  }

  function renderAgents() {
    const keyword = $("#agentSearch").value.trim().toLowerCase();
    const status = $("#agentStatus").value;
    const filtered = agents.filter((agent) => {
      const matches = !keyword || `${agent.name}${agent.account}${agent.invite}`.toLowerCase().includes(keyword);
      return matches && (!status || agent.status === status);
    });
    $("#agentCount").textContent = `共 ${filtered.length} 个代理`;
    $("#agentRows").innerHTML = filtered.length ? filtered.map((agent) => `<tr data-agent-id="${agent.id}">
      <td><div class="agent-cell"><span class="avatar soft-green">${agent.avatar}</span><div><strong>${agent.name}</strong><span>${agent.account} · ${agent.contact}</span></div></div></td>
      <td><span class="cell-main">${agent.rate.toFixed(2)}%</span><span class="cell-sub">新订单生效</span></td>
      <td><button class="invite-code copy-agent-invite" type="button" title="复制邀请码">${agent.invite}${icon("copy")}</button></td>
      <td><span class="cell-main">${agent.customers.toLocaleString("zh-CN")}</span><span class="cell-sub">有效归属</span></td>
      <td><span class="cell-main">¥${agent.sales.toLocaleString("zh-CN")}</span><span class="cell-sub">本月净商品额</span></td>
      <td><span class="cell-main ${agent.negative > 0 ? "negative-balance" : ""}">¥${agent.available.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span><span class="cell-sub">${agent.negative > 0 ? `负余额 ¥${agent.negative.toFixed(2)}` : `冻结 ¥${agent.frozen.toFixed(2)}`}</span></td>
      <td><span class="tag ${statusClass(agent.status)}">${agent.status}</span></td>
      <td><div class="row-actions"><button class="icon-button view-agent" type="button" title="查看代理">${icon("eye")}</button><button class="icon-button edit-agent" type="button" title="编辑代理">${icon("edit")}</button><button class="button text toggle-agent" type="button">${agent.status === "已启用" ? "停用" : "启用"}</button></div></td>
    </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("users")}<strong>没有找到匹配代理</strong><span>请调整搜索或状态筛选</span></div></td></tr>`;
  }

  function renderWithdrawals() {
    const keyword = $("#withdrawalSearch").value.trim().toLowerCase();
    const status = $("#withdrawalStatus").value;
    const filtered = withdrawals.filter((item) => {
      const matches = !keyword || `${item.id}${item.agent}`.toLowerCase().includes(keyword);
      return matches && (!status || item.status === status);
    });
    $("#withdrawalCount").textContent = `共 ${filtered.length} 笔申请`;
    $("#withdrawalRows").innerHTML = filtered.length ? filtered.map((item) => `<tr data-withdrawal-id="${item.id}">
      <td><span class="cell-main">${item.id}</span><span class="cell-sub">银行卡线下转账</span></td>
      <td><span class="cell-main">${item.agent}</span><span class="cell-sub">${item.agentId}</span></td>
      <td><span class="cell-main coral-text">${money(item.amount)}</span></td>
      <td><span class="cell-main">${item.bank}</span><span class="cell-sub">${item.holder} · ${item.card}</span></td>
      <td><span class="tag ${statusClass(item.status)}">${item.status}</span></td>
      <td class="optional-wide">${item.time}</td>
      <td><button class="button text review-withdrawal" type="button">${item.status === "待审核" ? "审核" : item.status === "待打款" ? "去打款" : "查看"}</button></td>
    </tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("wallet")}<strong>没有匹配的提现申请</strong><span>请调整筛选条件</span></div></td></tr>`;
  }

  function drawSalesChart() {
    const canvas = $("#salesChart");
    if (!canvas || !canvas.offsetParent) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 15, right: 18, bottom: 27, left: 42 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const long = state.chartRange === 30;
    const labels = long ? ["07-08", "07-13", "07-18", "07-23", "07-28", "08-02", "08-06"] : ["07-31", "08-01", "08-02", "08-03", "08-04", "08-05", "08-06"];
    const sales = long ? [8.1, 10.2, 9.6, 12.8, 11.7, 14.9, 12.7] : [7.8, 9.1, 8.7, 11.2, 10.4, 14.6, 12.7];
    const orderLine = long ? [49, 67, 61, 75, 70, 94, 86] : [52, 60, 58, 72, 68, 98, 86];
    ctx.clearRect(0, 0, width, height);
    ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#e6ece8";
    ctx.fillStyle = "#89948e";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padding.top + (chartHeight / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(`${16 - i * 4}k`, padding.left - 8, y);
    }
    labels.forEach((label, index) => {
      const x = padding.left + (chartWidth / (labels.length - 1)) * index;
      ctx.textAlign = "center";
      ctx.fillText(label, x, height - 9);
    });

    const line = (values, color, max) => {
      const points = values.map((value, index) => ({
        x: padding.left + (chartWidth / (values.length - 1)) * index,
        y: padding.top + chartHeight - (value / max) * chartHeight
      }));
      ctx.beginPath();
      points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    };
    line(sales, "#2f6b57", 16);
    line(orderLine, "#3978b8", 110);
  }

  function openModal(selector) {
    closeOverlays();
    $("#modalBackdrop").hidden = false;
    $(selector).hidden = false;
    const firstInput = $(`${selector} input:not([type="checkbox"]), ${selector} select`);
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function closeOverlays() {
    const credentialWasVisible = $("#credentialModal") && !$("#credentialModal").hidden;
    $("#modalBackdrop").hidden = true;
    $$(".modal, .drawer").forEach((item) => { item.hidden = true; });
    $("#notificationPanel").hidden = true;
    if (credentialWasVisible) {
      state.oneTimeCredentials = null;
      $("#credentialAccount").textContent = "已隐藏";
      $("#credentialPassword").textContent = "已隐藏";
    }
  }

  function openShipping(orderId) {
    state.activeOrderId = orderId || state.activeOrderId;
    const order = orders.find((item) => item.id === state.activeOrderId);
    $("#shippingTitle").nextElementSibling.textContent = `订单 ${state.activeOrderId} · 共 ${order ? order.count : 3} 件商品`;
    $("#shippingError").hidden = true;
    openModal("#shippingModal");
  }

  function openStock(productId) {
    const product = products.find((item) => item.id === Number(productId));
    if (!product) return;
    state.activeProductId = product.id;
    $("#stockProductName").textContent = product.name;
    $("#currentStock").textContent = product.stock;
    $("#newStock").value = product.stock;
    openModal("#stockModal");
  }

  function openDelete(productId) {
    const product = products.find((item) => item.id === Number(productId));
    if (!product) return;
    state.activeProductId = product.id;
    $("#deleteProductName").textContent = product.name;
    openModal("#deleteModal");
  }

  function openAftersale(id) {
    const item = aftersales.find((after) => after.id === id);
    if (!item) return;
    state.activeAftersaleId = id;
    $("#aftersaleModalNo").textContent = `${item.id} · ${item.type}`;
    $("#reviewProductName").textContent = item.product;
    $("#reviewCustomer").textContent = item.customer;
    $("#reviewAmount").textContent = money(item.amount);
    $("#reviewReason").textContent = item.reason;
    $("#approveAftersale").disabled = item.status !== "待审核";
    $("#rejectAftersale").disabled = item.status !== "待审核";
    openModal("#aftersaleModal");
  }

  function openCustomer(id) {
    const customer = customers.find((item) => item.id === Number(id));
    if (!customer) return;
    state.activeCustomerId = customer.id;
    const aov = Math.round(customer.spend / customer.orders);
    $("#drawerAvatar").textContent = customer.avatar;
    $("#customerDrawerTitle").textContent = customer.name;
    $("#drawerPhone").textContent = customer.phone;
    $("#drawerSpend").textContent = `¥${customer.spend.toLocaleString("zh-CN")}`;
    $("#drawerOrders").textContent = customer.orders;
    $("#drawerAov").textContent = `¥${aov}`;
    $("#drawerRecent").textContent = customer.recent;
    $("#drawerAgentAvatar").textContent = customer.agentId ? customer.agentName.slice(0, 1) : "直";
    $("#drawerAgentName").textContent = customer.agentName;
    $("#drawerAgentBoundAt").textContent = `${customer.agentId ? "绑定于" : "调整于"} ${customer.agentBoundAt}`;
    $("#drawerAgentStatus").textContent = customer.agentId ? "有效" : "平台直客";
    $("#drawerAgentStatus").className = `tag ${customer.agentId ? "success" : "neutral"}`;
    closeOverlays();
    $("#modalBackdrop").hidden = false;
    $("#customerDrawer").hidden = false;
  }

  function openAgentEditor(id = null) {
    const agent = agents.find((item) => item.id === id);
    state.activeAgentId = agent ? agent.id : null;
    $("#agentModalTitle").textContent = agent ? `编辑代理 · ${agent.name}` : "新增代理";
    $("#agentModalSubtitle").textContent = agent ? `${agent.id} · 调整只影响后续业务` : "开通单独代理工作台账号";
    $("#agentNameInput").value = agent ? agent.name : "清和日用馆";
    $("#agentAccountInput").value = agent ? agent.account : "qinghe.store";
    $("#agentRateInput").value = agent ? agent.rate : 8;
    $("#agentStatusInput").value = agent ? agent.status : "已启用";
    $("#agentContactInput").value = agent ? agent.contact : "安和 138****4206";
    $("#agentAuthModeInput").value = agent ? agent.authMode : "全部在售商品";
    $("#agentAuthSummary").textContent = agent ? `${agent.authMode} · ${agent.authorizedCount} 件` : "全部在售商品 · 116 件";
    $("#saveAgent").innerHTML = agent ? `${icon("check")}保存修改` : `${icon("check")}保存并发放临时密码`;
    openModal("#agentModal");
  }

  function openAgentDrawer(id) {
    const agent = agents.find((item) => item.id === id);
    if (!agent) return;
    state.activeAgentId = agent.id;
    $("#agentDrawerAvatar").textContent = agent.avatar;
    $("#agentDrawerTitle").textContent = agent.name;
    $("#agentDrawerAccount").textContent = `${agent.account} · ${agent.id}`;
    $("#agentDrawerCustomers").textContent = agent.customers.toLocaleString("zh-CN");
    $("#agentDrawerSales").textContent = `¥${agent.sales.toLocaleString("zh-CN")}`;
    $("#agentDrawerBalance").textContent = money(agent.available);
    $("#agentDrawerRate").textContent = `${agent.rate.toFixed(2)}%`;
    $("#agentDrawerInvite").textContent = agent.invite;
    $("#agentDrawerAuthMode").textContent = agent.authMode;
    $("#agentDrawerAuthCount").textContent = `${agent.authorizedCount} 件`;
    $("#agentDrawerBank").textContent = `${agent.bank} · ****${agent.cardLast4}`;
    $("#agentDrawerStatus").textContent = agent.status;
    $("#agentWalletAvailable").textContent = money(agent.available);
    $("#agentWalletFrozen").textContent = money(agent.frozen);
    $("#agentWalletNegative").textContent = money(agent.negative);
    $("#agentWalletNegative").classList.toggle("negative-balance", agent.negative > 0);
    closeOverlays();
    $("#modalBackdrop").hidden = false;
    $("#agentDrawer").hidden = false;
  }

  function openWithdrawal(id) {
    const item = withdrawals.find((withdrawal) => withdrawal.id === id);
    if (!item) return;
    state.activeWithdrawalId = item.id;
    state.paymentProofReady = item.proof;
    const agent = agents.find((entry) => entry.id === item.agentId);
    $("#withdrawalModalTitle").textContent = item.status === "待审核" ? "审核提现申请" : item.status === "待打款" ? "登记线下打款" : "提现申请详情";
    $("#withdrawalModalNo").textContent = `${item.id} · ${item.status}`;
    $("#withdrawalAmount").textContent = money(item.amount);
    $("#withdrawalAgentName").textContent = item.agent;
    $("#withdrawalBalance").textContent = money(agent ? agent.available : 0);
    $("#withdrawalFrozen").textContent = money(agent ? agent.frozen : item.amount);
    $("#withdrawalNegative").textContent = money(agent ? agent.negative : 0);
    $("#withdrawalHolder").textContent = item.holder;
    $("#withdrawalBank").textContent = item.bank;
    $("#withdrawalCard").textContent = item.card;
    $("#openBankVerification").hidden = false;
    $("#withdrawalCardTimer").hidden = true;
    const pending = item.status === "待审核";
    const awaitingPayment = item.status === "待打款";
    $("#rejectWithdrawal").hidden = !pending;
    $("#approveWithdrawal").hidden = !pending;
    $("#paymentProofArea").hidden = !awaitingPayment;
    $("#markWithdrawalPaid").hidden = !awaitingPayment;
    $("#markWithdrawalPaid").disabled = !state.paymentProofReady;
    $("#paymentProofButton").classList.toggle("is-ready", state.paymentProofReady);
    $("#paymentProofLabel").textContent = state.paymentProofReady ? "已上传：银行转账回单.png" : "上传转账凭证";
    openModal("#withdrawalModal");
  }

  function creditAgentWallet(agent, amount) {
    if (!agent || amount <= 0) return;
    const offset = Math.min(agent.negative, amount);
    agent.negative -= offset;
    agent.available += amount - offset;
  }

  function showOneTimeCredentials(account) {
    const password = `Qx@${Math.random().toString(36).slice(2, 8).toUpperCase()}8`;
    openModal("#credentialModal");
    state.oneTimeCredentials = { account, password };
    $("#credentialAccount").textContent = account;
    $("#credentialPassword").textContent = password;
  }

  function openCommissionAudit() {
    const agent = agents.find((item) => item.id === state.activeAgentId);
    if (!agent) return;
    openModal("#commissionAuditModal");
    $("#commissionAuditAgent").textContent = `${agent.name} · 不可变记录`;
    $("#auditRate").textContent = `${agent.rate.toFixed(2)}%`;
    $("#auditAvailable").textContent = money(agent.available);
    $("#auditFrozen").textContent = money(agent.frozen);
    $("#auditNegative").textContent = money(agent.negative);
  }

  function secureBankCard(agentId) {
    const secureResponse = {
      A1038: ["6225", "8812", "7620", "3916"],
      A1026: ["6217", "0018", "3420", "2077"],
      A1019: ["6222", "0201", "8860", "6128"],
      A1012: ["6228", "4806", "2310", "4632"],
      A1007: ["6216", "6100", "4520", "7810"]
    }[agentId];
    return secureResponse ? secureResponse.join(" ") : "安全服务未返回卡号";
  }

  function openBankVerification() {
    const withdrawal = withdrawals.find((item) => item.id === state.activeWithdrawalId);
    if (!withdrawal) return;
    openModal("#bankVerifyModal");
    state.bankRevealContext = { withdrawalId: withdrawal.id, agentId: withdrawal.agentId };
  }

  function revealVerifiedBankCard() {
    const context = state.bankRevealContext;
    if (!context) return;
    const password = $("#bankVerifyPassword").value.trim();
    const code = $("#bankVerifyCode").value.trim();
    if (!password || !/^\d{6}$/.test(code)) return showToast("请完成密码和 6 位安全验证码");
    const fullCard = secureBankCard(context.agentId);
    closeOverlays();
    openWithdrawal(context.withdrawalId);
    $("#withdrawalCard").textContent = fullCard;
    $("#openBankVerification").hidden = true;
    $("#withdrawalCardTimer").hidden = false;
    state.bankRevealContext = null;
    clearTimeout(state.bankRevealTimer);
    state.bankRevealTimer = setTimeout(() => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (item && !$("#withdrawalModal").hidden) {
        $("#withdrawalCard").textContent = item.card;
        $("#openBankVerification").hidden = false;
        $("#withdrawalCardTimer").hidden = true;
      }
    }, 60000);
    showToast("二次验证通过，完整卡号临时展示 60 秒");
  }

  function openOrderDetail(id) {
    const order = orders.find((item) => item.id === id);
    if (!order) return;
    state.activeOrderId = id;
    $("#detailOrderNumber").textContent = `订单号 ${order.id}`;
    const status = $("#detailOrderStatus");
    status.textContent = order.status;
    status.className = `tag ${statusClass(order.status)}`;
    const canShip = order.status === "待发货";
    $("#openShipModal").hidden = !canShip;
    $("#sideShipButton").hidden = !canShip;
    showPage("order-detail");
  }

  function setupEvents() {
    $("#loginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const username = $("#username").value.trim();
      const password = $("#password").value.trim();
      if (!username || !password) {
        $("#loginError").hidden = false;
        return;
      }
      $("#loginError").hidden = true;
      sessionStorage.setItem("qingyuAdminLoggedIn", "1");
      showApp();
      showToast("登录成功，欢迎回来");
    });

    $("#togglePassword").addEventListener("click", () => {
      const input = $("#password");
      input.type = input.type === "password" ? "text" : "password";
    });

    $("#logoutButton").addEventListener("click", () => {
      sessionStorage.removeItem("qingyuAdminLoggedIn");
      state.page = "dashboard";
      showLogin();
      showToast("已退出管理后台");
    });

    $("#sidebarToggle").addEventListener("click", () => {
      if (window.innerWidth <= 1180) {
        document.body.classList.toggle("sidebar-mobile-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
      }
      setTimeout(drawSalesChart, 220);
    });

    $("#notificationButton").addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = $("#notificationPanel");
      panel.hidden = !panel.hidden;
    });

    $("#globalSearchForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = $("#globalSearch").value.trim();
      if (!value) return showToast("请输入商品、订单或客户关键词");
      $("#productSearch").value = value;
      renderProducts();
      showPage("products");
      showToast(`正在展示与“${value}”相关的商品`);
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        $("#globalSearch").focus();
      }
      if (event.key === "Escape") closeOverlays();
    });

    document.addEventListener("click", (event) => {
      const go = event.target.closest("[data-go]");
      if (go) {
        const page = go.dataset.go;
        if (page === "orders" && go.dataset.orderStatus !== undefined) {
          $("#orderStatus").value = go.dataset.orderStatus;
          renderOrders();
        }
        showPage(page);
      }

      const nav = event.target.closest(".nav-item[data-page]");
      if (nav) showPage(nav.dataset.page);

      const toastButton = event.target.closest("[data-toast]");
      if (toastButton) showToast(toastButton.dataset.toast);

      const closeButton = event.target.closest(".modal-close, .drawer-close, [data-close-panel]");
      if (closeButton) closeOverlays();

      const viewOrder = event.target.closest(".view-order");
      if (viewOrder) openOrderDetail(viewOrder.closest("tr").dataset.orderId);

      const shipOrder = event.target.closest(".ship-order");
      if (shipOrder) openShipping(shipOrder.closest("tr").dataset.orderId);

      const stockAction = event.target.closest(".stock-action");
      if (stockAction) openStock(stockAction.closest("tr").dataset.productId);

      const editProduct = event.target.closest(".edit-product");
      if (editProduct) {
        const product = products.find((item) => item.id === Number(editProduct.closest("tr").dataset.productId));
        $("#productEditTitle").textContent = `编辑商品 · ${product.brand}`;
        showPage("product-edit");
      }

      const deleteProduct = event.target.closest(".delete-product");
      if (deleteProduct) openDelete(deleteProduct.closest("tr").dataset.productId);

      const recommend = event.target.closest(".recommend-toggle");
      if (recommend) {
        const product = products.find((item) => item.id === Number(recommend.closest("tr").dataset.productId));
        product.recommended = !product.recommended;
        recommend.classList.toggle("active", product.recommended);
        recommend.setAttribute("aria-pressed", product.recommended);
        showToast(product.recommended ? "已加入首页推荐" : "已取消首页推荐");
      }

      const review = event.target.closest(".review-aftersale");
      if (review) openAftersale(review.closest("tr").dataset.aftersaleId);

      const viewCustomer = event.target.closest(".view-customer");
      if (viewCustomer) openCustomer(viewCustomer.closest("tr").dataset.customerId);

      const viewAgent = event.target.closest(".view-agent");
      if (viewAgent) openAgentDrawer(viewAgent.closest("tr").dataset.agentId);

      const editAgent = event.target.closest(".edit-agent");
      if (editAgent) openAgentEditor(editAgent.closest("tr").dataset.agentId);

      const toggleAgent = event.target.closest(".toggle-agent");
      if (toggleAgent) {
        const agent = agents.find((item) => item.id === toggleAgent.closest("tr").dataset.agentId);
        if (agent) {
          agent.status = agent.status === "已启用" ? "已停用" : "已启用";
          renderAgents();
          showToast(agent.status === "已停用" ? "已停用：登录、新绑定与新佣金已禁止" : "代理账号已恢复启用");
        }
      }

      const copyInvite = event.target.closest(".copy-agent-invite");
      if (copyInvite) {
        const agent = agents.find((item) => item.id === copyInvite.closest("tr").dataset.agentId);
        if (agent && navigator.clipboard) navigator.clipboard.writeText(agent.invite).catch(() => {});
        if (agent) showToast(`已复制邀请码 ${agent.invite}`);
      }

      const reviewWithdrawal = event.target.closest(".review-withdrawal");
      if (reviewWithdrawal) openWithdrawal(reviewWithdrawal.closest("tr").dataset.withdrawalId);

      const copyButton = event.target.closest("[data-copy]");
      if (copyButton) {
        const text = copyButton.dataset.copy;
        if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
        showToast("收货信息已复制");
      }

      const chartButton = event.target.closest("[data-chart-range]");
      if (chartButton) {
        state.chartRange = Number(chartButton.dataset.chartRange);
        $$("[data-chart-range]").forEach((item) => item.classList.toggle("active", item === chartButton));
        drawSalesChart();
      }

      const reportButton = event.target.closest("[data-report-range]");
      if (reportButton) {
        state.reportRange = reportButton.dataset.reportRange;
        $$("[data-report-range]").forEach((item) => item.classList.toggle("active", item === reportButton));
        renderReportRange();
      }

      const rankingButton = event.target.closest("[data-ranking-type]");
      if (rankingButton) {
        state.rankingType = rankingButton.dataset.rankingType;
        $$("[data-ranking-type]").forEach((item) => item.classList.toggle("active", item === rankingButton));
        renderRankings();
      }

      const editTab = event.target.closest("[data-edit-tab]");
      if (editTab) {
        $$("[data-edit-tab]").forEach((item) => item.classList.toggle("active", item === editTab));
        $$("[data-edit-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.editPanel === editTab.dataset.editTab));
      }

      const skuDelete = event.target.closest(".sku-delete");
      if (skuDelete) {
        const rows = $$("#skuRows tr");
        if (rows.length <= 1) return showToast("至少保留一个商品规格");
        skuDelete.closest("tr").remove();
        showToast("规格已删除");
      }
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest("#notificationPanel, #notificationButton")) $("#notificationPanel").hidden = true;
    });

    $("#modalBackdrop").addEventListener("click", closeOverlays);
    $("#openShipModal").addEventListener("click", () => openShipping(state.activeOrderId));
    $("#sideShipButton").addEventListener("click", () => openShipping(state.activeOrderId));

    $("#confirmShipping").addEventListener("click", () => {
      const company = $("#shippingCompany").value;
      const tracking = $("#trackingNumber").value.trim();
      if (!company || !tracking) {
        $("#shippingError").hidden = false;
        return;
      }
      const order = orders.find((item) => item.id === state.activeOrderId);
      if (order) order.status = "运输中";
      $("#detailOrderStatus").textContent = "运输中";
      $("#detailOrderStatus").className = "tag info";
      $("#openShipModal").hidden = true;
      $("#sideShipButton").hidden = true;
      $("#orderProgress").children[2].classList.remove("current");
      $("#orderProgress").children[2].classList.add("done");
      $("#orderProgress").children[3].classList.add("current");
      renderOrders();
      renderDashboardOrders();
      closeOverlays();
      showToast(`发货成功：${company} ${tracking}`);
    });

    $("#confirmStock").addEventListener("click", () => {
      const value = Math.max(0, Number($("#newStock").value));
      const product = products.find((item) => item.id === state.activeProductId);
      if (product) product.stock = value;
      renderProducts();
      renderRankings();
      closeOverlays();
      showToast("库存已调整，并写入库存流水");
    });

    $("#confirmDelete").addEventListener("click", () => {
      const index = products.findIndex((item) => item.id === state.activeProductId);
      if (index >= 0) products.splice(index, 1);
      renderProducts();
      renderRankings();
      closeOverlays();
      showToast("商品已删除，历史订单快照不受影响");
    });

    $("#approveAftersale").addEventListener("click", () => {
      const item = aftersales.find((after) => after.id === state.activeAftersaleId);
      if (item) item.status = "待退款";
      renderAftersales();
      closeOverlays();
      showToast("已同意申请，等待退款处理");
    });

    $("#rejectAftersale").addEventListener("click", () => {
      const item = aftersales.find((after) => after.id === state.activeAftersaleId);
      if (item) item.status = "已拒绝";
      renderAftersales();
      closeOverlays();
      showToast("已拒绝售后申请并通知客户");
    });

    $("#openCreateAgent").addEventListener("click", () => openAgentEditor());
    $("#agentAuthModeInput").addEventListener("change", () => {
      const custom = $("#agentAuthModeInput").value === "自定义白名单";
      $("#agentAuthSummary").textContent = custom ? "自定义白名单 · 0 件" : "全部在售商品 · 116 件";
    });
    $("#configureAgentProducts").addEventListener("click", () => {
      if ($("#agentAuthModeInput").value === "全部在售商品") return showToast("已自动授权全部 116 件在售商品");
      $("#agentAuthSummary").textContent = "自定义白名单 · 42 件";
      showToast("商品白名单配置原型：已选择 42 件在售商品");
    });

    $("#saveAgent").addEventListener("click", () => {
      const name = $("#agentNameInput").value.trim();
      const account = $("#agentAccountInput").value.trim();
      const rate = Math.max(0, Math.min(100, Number($("#agentRateInput").value)));
      if (!name || !account || Number.isNaN(rate)) return showToast("请完整填写代理名称、账号和佣金比例");
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (agent) {
        agent.name = name;
        agent.account = account;
        agent.rate = rate;
        agent.status = $("#agentStatusInput").value;
        agent.contact = $("#agentContactInput").value.trim();
        agent.authMode = $("#agentAuthModeInput").value;
        agent.authorizedCount = agent.authMode === "全部在售商品" ? 116 : Number($("#agentAuthSummary").textContent.match(/\d+/)?.[0] || 0);
        renderAgents();
        closeOverlays();
        showToast("代理资料已保存，新佣金比例仅影响后续订单");
        return;
      }
      const sequence = 1040 + agents.length;
      const authMode = $("#agentAuthModeInput").value;
      agents.unshift({ id: `A${sequence}`, name, account, contact: $("#agentContactInput").value.trim(), rate, invite: `QX-A${sequence}`, authMode, authorizedCount: authMode === "全部在售商品" ? 116 : 42, customers: 0, sales: 0, available: 0, frozen: 0, negative: 0, bank: "未设置", cardLast4: "----", status: $("#agentStatusInput").value, avatar: name.slice(0, 1) });
      renderAgents();
      showOneTimeCredentials(account);
      showToast("代理已创建，请安全交付一次性登录凭证");
    });

    $("#openAttributionModal").addEventListener("click", () => {
      const customer = customers.find((item) => item.id === state.activeCustomerId);
      $("#attributionCustomer").textContent = `客户 · ${customer ? customer.name : "未选择"}`;
      openModal("#attributionModal");
      $("#attributionAgent").value = customer && customer.agentId ? customer.agentId : "DIRECT";
    });

    $("#confirmAttribution").addEventListener("click", () => {
      if (!$("#attributionReason").value.trim()) return showToast("请填写调整原因");
      const selected = $("#attributionAgent").value;
      const customer = customers.find((item) => item.id === state.activeCustomerId);
      if (!customer) return showToast("未找到待调整客户");
      const previousAgent = agents.find((item) => item.id === customer.agentId);
      const nextAgent = agents.find((item) => item.id === selected);
      if (previousAgent && previousAgent.id !== selected) previousAgent.customers = Math.max(0, previousAgent.customers - 1);
      if (nextAgent && customer.agentId !== selected) nextAgent.customers += 1;
      customer.agentId = nextAgent ? nextAgent.id : null;
      customer.agentName = nextAgent ? nextAgent.name : "平台直接客户";
      customer.agentBoundAt = "2026-08-10 11:20";
      renderAgents();
      openCustomer(customer.id);
      showToast("客户服务归属已调整，仅影响后续订单");
    });

    $("#copyDrawerInvite").addEventListener("click", () => {
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (agent && navigator.clipboard) navigator.clipboard.writeText(agent.invite).catch(() => {});
      if (agent) showToast(`已复制邀请码 ${agent.invite}`);
    });

    $("#editDrawerAgent").addEventListener("click", () => openAgentEditor(state.activeAgentId));
    $("#configureDrawerProducts").addEventListener("click", () => {
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (agent) showToast(`${agent.authMode}：当前授权 ${agent.authorizedCount} 件商品`);
    });
    $("#openCommissionAudit").addEventListener("click", openCommissionAudit);
    $("#openBankVerification").addEventListener("click", openBankVerification);
    $("#confirmBankVerification").addEventListener("click", revealVerifiedBankCard);

    $("#copyCredentialAccount").addEventListener("click", () => {
      if (!state.oneTimeCredentials) return showToast("登录凭证已隐藏");
      if (navigator.clipboard) navigator.clipboard.writeText(state.oneTimeCredentials.account).catch(() => {});
      showToast("代理登录账号已复制");
    });

    $("#copyCredentialPassword").addEventListener("click", () => {
      if (!state.oneTimeCredentials) return showToast("临时密码已隐藏");
      if (navigator.clipboard) navigator.clipboard.writeText(state.oneTimeCredentials.password).catch(() => {});
      showToast("临时密码已复制，请通过安全通道交付");
    });

    $("#approveWithdrawal").addEventListener("click", () => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (!item || item.status !== "待审核") return;
      item.status = "待打款";
      renderWithdrawals();
      closeOverlays();
      showToast("已审核通过，请完成线下转账并上传凭证");
    });

    $("#rejectWithdrawal").addEventListener("click", () => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (!item || item.status !== "待审核") return;
      const agent = agents.find((entry) => entry.id === item.agentId);
      if (agent) {
        agent.frozen = Math.max(0, agent.frozen - item.amount);
        creditAgentWallet(agent, item.amount);
      }
      item.status = "已拒绝";
      renderWithdrawals();
      renderAgents();
      closeOverlays();
      showToast("已拒绝申请，冻结金额已返回可提现余额");
    });

    $("#paymentProofButton").addEventListener("click", () => {
      state.paymentProofReady = true;
      $("#paymentProofButton").classList.add("is-ready");
      $("#paymentProofLabel").textContent = "已上传：银行转账回单.png";
      $("#markWithdrawalPaid").disabled = false;
      showToast("打款凭证已上传");
    });

    $("#markWithdrawalPaid").addEventListener("click", () => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (!item || item.status !== "待打款" || !state.paymentProofReady) return showToast("请先上传打款凭证");
      const agent = agents.find((entry) => entry.id === item.agentId);
      if (agent) agent.frozen = Math.max(0, agent.frozen - item.amount);
      item.status = "已打款";
      item.proof = true;
      renderWithdrawals();
      renderAgents();
      closeOverlays();
      showToast("已留存凭证并标记为已打款");
    });

    $("#publishProduct").addEventListener("click", () => {
      showToast("商品信息已保存并上架");
      setTimeout(() => showPage("products"), 450);
    });

    $("#addSku").addEventListener("click", () => {
      $("#skuRows").insertAdjacentHTML("beforeend", `<tr><td><input value="新规格"></td><td><input value="NEW-SKU"></td><td><div class="money-input"><span>¥</span><input value="0.00"></div></td><td><input type="number" value="0"></td><td><button class="icon-button danger sku-delete" title="删除规格">${icon("trash")}</button></td></tr>`);
      showToast("已新增规格，请填写价格和库存");
    });

    ["productSearch", "productCategory", "productBrand", "productStatus"].forEach((id) => $("#" + id).addEventListener(id === "productSearch" ? "input" : "change", renderProducts));
    ["orderSearch", "orderStatus"].forEach((id) => $("#" + id).addEventListener(id === "orderSearch" ? "input" : "change", renderOrders));
    ["aftersaleSearch", "aftersaleType", "aftersaleStatus"].forEach((id) => $("#" + id).addEventListener(id === "aftersaleSearch" ? "input" : "change", renderAftersales));
    $("#customerSearch").addEventListener("input", renderCustomers);
    $("#agentSearch").addEventListener("input", renderAgents);
    $("#agentStatus").addEventListener("change", renderAgents);
    $("#withdrawalSearch").addEventListener("input", renderWithdrawals);
    $("#withdrawalStatus").addEventListener("change", renderWithdrawals);

    $("#productReset").addEventListener("click", () => {
      $("#productSearch").value = ""; $("#productCategory").value = ""; $("#productBrand").value = ""; $("#productStatus").value = ""; renderProducts();
    });
    $("#orderReset").addEventListener("click", () => { $("#orderSearch").value = ""; $("#orderStatus").value = ""; renderOrders(); });
    $("#aftersaleReset").addEventListener("click", () => { $("#aftersaleSearch").value = ""; $("#aftersaleType").value = ""; $("#aftersaleStatus").value = ""; renderAftersales(); });
    $("#customerReset").addEventListener("click", () => { $("#customerSearch").value = ""; renderCustomers(); });
    $("#agentReset").addEventListener("click", () => { $("#agentSearch").value = ""; $("#agentStatus").value = ""; renderAgents(); });
    $("#withdrawalReset").addEventListener("click", () => { $("#withdrawalSearch").value = ""; $("#withdrawalStatus").value = ""; renderWithdrawals(); });

    $$('[data-status-shortcut]').forEach((button) => button.addEventListener("click", () => {
      $("#productStatus").value = button.dataset.statusShortcut;
      renderProducts();
      $$(".subnav-tabs button").forEach((item) => item.classList.toggle("active", item === button));
    }));

    $$('[data-order-shortcut]').forEach((button) => button.addEventListener("click", () => {
      $("#orderStatus").value = button.dataset.orderShortcut;
      renderOrders();
      $$('[data-order-shortcut]').forEach((item) => item.classList.toggle("active", item === button));
    }));

    window.addEventListener("resize", () => {
      document.body.classList.remove("sidebar-mobile-open");
      if (state.page === "dashboard") drawSalesChart();
    });
  }

  function init() {
    const prototypeParams = new URLSearchParams(window.location.search);
    const requestedPage = prototypeParams.get("view");
    if (requestedPage && pageTitles[requestedPage]) state.page = requestedPage;
    renderProducts();
    renderOrders();
    renderDashboardOrders();
    renderRankings();
    renderReportRange();
    renderAftersales();
    renderCustomers();
    renderAgents();
    renderWithdrawals();
    setupEvents();
    if (prototypeParams.get("autologin") === "1" || sessionStorage.getItem("qingyuAdminLoggedIn") === "1") showApp();
    else showLogin();
  }

  init();
})();
