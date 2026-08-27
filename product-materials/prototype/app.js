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
      skus: [{ id: "SKU-LAU-30", name: "30颗 / 清新香", price: 49, stock: 0 }]
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

  const catalogSignals = {
    serum: { isHot: true, isNew: true, publishedAt: "2026-08-20T08:00:00+08:00" },
    shampoo: { isHot: true, isNew: false, publishedAt: "2026-07-18T08:00:00+08:00" },
    cleanser: { isHot: false, isNew: true, publishedAt: "2026-08-23T08:00:00+08:00" },
    bodywash: { isHot: false, isNew: false, publishedAt: "2026-06-12T08:00:00+08:00" },
    sunscreen: { isHot: false, isNew: false, publishedAt: null },
    laundry: { isHot: true, isNew: true, publishedAt: "2026-08-21T08:00:00+08:00" }
  };

  products.forEach(product => {
    product.status = product.id === "sunscreen" ? "INACTIVE" : "ACTIVE";
    product.skus.forEach(sku => { sku.status = product.id === "sunscreen" ? "INACTIVE" : "ACTIVE"; });
    Object.assign(product, catalogSignals[product.id]);
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
    "QX-A1038": { agent_id: "AGT-01038", display_name: "清源生活馆", bound_at: "2026-07-18T06:26:00Z" },
    "QX-A1026": { agent_id: "AGT-01026", display_name: "清悦日用馆", bound_at: null }
  };

  const currentLegalSnapshot = [
    { type: "USER_AGREEMENT", document_version: "current", title: "用户协议", content_url: "https://legal.qingxu.example/user-agreement/current", required: true },
    { type: "PRIVACY_POLICY", document_version: "current", title: "隐私政策", content_url: "https://legal.qingxu.example/privacy-policy/current", required: true },
    { type: "PHONE_AUTHORIZATION", document_version: "current", title: "手机号授权声明", content_url: "https://legal.qingxu.example/phone-authorization/current", required: true }
  ];
  const loginConsentTypes = new Set(["USER_AGREEMENT", "PRIVACY_POLICY"]);
  const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;

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
      canvasTitle: "搜索 · 商品名称检索",
      title: "搜索结果",
      description: "仅按 trim 后的商品名称进行大小写不敏感匹配，并提供历史词与无结果状态。",
      interactions: ["输入或点选商品名称关键词", "综合/热销/最新/价格排序", "结果卡进入详情"]
    },
    product: {
      canvasTitle: "商品详情 · SKU 决策",
      title: "商品详情",
      description: "价格、规格、成分和用法集中表达，底部双主路径减少决策成本。",
      interactions: ["收藏状态即时反馈", "详情 Tab 切换", "加入购物车/立即购买弹出 SKU"]
    },
    cart: {
      canvasTitle: "购物车 · 登录后同步",
      title: "购物车",
      description: "游客本地项登录后幂等合入服务端购物车，当前价格、库存和状态由服务端投影。",
      interactions: ["单选与全选可售商品", "数量上限 min(99, available_stock)", "结算保留选中项并提示 B9 开放"]
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
      description: "B8 开放收藏与收货地址，订单和交易仍保持未开放状态。",
      interactions: ["资料与会话入口", "进入商品收藏和收货地址", "订单与交易仅返回未开放反馈"]
    },
    "service-agent": {
      canvasTitle: "服务代理 · 归属与服务说明",
      title: "服务代理",
      description: "用户可以查看当前服务代理及绑定时间，价格、发货和售后仍由平台统一保障。",
      interactions: ["有效邀请链路登录后显式确认", "候选展示 30 分钟有效期", "绑定后不提供自助更换"]
    },
    login: { canvasTitle: "登录 · 协议与来源确认", title: "登录与协议", description: "受保护动作前确认服务端当前协议快照，登录后返回原操作并继续处理代理候选。", interactions: ["用户协议与隐私政策 exact set", "微信凭证登录", "协议冲突刷新后重新确认"] },
    "payment-result": { canvasTitle: "支付结果 · 可恢复反馈", title: "支付结果", description: "成功、失败和取消均保留订单事实，并提供与状态一致的下一步。", interactions: ["失败或取消后重试", "成功后查看订单", "稍后支付保留待付款订单"] },
    "order-detail": { canvasTitle: "订单详情 · 四轴状态", title: "订单详情", description: "订单、支付、退款和履约分别表达，商品与地址使用下单快照。", interactions: ["待付款继续支付", "运输中查看物流", "符合资格的订单项申请售后"] },
    logistics: { canvasTitle: "物流详情 · 履约时间线", title: "物流详情", description: "承运商、运单号和人工物流节点形成可追踪时间线。", interactions: ["复制运单号", "查看运输节点", "返回订单详情"] },
    "aftersale-detail": { canvasTitle: "售后详情 · 数量金额占用", title: "售后详情", description: "展示审核、退货、退款与失败重试，并明确已占用的可退数量和金额。", interactions: ["允许阶段取消并释放占用", "填写退货物流", "退款失败可重试"] },
    addresses: { canvasTitle: "地址 · 默认与脱敏", title: "收货地址", description: "列表只展示脱敏摘要，并按默认、创建时间和 ID 稳定排序。", interactions: ["设为默认", "新增或编辑地址", "删除默认地址后稳定提升下一条"] },
    "address-edit": { canvasTitle: "地址编辑 · 版本校验", title: "编辑地址", description: "收件人、手机号、省、市、区和详细地址均为独立字段。", interactions: ["11 位 ASCII 手机号校验", "If-Match 冲突后刷新", "唯一默认地址约束"] },
    favorites: { canvasTitle: "收藏 · 商品当前状态", title: "商品收藏", description: "收藏列表保留当前不可用商品，并展示闭合可售状态。", interactions: ["按商品名搜索", "取消收藏 pending 防重复", "进入仍公开的商品详情"] },
    account: { canvasTitle: "账户与隐私 · 权利入口", title: "账户与隐私", description: "只展示服务端最小资料，并集中处理资料、手机号、会话和账号注销。", interactions: ["乐观锁编辑资料", "管理手机号与隐私权利", "退出当前会话"] },
    "phone-authorization": { canvasTitle: "手机号授权 · 自愿且独立", title: "手机号授权", description: "账户手机号独立于收货地址，自愿授权后只展示服务端脱敏值并允许撤回。", interactions: ["拉起微信手机号能力", "展示脱敏验证结果", "撤回当前授权"] },
    "account-deletion": { canvasTitle: "账号注销 · 资格与影响", title: "账号注销", description: "先获取资格与影响预览，再二次确认并同步完成会话撤销和资料去标识化。", interactions: ["检查注销资格", "查看 blockers 与 impacts", "同步确认注销"] },
    "system-states": { canvasTitle: "状态样例 · 可恢复与可解释", title: "异常状态样例", description: "集中展示加载、网络错误、403、409 和操作成功的代表性状态。", interactions: ["错误重试", "冲突后刷新", "成功反馈"] }
  };

  const productById = id => products.find(product => product.id === id) || products[0];
  const skuById = id => products.flatMap(product => product.skus).find(sku => sku.id === id) || products[0].skus[0];
  const publicSkusFor = product => product.skus.filter(sku => sku.status === "ACTIVE");
  const isSkuSalable = sku => sku.status === "ACTIVE" && sku.stock > 0;
  const isProductSalable = product => publicSkusFor(product).some(isSkuSalable);
  const isPublicProduct = product => product?.status === "ACTIVE" && publicSkusFor(product).length > 0;
  const publicProducts = () => products.filter(isPublicProduct);
  const publicProductById = id => products.find(product => product.id === id && isPublicProduct(product));
  const preferredPublicSku = product => publicSkusFor(product).find(isSkuSalable) || publicSkusFor(product)[0];
  const minimumActivePrice = product => Math.min(...publicSkusFor(product).map(sku => sku.price));
  const publishedTime = product => product.publishedAt ? Date.parse(product.publishedAt) : Number.NEGATIVE_INFINITY;
  const stableProductIdOrder = (left, right) => left.id.localeCompare(right.id);
  const compareComprehensive = (left, right) => Number(right.isHot) - Number(left.isHot)
    || Number(right.isNew) - Number(left.isNew)
    || right.sales - left.sales
    || publishedTime(right) - publishedTime(left)
    || stableProductIdOrder(left, right);
  const lineProduct = line => productById(line.productId);
  const lineSku = line => skuById(line.skuId);
  const clone = value => JSON.parse(JSON.stringify(value));

  const defaultAddress = {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
    recipient: "林青",
    phone: "13852185218",
    province: "浙江省",
    city: "杭州市",
    district: "西湖区",
    detail: "文三路 88 号 2 幢 1102 室",
    isDefault: true,
    version: 3,
    createdAt: "2026-07-18T06:20:00Z"
  };

  const initialFavorites = [
    { favoriteId: "01ARZ3NDEKTSV4RRFFQ69G5FB0", productId: "serum", createdAt: "2026-08-25T04:20:00Z", availability: "SALEABLE", primaryImageUrl: "./assets/product-1.png", minimumActivePrice: 168, isSalable: true },
    { favoriteId: "01ARZ3NDEKTSV4RRFFQ69G5FB1", productId: "laundry", createdAt: "2026-08-25T04:20:00Z", availability: "OUT_OF_STOCK", primaryImageUrl: "./assets/product-8.png", minimumActivePrice: 49, isSalable: false },
    { favoriteId: "01ARZ3NDEKTSV4RRFFQ69G5FB2", productId: "sunscreen", createdAt: "2026-08-23T04:20:00Z", availability: "UNAVAILABLE", primaryImageUrl: null, minimumActivePrice: null, isSalable: false }
  ];

  const guestCartMergeFixture = [
    { productId: "serum", skuId: "SKU-SER-30", quantity: 2, selected: false, saleStatus: "SALEABLE", availableStock: 286 },
    { productId: "shampoo", skuId: "SKU-SHA-500", quantity: 1, selected: true, saleStatus: "SALEABLE", availableStock: 142 }
  ];

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
    homeSectionStatus: { banners: "READY", categories: "READY", hot_products: "READY", new_products: "READY" },
    product: products[0],
    detailTab: "亮点",
    favorites: clone(initialFavorites),
    favoriteKeyword: "",
    favoritePendingProductId: null,
    selectedSkuId: "SKU-SER-30",
    quantity: 1,
    skuIntent: "cart",
    loggedIn: true,
    profile: { nickname: "林青", avatar_url: null, city: "杭州", version: 3 },
    profileConflictNext: false,
    consentAccepted: false,
    legalDocuments: clone(currentLegalSnapshot),
    acceptedConsents: [],
    authProvider: null,
    loginFailureNext: null,
    loginError: null,
    verifiedPhone: null,
    phoneMutation: { kind: null, status: "IDLE", expectedVersion: null, error: null },
    phoneAuthorizationConsent: null,
    phoneConflictNext: false,
    phoneFailureNext: false,
    authReturn: null,
    pendingProtectedAction: null,
    inviteCandidate: null,
    candidateDecisionError: null,
    candidateMismatchNext: false,
    candidateConcurrentWinner: null,
    candidateDecisionStatus: "IDLE",
    agentBindingStatus: "bound",
    serviceAgent: { ...inviteAgents["QX-A1038"] },
    cartManaging: false,
    cartId: "01ARZ3NDEKTSV4RRFFQ69G5FB3",
    cartMergeJournal: null,
    cartMergeFailureNext: false,
    guestCart: [],
    cart: [
      { productId: "serum", skuId: "SKU-SER-30", quantity: 1, selected: true, saleStatus: "SALEABLE", availableStock: 286 },
      { productId: "bodywash", skuId: "SKU-BOD-480", quantity: 2, selected: true, saleStatus: "INSUFFICIENT_STOCK", availableStock: 1 },
      { productId: "laundry", skuId: "SKU-LAU-30", quantity: 1, selected: false, saleStatus: "OUT_OF_STOCK", availableStock: 0 },
      { productId: "sunscreen", skuId: "SKU-SUN-50", quantity: 1, selected: false, saleStatus: "INACTIVE", availableStock: 0 },
      { productId: "cleanser", skuId: "SKU-CLN-120", quantity: 1, selected: false, saleStatus: "DELETED", availableStock: 0 }
    ],
    checkoutMode: "cart",
    buyNowLine: null,
    currentAddressId: defaultAddress.id,
    addressReturnScreen: null,
    editingAddressId: defaultAddress.id,
    addressMutationExpectedVersion: defaultAddress.version,
    addressConflictNext: false,
    addressError: null,
    addresses: [clone(defaultAddress), { id: "01ARZ3NDEKTSV4RRFFQ69G5FAY", recipient: "林青", phone: "13852185218", province: "上海市", city: "上海市", district: "徐汇区", detail: "衡山路 26 号 6 楼", isDefault: false, version: 1, createdAt: "2026-07-20T06:20:00Z" }],
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
    deletionCanProceed: false,
    deletionEligibility: { checked: false, eligible: false, blockers: [], impacts: [], confirmation_expires_in_seconds: null, confirm_status: null, error_code: null },
    accountDeleted: false,
    uiRecovered: false
  };

  const app = document.querySelector("#app");
  const bottomSheet = document.querySelector("#bottomSheet");
  const sheetBackdrop = document.querySelector("#sheetBackdrop");
  const toast = document.querySelector("#toast");
  let toastTimer;
  let sheetCloseTimer;

  const money = value => `¥${Number(value).toFixed(value % 1 ? 2 : 0)}`;
  const displayDateTime = value => value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai", hour12: false }).format(new Date(value))
    : "";

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
    const isSalable = isProductSalable(product);
    return `
      <button class="product-card ${isSalable ? "" : "is-sold-out"}" data-open-product="${product.id}" data-salable="${isSalable}">
        <div class="product-card__media">
          <span class="product-badge">${isSalable ? product.badge : "暂时售罄"}</span>
          <div class="fallback-pack ${product.pack}" data-label="${product.label}"></div>
          <img src="${product.image}" alt="${product.name}" onerror="this.hidden=true" />
        </div>
        <div class="product-card__body">
          <span class="product-brand">${product.brand}</span>
          <div class="product-name">${product.name}</div>
          <div class="price-row">
            <span class="price"><small>¥</small>${minimumActivePrice(product)}</span>
            <span class="sales-note">${isSalable ? `已售${product.sales}` : "到货后可购买"}</span>
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
    const hotProducts = [...catalog].filter(product => product.isHot).sort((left, right) => right.sales - left.sales || stableProductIdOrder(left, right)).slice(0, 4);
    const newProducts = [...catalog].filter(product => product.isNew).sort((left, right) => publishedTime(right) - publishedTime(left) || stableProductIdOrder(left, right)).slice(0, 4);
    const sectionUnavailable = (title, section) => `<div class="home-section-unavailable" data-home-section="${section}" data-status="UNAVAILABLE"><strong>${title}暂时无法加载</strong><span>其他内容不受影响，请稍后重试。</span><button data-action="retry-home-section" data-home-section="${section}">重试</button></div>`;
    return `
      <section class="app-screen with-tabbar home-page">
        <div class="screen-scroll">
          <div class="home-top">
            ${statusBar()}
            <div class="mini-header">
              <div class="mini-header__side"><strong class="app-brand">青序</strong></div>
              <div class="mini-header__side"><button class="icon-button" data-screen="profile" aria-label="消息">◦</button></div>
            </div>
            <button class="search-trigger" data-screen="search"><span>⌕</span><span>搜索商品名称</span></button>
          </div>

          ${state.homeSectionStatus.banners === "READY" ? `<article class="hero-card" data-home-section="banners" data-status="READY">
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
          </article>` : sectionUnavailable("Banner", "banners")}

          <section class="section-block">
            <div class="section-heading"><div><h3>按需选购</h3><p>从每一种生活场景出发</p></div><button data-screen="category">全部分类 ›</button></div>
            ${state.homeSectionStatus.categories === "READY" ? `<div class="category-grid" data-home-section="categories" data-status="READY">
              ${categories.slice(0, 8).map(([name, icon]) => `<button class="category-tile" data-category="${name}"><span class="category-icon">${icon}</span><span>${name}</span></button>`).join("")}
            </div>` : sectionUnavailable("分类", "categories")}
          </section>

          <section class="section-block">
            <div class="section-heading"><div><h3>本周热销</h3><p>大家正在回购的安心好物</p></div><button data-category="护肤品">查看更多 ›</button></div>
            ${state.homeSectionStatus.hot_products === "READY" ? `<div class="product-grid" data-home-section="hot_products" data-status="READY">${hotProducts.map(productCard).join("")}</div>` : sectionUnavailable("热销", "hot_products")}
          </section>

          <section class="section-block" style="padding-bottom:22px">
            <div class="section-heading"><div><h3>新品上架</h3><p>为日常带来一点新鲜感</p></div></div>
            ${state.homeSectionStatus.new_products === "READY" ? `<div class="product-grid" data-home-section="new_products" data-status="READY">${newProducts.map(productCard).join("")}</div>` : sectionUnavailable("新品", "new_products")}
          </section>
        </div>
        ${tabbar("home")}
      </section>`;
  }

  function renderCategory() {
    const categoryProducts = publicProducts().filter(product => product.category === state.selectedCategory);
    const brands = ["全部", ...new Set(categoryProducts.map(product => product.brand))];
    let displayProducts = categoryProducts.filter(product => state.categoryBrand === "全部" || product.brand === state.categoryBrand);
    if (state.filter === "热销") displayProducts = [...displayProducts].sort((a, b) => b.sales - a.sales || stableProductIdOrder(a, b));
    if (state.filter === "新品") displayProducts = displayProducts.filter(product => product.isNew)
      .sort((a, b) => publishedTime(b) - publishedTime(a) || stableProductIdOrder(a, b));
    if (state.filter === "价格") displayProducts = [...displayProducts]
      .sort((a, b) => minimumActivePrice(a) - minimumActivePrice(b) || stableProductIdOrder(a, b));
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
        <div style="padding:0 12px 10px"><button class="search-trigger" data-screen="search"><span>⌕</span><span>搜索商品名称</span></button></div>
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
    return catalog.filter(product => product.name.toLowerCase().includes(query));
  }

  function renderSearch() {
    let matches = searchMatches();
    if (state.searchSort === "综合") matches = [...matches].sort(compareComprehensive);
    if (state.searchSort === "热销") matches = [...matches].sort((left, right) => right.sales - left.sales || stableProductIdOrder(left, right));
    if (state.searchSort === "最新") matches = [...matches].sort((left, right) => publishedTime(right) - publishedTime(left) || stableProductIdOrder(left, right));
    if (state.searchSort === "价格↑") matches = [...matches].sort((left, right) => minimumActivePrice(left) - minimumActivePrice(right) || stableProductIdOrder(left, right));
    if (state.searchSort === "价格↓") matches = [...matches].sort((left, right) => minimumActivePrice(right) - minimumActivePrice(left) || stableProductIdOrder(left, right));
    const historyView = `
      <div class="search-history">
        <div class="history-head"><strong>最近搜索</strong><button data-action="clear-search-history" aria-label="清空历史">♲</button></div>
        <div class="keyword-wrap">
          ${["氨基酸", "精华液", "白茶", "洗衣凝珠", "洁面乳"].map(keyword => `<button data-keyword="${keyword}">${keyword}</button>`).join("")}
        </div>
      </div>`;
    const resultView = matches.length ? `
      <div class="result-summary"><span>找到 <strong>${matches.length}</strong> 件相关商品</span><div class="sort-control">${["综合", "热销", "最新", "价格↑", "价格↓"].map(item => `<button class="${state.searchSort === item ? "is-active" : ""}" data-sort="${item}">${item}</button>`).join("")}</div></div>
      <div class="search-results">
        ${matches.map(product => `
          <button class="search-result" data-open-product="${product.id}">
            ${imageMedia(product, "result-thumb")}
            <div class="result-info"><span class="product-brand">${product.brand}</span><h3>${product.name}</h3><p>${product.subtitle}</p><div class="price-row"><span class="price"><small>¥</small>${minimumActivePrice(product)}</span><span class="sales-note">${isProductSalable(product) ? `已售${product.sales}` : "暂时售罄"}</span></div></div>
          </button>`).join("")}
      </div>` : `<div class="empty-state"><i>⌕</i><strong>没有找到相关商品</strong><p>换个关键词试试，或浏览我们的热销分类</p><button class="secondary-button" data-screen="category" style="padding:0 18px">去分类看看</button></div>`;
    return `
      <section class="app-screen search-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("搜索", { bordered: false })}
          <form class="search-bar-wrap" id="searchForm">
            <label class="search-field"><span>⌕</span><input id="searchInput" value="${state.searchQuery}" autocomplete="off" maxlength="200" placeholder="搜索商品名称" /><button type="button" data-action="clear-search">×</button></label>
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

  function addressRegion(address) {
    return [address.province, address.city, address.district].filter(Boolean).join(" ");
  }

  function sortedAddresses() {
    return [...state.addresses].sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
      || Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.id.localeCompare(right.id));
  }

  function isFavorite(productId) {
    return state.favorites.some(favorite => favorite.productId === productId);
  }

  function favoriteViewForProduct(product) {
    const suffixes = ["B3", "B4", "B5", "B6", "B7", "B8", "B9"];
    return {
      favoriteId: `01ARZ3NDEKTSV4RRFFQ69G5F${suffixes[state.favorites.length] || "BZ"}`,
      productId: product.id,
      createdAt: new Date().toISOString(),
      availability: isProductSalable(product) ? "SALEABLE" : "OUT_OF_STOCK",
      primaryImageUrl: product.image,
      minimumActivePrice: minimumActivePrice(product),
      isSalable: isProductSalable(product)
    };
  }

  function setFavorite(productId, desired) {
    if (state.favoritePendingProductId) return false;
    const product = products.find(item => item.id === productId);
    if (desired && (!product || !isPublicProduct(product))) return showToast("商品当前不可收藏");
    state.favoritePendingProductId = productId;
    render();
    setTimeout(() => {
      if (desired && !isFavorite(productId)) state.favorites = [favoriteViewForProduct(product), ...state.favorites];
      if (!desired) state.favorites = state.favorites.filter(favorite => favorite.productId !== productId);
      state.favoritePendingProductId = null;
      render();
      showToast(desired ? "已收藏商品" : "已取消收藏");
    }, 180);
    return true;
  }

  function currentProductSku() {
    const activeSkus = publicSkusFor(state.product);
    return activeSkus.find(sku => sku.id === state.selectedSkuId) || preferredPublicSku(state.product);
  }

  function renderProduct() {
    const product = state.product;
    const selectedSku = currentProductSku();
    const favorite = isFavorite(product.id);
    const favoritePending = state.favoritePendingProductId === product.id;
    const detail = product.details;
    const isSalable = isSkuSalable(selectedSku);
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
            <div class="floating-header"><button class="icon-button is-soft" data-action="back" aria-label="返回">‹</button><div><button class="icon-button is-soft" data-action="share" aria-label="分享">↗</button><button class="icon-button is-soft" data-action="favorite" aria-label="收藏" ${favoritePending ? "disabled" : ""}>${favoritePending ? "…" : favorite ? "♥" : "♡"}</button></div></div>
            ${imageMedia(product, "product-hero-media")}
            <div class="gallery-dots"><i></i><i></i><i></i></div>
          </div>
          <div class="product-summary">
            <div class="price-row"><span class="price-label">零售价</span><span class="price"><small>¥</small>${selectedSku.price}</span></div>
            <h1>${product.name}</h1>
            <p>${product.subtitle}。严选原料与温和配方，让护理回归简单有效。</p>
            <div class="summary-meta"><span>${product.brand}</span><span>${isSalable ? `库存 ${selectedSku.stock}` : "暂时售罄"}</span><span>已售 ${product.sales}</span></div>
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
          <button class="secondary-button" data-sku-intent="cart" ${isSalable ? "" : "disabled"}>${isSalable ? "加入购物车" : "暂时售罄"}</button>
          <button class="primary-button is-coral" data-sku-intent="buy" ${isSalable ? "" : "disabled"}>${isSalable ? "立即购买" : "到货后可购买"}</button>
        </div>
      </section>`;
  }

  function activeCartItems() {
    return state.loggedIn ? state.cart : state.guestCart;
  }

  function cartTotal() {
    return activeCartItems().filter(item => item.selected && item.saleStatus === "SALEABLE").reduce((sum, item) => sum + lineSku(item).price * item.quantity, 0);
  }

  function cartStatusCopy(item) {
    if (item.saleStatus === "INSUFFICIENT_STOCK") return `库存不足，仅剩 ${item.availableStock} 件`;
    if (item.saleStatus === "OUT_OF_STOCK") return "当前规格已售罄";
    if (item.saleStatus === "INACTIVE") return "商品或规格已下架";
    if (item.saleStatus === "DELETED") return "商品或规格已删除";
    return `库存 ${item.availableStock} 件`;
  }

  function renderCart() {
    const cartItems = activeCartItems();
    const validItems = cartItems.filter(item => item.saleStatus === "SALEABLE");
    const selectedCount = validItems.filter(item => item.selected).length;
    const allSelected = Boolean(validItems.length) && selectedCount === validItems.length;
    const mergeNotice = state.cartMergeJournal?.status === "RETRY"
      ? `<div class="inline-alert is-warning" data-merge-status="RETRY"><strong>游客购物车尚未合并</strong><span>已保留原条目与同一幂等键，网络恢复后可安全重试。</span><button data-action="retry-cart-merge">重试合并</button></div>`
      : state.cartMergeJournal?.status === "MERGED"
        ? `<div class="inline-alert is-success" data-merge-status="MERGED"><strong>游客购物车已合并</strong><span>${state.cartMergeJournal.itemCount} 个本地规格已写入服务端；每个购物车最多 100 种规格。</span></div>`
        : "";
    return `
      <section class="app-screen with-tabbar cart-page">
        <div class="screen-scroll">
          ${statusBar()}
          ${header("购物车", { back: false, action: `<button class="text-button" data-action="manage-cart">${state.cartManaging ? "完成" : "管理"}</button>` })}
          ${mergeNotice}
          ${cartItems.length ? `
            <div class="cart-list">
              <div class="cart-group-label"><span>青序自营</span><span>·</span><span>全场包邮</span></div>
              ${cartItems.map((item, index) => {
                const product = lineProduct(item);
                const sku = lineSku(item);
                const saleable = item.saleStatus === "SALEABLE";
                return `<article class="cart-card ${saleable ? "" : "is-invalid"}" data-cart-sku="${item.skuId}" data-sale-status="${item.saleStatus}" data-selected="${item.selected}">
                  <button class="check-control ${item.selected && saleable ? "is-checked" : ""}" data-cart-select="${index}" aria-label="选择商品" ${saleable ? "" : "disabled"}>✓</button>
                  ${imageMedia(product, "cart-thumb")}
                  <div class="cart-info"><h3>${product.name}</h3><span class="sku-label">${sku.name}</span><small class="${saleable ? "sku-label" : "invalid-reason"}">${cartStatusCopy(item)}${saleable ? "" : " · 不计入合计"}</small><div class="cart-card__footer"><span class="price"><small>¥</small>${sku.price}</span>${state.cartManaging || !saleable ? `<button class="cart-delete" data-cart-delete="${index}">删除</button>` : `<div class="quantity-stepper"><button data-cart-qty="${index}" data-delta="-1">−</button><span>${item.quantity}</span><button data-cart-qty="${index}" data-delta="1">＋</button></div>`}</div></div>
                </article>`;
              }).join("")}
            </div>
            <section class="cart-recommend"><div class="section-heading"><div><h3>你可能还喜欢</h3></div></div><div class="product-grid">${publicProducts().slice(2, 4).map(productCard).join("")}</div></section>
          ` : `<div class="empty-state" data-cart-id="${state.loggedIn ? state.cartId || "" : ""}"><i>□</i><strong>购物车还是空的</strong><p>${state.loggedIn && state.cartId === null ? "服务端尚未创建购物车，首次加购时再创建。" : "去挑选一些日常好物吧"}</p><button class="primary-button" data-screen="home" style="padding:0 22px">去逛逛</button></div>`}
        </div>
        ${cartItems.length ? `<div class="cart-summary"><button class="select-all" data-action="select-all"><span class="check-control ${allSelected ? "is-checked" : ""}">✓</span><span>全选</span></button><div class="summary-price"><span>合计：<strong>${money(cartTotal())}</strong></span><small>仅统计已选可售商品</small></div><button class="primary-button is-coral" data-action="checkout" ${selectedCount ? "" : "disabled"}>去结算 (${selectedCount})</button></div>` : ""}
        ${tabbar("cart")}
      </section>`;
  }

  function checkoutLines() {
    if (state.checkoutMode === "buy" && state.buyNowLine) return [state.buyNowLine];
    return activeCartItems().filter(item => item.selected && item.saleStatus === "SALEABLE");
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
            ${address ? `<button class="address-card" data-action="choose-address"><span class="address-icon">⌖</span><span class="address-main"><strong>${address.recipient} <span>${maskPhone(address.phone)}</span></strong><p>${addressRegion(address)} ${address.detail}</p></span><span>›</span></button>` : `<button class="address-card is-empty" data-action="choose-address"><span class="address-icon">＋</span><span class="address-main"><strong>添加收货地址</strong><p>提交订单前需要选择有效地址</p></span><span>›</span></button>`}
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
            <section class="detail-card address-summary"><span class="address-icon">⌖</span><div><strong>${address.recipient} · ${maskPhone(address.phone)}</strong><p>${addressRegion(address)} ${address.detail}</p></div></section>
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
    const profile = state.profile;
    const nickname = profile.nickname || "微信用户";
    const avatarLabel = nickname.trim().charAt(0) || "青";
    const agentCard = state.agentBindingStatus === "bound" ? `
      <button class="service-agent-card" data-screen="service-agent"><span class="service-agent-card__mark">清</span><span class="service-agent-card__copy"><small>我的服务代理</small><strong>${agent.display_name}</strong><em>绑定于 ${agent.bound_at}</em></span><span class="service-agent-card__arrow">›</span></button>` : `
      <button class="service-agent-card is-unbound" data-screen="service-agent"><span class="service-agent-card__mark">青</span><span class="service-agent-card__copy"><small>服务代理</small><strong>暂未绑定</strong><em>${state.inviteCandidate ? "登录后确认候选服务关系" : "从有效邀请入口登录后确认"}</em></span><span class="service-agent-card__arrow">›</span></button>`;
    return `
      <section class="app-screen with-tabbar profile-page">
        <div class="screen-scroll">
          <div class="profile-hero">${statusBar(true)}<div class="profile-tools"><button class="icon-button" data-action="message" aria-label="消息">◦</button><button class="icon-button" data-screen="account" aria-label="设置">⚙</button></div><div class="profile-user"><div class="avatar">${avatarLabel}</div><div><h2>${nickname}</h2><p>${profile.city || "城市未设置"} · ${state.verifiedPhone?.phone_masked || "手机号未绑定"}</p></div></div></div>
          <div class="profile-body">
            ${agentCard}
            <section class="profile-card"><div class="profile-card__head"><strong>我的订单</strong><button data-action="deferred-feature" data-feature="订单">全部订单 ›</button></div><div class="order-shortcuts"><button data-action="deferred-feature" data-feature="订单"><i>◴</i><span>待付款</span></button><button data-action="deferred-feature" data-feature="订单"><i>▣</i><span>待发货</span></button><button data-action="deferred-feature" data-feature="订单"><i>♧</i><span>待收货</span></button><button data-action="deferred-feature" data-feature="订单"><i>✓</i><span>已完成</span></button><button data-action="deferred-feature" data-feature="售后"><i>↺</i><span>退款/售后</span></button></div></section>
            <section class="profile-card"><div class="profile-card__head"><strong>常用功能</strong></div><div class="benefit-row"><button data-screen="favorites"><strong>♡</strong><span>商品收藏</span></button><button data-screen="addresses"><strong>⌖</strong><span>收货地址</span></button><button data-action="service"><strong>◉</strong><span>联系商家</span></button></div></section>
            <section class="profile-card menu-list"><button class="menu-item" data-screen="account"><i>○</i><span>账户与隐私</span><span>›</span></button><button class="menu-item" data-screen="addresses"><i>⌖</i><span>收货地址</span><span>›</span></button><button class="menu-item" data-action="service"><i>◉</i><span>联系商家</span><span>›</span></button><button class="menu-item" data-action="quality"><i>◇</i><span>正品与服务保障</span><span>›</span></button><button class="menu-item" data-screen="system-states"><i>!</i><span>异常状态样例</span><span>›</span></button></section>
          </div>
        </div>
        ${tabbar("profile")}
      </section>`;
  }

  function candidateRemaining() {
    if (!state.inviteCandidate) return "";
    const seconds = Math.max(0, Math.floor((Date.parse(state.inviteCandidate.expires_at) - Date.now()) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function renderServiceAgent() {
    const agent = state.serviceAgent;
    const isBound = state.agentBindingStatus === "bound";
    return `
      <section class="app-screen service-agent-page">
        <div class="screen-scroll">${statusBar()}${header("服务代理")}<div class="service-agent-body">
          ${isBound ? `<article class="service-agent-identity"><span class="service-agent-identity__mark">清</span><div><small>CURRENT SERVICE AGENT</small><h3>${agent.display_name}</h3><p>平台认证服务代理</p></div><span class="binding-badge">已绑定</span></article><section class="agent-fact-card"><div><span>绑定时间</span><strong>${agent.bound_at}</strong></div></section>` : `<article class="service-agent-empty"><span>青</span><h3>暂未绑定服务代理</h3><p>${state.inviteCandidate ? `候选代理 ${state.inviteCandidate.display_name}，剩余 ${candidateRemaining()}。完成登录后可确认或拒绝。` : "从有效分享链接或邀请二维码进入，登录后将显示绑定确认。"}</p>${state.inviteCandidate && !state.loggedIn ? `<button class="primary-button" data-screen="login">登录并确认</button>` : state.inviteCandidate ? `<button class="primary-button" data-action="open-binding">查看绑定确认</button>` : ""}</article>`}
          <section class="agent-policy-card"><div class="agent-policy-card__head"><span>◇</span><div><strong>商城服务保障</strong><small>归属关系不改变您的购物权益</small></div></div><ul><li>商品价格、支付与发货由青序生活统一提供</li><li>退款与售后仍由平台客服统一受理</li><li>绑定后不可自助更换，异常情况请联系客服</li></ul></section>
          <section class="agent-help-card"><div><strong>需要帮助？</strong><p>对服务归属有疑问，平台客服会核实处理。</p></div><button class="secondary-button" data-action="service">联系平台客服</button></section>
        </div></div>
      </section>`;
  }

  function renderLogin() {
    const source = state.inviteCandidate ? `<div class="login-source"><span class="service-agent-card__mark">清</span><div><small>待确认服务代理 · 候选剩余 ${candidateRemaining()}</small><strong>${state.inviteCandidate.display_name}</strong><p>登录后仍需由您明确确认，不会自动绑定。</p></div></div>` : "";
    const legalDocuments = state.legalDocuments.filter(document => loginConsentTypes.has(document.type)).map(document => `<button type="button" data-action="open-legal-document" data-legal-type="${document.type}" data-legal-url="${document.content_url}"><span>《${document.title}》</span><small data-legal-version="${document.type}">版本 ${document.document_version}</small><i>›</i></button>`).join("");
    const loginError = state.loginError ? `<div class="inline-alert is-error" data-login-status="${state.loginError.status}" data-error-code="${state.loginError.error_code}"${state.loginError.retry_after_seconds ? ` data-retry-after="${state.loginError.retry_after_seconds}"` : ""}><strong>${state.loginError.status === 429 ? "登录尝试过于频繁" : "暂时无法完成登录"}</strong><span>${state.loginError.status === 429 ? `${state.loginError.retry_after_seconds} 秒后可重试。` : "身份服务暂时不可用，请稍后重试。"}</span><button data-action="retry-login">重试</button></div>` : "";
    return `
      <section class="app-screen auth-page">
        <div class="screen-scroll">${statusBar()}${header("微信登录")}<div class="auth-body"><div class="auth-brand"><span>青</span><h1>欢迎来到青序生活</h1><p>登录后可查看账户资料、确认或拒绝服务代理候选，并管理手机号与隐私权利。</p></div>${source}<section class="legal-snapshot" data-legal-snapshot="current"><strong>当前协议</strong>${legalDocuments}</section>${loginError}<button class="wechat-login" data-action="mock-login"><span>⌁</span>微信登录</button><button class="consent-row ${state.consentAccepted ? "is-checked" : ""}" data-action="toggle-consent"><i>✓</i><span>我已阅读并同意当前《用户协议》和《隐私政策》</span></button><div class="inline-alert"><strong>手机号不是登录必选项</strong><span>登录后可在账户与隐私中自愿授权账户手机号；不会从收货地址提取账户手机号。若协议版本更新，将刷新当前内容并要求重新确认。</span></div></div></div>
      </section>`;
  }

  function renderAddresses() {
    const addresses = sortedAddresses();
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header(state.addressReturnScreen ? "选择收货地址" : "收货地址")}<div class="address-list">${addresses.map(address => `<article class="saved-address ${address.isDefault ? "is-selected" : ""}" data-address-version="${address.version}"><button class="saved-address__main" data-address-select="${address.id}"><strong>${maskRecipient(address.recipient)} <span>${maskPhone(address.phone)}</span></strong><p>${addressRegion(address)} ${maskAddressDetail(address.detail)}</p><small>${address.isDefault ? "默认地址" : ""}</small></button><div class="saved-address__actions"><button data-address-default="${address.id}" ${address.isDefault ? "disabled" : ""}>设为默认</button><button data-address-edit="${address.id}">编辑</button><button data-address-delete="${address.id}">删除</button></div></article>`).join("") || `<div class="empty-state"><i>⌖</i><strong>暂无收货地址</strong><p>新增地址后可在后续下单时使用。</p></div>`}</div></div><div class="form-submit"><button class="primary-button" data-action="new-address">＋ 新增收货地址</button></div></section>`;
  }

  function renderAddressEdit() {
    const editing = state.addresses.find(item => item.id === state.editingAddressId);
    const address = editing || { recipient: "", phone: "", province: "", city: "", district: "", detail: "", isDefault: !state.addresses.length, version: null };
    const addressError = state.addressError === "RESOURCE_VERSION_CONFLICT"
      ? `<div class="inline-alert is-warning" data-address-error-code="RESOURCE_VERSION_CONFLICT"><strong>地址已更新</strong><span>已刷新最新版本，请重新确认本次修改。</span></div>`
      : state.addressError === "DEFAULT_ADDRESS_REQUIRED"
        ? `<div class="inline-alert is-error" data-address-error-code="DEFAULT_ADDRESS_REQUIRED"><strong>必须保留默认地址</strong><span>请先把其他地址设为默认，再关闭当前默认状态。</span></div>`
        : "";
    return `
      <section class="app-screen form-page"><div class="screen-scroll">${statusBar()}${header(editing ? "编辑地址" : "新增地址")}${addressError}<form class="address-form" id="addressForm" data-if-match-version="${address.version ?? ""}"><label><span>收货人</span><input name="recipient" value="${address.recipient}" maxlength="80" placeholder="请输入姓名" required /></label><label><span>手机号</span><input name="phone" value="${address.phone}" inputmode="numeric" maxlength="11" pattern="[0-9]{11}" placeholder="11 位手机号" required /></label><label><span>省</span><input name="province" value="${address.province}" maxlength="80" required /></label><label><span>市</span><input name="city" value="${address.city}" maxlength="80" required /></label><label><span>区</span><input name="district" value="${address.district}" maxlength="80" required /></label><label class="is-textarea"><span>详细地址</span><textarea name="detail" maxlength="300" placeholder="街道、楼栋和门牌号" required>${address.detail}</textarea></label><button type="button" class="switch-row ${address.isDefault ? "is-on" : ""}" data-action="toggle-address-default"><span><strong>设为默认地址</strong><small>保存后其他地址将取消默认</small></span><i></i></button><button class="primary-button" type="submit">保存地址</button></form></div></section>`;
  }

  function renderFavorites() {
    const keyword = state.favoriteKeyword.trim().toLowerCase();
    const favorites = [...state.favorites]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.favoriteId.localeCompare(left.favoriteId))
      .filter(favorite => !keyword || productById(favorite.productId).name.toLowerCase().includes(keyword));
    const availabilityCopy = { SALEABLE: "可购买", OUT_OF_STOCK: "暂时售罄", UNAVAILABLE: "商品已失效" };
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("商品收藏")}<form class="search-bar-wrap" id="favoriteSearchForm"><label class="search-field"><span>⌕</span><input id="favoriteSearchInput" name="keyword" value="${state.favoriteKeyword}" maxlength="200" placeholder="搜索收藏的商品名称" /><button type="button" data-action="clear-favorite-search">×</button></label><button class="search-submit" type="submit">搜索</button></form><div class="favorite-list">${favorites.length ? favorites.map(favorite => {
        const product = productById(favorite.productId);
        const pending = state.favoritePendingProductId === favorite.productId;
        const media = favorite.primaryImageUrl ? imageMedia({ ...product, image: favorite.primaryImageUrl }, "favorite-thumb result-thumb") : `<div class="favorite-thumb result-thumb"><div class="fallback-pack" data-label="暂不可用"></div></div>`;
        return `<article class="favorite-item" data-favorite-id="${favorite.favoriteId}" data-favorite-status="${favorite.availability}">${media}<button class="favorite-copy" data-favorite-open="${favorite.productId}" ${favorite.availability === "UNAVAILABLE" ? "disabled" : ""}><span class="product-brand">${product.brand}</span><strong>${product.name}</strong><p>${availabilityCopy[favorite.availability]}</p><em>${favorite.minimumActivePrice === null ? "价格不可用" : money(favorite.minimumActivePrice)}</em></button><button class="favorite-remove" data-remove-favorite="${favorite.productId}" aria-label="取消收藏" ${pending ? "disabled" : ""}>${pending ? "…" : "♡"}</button></article>`;
      }).join("") : `<div class="empty-state"><i>♡</i><strong>${keyword ? "没有匹配的收藏" : "还没有收藏商品"}</strong><p>${keyword ? "换个商品名称关键词再试试。" : "在商品详情点击收藏，方便下次找到。"}</p><button class="primary-button" data-screen="home" style="padding:0 18px">去逛逛</button></div>`}</div></div></section>`;
  }

  function renderAccount() {
    const profile = state.profile;
    const nickname = profile.nickname || "微信用户";
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("账户与隐私")}<div class="account-stack"><section class="detail-card account-user"><div class="avatar">${nickname.trim().charAt(0) || "青"}</div><div><strong>${nickname}</strong><p>${profile.city || "城市未设置"} · 微信账户 · CUSTOMER</p></div></section><section class="detail-card privacy-card account-link-card"><div class="card-title"><strong>账户资料</strong></div><button data-action="edit-profile">编辑资料 <span>昵称、头像、城市 ›</span></button><button data-screen="phone-authorization">账户手机号 <span>${state.verifiedPhone?.phone_masked || "未绑定"} ›</span></button></section><section class="detail-card privacy-card session-card"><div class="card-title"><strong>当前会话</strong></div><button data-action="logout">退出当前账号 <span>›</span></button></section><section class="detail-card privacy-card"><div class="card-title"><strong>隐私权利</strong></div><button data-action="privacy-policy">查看隐私政策 <span>›</span></button><button data-screen="account-deletion">注销账号 <span>›</span></button></section></div></div></section>`;
  }

  function renderPhoneAuthorization() {
    const phoneLegalDocument = state.legalDocuments.find(document => document.type === "PHONE_AUTHORIZATION");
    const phoneSourceLabel = state.verifiedPhone?.phone_source === "MOCK" ? "开发态模拟验证" : "微信手机号验证";
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("手机号授权")}<div class="account-stack"><section class="detail-card account-phone"><div class="card-title"><strong>账户手机号</strong><span>独立于收货地址</span></div>${state.verifiedPhone ? `<div class="verified-phone"><span>${state.verifiedPhone.phone_masked}</span><strong>已验证</strong></div><p>来源：${phoneSourceLabel}<br />验证时间：${state.verifiedPhone.phone_verified_at}<br />授权声明：版本 ${phoneLegalDocument.document_version}</p><div class="phone-actions"><button class="secondary-button" data-action="authorize-phone">重新授权</button><button class="secondary-button is-danger" data-action="revoke-phone">撤回授权</button></div>` : `<div class="unverified-phone"><strong>未绑定</strong><p>手机号为可选资料；不会从收货地址读取，也不影响浏览、下单或支付。</p><button class="primary-button" data-action="authorize-phone">授权账户手机号</button></div>`}</section><section class="legal-snapshot" data-phone-legal-snapshot="current"><strong>授权前请阅读</strong><button type="button" data-action="open-legal-document" data-legal-type="PHONE_AUTHORIZATION" data-legal-url="${phoneLegalDocument.content_url}"><span>《${phoneLegalDocument.title}》</span><small data-legal-version="PHONE_AUTHORIZATION">版本 ${phoneLegalDocument.document_version}</small><i>›</i></button></section><div class="inline-alert"><strong>用途与快照</strong><span>页面只展示服务端返回的脱敏号码。撤回授权不修改历史订单中已保存的尾号快照。</span></div></div></div></section>`;
  }

  function renderAccountDeletion() {
    const preview = state.deletionEligibility;
    if (state.accountDeleted) return `<section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("账号注销")}<section class="detail-card success-card"><span class="success-icon">✓</span><h3>账号已注销</h3><p>本地会话已经清除，账户资料已同步去标识化。</p><button class="primary-button" data-screen="login">返回登录</button></section></div></section>`;
    const blockers = preview.blockers.map(item => `<div><span>${item.label}</span><strong>${item.count} 项</strong></div>`).join("");
    const impacts = preview.impacts.map(item => `<p>${item}</p>`).join("");
    const confirmFailure = preview.confirm_status === 422 ? ` data-confirm-status="422" data-error-code="${preview.error_code}"` : "";
    return `
      <section class="app-screen list-page"><div class="screen-scroll">${statusBar()}${header("账号注销")}<div class="account-stack"><section class="detail-card"><div class="card-title"><strong>注销资格预览</strong><span>${!preview.checked ? "尚未检查" : preview.eligible ? "可以注销" : "存在阻断项"}</span></div>${!preview.checked ? `<div class="reservation-card"><small>检查未完成订单、售后、支付退款和财务异常后返回 blockers 与 impacts。</small></div>` : preview.eligible ? `<div class="inline-alert is-success"><strong>资格检查已通过</strong><span>当前没有阻断项，请核对下方同步注销影响。</span></div>` : `<div class="reservation-card" data-preview-status="200" data-eligible="false"${confirmFailure}>${blockers}<small>请先完成或取消阻断业务，再重新检查资格。</small></div>`}</section>${preview.checked ? `<section class="detail-card"><div class="card-title"><strong>注销影响</strong><span>${preview.eligible ? `${preview.confirmation_expires_in_seconds / 60} 分钟内确认` : "仅供预览"}</span></div><div class="policy-copy">${impacts}</div></section>` : ""}${preview.checked && preview.eligible ? `<button class="primary-button is-coral" data-action="request-account-deletion">确认注销账号</button>` : `<button class="primary-button" data-action="preview-account-deletion">检查注销资格</button>`}${preview.checked && !preview.eligible ? `<button class="secondary-button" data-action="simulate-deletion-eligible">演示阻断业务已完成</button>` : ""}<div class="inline-alert"><strong>保留边界</strong><span>交易、退款、佣金、协议同意和审计事实仅按批准的合规策略保留，不能再通过当前资料关联原账户。</span></div></div></div></section>`;
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
      <div class="sheet-section"><div class="sheet-section__head"><span>选择规格</span><span>${isSkuSalable(selectedSku) ? `库存 ${selectedSku.stock} 件` : "暂时售罄"}</span></div><div class="option-row">${publicSkusFor(product).map(sku => `<button class="option-button ${state.selectedSkuId === sku.id ? "is-active" : ""}" data-sku-id="${sku.id}">${sku.name}<small>${isSkuSalable(sku) ? money(sku.price) : `${money(sku.price)} · 售罄`}</small></button>`).join("")}</div></div>
      <div class="sheet-section"><div class="sheet-section__head"><span>购买数量</span><div class="quantity-stepper"><button data-sku-delta="-1" ${isSkuSalable(selectedSku) ? "" : "disabled"}>−</button><span>${isSkuSalable(selectedSku) ? state.quantity : 0}</span><button data-sku-delta="1" ${isSkuSalable(selectedSku) ? "" : "disabled"}>＋</button></div></div></div>
      <div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button ${state.skuIntent === "buy" ? "is-coral" : ""}" data-action="confirm-sku" ${isSkuSalable(selectedSku) ? "" : "disabled"}>${isSkuSalable(selectedSku) ? (state.skuIntent === "buy" ? "确认并结算" : "确认加入购物车") : "当前规格售罄"}</button></div>`;
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
    const agent = state.inviteCandidate || state.serviceAgent;
    const pending = state.candidateDecisionStatus === "PENDING";
    const decisionError = state.candidateDecisionError
      ? `<div class="inline-alert is-error" data-binding-status="409" data-error-code="ATTRIBUTION_CANDIDATE_MISMATCH"><strong>候选信息已变更</strong><span>已刷新当前候选，请重新确认。</span></div>`
      : "";
    const target = state.inviteCandidate
      ? `<div class="binding-target" data-public-target-url="${state.inviteCandidate.public_target_url}"><strong>本次来源</strong><span>青序生活公开商城</span></div>`
      : "";
    return `
      <div class="sheet-handle"></div><div class="binding-sheet" data-binding-decision-status="${state.candidateDecisionStatus}"><span class="binding-sheet__mark">清</span><small>SERVICE INVITATION · 候选剩余 ${candidateRemaining()}</small><h3>确认服务代理</h3><p>您正在通过 <strong>${agent.display_name}</strong> 的邀请进入青序生活。确认后，该服务代理将为您提供选购咨询服务。</p>${target}${decisionError}<div class="binding-assurance"><span>✓</span><div><strong>购物权益不受影响</strong><small>商品价格、支付、发货与售后均由青序生活统一保障。</small></div></div><div class="binding-warning">候选仅保留 30 分钟；绑定后不可自行更换，如归属异常可联系平台客服。</div><div class="sheet-footer"><button class="secondary-button" data-action="decline-agent-binding" ${pending ? "disabled" : ""}>${pending ? "提交中…" : "拒绝并清除"}</button><button class="primary-button" data-action="confirm-agent-binding" ${pending ? "disabled" : ""}>${pending ? "提交中…" : "确认绑定"}</button></div></div>`;
  }

  function submitCandidateDecision(decision) {
    if (state.candidateDecisionStatus === "PENDING") return;
    state.candidateDecisionStatus = "PENDING";
    state.candidateDecisionError = null;
    bottomSheet.innerHTML = agentBindingSheet();
    setTimeout(() => {
      if (!state.inviteCandidate || Date.parse(state.inviteCandidate.expires_at) <= Date.now()) {
        state.inviteCandidate = null;
        state.serviceAgent = null;
        state.candidateDecisionStatus = "IDLE";
        state.agentBindingStatus = "unbound";
        closeSheet();
        render();
        return showToast("服务候选已过期，按直营继续");
      }
      if (state.candidateMismatchNext) {
        state.candidateMismatchNext = false;
        state.candidateDecisionStatus = "ERROR";
        state.candidateDecisionError = "ATTRIBUTION_CANDIDATE_MISMATCH";
        bottomSheet.innerHTML = agentBindingSheet();
        return showToast("候选信息已更新，请重新确认");
      }
      if (state.candidateConcurrentWinner) {
        state.serviceAgent = { ...state.candidateConcurrentWinner };
        state.candidateConcurrentWinner = null;
        state.candidateDecisionStatus = "IDLE";
        state.agentBindingStatus = "bound";
        state.inviteCandidate = null;
        closeSheet();
        render();
        return showToast(`已保留先完成的服务绑定：${state.serviceAgent.display_name}`);
      }
      if (decision === "REJECT") {
        state.agentBindingStatus = "unbound";
        state.inviteCandidate = null;
        state.serviceAgent = null;
        state.candidateDecisionStatus = "IDLE";
        closeSheet();
        render();
        return showToast("已拒绝并清除服务候选");
      }
      state.serviceAgent = { agent_id: state.inviteCandidate.agent_id, display_name: state.inviteCandidate.display_name, bound_at: "2026-08-11T07:01:00Z" };
      state.agentBindingStatus = "bound";
      state.inviteCandidate = null;
      state.candidateDecisionStatus = "IDLE";
      closeSheet();
      render();
      return showToast(`已绑定服务代理：${state.serviceAgent.display_name}`);
    }, 180);
  }

  function phoneSheet() {
    const mutation = state.phoneMutation;
    const isRevoke = mutation.kind === "REVOKE";
    const pending = mutation.status === "PENDING";
    const phoneDocument = state.legalDocuments.find(document => document.type === "PHONE_AUTHORIZATION");
    const consentCurrent = state.phoneAuthorizationConsent?.type === "PHONE_AUTHORIZATION"
      && state.phoneAuthorizationConsent.document_version === phoneDocument.document_version
      && state.phoneAuthorizationConsent.accepted === true;
    const status = mutation.status === "ERROR" ? `<div class="inline-alert is-error"><strong>手机号操作失败</strong><span>已保留当前资料，可直接重试。</span></div>` : mutation.status === "CONFLICT" ? `<div class="inline-alert is-warning" data-phone-error-code="${mutation.error}"><strong>${mutation.error === "CONSENT_VERSION_MISMATCH" ? "授权声明已更新" : "资料已更新"}</strong><span>${mutation.error === "CONSENT_VERSION_MISMATCH" ? "请阅读最新版本并重新同意。" : "已刷新最新版本，请重新确认本次操作。"}</span></div>` : "";
    const consent = isRevoke ? "" : `<button class="consent-row ${consentCurrent ? "is-checked" : ""}" data-action="toggle-phone-consent" data-consent-version="${phoneDocument.document_version}"><i>✓</i><span>我已阅读并同意当前《${phoneDocument.title}》</span></button>`;
    return `<div class="sheet-handle"></div><div class="confirm-sheet phone-mutation-sheet" data-phone-status="${mutation.status}" data-if-match-version="${mutation.expectedVersion}"><span class="confirm-sheet__icon">○</span><h3>${isRevoke ? "撤回手机号授权" : state.verifiedPhone ? "重新授权账户手机号" : "授权账户手机号"}</h3><p>${isRevoke ? "撤回后当前资料不再提供账户手机号；历史订单尾号快照保持不变。" : "服务端按 development 配置验证当前账户手机号。页面只展示脱敏结果，且可随时撤回。"}</p>${status}${consent}<div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button ${isRevoke ? "is-coral" : ""}" data-action="confirm-phone-mutation" ${pending || (!isRevoke && !consentCurrent) ? "disabled" : ""}>${pending ? "提交中…" : mutation.status === "ERROR" ? "重试" : mutation.status === "CONFLICT" ? "重新确认" : isRevoke ? "确认撤回" : "同意并授权"}</button></div></div>`;
  }

  function openPhoneMutation(kind) {
    state.phoneMutation = { kind, status: "IDLE", expectedVersion: state.profile.version, error: null };
    state.phoneAuthorizationConsent = null;
    openSheet(phoneSheet());
  }

  function submitPhoneMutation() {
    if (state.phoneMutation.status === "PENDING") return;
    const phoneDocument = state.legalDocuments.find(document => document.type === "PHONE_AUTHORIZATION");
    if (state.phoneMutation.kind !== "REVOKE" && (!state.phoneAuthorizationConsent || state.phoneAuthorizationConsent.document_version !== phoneDocument.document_version)) {
      state.phoneAuthorizationConsent = null;
      state.phoneMutation.status = "CONFLICT";
      state.phoneMutation.error = "CONSENT_VERSION_MISMATCH";
      bottomSheet.innerHTML = phoneSheet();
      return showToast("授权声明已更新，请重新同意");
    }
    state.phoneMutation.status = "PENDING";
    state.phoneMutation.error = null;
    bottomSheet.innerHTML = phoneSheet();
    setTimeout(() => {
      if (state.phoneFailureNext) {
        state.phoneFailureNext = false;
        state.phoneMutation.status = "ERROR";
        state.phoneMutation.error = "INTERNAL_ERROR";
        bottomSheet.innerHTML = phoneSheet();
        return showToast("手机号验证失败，当前资料未变更");
      }
      if (state.phoneConflictNext || state.phoneMutation.expectedVersion !== state.profile.version) {
        state.phoneConflictNext = false;
        state.profile.version += 1;
        state.phoneMutation.status = "CONFLICT";
        state.phoneMutation.expectedVersion = state.profile.version;
        state.phoneMutation.error = "RESOURCE_VERSION_CONFLICT";
        bottomSheet.innerHTML = phoneSheet();
        return showToast("资料已更新，请重新确认");
      }
      if (state.phoneMutation.kind === "REVOKE") state.verifiedPhone = null;
      else state.verifiedPhone = { phone_tail: "5218", phone_masked: "138 **** 5218", phone_source: "MOCK", phone_verified_at: "2026-08-11T07:06:00Z" };
      state.profile.version += 1;
      const completedKind = state.phoneMutation.kind;
      state.phoneMutation = { kind: null, status: "IDLE", expectedVersion: null, error: null };
      state.phoneAuthorizationConsent = null;
      closeSheet();
      render();
      return showToast(completedKind === "REVOKE" ? "手机号授权已撤回" : "账户手机号已验证");
    }, 180);
  }

  function profileSheet() {
    const profile = state.profile;
    return `<div class="sheet-handle"></div><form class="address-form profile-edit-form" id="profileForm" data-if-match-version="${profile.version}"><div class="card-title"><strong>编辑账户资料</strong><span>已同步最新资料</span></div><label><span>昵称</span><input name="nickname" value="${profile.nickname || ""}" maxlength="80" placeholder="微信用户" /></label><label><span>头像链接</span><input name="avatar_url" value="${profile.avatar_url || ""}" maxlength="500" inputmode="url" placeholder="https://" /></label><label><span>城市</span><input name="city" value="${profile.city || ""}" maxlength="120" placeholder="所在城市" /></label><div class="sheet-footer"><button type="button" class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button" type="submit">保存资料</button></div></form>`;
  }

  function confirmSheet(title, copy, confirmAction, confirmText = "确认") {
    return `<div class="sheet-handle"></div><div class="confirm-sheet"><span class="confirm-sheet__icon">!</span><h3>${title}</h3><p>${copy}</p><div class="sheet-footer"><button class="secondary-button" data-action="close-sheet">取消</button><button class="primary-button is-coral" data-action="${confirmAction}">${confirmText}</button></div></div>`;
  }

  function handleSkuConfirm() {
    const sku = currentProductSku();
    if (!isSkuSalable(sku)) return showToast("当前规格暂时售罄");
    const quantity = Math.min(99, state.quantity, sku.stock);
    if (state.skuIntent === "cart") {
      const cartItems = activeCartItems();
      const existing = cartItems.find(item => item.skuId === sku.id);
      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + quantity, sku.stock);
        existing.selected = true;
        existing.saleStatus = "SALEABLE";
        existing.availableStock = sku.stock;
      } else {
        if (cartItems.length >= 100) return showToast("购物车最多保留 100 种规格");
        cartItems.push({ productId: state.product.id, skuId: sku.id, quantity, selected: true, saleStatus: "SALEABLE", availableStock: sku.stock });
        if (state.loggedIn && state.cartId === null) state.cartId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
      }
      closeSheet();
      return showToast(`已加入购物车 · ${sku.name} × ${quantity}`);
    }
    closeSheet();
    return showToast("立即购买将在 B9 开放，所选规格未丢失");
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

  function currentConsentsAccepted() {
    const loginDocuments = state.legalDocuments.filter(document => loginConsentTypes.has(document.type));
    return state.consentAccepted
      && state.acceptedConsents.length === loginDocuments.length
      && loginDocuments.every(document => state.acceptedConsents.some(consent => consent.type === document.type && consent.document_version === document.document_version && consent.accepted === true));
  }

  function sameGuestCartSnapshot(left, right) {
    return left.productId === right.productId
      && left.skuId === right.skuId
      && left.quantity === right.quantity
      && left.selected === right.selected;
  }

  function applyCartMergeJournal() {
    const journal = state.cartMergeJournal;
    if (!journal || journal.status === "MERGED") return false;
    journal.attempts += 1;
    if (state.cartMergeFailureNext) {
      state.cartMergeFailureNext = false;
      journal.status = "RETRY";
      journal.serverConfirmed = false;
      return false;
    }
    journal.items.forEach(incoming => {
      const existing = state.cart.find(item => item.skuId === incoming.skuId);
      if (existing) {
        existing.quantity = Math.min(99, existing.quantity + incoming.quantity);
        existing.selected = existing.selected || incoming.selected;
      } else state.cart.push(clone(incoming));
    });
    if (state.cartId === null) state.cartId = "01ARZ3NDEKTSV4RRFFQ69G5FB3";
    state.guestCart = state.guestCart.filter(localItem =>
      !journal.items.some(journalItem => sameGuestCartSnapshot(localItem, journalItem)));
    journal.status = "MERGED";
    journal.serverConfirmed = true;
    return true;
  }

  function beginGuestCartMerge() {
    if (!state.guestCart.length) return null;
    if (!state.cartMergeJournal) {
      state.cartMergeJournal = {
        status: "PENDING",
        itemCount: state.guestCart.length,
        idempotencyKey: "b8-guest-cart-merge-0001",
        items: clone(state.guestCart),
        attempts: 0,
        serverConfirmed: false
      };
    }
    return applyCartMergeJournal();
  }

  function completeLogin() {
    if (!currentConsentsAccepted()) {
      state.consentAccepted = false;
      state.acceptedConsents = [];
      render();
      return showToast("协议已更新，请阅读当前版本后重新确认");
    }
    if (state.loginFailureNext) {
      const failure = state.loginFailureNext;
      state.loginFailureNext = null;
      state.loginError = failure === "RATE_LIMITED"
        ? { status: 429, error_code: "RATE_LIMITED", retry_after_seconds: 47 }
        : { status: 500, error_code: "INTERNAL_ERROR", retry_after_seconds: null };
      render();
      return showToast(failure === "RATE_LIMITED" ? "登录尝试过于频繁" : "身份服务暂时不可用");
    }
    state.loginError = null;
    state.loggedIn = true;
    state.authProvider = "MOCK";
    const destination = state.authReturn?.screen || "profile";
    const pendingAction = state.authReturn?.action;
    state.authReturn = null;
    const hadGuestCart = state.guestCart.length > 0;
    const mergeCompleted = beginGuestCartMerge();
    navigate(destination, false);
    if (pendingAction?.type === "favorite") setFavorite(pendingAction.productId, pendingAction.desired);
    else if (hadGuestCart && !mergeCompleted) showToast("登录成功，本地购物车已保留，可使用同一幂等键重试");
    else if (hadGuestCart) showToast("登录成功，游客购物车已合并");
    else showToast(pendingAction ? "登录成功，已返回原页面" : "登录成功");
    if (state.inviteCandidate && Date.parse(state.inviteCandidate.expires_at) > Date.now() && state.agentBindingStatus !== "bound") {
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
      state.selectedSkuId = preferredPublicSku(product).id;
      state.quantity = 1;
      return navigate("product");
    }
    if (target.dataset.favoriteOpen) {
      const favorite = state.favorites.find(item => item.productId === target.dataset.favoriteOpen);
      if (!favorite || favorite.availability === "UNAVAILABLE") return showToast("商品当前不可用，收藏记录仍保留");
      const product = publicProductById(favorite.productId);
      if (!product) return showToast("商品当前不可用，收藏记录仍保留");
      state.product = product;
      state.selectedSkuId = preferredPublicSku(product).id;
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
    if (target.dataset.cartSelect !== undefined) { const item = activeCartItems()[Number(target.dataset.cartSelect)]; if (item?.saleStatus === "SALEABLE") item.selected = !item.selected; return render(); }
    if (target.dataset.cartDelete !== undefined) { activeCartItems().splice(Number(target.dataset.cartDelete), 1); render(); return showToast("商品已从购物车删除"); }
    if (target.dataset.cartQty !== undefined) {
      const index = Number(target.dataset.cartQty);
      const cartItems = activeCartItems();
      const item = cartItems[index];
      if (!item) return;
      const next = item.quantity + Number(target.dataset.delta);
      if (next < 1) { cartItems.splice(index, 1); showToast("商品已移出购物车"); } else item.quantity = Math.min(99, item.availableStock, next);
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
    if (target.dataset.addressEdit) {
      const address = state.addresses.find(item => item.id === target.dataset.addressEdit);
      state.editingAddressId = target.dataset.addressEdit;
      state.addressMutationExpectedVersion = address?.version ?? null;
      state.addressError = null;
      return navigate("address-edit");
    }
    if (target.dataset.addressDelete) {
      const address = state.addresses.find(item => item.id === target.dataset.addressDelete);
      state.editingAddressId = target.dataset.addressDelete;
      state.addressMutationExpectedVersion = address?.version ?? null;
      state.addressError = null;
      return openSheet(confirmSheet("删除收货地址", "删除后不可恢复；若删除默认地址，将按创建时间和地址 ID 提升下一条。", "confirm-delete-address", "确认删除"));
    }
    if (target.dataset.addressDefault) {
      state.addresses.forEach(item => {
        const nextDefault = item.id === target.dataset.addressDefault;
        if (item.isDefault !== nextDefault) item.version += 1;
        item.isDefault = nextDefault;
      });
      state.currentAddressId = target.dataset.addressDefault;
      render();
      return showToast("已设为默认地址");
    }
    if (target.dataset.removeFavorite) return setFavorite(target.dataset.removeFavorite, false);

    const action = target.dataset.action;
    if (!action) return;
    if (action === "back") return goBack();
    if (action === "close-sheet") return closeSheet();
    if (action === "open-sku") { state.skuIntent = "cart"; return openSheet(skuSheet()); }
    if (action === "confirm-sku") return handleSkuConfirm();
    if (action === "favorite") {
      const exists = isFavorite(state.product.id);
      if (!state.loggedIn) return requireLogin("product", { type: "favorite", productId: state.product.id, desired: !exists });
      return setFavorite(state.product.id, !exists);
    }
    if (action === "select-all") { const validItems = activeCartItems().filter(item => item.saleStatus === "SALEABLE"); const shouldSelect = !validItems.every(item => item.selected); validItems.forEach(item => { item.selected = shouldSelect; }); return render(); }
    if (action === "checkout") { if (!activeCartItems().some(item => item.selected && item.saleStatus === "SALEABLE")) return showToast("请先选择可购买商品"); return showToast("结算将在 B9 开放，购物车已保留"); }
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
    if (action === "toggle-consent") {
      state.consentAccepted = !state.consentAccepted;
      state.acceptedConsents = state.consentAccepted
        ? state.legalDocuments.filter(document => loginConsentTypes.has(document.type)).map(document => ({ type: document.type, document_version: document.document_version, accepted: true }))
        : [];
      return render();
    }
    if (action === "open-legal-document") {
      const document = state.legalDocuments.find(item => item.type === target.dataset.legalType);
      return showToast(document ? `已打开${document.title}当前版本` : "协议已更新，请刷新后重试");
    }
    if (action === "mock-login") return completeLogin();
    if (action === "retry-login") { state.loginError = null; render(); return; }
    if (action === "toggle-phone-consent") {
      const phoneDocument = state.legalDocuments.find(document => document.type === "PHONE_AUTHORIZATION");
      state.phoneAuthorizationConsent = state.phoneAuthorizationConsent
        ? null
        : { type: "PHONE_AUTHORIZATION", document_version: phoneDocument.document_version, accepted: true };
      bottomSheet.innerHTML = phoneSheet();
      return;
    }
    if (action === "edit-profile") return openSheet(profileSheet());
    if (action === "logout") return openSheet(confirmSheet("退出当前账号", "退出后仅撤销当前会话；其他设备会话和账户资料保持不变。", "confirm-logout", "确认退出"));
    if (action === "confirm-logout") {
      state.loggedIn = false;
      state.authProvider = null;
      state.authReturn = null;
      state.screen = "login";
      closeSheet();
      render();
      return showToast("当前会话已退出");
    }
    if (action === "deferred-feature") return showToast(`${target.dataset.feature || "此功能"}将在后续阶段开放`);
    if (action === "open-binding") return openSheet(agentBindingSheet());
    if (action === "confirm-agent-binding") return submitCandidateDecision("CONFIRM");
    if (action === "decline-agent-binding") return submitCandidateDecision("REJECT");
    if (action === "choose-address") { state.addressReturnScreen = "checkout"; return navigate("addresses"); }
    if (action === "new-address") { state.editingAddressId = null; state.addressMutationExpectedVersion = null; state.addressError = null; return navigate("address-edit"); }
    if (action === "toggle-address-default") { state.addressError = null; target.classList.toggle("is-on"); return; }
    if (action === "confirm-delete-address") {
      const deletingId = state.editingAddressId;
      const deleting = state.addresses.find(item => item.id === deletingId);
      if (!deleting) return closeSheet();
      if (state.addressConflictNext || state.addressMutationExpectedVersion !== deleting.version) {
        state.addressConflictNext = false;
        deleting.version += 1;
        closeSheet();
        render();
        return showToast("地址已更新，请刷新后重新确认删除");
      }
      state.addresses = state.addresses.filter(item => item.id !== deletingId);
      if (deleting.isDefault) {
        const nextDefault = [...state.addresses].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id))[0];
        if (nextDefault) { nextDefault.isDefault = true; nextDefault.version += 1; }
      }
      state.currentAddressId = state.addresses.find(item => item.isDefault)?.id || null;
      closeSheet(); render(); return showToast("地址已删除");
    }
    if (action === "retry-cart-merge") {
      const idempotencyKey = state.cartMergeJournal?.idempotencyKey;
      const completed = applyCartMergeJournal();
      render();
      return showToast(completed ? `已使用原幂等键 ${idempotencyKey} 完成合并` : "合并已确认，未重复累加");
    }
    if (action === "authorize-phone") return openPhoneMutation(state.verifiedPhone ? "REAUTHORIZE" : "AUTHORIZE");
    if (action === "revoke-phone") return openPhoneMutation("REVOKE");
    if (action === "confirm-phone-mutation") return submitPhoneMutation();
    if (action === "preview-account-deletion") {
      state.deletionEligibility = state.deletionCanProceed
        ? { checked: true, eligible: true, blockers: [], impacts: ["立即撤销全部会话与刷新凭据。", "结束当前服务代理绑定并清除候选。", "去标识化账户资料，删除手机号授权、地址、收藏与购物车项。"], confirmation_expires_in_seconds: 300, confirm_status: null, error_code: null }
        : { checked: true, eligible: false, blockers: [{ resource_type: "ORDER", label: "未完成订单", count: 1 }, { resource_type: "AFTERSALE", label: "未完成售后", count: 1 }, { resource_type: "PAYMENT", label: "未结清支付", count: 1 }, { resource_type: "REFUND", label: "处理中退款", count: 1 }, { resource_type: "FINANCIAL_ANOMALY", label: "财务异常", count: 1 }], impacts: ["资格通过后将立即撤销全部会话。", "当前服务代理绑定、候选和个人资料将同步清理。"], confirmation_expires_in_seconds: null, confirm_status: null, error_code: null };
      render();
      return showToast(state.deletionCanProceed ? "资格预览已更新" : "存在未完成业务，暂不能注销");
    }
    if (action === "simulate-deletion-eligible") { state.deletionCanProceed = true; state.deletionEligibility = { checked: false, eligible: false, blockers: [], impacts: [], confirmation_expires_in_seconds: null, confirm_status: null, error_code: null }; render(); return showToast("阻断业务已完成，请重新检查资格"); }
    if (action === "request-account-deletion") return openSheet(confirmSheet("确认注销账号", "确认后将在本次请求中同步撤销会话、结束服务代理绑定并去标识化资料。此操作不可撤销。", "confirm-account-deletion", "同步注销"));
    if (action === "confirm-account-deletion") {
      if (!state.deletionCanProceed) {
        state.deletionEligibility = { checked: true, eligible: false, blockers: [{ resource_type: "PAYMENT", label: "新出现的未结清支付", count: 1 }], impacts: ["资格重新通过后将同步撤销会话、结束绑定并去标识化资料。"], confirmation_expires_in_seconds: null, confirm_status: 422, error_code: "ACCOUNT_DELETION_BLOCKED" };
        closeSheet();
        render();
        return showToast("账户状态已变化，请处理阻断项后重新预览");
      }
      state.accountDeleted = true;
      state.loggedIn = false;
      state.authProvider = null;
      state.consentAccepted = false;
      state.acceptedConsents = [];
      state.verifiedPhone = null;
      state.agentBindingStatus = "unbound";
      state.serviceAgent = null;
      state.inviteCandidate = null;
      state.addresses = [];
      state.favorites = [];
      state.cart = [];
      state.guestCart = [];
      state.cartMergeJournal = null;
      state.authReturn = null;
      state.screen = "login";
      closeSheet();
      render();
      return showToast("账号已注销，本地会话已清除");
    }
    if (action === "recover-ui") { state.uiRecovered = true; render(); return showToast("网络已恢复，原上下文仍保留"); }
    if (action === "refresh-conflict") return showToast("已刷新最新价格和库存，请重新确认");
    if (action === "retry-home-section") { state.homeSectionStatus[target.dataset.homeSection] = "READY"; render(); return showToast("该区块已恢复"); }
    if (action === "clear-search") { state.searchQuery = ""; state.searchPerformed = false; return render(); }
    if (action === "clear-favorite-search") { state.favoriteKeyword = ""; return render(); }
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
      if (!state.searchQuery) { state.searchPerformed = false; render(); return showToast("请输入商品名称"); }
      state.searchPerformed = true;
      return render();
    }
    if (event.target.id === "addressForm") {
      const data = new FormData(event.target);
      const recipient = String(data.get("recipient") || "").trim();
      const phone = String(data.get("phone") || "").trim();
      const province = String(data.get("province") || "").trim();
      const city = String(data.get("city") || "").trim();
      const district = String(data.get("district") || "").trim();
      const detail = String(data.get("detail") || "").trim();
      const fields = [recipient, province, city, district, detail];
      if (!/^[0-9]{11}$/.test(phone)) return showToast("请输入 11 位数字手机号");
      if (fields.some(value => !value || /[\u0000-\u001F\u007F]/.test(value))) return showToast("地址字段不能为空或包含控制字符");
      if (recipient.length > 80 || [province, city, district].some(value => value.length > 80) || detail.length > 300) return showToast("地址字段长度超出限制");
      const setDefault = event.target.querySelector(".switch-row").classList.contains("is-on");
      const existing = state.addresses.find(item => item.id === state.editingAddressId);
      const expectedVersion = Number(event.target.dataset.ifMatchVersion);
      if (existing && (state.addressConflictNext || expectedVersion !== existing.version)) {
        state.addressConflictNext = false;
        existing.version += 1;
        state.addressMutationExpectedVersion = existing.version;
        state.addressError = "RESOURCE_VERSION_CONFLICT";
        render();
        return showToast("地址已更新，请重新确认");
      }
      if (existing?.isDefault && !setDefault && state.addresses.length > 1) {
        state.addressError = "DEFAULT_ADDRESS_REQUIRED";
        render();
        return showToast("必须保留一个默认地址");
      }
      const payload = { recipient, phone, province, city, district, detail, isDefault: setDefault };
      if (setDefault) state.addresses.forEach(item => {
        if (item.id !== existing?.id && item.isDefault) item.version += 1;
        item.isDefault = false;
      });
      if (existing) Object.assign(existing, payload, { version: existing.version + 1 });
      else {
        Object.assign(payload, { id: "01ARZ3NDEKTSV4RRFFQ69G5FAZ", version: 1, createdAt: new Date().toISOString() });
        state.addresses.push(payload);
        state.editingAddressId = payload.id;
      }
      if (!state.addresses.some(item => item.isDefault)) state.addresses[0].isDefault = true;
      state.currentAddressId = state.addresses.find(item => item.isDefault)?.id || state.editingAddressId;
      state.addressError = null;
      navigate("addresses");
      return showToast("地址已保存");
    }
    if (event.target.id === "favoriteSearchForm") {
      state.favoriteKeyword = String(new FormData(event.target).get("keyword") || event.target.querySelector("#favoriteSearchInput")?.value || "").trim().slice(0, 200);
      return render();
    }
    if (event.target.id === "profileForm") {
      const data = new FormData(event.target);
      const nickname = String(data.get("nickname") || "").trim();
      const avatarUrl = String(data.get("avatar_url") || "").trim();
      const city = String(data.get("city") || "").trim();
      if (avatarUrl && !/^https:\/\//.test(avatarUrl)) return showToast("头像链接必须使用 HTTPS");
      const expectedVersion = Number(event.target.dataset.ifMatchVersion);
      if (state.profileConflictNext || expectedVersion !== state.profile.version) {
        state.profileConflictNext = false;
        state.profile.version += 1;
        closeSheet();
        render();
        return showToast("资料已更新，已刷新最新内容，请重新确认");
      }
      state.profile = {
        nickname: nickname || null,
        avatar_url: avatarUrl || null,
        city: city || null,
        version: state.profile.version + 1
      };
      closeSheet();
      render();
      return showToast("账户资料已保存");
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
  const promotionAssetId = prototypeParams.get("promotion") || "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const requestedBinding = prototypeParams.get("binding");
  const requestedAuth = prototypeParams.get("auth");
  const requestedAfterSale = prototypeParams.get("aftersale");
  const requestedHomeState = prototypeParams.get("home");
  const requestedCartState = prototypeParams.get("cart");
  let inviteNotice = "";
  if (requestedAuth === "guest") state.loggedIn = false;
  if (requestedBinding === "unbound") { state.agentBindingStatus = "unbound"; state.serviceAgent = null; }
  if (inviteCode) {
    const invitedAgent = inviteAgents[inviteCode];
    if (!invitedAgent || !ulidPattern.test(promotionAssetId)) inviteNotice = "邀请信息无效或已失效，未覆盖已有服务候选";
    else if (state.agentBindingStatus === "unbound") {
      state.inviteCandidate = { candidate_id: "01ARZ3NDEKTSV4RRFFQ69G5FAW", agent_id: invitedAgent.agent_id, display_name: invitedAgent.display_name, confirmation_required: true, attribution_eligible: true, public_target_url: "https://mall.qingxu.example/", expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(), remaining_seconds: 1800 };
      state.agentBindingStatus = state.loggedIn ? "pending" : "candidate";
    } else inviteNotice = `您已绑定 ${state.serviceAgent.display_name}，本次邀请不改变归属`;
  }
  if (requestedAfterSale === "failed") state.currentAfterSaleId = "AS202608030006";
  if (requestedHomeState === "partial") state.homeSectionStatus.categories = "UNAVAILABLE";
  if (requestedCartState === "empty") { state.cart = []; state.guestCart = []; state.cartId = null; state.cartMergeJournal = null; }
  if (requestedCartState === "guest-merge") {
    state.guestCart = clone(guestCartMergeFixture);
    state.cartMergeJournal = null;
    state.cartMergeFailureNext = true;
  }
  if (requestedCartState === "limit" && activeCartItems()[0]) activeCartItems()[0].quantity = 99;
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

  window.__MINIAPP_PROTOTYPE__ = {
    getState: () => clone(state),
    products: clone(products),
    simulateLegalRevision: () => {
      state.legalDocuments = state.legalDocuments.map(document => ({ ...document, document_version: `${document.document_version}-next` }));
    },
    simulateDeletionBlocker: () => { state.deletionCanProceed = false; },
    simulateProfileConflict: () => { state.profileConflictNext = true; },
    simulateAddressConflict: () => { state.addressConflictNext = true; },
    simulateLoginFailure: failure => { state.loginFailureNext = failure; },
    simulatePhoneConflict: () => { state.phoneConflictNext = true; },
    simulatePhoneFailure: () => { state.phoneFailureNext = true; },
    simulateCandidateMismatch: () => { state.candidateMismatchNext = true; },
    simulateCandidateExpired: () => { if (state.inviteCandidate) state.inviteCandidate.expires_at = new Date(Date.now() - 1000).toISOString(); },
    simulateCandidateConcurrentWinner: () => { state.candidateConcurrentWinner = { ...inviteAgents["QX-A1038"] }; }
  };
  render();
  if (state.agentBindingStatus === "pending") setTimeout(() => openSheet(agentBindingSheet()), 120);
  else if (inviteNotice) setTimeout(() => showToast(inviteNotice), 120);
})();
