(() => {
  "use strict";

  const products = [
    {
      id: "serum",
      brand: "LUMIÈRE LAB",
      name: "山茶花焕亮修护精华液",
      subtitle: "舒缓干燥泛红，重现细腻透亮肤感",
      price: 168,
      sales: 1268,
      badge: "热销 TOP 1",
      image: "./assets/product-1.png",
      label: "LUMIÈRE",
      pack: "",
      sku: "30ml / 单瓶",
      category: "护肤品"
    },
    {
      id: "shampoo",
      brand: "MORI NATURE",
      name: "氨基酸蓬松净澈洗发水",
      subtitle: "温和净澈头皮，发根轻盈蓬松",
      price: 89,
      sales: 856,
      badge: "口碑推荐",
      image: "./assets/product-2.png",
      label: "MORI",
      pack: "is-pump",
      sku: "500ml / 清新木质香",
      category: "洗发水"
    },
    {
      id: "cleanser",
      brand: "ÉLAN PURE",
      name: "净润氨基酸洁面乳",
      subtitle: "绵密泡沫，洗后清透不紧绷",
      price: 59,
      sales: 642,
      badge: "新品",
      image: "./assets/product-4.png",
      label: "ÉLAN",
      pack: "is-tube",
      sku: "120g / 单支",
      category: "护肤品"
    },
    {
      id: "bodywash",
      brand: "JARDIN 27",
      name: "白茶香氛润肤沐浴露",
      subtitle: "清雅白茶香，洗后柔润留香",
      price: 79,
      sales: 521,
      badge: "香氛系列",
      image: "./assets/product-3.png",
      label: "JARDIN",
      pack: "is-pump",
      sku: "480ml / 白茶香",
      category: "沐浴露"
    },
    {
      id: "sunscreen",
      brand: "ÉLAN PURE",
      name: "轻透防晒乳 SPF50+",
      subtitle: "轻薄成膜，通勤防护不泛白",
      price: 98,
      sales: 744,
      badge: "夏日必备",
      image: "./assets/product-7.png",
      label: "ÉLAN SPF",
      pack: "is-tube",
      sku: "50ml / 单支",
      category: "防晒产品"
    },
    {
      id: "laundry",
      brand: "NEST HOME",
      name: "低敏植萃洗衣凝珠",
      subtitle: "去渍护色，清新留香不刺鼻",
      price: 49,
      sales: 1012,
      badge: "家庭常备",
      image: "./assets/product-8.png",
      label: "NEST",
      pack: "",
      sku: "30颗 / 清新香",
      category: "家庭清洁"
    }
  ];

  const categories = [
    ["护肤品", "✦"],
    ["洗发水", "♨"],
    ["沐浴露", "♧"],
    ["防晒产品", "☀"],
    ["香水", "♢"],
    ["彩妆", "✺"],
    ["男士护理", "◆"],
    ["家庭清洁", "⌂"]
  ];

  const inviteAgents = {
    "QX-A1038": { id: "AGT-01038", name: "清源生活馆", contact: "顾问 安然", phone: "138****3916", city: "广东·深圳", inviteCode: "QX-A1038", boundAt: "2026-07-18 14:26" },
    "QX-A1026": { id: "AGT-01026", name: "清悦日用馆", contact: "顾问 陈悦", phone: "186****2077", city: "广东·珠海", inviteCode: "QX-A1026", boundAt: "" }
  };

  const screenMeta = {
    home: {
      canvasTitle: "首页 · 发现日常之美",
      title: "首页",
      description: "品牌心智、快捷分类与推荐商品在首屏完成呈现。",
      interactions: ["搜索入口进入搜索结果", "分类入口联动分类页", "商品卡片进入商品详情"]
    },
    category: {
      canvasTitle: "分类 · 双栏快速选购",
      title: "分类选购",
      description: "一级分类固定在左侧，商品与场景筛选保持在单一浏览上下文。",
      interactions: ["切换八个一级分类", "场景筛选即时反馈", "商品卡片进入详情"]
    },
    search: {
      canvasTitle: "搜索 · 品牌与商品检索",
      title: "搜索结果",
      description: "支持商品名、品牌和分类关键词，并提供历史词与无结果状态。",
      interactions: ["输入或点选热门关键词", "综合/销量/价格排序", "结果卡进入详情"]
    },
    product: {
      canvasTitle: "商品详情 · SKU 决策",
      title: "商品详情",
      description: "价格、规格、成分和用法集中表达，底部双主路径减少决策成本。",
      interactions: ["收藏状态即时反馈", "详情 Tab 切换", "加入购物车/立即购买弹出 SKU"]
    },
    cart: {
      canvasTitle: "购物车 · 批量结算",
      title: "购物车",
      description: "商品选择、数量与价格在同一卡片内操作，结算金额持续可见。",
      interactions: ["单选与全选商品", "数量增减与库存校验", "选中商品进入确认订单"]
    },
    checkout: {
      canvasTitle: "确认订单 · 支付前复核",
      title: "确认订单",
      description: "地址、配送、商品与金额按风险优先级排列，提交后进入模拟微信支付。",
      interactions: ["核对地址和配送方式", "填写订单备注", "提交订单并模拟支付"]
    },
    orders: {
      canvasTitle: "订单 · 全状态管理",
      title: "我的订单",
      description: "按订单状态快速筛选，卡片操作随状态变化，覆盖付款、物流与售后。",
      interactions: ["五种订单状态筛选", "待收货订单确认收货", "已完成订单申请售后"]
    },
    aftersale: {
      canvasTitle: "售后 · 退款申请",
      title: "退款售后",
      description: "首期聚焦整单单品退款，清晰展示可退金额、原因与凭证入口。",
      interactions: ["选择售后类型和原因", "填写问题说明/上传凭证", "提交后展示受理结果"]
    },
    profile: {
      canvasTitle: "我的 · 客户资产中心",
      title: "个人中心",
      description: "订单状态为第一层入口，地址、收藏、客服等高频服务集中管理。",
      interactions: ["订单捷径带状态计数", "服务代理归属清晰可见", "地址、收藏与客服快捷入口"]
    },
    "service-agent": {
      canvasTitle: "服务代理 · 归属与服务说明",
      title: "服务代理",
      description: "用户可以查看当前服务代理及绑定时间，价格、发货和售后仍由平台统一保障。",
      interactions: ["有效邀请链路登录后显式确认", "绑定后不提供自助更换", "异常归属通过平台客服处理"]
    }
  };

  const state = {
    screen: "home",
    history: [],
    device: 375,
    selectedCategory: "护肤品",
    filter: "全部",
    searchQuery: "",
    searchPerformed: false,
    searchSort: "综合",
    product: products[0],
    detailTab: "亮点",
    favorite: false,
    sku: "30ml 单瓶",
    quantity: 1,
    skuIntent: "cart",
    agentBindingStatus: "bound",
    serviceAgent: { ...inviteAgents["QX-A1038"] },
    cart: [
      { product: products[0], quantity: 1, selected: true },
      { product: products[3], quantity: 2, selected: true }
    ],
    orderTab: "全部",
    afterSaleSubmitted: false,
    orders: [
      { id: "QX202608060021", status: "待发货", product: products[0], quantity: 1, total: 168 },
      { id: "QX202608030118", status: "运输中", product: products[1], quantity: 1, total: 89 },
      { id: "QX202607280076", status: "已完成", product: products[3], quantity: 2, total: 158 }
    ]
  };

  const app = document.querySelector("#app");
  const bottomSheet = document.querySelector("#bottomSheet");
  const sheetBackdrop = document.querySelector("#sheetBackdrop");
  const toast = document.querySelector("#toast");
  let toastTimer;

  const money = value => `¥${Number(value).toFixed(value % 1 ? 2 : 0)}`;

  function statusBar(inverse = false) {
    return `
      <div class="wechat-status${inverse ? " is-inverse" : ""}">
        <span>9:41</span>
        <div class="wechat-status__icons" aria-hidden="true">
          <span class="signal-bars"><i></i><i></i><i></i></span>
          <span>⌁</span><span>▰</span>
        </div>
      </div>`;
  }

  function header(title, options = {}) {
    const { back = true, action = "", bordered = true } = options;
    return `
      <div class="mini-header${bordered ? " is-bordered" : ""}">
        <div class="mini-header__side">${back ? '<button class="icon-button" data-action="back" aria-label="返回">‹</button>' : ""}</div>
        <h2>${title}</h2>
        <div class="mini-header__side">${action}</div>
      </div>`;
  }

  function imageMedia(product, className = "product-card__media") {
    return `
      <div class="${className}">
        <div class="fallback-pack ${product.pack}" data-label="${product.label}"></div>
        <img src="${product.image}" alt="${product.name}" onerror="this.hidden=true" />
      </div>`;
  }

  function productCard(product) {
    return `
      <button class="product-card" data-open-product="${product.id}">
        <div class="product-card__media">
          <span class="product-badge">${product.badge}</span>
          <div class="fallback-pack ${product.pack}" data-label="${product.label}"></div>
          <img src="${product.image}" alt="${product.name}" onerror="this.hidden=true" />
        </div>
        <div class="product-card__body">
          <span class="product-brand">${product.brand}</span>
          <div class="product-name">${product.name}</div>
          <div class="price-row">
            <span class="price"><small>¥</small>${product.price}</span>
            <span class="sales-note">已售${product.sales}</span>
          </div>
        </div>
      </button>`;
  }

  function tabbar(active) {
    return `
      <nav class="tabbar" aria-label="小程序主导航">
        <button class="${active === "home" ? "is-active" : ""}" data-screen="home"><i>⌂</i><span>首页</span></button>
        <button class="${active === "category" ? "is-active" : ""}" data-screen="category"><i>▦</i><span>分类</span></button>
        <button class="${active === "cart" ? "is-active" : ""}" data-screen="cart"><i>□</i><span>购物车</span></button>
        <button class="${active === "profile" ? "is-active" : ""}" data-screen="profile"><i>○</i><span>我的</span></button>
      </nav>`;
  }

  function renderHome() {
    return `
      <section class="app-screen with-tabbar home-page">
        <div class="screen-scroll">
          <div class="home-top">
            ${statusBar()}
            <div class="mini-header">
              <div class="mini-header__side"><strong class="app-brand">青序</strong></div>
              <div class="mini-header__side"><button class="icon-button" data-screen="profile" aria-label="消息">◦</button></div>
            </div>
            <button class="search-trigger" data-screen="search"><span>⌕</span><span>搜索商品 / 品牌 / 分类</span></button>
          </div>

          <article class="hero-card">
            <div class="hero-copy">
              <span class="hero-kicker">BOTANICAL DAILY</span>
              <h3>把自然，<br />带回日常</h3>
              <p>甄选温和洗护配方<br />轻盈配方与安心选材</p>
              <button data-screen="category">探索植萃洗护</button>
            </div>
            <div class="hero-art">
              <div class="hero-bottle"></div>
              <img class="hero-image" src="./assets/hero-banner.png" alt="植萃洗护与家庭清洁系列" onerror="this.hidden=true" />
            </div>
          </article>

          <section class="section-block">
            <div class="section-heading"><div><h3>按需选购</h3><p>从每一种生活场景出发</p></div><button data-screen="category">全部分类 ›</button></div>
            <div class="category-grid">
              ${categories.map(([name, icon]) => `<button class="category-tile" data-category="${name}"><span class="category-icon">${icon}</span><span>${name}</span></button>`).join("")}
            </div>
          </section>

          <section class="section-block">
            <div class="section-heading"><div><h3>本周热销</h3><p>大家正在回购的安心好物</p></div><button data-category="护肤品">查看更多 ›</button></div>
            <div class="product-grid">${products.slice(0, 4).map(productCard).join("")}</div>
          </section>

          <section class="section-block" style="padding-bottom:22px">
            <div class="section-heading"><div><h3>新品上架</h3><p>为日常带来一点新鲜感</p></div></div>
            <div class="product-grid">${products.slice(4).map(productCard).join("")}</div>
          </section>
        </div>
        ${tabbar("home")}
      </section>`;
  }

  function renderCategory() {
    const categoryProducts = products.filter(product => product.category === state.selectedCategory);
    const displayProducts = categoryProducts.length ? categoryProducts : products.slice(0, 4);
    const posterCopy = {
      "护肤品": "以温和配方回应肌肤每日所需",
      "洗发水": "从头皮开始，找回轻盈发感",
      "沐浴露": "让沐浴成为一天的松弛时刻",
      "防晒产品": "轻薄防护，从容面对每束阳光",
      "香水": "用气味记录属于你的生活片段",
      "彩妆": "自然显色，让真实轮廓更动人",
      "男士护理": "高效、简单、恰到好处的护理",
      "家庭清洁": "洁净有度，守护家的安心气息"
    };
    return `
      <section class="app-screen with-tabbar category-page">
        ${statusBar()}
        <div class="mini-header"><div class="mini-header__side"><strong>分类</strong></div><div class="mini-header__side"></div></div>
        <div style="padding:0 12px 10px"><button class="search-trigger" data-screen="search"><span>⌕</span><span>搜索品牌或商品</span></button></div>
        <div class="category-layout">
          <nav class="category-rail">
            ${categories.map(([name]) => `<button class="${name === state.selectedCategory ? "is-active" : ""}" data-category-switch="${name}">${name}</button>`).join("")}
          </nav>
          <div class="category-content">
            <article class="category-poster"><h3>${state.selectedCategory}</h3><p>${posterCopy[state.selectedCategory]}</p><i class="poster-leaf"></i></article>
            <div class="filter-row">
              ${["全部", "热销", "新品", "价格"].map(item => `<button class="filter-chip ${state.filter === item ? "is-active" : ""}" data-filter="${item}">${item}</button>`).join("")}
            </div>
            <div class="product-grid compact-grid">${displayProducts.map(productCard).join("")}</div>
          </div>
        </div>
        ${tabbar("category")}
      </section>`;
  }

  function searchMatches() {
    const query = state.searchQuery.trim().toLowerCase();
    if (!query) return products;
    return products.filter(product => [product.name, product.brand, product.category, product.subtitle].join(" ").toLowerCase().includes(query));
  }

  function renderSearch() {
    let matches = searchMatches();
    if (state.searchSort === "销量") matches = [...matches].sort((a, b) => b.sales - a.sales);
    if (state.searchSort === "价格") matches = [...matches].sort((a, b) => a.price - b.price);
    const historyView = `
      <div class="search-history">
        <div class="history-head"><strong>最近搜索</strong><button data-action="clear-search-history" aria-label="清空历史">♲</button></div>
        <div class="keyword-wrap">
          ${["氨基酸", "LUMIÈRE LAB", "防晒", "家庭清洁", "白茶香"].map(keyword => `<button data-keyword="${keyword}">${keyword}</button>`).join("")}
        </div>
      </div>`;
    const resultView = matches.length ? `
      <div class="result-summary"><span>找到 <strong>${matches.length}</strong> 件相关商品</span><div class="sort-control">${["综合", "销量", "价格"].map(item => `<button class="${state.searchSort === item ? "is-active" : ""}" data-sort="${item}">${item}</button>`).join("")}</div></div>
      <div class="search-results">
        ${matches.map(product => `
          <button class="search-result" data-open-product="${product.id}">
            ${imageMedia(product, "result-thumb")}
            <div class="result-info"><span class="product-brand">${product.brand}</span><h3>${product.name}</h3><p>${product.subtitle}</p><div class="price-row"><span class="price"><small>¥</small>${product.price}</span><span class="sales-note">已售${product.sales}</span></div></div>
          </button>`).join("")}
      </div>` : `<div class="empty-state"><i>⌕</i><strong>没有找到相关商品</strong><p>换个关键词试试，或浏览我们的热销分类</p><button class="secondary-button" data-screen="category" style="padding:0 18px">去分类看看</button></div>`;
    return `
      <section class="app-screen search-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("搜索", { bordered: false })}
          <form class="search-bar-wrap" id="searchForm">
            <label class="search-field"><span>⌕</span><input id="searchInput" value="${state.searchQuery}" autocomplete="off" placeholder="搜索商品 / 品牌 / 分类" /><button type="button" data-action="clear-search">×</button></label>
            <button class="search-submit" type="submit">搜索</button>
          </form>
          ${state.searchPerformed ? resultView : historyView}
        </div>
      </section>`;
  }

  function renderProduct() {
    const product = state.product;
    const detailCopy = {
      "亮点": `<h3>温和修护，透亮有光</h3><p>精选山茶花籽油与泛醇复配，帮助改善干燥粗糙。清透水感质地，快速吸收，不黏腻。</p><div class="ingredient-list"><div><strong>山茶花籽油</strong><span>柔润修护</span></div><div><strong>5% 泛醇</strong><span>舒缓保湿</span></div><div><strong>角鲨烷</strong><span>强化屏障</span></div></div>`,
      "成分": `<h3>配方公开透明</h3><p>水、甘油、丁二醇、泛醇、角鲨烷、山茶籽油、透明质酸钠、1,2-己二醇、精氨酸等。</p><p>不添加酒精、矿物油与人工色素。敏感肌建议先在耳后进行局部测试。</p>`,
      "使用方法": `<h3>每日两次，轻柔按压</h3><p>洁面并使用化妆水后，取 2–3 滴精华均匀涂抹于面部与颈部，用掌心轻压至吸收，再叠加乳霜。</p><p>白天使用时，请在护肤最后一步叠加防晒产品。</p>`
    };
    return `
      <section class="app-screen with-buybar product-page">
        <div class="screen-scroll">
          <div class="product-gallery">
            ${statusBar()}
            <div class="floating-header"><button class="icon-button is-soft" data-action="back" aria-label="返回">‹</button><div><button class="icon-button is-soft" data-action="share" aria-label="分享">↗</button><button class="icon-button is-soft" data-action="favorite" aria-label="收藏">${state.favorite ? "♥" : "♡"}</button></div></div>
            ${imageMedia(product, "product-hero-media")}
            <div class="gallery-dots"><i></i><i></i><i></i></div>
          </div>

          <div class="product-summary">
            <div class="price-row"><span class="price-label">零售价</span><span class="price"><small>¥</small>${product.price}</span></div>
            <h1>${product.name}</h1>
            <p>${product.subtitle}。严选原料与温和配方，让护理回归简单有效。</p>
            <div class="summary-meta"><span>${product.brand}</span><span>库存 286</span><span>已售 ${product.sales}</span></div>
          </div>

          <div class="info-list">
            <button class="info-row" data-action="open-sku"><span>规格</span><strong>${state.sku}</strong><span>›</span></button>
            <button class="info-row" data-action="service"><span>服务</span><strong>正品保障 · 48小时发货 · 全场包邮</strong><span>›</span></button>
          </div>

          <section class="detail-section">
            <div class="detail-tabs">${["亮点", "成分", "使用方法"].map(item => `<button class="${state.detailTab === item ? "is-active" : ""}" data-detail-tab="${item}">${item}</button>`).join("")}</div>
            <div class="detail-content">${detailCopy[state.detailTab]}</div>
          </section>
        </div>
        <div class="buybar">
          <button class="mini-action" data-action="service"><i>◉</i><span>客服</span></button>
          <button class="mini-action" data-screen="cart"><i>□</i><span>购物车</span></button>
          <button class="secondary-button" data-sku-intent="cart">加入购物车</button>
          <button class="primary-button is-coral" data-sku-intent="buy">立即购买</button>
        </div>
      </section>`;
  }

  function cartTotal() {
    return state.cart.filter(item => item.selected).reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }

  function renderCart() {
    const selectedCount = state.cart.filter(item => item.selected).length;
    const allSelected = state.cart.length && selectedCount === state.cart.length;
    return `
      <section class="app-screen with-tabbar cart-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("购物车", { back: false, action: '<button class="text-button" data-action="manage-cart">管理</button>' })}
          ${state.cart.length ? `
            <div class="cart-list">
              <div class="cart-group-label"><span>青序自营</span><span>·</span><span>全场包邮</span></div>
              ${state.cart.map((item, index) => `
                <article class="cart-card">
                  <button class="check-control ${item.selected ? "is-checked" : ""}" data-cart-select="${index}" aria-label="选择商品">✓</button>
                  ${imageMedia(item.product, "cart-thumb")}
                  <div class="cart-info"><h3>${item.product.name}</h3><span class="sku-label">${item.product.sku} ▾</span><div class="cart-card__footer"><span class="price"><small>¥</small>${item.product.price}</span><div class="quantity-stepper"><button data-cart-qty="${index}" data-delta="-1">−</button><span>${item.quantity}</span><button data-cart-qty="${index}" data-delta="1">＋</button></div></div></div>
                </article>`).join("")}
            </div>
            <section class="cart-recommend"><div class="section-heading"><div><h3>你可能还喜欢</h3></div></div><div class="product-grid">${products.slice(2, 4).map(productCard).join("")}</div></section>
          ` : `<div class="empty-state"><i>□</i><strong>购物车还是空的</strong><p>去挑选一些日常好物吧</p><button class="primary-button" data-screen="home" style="padding:0 22px">去逛逛</button></div>`}
        </div>
        ${state.cart.length ? `<div class="cart-summary"><button class="select-all" data-action="select-all"><span class="check-control ${allSelected ? "is-checked" : ""}">✓</span><span>全选</span></button><div class="summary-price"><span>合计：<strong>${money(cartTotal())}</strong></span><small>不含运费</small></div><button class="primary-button is-coral" data-action="checkout" ${selectedCount ? "" : "disabled"}>去结算 (${selectedCount})</button></div>` : ""}
        ${tabbar("cart")}
      </section>`;
  }

  function renderCheckout() {
    const selected = state.cart.filter(item => item.selected);
    const items = selected.length ? selected : [{ product: state.product, quantity: state.quantity }];
    const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    return `
      <section class="app-screen checkout-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("确认订单")}
          <div class="checkout-content">
            <button class="address-card" data-action="address"><span class="address-icon">⌖</span><span class="address-main"><strong>林青 <span>138 **** 5218</span></strong><p>浙江省杭州市西湖区文三路 88 号 2 幢 1102 室</p></span><span>›</span></button>
            <section class="checkout-card"><div class="merchant-name">青序自营 · 正品保障</div>
              ${items.map(item => `<div class="checkout-product">${imageMedia(item.product, "checkout-thumb")}<div class="checkout-info"><h3>${item.product.name}</h3><p>${item.product.sku}</p></div><div class="checkout-price"><strong>${money(item.product.price)}</strong><span>×${item.quantity}</span></div></div>`).join("")}
              <div class="checkout-options"><div class="checkout-row"><span>配送方式</span><span>快递配送 · 包邮 ›</span></div><label class="checkout-row"><span>订单备注</span><input placeholder="选填，请先与商家协商" /></label></div>
            </section>
            <section class="amount-card"><div class="amount-row"><span>商品金额</span><span>${money(total)}</span></div><div class="amount-row"><span>运费</span><span>¥0</span></div><div class="amount-row total"><span>应付合计</span><strong>${money(total)}</strong></div></section>
          </div>
        </div>
        <div class="checkout-bar"><div class="checkout-total">共 ${items.reduce((sum, item) => sum + item.quantity, 0)} 件，合计 <strong>${money(total)}</strong></div><button class="primary-button is-coral" data-action="submit-order" data-total="${total}">提交订单</button></div>
      </section>`;
  }

  function statusClass(status) {
    if (status === "运输中") return "is-blue";
    if (status === "已完成") return "is-green";
    return "";
  }

  function renderOrderCard(order) {
    const actions = {
      "待付款": `<button>取消订单</button><button class="is-primary" data-action="pay-order">立即付款</button>`,
      "待发货": `<button data-action="remind">提醒发货</button>`,
      "运输中": `<button data-action="logistics">查看物流</button><button class="is-primary" data-confirm-order="${order.id}">确认收货</button>`,
      "已完成": `<button data-screen="aftersale">申请售后</button><button class="is-primary" data-open-product="${order.product.id}">再次购买</button>`,
      "退款售后": `<button data-screen="aftersale">查看进度</button>`
    };
    return `
      <article class="order-card">
        <div class="order-card__head"><strong>订单 ${order.id}</strong><span class="order-status ${statusClass(order.status)}">${order.status}</span></div>
        <div class="order-product">${imageMedia(order.product, "order-thumb")}<div class="order-info"><h3>${order.product.name}</h3><p>${order.product.sku}</p></div><div class="order-unit"><strong>${money(order.product.price)}</strong><span>×${order.quantity}</span></div></div>
        <div class="order-total">共 ${order.quantity} 件，实付款 <strong>${money(order.total)}</strong></div>
        <div class="order-actions">${actions[order.status] || ""}</div>
      </article>`;
  }

  function renderOrders() {
    const tabMap = { "全部": null, "待付款": "待付款", "待发货": "待发货", "待收货": "运输中", "退款/售后": "退款售后" };
    const visibleOrders = state.orderTab === "全部" ? state.orders : state.orders.filter(order => order.status === tabMap[state.orderTab]);
    return `
      <section class="app-screen with-tabbar orders-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("我的订单")}
          <nav class="orders-tabs">${Object.keys(tabMap).map(tab => `<button class="${state.orderTab === tab ? "is-active" : ""}" data-order-tab="${tab}">${tab}</button>`).join("")}</nav>
          ${visibleOrders.length ? `<div class="order-list">${visibleOrders.map(renderOrderCard).join("")}</div>` : `<div class="empty-state"><i>▧</i><strong>暂无相关订单</strong><p>订单状态更新后会显示在这里</p><button class="secondary-button" data-screen="home" style="padding:0 18px">去逛逛</button></div>`}
        </div>
        ${tabbar("profile")}
      </section>`;
  }

  function renderAfterSale() {
    const product = products[3];
    if (state.afterSaleSubmitted) {
      return `
        <section class="app-screen sale-page">
          ${statusBar()}
          ${header("退款售后")}
          <div class="success-card"><div class="success-icon">✓</div><h3>售后申请已提交</h3><p>申请单号 AS202608060018<br />商家将在 24 小时内完成审核</p><button class="primary-button" data-screen="orders">查看订单</button><button class="secondary-button" data-action="reset-aftersale">返回申请页</button></div>
        </section>`;
    }
    return `
      <section class="app-screen sale-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("申请退款")}
          <div class="form-content">
            <article class="sale-product">${imageMedia(product, "sale-thumb")}<div><h3>${product.name}</h3><p>${product.sku} × 1</p></div></article>
            <section class="form-card"><button class="form-row" data-action="sale-type"><span>售后类型</span><strong>仅退款</strong><span>›</span></button><button class="form-row" data-action="sale-reason"><span>退款原因</span><strong>商品不符合预期</strong><span>›</span></button><div class="form-row"><span>退款数量</span><strong>1</strong><span></span></div><div class="form-row"><span>退款金额</span><strong class="price">¥79</strong><span></span></div></section>
            <section class="form-card"><div class="textarea-wrap"><label>问题描述</label><textarea placeholder="请描述遇到的问题，便于商家更快处理"></textarea></div><div class="textarea-wrap" style="border-top:1px solid var(--line)"><label>上传凭证（选填，最多 3 张）</label><button class="upload-box" data-action="upload"><i>＋</i><span>添加图片</span></button></div></section>
          </div>
        </div>
        <div class="form-submit"><button class="primary-button is-coral" data-action="submit-aftersale">提交申请</button></div>
      </section>`;
  }

  function renderProfile() {
    const agent = state.serviceAgent;
    const agentCard = state.agentBindingStatus === "bound" ? `
      <button class="service-agent-card" data-screen="service-agent">
        <span class="service-agent-card__mark">清</span>
        <span class="service-agent-card__copy"><small>我的服务代理</small><strong>${agent.name}</strong><em>已绑定 · ${agent.city}</em></span>
        <span class="service-agent-card__arrow">›</span>
      </button>` : `
      <button class="service-agent-card is-unbound" data-screen="service-agent">
        <span class="service-agent-card__mark">青</span>
        <span class="service-agent-card__copy"><small>服务代理</small><strong>暂未绑定</strong><em>从有效邀请入口登录后确认</em></span>
        <span class="service-agent-card__arrow">›</span>
      </button>`;
    return `
      <section class="app-screen with-tabbar profile-page">
        <div class="screen-scroll">
          <div class="profile-hero">
            ${statusBar(true)}
            <div class="profile-tools"><button class="icon-button" data-action="message" aria-label="消息">◦</button><button class="icon-button" data-action="settings" aria-label="设置">⚙</button></div>
            <div class="profile-user"><div class="avatar">青</div><div><h2>林青</h2><p>微信用户 · 已加入青序 128 天</p></div></div>
          </div>
          <div class="profile-body">
            ${agentCard}
            <section class="profile-card"><div class="profile-card__head"><strong>我的订单</strong><button data-screen="orders">全部订单 ›</button></div><div class="order-shortcuts"><button data-order-shortcut="待付款"><i>◴</i><span>待付款</span></button><button data-order-shortcut="待发货"><span class="notice-dot">1</span><i>▣</i><span>待发货</span></button><button data-order-shortcut="待收货"><span class="notice-dot">1</span><i>♧</i><span>待收货</span></button><button data-order-shortcut="已完成"><i>✓</i><span>已完成</span></button><button data-screen="aftersale"><i>↺</i><span>退款/售后</span></button></div></section>
            <section class="profile-card"><div class="profile-card__head"><strong>常用功能</strong></div><div class="benefit-row"><button data-action="favorite-list"><strong>${state.favorite ? 1 : 0}</strong><span>商品收藏</span></button><button data-action="address"><strong>1</strong><span>收货地址</span></button><button data-action="service"><strong>◉</strong><span>联系商家</span></button></div></section>
            <section class="profile-card menu-list"><button class="menu-item" data-action="address"><i>⌖</i><span>收货地址</span><span>›</span></button><button class="menu-item" data-action="service"><i>◉</i><span>联系商家</span><span>›</span></button><button class="menu-item" data-action="quality"><i>◇</i><span>正品与服务保障</span><span>›</span></button><button class="menu-item" data-action="feedback"><i>✎</i><span>意见反馈</span><span>›</span></button></section>
          </div>
        </div>
        ${tabbar("profile")}
      </section>`;
  }

  function renderServiceAgent() {
    const agent = state.serviceAgent;
    const isBound = state.agentBindingStatus === "bound";
    return `
      <section class="app-screen service-agent-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("服务代理")}
          <div class="service-agent-body">
            ${isBound ? `
              <article class="service-agent-identity">
                <span class="service-agent-identity__mark">清</span>
                <div><small>CURRENT SERVICE AGENT</small><h3>${agent.name}</h3><p>${agent.contact} · ${agent.city}</p></div>
                <span class="binding-badge">已绑定</span>
              </article>
              <section class="agent-fact-card">
                <div><span>绑定时间</span><strong>${agent.boundAt}</strong></div>
                <div><span>服务联系</span><strong>${agent.phone}</strong></div>
                <div><span>服务编号</span><strong>${agent.id}</strong></div>
              </section>` : `
              <article class="service-agent-empty"><span>青</span><h3>暂未绑定服务代理</h3><p>从有效分享链接或邀请二维码进入，登录后将显示绑定确认。</p></article>`}

            <section class="agent-policy-card">
              <div class="agent-policy-card__head"><span>◇</span><div><strong>商城服务保障</strong><small>归属关系不改变您的购物权益</small></div></div>
              <ul><li>商品价格、支付与发货由青序生活统一提供</li><li>退款与售后仍由平台客服统一受理</li><li>绑定后不可自助更换，异常情况请联系客服</li></ul>
            </section>

            <section class="agent-help-card"><div><strong>需要帮助？</strong><p>对服务归属有疑问，平台客服会核实处理。</p></div><button class="secondary-button" data-action="service">联系平台客服</button></section>
          </div>
        </div>
      </section>`;
  }

  const renderers = {
    home: renderHome,
    category: renderCategory,
    search: renderSearch,
    product: renderProduct,
    cart: renderCart,
    checkout: renderCheckout,
    orders: renderOrders,
    aftersale: renderAfterSale,
    profile: renderProfile,
    "service-agent": renderServiceAgent
  };

  function render() {
    app.innerHTML = renderers[state.screen]();
    document.querySelectorAll(".screen-nav__item").forEach(item => item.classList.toggle("is-active", item.dataset.screen === state.screen));
    const meta = screenMeta[state.screen];
    document.querySelector("#canvasTitle").textContent = meta.canvasTitle;
    document.querySelector("#inspectorTitle").textContent = meta.title;
    document.querySelector("#inspectorDescription").textContent = meta.description;
    document.querySelector("#interactionList").innerHTML = meta.interactions.map(item => `<li>${item}</li>`).join("");
  }

  function navigate(screen, push = true) {
    if (!renderers[screen]) return;
    closeSheet();
    if (push && state.screen !== screen) state.history.push(state.screen);
    state.screen = screen;
    render();
  }

  function goBack() {
    navigate(state.history.pop() || "home", false);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function openSheet(content) {
    bottomSheet.innerHTML = content;
    bottomSheet.hidden = false;
    sheetBackdrop.hidden = false;
    requestAnimationFrame(() => {
      bottomSheet.classList.add("is-visible");
      sheetBackdrop.classList.add("is-visible");
    });
  }

  function closeSheet() {
    bottomSheet.classList.remove("is-visible");
    sheetBackdrop.classList.remove("is-visible");
    setTimeout(() => {
      bottomSheet.hidden = true;
      sheetBackdrop.hidden = true;
      bottomSheet.innerHTML = "";
    }, 190);
  }

  function skuSheet() {
    const product = state.product;
    return `
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        ${imageMedia(product, "sheet-thumb product-card__media")}
        <div><span class="product-brand">${product.brand}</span><h3>${product.name}</h3><span class="price"><small>¥</small>${product.price}</span></div>
        <button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button>
      </div>
      <div class="sheet-section"><div class="sheet-section__head"><span>选择规格</span><span>库存 286 件</span></div><div class="option-row">${["30ml 单瓶", "30ml 双瓶装", "体验装 5ml"].map(option => `<button class="option-button ${state.sku === option ? "is-active" : ""}" data-sku="${option}">${option}</button>`).join("")}</div></div>
      <div class="sheet-section"><div class="sheet-section__head"><span>购买数量</span><div class="quantity-stepper"><button data-sku-delta="-1">−</button><span>${state.quantity}</span><button data-sku-delta="1">＋</button></div></div></div>
      <div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button ${state.skuIntent === "buy" ? "is-coral" : ""}" data-action="confirm-sku">${state.skuIntent === "buy" ? "确认并结算" : "确认加入购物车"}</button></div>`;
  }

  function paymentSheet(total) {
    return `
      <div class="sheet-handle"></div><div class="payment-sheet"><div class="pay-icon">✓</div><h3>微信支付</h3><p>订单已创建，请完成支付</p><div class="payment-amount"><small>¥</small>${Number(total).toFixed(2)}</div><div class="payment-note">原型演示环境不会发起真实扣款。确认后模拟支付成功并进入订单列表。</div><div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">稍后支付</button><button class="primary-button" data-action="mock-pay" data-total="${total}">模拟支付成功</button></div></div>`;
  }

  function agentBindingSheet() {
    const agent = state.serviceAgent;
    return `
      <div class="sheet-handle"></div>
      <div class="binding-sheet">
        <span class="binding-sheet__mark">清</span>
        <small>SERVICE INVITATION</small>
        <h3>确认服务代理</h3>
        <p>您正在通过 <strong>${agent.name}</strong> 的邀请进入青序生活。确认后，该服务代理将为您提供选购咨询服务。</p>
        <div class="binding-assurance"><span>✓</span><div><strong>购物权益不受影响</strong><small>商品价格、支付、发货与售后均由青序生活统一保障。</small></div></div>
        <div class="binding-warning">绑定后不可自行更换；如归属异常，可联系平台客服核实。</div>
        <div class="sheet-footer"><button class="secondary-button" data-action="decline-agent-binding">暂不绑定</button><button class="primary-button" data-action="confirm-agent-binding">确认绑定</button></div>
      </div>`;
  }

  function handleSkuConfirm() {
    if (state.skuIntent === "cart") {
      const existing = state.cart.find(item => item.product.id === state.product.id);
      if (existing) {
        existing.quantity += state.quantity;
        existing.selected = true;
      } else {
        state.cart.push({ product: state.product, quantity: state.quantity, selected: true });
      }
      closeSheet();
      showToast(`已加入购物车 · ${state.sku} × ${state.quantity}`);
    } else {
      state.cart.forEach(item => { item.selected = false; });
      const existing = state.cart.find(item => item.product.id === state.product.id);
      if (existing) {
        existing.quantity = state.quantity;
        existing.selected = true;
      } else {
        state.cart.push({ product: state.product, quantity: state.quantity, selected: true });
      }
      closeSheet();
      setTimeout(() => navigate("checkout"), 190);
    }
  }

  document.addEventListener("click", event => {
    const target = event.target.closest("button, [data-screen], [data-action]");
    if (!target) return;

    if (target.dataset.screen) {
      navigate(target.dataset.screen);
      return;
    }

    if (target.dataset.device) {
      state.device = Number(target.dataset.device);
      document.documentElement.style.setProperty("--device-width", `${state.device}px`);
      document.querySelectorAll("[data-device]").forEach(button => button.classList.toggle("is-active", Number(button.dataset.device) === state.device));
      document.querySelector("#deviceLabel").textContent = `${state.device} × 812`;
      return;
    }

    if (target.dataset.category) {
      state.selectedCategory = target.dataset.category;
      navigate("category");
      return;
    }

    if (target.dataset.categorySwitch) {
      state.selectedCategory = target.dataset.categorySwitch;
      state.filter = "全部";
      render();
      return;
    }

    if (target.dataset.filter) {
      state.filter = target.dataset.filter;
      render();
      showToast(`已按“${state.filter}”筛选`);
      return;
    }

    if (target.dataset.openProduct) {
      state.product = products.find(product => product.id === target.dataset.openProduct) || products[0];
      state.sku = state.product.sku.replace(" / ", " ");
      state.quantity = 1;
      navigate("product");
      return;
    }

    if (target.dataset.keyword) {
      state.searchQuery = target.dataset.keyword;
      state.searchPerformed = true;
      render();
      return;
    }

    if (target.dataset.sort) {
      state.searchSort = target.dataset.sort;
      render();
      return;
    }

    if (target.dataset.detailTab) {
      state.detailTab = target.dataset.detailTab;
      render();
      return;
    }

    if (target.dataset.skuIntent) {
      state.skuIntent = target.dataset.skuIntent;
      state.quantity = 1;
      openSheet(skuSheet());
      return;
    }

    if (target.dataset.sku) {
      state.sku = target.dataset.sku;
      bottomSheet.innerHTML = skuSheet();
      return;
    }

    if (target.dataset.skuDelta) {
      state.quantity = Math.max(1, Math.min(99, state.quantity + Number(target.dataset.skuDelta)));
      bottomSheet.innerHTML = skuSheet();
      return;
    }

    if (target.dataset.cartSelect !== undefined) {
      const item = state.cart[Number(target.dataset.cartSelect)];
      if (item) item.selected = !item.selected;
      render();
      return;
    }

    if (target.dataset.cartQty !== undefined) {
      const index = Number(target.dataset.cartQty);
      const item = state.cart[index];
      if (!item) return;
      const next = item.quantity + Number(target.dataset.delta);
      if (next < 1) {
        state.cart.splice(index, 1);
        showToast("商品已移出购物车");
      } else {
        item.quantity = Math.min(next, 99);
      }
      render();
      return;
    }

    if (target.dataset.orderTab) {
      state.orderTab = target.dataset.orderTab;
      render();
      return;
    }

    if (target.dataset.orderShortcut) {
      state.orderTab = target.dataset.orderShortcut === "已完成" ? "全部" : target.dataset.orderShortcut;
      navigate("orders");
      return;
    }

    if (target.dataset.confirmOrder) {
      const order = state.orders.find(item => item.id === target.dataset.confirmOrder);
      if (order) order.status = "已完成";
      render();
      showToast("已确认收货");
      return;
    }

    const action = target.dataset.action;
    if (!action) return;
    if (action === "back") return goBack();
    if (action === "close-sheet") return closeSheet();
    if (action === "open-sku") {
      state.skuIntent = "cart";
      return openSheet(skuSheet());
    }
    if (action === "confirm-sku") return handleSkuConfirm();
    if (action === "favorite") {
      state.favorite = !state.favorite;
      render();
      return showToast(state.favorite ? "已收藏商品" : "已取消收藏");
    }
    if (action === "select-all") {
      const shouldSelect = !state.cart.every(item => item.selected);
      state.cart.forEach(item => { item.selected = shouldSelect; });
      return render();
    }
    if (action === "checkout") {
      if (!state.cart.some(item => item.selected)) return showToast("请先选择要结算的商品");
      return navigate("checkout");
    }
    if (action === "submit-order") return openSheet(paymentSheet(target.dataset.total));
    if (action === "mock-pay") {
      const selected = state.cart.filter(item => item.selected);
      const first = selected[0] || { product: state.product, quantity: state.quantity };
      state.orders.unshift({ id: `QX${new Date().toISOString().slice(0, 10).replaceAll("-", "")}0099`, status: "待发货", product: first.product, quantity: first.quantity, total: Number(target.dataset.total) });
      state.cart = state.cart.filter(item => !item.selected);
      state.orderTab = "全部";
      closeSheet();
      setTimeout(() => { navigate("orders"); showToast("支付成功，订单已进入待发货"); }, 190);
      return;
    }
    if (action === "submit-aftersale") {
      state.afterSaleSubmitted = true;
      return render();
    }
    if (action === "reset-aftersale") {
      state.afterSaleSubmitted = false;
      return render();
    }
    if (action === "clear-search") {
      state.searchQuery = "";
      state.searchPerformed = false;
      return render();
    }
    if (action === "clear-search-history") return showToast("搜索记录已清空");
    if (action === "confirm-agent-binding") {
      state.agentBindingStatus = "bound";
      if (!state.serviceAgent.boundAt) state.serviceAgent.boundAt = "2026-08-10 11:08";
      closeSheet();
      render();
      return showToast(`已绑定服务代理：${state.serviceAgent.name}`);
    }
    if (action === "decline-agent-binding") {
      state.agentBindingStatus = "unbound";
      closeSheet();
      render();
      return showToast("已保留未绑定状态");
    }
    if (action === "manage-cart") return showToast("管理模式：可左滑删除商品");
    if (action === "share") return showToast("已生成小程序分享卡片");
    if (action === "service") return showToast("正在连接商家客服…");
    if (action === "remind") return showToast("已提醒商家尽快发货");
    if (action === "logistics") return showToast("顺丰速运 · 运输中，预计明日送达");
    if (action === "upload") return showToast("原型演示：已打开图片选择器");
    if (action === "address") return showToast("原型演示：打开收货地址管理");
    if (action === "sale-type") return showToast("首期支持“仅退款”和“退货退款”");
    if (action === "sale-reason") return showToast("原型演示：打开退款原因选择");
    if (action === "favorite-list") return showToast(state.favorite ? "收藏夹中有 1 件商品" : "收藏夹暂无商品");
    return showToast("此入口已预留交互反馈");
  });

  document.addEventListener("submit", event => {
    if (event.target.id !== "searchForm") return;
    event.preventDefault();
    const input = event.target.querySelector("#searchInput");
    state.searchQuery = input.value.trim();
    state.searchPerformed = true;
    render();
  });

  sheetBackdrop.addEventListener("click", closeSheet);
  document.querySelector("#resetPrototype").addEventListener("click", () => {
    state.screen = "home";
    state.history = [];
    state.selectedCategory = "护肤品";
    state.searchQuery = "";
    state.searchPerformed = false;
    state.product = products[0];
    state.detailTab = "亮点";
    state.favorite = false;
    state.quantity = 1;
    state.afterSaleSubmitted = false;
    state.agentBindingStatus = "bound";
    state.serviceAgent = { ...inviteAgents["QX-A1038"] };
    closeSheet();
    render();
    showToast("原型已重置");
  });

  const prototypeParams = new URLSearchParams(window.location.search);
  const requestedScreen = prototypeParams.get("screen");
  const requestedDevice = Number(prototypeParams.get("device"));
  const inviteCode = prototypeParams.get("invite");
  const requestedBinding = prototypeParams.get("binding");
  let inviteNotice = "";
  if (requestedScreen && renderers[requestedScreen]) state.screen = requestedScreen;
  if (requestedBinding === "unbound") state.agentBindingStatus = "unbound";
  if (inviteCode) {
    const invitedAgent = inviteAgents[inviteCode];
    if (!invitedAgent) {
      inviteNotice = "邀请码无效或已失效，未建立服务归属";
    } else if (state.agentBindingStatus === "unbound") {
      state.serviceAgent = { ...invitedAgent };
      state.agentBindingStatus = "pending";
    } else {
      inviteNotice = `您已绑定 ${state.serviceAgent.name}，本次邀请不改变归属`;
    }
  }
  if ([375, 414].includes(requestedDevice)) {
    state.device = requestedDevice;
    phoneShell.style.setProperty("--device-width", `${requestedDevice}px`);
    document.querySelectorAll("[data-device]").forEach(button => {
      button.classList.toggle("is-active", Number(button.dataset.device) === requestedDevice);
    });
    document.querySelector("#deviceLabel").textContent = `${requestedDevice} × 812`;
  }

  render();
  if (state.agentBindingStatus === "pending") setTimeout(() => openSheet(agentBindingSheet()), 120);
  else if (inviteNotice) setTimeout(() => showToast(inviteNotice), 120);
})();
