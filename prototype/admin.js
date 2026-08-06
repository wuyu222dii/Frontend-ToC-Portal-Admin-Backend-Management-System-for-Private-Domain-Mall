(function () {
  "use strict";

  const pageTitles = {
    dashboard: "数据看板",
    products: "商品管理",
    "product-edit": "商品编辑",
    orders: "订单管理",
    "order-detail": "订单详情",
    aftersales: "售后审核",
    customers: "客户管理"
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
    { id: 1, name: "林晓月", nickname: "Moon", phone: "138****6821", spend: 3286, orders: 18, recent: "氨基酸洁面乳", recentDate: "今天 09:18", joined: "2025-11-18", avatar: "林" },
    { id: 2, name: "周敏", nickname: "Mina", phone: "186****3096", spend: 1688, orders: 9, recent: "无硅油洗发水", recentDate: "今天 09:02", joined: "2026-01-08", avatar: "周" },
    { id: 3, name: "陈嘉禾", nickname: "嘉禾", phone: "159****2218", spend: 892, orders: 6, recent: "浓缩洗衣凝珠", recentDate: "今天 08:46", joined: "2026-03-22", avatar: "陈" },
    { id: 4, name: "赵倩", nickname: "Zoe", phone: "133****5107", spend: 4290, orders: 26, recent: "积雪草修护霜", recentDate: "今天 08:25", joined: "2025-08-16", avatar: "赵" },
    { id: 5, name: "王悦", nickname: "悦悦", phone: "137****8432", spend: 2386, orders: 13, recent: "白茶香氛沐浴露", recentDate: "今天 08:12", joined: "2025-12-09", avatar: "王" },
    { id: 6, name: "刘雨晴", nickname: "Yuki", phone: "188****0076", spend: 658, orders: 4, recent: "烟酰胺焕亮精华", recentDate: "今天 07:58", joined: "2026-05-19", avatar: "刘" },
    { id: 7, name: "孙可心", nickname: "Kira", phone: "180****4175", spend: 1928, orders: 11, recent: "轻透倍护防晒乳", recentDate: "今天 07:16", joined: "2026-02-14", avatar: "孙" }
  ];

  const state = {
    page: "dashboard",
    chartRange: 7,
    activeProductId: null,
    activeAftersaleId: null,
    activeOrderId: "QY202608060028"
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
      "草稿": "neutral"
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
    $("#rankingList").innerHTML = products.slice().sort((a, b) => b.sales - a.sales).slice(0, 5).map((product, index) => `<div class="ranking-item"><span class="ranking-number">${index + 1}</span>${renderProductArt(product.art, product.brand)}<div class="ranking-copy"><strong title="${product.name}">${product.name}</strong><span>${product.category} · 库存 ${product.stock}</span></div><strong>${product.sales.toLocaleString("zh-CN")} 件</strong></div>`).join("");
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
    $("#modalBackdrop").hidden = true;
    $$(".modal, .drawer").forEach((item) => { item.hidden = true; });
    $("#notificationPanel").hidden = true;
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
    const aov = Math.round(customer.spend / customer.orders);
    $("#drawerAvatar").textContent = customer.avatar;
    $("#customerDrawerTitle").textContent = customer.name;
    $("#drawerPhone").textContent = customer.phone;
    $("#drawerSpend").textContent = `¥${customer.spend.toLocaleString("zh-CN")}`;
    $("#drawerOrders").textContent = customer.orders;
    $("#drawerAov").textContent = `¥${aov}`;
    $("#drawerRecent").textContent = customer.recent;
    closeOverlays();
    $("#modalBackdrop").hidden = false;
    $("#customerDrawer").hidden = false;
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

    $("#productReset").addEventListener("click", () => {
      $("#productSearch").value = ""; $("#productCategory").value = ""; $("#productBrand").value = ""; $("#productStatus").value = ""; renderProducts();
    });
    $("#orderReset").addEventListener("click", () => { $("#orderSearch").value = ""; $("#orderStatus").value = ""; renderOrders(); });
    $("#aftersaleReset").addEventListener("click", () => { $("#aftersaleSearch").value = ""; $("#aftersaleType").value = ""; $("#aftersaleStatus").value = ""; renderAftersales(); });
    $("#customerReset").addEventListener("click", () => { $("#customerSearch").value = ""; renderCustomers(); });

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
    renderAftersales();
    renderCustomers();
    setupEvents();
    if (prototypeParams.get("autologin") === "1" || sessionStorage.getItem("qingyuAdminLoggedIn") === "1") showApp();
    else showLogin();
  }

  init();
})();
