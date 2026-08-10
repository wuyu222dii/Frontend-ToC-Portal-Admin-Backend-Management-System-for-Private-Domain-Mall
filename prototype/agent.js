(function () {
  "use strict";

  const pageTitles = {
    dashboard: "经营概览",
    products: "推广商品",
    customers: "我的客户",
    orders: "归属订单",
    commission: "佣金明细",
    wallet: "我的钱包",
    account: "账户设置"
  };

  const products = [
    { id: 1, name: "植萃研氨基酸净澈洁面乳 120g", brand: "植萃研", category: "护肤品", price: 69, commission: 5.52, sales: 1826, image: "assets/product-1.png", tag: "热销", stock: "库存充足" },
    { id: 2, name: "沐光无硅油蓬松洗发水 500ml", brand: "沐光", category: "洗发水", price: 89, commission: 7.12, sales: 1432, image: "assets/product-2.png", tag: "热销", stock: "库存充足" },
    { id: 3, name: "青木序积雪草舒缓修护霜 50g", brand: "青木序", category: "护肤品", price: 129, commission: 10.32, sales: 986, image: "assets/product-3.png", tag: "新品", stock: "库存充足" },
    { id: 4, name: "净简酵素浓缩洗衣凝珠 30颗", brand: "净简", category: "家庭清洁", price: 49, commission: 3.92, sales: 862, image: "assets/product-4.png", tag: "家庭装", stock: "库存充足" },
    { id: 5, name: "植萃研烟酰胺焕亮精华液 30ml", brand: "植萃研", category: "护肤品", price: 159, commission: 12.72, sales: 748, image: "assets/product-5.png", tag: "精选", stock: "库存较少" },
    { id: 6, name: "沐光白茶香氛沐浴露 500ml", brand: "沐光", category: "沐浴露", price: 79, commission: 6.32, sales: 635, image: "assets/product-6.png", tag: "热销", stock: "库存充足" },
    { id: 7, name: "青木序轻透倍护防晒乳 SPF50+", brand: "青木序", category: "护肤品", price: 119, commission: 9.52, sales: 528, image: "assets/product-7.png", tag: "夏日", stock: "补货中" },
    { id: 8, name: "净简柑橘厨房重油污清洁剂", brand: "净简", category: "家庭清洁", price: 39, commission: 3.12, sales: 426, image: "assets/product-8.png", tag: "新品", stock: "库存充足" }
  ];

  const customers = [
    { id: 1, name: "Moon", phone: "6821", city: "杭州", bound: "2026-01-20", spend: 3286, orders: 18, recent: "氨基酸净澈洁面乳", recentTime: "今天 09:18", status: "消费客户", avatar: "M" },
    { id: 2, name: "Mina", phone: "3096", city: "宁波", bound: "2026-02-08", spend: 1688, orders: 9, recent: "无硅油蓬松洗发水", recentTime: "今天 09:02", status: "消费客户", avatar: "M" },
    { id: 3, name: "嘉禾", phone: "2218", city: "绍兴", bound: "2026-03-22", spend: 892, orders: 6, recent: "酵素浓缩洗衣凝珠", recentTime: "今天 08:46", status: "消费客户", avatar: "嘉" },
    { id: 4, name: "Zoe", phone: "5107", city: "杭州", bound: "2026-01-26", spend: 4290, orders: 26, recent: "积雪草舒缓修护霜", recentTime: "昨天 20:25", status: "消费客户", avatar: "Z" },
    { id: 5, name: "悦悦", phone: "8432", city: "湖州", bound: "2026-05-09", spend: 2386, orders: 13, recent: "白茶香氛沐浴露", recentTime: "08-08 18:12", status: "消费客户", avatar: "悦" },
    { id: 6, name: "Yuki", phone: "0076", city: "嘉兴", bound: "2026-07-19", spend: 658, orders: 4, recent: "烟酰胺焕亮精华液", recentTime: "08-07 07:58", status: "消费客户", avatar: "Y" },
    { id: 7, name: "Kira", phone: "4175", city: "金华", bound: "2026-08-06", spend: 0, orders: 0, recent: "暂无购买", recentTime: "-", status: "未消费", avatar: "K" }
  ];

  const orders = [
    { id: "QX202608100028", customer: "Moon", phone: "6821", city: "杭州", product: "氨基酸洁面乳等 2 款", productId: 1, count: 3, amount: 227, status: "待发货", commission: 18.16, commissionStatus: "预计", time: "08-10 09:18", aftersale: "无" },
    { id: "QX202608100027", customer: "Mina", phone: "3096", city: "宁波", product: "无硅油蓬松洗发水", productId: 2, count: 1, amount: 89, status: "退款售后", commission: -7.12, commissionStatus: "冲减", time: "08-10 09:02", aftersale: "平台退款中" },
    { id: "QX202608100026", customer: "嘉禾", phone: "2218", city: "绍兴", product: "酵素浓缩洗衣凝珠", productId: 4, count: 2, amount: 84, status: "运输中", commission: 6.72, commissionStatus: "预计", time: "08-10 08:46", aftersale: "无" },
    { id: "QX202608100025", customer: "Zoe", phone: "5107", city: "杭州", product: "积雪草舒缓修护霜", productId: 3, count: 1, amount: 109, status: "已完成", commission: 8.72, commissionStatus: "已入账", time: "08-10 08:25", aftersale: "无" },
    { id: "QX202608090186", customer: "悦悦", phone: "8432", city: "湖州", product: "白茶香氛沐浴露等 3 款", productId: 6, count: 5, amount: 326, status: "待发货", commission: 26.08, commissionStatus: "预计", time: "08-09 18:12", aftersale: "无" },
    { id: "QX202608090142", customer: "Yuki", phone: "0076", city: "嘉兴", product: "烟酰胺焕亮精华液", productId: 5, count: 1, amount: 139, status: "已完成", commission: 11.12, commissionStatus: "已入账", time: "08-09 16:58", aftersale: "无" },
    { id: "QX202608080095", customer: "Moon", phone: "6821", city: "杭州", product: "氨基酸洁面乳旅行装", productId: 1, count: 2, amount: 50, status: "运输中", commission: 4, commissionStatus: "预计", time: "08-08 12:31", aftersale: "无" },
    { id: "QX202608070251", customer: "Zoe", phone: "5107", city: "杭州", product: "轻透倍护防晒乳", productId: 7, count: 1, amount: 99, status: "已完成", commission: 7.92, commissionStatus: "已入账", time: "08-07 10:16", aftersale: "售后期内" }
  ];

  const commissions = [
    { id: 1, time: "08-10 09:18", type: "预计", order: "QX202608100028", product: "氨基酸洁面乳等 2 款", base: 227, rate: "8.00%", amount: 18.16, impact: "待订单完成" },
    { id: 2, time: "08-10 09:11", type: "冲减", order: "QX202608100027", product: "无硅油蓬松洗发水", base: 89, rate: "8.00%", amount: -7.12, impact: "已扣减余额" },
    { id: 3, time: "08-10 08:46", type: "预计", order: "QX202608100026", product: "酵素浓缩洗衣凝珠", base: 84, rate: "8.00%", amount: 6.72, impact: "待订单完成" },
    { id: 4, time: "08-10 08:25", type: "入账", order: "QX202608100025", product: "积雪草舒缓修护霜", base: 109, rate: "8.00%", amount: 8.72, impact: "可提现" },
    { id: 5, time: "08-09 18:12", type: "预计", order: "QX202608090186", product: "白茶香氛沐浴露等 3 款", base: 326, rate: "8.00%", amount: 26.08, impact: "待订单完成" },
    { id: 6, time: "08-09 16:58", type: "入账", order: "QX202608090142", product: "烟酰胺焕亮精华液", base: 139, rate: "8.00%", amount: 11.12, impact: "可提现" },
    { id: 7, time: "08-08 15:36", type: "冲减", order: "QX202608050077", product: "白茶香氛沐浴露", base: 69, rate: "8.00%", amount: -5.52, impact: "已扣减余额" },
    { id: 8, time: "08-08 12:31", type: "入账", order: "QX202608080095", product: "氨基酸洁面乳旅行装", base: 50, rate: "8.00%", amount: 4, impact: "可提现" }
  ];

  const withdrawals = [
    { id: "WD202608020018", time: "2026-08-02 10:28", amount: 2000, bank: "招商银行 · 6088", status: "已到账", completed: "2026-08-03 16:42", note: "银行转账成功", proof: "PAY202608031642" },
    { id: "WD202607180012", time: "2026-07-18 09:16", amount: 1500, bank: "招商银行 · 6088", status: "已到账", completed: "2026-07-19 14:08", note: "银行转账成功", proof: "PAY202607191408" },
    { id: "WD202607060009", time: "2026-07-06 18:30", amount: 3000, bank: "招商银行 · 6088", status: "已到账", completed: "2026-07-08 11:22", note: "银行转账成功", proof: "PAY202607081122" },
    { id: "WD202606220006", time: "2026-06-22 08:12", amount: 200, bank: "招商银行 · 6088", status: "已驳回", completed: "2026-06-22 15:30", note: "收款账户姓名与代理实名信息不一致", proof: "-" },
    { id: "WD202606080003", time: "2026-06-08 12:45", amount: 1200, bank: "招商银行 · 6088", status: "已到账", completed: "2026-06-09 17:05", note: "银行转账成功", proof: "PAY202606091705" }
  ];

  const state = {
    page: "dashboard",
    chartRange: 7,
    forcePassword: false,
    balanceVisible: true,
    activeProductId: 1
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const icon = (id) => `<svg class="icon"><use href="#i-${id}"></use></svg>`;
  const money = (value) => `${Number(value) < 0 ? "- " : ""}¥ ${Math.abs(Number(value)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const safe = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

  function statusClass(status) {
    return {
      "待发货": "warning", "运输中": "info", "已完成": "success", "退款售后": "danger",
      "预计": "warning", "入账": "success", "已入账": "success", "冲减": "danger",
      "已到账": "success", "审核中": "warning", "已审核": "info", "已驳回": "danger"
    }[status] || "";
  }

  let toastTimer;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function renderSalesBars() {
    const isThirtyDays = state.chartRange === 30;
    const values = isThirtyDays ? [1280, 1980, 1760, 2460, 2210, 2880, 3180, 2640, 3560, 3220, 3980, 4220] : [1680, 2260, 1980, 2860, 2480, 4074, 3286];
    const labels = isThirtyDays ? ["07-12", "07-15", "07-18", "07-21", "07-24", "07-27", "07-30", "08-02", "08-04", "08-06", "08-08", "08-10"] : ["08-04", "08-05", "08-06", "08-07", "08-08", "08-09", "今天"];
    const max = Math.max(...values);
    $("#trendTotal").textContent = isThirtyDays ? "¥ 83,460" : "¥ 18,620";
    $("#salesBars").innerHTML = values.map((value, index) => `<div class="sales-bar"><i style="height:${Math.max(8, value / max * 116)}px"><em>${money(value)}</em></i><span>${labels[index]}</span></div>`).join("");
  }

  function productById(id) {
    return products.find((product) => product.id === Number(id)) || products[0];
  }

  function renderProducts() {
    const keyword = $("#productSearch").value.trim().toLowerCase();
    const category = $("#productCategory").value;
    const sort = $("#productSort").value;
    const filtered = products.filter((product) => (!keyword || `${product.name}${product.brand}`.toLowerCase().includes(keyword)) && (!category || product.category === category));
    filtered.sort((a, b) => sort === "commission" ? b.commission - a.commission : sort === "new" ? b.id - a.id : b.sales - a.sales);
    $("#productGrid").innerHTML = filtered.length ? filtered.map((product) => `<article class="product-card">
      <div class="product-image"><img src="${product.image}" alt="${safe(product.name)}"><span class="tag ${product.tag === "热销" ? "danger" : product.tag === "新品" ? "info" : "success"}">${product.tag}</span></div>
      <div class="product-body"><span class="product-brand">${product.brand} · ${product.category}</span><h3 title="${safe(product.name)}">${product.name}</h3>
        <div class="product-price"><div><span>平台零售价</span><strong>${money(product.price)}</strong></div><span>预计佣金 ${money(product.commission)}</span></div>
        <div class="product-meta"><span>累计销量 ${product.sales.toLocaleString("zh-CN")}</span><span>${product.stock}</span></div>
        <div class="product-actions"><button class="button secondary" type="button" data-product-detail="${product.id}"><svg class="icon"><use href="#i-eye"></use></svg>查看</button><button class="button primary" type="button" data-share-product="${product.id}"><svg class="icon"><use href="#i-share"></use></svg>立即推广</button></div>
      </div></article>`).join("") : `<div class="panel empty-state">${icon("package")}<strong>没有找到匹配商品</strong><span>可尝试调整关键词或分类</span></div>`;
  }

  function customerCard(customer) {
    return `<article class="mobile-data-card" data-customer-id="${customer.id}"><div class="mobile-card-head"><div><strong>${customer.name} · 手机尾号 ${customer.phone}</strong><span>${customer.city} · ${customer.bound} 绑定</span></div><span class="tag ${customer.status === "消费客户" ? "success" : ""}">${customer.status}</span></div><div class="mobile-card-body"><div><span>归属消费</span><strong>${money(customer.spend)}</strong></div><div><span>消费次数</span><strong>${customer.orders} 次</strong></div><div><span>最近购买</span><strong>${customer.recent}</strong></div><div><span>最近时间</span><strong>${customer.recentTime}</strong></div></div><div class="mobile-card-action"><span>客户隐私信息已脱敏</span><button class="button secondary" type="button" data-customer-detail="${customer.id}">查看详情</button></div></article>`;
  }

  function renderCustomers() {
    const keyword = $("#customerSearch").value.trim().toLowerCase();
    const status = $("#customerStatus").value;
    const filtered = customers.filter((customer) => (!keyword || `${customer.name}${customer.phone}${customer.city}`.toLowerCase().includes(keyword)) && (!status || customer.status === status));
    $("#customerCount").textContent = `共 ${filtered.length} 位客户`;
    $("#customerRows").innerHTML = filtered.length ? filtered.map((customer) => `<tr><td><div class="customer-cell"><span class="customer-avatar">${customer.avatar}</span><div><span class="cell-main">${customer.name}</span><span class="cell-sub">手机尾号 ${customer.phone}</span></div></div></td><td>${customer.city}</td><td>${customer.bound}</td><td><span class="cell-main">${money(customer.spend)}</span></td><td>${customer.orders} 次</td><td><span class="cell-main">${customer.recent}</span><span class="cell-sub">${customer.recentTime}</span></td><td><button class="icon-button" type="button" data-customer-detail="${customer.id}" title="查看客户详情">${icon("eye")}</button></td></tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("users")}<strong>没有找到匹配客户</strong><span>请调整筛选条件</span></div></td></tr>`;
    $("#customerCards").innerHTML = filtered.length ? filtered.map(customerCard).join("") : `<div class="empty-state">${icon("users")}<strong>没有找到匹配客户</strong></div>`;
  }

  function orderCard(order) {
    return `<article class="mobile-data-card"><div class="mobile-card-head"><div><strong>${order.id}</strong><span>${order.time} · ${order.customer}（${order.phone}）</span></div><span class="tag ${statusClass(order.status)}">${order.status}</span></div><div class="mobile-card-body"><div><span>商品</span><strong>${order.product}</strong></div><div><span>实付金额</span><strong>${money(order.amount)}</strong></div><div><span>佣金</span><strong class="${order.commission < 0 ? "danger-text" : ""}">${money(order.commission)}</strong></div><div><span>佣金状态</span><strong>${order.commissionStatus}</strong></div></div><div class="mobile-card-action"><span>${order.aftersale === "无" ? "平台统一履约" : `售后：${order.aftersale}`}</span><button class="button secondary" type="button" data-order-detail="${order.id}">查看详情</button></div></article>`;
  }

  function renderOrders() {
    const keyword = $("#orderSearch").value.trim().toLowerCase();
    const status = $("#orderStatus").value;
    const filtered = orders.filter((order) => (!keyword || `${order.id}${order.customer}${order.product}`.toLowerCase().includes(keyword)) && (!status || order.status === status));
    $("#orderCount").textContent = `共 ${filtered.length} 笔归属订单`;
    $("#orderRows").innerHTML = filtered.length ? filtered.map((order) => { const product = productById(order.productId); return `<tr><td><button class="order-number" type="button" data-order-detail="${order.id}">${order.id}</button><span class="cell-sub">${order.time}</span></td><td><span class="cell-main">${order.customer}</span><span class="cell-sub">手机尾号 ${order.phone} · ${order.city}</span></td><td><div class="table-product"><img src="${product.image}" alt=""><div><strong>${order.product}</strong><span>共 ${order.count} 件</span></div></div></td><td><span class="cell-main">${money(order.amount)}</span></td><td><span class="tag ${statusClass(order.status)}">${order.status}</span></td><td><span class="cell-main ${order.commission < 0 ? "danger-text" : ""}">${money(order.commission)}</span><span class="cell-sub">${order.commissionStatus}</span></td><td>${order.time}</td><td><button class="icon-button" type="button" data-order-detail="${order.id}" title="查看订单详情">${icon("eye")}</button></td></tr>`; }).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("orders")}<strong>没有找到匹配订单</strong><span>请调整订单状态或搜索内容</span></div></td></tr>`;
    $("#orderCards").innerHTML = filtered.length ? filtered.map(orderCard).join("") : `<div class="empty-state">${icon("orders")}<strong>没有找到匹配订单</strong></div>`;
  }

  function renderDashboardOrders() {
    const data = orders.slice(0, 5);
    $("#dashboardOrderRows").innerHTML = data.map((order) => `<tr><td><button class="order-number" type="button" data-order-detail="${order.id}">${order.id}</button></td><td>${order.customer} · ${order.phone}</td><td>${order.product}</td><td><span class="cell-main">${money(order.amount)}</span></td><td><span class="tag ${statusClass(order.status)}">${order.status}</span></td><td><span class="cell-main ${order.commission < 0 ? "danger-text" : ""}">${money(order.commission)}</span></td><td><button class="icon-button" type="button" data-order-detail="${order.id}" title="查看订单详情">${icon("eye")}</button></td></tr>`).join("");
    $("#dashboardOrderCards").innerHTML = data.slice(0, 4).map(orderCard).join("");
  }

  function commissionCard(record) {
    return `<article class="mobile-data-card"><div class="mobile-card-head"><div><strong>${record.order}</strong><span>${record.time} · ${record.product}</span></div><span class="tag ${statusClass(record.type)}">${record.type === "入账" ? "可提现入账" : record.type === "预计" ? "预计佣金" : "退款冲减"}</span></div><div class="mobile-card-body"><div><span>商品净实付</span><strong>${money(record.base)}</strong></div><div><span>比例快照</span><strong>${record.rate}</strong></div><div><span>佣金变动</span><strong class="${record.amount < 0 ? "danger-text" : ""}">${money(record.amount)}</strong></div><div><span>余额影响</span><strong>${record.impact}</strong></div></div><div class="mobile-card-action"><span>订单与比例快照已冻结</span><button class="button secondary" type="button" data-commission-detail="${record.id}">查看详情</button></div></article>`;
  }

  function renderCommissions() {
    const keyword = $("#commissionSearch").value.trim().toLowerCase();
    const type = $("#commissionType").value;
    const filtered = commissions.filter((record) => (!keyword || `${record.order}${record.product}`.toLowerCase().includes(keyword)) && (!type || record.type === type));
    $("#commissionCount").textContent = `共 ${filtered.length} 笔佣金记录`;
    $("#commissionRows").innerHTML = filtered.length ? filtered.map((record) => `<tr><td>${record.time}</td><td><span class="tag ${statusClass(record.type)}">${record.type === "入账" ? "可提现入账" : record.type === "预计" ? "预计佣金" : "退款冲减"}</span></td><td><button class="order-number" type="button" data-order-detail="${record.order}">${record.order}</button><span class="cell-sub">${record.product}</span></td><td>${money(record.base)}</td><td>${record.rate}</td><td><span class="cell-main ${record.amount < 0 ? "danger-text" : "positive"}">${money(record.amount)}</span></td><td>${record.impact}</td><td><button class="icon-button" type="button" data-commission-detail="${record.id}" title="查看佣金详情">${icon("eye")}</button></td></tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("coins")}<strong>没有找到匹配记录</strong></div></td></tr>`;
    $("#commissionCards").innerHTML = filtered.length ? filtered.map(commissionCard).join("") : `<div class="empty-state">${icon("coins")}<strong>没有找到匹配记录</strong></div>`;
  }

  function withdrawalCard(record) {
    return `<article class="mobile-data-card"><div class="mobile-card-head"><div><strong>${record.id}</strong><span>${record.time}</span></div><span class="tag ${statusClass(record.status)}">${record.status}</span></div><div class="mobile-card-body"><div><span>提现金额</span><strong>${money(record.amount)}</strong></div><div><span>收款账户</span><strong>${record.bank}</strong></div></div><div class="mobile-card-action"><span>${record.completed}</span><button class="button secondary" type="button" data-withdrawal-detail="${record.id}">查看详情</button></div></article>`;
  }

  function renderWithdrawals() {
    $("#withdrawalRows").innerHTML = withdrawals.map((record) => `<tr><td><span class="cell-main">${record.id}</span></td><td>${record.time}</td><td><span class="cell-main">${money(record.amount)}</span></td><td>${record.bank}</td><td><span class="tag ${statusClass(record.status)}">${record.status}</span></td><td>${record.completed}</td><td><button class="icon-button" type="button" data-withdrawal-detail="${record.id}" title="查看提现详情">${icon("eye")}</button></td></tr>`).join("");
    $("#withdrawalCards").innerHTML = withdrawals.map(withdrawalCard).join("");
  }

  function showPage(page) {
    if (!pageTitles[page]) return;
    state.page = page;
    $$(".page-view").forEach((view) => view.classList.toggle("active", view.dataset.view === page));
    $$(".nav-item[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
    const mobilePage = page === "wallet" ? "commission" : page === "customers" ? "account" : page;
    $$(".mobile-nav [data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === mobilePage));
    $("#breadcrumbTitle").textContent = pageTitles[page];
    document.title = `${pageTitles[page]} · 青序伙伴`;
    $(".page-scroll").scrollTop = 0;
    document.body.classList.remove("sidebar-mobile-open");
    closeOverlays();
    try {
      const params = new URLSearchParams(window.location.search);
      params.set("view", page);
      if (!params.has("autologin") && !$("#appShell").hidden) params.set("autologin", "1");
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    } catch (error) { /* file protocol can restrict history in some browsers */ }
  }

  function showApp() {
    $("#loginView").hidden = true;
    $("#appShell").hidden = false;
    showPage(state.page);
    renderSalesBars();
  }

  function showLogin() {
    closeOverlays(true);
    $("#appShell").hidden = true;
    $("#loginView").hidden = false;
    document.title = "登录 · 青序伙伴";
  }

  function openOverlay(element) {
    $("#modalBackdrop").hidden = false;
    element.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      const focusable = element.querySelector("input:not([type='hidden']), button:not([disabled]), select");
      if (focusable) focusable.focus({ preventScroll: true });
    }, 20);
  }

  function closeOverlays(force) {
    if (state.forcePassword && !force) return;
    $$(".modal, .drawer").forEach((element) => { element.hidden = true; });
    $("#modalBackdrop").hidden = true;
    document.body.style.overflow = "";
  }

  function drawQr(seedText) {
    const canvas = $("#shareQr");
    const context = canvas.getContext("2d");
    const size = 29;
    const quiet = 3;
    const module = canvas.width / (size + quiet * 2);
    let seed = 2166136261;
    for (let index = 0; index < seedText.length; index += 1) seed = Math.imul(seed ^ seedText.charCodeAt(index), 16777619) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const matrix = Array.from({ length: size }, () => Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => Array(size).fill(false));
    function finder(row, column) {
      for (let y = -1; y <= 7; y += 1) for (let x = -1; x <= 7; x += 1) {
        const yy = row + y; const xx = column + x;
        if (yy < 0 || yy >= size || xx < 0 || xx >= size) continue;
        reserved[yy][xx] = true;
        matrix[yy][xx] = y >= 0 && y <= 6 && x >= 0 && x <= 6 && (y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4));
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) if (!reserved[row][column]) matrix[row][column] = random() > .51;
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#183b31";
    matrix.forEach((row, y) => row.forEach((value, x) => { if (value) context.fillRect((x + quiet) * module, (y + quiet) * module, Math.ceil(module), Math.ceil(module)); }));
  }

  function openShare(productId) {
    const isStore = productId === "all";
    const product = isStore ? null : productById(productId);
    state.activeProductId = product ? product.id : 1;
    $("#shareTitle").textContent = isStore ? "生成商城推广码" : "生成商品推广码";
    const link = isStore ? "https://shop.qingxu.cn/?agent=QY6088" : `https://shop.qingxu.cn/p/${product.id}?agent=QY6088`;
    $("#shareLink").textContent = link;
    const preview = $("#shareProduct");
    if (isStore) preview.innerHTML = `<img src="assets/hero-banner.png" alt="青序生活商城"><div><span>青序生活</span><strong>品质洗护 · 平台官方商城</strong><small>进入商城浏览全部授权商品</small></div>`;
    else preview.innerHTML = `<img src="${product.image}" alt="${safe(product.name)}"><div><span>${product.brand}</span><strong>${product.name}</strong><small>平台零售价 ${money(product.price)}</small></div>`;
    drawQr(link);
    openOverlay($("#shareModal"));
  }

  function openProductDetail(productId) {
    const product = productById(productId);
    $("#drawerKicker").textContent = "授权商品";
    $("#drawerTitle").textContent = "商品详情";
    $("#drawerBody").innerHTML = `<section class="drawer-section"><div class="drawer-product"><img src="${product.image}" alt="${safe(product.name)}"><div><strong>${product.name}</strong><span>${money(product.price)}</span><small>${product.brand} · ${product.category}</small></div></div></section>
      <section class="drawer-section"><h4>推广收益</h4><div class="drawer-stat-grid"><div><span>佣金比例</span><strong>8.00%</strong></div><div><span>单件预计佣金</span><strong>${money(product.commission)}</strong></div><div><span>平台销量</span><strong>${product.sales.toLocaleString("zh-CN")}</strong></div><div><span>可售状态</span><strong>${product.stock}</strong></div></div></section>
      <section class="drawer-section"><h4>平台服务</h4><dl class="detail-list"><div><dt>商品定价</dt><dd>平台统一管理</dd></div><div><dt>库存与发货</dt><dd>平台统一履约</dd></div><div><dt>售后处理</dt><dd>平台客服统一处理</dd></div><div><dt>归属规则</dt><dd>新客户首次确认后长期绑定</dd></div></dl></section>
      <button class="button primary full-width" type="button" data-share-product="${product.id}">${icon("share")}生成专属推广码</button>`;
    openOverlay($("#detailDrawer"));
  }

  function openCustomerDetail(customerId) {
    const customer = customers.find((item) => item.id === Number(customerId)) || customers[0];
    $("#drawerKicker").textContent = "绑定客户";
    $("#drawerTitle").textContent = `${customer.name} 的客户概览`;
    $("#drawerBody").innerHTML = `<section class="drawer-section"><div class="customer-cell"><span class="customer-avatar">${customer.avatar}</span><div><span class="cell-main">微信昵称 ${customer.name}</span><span class="cell-sub">手机尾号 ${customer.phone} · ${customer.city}</span></div></div></section>
      <section class="drawer-section"><h4>归属信息</h4><dl class="detail-list"><div><dt>归属代理</dt><dd>清源生活馆</dd></div><div><dt>绑定时间</dt><dd>${customer.bound}</dd></div><div><dt>绑定状态</dt><dd><span class="tag success">长期有效</span></dd></div><div><dt>信息范围</dt><dd>仅展示脱敏运营信息</dd></div></dl></section>
      <section class="drawer-section"><h4>消费概览</h4><div class="drawer-stat-grid"><div><span>归属消费</span><strong>${money(customer.spend)}</strong></div><div><span>消费次数</span><strong>${customer.orders} 次</strong></div><div><span>最近购买</span><strong>${customer.recent}</strong></div><div><span>最近时间</span><strong>${customer.recentTime}</strong></div></div></section>
      <section class="drawer-section"><div class="rule-callout">${icon("shield")}<span>为保护客户隐私，代理端不展示完整手机号、姓名或详细收货地址。</span></div></section>
      <button class="button secondary full-width" type="button" data-go="orders">${icon("orders")}查看该客户归属订单</button>`;
    openOverlay($("#detailDrawer"));
  }

  function orderTimeline(order) {
    if (order.status === "退款售后") return `<li><strong>订单支付成功</strong><span>${order.time} · 归属关系与比例已冻结</span></li><li><strong>客户发起售后</strong><span>08-10 09:06 · 平台客服已受理</span></li><li><strong>平台退款处理中</strong><span>预计 1-3 个工作日原路退回，佣金已同步冲减</span></li>`;
    const shipped = ["运输中", "已完成"].includes(order.status);
    const complete = order.status === "已完成";
    return `<li><strong>订单支付成功</strong><span>${order.time} · 归属关系与比例已冻结</span></li><li><strong>${shipped ? "平台已发货" : "等待平台发货"}</strong><span>${shipped ? "圆通速递 YT9068****1026" : "平台仓库正在备货"}</span></li>${shipped ? `<li><strong>${complete ? "客户已确认收货" : "商品运输中"}</strong><span>${complete ? "佣金已进入可提现余额" : "物流信息由平台持续同步"}</span></li>` : ""}`;
  }

  function openOrderDetail(orderId) {
    const order = orders.find((item) => item.id === orderId) || orders[0];
    const product = productById(order.productId);
    $("#drawerKicker").textContent = "归属订单";
    $("#drawerTitle").textContent = order.id;
    $("#drawerBody").innerHTML = `<section class="drawer-section"><div class="drawer-product"><img src="${product.image}" alt=""><div><strong>${order.product}</strong><span>${money(order.amount)}</span><small>共 ${order.count} 件 · 平台统一履约</small></div></div></section>
      <section class="drawer-section"><h4>订单信息</h4><dl class="detail-list"><div><dt>订单状态</dt><dd><span class="tag ${statusClass(order.status)}">${order.status}</span></dd></div><div><dt>客户</dt><dd>${order.customer} · 手机尾号 ${order.phone}</dd></div><div><dt>收货城市</dt><dd>${order.city}（详细地址不可见）</dd></div><div><dt>归属渠道</dt><dd>邀请码 QY6088</dd></div><div><dt>订单净实付</dt><dd>${money(order.amount)}</dd></div></dl></section>
      <section class="drawer-section"><h4>佣金快照</h4><div class="drawer-stat-grid"><div><span>比例快照</span><strong>8.00%</strong></div><div><span>佣金金额</span><strong class="${order.commission < 0 ? "danger-text" : ""}">${money(order.commission)}</strong></div><div><span>当前状态</span><strong>${order.commissionStatus}</strong></div><div><span>售后进度</span><strong>${order.aftersale}</strong></div></div></section>
      <section class="drawer-section"><h4>${order.status === "退款售后" ? "售后进度" : "履约进度"}</h4><ol class="timeline">${orderTimeline(order)}</ol></section>
      <div class="rule-callout">${icon("info")}<span>代理端仅供查询。发货、物流、退款和售后由平台统一处理。</span></div>`;
    openOverlay($("#detailDrawer"));
  }

  function openCommissionDetail(recordId) {
    const record = commissions.find((item) => item.id === Number(recordId)) || commissions[0];
    $("#drawerKicker").textContent = "佣金流水";
    $("#drawerTitle").textContent = record.type === "冲减" ? "退款佣金冲减" : record.type === "预计" ? "预计佣金详情" : "可提现佣金入账";
    $("#drawerBody").innerHTML = `<section class="drawer-section"><div class="drawer-stat-grid"><div><span>佣金变动</span><strong class="${record.amount < 0 ? "danger-text" : "positive"}">${money(record.amount)}</strong></div><div><span>余额影响</span><strong>${record.impact}</strong></div></div></section>
      <section class="drawer-section"><h4>计算快照</h4><dl class="detail-list"><div><dt>关联订单</dt><dd>${record.order}</dd></div><div><dt>商品</dt><dd>${record.product}</dd></div><div><dt>商品净实付</dt><dd>${money(record.base)}</dd></div><div><dt>佣金比例</dt><dd>${record.rate}</dd></div><div><dt>计算结果</dt><dd>${money(record.amount)}</dd></div><div><dt>发生时间</dt><dd>${record.time}</dd></div></dl></section>
      <section class="drawer-section"><h4>记录说明</h4><div class="rule-callout">${icon("shield")}<span>${record.type === "冲减" ? "客户退款后按退款商品净实付比例生成负向流水，原入账记录保留。" : record.type === "预计" ? "订单完成前为预计佣金，金额以支付时快照计算。" : "客户确认收货后，预计佣金已转入可提现余额。"}</span></div></section>
      <button class="button secondary full-width" type="button" data-order-detail="${record.order}">${icon("orders")}查看关联订单</button>`;
    openOverlay($("#detailDrawer"));
  }

  function openWithdrawalDetail(withdrawalId) {
    const record = withdrawals.find((item) => item.id === withdrawalId) || withdrawals[0];
    $("#drawerKicker").textContent = "提现记录";
    $("#drawerTitle").textContent = record.id;
    $("#drawerBody").innerHTML = `<section class="drawer-section"><div class="drawer-stat-grid"><div><span>提现金额</span><strong>${money(record.amount)}</strong></div><div><span>当前状态</span><strong>${record.status}</strong></div></div></section>
      <section class="drawer-section"><h4>提现信息</h4><dl class="detail-list"><div><dt>申请时间</dt><dd>${record.time}</dd></div><div><dt>收款账户</dt><dd>${record.bank}<br>周清源 · **** **** **** 6088</dd></div><div><dt>完成时间</dt><dd>${record.completed}</dd></div><div><dt>处理说明</dt><dd>${record.note}</dd></div></dl></section>
      <section class="drawer-section"><h4>${record.status === "已到账" ? "平台打款凭证" : "审核记录"}</h4>${record.status === "已到账" ? `<div class="bank-card"><span class="bank-icon">${icon("image")}</span><div><strong>线下转账凭证</strong><span>凭证编号 ${record.proof}</span></div><span class="tag success">已上传</span></div>` : `<div class="rule-callout">${icon("alert")}<span>${record.note}，请更新银行卡后重新提交。</span></div>`}</section>
      <ol class="timeline"><li><strong>提现申请已提交</strong><span>${record.time}</span></li><li><strong>${record.status === "已驳回" ? "平台审核未通过" : "平台审核通过"}</strong><span>${record.status === "已驳回" ? record.note : "财务已核对收款账户"}</span></li>${record.status === "已到账" ? `<li><strong>平台已线下转账</strong><span>${record.completed} · 打款凭证已上传</span></li>` : ""}</ol>`;
    openOverlay($("#detailDrawer"));
  }

  function copyText(text, message) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(() => {});
    else {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try { document.execCommand("copy"); } catch (error) { /* Prototype still exposes the selectable link. */ }
      input.remove();
    }
    showToast(message || "已复制");
  }

  function setupEvents() {
    $("#loginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const username = $("#username").value.trim();
      const password = $("#password").value.trim();
      if (!username || !password) { $("#loginError").hidden = false; return; }
      $("#loginError").hidden = true;
      const hasChangedPassword = sessionStorage.getItem("qingxuAgentPasswordSet") === "1";
      if (!hasChangedPassword) {
        state.forcePassword = true;
        $("#forcedPasswordNotice").hidden = false;
        $$(".password-close, .password-cancel").forEach((button) => { button.hidden = true; });
        openOverlay($("#passwordModal"));
        return;
      }
      sessionStorage.setItem("qingxuAgentLoggedIn", "1");
      showApp();
    });

    $("#togglePassword").addEventListener("click", () => {
      const input = $("#password");
      input.type = input.type === "password" ? "text" : "password";
      $("#togglePassword use").setAttribute("href", input.type === "password" ? "#i-eye" : "#i-eye-off");
    });

    $("#passwordForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const next = $("#newPassword").value;
      const confirm = $("#confirmPassword").value;
      if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next) || next !== confirm) { $("#passwordError").hidden = false; return; }
      $("#passwordError").hidden = true;
      const forced = state.forcePassword;
      state.forcePassword = false;
      sessionStorage.setItem("qingxuAgentPasswordSet", "1");
      sessionStorage.setItem("qingxuAgentLoggedIn", "1");
      closeOverlays(true);
      $("#forcedPasswordNotice").hidden = true;
      $$(".password-close, .password-cancel").forEach((button) => { button.hidden = false; });
      $("#passwordForm").reset();
      if (forced) showApp();
      showToast("登录密码已更新");
    });

    $("#withdrawForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = Number($("#withdrawAmount").value);
      if (!amount || amount < 100 || amount > 1826.4 || !$("#withdrawAgree").checked) { $("#withdrawError").hidden = false; return; }
      $("#withdrawError").hidden = true;
      withdrawals.unshift({ id: "WD202608100021", time: "2026-08-10 10:42", amount, bank: "招商银行 · 6088", status: "审核中", completed: "-", note: "等待平台超级管理员审核", proof: "-" });
      renderWithdrawals();
      closeOverlays(true);
      $("#withdrawForm").reset();
      showToast("提现申请已提交，等待平台审核");
    });

    $("#bankForm").addEventListener("submit", (event) => { event.preventDefault(); closeOverlays(true); showToast("银行卡信息已保存并加密存储"); });
    $("#withdrawAll").addEventListener("click", () => { $("#withdrawAmount").value = "1826.40"; });
    $$("[data-amount]").forEach((button) => button.addEventListener("click", () => { $("#withdrawAmount").value = button.dataset.amount; }));

    $("#globalSearchForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const keyword = $("#globalSearch").value.trim();
      if (!keyword) return showToast("请输入搜索内容");
      if (/QX|订单/i.test(keyword)) { showPage("orders"); $("#orderSearch").value = keyword; renderOrders(); }
      else { showPage("products"); $("#productSearch").value = keyword; renderProducts(); }
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#globalSearch").focus(); }
      if (event.key === "Escape") closeOverlays();
    });

    document.addEventListener("click", (event) => {
      const pageButton = event.target.closest("[data-page], [data-go]");
      if (pageButton) showPage(pageButton.dataset.page || pageButton.dataset.go);

      const toastButton = event.target.closest("[data-toast]");
      if (toastButton) showToast(toastButton.dataset.toast);

      const copyButton = event.target.closest("[data-copy]");
      if (copyButton) copyText(copyButton.dataset.copy, `邀请码 ${copyButton.dataset.copy} 已复制`);

      const shareButton = event.target.closest("[data-open-share], [data-share-product]");
      if (shareButton) { closeOverlays(true); openShare(shareButton.dataset.openShare || shareButton.dataset.shareProduct); }

      const productDetail = event.target.closest("[data-product-detail]");
      if (productDetail) openProductDetail(productDetail.dataset.productDetail);

      const customerDetail = event.target.closest("[data-customer-detail]");
      if (customerDetail) openCustomerDetail(customerDetail.dataset.customerDetail);

      const orderDetail = event.target.closest("[data-order-detail]");
      if (orderDetail) openOrderDetail(orderDetail.dataset.orderDetail);

      const commissionDetail = event.target.closest("[data-commission-detail]");
      if (commissionDetail) openCommissionDetail(commissionDetail.dataset.commissionDetail);

      const withdrawalDetail = event.target.closest("[data-withdrawal-detail]");
      if (withdrawalDetail) openWithdrawalDetail(withdrawalDetail.dataset.withdrawalDetail);

      if (event.target.closest("[data-withdraw]")) openOverlay($("#withdrawModal"));
      if (event.target.closest("[data-bank]")) { closeOverlays(true); openOverlay($("#bankModal")); }
      if (event.target.closest("[data-password]")) { $("#currentPassword").value = ""; openOverlay($("#passwordModal")); }

      const rangeButton = event.target.closest("[data-range]");
      if (rangeButton) { state.chartRange = Number(rangeButton.dataset.range); $$("[data-range]").forEach((button) => button.classList.toggle("active", button === rangeButton)); renderSalesBars(); }

      const orderTab = event.target.closest("[data-order-tab]");
      if (orderTab) { $$("[data-order-tab]").forEach((button) => button.classList.toggle("active", button === orderTab)); $("#orderStatus").value = orderTab.dataset.orderTab; renderOrders(); }

      if (event.target.closest(".close-overlay")) closeOverlays();
    });

    $("#copyShareLink").addEventListener("click", () => copyText($("#shareLink").textContent, "推广链接已复制"));
    $("#copyShare").addEventListener("click", () => copyText($("#shareLink").textContent, "推广链接已复制，可发送给客户"));
    $("#downloadShare").addEventListener("click", () => showToast("推广图已保存到演示下载队列"));
    $("#modalBackdrop").addEventListener("click", () => closeOverlays());

    $("#sidebarToggle").addEventListener("click", () => {
      if (window.innerWidth <= 760) document.body.classList.toggle("sidebar-mobile-open");
      else document.body.classList.toggle("sidebar-collapsed");
    });

    $("#toggleBalance").addEventListener("click", () => {
      state.balanceVisible = !state.balanceVisible;
      $("#walletBalance").textContent = state.balanceVisible ? "¥ 1,826.40" : "¥ ••••••";
      $("#toggleBalance use").setAttribute("href", state.balanceVisible ? "#i-eye" : "#i-eye-off");
    });

    function logout() {
      sessionStorage.removeItem("qingxuAgentLoggedIn");
      showLogin();
      showToast("已安全退出代理工作台");
    }
    $("#logoutButton").addEventListener("click", logout);
    $("#accountLogout").addEventListener("click", logout);

    $("#productSearch").addEventListener("input", renderProducts);
    $("#productCategory").addEventListener("change", renderProducts);
    $("#productSort").addEventListener("change", renderProducts);
    $("#customerSearch").addEventListener("input", renderCustomers);
    $("#customerStatus").addEventListener("change", renderCustomers);
    $("#orderSearch").addEventListener("input", renderOrders);
    $("#orderStatus").addEventListener("change", () => { $$("[data-order-tab]").forEach((button) => button.classList.toggle("active", button.dataset.orderTab === $("#orderStatus").value)); renderOrders(); });
    $("#commissionSearch").addEventListener("input", renderCommissions);
    $("#commissionType").addEventListener("change", renderCommissions);
    window.addEventListener("resize", () => { if (window.innerWidth > 760) document.body.classList.remove("sidebar-mobile-open"); });
  }

  function init() {
    const params = new URLSearchParams(window.location.search);
    const requestedPage = params.get("view");
    if (pageTitles[requestedPage]) state.page = requestedPage;
    renderProducts();
    renderCustomers();
    renderOrders();
    renderDashboardOrders();
    renderCommissions();
    renderWithdrawals();
    renderSalesBars();
    setupEvents();
    if (params.get("autologin") === "1" || sessionStorage.getItem("qingxuAgentLoggedIn") === "1") showApp();
    else showLogin();
  }

  init();
})();
