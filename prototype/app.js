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
      category: "护肤品",
      skus: [
        { id: "SKU-SER-30", name: "30ml / 单瓶", price: 168, stock: 286 },
        { id: "SKU-SER-60", name: "30ml × 2 / 双瓶装", price: 298, stock: 96 },
        { id: "SKU-SER-5", name: "5ml / 体验装", price: 39, stock: 120 }
      ]
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
      category: "洗发水",
      skus: [
        { id: "SKU-SHA-500", name: "500ml / 清新木质香", price: 89, stock: 142 },
        { id: "SKU-SHA-1000", name: "500ml × 2 / 家庭装", price: 158, stock: 64 }
      ]
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
      category: "护肤品",
      skus: [{ id: "SKU-CLN-120", name: "120g / 单支", price: 59, stock: 214 }]
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
      category: "沐浴露",
      skus: [
        { id: "SKU-BOD-480", name: "480ml / 白茶香", price: 79, stock: 88 },
        { id: "SKU-BOD-960", name: "480ml × 2 / 双瓶装", price: 139, stock: 36 }
      ]
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
      category: "防晒产品",
      skus: [{ id: "SKU-SUN-50", name: "50ml / 单支", price: 98, stock: 173 }]
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
      category: "家庭清洁",
      skus: [{ id: "SKU-LAU-30", name: "30颗 / 清新香", price: 49, stock: 309 }]
    }
  ];

  const productDetails = {
    serum: {
      highlightTitle: "温和修护，透亮有光",
      highlight: "精选山茶花籽油与泛醇复配，帮助改善干燥粗糙。清透水感质地，快速吸收不黏腻。",
      ingredients: [["山茶花籽油", "柔润修护"], ["5% 泛醇", "舒缓保湿"], ["角鲨烷", "强化屏障"]],
      ingredientText: "水、甘油、丁二醇、泛醇、角鲨烷、山茶籽油、透明质酸钠、1,2-己二醇、精氨酸等。",
      ingredientNote: "不添加酒精、矿物油与人工色素。敏感肌建议先在耳后进行局部测试。",
      usageTitle: "每日两次，轻柔按压",
      usage: "洁面并使用化妆水后，取 2-3 滴精华均匀涂抹于面部与颈部，用掌心轻压至吸收。",
      usageNote: "白天使用时，请在护肤最后一步叠加防晒产品。"
    },
    shampoo: {
      highlightTitle: "净澈头皮，发根轻盈",
      highlight: "氨基酸表活搭配迷迭香叶提取物，温和清洁头皮油脂，减少洗后干涩与扁塌。",
      ingredients: [["氨基酸表活", "温和清洁"], ["迷迭香叶", "清新头皮"], ["水解角蛋白", "柔顺发丝"]],
      ingredientText: "水、椰油酰谷氨酸钠、椰油酰胺丙基甜菜碱、甘油、迷迭香叶提取物、水解角蛋白等。",
      ingredientNote: "不添加硅油与人工色素。头皮敏感时建议降低使用频率。",
      usageTitle: "充分起泡，重点清洁头皮",
      usage: "湿发后取适量于掌心起泡，以指腹按摩头皮 1-2 分钟，再以清水彻底冲净。",
      usageNote: "油性头皮可清洗两遍，第二遍减少用量。"
    },
    cleanser: {
      highlightTitle: "绵密泡沫，清透不紧绷",
      highlight: "双重氨基酸表活带走日常油脂与污垢，积雪草和甘油帮助维持洁面后的柔润感。",
      ingredients: [["甘氨酸钾", "柔和洁净"], ["积雪草", "舒缓肌肤"], ["甘油", "保湿锁水"]],
      ingredientText: "水、椰油酰甘氨酸钾、甘油、椰油酰胺丙基甜菜碱、积雪草提取物、泛醇等。",
      ingredientNote: "眼周请避开直接揉搓；如不慎入眼，请立即用清水冲洗。",
      usageTitle: "早晚洁面，充分起泡",
      usage: "取黄豆大小于湿润掌心，加水揉搓出泡沫后轻柔按摩面部，再以清水洗净。",
      usageNote: "卸除防水彩妆前请先使用专用卸妆产品。"
    },
    bodywash: {
      highlightTitle: "清雅白茶香，柔润沐浴",
      highlight: "细腻泡沫温和清洁身体肌肤，白茶香调清新克制，洗后肌肤柔润不拔干。",
      ingredients: [["甜菜碱", "温和清洁"], ["白茶提取物", "清新舒缓"], ["甘油", "柔润保湿"]],
      ingredientText: "水、月桂酰肌氨酸钠、椰油酰胺丙基甜菜碱、甘油、茶叶提取物、香精等。",
      ingredientNote: "香味敏感人群建议先局部试用；仅供身体肌肤使用。",
      usageTitle: "打出泡沫后轻柔清洁",
      usage: "取适量于沐浴球或掌心，加水起泡后清洁全身，再用温水冲净。",
      usageNote: "使用后置于阴凉干燥处，避免儿童误触。"
    },
    sunscreen: {
      highlightTitle: "轻薄成膜，通勤高倍防护",
      highlight: "清爽乳液质地易推开，成膜后不易泛白，为日常通勤提供 SPF50+ 防晒保护。",
      ingredients: [["UVA 滤剂", "长波防护"], ["UVB 滤剂", "晒伤防护"], ["维生素 E", "抗氧保湿"]],
      ingredientText: "水、甲氧基肉桂酸乙基己酯、双-乙基己氧苯酚甲氧苯基三嗪、甘油、生育酚等。",
      ingredientNote: "防晒效果会受涂抹量、出汗和擦拭影响。",
      usageTitle: "出门前足量涂抹",
      usage: "护肤最后一步取足量均匀涂抹面部、颈部及暴露部位，出门前约 15 分钟完成。",
      usageNote: "户外活动或大量出汗后建议每 2 小时补涂。"
    },
    laundry: {
      highlightTitle: "一颗定量，去渍护色",
      highlight: "三腔浓缩配方遇水快速溶解，兼顾日常去渍、护色与清新留香，减少手动量取。",
      ingredients: [["非离子表活", "日常去渍"], ["植萃酶", "分解污垢"], ["护色因子", "减少串色"]],
      ingredientText: "表面活性剂、稳定剂、酶制剂、香氛微胶囊、水溶膜等。",
      ingredientNote: "不可食用；请置于儿童和宠物无法触及的位置，避免湿手拿取。",
      usageTitle: "先放凝珠，再放衣物",
      usage: "将一颗凝珠直接放入洗衣机内筒底部，再放入衣物并启动常规洗涤程序。",
      usageNote: "大容量或重污衣物可使用两颗，不适用于手洗。"
    }
  };

  products.forEach(product => {
    product.status = product.id === "sunscreen" ? "INACTIVE" : "ACTIVE";
    product.skus.forEach(sku => { sku.status = product.id === "sunscreen" ? "INACTIVE" : "ACTIVE"; });
    product.sku = product.skus[0].name;
    product.details = productDetails[product.id];
  });

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
      interactions: ["核对地址和配送方式", "核对 SKU 与成交价", "提交订单并模拟支付"]
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
      interactions: ["有效邀请链路登录后显式确认", "候选展示 30 分钟有效期", "绑定后不提供自助更换"]
    },
    login: { canvasTitle: "登录 · 协议与来源确认", title: "登录与协议", description: "受保护动作前完成协议确认，登录后返回原操作并继续处理代理候选。", interactions: ["协议未勾选时阻止登录", "Mock 微信登录", "登录后返回原操作"] },
    "payment-result": { canvasTitle: "支付结果 · 可恢复反馈", title: "支付结果", description: "成功、失败和取消均保留订单事实，并提供与状态一致的下一步。", interactions: ["失败或取消后重试", "成功后查看订单", "稍后支付保留待付款订单"] },
    "order-detail": { canvasTitle: "订单详情 · 四轴状态", title: "订单详情", description: "订单、支付、退款和履约分别表达，商品与地址使用下单快照。", interactions: ["待付款继续支付", "运输中查看物流", "符合资格的订单项申请售后"] },
    logistics: { canvasTitle: "物流详情 · 履约时间线", title: "物流详情", description: "承运商、运单号和人工物流节点形成可追踪时间线。", interactions: ["复制运单号", "查看运输节点", "返回订单详情"] },
    "aftersale-detail": { canvasTitle: "售后详情 · 数量金额占用", title: "售后详情", description: "展示审核、退货、退款与失败重试，并明确已占用的可退数量和金额。", interactions: ["允许阶段取消并释放占用", "填写退货物流", "退款失败可重试"] },
    addresses: { canvasTitle: "地址 · 默认与选择", title: "收货地址", description: "支持新增、编辑、删除、设为默认，并从结算页选择后返回。", interactions: ["选择结算地址", "设为默认", "新增或编辑地址"] },
    "address-edit": { canvasTitle: "地址编辑 · 完整校验", title: "编辑地址", description: "姓名、手机号、省市区和详细地址均为结构化字段。", interactions: ["手机号格式校验", "保存后返回地址列表", "默认地址唯一"] },
    favorites: { canvasTitle: "收藏 · 商品当前状态", title: "商品收藏", description: "收藏列表展示商品当前售价与可售状态，可取消或进入详情。", interactions: ["取消收藏", "进入商品详情", "空状态返回首页"] },
    account: { canvasTitle: "账户与隐私 · 权利入口", title: "账户与隐私", description: "集中进入手机号授权、隐私政策与账号删除流程。", interactions: ["查看手机号授权状态", "进入账号删除申请", "查看隐私政策"] },
    "phone-authorization": { canvasTitle: "手机号授权 · 自愿且独立", title: "手机号授权", description: "账户手机号独立于收货地址，自愿授权后记录来源、验证时间和协议版本。", interactions: ["授权微信手机号", "查看验证来源和时间", "重新授权"] },
    "account-deletion": { canvasTitle: "账号删除 · 资格与影响", title: "账号删除申请", description: "先检查未完成订单与售后，再二次确认撤销会话、结束绑定和资料去标识化。", interactions: ["检查删除资格", "查看保留范围", "二次确认提交"] },
    "system-states": { canvasTitle: "状态样例 · 可恢复与可解释", title: "异常状态样例", description: "集中展示加载、网络错误、403、409 和操作成功的代表性状态。", interactions: ["错误重试", "冲突后刷新", "成功反馈"] }
  };

  const productById = id => products.find(product => product.id === id) || products[0];
  const skuById = id => products.flatMap(product => product.skus).find(sku => sku.id === id) || products[0].skus[0];
  const publicSkusFor = product => product.skus.filter(sku => sku.status === "ACTIVE" && sku.stock > 0);
  const isPublicProduct = product => product?.status === "ACTIVE" && publicSkusFor(product).length > 0;
  const publicProducts = () => products.filter(isPublicProduct);
  const publicProductById = id => products.find(product => product.id === id && isPublicProduct(product));
  const lineProduct = line => productById(line.productId);
  const lineSku = line => skuById(line.skuId);
  const clone = value => JSON.parse(JSON.stringify(value));

  const defaultAddress = {
    id: "ADDR-001",
    recipient: "林青",
    phone: "13852185218",
    region: "浙江省 杭州市 西湖区",
    detail: "文三路 88 号 2 幢 1102 室",
    isDefault: true
  };

  const initialOrders = [
    {
      id: "QX202608110005",
      displayStatus: "待付款",
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "UNPAID",
      latestPaymentAttemptStatus: "CANCELLED",
      refundStatus: "NONE",
      fulfillmentStatus: "NOT_STARTED",
      closeReason: null,
      payExpiresAt: "2026-08-11 15:30",
      createdAt: "2026-08-11 15:00",
      addressSnapshot: clone(defaultAddress),
      items: [{ id: "OI-000", productId: "cleanser", skuId: "SKU-CLN-120", skuName: "120g / 单支", unitPrice: 59, quantity: 1, refundedQty: 0, reservedQty: 0 }],
      total: 59,
      inventoryReservation: { status: "ACTIVE", expiresAt: "2026-08-11 15:30" }
    },
    {
      id: "QX202608060021",
      displayStatus: "待发货",
      orderStatus: "PENDING_SHIPMENT",
      paymentStatus: "PAID",
      refundStatus: "NONE",
      fulfillmentStatus: "READY_TO_SHIP",
      closeReason: null,
      payExpiresAt: null,
      createdAt: "2026-08-06 10:18",
      paidAt: "2026-08-06 10:20",
      addressSnapshot: clone(defaultAddress),
      items: [{ id: "OI-001", productId: "serum", skuId: "SKU-SER-30", skuName: "30ml / 单瓶", unitPrice: 168, quantity: 1, refundedQty: 0, reservedQty: 0 }],
      total: 168
    },
    {
      id: "QX202608030118",
      displayStatus: "运输中",
      orderStatus: "SHIPPING",
      paymentStatus: "PAID",
      refundStatus: "FAILED",
      fulfillmentStatus: "IN_TRANSIT",
      closeReason: null,
      payExpiresAt: null,
      createdAt: "2026-08-03 08:42",
      paidAt: "2026-08-03 08:43",
      addressSnapshot: clone(defaultAddress),
      items: [{ id: "OI-002", productId: "shampoo", skuId: "SKU-SHA-500", skuName: "500ml / 清新木质香", unitPrice: 89, quantity: 1, refundedQty: 0, reservedQty: 1 }],
      total: 89,
      shipment: { carrier: "顺丰速运", trackingNo: "SF143820260803", shippedAt: "2026-08-04 16:20", eta: "预计 8 月 7 日送达" }
    },
    {
      id: "QX202607280076",
      displayStatus: "已完成",
      orderStatus: "COMPLETED",
      paymentStatus: "PAID",
      refundStatus: "NONE",
      fulfillmentStatus: "DELIVERED",
      closeReason: null,
      payExpiresAt: null,
      createdAt: "2026-07-28 19:32",
      paidAt: "2026-07-28 19:34",
      completedAt: "2026-08-02 12:08",
      addressSnapshot: clone(defaultAddress),
      items: [{ id: "OI-003", productId: "bodywash", skuId: "SKU-BOD-480", skuName: "480ml / 白茶香", unitPrice: 79, quantity: 2, refundedQty: 0, reservedQty: 0 }],
      total: 158
    },
    {
      id: "QX202607220031",
      displayStatus: "退款完成",
      orderStatus: "CLOSED",
      paymentStatus: "PAID",
      refundStatus: "FULL",
      fulfillmentStatus: "CANCELLED",
      closeReason: "FULL_REFUND_BEFORE_SHIPMENT",
      payExpiresAt: null,
      createdAt: "2026-07-22 09:10",
      paidAt: "2026-07-22 09:11",
      addressSnapshot: clone(defaultAddress),
      items: [{ id: "OI-004", productId: "sunscreen", skuId: "SKU-SUN-50", skuName: "50ml / 单支", unitPrice: 98, quantity: 1, refundedQty: 1, reservedQty: 0 }],
      total: 98,
      refundedAmount: 98,
      inventoryRestock: { status: "COMPLETED", quantity: 1, at: "2026-07-22 10:06" }
    }
  ];

  const state = {
    screen: "home",
    history: [],
    device: 375,
    selectedCategory: "护肤品",
    categoryBrand: "全部",
    filter: "全部",
    searchQuery: "",
    searchPerformed: false,
    searchSort: "综合",
    product: products[0],
    detailTab: "亮点",
    favoriteProductIds: ["serum"],
    selectedSkuId: "SKU-SER-30",
    quantity: 1,
    skuIntent: "cart",
    loggedIn: true,
    consentAccepted: false,
    verifiedPhone: null,
    authReturn: null,
    pendingProtectedAction: null,
    inviteCandidate: null,
    agentBindingStatus: "bound",
    serviceAgent: { ...inviteAgents["QX-A1038"] },
    cartManaging: false,
    cart: [
      { productId: "serum", skuId: "SKU-SER-30", quantity: 1, selected: true },
      { productId: "bodywash", skuId: "SKU-BOD-480", quantity: 2, selected: true },
      { productId: "sunscreen", skuId: "SKU-SUN-50", quantity: 1, selected: false, invalidReason: "商品已下架" }
    ],
    checkoutMode: "cart",
    buyNowLine: null,
    currentAddressId: "ADDR-001",
    addressReturnScreen: null,
    editingAddressId: "ADDR-001",
    addresses: [clone(defaultAddress), { id: "ADDR-002", recipient: "林青", phone: "13852185218", region: "上海市 上海市 徐汇区", detail: "衡山路 26 号 6 楼", isDefault: false }],
    orderTab: "全部",
    currentOrderId: "QX202608030118",
    activePaymentOrderId: null,
    paymentResult: { outcome: "cancelled", orderId: "QX202608110005", message: "支付已取消，订单仍为待付款" },
    submittingOrder: false,
    orders: clone(initialOrders),
    afterSaleOrderId: "QX202607280076",
    afterSaleItemId: "OI-003",
    afterSaleQty: 1,
    afterSaleType: "仅退款",
    afterSaleReason: "商品不符合预期",
    afterSaleDescription: "",
    afterSaleEvidenceCount: 0,
    submittingAftersale: false,
    currentAfterSaleId: null,
    aftersales: [{ id: "AS202608030006", orderId: "QX202608030118", orderItemId: "OI-002", type: "退货退款", reason: "商品破损", quantity: 1, reservedAmount: 89, status: "REFUND_FAILED", trackingNo: "SFRET20260805", createdAt: "2026-08-05 11:20", updatedAt: "2026-08-06 14:08", failureReason: "支付渠道暂时不可用" }],
    deletionEligible: false,
    deletionRequested: false,
    uiRecovered: false
  };

  const app = document.querySelector("#app");
  const bottomSheet = document.querySelector("#bottomSheet");
  const sheetBackdrop = document.querySelector("#sheetBackdrop");
  const toast = document.querySelector("#toast");
  let toastTimer;
  let sheetCloseTimer;

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
    const catalog = publicProducts();
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
            <div class="product-grid">${catalog.slice(0, 4).map(productCard).join("")}</div>
          </section>

          <section class="section-block" style="padding-bottom:22px">
            <div class="section-heading"><div><h3>新品上架</h3><p>为日常带来一点新鲜感</p></div></div>
            <div class="product-grid">${catalog.slice(4).map(productCard).join("")}</div>
          </section>
        </div>
        ${tabbar("home")}
      </section>`;
  }

  function renderCategory() {
    const categoryProducts = publicProducts().filter(product => product.category === state.selectedCategory);
    const brands = ["全部", ...new Set(categoryProducts.map(product => product.brand))];
    let displayProducts = categoryProducts.filter(product => state.categoryBrand === "全部" || product.brand === state.categoryBrand);
    if (state.filter === "热销") displayProducts = [...displayProducts].sort((a, b) => b.sales - a.sales);
    if (state.filter === "新品") displayProducts = displayProducts.filter(product => product.badge.includes("新品"));
    if (state.filter === "价格") displayProducts = [...displayProducts].sort((a, b) => a.price - b.price);
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
            ${brands.length > 1 ? `<div class="filter-row brand-filter-row">${brands.map(brand => `<button class="filter-chip ${state.categoryBrand === brand ? "is-active" : ""}" data-category-brand="${brand}">${brand}</button>`).join("")}</div>` : ""}
            ${displayProducts.length ? `<div class="product-grid compact-grid">${displayProducts.map(productCard).join("")}</div>` : `<div class="empty-state category-empty"><i>⌕</i><strong>该分类暂无匹配商品</strong><p>商品上架后会显示在这里，可切换筛选或浏览其他分类。</p><button class="secondary-button" data-action="reset-category-filter" style="padding:0 18px">清除筛选</button></div>`}
          </div>
        </div>
        ${tabbar("category")}
      </section>`;
  }

  function searchMatches() {
    const query = state.searchQuery.trim().toLowerCase();
    const catalog = publicProducts();
    if (!query) return catalog;
    return catalog.filter(product => [product.name, product.brand, product.category, product.subtitle].join(" ").toLowerCase().includes(query));
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

  const initialState = clone(state);

  function maskPhone(phone) {
    return phone ? `${phone.slice(0, 3)} **** ${phone.slice(-4)}` : "";
  }

  function maskRecipient(recipient) {
    return recipient ? `${recipient.slice(0, 1)}${"*".repeat(Math.max(1, recipient.length - 1))}` : "";
  }

  function maskAddressDetail(detail) {
    if (!detail) return "";
    const street = detail.trim().split(/\s+/)[0];
    return `${street.slice(0, 4)} ****`;
  }

  function currentProductSku() {
    const activeSkus = publicSkusFor(state.product);
    return activeSkus.find(sku => sku.id === state.selectedSkuId) || activeSkus[0];
  }

  function renderProduct() {
    const product = state.product;
    const selectedSku = currentProductSku();
    const isFavorite = state.favoriteProductIds.includes(product.id);
    const detail = product.details;
    const detailCopy = {
      "亮点": `<h3>${detail.highlightTitle}</h3><p>${detail.highlight}</p><div class="ingredient-list">${detail.ingredients.map(([name, effect]) => `<div><strong>${name}</strong><span>${effect}</span></div>`).join("")}</div>`,
      "成分": `<h3>配方公开透明</h3><p>${detail.ingredientText}</p><p>${detail.ingredientNote}</p>`,
      "使用方法": `<h3>${detail.usageTitle}</h3><p>${detail.usage}</p><p>${detail.usageNote}</p>`
    };
    return `
      <section class="app-screen with-buybar product-page">
        <div class="screen-scroll">
          <div class="product-gallery">
            ${statusBar()}
            <div class="floating-header"><button class="icon-button is-soft" data-action="back" aria-label="返回">‹</button><div><button class="icon-button is-soft" data-action="share" aria-label="分享">↗</button><button class="icon-button is-soft" data-action="favorite" aria-label="收藏">${isFavorite ? "♥" : "♡"}</button></div></div>
            ${imageMedia(product, "product-hero-media")}
            <div class="gallery-dots"><i></i><i></i><i></i></div>
          </div>
          <div class="product-summary">
            <div class="price-row"><span class="price-label">零售价</span><span class="price"><small>¥</small>${selectedSku.price}</span></div>
            <h1>${product.name}</h1>
            <p>${product.subtitle}。严选原料与温和配方，让护理回归简单有效。</p>
            <div class="summary-meta"><span>${product.brand}</span><span>库存 ${selectedSku.stock}</span><span>已售 ${product.sales}</span></div>
          </div>
          <div class="info-list">
            <button class="info-row" data-action="open-sku"><span>规格</span><strong>${selectedSku.name}</strong><span>›</span></button>
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
    return state.cart.filter(item => item.selected && !item.invalidReason).reduce((sum, item) => sum + lineSku(item).price * item.quantity, 0);
  }

  function renderCart() {
    const validItems = state.cart.filter(item => !item.invalidReason);
    const selectedCount = validItems.filter(item => item.selected).length;
    const allSelected = Boolean(validItems.length) && selectedCount === validItems.length;
    return `
      <section class="app-screen with-tabbar cart-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("购物车", { back: false, action: `<button class="text-button" data-action="manage-cart">${state.cartManaging ? "完成" : "管理"}</button>` })}
          ${state.cart.length ? `
            <div class="cart-list">
              <div class="cart-group-label"><span>青序自营</span><span>·</span><span>全场包邮</span></div>
              ${state.cart.map((item, index) => {
                const product = lineProduct(item);
                const sku = lineSku(item);
                return `<article class="cart-card ${item.invalidReason ? "is-invalid" : ""}" data-cart-sku="${item.skuId}">
                  <button class="check-control ${item.selected ? "is-checked" : ""}" data-cart-select="${index}" aria-label="选择商品" ${item.invalidReason ? "disabled" : ""}>✓</button>
                  ${imageMedia(product, "cart-thumb")}
                  <div class="cart-info"><h3>${product.name}</h3><span class="sku-label">${sku.name}</span>${item.invalidReason ? `<small class="invalid-reason">${item.invalidReason} · 不计入结算</small>` : ""}<div class="cart-card__footer"><span class="price"><small>¥</small>${sku.price}</span>${state.cartManaging || item.invalidReason ? `<button class="cart-delete" data-cart-delete="${index}">删除</button>` : `<div class="quantity-stepper"><button data-cart-qty="${index}" data-delta="-1">−</button><span>${item.quantity}</span><button data-cart-qty="${index}" data-delta="1">＋</button></div>`}</div></div>
                </article>`;
              }).join("")}
            </div>
            <section class="cart-recommend"><div class="section-heading"><div><h3>你可能还喜欢</h3></div></div><div class="product-grid">${publicProducts().slice(2, 4).map(productCard).join("")}</div></section>
          ` : `<div class="empty-state"><i>□</i><strong>购物车还是空的</strong><p>去挑选一些日常好物吧</p><button class="primary-button" data-screen="home" style="padding:0 22px">去逛逛</button></div>`}
        </div>
        ${state.cart.length ? `<div class="cart-summary"><button class="select-all" data-action="select-all"><span class="check-control ${allSelected ? "is-checked" : ""}">✓</span><span>全选</span></button><div class="summary-price"><span>合计：<strong>${money(cartTotal())}</strong></span><small>提交时重新校验价格和库存</small></div><button class="primary-button is-coral" data-action="checkout" ${selectedCount ? "" : "disabled"}>去结算 (${selectedCount})</button></div>` : ""}
        ${tabbar("cart")}
      </section>`;
  }

  function checkoutLines() {
    if (state.checkoutMode === "buy" && state.buyNowLine) return [state.buyNowLine];
    return state.cart.filter(item => item.selected && !item.invalidReason);
  }

  function renderCheckout() {
    const items = checkoutLines();
    const total = items.reduce((sum, item) => sum + lineSku(item).price * item.quantity, 0);
    const address = state.addresses.find(item => item.id === state.currentAddressId) || state.addresses[0];
    return `
      <section class="app-screen checkout-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("确认订单")}
          <div class="checkout-content">
            ${address ? `<button class="address-card" data-action="choose-address"><span class="address-icon">⌖</span><span class="address-main"><strong>${address.recipient} <span>${maskPhone(address.phone)}</span></strong><p>${address.region} ${address.detail}</p></span><span>›</span></button>` : `<button class="address-card is-empty" data-action="choose-address"><span class="address-icon">＋</span><span class="address-main"><strong>添加收货地址</strong><p>提交订单前需要选择有效地址</p></span><span>›</span></button>`}
            <section class="checkout-card"><div class="merchant-name">青序自营 · 正品保障</div>
              ${items.map(item => {
                const product = lineProduct(item);
                const sku = lineSku(item);
                return `<div class="checkout-product" data-checkout-sku="${item.skuId}">${imageMedia(product, "checkout-thumb")}<div class="checkout-info"><h3>${product.name}</h3><p>${sku.name}</p></div><div class="checkout-price"><strong>${money(sku.price)}</strong><span>×${item.quantity}</span></div></div>`;
              }).join("") || `<div class="inline-alert is-warning">结算商品已失效，请返回购物车重新选择。</div>`}
              <div class="checkout-options"><div class="checkout-row"><span>配送方式</span><span>快递配送 · 包邮</span></div></div>
            </section>
            <section class="amount-card"><div class="amount-row"><span>商品金额</span><span>${money(total)}</span></div><div class="amount-row"><span>运费</span><span>¥0</span></div><div class="amount-row total"><span>应付合计</span><strong>${money(total)}</strong></div></section>
            <div class="inline-alert"><strong>库存预占 30 分钟</strong><span>提交即创建待付款订单；支付取消或稍后支付不会丢失订单。</span></div>
          </div>
        </div>
        <div class="checkout-bar"><div class="checkout-total">共 ${items.reduce((sum, item) => sum + item.quantity, 0)} 件，合计 <strong>${money(total)}</strong></div><button class="primary-button is-coral" data-action="submit-order" ${!items.length || !address || state.submittingOrder ? "disabled" : ""}>${state.submittingOrder ? "提交中…" : "提交订单"}</button></div>
      </section>`;
  }

  function statusClass(status) {
    if (status === "运输中") return "is-blue";
    if (status === "已完成" || status === "退款完成") return "is-green";
    if (status === "已关闭") return "is-muted";
    return "";
  }

  function orderQuantity(order) {
    return order.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  function orderHasAftersale(order) {
    return order.refundStatus !== "NONE" || state.aftersales.some(item => item.orderId === order.id && item.status !== "CANCELLED");
  }

  function renderOrderItems(order, className = "order-product") {
    return order.items.map(item => {
      const product = productById(item.productId);
      return `<div class="${className}" data-order-item-sku="${item.skuId}">${imageMedia(product, "order-thumb")}<div class="order-info"><h3>${product.name}</h3><p>${item.skuName}</p>${item.reservedQty ? `<small>售后占用 ${item.reservedQty} 件</small>` : ""}</div><div class="order-unit"><strong>${money(item.unitPrice)}</strong><span>×${item.quantity}</span></div></div>`;
    }).join("");
  }

  function renderOrderCard(order) {
    const actions = order.displayStatus === "待付款"
      ? `<button data-action="cancel-order" data-order-id="${order.id}">取消订单</button><button class="is-primary" data-action="retry-payment" data-order-id="${order.id}">立即付款</button>`
      : order.displayStatus === "待发货"
        ? `<button data-action="remind">提醒发货</button>`
        : order.displayStatus === "运输中"
          ? `<button data-action="open-logistics" data-order-id="${order.id}">查看物流</button><button class="is-primary" data-confirm-order="${order.id}">确认收货</button>`
          : order.displayStatus === "已完成"
            ? `<button data-action="apply-aftersale" data-order-id="${order.id}" data-item-id="${order.items[0].id}">申请售后</button><button class="is-primary" data-open-product="${order.items[0].productId}">再次购买</button>`
            : orderHasAftersale(order) ? `<button data-action="open-order-aftersale" data-order-id="${order.id}">查看售后</button>` : "";
    return `
      <article class="order-card">
        <button class="order-card__head" data-open-order="${order.id}"><strong>订单 ${order.id}</strong><span class="order-status ${statusClass(order.displayStatus)}">${order.displayStatus}</span></button>
        ${renderOrderItems(order)}
        <div class="order-total">共 ${orderQuantity(order)} 件，订单金额 <strong>${money(order.total)}</strong></div>
        <div class="order-actions">${actions}</div>
      </article>`;
  }

  function renderOrders() {
    const tabs = ["全部", "待付款", "待发货", "待收货", "已完成", "退款/售后"];
    const visibleOrders = state.orders.filter(order => {
      if (state.orderTab === "全部") return true;
      if (state.orderTab === "待收货") return order.displayStatus === "运输中";
      if (state.orderTab === "退款/售后") return orderHasAftersale(order) || order.displayStatus === "退款完成";
      return order.displayStatus === state.orderTab;
    });
    return `
      <section class="app-screen with-tabbar orders-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("我的订单")}
          <nav class="orders-tabs">${tabs.map(tab => `<button class="${state.orderTab === tab ? "is-active" : ""}" data-order-tab="${tab}">${tab}</button>`).join("")}</nav>
          ${visibleOrders.length ? `<div class="order-list">${visibleOrders.map(renderOrderCard).join("")}</div>` : `<div class="empty-state"><i>▧</i><strong>暂无相关订单</strong><p>订单状态更新后会显示在这里</p><button class="secondary-button" data-screen="home" style="padding:0 18px">去逛逛</button></div>`}
        </div>
        ${tabbar("profile")}
      </section>`;
  }

  function currentOrder() {
    return state.orders.find(order => order.id === state.currentOrderId) || state.orders[0];
  }

  function paymentLabel(status) {
    return ({ UNPAID: "待支付", PROCESSING: "支付处理中", PAID: "已支付" })[status] || status;
  }

  function fulfillmentLabel(status) {
    return ({ NOT_STARTED: "未开始", READY_TO_SHIP: "待发货", SHIPPED: "已发货", IN_TRANSIT: "运输中", DELIVERED: "已送达", CANCELLED: "已取消" })[status] || status;
  }

  function refundLabel(status) {
    return ({ NONE: "无退款", REFUNDING: "退款处理中", PARTIAL: "部分退款", FULL: "已全额退款", FAILED: "退款失败" })[status] || status;
  }

  function renderOrderDetail() {
    const order = currentOrder();
    const address = order.addressSnapshot;
    const statusCopy = order.displayStatus === "待付款" ? `请在 ${order.payExpiresAt || "30 分钟内"} 前完成支付` : order.displayStatus === "运输中" ? "包裹正在运输，请留意物流更新" : order.displayStatus === "退款完成" ? "全额退款已完成，本单不再履约" : "订单状态已更新";
    return `
      <section class="app-screen detail-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("订单详情")}
          <section class="status-hero ${statusClass(order.displayStatus)}"><span>${order.displayStatus}</span><strong>${statusCopy}</strong></section>
          <div class="detail-stack">
            <section class="detail-card address-summary"><span class="address-icon">⌖</span><div><strong>${address.recipient} · ${maskPhone(address.phone)}</strong><p>${address.region} ${address.detail}</p></div></section>
            <section class="detail-card order-detail-products"><div class="card-title"><strong>商品快照</strong><span>下单后规格与成交价不回写</span></div>${renderOrderItems(order)}</section>
            <section class="detail-card fact-list"><div><span>订单状态</span><strong>${order.displayStatus}</strong></div><div><span>支付状态</span><strong>${paymentLabel(order.paymentStatus)}</strong></div><div><span>退款状态</span><strong>${refundLabel(order.refundStatus)}</strong></div><div><span>履约状态</span><strong>${fulfillmentLabel(order.fulfillmentStatus)}</strong></div>${order.closeReason ? `<div><span>关闭原因</span><strong>${order.closeReason === "FULL_REFUND_BEFORE_SHIPMENT" ? "未发货全额退款" : order.closeReason === "PAYMENT_TIMEOUT" ? "支付超时" : "用户取消"}</strong></div>` : ""}${order.inventoryRestock ? `<div><span>库存处理</span><strong>已自动回补 ${order.inventoryRestock.quantity} 件</strong></div>` : ""}</section>
            <section class="detail-card amount-card"><div class="amount-row"><span>商品金额</span><span>${money(order.total)}</span></div><div class="amount-row"><span>运费</span><span>¥0</span></div><div class="amount-row total"><span>${order.paymentStatus === "PAID" ? "实付金额" : "待付金额"}</span><strong>${money(order.total)}</strong></div></section>
            <section class="detail-card timeline-card"><div class="card-title"><strong>订单时间线</strong></div><ol><li class="is-done"><strong>订单已创建</strong><span>${order.createdAt}</span></li><li class="${order.paymentStatus === "PAID" ? "is-done" : ""}"><strong>${order.paymentStatus === "PAID" ? "支付成功" : "等待支付"}</strong><span>${order.paidAt || order.payExpiresAt || "库存保留 30 分钟"}</span></li><li class="${["SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(order.fulfillmentStatus) ? "is-done" : ""}"><strong>商品发出</strong><span>${order.shipment?.shippedAt || (order.fulfillmentStatus === "CANCELLED" ? "履约已终止" : "等待总部发货")}</span></li></ol></section>
            ${order.displayStatus === "待付款" ? `<div class="inline-alert is-warning actionable-alert"><div><strong>支付有效期演示</strong><span>触发 30 分钟超时后，支付意图关闭并释放库存预占。</span></div><button data-action="simulate-payment-timeout" data-order-id="${order.id}">演示超时</button></div>` : ""}
            ${order.latePaymentRefund ? `<div class="inline-alert ${order.latePaymentRefund.status === "MANUAL_REVIEW" ? "is-error" : order.latePaymentRefund.status === "COMPLETED" ? "is-success" : "is-warning"}"><strong>迟到支付退款</strong><span>${order.latePaymentRefund.status === "MANUAL_REVIEW" ? "自动退款失败，已转人工财务异常。" : order.latePaymentRefund.status === "COMPLETED" ? "已原路退款，订单未恢复履约。" : "自动退款处理中，订单保持关闭。"}</span></div>` : ""}
          </div>
        </div>
        <div class="detail-actionbar">${order.displayStatus === "待付款" ? `<button class="secondary-button" data-action="cancel-order" data-order-id="${order.id}">取消订单</button><button class="primary-button is-coral" data-action="retry-payment" data-order-id="${order.id}">继续支付</button>` : order.displayStatus === "运输中" ? `<button class="secondary-button" data-action="open-logistics" data-order-id="${order.id}">查看物流</button><button class="primary-button" data-confirm-order="${order.id}">确认收货</button>` : order.displayStatus === "已完成" ? `<button class="secondary-button" data-action="apply-aftersale" data-order-id="${order.id}" data-item-id="${order.items[0].id}">申请售后</button><button class="primary-button" data-open-product="${order.items[0].productId}">再次购买</button>` : `<button class="primary-button" data-screen="orders">返回订单列表</button>`}</div>
      </section>`;
  }

  function renderPaymentResult() {
    const result = state.paymentResult || { outcome: "cancelled", orderId: state.currentOrderId, message: "支付已取消，订单仍为待付款" };
    const order = state.orders.find(item => item.id === result.orderId) || currentOrder();
    const config = {
      success: { icon: "✓", title: "支付成功", copy: "订单已进入待发货，支付成功不会重复扣减库存。", tone: "is-success" },
      failed: { icon: "!", title: "支付失败", copy: "本次支付没有完成，待付款订单和库存预占仍保留。", tone: "is-error" },
      cancelled: { icon: "×", title: "支付已取消", copy: "订单已保留，可在有效期内重新发起支付。", tone: "is-warning" },
      later: { icon: "◴", title: "订单待付款", copy: "您选择了稍后支付，订单已保存到待付款列表。", tone: "is-warning" },
      timeout: { icon: "◴", title: "订单支付超时", copy: "支付意图已关闭，库存预占已释放；本单不能恢复支付。", tone: "is-warning" },
      late_refund: { icon: "↺", title: "迟到支付退款中", copy: "订单超时后收到支付成功回调，系统不会恢复履约并已自动原路退款。", tone: "is-warning" },
      late_refund_success: { icon: "✓", title: "迟到支付已退款", copy: "款项已原路退回，订单保持关闭且不会恢复库存预占、履约或佣金。", tone: "is-success" },
      late_refund_failed: { icon: "!", title: "自动退款失败", copy: "退款额度与支付事实已保留，当前已转入人工财务异常队列。", tone: "is-error" }
    }[result.outcome];
    const retryable = ["failed", "cancelled", "later"].includes(result.outcome) && order.displayStatus === "待付款";
    return `
      <section class="app-screen result-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("支付结果")}
          <div class="result-panel ${config.tone}"><span class="result-icon">${config.icon}</span><h2>${config.title}</h2><p>${config.copy}</p><strong>${money(order.total)}</strong><small>订单 ${order.id}</small></div>
          <div class="result-actions">${retryable ? `<button class="primary-button is-coral" data-action="retry-payment" data-order-id="${order.id}">重新支付</button>` : ""}${result.outcome === "timeout" ? `<button class="primary-button" data-action="simulate-late-payment" data-order-id="${order.id}">演示迟到支付成功</button>` : ""}${result.outcome === "late_refund" ? `<button class="primary-button" data-action="complete-late-refund" data-order-id="${order.id}">演示退款成功</button><button class="secondary-button" data-action="fail-late-refund" data-order-id="${order.id}">演示退款失败</button>` : ""}<button class="secondary-button" data-open-order="${order.id}">查看订单详情</button><button class="text-command" data-screen="home">返回首页</button></div>
        </div>
      </section>`;
  }

  function renderLogistics() {
    const order = currentOrder();
    const shipment = order.shipment || { carrier: "暂无承运商", trackingNo: "待总部录入", shippedAt: "", eta: "商品尚未发出" };
    return `
      <section class="app-screen detail-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("物流详情")}
          <section class="logistics-summary"><span>运输中</span><strong>${shipment.eta}</strong><div><p>${shipment.carrier}</p><p>${shipment.trackingNo}</p><button data-action="copy-tracking">复制</button></div></section>
          <section class="logistics-product">${renderOrderItems(order)}</section>
          <section class="timeline-card logistics-timeline"><ol><li class="is-done"><strong>快件已到达杭州西湖集散点</strong><span>08-06 08:26 · 杭州市</span></li><li class="is-done"><strong>运输途中</strong><span>08-05 21:42 · 嘉兴市</span></li><li class="is-done"><strong>顺丰已揽收</strong><span>${shipment.shippedAt || "08-04 16:20"} · 深圳市</span></li><li class="is-done"><strong>商家已发货</strong><span>${shipment.shippedAt || "08-04 16:20"}</span></li></ol></section>
        </div>
      </section>`;
  }

  function aftersaleContext() {
    const order = state.orders.find(item => item.id === state.afterSaleOrderId) || state.orders.find(item => item.orderStatus === "COMPLETED") || state.orders[0];
    const item = order.items.find(line => line.id === state.afterSaleItemId) || order.items[0];
    return { order, item, product: productById(item.productId), availableQty: Math.max(0, item.quantity - item.refundedQty - item.reservedQty) };
  }

  function availableAfterSaleTypes(order) {
    return ["SHIPPED", "IN_TRANSIT", "DELIVERED"].includes(order.fulfillmentStatus) ? ["仅退款", "退货退款"] : ["仅退款"];
  }

  function renderAfterSale() {
    const { order, item, product, availableQty } = aftersaleContext();
    const allowedTypes = availableAfterSaleTypes(order);
    if (!allowedTypes.includes(state.afterSaleType)) state.afterSaleType = allowedTypes[0];
    const amount = item.unitPrice * state.afterSaleQty;
    return `
      <section class="app-screen sale-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("申请退款")}
          <div class="form-content">
            <article class="sale-product">${imageMedia(product, "sale-thumb")}<div><h3>${product.name}</h3><p>${item.skuName} × ${item.quantity}</p><small>订单 ${order.id}</small></div></article>
            <div class="inline-alert"><strong>提交即占用可退额度</strong><span>当前可申请 ${availableQty} 件；待处理数量不会重复退款或进入待发货商品。</span></div>
            <section class="form-card"><button class="form-row" data-action="sale-type"><span>售后类型</span><strong>${state.afterSaleType}</strong><span>›</span></button><button class="form-row" data-action="sale-reason"><span>退款原因</span><strong>${state.afterSaleReason}</strong><span>›</span></button><div class="form-row"><span>退款数量</span><div class="quantity-stepper"><button data-aftersale-delta="-1">−</button><span>${state.afterSaleQty}</span><button data-aftersale-delta="1">＋</button></div><span></span></div><div class="form-row"><span>退款金额</span><strong class="price">${money(amount)}</strong><span></span></div></section>
            <section class="form-card"><div class="textarea-wrap"><label for="aftersaleDescription">问题描述</label><textarea id="aftersaleDescription" placeholder="请描述遇到的问题，便于商家更快处理">${state.afterSaleDescription}</textarea></div><div class="textarea-wrap" style="border-top:1px solid var(--line)"><label>上传凭证（选填，最多 3 张）</label><button class="upload-box" data-action="upload" ${state.afterSaleEvidenceCount >= 3 ? "disabled" : ""}><i>＋</i><span>${state.afterSaleEvidenceCount ? `已添加 ${state.afterSaleEvidenceCount} 张` : "添加图片"}</span></button></div></section>
          </div>
        </div>
        <div class="form-submit"><button class="primary-button is-coral" data-action="submit-aftersale" ${availableQty < 1 || state.submittingAftersale ? "disabled" : ""}>${state.submittingAftersale ? "提交中，请勿重复操作" : `提交申请 · 占用 ${state.afterSaleQty} 件`}</button></div>
      </section>`;
  }

  function aftersaleStatusCopy(status) {
    return ({ PENDING_REVIEW: ["待商家审核", "商家将在 24 小时内处理"], WAITING_RETURN: ["等待寄回商品", "请填写退货承运商和运单号"], REFUNDING: ["退款处理中", "退款结果将由支付渠道返回"], REFUND_FAILED: ["退款失败", "已保留退款额度，可重新发起"], COMPLETED: ["退款完成", "退款已原路退回"], CANCELLED: ["申请已取消", "可退数量和金额已释放"] })[status] || [status, "状态已更新"];
  }

  function renderAfterSaleDetail() {
    const aftersale = state.aftersales.find(item => item.id === state.currentAfterSaleId) || state.aftersales[0];
    if (!aftersale) return `<section class="app-screen detail-page">${statusBar()}${header("售后详情")}<div class="empty-state"><i>↺</i><strong>暂无售后记录</strong><p>提交售后申请后可在这里查看进度。</p><button class="primary-button" data-screen="orders" style="padding:0 18px">查看订单</button></div></section>`;
    const order = state.orders.find(item => item.id === aftersale.orderId);
    const orderItem = order.items.find(item => item.id === aftersale.orderItemId);
    const product = productById(orderItem.productId);
    const [title, copy] = aftersaleStatusCopy(aftersale.status);
    const cancellable = aftersale.status === "PENDING_REVIEW" || (aftersale.status === "WAITING_RETURN" && !aftersale.trackingNo);
    return `
      <section class="app-screen detail-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("售后详情")}
          <section class="status-hero ${aftersale.status === "REFUND_FAILED" ? "is-error" : ""}"><span>${title}</span><strong>${copy}</strong></section>
          <div class="detail-stack">
            <article class="sale-product detail-card">${imageMedia(product, "sale-thumb")}<div><h3>${product.name}</h3><p>${orderItem.skuName} × ${aftersale.quantity}</p><small>售后单 ${aftersale.id}</small></div></article>
            <section class="detail-card reservation-card"><div><span>已占用可退数量</span><strong>${aftersale.status === "CANCELLED" ? 0 : aftersale.quantity} 件</strong></div><div><span>已占用可退金额</span><strong>${aftersale.status === "CANCELLED" ? money(0) : money(aftersale.reservedAmount)}</strong></div><small>${aftersale.status === "REFUND_FAILED" ? "退款失败仍保留占用，避免重复申请；重试成功或取消后再释放。" : "驳回或允许阶段取消后，将自动释放对应数量和金额。"}</small></section>
            ${aftersale.failureReason ? `<div class="inline-alert is-error"><strong>失败原因</strong><span>${aftersale.failureReason}</span></div>` : ""}
            ${aftersale.status === "WAITING_RETURN" ? `<section class="detail-card return-address-card"><div class="card-title"><strong>总部退货地址</strong><span>审核通过后生成</span></div><p>青序售后仓 · 0755-****-8261</p><small>广东省深圳市龙岗区平湖街道供应链园 3 号仓<br />请勿到付，寄出前核对售后单号。</small></section>` : ""}
            ${aftersale.status === "WAITING_RETURN" && !aftersale.trackingNo ? `<section class="detail-card return-form"><strong>填写退货物流</strong><label>承运商<input id="returnCarrier" value="顺丰速运" /></label><label>退货单号<input id="returnTracking" value="SFRET20260811" /></label><button class="primary-button" data-action="submit-return-tracking">提交物流</button></section>` : ""}
            <section class="detail-card timeline-card"><div class="card-title"><strong>处理时间线</strong></div><ol><li class="is-done"><strong>售后申请已提交</strong><span>${aftersale.createdAt}</span></li><li class="${aftersale.status !== "PENDING_REVIEW" ? "is-done" : ""}"><strong>商家审核</strong><span>${aftersale.status === "PENDING_REVIEW" ? "等待处理" : "审核通过"}</span></li><li class="${["REFUNDING", "REFUND_FAILED", "COMPLETED"].includes(aftersale.status) ? "is-done" : ""}"><strong>退款处理</strong><span>${aftersale.status === "REFUND_FAILED" ? "渠道返回失败，可重试" : aftersale.status === "COMPLETED" ? "退款成功" : "等待发起"}</span></li></ol></section>
          </div>
        </div>
        <div class="detail-actionbar">${cancellable ? `<button class="secondary-button" data-action="cancel-aftersale">取消申请</button>` : ""}${aftersale.status === "PENDING_REVIEW" ? `<button class="primary-button" data-action="simulate-aftersale-review">演示审核通过</button>` : ""}${aftersale.status === "REFUND_FAILED" ? `<button class="primary-button is-coral" data-action="retry-refund">重新退款</button>` : ""}<button class="secondary-button" data-open-order="${aftersale.orderId}">查看订单</button></div>
      </section>`;
  }

  function renderProfile() {
    const agent = state.serviceAgent;
    const agentCard = state.agentBindingStatus === "bound" ? `
      <button class="service-agent-card" data-screen="service-agent"><span class="service-agent-card__mark">清</span><span class="service-agent-card__copy"><small>我的服务代理</small><strong>${agent.name}</strong><em>已绑定 · ${agent.city}</em></span><span class="service-agent-card__arrow">›</span></button>` : `
      <button class="service-agent-card is-unbound" data-screen="service-agent"><span class="service-agent-card__mark">青</span><span class="service-agent-card__copy"><small>服务代理</small><strong>暂未绑定</strong><em>${state.inviteCandidate ? "登录后确认候选服务关系" : "从有效邀请入口登录后确认"}</em></span><span class="service-agent-card__arrow">›</span></button>`;
    const pendingCount = state.orders.filter(order => order.displayStatus === "待付款").length;
    return `
      <section class="app-screen with-tabbar profile-page">
        <div class="screen-scroll">
          <div class="profile-hero">${statusBar(true)}<div class="profile-tools"><button class="icon-button" data-action="message" aria-label="消息">◦</button><button class="icon-button" data-screen="account" aria-label="设置">⚙</button></div><div class="profile-user"><div class="avatar">青</div><div><h2>林青</h2><p>微信用户 · ${state.verifiedPhone ? `手机号已验证 ${state.verifiedPhone.phoneTail}` : "手机号未授权"}</p></div></div></div>
          <div class="profile-body">
            ${agentCard}
            <section class="profile-card"><div class="profile-card__head"><strong>我的订单</strong><button data-screen="orders">全部订单 ›</button></div><div class="order-shortcuts"><button data-order-shortcut="待付款">${pendingCount ? `<span class="notice-dot">${pendingCount}</span>` : ""}<i>◴</i><span>待付款</span></button><button data-order-shortcut="待发货"><i>▣</i><span>待发货</span></button><button data-order-shortcut="待收货"><i>♧</i><span>待收货</span></button><button data-order-shortcut="已完成"><i>✓</i><span>已完成</span></button><button data-action="open-latest-aftersale"><i>↺</i><span>退款/售后</span></button></div></section>
            <section class="profile-card"><div class="profile-card__head"><strong>常用功能</strong></div><div class="benefit-row"><button data-screen="favorites"><strong>${state.favoriteProductIds.length}</strong><span>商品收藏</span></button><button data-screen="addresses"><strong>${state.addresses.length}</strong><span>收货地址</span></button><button data-action="service"><strong>◉</strong><span>联系商家</span></button></div></section>
            <section class="profile-card menu-list"><button class="menu-item" data-screen="account"><i>○</i><span>账户与隐私</span><span>›</span></button><button class="menu-item" data-screen="addresses"><i>⌖</i><span>收货地址</span><span>›</span></button><button class="menu-item" data-action="service"><i>◉</i><span>联系商家</span><span>›</span></button><button class="menu-item" data-action="quality"><i>◇</i><span>正品与服务保障</span><span>›</span></button><button class="menu-item" data-screen="system-states"><i>!</i><span>异常状态样例</span><span>›</span></button></section>
          </div>
        </div>
        ${tabbar("profile")}
      </section>`;
  }

  function candidateRemaining() {
    if (!state.inviteCandidate) return "";
    const seconds = Math.max(0, Math.floor((state.inviteCandidate.expiresAt - Date.now()) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderServiceAgent() {
    const agent = state.serviceAgent;
    const isBound = state.agentBindingStatus === "bound";
    return `
      <section class="app-screen service-agent-page">
        <div class="screen-scroll">${statusBar()}${header("服务代理")}<div class="service-agent-body">
          ${isBound ? `<article class="service-agent-identity"><span class="service-agent-identity__mark">清</span><div><small>CURRENT SERVICE AGENT</small><h3>${agent.name}</h3><p>${agent.contact} · ${agent.city}</p></div><span class="binding-badge">已绑定</span></article><section class="agent-fact-card"><div><span>绑定时间</span><strong>${agent.boundAt}</strong></div><div><span>服务联系</span><strong>${agent.phone}</strong></div><div><span>服务编号</span><strong>${agent.id}</strong></div></section>` : `<article class="service-agent-empty"><span>青</span><h3>暂未绑定服务代理</h3><p>${state.inviteCandidate ? `候选代理 ${state.inviteCandidate.agent.name}，剩余 ${candidateRemaining()}。完成登录后可确认或拒绝。` : "从有效分享链接或邀请二维码进入，登录后将显示绑定确认。"}</p>${state.inviteCandidate && !state.loggedIn ? `<button class="primary-button" data-screen="login">登录并确认</button>` : state.inviteCandidate ? `<button class="primary-button" data-action="open-binding">查看绑定确认</button>` : ""}</article>`}
          <section class="agent-policy-card"><div class="agent-policy-card__head"><span>◇</span><div><strong>商城服务保障</strong><small>归属关系不改变您的购物权益</small></div></div><ul><li>商品价格、支付与发货由青序生活统一提供</li><li>退款与售后仍由平台客服统一受理</li><li>绑定后不可自助更换，异常情况请联系客服</li></ul></section>
          <section class="agent-help-card"><div><strong>需要帮助？</strong><p>对服务归属有疑问，平台客服会核实处理。</p></div><button class="secondary-button" data-action="service">联系平台客服</button></section>
        </div></div>
      </section>`;
  }

  function renderLogin() {
    const source = state.inviteCandidate ? `<div class="login-source"><span class="service-agent-card__mark">清</span><div><small>待确认服务代理 · 候选剩余 ${candidateRemaining()}</small><strong>${state.inviteCandidate.agent.name}</strong><p>登录后仍需由您明确确认，不会自动绑定。</p></div></div>` : "";
    return `
      <section class="app-screen auth-page">
        <div class="screen-scroll">${statusBar()}${header("微信登录")}<div class="auth-body"><div class="auth-brand"><span>青</span><h1>欢迎来到青序生活</h1><p>登录后可继续支付、订单、地址、收藏与售后操作。</p></div>${source}<button class="wechat-login" data-action="mock-login"><span>⌁</span>微信授权登录</button><button class="consent-row ${state.consentAccepted ? "is-checked" : ""}" data-action="toggle-consent"><i>✓</i><span>我已阅读并同意《用户协议》和《隐私政策》</span></button><div class="inline-alert"><strong>手机号不是登录必选项</strong><span>登录后可在账户与隐私中自愿授权微信手机号；不会从收货地址提取账户手机号。</span></div></div></div>
      </section>`;
  }

  function renderAddresses() {
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header(state.addressReturnScreen ? "选择收货地址" : "收货地址")}<div class="address-list">${state.addresses.map(address => `<article class="saved-address ${address.id === state.currentAddressId ? "is-selected" : ""}"><button class="saved-address__main" data-address-select="${address.id}"><strong>${maskRecipient(address.recipient)} <span>${maskPhone(address.phone)}</span></strong><p>${address.region} ${maskAddressDetail(address.detail)}</p><small>${address.isDefault ? "默认地址" : ""}</small></button><div class="saved-address__actions"><button data-address-default="${address.id}" ${address.isDefault ? "disabled" : ""}>设为默认</button><button data-address-edit="${address.id}">编辑</button><button data-address-delete="${address.id}">删除</button></div></article>`).join("") || `<div class="empty-state"><i>⌖</i><strong>暂无收货地址</strong><p>新增地址后即可提交订单。</p></div>`}</div></div><div class="form-submit"><button class="primary-button" data-action="new-address">＋ 新增收货地址</button></div></section>`;
  }

  function renderAddressEdit() {
    const editing = state.addresses.find(item => item.id === state.editingAddressId);
    const address = editing || { recipient: "", phone: "", region: "", detail: "", isDefault: !state.addresses.length };
    return `
      <section class="app-screen form-page"><div class="screen-scroll">${statusBar()}${header(editing ? "编辑地址" : "新增地址")}<form class="address-form" id="addressForm"><label><span>收货人</span><input name="recipient" value="${address.recipient}" placeholder="请输入姓名" required /></label><label><span>手机号</span><input name="phone" value="${address.phone}" inputmode="numeric" maxlength="11" placeholder="11 位手机号" required /></label><label><span>省市区</span><input name="region" value="${address.region}" placeholder="省 市 区" required /></label><label class="is-textarea"><span>详细地址</span><textarea name="detail" placeholder="街道、楼栋和门牌号" required>${address.detail}</textarea></label><button type="button" class="switch-row ${address.isDefault ? "is-on" : ""}" data-action="toggle-address-default"><span><strong>设为默认地址</strong><small>保存后其他地址将取消默认</small></span><i></i></button><button class="primary-button" type="submit">保存地址</button></form></div></section>`;
  }

  function renderFavorites() {
    const favoriteProducts = state.favoriteProductIds.map(productById);
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("商品收藏")}<div class="favorite-list">${favoriteProducts.length ? favoriteProducts.map(product => `<article class="favorite-item">${imageMedia(product, "favorite-thumb")}<button class="favorite-copy" data-open-product="${product.id}"><span class="product-brand">${product.brand}</span><strong>${product.name}</strong><p>${product.skus[0].name}</p><em>${money(product.skus[0].price)}</em></button><button class="favorite-remove" data-remove-favorite="${product.id}" aria-label="取消收藏">♡</button></article>`).join("") : `<div class="empty-state"><i>♡</i><strong>还没有收藏商品</strong><p>在商品详情点击收藏，方便下次找到。</p><button class="primary-button" data-screen="home" style="padding:0 18px">去逛逛</button></div>`}</div></div></section>`;
  }

  function renderAccount() {
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("账户与隐私")}<div class="account-stack"><section class="detail-card account-user"><div class="avatar">青</div><div><strong>林青</strong><p>微信账户 · CUSTOMER</p></div></section><section class="detail-card privacy-card account-link-card"><div class="card-title"><strong>账户资料</strong></div><button data-screen="phone-authorization">账户手机号 <span>${state.verifiedPhone ? `已验证 ${state.verifiedPhone.phoneTail}` : "未授权"} ›</span></button></section><section class="detail-card privacy-card"><div class="card-title"><strong>隐私权利</strong></div><button data-action="privacy-policy">查看隐私政策 <span>›</span></button><button data-screen="account-deletion">申请删除账号 <span>›</span></button></section>${state.deletionRequested ? `<div class="inline-alert is-success"><strong>删除申请已提交</strong><span>可进入账号删除页面查看处理说明。</span></div>` : ""}</div></div></section>`;
  }

  function renderPhoneAuthorization() {
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("手机号授权")}<div class="account-stack"><section class="detail-card account-phone"><div class="card-title"><strong>账户手机号</strong><span>独立于收货地址</span></div>${state.verifiedPhone ? `<div class="verified-phone"><span>${state.verifiedPhone.full}</span><strong>已验证</strong></div><p>来源：微信手机号授权<br />验证时间：${state.verifiedPhone.verifiedAt}<br />协议版本：${state.verifiedPhone.consentVersion}</p><button class="secondary-button" data-action="authorize-phone">重新授权</button>` : `<div class="unverified-phone"><strong>未授权</strong><p>手机号为可选资料；不会从收货地址读取。代理端在未授权时显示“未绑定”。</p><button class="primary-button" data-action="authorize-phone">自愿授权微信手机号</button></div>`}</section><div class="inline-alert"><strong>用途与快照</strong><span>支付时仅保存当时账户手机号尾号；后续授权不会追溯补写历史订单。</span></div></div></div></section>`;
  }

  function renderAccountDeletion() {
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("账号删除申请")}<div class="account-stack"><section class="detail-card"><div class="card-title"><strong>删除资格</strong><span>${state.deletionEligible ? "当前可申请" : "暂不可申请"}</span></div><div class="reservation-card"><div><span>未完成订单或售后</span><strong>${state.deletionEligible ? "0 项" : "存在待处理业务"}</strong></div><small>${state.deletionEligible ? "资格检查已通过，可提交删除申请。" : "需先完成或取消待付款、待发货、运输中订单及未结束售后。"}</small></div></section><section class="detail-card"><div class="card-title"><strong>提交后的影响</strong></div><div class="policy-copy"><p>撤销全部会话并停止登录。</p><p>结束当前代理绑定并去标识化个人资料。</p><p>交易与审计记录按外部合规配置保留。</p></div></section>${state.deletionRequested ? `<div class="inline-alert is-success"><strong>删除申请已提交</strong><span>系统将按合规流程处理，当前原型不执行真实删除。</span></div>` : `<button class="primary-button is-coral" data-action="request-deletion">申请删除账号</button>`}</div></div></section>`;
  }

  function renderSystemStates() {
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("异常状态样例")}<div class="state-gallery"><article class="state-sample"><span class="spinner"></span><div><strong>加载中</strong><p>正在同步订单与售后状态，不改变当前页面结构。</p></div></article><article class="state-sample is-error"><span>!</span><div><strong>网络开小差</strong><p>已保留筛选和表单内容，可稍后重试。</p><button data-action="recover-ui">${state.uiRecovered ? "已恢复" : "重新加载"}</button></div></article><article class="state-sample is-forbidden"><span>403</span><div><strong>无权访问</strong><p>当前账户不能查看该资源，已阻止数据泄露。</p></div></article><article class="state-sample is-conflict"><span>409</span><div><strong>数据已更新</strong><p>价格或库存发生变化，请刷新后重新确认。</p><button data-action="refresh-conflict">刷新商品</button></div></article><article class="state-sample is-success"><span>✓</span><div><strong>操作成功</strong><p>保存完成，重复提交不会产生第二条记录。</p></div></article><article class="state-sample is-warning"><span>↺</span><div><strong>迟到支付自动退款</strong><p>订单超时后不会恢复履约或佣金，支付成功回调进入原路退款；失败则转人工财务异常。</p></div></article></div></div></section>`;
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
    "service-agent": renderServiceAgent,
    login: renderLogin,
    "payment-result": renderPaymentResult,
    "order-detail": renderOrderDetail,
    logistics: renderLogistics,
    "aftersale-detail": renderAfterSaleDetail,
    addresses: renderAddresses,
    "address-edit": renderAddressEdit,
    favorites: renderFavorites,
    account: renderAccount,
    "phone-authorization": renderPhoneAuthorization,
    "account-deletion": renderAccountDeletion,
    "system-states": renderSystemStates
  };

  const protectedScreens = new Set(["checkout", "orders", "order-detail", "logistics", "aftersale", "aftersale-detail", "profile", "service-agent", "addresses", "address-edit", "favorites", "account", "phone-authorization", "account-deletion"]);

  function render() {
    app.innerHTML = renderers[state.screen]();
    document.querySelectorAll(".screen-nav__item").forEach(item => item.classList.toggle("is-active", item.dataset.screen === state.screen));
    const meta = screenMeta[state.screen] || screenMeta.home;
    document.querySelector("#canvasTitle").textContent = meta.canvasTitle;
    document.querySelector("#inspectorTitle").textContent = meta.title;
    document.querySelector("#inspectorDescription").textContent = meta.description;
    document.querySelector("#interactionList").innerHTML = meta.interactions.map(item => `<li>${item}</li>`).join("");
  }

  function navigate(screen, push = true) {
    if (!renderers[screen]) return;
    if (!state.loggedIn && protectedScreens.has(screen)) {
      state.authReturn = { screen, action: null };
      screen = "login";
    }
    if (!bottomSheet.hidden || !sheetBackdrop.hidden) closeSheet();
    if (push && state.screen !== screen) state.history.push(state.screen);
    state.screen = screen;
    render();
  }

  function requireLogin(returnScreen, action) {
    state.authReturn = { screen: returnScreen, action };
    navigate("login");
    showToast("请先登录后继续");
    return true;
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
    clearTimeout(sheetCloseTimer);
    bottomSheet.innerHTML = content;
    bottomSheet.hidden = false;
    sheetBackdrop.hidden = false;
    requestAnimationFrame(() => {
      bottomSheet.classList.add("is-visible");
      sheetBackdrop.classList.add("is-visible");
    });
  }

  function closeSheet() {
    clearTimeout(sheetCloseTimer);
    bottomSheet.classList.remove("is-visible");
    sheetBackdrop.classList.remove("is-visible");
    sheetCloseTimer = setTimeout(() => {
      bottomSheet.hidden = true;
      sheetBackdrop.hidden = true;
      bottomSheet.innerHTML = "";
    }, 190);
  }

  function skuSheet() {
    const product = state.product;
    const selectedSku = currentProductSku();
    return `
      <div class="sheet-handle"></div><div class="sheet-head">${imageMedia(product, "sheet-thumb product-card__media")}<div><span class="product-brand">${product.brand}</span><h3>${product.name}</h3><span class="price"><small>¥</small>${selectedSku.price}</span></div><button class="sheet-close" data-action="close-sheet" aria-label="关闭">×</button></div>
      <div class="sheet-section"><div class="sheet-section__head"><span>选择规格</span><span>库存 ${selectedSku.stock} 件</span></div><div class="option-row">${publicSkusFor(product).map(sku => `<button class="option-button ${state.selectedSkuId === sku.id ? "is-active" : ""}" data-sku-id="${sku.id}">${sku.name}<small>${money(sku.price)}</small></button>`).join("")}</div></div>
      <div class="sheet-section"><div class="sheet-section__head"><span>购买数量</span><div class="quantity-stepper"><button data-sku-delta="-1">−</button><span>${state.quantity}</span><button data-sku-delta="1">＋</button></div></div></div>
      <div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button ${state.skuIntent === "buy" ? "is-coral" : ""}" data-action="confirm-sku">${state.skuIntent === "buy" ? "确认并结算" : "确认加入购物车"}</button></div>`;
  }

  function paymentSheet(order) {
    return `
      <div class="sheet-handle"></div><div class="payment-sheet"><div class="pay-icon">¥</div><h3>微信支付</h3><p>订单 ${order.id} 已创建，支付前库存保留至 ${order.payExpiresAt}</p><div class="payment-amount"><small>¥</small>${Number(order.total).toFixed(2)}</div><div class="payment-note">Mock 环境可演示成功、失败、取消和稍后支付。无论选择哪一项，待付款订单都已保存。</div><div class="payment-outcomes"><button class="secondary-button" data-payment-outcome="later">稍后支付</button><button class="secondary-button" data-payment-outcome="cancelled">模拟取消</button><button class="secondary-button" data-payment-outcome="failed">模拟失败</button><button class="primary-button" data-payment-outcome="success">模拟成功</button></div></div>`;
  }

  function aftersaleTypeSheet() {
    const { order } = aftersaleContext();
    const allowed = availableAfterSaleTypes(order);
    return `<div class="sheet-handle"></div><div class="confirm-sheet option-sheet"><h3>选择售后类型</h3><p>${allowed.length === 1 ? "订单尚未发货，当前仅支持仅退款。" : "已发货订单可选择仅退款或退货退款。"}</p><div class="option-row">${["仅退款", "退货退款"].map(type => `<button class="option-button ${state.afterSaleType === type ? "is-active" : ""}" data-aftersale-type-option="${type}" ${allowed.includes(type) ? "" : "disabled"}>${type}<small>${type === "仅退款" ? "无需寄回商品" : "审核后寄回总部"}</small></button>`).join("")}</div><div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button></div></div>`;
  }

  function aftersaleReasonSheet() {
    const reasons = ["商品不符合预期", "拍错规格或重复下单", "包装破损", "商品质量问题", "物流长期未更新"];
    return `<div class="sheet-handle"></div><div class="confirm-sheet option-sheet"><h3>选择退款原因</h3><div class="option-row">${reasons.map(reason => `<button class="option-button ${state.afterSaleReason === reason ? "is-active" : ""}" data-aftersale-reason-option="${reason}">${reason}</button>`).join("")}</div><div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button></div></div>`;
  }

  function agentBindingSheet() {
    const agent = state.inviteCandidate?.agent || state.serviceAgent;
    return `
      <div class="sheet-handle"></div><div class="binding-sheet"><span class="binding-sheet__mark">清</span><small>SERVICE INVITATION · 候选剩余 ${candidateRemaining()}</small><h3>确认服务代理</h3><p>您正在通过 <strong>${agent.name}</strong> 的邀请进入青序生活。确认后，该服务代理将为您提供选购咨询服务。</p><div class="binding-assurance"><span>✓</span><div><strong>购物权益不受影响</strong><small>商品价格、支付、发货与售后均由青序生活统一保障。</small></div></div><div class="binding-warning">候选仅保留 30 分钟；绑定后不可自行更换，如归属异常可联系平台客服。</div><div class="sheet-footer"><button class="secondary-button" data-action="decline-agent-binding">拒绝并清除</button><button class="primary-button" data-action="confirm-agent-binding">确认绑定</button></div></div>`;
  }

  function phoneSheet() {
    return `<div class="sheet-handle"></div><div class="confirm-sheet"><span class="confirm-sheet__icon">○</span><h3>授权账户手机号</h3><p>微信将返回已验证手机号 <strong>138 5218 5218</strong>。该手机号独立于收货地址，可随时在隐私权利中处理。</p><div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">暂不授权</button><button class="primary-button" data-action="confirm-phone">确认授权</button></div></div>`;
  }

  function confirmSheet(title, copy, confirmAction, confirmText = "确认") {
    return `<div class="sheet-handle"></div><div class="confirm-sheet"><span class="confirm-sheet__icon">!</span><h3>${title}</h3><p>${copy}</p><div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button is-coral" data-action="${confirmAction}">${confirmText}</button></div></div>`;
  }

  function handleSkuConfirm() {
    const sku = currentProductSku();
    const quantity = Math.min(state.quantity, sku.stock);
    if (state.skuIntent === "cart") {
      const existing = state.cart.find(item => item.skuId === sku.id);
      if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, sku.stock);
        existing.selected = true;
      } else {
        state.cart.push({ productId: state.product.id, skuId: sku.id, quantity, selected: true });
      }
      closeSheet();
      return showToast(`已加入购物车 · ${sku.name} × ${quantity}`);
    }
    state.checkoutMode = "buy";
    state.buyNowLine = { productId: state.product.id, skuId: sku.id, quantity, selected: true };
    closeSheet();
    setTimeout(() => navigate("checkout"), 190);
  }

  function createPendingOrder() {
    if (state.submittingOrder) return null;
    const lines = checkoutLines();
    const address = state.addresses.find(item => item.id === state.currentAddressId);
    if (!lines.length || !address) return null;
    state.submittingOrder = true;
    const order = {
      id: `QX20260811${String(100 + state.orders.length).padStart(4, "0")}`,
      displayStatus: "待付款",
      orderStatus: "PENDING_PAYMENT",
      paymentStatus: "PROCESSING",
      latestPaymentAttemptStatus: "PENDING",
      refundStatus: "NONE",
      fulfillmentStatus: "NOT_STARTED",
      closeReason: null,
      payExpiresAt: "2026-08-11 15:30",
      createdAt: "2026-08-11 15:00",
      addressSnapshot: clone(address),
      attributionCandidate: state.agentBindingStatus === "bound" ? "ACTIVE_AGENT" : "DIRECT",
      items: lines.map((line, index) => {
        const sku = lineSku(line);
        return { id: `OI-NEW-${state.orders.length}-${index}`, productId: line.productId, skuId: line.skuId, skuName: sku.name, unitPrice: sku.price, quantity: line.quantity, refundedQty: 0, reservedQty: 0 };
      }),
      total: lines.reduce((sum, line) => sum + lineSku(line).price * line.quantity, 0),
      inventoryReservation: { status: "ACTIVE", expiresAt: "2026-08-11 15:30" }
    };
    state.orders.unshift(order);
    if (state.checkoutMode === "cart") state.cart = state.cart.filter(item => !item.selected);
    state.buyNowLine = null;
    state.submittingOrder = false;
    state.activePaymentOrderId = order.id;
    state.currentOrderId = order.id;
    return order;
  }

  function handlePaymentOutcome(outcome) {
    const order = state.orders.find(item => item.id === state.activePaymentOrderId);
    if (!order) return showToast("未找到待支付订单");
    if (order.paymentStatus === "PAID") return showToast("订单已支付，请勿重复操作");
    const result = { outcome, orderId: order.id, message: "" };
    if (outcome === "success") {
      order.paymentStatus = "PAID";
      order.latestPaymentAttemptStatus = "SUCCEEDED";
      order.orderStatus = "PENDING_SHIPMENT";
      order.fulfillmentStatus = "READY_TO_SHIP";
      order.displayStatus = "待发货";
      order.paidAt = "2026-08-11 15:02";
      order.inventoryReservation.status = "CONSUMED";
      result.message = "支付成功，订单进入待发货";
    } else if (outcome === "failed") {
      order.paymentStatus = "UNPAID";
      order.latestPaymentAttemptStatus = "FAILED";
      result.message = "支付失败，订单仍可重试";
    } else if (outcome === "cancelled") {
      order.paymentStatus = "UNPAID";
      order.latestPaymentAttemptStatus = "CANCELLED";
      result.message = "支付已取消，订单仍为待付款";
    } else {
      order.paymentStatus = "UNPAID";
      order.latestPaymentAttemptStatus = "NOT_STARTED";
      result.message = "已选择稍后支付，订单保留在待付款";
    }
    state.paymentResult = result;
    state.currentOrderId = order.id;
    state.orderTab = "全部";
    closeSheet();
    setTimeout(() => navigate(outcome === "later" ? "order-detail" : "payment-result"), 190);
  }

  function simulatePaymentTimeout(orderId) {
    const order = state.orders.find(item => item.id === orderId);
    if (!order || order.orderStatus !== "PENDING_PAYMENT") return showToast("当前订单已不能触发支付超时");
    order.orderStatus = "CLOSED";
    order.paymentStatus = "UNPAID";
    order.latestPaymentAttemptStatus = "EXPIRED";
    order.fulfillmentStatus = "CANCELLED";
    order.displayStatus = "已关闭";
    order.closeReason = "PAYMENT_TIMEOUT";
    order.inventoryReservation.status = "RELEASED";
    order.closedAt = "2026-08-11 15:30";
    state.currentOrderId = order.id;
    state.paymentResult = { outcome: "timeout", orderId: order.id, message: "支付超时，库存预占已释放" };
    navigate("payment-result");
  }

  function simulateLatePayment(orderId) {
    const order = state.orders.find(item => item.id === orderId);
    if (!order || order.closeReason !== "PAYMENT_TIMEOUT") return showToast("仅支付超时订单可演示迟到回调");
    order.paymentStatus = "PAID";
    order.latestPaymentAttemptStatus = "SUCCEEDED_LATE";
    order.refundStatus = "REFUNDING";
    order.fulfillmentStatus = "CANCELLED";
    order.displayStatus = "退款售后";
    order.latePaymentRefund = { status: "PROCESSING", merchantRefundNo: `LATE-${order.id}`, createdAt: "2026-08-11 15:31" };
    state.currentOrderId = order.id;
    state.paymentResult = { outcome: "late_refund", orderId: order.id, message: "迟到支付已进入自动退款" };
    render();
  }

  function finishLateRefund(orderId, succeeded) {
    const order = state.orders.find(item => item.id === orderId);
    if (!order?.latePaymentRefund || order.latePaymentRefund.status !== "PROCESSING") return showToast("当前没有可处理的迟到退款");
    order.refundStatus = succeeded ? "FULL" : "FAILED";
    order.displayStatus = succeeded ? "退款完成" : "退款异常";
    order.latePaymentRefund.status = succeeded ? "COMPLETED" : "MANUAL_REVIEW";
    order.latePaymentRefund.updatedAt = "2026-08-11 15:32";
    state.paymentResult = { outcome: succeeded ? "late_refund_success" : "late_refund_failed", orderId: order.id, message: succeeded ? "迟到支付已原路退款" : "自动退款失败，已转人工" };
    render();
  }

  function openPayment(orderId) {
    const order = state.orders.find(item => item.id === orderId);
    if (!order || order.displayStatus !== "待付款") return showToast("当前订单不可支付");
    order.paymentStatus = "PROCESSING";
    order.latestPaymentAttemptStatus = "PENDING";
    state.activePaymentOrderId = order.id;
    state.currentOrderId = order.id;
    openSheet(paymentSheet(order));
  }

  function submitAftersale() {
    if (state.submittingAftersale) return showToast("售后申请提交中，请勿重复操作");
    const { order, item, availableQty } = aftersaleContext();
    if (availableQty < state.afterSaleQty || state.afterSaleQty < 1) return showToast("可退数量已变化，请刷新后重试");
    state.afterSaleDescription = document.querySelector("#aftersaleDescription")?.value.trim() || state.afterSaleDescription;
    state.submittingAftersale = true;
    render();
    setTimeout(() => {
      const latest = aftersaleContext();
      if (latest.availableQty < state.afterSaleQty) {
        state.submittingAftersale = false;
        render();
        return showToast("可退数量已变化，请刷新后重试");
      }
      const id = `AS20260811${String(20 + state.aftersales.length).padStart(4, "0")}`;
      latest.item.reservedQty += state.afterSaleQty;
      const record = { id, orderId: latest.order.id, orderItemId: latest.item.id, type: state.afterSaleType, reason: state.afterSaleReason, description: state.afterSaleDescription, evidenceCount: state.afterSaleEvidenceCount, quantity: state.afterSaleQty, reservedAmount: latest.item.unitPrice * state.afterSaleQty, status: "PENDING_REVIEW", trackingNo: "", createdAt: "2026-08-11 15:08", updatedAt: "2026-08-11 15:08" };
      state.aftersales.unshift(record);
      state.currentAfterSaleId = id;
      latest.order.refundStatus = "NONE";
      latest.order.displayStatus = "退款售后";
      state.submittingAftersale = false;
      navigate("aftersale-detail");
    }, 220);
  }

  function cancelAftersale() {
    const record = state.aftersales.find(item => item.id === state.currentAfterSaleId);
    if (!record) return;
    const order = state.orders.find(item => item.id === record.orderId);
    const item = order.items.find(line => line.id === record.orderItemId);
    const cancellable = record.status === "PENDING_REVIEW" || (record.status === "WAITING_RETURN" && !record.trackingNo);
    if (!cancellable) return showToast("当前状态不能取消申请");
    item.reservedQty = Math.max(0, item.reservedQty - record.quantity);
    record.status = "CANCELLED";
    record.updatedAt = "2026-08-11 15:12";
    if (!state.aftersales.some(entry => entry.orderId === order.id && entry.status !== "CANCELLED")) {
      order.refundStatus = "NONE";
      order.displayStatus = order.orderStatus === "COMPLETED" ? "已完成" : fulfillmentLabel(order.fulfillmentStatus);
    }
    closeSheet();
    render();
    showToast("售后已取消，可退数量和金额已释放");
  }

  function completeLogin() {
    if (!state.consentAccepted) return showToast("请先同意用户协议和隐私政策");
    state.loggedIn = true;
    const destination = state.authReturn?.screen || "profile";
    const pendingAction = state.authReturn?.action;
    state.authReturn = null;
    if (pendingAction?.type === "favorite") {
      const exists = state.favoriteProductIds.includes(pendingAction.productId);
      if (pendingAction.desired && !exists) state.favoriteProductIds.push(pendingAction.productId);
      if (!pendingAction.desired && exists) state.favoriteProductIds = state.favoriteProductIds.filter(id => id !== pendingAction.productId);
    }
    navigate(destination, false);
    showToast("登录成功，已返回原操作");
    if (state.inviteCandidate && state.inviteCandidate.expiresAt > Date.now() && state.agentBindingStatus !== "bound") {
      state.agentBindingStatus = "pending";
      setTimeout(() => openSheet(agentBindingSheet()), 220);
    }
  }

  document.addEventListener("click", event => {
    const target = event.target.closest("button, [data-screen], [data-action]");
    if (!target) return;

    if (target.dataset.screen) return navigate(target.dataset.screen);
    if (target.dataset.device) {
      state.device = Number(target.dataset.device);
      document.documentElement.style.setProperty("--device-width", `${state.device}px`);
      document.querySelectorAll("[data-device]").forEach(button => button.classList.toggle("is-active", Number(button.dataset.device) === state.device));
      document.querySelector("#deviceLabel").textContent = `${state.device} × 812`;
      return;
    }
    if (target.dataset.category) { state.selectedCategory = target.dataset.category; state.categoryBrand = "全部"; state.filter = "全部"; return navigate("category"); }
    if (target.dataset.categorySwitch) { state.selectedCategory = target.dataset.categorySwitch; state.categoryBrand = "全部"; state.filter = "全部"; return render(); }
    if (target.dataset.categoryBrand) { state.categoryBrand = target.dataset.categoryBrand; return render(); }
    if (target.dataset.filter) { state.filter = target.dataset.filter; render(); return showToast(`已按“${state.filter}”筛选`); }
    if (target.dataset.openProduct) {
      const product = publicProductById(target.dataset.openProduct);
      if (!product) return showToast("商品已下架或暂无可售规格");
      state.product = product;
      state.selectedSkuId = publicSkusFor(product)[0].id;
      state.quantity = 1;
      return navigate("product");
    }
    if (target.dataset.openOrder) { state.currentOrderId = target.dataset.openOrder; return navigate("order-detail"); }
    if (target.dataset.keyword) { state.searchQuery = target.dataset.keyword; state.searchPerformed = true; return render(); }
    if (target.dataset.sort) { state.searchSort = target.dataset.sort; return render(); }
    if (target.dataset.detailTab) { state.detailTab = target.dataset.detailTab; return render(); }
    if (target.dataset.skuIntent) { state.skuIntent = target.dataset.skuIntent; state.quantity = 1; return openSheet(skuSheet()); }
    if (target.dataset.skuId) { state.selectedSkuId = target.dataset.skuId; state.quantity = Math.min(state.quantity, currentProductSku().stock); bottomSheet.innerHTML = skuSheet(); return; }
    if (target.dataset.skuDelta) { state.quantity = Math.max(1, Math.min(currentProductSku().stock, state.quantity + Number(target.dataset.skuDelta))); bottomSheet.innerHTML = skuSheet(); return; }
    if (target.dataset.cartSelect !== undefined) { const item = state.cart[Number(target.dataset.cartSelect)]; if (item && !item.invalidReason) item.selected = !item.selected; return render(); }
    if (target.dataset.cartDelete !== undefined) { state.cart.splice(Number(target.dataset.cartDelete), 1); render(); return showToast("商品已从购物车删除"); }
    if (target.dataset.cartQty !== undefined) {
      const index = Number(target.dataset.cartQty);
      const item = state.cart[index];
      if (!item) return;
      const next = item.quantity + Number(target.dataset.delta);
      if (next < 1) { state.cart.splice(index, 1); showToast("商品已移出购物车"); } else item.quantity = Math.min(next, lineSku(item).stock);
      return render();
    }
    if (target.dataset.orderTab) { state.orderTab = target.dataset.orderTab; return render(); }
    if (target.dataset.orderShortcut) { state.orderTab = target.dataset.orderShortcut; return navigate("orders"); }
    if (target.dataset.confirmOrder) {
      const order = state.orders.find(item => item.id === target.dataset.confirmOrder);
      if (order) { order.orderStatus = "COMPLETED"; order.fulfillmentStatus = "DELIVERED"; order.displayStatus = "已完成"; order.completedAt = "2026-08-11 15:18"; }
      render();
      return showToast("已确认收货");
    }
    if (target.dataset.paymentOutcome) return handlePaymentOutcome(target.dataset.paymentOutcome);
    if (target.dataset.aftersaleTypeOption) { state.afterSaleType = target.dataset.aftersaleTypeOption; closeSheet(); setTimeout(render, 190); return; }
    if (target.dataset.aftersaleReasonOption) { state.afterSaleReason = target.dataset.aftersaleReasonOption; closeSheet(); setTimeout(render, 190); return; }
    if (target.dataset.aftersaleDelta) { const context = aftersaleContext(); state.afterSaleQty = Math.max(1, Math.min(context.availableQty, state.afterSaleQty + Number(target.dataset.aftersaleDelta))); return render(); }
    if (target.dataset.addressSelect) { state.currentAddressId = target.dataset.addressSelect; const returnScreen = state.addressReturnScreen; state.addressReturnScreen = null; if (returnScreen) { navigate(returnScreen); showToast("已切换收货地址"); } else render(); return; }
    if (target.dataset.addressEdit) { state.editingAddressId = target.dataset.addressEdit; return navigate("address-edit"); }
    if (target.dataset.addressDelete) { state.editingAddressId = target.dataset.addressDelete; return openSheet(confirmSheet("删除收货地址", "删除后不可恢复；若删除默认地址，将自动选择下一条地址为默认。", "confirm-delete-address", "确认删除")); }
    if (target.dataset.addressDefault) { state.addresses.forEach(item => { item.isDefault = item.id === target.dataset.addressDefault; }); state.currentAddressId = target.dataset.addressDefault; render(); return showToast("已设为默认地址"); }
    if (target.dataset.removeFavorite) { state.favoriteProductIds = state.favoriteProductIds.filter(id => id !== target.dataset.removeFavorite); render(); return showToast("已取消收藏"); }

    const action = target.dataset.action;
    if (!action) return;
    if (action === "back") return goBack();
    if (action === "close-sheet") return closeSheet();
    if (action === "open-sku") { state.skuIntent = "cart"; return openSheet(skuSheet()); }
    if (action === "confirm-sku") return handleSkuConfirm();
    if (action === "favorite") {
      const exists = state.favoriteProductIds.includes(state.product.id);
      if (!state.loggedIn) return requireLogin("product", { type: "favorite", productId: state.product.id, desired: !exists });
      state.favoriteProductIds = exists ? state.favoriteProductIds.filter(id => id !== state.product.id) : [...state.favoriteProductIds, state.product.id];
      render();
      return showToast(exists ? "已取消收藏" : "已收藏商品");
    }
    if (action === "select-all") { const validItems = state.cart.filter(item => !item.invalidReason); const shouldSelect = !validItems.every(item => item.selected); validItems.forEach(item => { item.selected = shouldSelect; }); return render(); }
    if (action === "checkout") { if (!state.cart.some(item => item.selected)) return showToast("请先选择要结算的商品"); state.checkoutMode = "cart"; return navigate("checkout"); }
    if (action === "submit-order") {
      if (!state.loggedIn) return requireLogin("checkout", null);
      const order = createPendingOrder();
      return order ? openSheet(paymentSheet(order)) : showToast("订单提交中，请勿重复操作");
    }
    if (action === "retry-payment") return openPayment(target.dataset.orderId);
    if (action === "simulate-payment-timeout") return simulatePaymentTimeout(target.dataset.orderId);
    if (action === "simulate-late-payment") return simulateLatePayment(target.dataset.orderId);
    if (action === "complete-late-refund") return finishLateRefund(target.dataset.orderId, true);
    if (action === "fail-late-refund") return finishLateRefund(target.dataset.orderId, false);
    if (action === "cancel-order") { state.currentOrderId = target.dataset.orderId; return openSheet(confirmSheet("取消待付款订单", "取消后关闭支付意图并释放库存预占；已关闭订单不可继续支付。", "confirm-cancel-order", "确认取消")); }
    if (action === "confirm-cancel-order") {
      const order = currentOrder();
      order.orderStatus = "CLOSED"; order.paymentStatus = "UNPAID"; order.latestPaymentAttemptStatus = "CANCELLED"; order.fulfillmentStatus = "NOT_STARTED"; order.displayStatus = "已关闭"; order.closeReason = "USER_CANCELLED"; order.inventoryReservation.status = "RELEASED";
      closeSheet(); render(); return showToast("订单已取消，库存预占已释放");
    }
    if (action === "open-logistics") { state.currentOrderId = target.dataset.orderId; return navigate("logistics"); }
    if (action === "apply-aftersale") { state.afterSaleOrderId = target.dataset.orderId; state.afterSaleItemId = target.dataset.itemId; state.afterSaleQty = 1; state.afterSaleType = "仅退款"; state.afterSaleReason = "商品不符合预期"; state.afterSaleDescription = ""; state.afterSaleEvidenceCount = 0; return navigate("aftersale"); }
    if (action === "open-order-aftersale") { const record = state.aftersales.find(item => item.orderId === target.dataset.orderId && item.status !== "CANCELLED"); if (!record) return showToast("未找到售后记录"); state.currentAfterSaleId = record.id; return navigate("aftersale-detail"); }
    if (action === "open-latest-aftersale") { if (!state.aftersales.length) return navigate("orders"); state.currentAfterSaleId = state.aftersales[0].id; return navigate("aftersale-detail"); }
    if (action === "submit-aftersale") return submitAftersale();
    if (action === "cancel-aftersale") return openSheet(confirmSheet("取消售后申请", "当前阶段允许取消。确认后立即释放已占用的可退数量和金额。", "confirm-cancel-aftersale", "确认取消"));
    if (action === "confirm-cancel-aftersale") return cancelAftersale();
    if (action === "simulate-aftersale-review") { const record = state.aftersales.find(item => item.id === state.currentAfterSaleId); record.status = record.type === "退货退款" ? "WAITING_RETURN" : "REFUNDING"; record.updatedAt = "2026-08-11 15:20"; const order = state.orders.find(item => item.id === record.orderId); if (record.status === "REFUNDING" && order) order.refundStatus = "REFUNDING"; render(); return showToast(record.status === "WAITING_RETURN" ? "审核通过，请按退货地址寄回" : "审核通过，退款处理中"); }
    if (action === "submit-return-tracking") { const carrier = document.querySelector("#returnCarrier")?.value.trim(); const trackingNo = document.querySelector("#returnTracking")?.value.trim(); if (!carrier || !trackingNo) return showToast("请完整填写承运商和退货单号"); const record = state.aftersales.find(item => item.id === state.currentAfterSaleId); const order = state.orders.find(item => item.id === record.orderId); record.returnCarrier = carrier; record.trackingNo = trackingNo; record.status = "REFUNDING"; record.updatedAt = "2026-08-11 15:24"; if (order) order.refundStatus = "REFUNDING"; render(); return showToast("退货物流已提交，取消入口已关闭"); }
    if (action === "retry-refund") { const record = state.aftersales.find(item => item.id === state.currentAfterSaleId); const order = state.orders.find(item => item.id === record.orderId); record.status = "REFUNDING"; record.failureReason = ""; record.updatedAt = "2026-08-11 15:28"; if (order) order.refundStatus = "REFUNDING"; render(); return showToast("已重新发起退款，占用额度继续保留"); }
    if (action === "toggle-consent") { state.consentAccepted = !state.consentAccepted; return render(); }
    if (action === "mock-login") return completeLogin();
    if (action === "open-binding") return openSheet(agentBindingSheet());
    if (action === "confirm-agent-binding") {
      if (!state.inviteCandidate || state.inviteCandidate.expiresAt <= Date.now()) { state.inviteCandidate = null; state.agentBindingStatus = "unbound"; closeSheet(); render(); return showToast("服务候选已过期，按直营继续"); }
      state.serviceAgent = { ...state.inviteCandidate.agent, boundAt: "2026-08-11 15:01" }; state.agentBindingStatus = "bound"; state.inviteCandidate = null; closeSheet(); render(); return showToast(`已绑定服务代理：${state.serviceAgent.name}`);
    }
    if (action === "decline-agent-binding") { state.agentBindingStatus = "unbound"; state.inviteCandidate = null; closeSheet(); render(); return showToast("已拒绝并清除服务候选"); }
    if (action === "choose-address") { state.addressReturnScreen = "checkout"; return navigate("addresses"); }
    if (action === "new-address") { state.editingAddressId = null; return navigate("address-edit"); }
    if (action === "toggle-address-default") { target.classList.toggle("is-on"); return; }
    if (action === "confirm-delete-address") {
      const deletingId = state.editingAddressId; const deleting = state.addresses.find(item => item.id === deletingId); state.addresses = state.addresses.filter(item => item.id !== deletingId);
      if (deleting?.isDefault && state.addresses[0]) state.addresses[0].isDefault = true;
      if (state.currentAddressId === deletingId) state.currentAddressId = state.addresses[0]?.id || null;
      closeSheet(); render(); return showToast("地址已删除");
    }
    if (action === "authorize-phone") return openSheet(phoneSheet());
    if (action === "confirm-phone") { state.verifiedPhone = { full: "13852185218", phoneTail: "5218", source: "WECHAT_GET_PHONE_NUMBER", verifiedAt: "2026-08-11 15:06", consentVersion: "privacy-v1.1" }; closeSheet(); render(); return showToast("账户手机号已验证"); }
    if (action === "request-deletion") {
      if (!state.deletionEligible) return openSheet(confirmSheet("暂不受理账号删除", "当前存在待付款、待发货、运输中订单或未完成售后。完成或取消后可再次申请。", "simulate-deletion-eligible", "演示业务已完成"));
      return openSheet(confirmSheet("确认申请删除账号", "提交后撤销会话、结束代理绑定并去标识化资料；交易与审计记录按合规配置保留。", "confirm-account-deletion", "提交申请"));
    }
    if (action === "simulate-deletion-eligible") { state.deletionEligible = true; closeSheet(); render(); return showToast("已切换为可申请删除的演示状态"); }
    if (action === "confirm-account-deletion") { state.deletionRequested = true; closeSheet(); render(); return showToast("账号删除申请已提交"); }
    if (action === "recover-ui") { state.uiRecovered = true; render(); return showToast("网络已恢复，原上下文仍保留"); }
    if (action === "refresh-conflict") return showToast("已刷新最新价格和库存，请重新确认");
    if (action === "clear-search") { state.searchQuery = ""; state.searchPerformed = false; return render(); }
    if (action === "clear-search-history") return showToast("搜索记录已清空");
    if (action === "manage-cart") { state.cartManaging = !state.cartManaging; render(); return showToast(state.cartManaging ? "已进入管理模式，可按 SKU 删除" : "已退出管理模式"); }
    if (action === "reset-category-filter") { state.categoryBrand = "全部"; state.filter = "全部"; render(); return; }
    if (action === "share") return showToast("已生成小程序分享卡片");
    if (action === "service") return showToast("正在连接商家客服…");
    if (action === "remind") return showToast("已提醒商家尽快发货");
    if (action === "copy-tracking") return showToast("运单号已复制");
    if (action === "upload") { state.afterSaleEvidenceCount = Math.min(3, state.afterSaleEvidenceCount + 1); render(); return showToast(`已添加 ${state.afterSaleEvidenceCount} 张演示凭证`); }
    if (action === "sale-type") return openSheet(aftersaleTypeSheet());
    if (action === "sale-reason") return openSheet(aftersaleReasonSheet());
    if (action === "privacy-policy") return showToast("原型演示：打开隐私政策");
    return showToast("此入口已预留交互反馈");
  });

  document.addEventListener("submit", event => {
    event.preventDefault();
    if (event.target.id === "searchForm") {
      state.searchQuery = event.target.querySelector("#searchInput").value.trim();
      state.searchPerformed = true;
      return render();
    }
    if (event.target.id === "addressForm") {
      const data = new FormData(event.target);
      const phone = String(data.get("phone") || "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) return showToast("请输入有效的 11 位手机号");
      const setDefault = event.target.querySelector(".switch-row").classList.contains("is-on");
      const payload = { recipient: String(data.get("recipient") || "").trim(), phone, region: String(data.get("region") || "").trim(), detail: String(data.get("detail") || "").trim(), isDefault: setDefault };
      if (setDefault) state.addresses.forEach(item => { item.isDefault = false; });
      const existing = state.addresses.find(item => item.id === state.editingAddressId);
      if (existing) Object.assign(existing, payload);
      else { payload.id = `ADDR-${String(state.addresses.length + 1).padStart(3, "0")}`; state.addresses.push(payload); state.editingAddressId = payload.id; }
      if (!state.addresses.some(item => item.isDefault)) state.addresses[0].isDefault = true;
      state.currentAddressId = state.addresses.find(item => item.isDefault)?.id || state.editingAddressId;
      navigate("addresses");
      return showToast("地址已保存");
    }
  });

  document.addEventListener("input", event => {
    if (event.target.id === "aftersaleDescription") state.afterSaleDescription = event.target.value;
  });

  sheetBackdrop.addEventListener("click", closeSheet);
  document.querySelector("#resetPrototype").addEventListener("click", () => {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, clone(initialState));
    closeSheet();
    render();
    showToast("原型已重置");
  });

  const prototypeParams = new URLSearchParams(window.location.search);
  const requestedScreen = prototypeParams.get("screen");
  const requestedDevice = Number(prototypeParams.get("device"));
  const inviteCode = prototypeParams.get("invite");
  const requestedBinding = prototypeParams.get("binding");
  const requestedAuth = prototypeParams.get("auth");
  const requestedAfterSale = prototypeParams.get("aftersale");
  let inviteNotice = "";
  if (requestedAuth === "guest") state.loggedIn = false;
  if (requestedBinding === "unbound") state.agentBindingStatus = "unbound";
  if (inviteCode) {
    const invitedAgent = inviteAgents[inviteCode];
    if (!invitedAgent) inviteNotice = "邀请码无效或已失效，未覆盖已有服务候选";
    else if (state.agentBindingStatus === "unbound") {
      state.serviceAgent = { ...invitedAgent };
      state.inviteCandidate = { code: inviteCode, agent: { ...invitedAgent }, expiresAt: Date.now() + 30 * 60 * 1000 };
      state.agentBindingStatus = state.loggedIn ? "pending" : "candidate";
    } else inviteNotice = `您已绑定 ${state.serviceAgent.name}，本次邀请不改变归属`;
  }
  if (requestedAfterSale === "failed") state.currentAfterSaleId = "AS202608030006";
  if (requestedScreen && renderers[requestedScreen]) {
    if (!state.loggedIn && protectedScreens.has(requestedScreen)) { state.authReturn = { screen: requestedScreen, action: null }; state.screen = "login"; }
    else state.screen = requestedScreen;
  }
  if ([375, 414].includes(requestedDevice)) {
    state.device = requestedDevice;
    document.documentElement.style.setProperty("--device-width", `${requestedDevice}px`);
    document.querySelectorAll("[data-device]").forEach(button => button.classList.toggle("is-active", Number(button.dataset.device) === requestedDevice));
    document.querySelector("#deviceLabel").textContent = `${requestedDevice} × 812`;
  }

  window.__MINIAPP_PROTOTYPE__ = { getState: () => clone(state), products: clone(products) };
  render();
  if (state.agentBindingStatus === "pending") setTimeout(() => openSheet(agentBindingSheet()), 120);
  else if (inviteNotice) setTimeout(() => showToast(inviteNotice), 120);
})();
