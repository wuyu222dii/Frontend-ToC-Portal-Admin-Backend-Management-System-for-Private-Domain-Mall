(function () {
  "use strict";

  const pageTitles = {
    dashboard: "数据看板",
    products: "商品管理",
    brands: "品牌管理",
    categories: "分类管理",
    banners: "Banner 管理",
    inventory: "库存中心",
    "product-edit": "商品编辑",
    orders: "订单管理",
    "order-detail": "订单详情",
    aftersales: "售后审核",
    customers: "客户管理",
    agents: "代理管理",
    "commission-rules": "统一佣金规则",
    withdrawals: "提现审核",
    "business-rules": "业务规则",
    "audit-logs": "审计日志"
  };

  const products = [
    { id: 1, name: "植萃研氨基酸净澈洁面乳 120g", brand: "植萃研", category: "护肤品", code: "QY-CLEAN-001", sales: 1826, status: "ACTIVE", version: 6, publishedAt: "2026-07-18 09:20", imageCount: 3, isHot: true, isNew: false, art: "art-green" },
    { id: 2, name: "沐光无硅油蓬松洗发水 500ml", brand: "沐光", category: "洗发水", code: "QY-HAIR-018", sales: 1432, status: "ACTIVE", version: 4, publishedAt: "2026-07-22 14:08", imageCount: 2, isHot: true, isNew: false, art: "art-blue" },
    { id: 3, name: "青木序积雪草舒缓修护霜 50g", brand: "青木序", category: "护肤品", code: "QY-SKIN-027", sales: 986, status: "ACTIVE", version: 3, publishedAt: "2026-07-28 10:16", imageCount: 4, isHot: false, isNew: false, art: "art-coral" },
    { id: 4, name: "净简酵素浓缩洗衣凝珠 30颗", brand: "净简", category: "家庭清洁", code: "QY-HOME-008", sales: 862, status: "ACTIVE", version: 5, publishedAt: "2026-08-01 08:30", imageCount: 3, isHot: true, isNew: false, art: "art-amber" },
    { id: 5, name: "植萃研烟酰胺焕亮精华液 30ml", brand: "植萃研", category: "护肤品", code: "QY-SKIN-031", sales: 748, status: "ACTIVE", version: 4, publishedAt: "2026-08-03 11:25", imageCount: 5, isHot: false, isNew: true, art: "art-purple" },
    { id: 6, name: "沐光白茶香氛沐浴露 500ml", brand: "沐光", category: "沐浴露", code: "QY-BODY-012", sales: 635, status: "ACTIVE", version: 3, publishedAt: "2026-08-05 16:40", imageCount: 3, isHot: false, isNew: true, art: "art-coral" },
    { id: 7, name: "青木序轻透倍护防晒乳 SPF50+", brand: "青木序", category: "防晒产品", code: "QY-SUN-006", sales: 528, status: "INACTIVE", version: 4, publishedAt: "2026-07-10 09:05", imageCount: 2, isHot: false, isNew: false, art: "art-blue" },
    { id: 8, name: "净简柑橘厨房重油污清洁剂", brand: "净简", category: "家庭清洁", code: "QY-HOME-021", sales: 0, status: "DRAFT", version: 1, publishedAt: null, imageCount: 0, isHot: false, isNew: true, art: "art-green" }
  ];

  const orders = [
    { id: "QY202608060028", customer: "林晓月", phone: "138****6821", avatar: "林", product: "氨基酸洁面乳两支装", count: 3, amount: "384.00", payment: "微信支付", status: "待发货", orderStatus: "PENDING_SHIPMENT", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "READY_TO_SHIP", closeReason: null, displayStatus: "待发货", time: "08-06 09:18", arts: ["art-green"] },
    { id: "QY202608060027", customer: "周敏", phone: "186****3096", avatar: "周", product: "无硅油蓬松洗发水", count: 1, amount: "89.00", payment: "微信支付", status: "退款售后", orderStatus: "COMPLETED", paymentStatus: "PAID", refundStatus: "FULL", fulfillmentStatus: "DELIVERED", closeReason: null, displayStatus: "退款售后", time: "08-06 09:02", arts: ["art-blue"] },
    { id: "QY202608060026", customer: "陈嘉禾", phone: "159****2218", avatar: "陈", product: "酵素浓缩洗衣凝珠", count: 2, amount: "84.00", payment: "微信支付", status: "运输中", orderStatus: "SHIPPING", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "IN_TRANSIT", closeReason: null, displayStatus: "运输中", time: "08-06 08:46", arts: ["art-amber"] },
    { id: "QY202608060025", customer: "赵倩", phone: "133****5107", avatar: "赵", product: "积雪草舒缓修护霜", count: 1, amount: "109.00", payment: "微信支付", status: "已完成", orderStatus: "COMPLETED", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "DELIVERED", closeReason: null, displayStatus: "已完成", time: "08-06 08:25", arts: ["art-coral"] },
    { id: "QY202608060024", customer: "王悦", phone: "137****8432", avatar: "王", product: "白茶香氛沐浴露等 3 款", count: 5, amount: "326.00", payment: "微信支付", status: "待付款", orderStatus: "PENDING_PAYMENT", paymentStatus: "UNPAID", refundStatus: "NONE", fulfillmentStatus: "NOT_STARTED", closeReason: null, displayStatus: "待付款", time: "08-06 08:12", arts: ["art-coral", "art-purple"] },
    { id: "QY202608060023", customer: "刘雨晴", phone: "188****0076", avatar: "刘", product: "烟酰胺焕亮精华液", count: 1, amount: "139.00", payment: "微信支付", status: "待发货", orderStatus: "PENDING_SHIPMENT", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "READY_TO_SHIP", closeReason: null, displayStatus: "待发货", time: "08-06 07:58", arts: ["art-purple"] },
    { id: "QY202608060022", customer: "何文", phone: "135****6190", avatar: "何", product: "氨基酸洁面乳旅行装", count: 2, amount: "50.00", payment: "微信支付", status: "运输中", orderStatus: "SHIPPING", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "IN_TRANSIT", closeReason: null, displayStatus: "运输中", time: "08-06 07:31", arts: ["art-green"] },
    { id: "QY202608060021", customer: "孙可心", phone: "180****4175", avatar: "孙", product: "轻透倍护防晒乳", count: 1, amount: "99.00", payment: "微信支付", status: "待付款", orderStatus: "PENDING_PAYMENT", paymentStatus: "UNPAID", refundStatus: "NONE", fulfillmentStatus: "NOT_STARTED", closeReason: null, displayStatus: "待付款", time: "08-06 07:16", arts: ["art-blue"] }
  ];

  const aftersales = [
    { id: "AS202608060004", order: "QY202608060023", customer: "刘雨晴", product: "植萃研烟酰胺焕亮精华液", sku: "SERUM-030", quantity: 1, type: "仅退款", amount: "139.00", reason: "重复下单", status: "待审核", statusCode: "PENDING_REVIEW", fulfillment: "UNSHIPPED", time: "08-06 09:16", art: "art-purple", reserved: true, restock: true, commissionSnapshot: 13.9 },
    { id: "AS202608060003", order: "QY202608060027", customer: "周敏", product: "沐光无硅油蓬松洗发水", sku: "HAIR-500", quantity: 1, type: "仅退款", amount: "89.00", reason: "拍错了，不想要了", status: "待审核", statusCode: "PENDING_REVIEW", fulfillment: "DELIVERED", time: "08-06 09:11", art: "art-blue", reserved: true, restock: false, commissionSnapshot: 7.12 },
    { id: "AS202608060002", order: "QY202608050186", customer: "宋宁", product: "植萃研氨基酸净澈洁面乳", sku: "CLEAN-120", quantity: 1, type: "退货退款", amount: "59.00", reason: "收到后包装破损", status: "待审核", statusCode: "PENDING_REVIEW", fulfillment: "DELIVERED", time: "08-06 08:42", art: "art-green", reserved: true, restock: true, commissionSnapshot: 5.9 },
    { id: "AS202608060001", order: "QY202608050142", customer: "顾安", product: "青木序积雪草舒缓修护霜", sku: "SKIN-050", quantity: 1, type: "仅退款", amount: "109.00", reason: "重复下单", status: "退款失败", statusCode: "REFUND_FAILED", fulfillment: "UNSHIPPED", time: "08-06 08:05", art: "art-coral", reserved: true, restock: true, commissionSnapshot: 10.9, refundAttempt: 1 },
    { id: "AS202608050012", order: "QY202608040095", customer: "赵倩", product: "净简酵素浓缩洗衣凝珠", sku: "HOME-030", quantity: 2, type: "退货退款", amount: "84.00", reason: "商品与描述不符", status: "待验货", statusCode: "WAITING_INSPECTION", fulfillment: "DELIVERED", time: "08-05 16:28", art: "art-amber", reserved: true, restock: true, commissionSnapshot: 4.2, returnCarrier: "中通快递", returnTracking: "RETURN-DEMO-052" },
    { id: "AS202608050009", order: "QY202608030251", customer: "王悦", product: "沐光白茶香氛沐浴露", sku: "BODY-500", quantity: 1, type: "退货退款", amount: "69.00", reason: "不喜欢香味", status: "待退款", statusCode: "REFUNDING", fulfillment: "DELIVERED", time: "08-05 13:42", art: "art-coral", reserved: true, restock: false, commissionSnapshot: 4.83 },
    { id: "AS202608040018", order: "QY202608020176", customer: "何文", product: "植萃研烟酰胺焕亮精华液", sku: "SERUM-030", quantity: 1, type: "仅退款", amount: "139.00", reason: "物流长期未更新", status: "已完成", statusCode: "COMPLETED", fulfillment: "DELIVERED", time: "08-04 17:16", art: "art-purple", reserved: false, restock: false, commissionSnapshot: 13.9 }
  ];

  const customers = [
    { id: 1, name: "林晓月", nickname: "Moon", phone: "138****6821", phoneSource: "微信授权 · 已验证", city: "广东省深圳市", spend: 3286, orders: 18, recent: "氨基酸洁面乳", recentDate: "今天 09:18", joined: "2025-11-18", lastVisit: "今天 09:17", avatar: "林", agentId: "A1038", agentName: "清源生活馆", agentBoundAt: "2026-07-18 14:26" },
    { id: 2, name: "周敏", nickname: "Mina", phone: "186****3096", phoneSource: "微信授权 · 已验证", city: "广东省珠海市", spend: 1688, orders: 9, recent: "无硅油洗发水", recentDate: "今天 09:02", joined: "2026-01-08", lastVisit: "今天 09:01", avatar: "周", agentId: "A1038", agentName: "清源生活馆", agentBoundAt: "2026-07-28 09:16" },
    { id: 3, name: "陈嘉禾", nickname: "嘉禾", phone: "159****2218", phoneSource: "微信授权 · 已验证", city: "浙江省绍兴市", spend: 892, orders: 6, recent: "浓缩洗衣凝珠", recentDate: "今天 08:46", joined: "2026-03-22", lastVisit: "今天 08:44", avatar: "陈", agentId: "A1026", agentName: "清悦日用馆", agentBoundAt: "2026-06-12 11:40" },
    { id: 4, name: "赵倩", nickname: "Zoe", phone: "133****5107", phoneSource: "微信授权 · 已验证", city: "浙江省杭州市", spend: 4290, orders: 26, recent: "积雪草修护霜", recentDate: "今天 08:25", joined: "2025-08-16", lastVisit: "今天 08:22", avatar: "赵", agentId: null, agentName: "平台直接客户", agentBoundAt: "2026-05-08 16:08" },
    { id: 5, name: "王悦", nickname: "悦悦", phone: "137****8432", phoneSource: "微信授权 · 已验证", city: "浙江省湖州市", spend: 2386, orders: 13, recent: "白茶香氛沐浴露", recentDate: "今天 08:12", joined: "2025-12-09", lastVisit: "今天 08:10", avatar: "王", agentId: "A1019", agentName: "简木洗护顾问", agentBoundAt: "2026-04-20 10:32" },
    { id: 6, name: "刘雨晴", nickname: "Yuki", phone: "188****0076", phoneSource: "微信授权 · 已验证", city: "浙江省嘉兴市", spend: 658, orders: 4, recent: "烟酰胺焕亮精华", recentDate: "今天 07:58", joined: "2026-05-19", lastVisit: "今天 07:55", avatar: "刘", agentId: "A1026", agentName: "清悦日用馆", agentBoundAt: "2026-07-09 18:26" },
    { id: 7, name: "孙可心", nickname: "Kira", phone: null, phoneSource: "未绑定 · 未授权", city: "浙江省金华市", spend: 1928, orders: 11, recent: "轻透倍护防晒乳", recentDate: "今天 07:16", joined: "2026-02-14", lastVisit: "今天 07:14", avatar: "孙", agentId: null, agentName: "平台直接客户", agentBoundAt: "2026-02-14 12:06" }
  ];

  const agents = [
    { id: "A1038", name: "清源生活馆", account: "qingyuan.store", contact: "安然 138****3916", createdAt: "2026-03-18", invite: "QX-A1038", inviteStatus: "有效", inviteExpiresAt: "2026-12-31", authMode: "全部在售商品", authorizedCount: 116, whitelist: [], customers: 386, sales: 86420, available: 4820.6, frozen: 2680, negative: 0, bank: "招商银行", cardLast4: "3916", status: "已启用", avatar: "清" },
    { id: "A1026", name: "清悦日用馆", account: "qingyue.store", contact: "陈悦 186****2077", createdAt: "2026-04-09", invite: "QX-A1026", inviteStatus: "有效", inviteExpiresAt: "2026-10-31", authMode: "自定义白名单", authorizedCount: 3, whitelist: [1, 2, 4], customers: 274, sales: 62180, available: 3686.2, frozen: 1200, negative: 0, bank: "中国建设银行", cardLast4: "2077", status: "已启用", avatar: "悦" },
    { id: "A1019", name: "简木洗护顾问", account: "jianmu.care", contact: "林木 159****6128", createdAt: "2026-02-16", invite: "QX-A1019", inviteStatus: "有效", inviteExpiresAt: "长期", authMode: "全部在售商品", authorizedCount: 116, whitelist: [], customers: 226, sales: 58960, available: 5218.4, frozen: 3200, negative: 0, bank: "中国工商银行", cardLast4: "6128", status: "已启用", avatar: "简" },
    { id: "A1012", name: "素研生活家", account: "suyan.life", contact: "徐研 137****4632", createdAt: "2025-12-08", invite: "QX-A1012", inviteStatus: "已停用", inviteExpiresAt: "-", authMode: "自定义白名单", authorizedCount: 2, whitelist: [3, 5], customers: 198, sales: 41860, available: 0, frozen: 0, negative: 328.5, bank: "中国农业银行", cardLast4: "4632", status: "已启用", avatar: "素" },
    { id: "A1007", name: "白茶日用馆", account: "baicha.store", contact: "宋宁 135****7810", createdAt: "2025-09-21", invite: "QX-A1007", inviteStatus: "已停用", inviteExpiresAt: "-", authMode: "全部在售商品", authorizedCount: 116, whitelist: [], customers: 184, sales: 36240, available: 896.8, frozen: 0, negative: 0, bank: "中国银行", cardLast4: "7810", status: "已停用", avatar: "白" }
  ];

  const commissionRuleSet = { platformRate: 5 };
  const commissionCategories = [
    { id: "CAT-SKIN", name: "护肤品", productCount: 36, activeProductCount: 36, skuCount: 52, rate: 10, overrideCount: 1, updated: "08-11 10:18", sort: 10, status: "ACTIVE", version: 7 },
    { id: "CAT-HAIR", name: "洗发水", productCount: 18, activeProductCount: 18, skuCount: 27, rate: 8, overrideCount: 1, updated: "08-11 09:42", sort: 20, status: "ACTIVE", version: 4 },
    { id: "CAT-BODY", name: "沐浴露", productCount: 16, activeProductCount: 16, skuCount: 25, rate: 7, overrideCount: 0, updated: "08-10 17:06", sort: 30, status: "ACTIVE", version: 3 },
    { id: "CAT-SUN", name: "防晒产品", productCount: 9, activeProductCount: 0, skuCount: 12, rate: 9, overrideCount: 0, updated: "08-10 16:28", sort: 40, status: "INACTIVE", version: 5 },
    { id: "CAT-FRAGRANCE", name: "香水", productCount: 12, activeProductCount: 0, skuCount: 19, rate: 8, overrideCount: 0, updated: "08-09 15:12", sort: 50, status: "DRAFT", version: 2 },
    { id: "CAT-MAKEUP", name: "彩妆", productCount: 14, activeProductCount: 14, skuCount: 31, rate: 10, overrideCount: 1, updated: "08-11 08:56", sort: 60, status: "ACTIVE", version: 6 },
    { id: "CAT-MEN", name: "男士护理", productCount: 11, activeProductCount: 0, skuCount: 16, rate: 7, overrideCount: 0, updated: "08-08 13:20", sort: 70, status: "ARCHIVED", version: 4, deletedAt: "2026-08-08 13:20" },
    { id: "CAT-HOME", name: "家庭清洁", productCount: 20, activeProductCount: 20, skuCount: 34, rate: 5, overrideCount: 1, updated: "08-11 08:16", sort: 80, status: "ACTIVE", version: 8 }
  ];

  const commissionSkuRules = [
    { id: "CLEAN-120X2", name: "植萃研氨基酸净澈洁面乳", spec: "120g 两支装", brand: "植萃研", category: "护肤品", price: 128, rate: 12, art: "art-green", updated: "08-11 10:18" },
    { id: "HAIR-500R", name: "沐光无硅油蓬松洗发水", spec: "500ml 补充装", brand: "沐光", category: "洗发水", price: 79, rate: 6.5, art: "art-blue", updated: "08-11 09:42" },
    { id: "MAKEUP-GIFT", name: "青木序轻盈通勤彩妆礼盒", spec: "限定礼盒", brand: "青木序", category: "彩妆", price: 199, rate: 12, art: "art-coral", updated: "08-11 08:56" },
    { id: "HOME-021", name: "净简柑橘厨房重油污清洁剂", spec: "临期批次 500ml", brand: "净简", category: "家庭清洁", price: 39, rate: 0, art: "art-amber", updated: "08-11 08:16" },
    { id: "CLEAN-120", name: "植萃研氨基酸净澈洁面乳", spec: "120g 单支", brand: "植萃研", category: "护肤品", price: 69, rate: null, art: "art-green", updated: "继承中" },
    { id: "HAIR-500", name: "沐光无硅油蓬松洗发水", spec: "500ml 正装", brand: "沐光", category: "洗发水", price: 89, rate: null, art: "art-blue", updated: "继承中" },
    { id: "BODY-500", name: "沐光白茶香氛沐浴露", spec: "500ml 正装", brand: "沐光", category: "沐浴露", price: 79, rate: null, art: "art-coral", updated: "继承中" },
    { id: "SUN-050", name: "青木序轻透倍护防晒乳", spec: "50ml 正装", brand: "青木序", category: "防晒产品", price: 119, rate: null, art: "art-blue", updated: "继承中" }
  ];

  const withdrawals = [
    { id: "WD202608100021", agentId: "A1038", agent: "清源生活馆", amount: 2680, holder: "安然", bank: "招商银行", card: "**** **** **** 3916", status: "待审核", statusCode: "PENDING", time: "08-10 09:26", proof: false },
    { id: "WD202608100018", agentId: "A1026", agent: "清悦日用馆", amount: 1200, holder: "陈悦", bank: "中国建设银行", card: "**** **** **** 2077", status: "待审核", statusCode: "PENDING", time: "08-10 08:42", proof: false },
    { id: "WD202608090086", agentId: "A1019", agent: "简木洗护顾问", amount: 3200, holder: "林木", bank: "中国工商银行", card: "**** **** **** 6128", status: "待打款", statusCode: "APPROVED", time: "08-09 16:18", proof: false },
    { id: "WD202608080052", agentId: "A1038", agent: "清源生活馆", amount: 1800, holder: "安然", bank: "招商银行", card: "**** **** **** 3916", status: "已打款", statusCode: "PAID", time: "08-08 11:06", proof: true },
    { id: "WD202608070031", agentId: "A1007", agent: "白茶日用馆", amount: 980, holder: "宋宁", bank: "中国银行", card: "**** **** **** 7810", status: "已拒绝", statusCode: "REJECTED", time: "08-07 14:32", proof: false }
  ];

  const brands = [
    { id: "BR-ZCY", name: "植萃研", description: "温和植萃清洁与肌肤护理", activeProductCount: 36, sort: 10, status: "ACTIVE", version: 6, avatar: "植" },
    { id: "BR-MG", name: "沐光", description: "日常洗护与身体清洁", activeProductCount: 28, sort: 20, status: "ACTIVE", version: 4, avatar: "沐" },
    { id: "BR-QMX", name: "青木序", description: "敏感肌修护与日常防晒", activeProductCount: 31, sort: 30, status: "ACTIVE", version: 5, avatar: "青" },
    { id: "BR-JJ", name: "净简", description: null, activeProductCount: 0, sort: 40, status: "INACTIVE", version: 3, avatar: "净" },
    { id: "BR-ARCHIVED", name: "旧日研", description: "已归档演示记录", activeProductCount: 0, sort: 50, status: "ARCHIVED", version: 2, deletedAt: "2026-08-07 10:20", avatar: "旧" }
  ];

  const inventorySkus = [
    { id: "CLEAN-120", product: "植萃研氨基酸净澈洁面乳", spec: "120g 单支", art: "art-green", available: 286, paymentReserved: 8, aftersaleReserved: 2, warning: 30 },
    { id: "CLEAN-120X2", product: "植萃研氨基酸净澈洁面乳", spec: "120g 两支装", art: "art-green", available: 96, paymentReserved: 3, aftersaleReserved: 0, paymentReservationOrderId: "QY202608060028", warning: 20 },
    { id: "HAIR-500", product: "沐光无硅油蓬松洗发水", spec: "500ml 正装", art: "art-blue", available: 16, paymentReserved: 6, aftersaleReserved: 1, warning: 20 },
    { id: "HAIR-500R", product: "沐光无硅油蓬松洗发水", spec: "500ml 补充装", art: "art-blue", available: 52, paymentReserved: 4, aftersaleReserved: 0, warning: 15 },
    { id: "CLEAN-030", product: "植萃研氨基酸净澈洁面乳", spec: "30g 旅行装", art: "art-green", available: 42, paymentReserved: 0, aftersaleReserved: 0, warning: 10 },
    { id: "BODY-500", product: "沐光白茶香氛沐浴露", spec: "500ml 正装", art: "art-coral", available: 120, paymentReserved: 10, aftersaleReserved: 3, warning: 30 },
    { id: "BODY-1000", product: "沐光白茶香氛沐浴露", spec: "500ml × 2", art: "art-coral", available: 46, paymentReserved: 2, aftersaleReserved: 0, warning: 15 },
    { id: "BODY-REFILL", product: "沐光白茶香氛沐浴露", spec: "400ml 补充装", art: "art-coral", available: 20, paymentReserved: 1, aftersaleReserved: 0, warning: 10 },
    { id: "SKIN-050", product: "青木序积雪草舒缓修护霜", spec: "50g 正装", art: "art-coral", available: 16, paymentReserved: 4, aftersaleReserved: 1, warning: 15 },
    { id: "SERUM-030", product: "植萃研烟酰胺焕亮精华液", spec: "30ml 正装", art: "art-purple", available: 8, paymentReserved: 1, aftersaleReserved: 1, warning: 12 },
    { id: "HOME-030", product: "净简酵素浓缩洗衣凝珠", spec: "30 颗", art: "art-amber", available: 238, paymentReserved: 7, aftersaleReserved: 0, warning: 40 },
    { id: "HOME-060", product: "净简酵素浓缩洗衣凝珠", spec: "60 颗", art: "art-amber", available: 80, paymentReserved: 2, aftersaleReserved: 0, warning: 20 },
    { id: "SUN-050", product: "青木序轻透倍护防晒乳", spec: "50ml 正装", art: "art-blue", available: 1, paymentReserved: 1, aftersaleReserved: 0, warning: 20 },
    { id: "HOME-021", product: "净简柑橘厨房重油污清洁剂", spec: "500ml", art: "art-green", available: 0, paymentReserved: 0, aftersaleReserved: 0, warning: 12 }
  ];

  const banners = [
    { id: "BN-01", name: "植萃修护季", detail: "SPU-202608-001", start: "2026-08-01", end: "2026-08-31", sort: 1, status: "已启用", tone: "green-banner" },
    { id: "BN-02", name: "盛夏清爽洗护", detail: "CAT-HAIR", start: "2026-08-10", end: "2026-09-10", sort: 2, status: "已启用", tone: "blue-banner" },
    { id: "BN-03", name: "家庭清洁焕新", detail: "CAT-HOME", start: "2026-08-01", end: "2026-12-31", sort: 3, status: "已停用", tone: "coral-banner" }
  ];

  const productDetails = Object.fromEntries(products.map((product) => [product.id, {
    sellingPoint: `${product.brand} ${product.category}代表商品，突出温和有效与日常使用体验。`,
    intro: `${product.name} 的商品介绍按当前商品记录独立保存，不复用其他商品内容。`,
    ingredients: product.category === "家庭清洁" ? "表面活性剂、酵素复合物、香氛成分。" : "水、甘油、核心植物提取物及配方所需成分。",
    usage: product.category === "家庭清洁" ? "按包装建议用量投入对应清洁场景，避免儿童接触。" : "取适量均匀涂抹或清洁，按商品包装建议频次使用。",
    favorites: Math.max(0, Math.round(product.sales / 5))
  }]));

  const productSkus = {
    1: [{ spec: "120g 单支", id: "CLEAN-120", price: 69, status: "ACTIVE", version: 3, isRecommended: true }, { spec: "120g 两支装", id: "CLEAN-120X2", price: 128, status: "ACTIVE", version: 2, isRecommended: false }, { spec: "30g 旅行装", id: "CLEAN-030", price: 29, status: "ACTIVE", version: 2, isRecommended: false }],
    2: [{ spec: "500ml 正装", id: "HAIR-500", price: 89, status: "ACTIVE", version: 2, isRecommended: true }, { spec: "500ml 补充装", id: "HAIR-500R", price: 79, status: "ACTIVE", version: 2, isRecommended: false }],
    3: [{ spec: "50g 正装", id: "SKIN-050", price: 129, status: "ACTIVE", version: 2, isRecommended: true }],
    4: [{ spec: "30 颗", id: "HOME-030", price: 49, status: "ACTIVE", version: 2, isRecommended: true }, { spec: "60 颗", id: "HOME-060", price: 84, status: "ACTIVE", version: 2, isRecommended: false }],
    5: [{ spec: "30ml 正装", id: "SERUM-030", price: 159, status: "ACTIVE", version: 2, isRecommended: true }],
    6: [{ spec: "500ml 正装", id: "BODY-500", price: 79, status: "ACTIVE", version: 2, isRecommended: true }, { spec: "500ml × 2", id: "BODY-1000", price: 139, status: "ACTIVE", version: 2, isRecommended: false }, { spec: "400ml 补充装", id: "BODY-REFILL", price: 59, status: "ACTIVE", version: 2, isRecommended: false }],
    7: [{ spec: "50ml 正装", id: "SUN-050", price: 119, status: "INACTIVE", version: 3, isRecommended: false }],
    8: [{ spec: "500ml", id: "HOME-021", price: 39, status: "INACTIVE", version: 1, isRecommended: false }]
  };

  function inventoryForProduct(productId) {
    const skuIds = new Set((productSkus[productId] || []).map((sku) => sku.id));
    return inventorySkus.filter((item) => skuIds.has(item.id));
  }

  function inventorySnapshot(item) {
    const locked = item.paymentReserved + item.aftersaleReserved;
    return { physical: item.available, locked, available: Math.max(0, item.available - locked) };
  }

  function productInventorySnapshot(productId) {
    return inventoryForProduct(productId).reduce((sum, item) => {
      const snapshot = inventorySnapshot(item);
      sum.skuCount += 1;
      sum.physical += snapshot.physical;
      sum.locked += snapshot.locked;
      sum.available += snapshot.available;
      return sum;
    }, { skuCount: 0, physical: 0, locked: 0, available: 0 });
  }

  const inventoryLedger = {
    "CLEAN-120": [{ time: "08-10 16:20", delta: 40, result: 286, reason: "采购入库", actor: "林老板" }],
    "HAIR-500": [{ time: "08-11 09:12", delta: -2, result: 16, reason: "盘点修正", actor: "仓库管理员" }]
  };

  const businessRules = {
    AFTERSALE_DAYS: { value: 7, unit: "天", version: 3, label: "售后申请期", impact: "调整后仅影响新完成订单，已完成订单保留原售后截止时间。" },
    MIN_WITHDRAWAL: { value: 100, unit: "元", version: 3, label: "最低提现金额", impact: "调整后仅校验新提现申请，不改变待审核、待打款申请。" }
  };

  const auditLogs = [
    { id: "AUD-20260811-0387", time: "08-11 11:31:12", type: "代理状态", actor: "林老板", target: "A1038 清源生活馆", reason: "运营档案定期复核", result: "目标代理状态与权限无变更", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0388", time: "08-11 11:29:46", type: "代理状态", actor: "林老板", target: "A1026 清悦日用馆", reason: "白名单范围定期复核", result: "目标代理审计摘要已生成", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0386", time: "08-11 11:26:18", type: "佣金规则", actor: "林老板", target: "SKU CLEAN-120X2", reason: "双支装毛利调整", result: "CR-20260811-04", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0385", time: "08-11 11:20:06", type: "业务规则", actor: "林老板", target: "CH-003 规则集", reason: "三端逻辑补齐", result: "BR-20260811-03", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0384", time: "08-11 10:58:42", type: "敏感查看", actor: "林老板", target: "WD202608090086", reason: "线下打款核对", result: "60 秒单次授权", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0383", time: "08-11 10:42:12", type: "客户归属", actor: "林老板", target: "客户 Moon", reason: "邀请归属异常核对", result: "A1026 → A1038", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0382", time: "08-11 10:18:30", type: "提现", actor: "林老板", target: "WD202608100018", reason: "账户姓名不一致", result: "已拒绝并解冻", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0381", time: "08-11 09:56:10", type: "代理状态", actor: "林老板", target: "A1007 白茶日用馆", reason: "合作暂停", result: "已停用", client: "Web · 10.8.0.16", status: "成功" },
    { id: "AUD-20260811-0380", time: "08-11 09:41:52", type: "佣金规则", actor: "林老板", target: "分类 CAT-SKIN", reason: "版本冲突演示", result: "请刷新后重试", client: "Web · 10.8.0.16", status: "冲突" }
  ];

  const orderDetailOverrides = {
    QY202608060028: {
      address: "广东省 深圳市 南山区 粤海街道 科技园南区 18 栋 1206",
      agent: "清源生活馆",
      version: "CR-20260811-03",
      items: [
        { name: "植萃研氨基酸净澈洁面乳", brand: "植萃研", art: "art-green", sku: "120g 两支装 · CLEAN-120X2", quantity: 3, price: 128, base: 384, rate: 12, source: "SKU 覆盖规则", commission: 46.08 }
      ]
    },
    QY202608060027: {
      address: "广东省 珠海市 香洲区 情侣中路 88 号",
      agent: "清源生活馆",
      version: "CR-20260811-03",
      items: [{ name: "沐光无硅油蓬松洗发水", brand: "沐光", art: "art-blue", sku: "500ml 正装 · HAIR-500", quantity: 1, price: 89, base: 89, rate: 8, source: "一级分类“洗发水”", commission: 7.12, refundDebit: 7.12 }]
    }
  };

  const paymentSnapshotItems = {
    QY202608060026: [{ name: "净简酵素浓缩洗衣凝珠", brand: "净简", art: "art-amber", sku: "30 颗 · HOME-030", quantity: 2, price: 42, base: 84, rate: 5, source: "一级分类“家庭清洁”", commission: 4.2 }],
    QY202608060025: [{ name: "青木序积雪草舒缓修护霜", brand: "青木序", art: "art-coral", sku: "50g 正装 · SKIN-050", quantity: 1, price: 109, base: 109, rate: 10, source: "一级分类“护肤品”", commission: 10.9 }],
    QY202608060024: [{ name: "待付款订单商品快照", brand: "沐光", art: "art-coral", sku: "多规格 · PENDING", quantity: 5, price: 65.2, base: 326, rate: 0, source: "待支付，尚未生成佣金快照", commission: 0 }],
    QY202608060023: [{ name: "植萃研烟酰胺焕亮精华液", brand: "植萃研", art: "art-purple", sku: "30ml 正装 · SERUM-030", quantity: 1, price: 139, base: 139, rate: 10, source: "一级分类“护肤品”", commission: 13.9 }],
    QY202608060022: [{ name: "植萃研氨基酸净澈洁面乳旅行装", brand: "植萃研", art: "art-green", sku: "30g 旅行装 · CLEAN-030", quantity: 2, price: 25, base: 50, rate: 10, source: "一级分类“护肤品”", commission: 5 }],
    QY202608060021: [{ name: "青木序轻透倍护防晒乳", brand: "青木序", art: "art-blue", sku: "50ml 正装 · SUN-050", quantity: 1, price: 99, base: 99, rate: 9, source: "一级分类“防晒产品”", commission: 8.91 }]
  };

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  const frozenOrderDetails = Object.fromEntries(orders.map((order) => {
    const customer = customers.find((entry) => entry.name === order.customer);
    const override = orderDetailOverrides[order.id] || {};
    const items = override.items || paymentSnapshotItems[order.id];
    if (!items) throw new Error(`Missing immutable payment snapshot for ${order.id}`);
    return [order.id, deepFreeze({
      address: override.address || `${customer ? customer.city : "收货城市未记录"} · 详细地址按订单创建时快照保存`,
      agent: override.agent || (customer ? customer.agentName : "平台直接客户"),
      version: override.version || (order.paymentStatus === "PAID" ? "CR-20260811-03" : "PENDING_PAYMENT"),
      customerSnapshot: customer ? { avatar: customer.avatar, name: customer.name, phone: customer.phone, city: customer.city } : { avatar: order.avatar, name: order.customer, phone: order.phone, city: "" },
      items: items.map((item) => ({ ...item }))
    })];
  }));

  const commissionLedger = [
    { agentId: "A1038", type: "CREDIT", order: "QY202608060027", sku: "HAIR-500", detail: "净商品额 ¥89.00 × 8.00% · 一级分类“洗发水” · CR-20260811-03", amount: 7.12 },
    { agentId: "A1038", type: "REFUND_DEBIT", order: "AS202608060003", sku: "HAIR-500", detail: "按原 CREDIT 快照追加退款冲正；原正向流水不修改", amount: -7.12 },
    { agentId: "A1038", type: "CANCELLED", order: "QY202608050142", sku: "SKIN-050", detail: "订单完成前全额退款，取消预计佣金 · 原 ESTIMATE 保留", amount: -10.9 },
    { agentId: "A1038", type: "FREEZE", order: "WD202608100021", sku: "-", detail: "提现申请冻结 · 08-10 09:26", amount: -2680 },
    { agentId: "A1026", type: "CREDIT", order: "QY202608060026", sku: "HOME-030", detail: "净商品额 ¥84.00 × 5.00% · 家庭清洁 · CR-20260811-03", amount: 4.2 },
    { agentId: "A1012", type: "REFUND_DEBIT", order: "AS202608040018", sku: "SERUM-030", detail: "退款冲正超过可提现，形成负余额", amount: -328.5 }
  ];

  const state = {
    page: "dashboard",
    chartRange: 7,
    reportRange: "day",
    reportDate: "2026-08-10",
    reportMonth: "2026-08",
    reportStatus: "ready",
    reportRequestTimer: null,
    rankingType: "product",
    activeProductId: null,
    activeProductImageCount: 0,
    productReadOnly: false,
    activeAftersaleId: null,
    activeOrderId: "QY202608060028",
    activeAgentId: null,
    activeCustomerId: null,
    activeWithdrawalId: null,
    paymentProofReady: false,
    oneTimeCredentials: null,
    bankRevealContext: null,
    bankRevealTimer: null,
    activeCommissionRule: null,
    commissionRuleMode: "custom",
    commissionRuleRevision: 3,
    pendingHighRiskAction: null,
    highRiskRepairAction: null,
    bankVerifyFailures: 0,
    bankVerifyLockedUntil: 0,
    bankRevealGrant: null,
    loginFailures: 0,
    loginLockedUntil: 0,
    activeEntity: null,
    activeInventorySku: null,
    inventoryViewOnly: false,
    activeAgentDrilldown: "customers",
    activeBusinessRule: null,
    financialSubmitting: false,
    shippingSubmitting: false,
    aftersaleSubmitting: false,
    commissionRuleSubmitting: false,
    highRiskSubmitting: false,
    activeCustomerOrderFilter: null,
    inspectionEvidenceDraft: [],
    inspectionEvidenceSequence: 0
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
      "待验货": "warning",
      "退款失败": "danger",
      "已拒绝": "neutral",
      "已下架": "neutral",
      "已归档": "neutral",
      "草稿": "neutral",
      "DRAFT": "neutral",
      "ACTIVE": "success",
      "INACTIVE": "neutral",
      "ARCHIVED": "neutral",
      "已启用": "success",
      "已停用": "neutral",
      "待打款": "purple",
      "已打款": "success",
      "成功": "success",
      "冲突": "danger",
      "正常": "success",
      "低库存": "warning",
      "缺货": "danger"
    }[status] || "neutral";
  }

  function catalogStatusLabel(status) {
    return { DRAFT: "草稿", ACTIVE: "已启用", INACTIVE: "已停用", ARCHIVED: "已归档" }[status] || status;
  }

  function selectProductEditorTab(tab) {
    $$('[data-edit-tab]').forEach((item) => item.classList.toggle("active", item.dataset.editTab === tab));
    $$('[data-edit-panel]').forEach((panel) => panel.classList.toggle("active", panel.dataset.editPanel === tab));
  }

  let toastTimer;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function setOperationBusy(operation, busy) {
    const stateKey = operation === "aftersale" ? "aftersaleSubmitting" : "financialSubmitting";
    state[stateKey] = busy;
    $("#appShell").dataset[`${operation}Busy`] = String(busy);
  }

  function showApp() {
    $("#loginView").hidden = true;
    $("#appShell").hidden = false;
    $("#appShell").dataset.aftersaleBusy = String(state.aftersaleSubmitting);
    $("#appShell").dataset.financialBusy = String(state.financialSubmitting);
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

  function activeProductSkus(productId) {
    return (productSkus[productId] || []).filter((sku) => sku.status === "ACTIVE");
  }

  function minimumActivePrice(productId) {
    const prices = activeProductSkus(productId).map((sku) => sku.price);
    return prices.length ? Math.min(...prices) : null;
  }

  function productActions(product) {
    if (product.status === "ARCHIVED") return `<button class="icon-button view-product" type="button" title="查看归档商品">${icon("eye")}</button><button class="button text restore-product" type="button">恢复</button>`;
    const lifecycle = [];
    if (["DRAFT", "INACTIVE"].includes(product.status)) lifecycle.push(`<button class="button text product-lifecycle" type="button" data-lifecycle-action="ACTIVATE">启用</button>`);
    if (product.status === "ACTIVE") lifecycle.push(`<button class="button text product-lifecycle" type="button" data-lifecycle-action="DEACTIVATE">停用</button>`);
    if (["DRAFT", "INACTIVE"].includes(product.status)) lifecycle.push(`<button class="icon-button danger product-lifecycle" type="button" data-lifecycle-action="SOFT_DELETE" title="归档商品">${icon("trash")}</button>`);
    return `<button type="button" class="icon-button edit-product" title="编辑商品">${icon("edit")}</button>${lifecycle.join("")}`;
  }

  function renderProducts() {
    const keyword = $("#productSearch").value.trim().toLowerCase();
    const category = $("#productCategory").value;
    const brand = $("#productBrand").value;
    const status = $("#productStatus").value;
    const filtered = products
      .filter((product) => {
        const matchesKeyword = !keyword || `${product.name}${product.code}${product.brand}`.toLowerCase().includes(keyword);
        const matchesStatus = status ? product.status === status : product.status !== "ARCHIVED";
        return matchesKeyword && matchesStatus && (!category || product.category === category) && (!brand || product.brand === brand);
      })
      .sort((a, b) => {
        if (a.publishedAt && b.publishedAt) return b.publishedAt.localeCompare(a.publishedAt) || b.id - a.id;
        if (a.publishedAt) return -1;
        if (b.publishedAt) return 1;
        return b.id - a.id;
      });

    $("#productCount").textContent = `共 ${filtered.length} 件商品`;
    $("#productRows").innerHTML = filtered.length ? filtered.map((product) => {
      const inventory = productInventorySnapshot(product.id);
      const low = inventory.available <= 20;
      const skuCount = (productSkus[product.id] || []).length;
      const activeSkuCount = activeProductSkus(product.id).length;
      const activePrice = minimumActivePrice(product.id);
      return `<tr data-product-id="${product.id}">
        <td><div class="product-cell">${renderProductArt(product.art, product.brand)}<div class="product-cell-copy"><strong title="${product.name}">${product.name}</strong><span>${product.code} · v${product.version}</span></div></div></td>
        <td><span class="cell-main product-minimum-price">${activePrice === null ? "暂无活动价" : money(activePrice)}</span><span class="cell-sub">${activePrice === null ? "无已启用 SKU" : "已启用 SKU 最低价"}</span></td>
        <td><div class="product-inventory-summary ${low ? "low" : ""}" aria-label="SKU 与库存只读摘要"><strong>${skuCount} SKU · ${activeSkuCount} 个已启用</strong><span>实物 ${inventory.physical} · 锁定 ${inventory.locked}</span><em>可售 ${inventory.available}</em></div></td>
        <td class="optional-wide"><span class="cell-main">${product.sales.toLocaleString("zh-CN")}</span><span class="cell-sub">累计销量</span></td>
        <td><span class="tag product-status ${statusClass(product.status)}" data-status-code="${product.status}">${catalogStatusLabel(product.status)}</span><span class="cell-sub product-published-at">${product.publishedAt ? `首次 ${product.publishedAt}` : "尚未发布"}</span></td>
        <td class="optional-wide"><span class="tag ${product.isHot ? "success" : "neutral"}">${product.isHot ? "HOT" : "非热销"}</span><span class="cell-sub">${product.isNew ? "NEW" : "常规"}</span></td>
        <td><div class="row-actions">${productActions(product)}</div></td>
      </tr>`;
      }).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("search")}<strong>没有找到匹配商品</strong><span>请调整搜索词或筛选条件</span></div></td></tr>`;
  }

  function renderBrands() {
    const keyword = $("#brandSearch").value.trim().toLowerCase();
    const status = $("#brandStatus").value;
    const filtered = brands
      .filter((brand) => (!keyword || brand.name.toLowerCase().includes(keyword)) && (status ? brand.status === status : brand.status !== "ARCHIVED"))
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    $("#brandCount").textContent = `共 ${filtered.length} 个品牌`;
    $("#brandRows").innerHTML = filtered.length ? filtered.map((brand) => `<tr data-brand-id="${brand.id}"><td><div class="customer-cell"><span class="avatar soft-green">${brand.avatar}</span><div><span class="cell-main">${brand.name}</span><span class="cell-sub">品牌 ID 由服务端生成</span></div></div></td><td>${brand.description || "-"}</td><td>${brand.sort}</td><td><span class="tag ${statusClass(brand.status)}">${brand.status}</span></td><td>v${brand.version}</td><td><div class="row-actions">${entityActions("brand", brand)}</div></td></tr>`).join("") : `<tr><td colspan="6"><div class="empty-state">${icon("star")}<strong>没有匹配品牌</strong><span>请调整搜索或状态筛选</span></div></td></tr>`;
  }

  function renderCategoryManagement() {
    const keyword = $("#categorySearch").value.trim().toLowerCase();
    const status = $("#categoryStatus").value;
    const filtered = commissionCategories
      .filter((category) => (!keyword || category.name.toLowerCase().includes(keyword)) && (status ? category.status === status : category.status !== "ARCHIVED"))
      .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
    $("#categoryCount").textContent = `共 ${filtered.length} 个一级分类`;
    $("#categoryManageRows").innerHTML = filtered.length ? filtered.map((category) => `<tr data-category-id="${category.id}"><td><span class="cell-main">${category.name}</span><span class="cell-sub">分类 ID 由服务端生成</span></td><td>${category.sort}</td><td><span class="tag ${statusClass(category.status)}">${category.status}</span></td><td>v${category.version}</td><td><div class="row-actions">${entityActions("category", category)}</div></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty-state">${icon("search")}<strong>没有匹配分类</strong><span>请调整搜索或状态筛选</span></div></td></tr>`;
  }

  function entityActions(type, item) {
    if (item.status === "ARCHIVED") return `<button class="button text restore-entity" type="button" data-entity-type="${type}">恢复</button>`;
    const editClass = type === "brand" ? "edit-brand" : "edit-category";
    const lifecycle = [];
    if (["DRAFT", "INACTIVE"].includes(item.status)) lifecycle.push(`<button class="button text entity-lifecycle" type="button" data-entity-type="${type}" data-lifecycle-action="ACTIVATE">启用</button>`);
    if (item.status === "ACTIVE") lifecycle.push(`<button class="button text entity-lifecycle" type="button" data-entity-type="${type}" data-lifecycle-action="DEACTIVATE">停用</button>`);
    if (["DRAFT", "INACTIVE"].includes(item.status)) lifecycle.push(`<button class="icon-button danger entity-lifecycle" type="button" data-entity-type="${type}" data-lifecycle-action="SOFT_DELETE" title="归档">${icon("trash")}</button>`);
    return `<button class="icon-button ${editClass}" type="button" title="编辑${type === "brand" ? "品牌" : "分类"}">${icon("edit")}</button>${lifecycle.join("")}`;
  }

  function renderBanners() {
    $("#bannerManageGrid").innerHTML = banners.slice().sort((a, b) => a.sort - b.sort).map((banner) => `<article class="banner-manage-card" data-banner-id="${banner.id}"><div class="banner-preview ${banner.tone}"><span>${String(banner.sort).padStart(2, "0")} · 首页广告位</span><strong>${banner.name}</strong><small>跳转目标：${banner.detail}</small></div><dl><div><dt>投放时间</dt><dd>${banner.start.slice(5)} 至 ${banner.end.slice(5)}</dd></div><div><dt>跳转目标</dt><dd>${banner.detail}</dd></div><div><dt>状态</dt><dd><span class="tag ${statusClass(banner.status)}">${banner.status === "已启用" ? "投放中" : "已暂停"}</span></dd></div></dl><div><button class="button secondary small edit-banner" type="button">编辑</button><button class="switch banner-toggle ${banner.status === "已启用" ? "active" : ""}" type="button" aria-pressed="${banner.status === "已启用"}"><i></i></button></div></article>`).join("");
  }

  function inventoryState(item) {
    if (item.available === 0) return "缺货";
    if (item.available <= item.warning) return "低库存";
    return "正常";
  }

  function renderInventory() {
    const keyword = $("#inventorySearch").value.trim().toLowerCase();
    const status = $("#inventoryStatus").value;
    const filtered = inventorySkus.filter((item) => (!keyword || `${item.product}${item.spec}${item.id}`.toLowerCase().includes(keyword)) && (!status || inventoryState(item) === status));
    $("#inventoryCount").textContent = `共 ${filtered.length} 个 SKU`;
    $("#inventoryRows").innerHTML = filtered.length ? filtered.map((item) => {
      const shippable = Math.max(0, item.available - item.paymentReserved - item.aftersaleReserved);
      const stockStatus = inventoryState(item);
      return `<tr data-inventory-id="${item.id}"><td><div class="product-cell">${renderProductArt(item.art, "")}<div class="product-cell-copy"><strong>${item.product}</strong><span>${item.spec} · ${item.id}</span></div></div></td><td><span class="cell-main">${item.available}</span></td><td>${item.paymentReserved}</td><td><span class="${item.aftersaleReserved ? "coral-text" : ""}">${item.aftersaleReserved}</span></td><td><strong>${shippable}</strong></td><td>${item.warning}</td><td><span class="tag ${statusClass(stockStatus)}">${stockStatus}</span></td><td><div class="row-actions"><button class="button text inventory-adjust" type="button">调整</button><button class="icon-button inventory-flow" type="button" title="查看库存流水">${icon("eye")}</button></div></td></tr>`;
    }).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("package")}<strong>没有匹配库存记录</strong><span>请调整 SKU 关键词或状态</span></div></td></tr>`;
  }

  function renderAuditLogs() {
    const keyword = $("#auditSearch").value.trim().toLowerCase();
    const type = $("#auditType").value;
    const filtered = auditLogs.filter((item) => (!keyword || `${item.id}${item.actor}${item.target}${item.reason}${item.result}`.toLowerCase().includes(keyword)) && (!type || item.type === type));
    $("#auditCount").textContent = `共 ${filtered.length} 条高风险日志`;
    $("#auditRows").innerHTML = filtered.length ? filtered.map((item) => `<tr><td><span class="cell-main">${item.time}</span><span class="cell-sub">${item.id}</span></td><td><span class="tag info">${item.type}</span></td><td>${item.actor}<span class="cell-sub">超级管理员</span></td><td>${item.target}</td><td><span class="cell-main">${item.reason}</span><span class="cell-sub">${item.result}</span></td><td>${item.client}</td><td><span class="tag ${statusClass(item.status)}">${item.status}</span></td></tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("clock")}<strong>没有匹配审计日志</strong><span>审计记录不会被删除，可调整筛选条件</span></div></td></tr>`;
  }

  function activeAftersaleForOrder(orderId) {
    return aftersales.find((item) => item.order === orderId && !["COMPLETED", "REJECTED", "REJECTED_AFTER_RETURN", "CANCELLED"].includes(item.statusCode));
  }

  function canShipOrder(order) {
    return Boolean(order && order.status === "待发货" && !activeAftersaleForOrder(order.id));
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
      <td><div class="row-actions">${order.status === "待发货" ? (canShipOrder(order) ? `<button type="button" class="button text ship-order">发货</button>` : `<button type="button" class="button text ship-order" disabled title="活动售后占用阻断整单">售后占用</button>`) : ""}<button type="button" class="icon-button view-order" title="查看订单">${icon("eye")}</button></div></td>
    </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("orders")}<strong>没有找到匹配订单</strong><span>可尝试更换订单状态或搜索条件</span></div></td></tr>`;
  }

  function renderDashboardOrders() {
    $("#dashboardOrders").innerHTML = orders.slice(0, 5).map((order) => `<tr data-order-id="${order.id}"><td><button class="order-number view-order" type="button">${order.id}</button></td><td>${order.customer}</td><td>${order.product}</td><td><span class="cell-main">${money(order.amount)}</span></td><td><span class="tag ${statusClass(order.status)}">${order.status}</span></td><td>${order.time}</td><td><button type="button" class="icon-button view-order" title="查看订单">${icon("eye")}</button></td></tr>`).join("");
  }

  function renderRankings() {
    const customerMode = state.rankingType === "customer";
    const periodLabel = state.reportRange === "month" ? "所选月份" : "所选日期";
    $("#rankingTitle").textContent = customerMode ? "客户消费排行" : "商品销量排行";
    $("#rankingSubtitle").textContent = customerMode ? `${periodLabel}有效净消费额` : `${periodLabel}支付件数`;
    $("#rankingList").innerHTML = customerMode
      ? customers.slice().sort((a, b) => b.spend - a.spend).slice(0, 5).map((customer, index) => `<div class="ranking-item"><span class="ranking-number">${index + 1}</span><span class="avatar soft-green">${customer.avatar}</span><div class="ranking-copy"><strong>${customer.name} <small class="muted">@${customer.nickname}</small></strong><span>${customer.orders} 次消费 · ${customer.agentName}</span></div><strong>¥${customer.spend.toLocaleString("zh-CN")}</strong></div>`).join("")
      : products.slice().sort((a, b) => b.sales - a.sales).slice(0, 5).map((product, index) => `<div class="ranking-item"><span class="ranking-number">${index + 1}</span>${renderProductArt(product.art, product.brand)}<div class="ranking-copy"><strong title="${product.name}">${product.name}</strong><span>${product.category} · 实物 ${productInventorySnapshot(product.id).physical}</span></div><strong>${product.sales.toLocaleString("zh-CN")} 件</strong></div>`).join("");
  }

  function renderReportRange() {
    const month = state.reportRange === "month";
    const [year, monthNumber] = state.reportMonth.split("-").map(Number);
    const monthEnd = String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0");
    $("#dashboardDayInput").hidden = month;
    $("#dashboardMonthInput").hidden = !month;
    $("#dashboardDayInput").value = state.reportDate;
    $("#dashboardMonthInput").value = state.reportMonth;
    $("#dashboardReportCaption").textContent = month ? `月报 · ${state.reportMonth}-01 至 ${state.reportMonth}-${monthEnd} 的经营情况。` : `日报 · ${state.reportDate} 的经营情况。`;
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
    $("#dashboardAgentSales").textContent = month ? "¥ 186,240" : "¥ 8,420";
    $("#dashboardActiveAgents").textContent = month ? "24" : "9";
    $("#dashboardNewBindings").textContent = month ? "18" : "4";
    renderRankings();
  }

  function selectedReportLabel() {
    return state.reportRange === "month" ? `${state.reportMonth} 月报` : `${state.reportDate} 日报`;
  }

  function renderReportState() {
    const statePanel = $("#dashboardReportState");
    const dataPanel = $("#dashboardReportData");
    const ready = state.reportStatus === "ready";
    statePanel.hidden = ready;
    dataPanel.hidden = !ready;
    $("#dashboardReportQuery").disabled = state.reportStatus === "loading";
    if (ready) {
      statePanel.innerHTML = "";
      if (state.page === "dashboard") requestAnimationFrame(drawSalesChart);
      return;
    }
    const label = selectedReportLabel();
    if (state.reportStatus === "loading") {
      statePanel.innerHTML = `<div class="report-state-content loading">${icon("clock")}<strong>报表加载中</strong><span>正在读取 ${label}，筛选条件已保留。</span><div class="report-loading-lines" aria-hidden="true"><i></i><i></i></div></div>`;
      return;
    }
    if (state.reportStatus === "empty") {
      statePanel.innerHTML = `<div class="report-state-content empty">${icon("search")}<strong>暂无报表数据</strong><span>${label} 没有有效支付或退款记录，可更换日期后查询。</span></div>`;
      return;
    }
    statePanel.innerHTML = `<div class="report-state-content error">${icon("alert")}<strong>报表加载失败</strong><span>网络请求未完成，${label} 与日报/月报筛选均已保留。</span><button id="dashboardReportRetry" class="button secondary" type="button">重新加载</button></div>`;
  }

  function requestDashboardReport(forceRetry = false) {
    clearTimeout(state.reportRequestTimer);
    state.reportStatus = "loading";
    renderReportState();
    state.reportRequestTimer = setTimeout(() => {
      const emptyFixture = state.reportRange === "day" && state.reportDate === "2026-08-11";
      const errorFixture = state.reportRange === "day" && state.reportDate === "2026-08-09" && !forceRetry;
      state.reportStatus = errorFixture ? "error" : emptyFixture ? "empty" : "ready";
      renderReportRange();
      renderReportState();
    }, 220);
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
    $("#aftersaleRows").innerHTML = filtered.length ? filtered.map((item) => `<tr data-aftersale-id="${item.id}" data-status-code="${item.statusCode}"><td><span class="cell-main">${item.id}</span><span class="cell-sub">订单 ${item.order}</span></td><td>${item.customer}</td><td><div class="product-cell">${renderProductArt(item.art, "")}<div class="product-cell-copy"><strong>${item.product}</strong><span>1 件</span></div></div></td><td><span class="tag ${item.type === "仅退款" ? "info" : "purple"}">${item.type}</span></td><td><span class="cell-main coral-text">${money(item.amount)}</span></td><td>${item.reason}</td><td><span class="tag ${statusClass(item.status)}">${item.status}</span></td><td class="optional-wide">${item.time}</td><td><div class="row-actions">${item.status === "待审核" ? `<button type="button" class="button text review-aftersale">审核</button>` : `<button type="button" class="button text review-aftersale">详情</button>`}</div></td></tr>`).join("") : `<tr><td colspan="9"><div class="empty-state">${icon("return")}<strong>没有匹配的售后申请</strong><span>当前筛选条件下暂无数据</span></div></td></tr>`;
  }

  function renderCustomers() {
    const keyword = $("#customerSearch").value.trim().toLowerCase();
    const filtered = customers.filter((customer) => {
      const matches = !keyword || `${customer.name}${customer.nickname}${customer.phone || "未绑定"}`.toLowerCase().includes(keyword);
      return matches;
    });
    $("#customerCount").textContent = `共 ${filtered.length} 位客户`;
    $("#customerRows").innerHTML = filtered.length ? filtered.map((customer) => {
      const aov = Math.round(customer.spend / customer.orders);
      return `<tr data-customer-id="${customer.id}"><td><div class="customer-cell"><span class="avatar soft-green">${customer.avatar}</span><div><span class="cell-main">${customer.name} <small class="muted">@${customer.nickname}</small></span><span class="cell-sub">${customer.phone || "手机号未绑定"}</span></div></div></td><td><span class="cell-main">¥${customer.spend.toLocaleString("zh-CN")}</span></td><td>${customer.orders} 次</td><td class="optional-wide">¥${aov}</td><td><span class="cell-main">${customer.recent}</span><span class="cell-sub">${customer.recentDate}</span></td><td class="optional-wide">${customer.joined}</td><td><button type="button" class="icon-button view-customer" title="查看客户详情">${icon("eye")}</button></td></tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("users")}<strong>没有找到匹配客户</strong><span>请调整搜索关键词</span></div></td></tr>`;
  }

  function renderAgents() {
    const keyword = $("#agentSearch").value.trim().toLowerCase();
    const status = $("#agentStatus").value;
    const filtered = agents.filter((agent) => {
      const matches = !keyword || `${agent.name}${agent.account}${agent.invite}`.toLowerCase().includes(keyword);
      const matchesStatus = !status || (status === "本期活跃" ? agent.sales > 0 : agent.status === status);
      return matches && matchesStatus;
    });
    $("#agentCount").textContent = `共 ${filtered.length} 个代理`;
    $("#agentRows").innerHTML = filtered.length ? filtered.map((agent) => `<tr data-agent-id="${agent.id}">
      <td><div class="agent-cell"><span class="avatar soft-green">${agent.avatar}</span><div><strong>${agent.name}</strong><span>${agent.account} · ${agent.contact}</span></div></div></td>
      <td><span class="cell-main">统一商品规则</span><span class="cell-sub">SKU &gt; 分类 &gt; 平台</span></td>
      <td><button class="invite-code copy-agent-invite" type="button" title="复制邀请码">${agent.invite}${icon("copy")}</button></td>
      <td><span class="cell-main">${agent.customers.toLocaleString("zh-CN")}</span><span class="cell-sub">有效归属</span></td>
      <td><span class="cell-main">¥${agent.sales.toLocaleString("zh-CN")}</span><span class="cell-sub">本月净商品额</span></td>
      <td><span class="cell-main ${agent.negative > 0 ? "negative-balance" : ""}">¥${agent.available.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span><span class="cell-sub">${agent.negative > 0 ? `负余额 ¥${agent.negative.toFixed(2)}` : `冻结 ¥${agent.frozen.toFixed(2)}`}</span></td>
      <td><span class="cell-main">${agent.createdAt}</span><span class="cell-sub">开通时间</span></td>
      <td><span class="tag ${statusClass(agent.status)}">${agent.status}</span></td>
      <td><div class="row-actions"><button class="icon-button view-agent" type="button" title="查看代理">${icon("eye")}</button><button class="icon-button edit-agent" type="button" title="编辑代理">${icon("edit")}</button><button class="button text toggle-agent" type="button">${agent.status === "已启用" ? "停用" : "启用"}</button></div></td>
    </tr>`).join("") : `<tr><td colspan="9"><div class="empty-state">${icon("users")}<strong>没有找到匹配代理</strong><span>请调整搜索或状态筛选</span></div></td></tr>`;
  }

  function categoryRate(categoryName) {
    const category = commissionCategories.find((item) => item.name === categoryName);
    return category && category.rate !== null ? category.rate : commissionRuleSet.platformRate;
  }

  function renderCommissionRules() {
    $("#ruleVersionBadge").innerHTML = `${icon("shield")}当前版本 CR-20260811-${String(state.commissionRuleRevision).padStart(2, "0")}`;
    $("#platformDefaultMetric").textContent = `${commissionRuleSet.platformRate.toFixed(2)}%`;
    $("#platformDefaultRate").textContent = `${commissionRuleSet.platformRate.toFixed(2)}%`;
    $("#commissionCategoryRows").innerHTML = commissionCategories.map((category) => {
      const inherited = category.rate === null;
      const effectiveRate = inherited ? commissionRuleSet.platformRate : category.rate;
      return `<tr data-category-id="${category.id}">
        <td><span class="cell-main">${category.name}</span><span class="cell-sub">${category.id}</span></td>
        <td><span class="cell-main">${category.productCount} 件商品</span><span class="cell-sub">${category.skuCount} 个 SKU</span></td>
        <td><span class="rate-value">${effectiveRate.toFixed(2)}%</span><span class="cell-sub">${inherited ? "继承平台默认" : "分类单独设置"}</span></td>
        <td><span class="rule-source ${inherited ? "platform" : "category"}">${inherited ? "平台默认" : "一级分类"}</span></td>
        <td><span class="cell-main">${commissionSkuRules.filter((rule) => rule.rate !== null && rule.category === category.name).length} 个</span><span class="cell-sub">优先于本规则</span></td>
        <td>${category.updated}</td>
        <td><button class="icon-button edit-category-rule" type="button" title="编辑分类佣金规则">${icon("edit")}</button></td>
      </tr>`;
    }).join("");

    const keyword = $("#commissionSkuSearch") ? $("#commissionSkuSearch").value.trim().toLowerCase() : "";
    const categoryFilter = $("#commissionSkuCategory") ? $("#commissionSkuCategory").value : "";
    const visibleSkuRules = commissionSkuRules.filter((rule) => {
      const matchesKeyword = !keyword || `${rule.name}${rule.spec}${rule.id}${rule.brand}`.toLowerCase().includes(keyword);
      return matchesKeyword && (!categoryFilter || rule.category === categoryFilter);
    });
    const overrideCount = commissionSkuRules.filter((rule) => rule.rate !== null).length;
    $("#skuOverrideMetric").textContent = overrideCount;
    $("#skuTabCount").textContent = commissionSkuRules.length;
    $("#commissionSkuCount").textContent = `共 ${visibleSkuRules.length} 个 SKU · ${overrideCount} 个例外`;
    $("#commissionSkuRows").innerHTML = visibleSkuRules.length ? visibleSkuRules.map((rule) => {
      const inheritedRate = categoryRate(rule.category);
      const effectiveRate = rule.rate === null ? inheritedRate : rule.rate;
      const isInherited = rule.rate === null;
      const isZero = effectiveRate === 0;
      return `<tr data-sku-rule-id="${rule.id}">
        <td><div class="product-cell">${renderProductArt(rule.art, rule.brand)}<div class="product-cell-copy"><strong title="${rule.name}">${rule.name}</strong><span>${rule.spec} · ${rule.id}</span></div></div></td>
        <td><span class="cell-main">${rule.category}</span><span class="cell-sub">分类 ${inheritedRate.toFixed(2)}%</span></td>
        <td><span class="cell-main">${money(rule.price)}</span></td>
        <td><span class="rate-value muted-rate">${inheritedRate.toFixed(2)}%</span><span class="cell-sub">一级分类</span></td>
        <td><span class="rate-value ${isZero ? "zero-rate" : ""}">${effectiveRate.toFixed(2)}%</span><span class="cell-sub">${isInherited ? "继续继承" : isZero ? "明确不计佣" : "覆盖分类比例"}</span></td>
        <td><span class="cell-main ${isZero ? "muted" : "positive-text"}">${money(rule.price * effectiveRate / 100)}</span><span class="cell-sub">按当前零售价估算</span></td>
        <td><span class="rule-source ${isInherited ? "category" : isZero ? "zero" : "sku"}">${isInherited ? "继承分类" : isZero ? "SKU 例外 · 0%" : "SKU 例外"}</span></td>
        <td><button class="icon-button edit-sku-rule" type="button" title="${isInherited ? "新建 SKU 例外" : "编辑 SKU 佣金规则"}">${icon("edit")}</button>${isInherited ? `<button class="button text edit-sku-rule" type="button">设置例外</button>` : `<button class="button text remove-sku-rule" type="button">恢复继承</button>`}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("search")}<strong>没有匹配的 SKU</strong><span>可调整商品关键词或一级分类筛选</span></div></td></tr>`;
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
    if (firstInput) firstInput.focus();
  }

  function setHighRiskDiagnostic({ code = "", status = "", message = "" } = {}) {
    const diagnostics = $("#highRiskDiagnostics");
    const codeNode = $("#highRiskDiagnosticCode");
    diagnostics.hidden = !code && !message;
    diagnostics.open = false;
    codeNode.dataset.errorCode = code;
    codeNode.dataset.httpStatus = status ? String(status) : "";
    codeNode.textContent = code ? `${code}${status ? ` · HTTP ${status}` : ""}` : "";
    $("#highRiskDiagnosticMessage").textContent = message || "当前暂无错误。";
  }

  function showHighRiskBusinessError(error) {
    $("#highRiskSubtitle").textContent = error.subtitle || "本次确认未生效，记录保持不变";
    $("#highRiskError").textContent = error.businessMessage || error.message;
    $("#highRiskError").dataset.errorCode = error.code || "";
    $("#highRiskError").dataset.httpStatus = error.status ? String(error.status) : "";
    $("#highRiskError").hidden = false;
    setHighRiskDiagnostic({ code: error.code, status: error.status, message: error.diagnosticMessage || error.message });
  }

  function requestHighRiskAction(config) {
    $("#highRiskTitle").textContent = config.title;
    $("#highRiskSubtitle").textContent = config.subtitle || "操作将写入不可变审计日志";
    $("#highRiskImpact").textContent = config.impact;
    $("#highRiskReason").value = config.reason || "";
    $("#highRiskReasonField").hidden = config.reasonRequired === false;
    $("#highRiskConfirm").checked = false;
    $("#highRiskError").hidden = true;
    $("#highRiskError").dataset.errorCode = "";
    $("#highRiskError").dataset.httpStatus = "";
    $("#highRiskConfirmLabel").textContent = config.confirmLabel || "确认执行";
    $("#highRiskRepair").hidden = !config.repairAction;
    $("#highRiskRepair").textContent = config.repairLabel || "去处理";
    $("#simulateHighRiskConflict").hidden = !config.catalogContext;
    $("#simulateHighRiskConflict").disabled = false;
    setHighRiskDiagnostic(config.diagnostic || (config.catalogContext ? {
      message: `预览已绑定 ${config.catalogContext.type.toUpperCase()} / ${config.catalogContext.action} / v${config.catalogContext.expectedVersion}`
    } : {}));
    openModal("#highRiskModal");
    state.pendingHighRiskAction = config;
    state.highRiskRepairAction = config.repairAction || null;
  }

  function clearBankReveal() {
    clearTimeout(state.bankRevealTimer);
    state.bankRevealTimer = null;
    state.bankRevealGrant = null;
    const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
    if ($("#withdrawalCard") && item) $("#withdrawalCard").textContent = item.card;
    if ($("#withdrawalCardTimer")) $("#withdrawalCardTimer").hidden = true;
    if ($("#openBankVerification")) $("#openBankVerification").hidden = !(item && item.statusCode === "APPROVED");
    if ($("#copyRevealedBank")) $("#copyRevealedBank").hidden = true;
    if ($("#bankVerifyCode")) $("#bankVerifyCode").value = "";
  }

  function closeOverlays() {
    const credentialWasVisible = $("#credentialModal") && !$("#credentialModal").hidden;
    $("#modalBackdrop").hidden = true;
    $$(".modal, .drawer").forEach((item) => { item.hidden = true; });
    $("#notificationPanel").hidden = true;
    clearBankReveal();
    state.bankRevealContext = null;
    state.pendingHighRiskAction = null;
    state.highRiskRepairAction = null;
    $("#highRiskConfirm").disabled = false;
    if (!state.highRiskSubmitting) $("#confirmHighRisk").disabled = false;
    if (credentialWasVisible) {
      state.oneTimeCredentials = null;
      $("#credentialAccount").textContent = "已隐藏";
      $("#credentialPassword").textContent = "已隐藏";
    }
  }

  function orderDetail(order) {
    return frozenOrderDetails[order.id];
  }

  function renderOrderDetail(order) {
    const detail = orderDetail(order);
    const totalCommission = detail.items.reduce((sum, item) => sum + item.commission, 0);
    const refundDebit = detail.items.reduce((sum, item) => sum + (item.refundDebit || 0), 0);
    $("#detailItemCount").textContent = `共 ${order.count} 件`;
    $("#detailOrderProducts").innerHTML = detail.items.map((item) => `<div class="order-product">${renderProductArt(item.art, item.brand)}<div><strong>${item.name}</strong><span>规格：${item.sku}</span><small>${money(item.price)} × ${item.quantity}</small><em class="commission-snapshot">净商品额 ${money(item.base)} × ${item.rate.toFixed(2)}% · ${item.source} · 原始佣金 ${money(item.commission)}${item.refundDebit ? ` · REFUND_DEBIT ${money(-item.refundDebit)}` : ""}</em></div><b>${money(item.base)}</b></div>`).join("");
    $("#detailAmountSummary").innerHTML = `<div><span>商品小计</span><b>${money(order.amount)}</b></div><div><span>运费</span><b>¥0.00</b></div><div><span>原始代理佣金</span><b>${money(totalCommission)}</b></div>${refundDebit ? `<div><span>独立退款冲正</span><b class="coral-text">${money(-refundDebit)}</b></div>` : ""}<div class="total"><span>实付金额</span><strong>${money(order.amount)}</strong></div>`;
    const customer = detail.customerSnapshot;
    $("#detailReceiver").innerHTML = `<span class="avatar soft-green">${customer.avatar || order.avatar}</span><div><strong>${order.customer} <small>${order.phone || "账户手机号未绑定"}</small></strong><p>${detail.address.replace(" · ", "<br>")}</p></div>`;
    $("#copyDetailReceiver").dataset.copy = `${order.customer} ${order.phone || "未绑定"} ${detail.address}`;
    $("#detailOrderInfo").innerHTML = `<div><dt>展示状态</dt><dd>${order.displayStatus}</dd></div><div><dt>订单状态</dt><dd>${order.orderStatus}</dd></div><div><dt>支付状态</dt><dd>${order.paymentStatus}</dd></div><div><dt>退款状态</dt><dd>${order.refundStatus}</dd></div><div><dt>履约状态</dt><dd>${order.fulfillmentStatus}</dd></div><div><dt>关闭原因</dt><dd>${order.closeReason || "-"}</dd></div><div><dt>订单来源</dt><dd>微信小程序</dd></div><div><dt>服务归属</dt><dd>${detail.agent}</dd></div><div><dt>佣金快照</dt><dd>${detail.items.length} 条商品行 · 原始 ${money(totalCommission)}${refundDebit ? `<br><small>冲正 ${money(-refundDebit)}</small>` : ""}<br><small>规则版本 ${detail.version}</small></dd></div><div><dt>支付方式</dt><dd>${order.payment}（模拟）</dd></div><div><dt>配送方式</dt><dd>普通快递</dd></div><div><dt>内部备注</dt><dd class="muted">暂无</dd></div>`;
    const events = [`<div><i></i><span><strong>买家提交订单</strong><small>2026-${order.time} · 小程序</small></span></div>`];
    if (order.status !== "待付款") events.unshift(`<div><i></i><span><strong>买家付款成功</strong><small>支付时冻结 SKU、规则来源与佣金快照</small></span></div>`);
    if (["运输中", "已完成"].includes(order.status)) events.unshift(`<div><i></i><span><strong>平台已发货</strong><small>圆通速递 YT9068****1026</small></span></div>`);
    if (order.status === "退款售后") events.unshift(`<div><i></i><span><strong>售后申请处理中</strong><small>退款成功后自动回补未发货 SKU；佣金采用独立冲正流水</small></span></div>`);
    $("#detailOrderTimeline").innerHTML = events.join("");
    const progressSteps = ["提交订单", "付款成功", order.status === "待付款" ? "等待付款" : "等待发货", "运输中", "已完成"];
    const currentIndex = order.status === "待付款" ? 0 : order.status === "待发货" ? 2 : order.status === "运输中" ? 3 : order.status === "已完成" ? 4 : 2;
    $("#orderProgress").innerHTML = progressSteps.map((label, index) => `<div class="${index < currentIndex ? "done" : index === currentIndex ? "current" : ""}"><i>${index < currentIndex ? icon("check") : index + 1}</i><span><strong>${label}</strong><small>${index < currentIndex ? "已完成" : index === currentIndex ? order.status : "待更新"}</small></span></div>`).join("");
  }

  function openShipping(orderId) {
    state.activeOrderId = orderId || state.activeOrderId;
    const order = orders.find((item) => item.id === state.activeOrderId);
    $("#shippingTitle").nextElementSibling.textContent = `订单 ${state.activeOrderId} · 共 ${order ? order.count : 3} 件商品`;
    if (order) {
      const detail = orderDetail(order);
      $("#shippingReceiverName").textContent = `${order.customer} · ${order.phone || "账户手机号未绑定"}`;
      $("#shippingReceiverAddress").textContent = detail.address;
      $("#shippingItems").innerHTML = detail.items.map((item) => `<div class="shipping-item"><strong>${item.name}</strong><span>${item.sku} × ${item.quantity}</span></div>`).join("");
      const blocker = activeAftersaleForOrder(order.id);
      $("#shippingBlocker").hidden = !blocker;
      $("#shippingBlocker").innerHTML = blocker ? `${icon("alert")}<div><strong>单包裹整单阻断</strong><span>${blocker.id} 正在占用 ${blocker.sku} × ${blocker.quantity}，本单任何活动售后存在时均不可发货。</span></div>` : "";
      $("#confirmShipping").disabled = Boolean(blocker) || order.status !== "待发货";
    }
    $("#shippingCompany").value = "";
    $("#trackingNumber").value = "";
    $("#shippingEventNote").value = "总部仓待揽收";
    $("#shippingError").hidden = true;
    openModal("#shippingModal");
  }

  function openStock(productId) {
    const product = products.find((item) => item.id === Number(productId));
    if (!product) return;
    const skus = inventoryForProduct(product.id);
    if (!skus.length) return showToast("当前商品暂无 SKU 库存记录");
    state.activeProductId = product.id;
    $("#stockSkuField").hidden = false;
    $("#stockSkuSelect").innerHTML = skus.map((item) => `<option value="${item.id}">${item.id} · ${item.spec}</option>`).join("");
    openInventoryEditor(skus[0].id, false, { preserveProduct: true });
  }

  function skuInventorySummary(skuId) {
    const item = inventorySkus.find((entry) => entry.id === skuId);
    return item ? inventorySnapshot(item) : { physical: 0, locked: 0, available: 0 };
  }

  function skuActions(sku, { parentArchived = false } = {}) {
    if (parentArchived) {
      return sku.status === "INACTIVE"
        ? `<button class="button text sku-lifecycle" type="button" data-lifecycle-action="ACTIVATE">检查启用</button>`
        : `<span class="cell-sub">归档商品只读</span>`;
    }
    if (sku.status === "ARCHIVED") return `<button class="button text restore-sku" type="button">恢复</button>`;
    const actions = [];
    if (sku.status === "INACTIVE") actions.push(`<button class="button text sku-lifecycle" type="button" data-lifecycle-action="ACTIVATE">启用</button>`);
    if (sku.status === "ACTIVE") actions.push(`<button class="button text sku-lifecycle" type="button" data-lifecycle-action="DEACTIVATE">停用</button>`);
    if (sku.status === "INACTIVE") actions.push(`<button class="icon-button danger sku-lifecycle" type="button" data-lifecycle-action="SOFT_DELETE" title="归档 SKU">${icon("trash")}</button>`);
    return actions.join("");
  }

  function renderProductEditorImages(product, count, readOnly = state.productReadOnly) {
    const tone = product?.art || "art-green";
    const brand = product?.brand || $("#productBrandInput").value || "商品图片";
    const upload = readOnly
      ? count ? "" : `<div class="upload-card" aria-label="暂无商品图片"><strong>暂无图片</strong></div>`
      : `<button id="uploadProductImage" class="upload-card" type="button"><svg class="icon"><use href="#i-upload"></use></svg><strong>上传图片</strong><span>JPG / PNG</span></button>`;
    $("#productImageUploader").innerHTML = `${upload}${Array.from({ length: count }, (_, index) => `<div class="product-art ${tone} large" data-product-image="${index + 1}"><i></i><b>${brand}</b><span>图集 ${index + 1}</span>${index === 0 ? "<em>主图</em>" : ""}</div>`).join("")}`;
    $("#productImageCount").textContent = `${count} / 8`;
    $("#productSummaryImages").textContent = `${count} / 8`;
  }

  function renderProductEditorSkus(skus, readOnly = state.productReadOnly) {
    $("#skuRows").innerHTML = skus.map((sku) => {
      const inventory = skuInventorySummary(sku.id);
      const disabled = readOnly ? " disabled" : "";
      return `<tr data-sku-id="${sku.id}" data-sku-persisted="true"><td><input data-sku-field="spec" value="${sku.spec}"${disabled}></td><td><input data-sku-field="id" value="${sku.id}" disabled title="SKU 编码创建后不可修改"></td><td><div class="money-input"><span>¥</span><input data-sku-field="price" value="${Number(sku.price).toFixed(2)}"${disabled}></div></td><td><span class="cell-main">实物 ${inventory.physical}</span><span class="cell-sub">锁定 ${inventory.locked} · 可售 ${inventory.available}</span></td><td><label class="switch ${sku.isRecommended ? "active" : ""}" title="SKU 推荐"><input data-sku-field="recommended" type="checkbox" ${sku.isRecommended ? "checked" : ""}${disabled}><i></i></label></td><td><span class="tag ${statusClass(sku.status)}" data-status-code="${sku.status}">${catalogStatusLabel(sku.status)}</span><span class="cell-sub">v${sku.version}</span></td><td><div class="row-actions">${skuActions(sku, { parentArchived: readOnly })}</div></td></tr>`;
    }).join("");
    $("#productSkuTabCount").textContent = skus.length;
    $("#productSummarySkuCount").textContent = skus.length;
  }

  function setProductEditorReadOnly(readOnly, product = null) {
    state.productReadOnly = readOnly;
    ["#productNameInput", "#productBrandInput", "#productCategoryInput", "#productSellingPointInput", "#productIntroInput", "#productIngredientsInput", "#productUsageInput", "#productRecommendedInput", "#productNewInput"].forEach((selector) => { $(selector).disabled = readOnly; });
    $("#saveProduct").hidden = readOnly;
    $("#addSku").hidden = readOnly;
    if (readOnly && product) $("#productEditTitle").textContent = `查看归档商品 · ${product.brand}`;
  }

  function openProductEditor(productId = null) {
    const product = products.find((item) => item.id === Number(productId));
    const details = product ? productDetails[product.id] : { sellingPoint: "", intro: "", ingredients: "", usage: "", favorites: 0 };
    const readOnly = product?.status === "ARCHIVED";
    state.activeProductId = product ? product.id : null;
    $("#productBrandInput").innerHTML = brands.filter((item) => item.status === "ACTIVE").map((item) => `<option>${item.name}</option>`).join("");
    $("#productCategoryInput").innerHTML = commissionCategories.filter((item) => item.status === "ACTIVE").map((item) => `<option>${item.name}</option>`).join("");
    $("#productEditTitle").textContent = readOnly ? `查看归档商品 · ${product.brand}` : product ? `编辑商品 · ${product.brand}` : "新增商品";
    $("#productEditMeta").textContent = product ? `${product.code} · 当前记录 ID ${product.id}` : "尚未生成 SPU · 保存后创建当前记录";
    const editStatus = product ? product.status : "DRAFT";
    $("#productEditStatus").textContent = catalogStatusLabel(editStatus);
    $("#productEditStatus").dataset.statusCode = editStatus;
    $("#productEditStatus").className = `tag ${statusClass(editStatus)}`;
    $("#productNameInput").value = product ? product.name : "";
    $("#productBrandInput").value = product ? product.brand : brands.find((item) => item.status === "ACTIVE")?.name || "";
    $("#productCodeInput").value = product ? product.code : "";
    $("#productCodeInput").disabled = Boolean(product);
    $("#productCategoryInput").value = product ? product.category : commissionCategories[0].name;
    $("#productSellingPointInput").value = details.sellingPoint;
    $("#productIntroInput").value = details.intro;
    $("#productIngredientsInput").value = details.ingredients;
    $("#productUsageInput").value = details.usage;
    $("#productRecommendedInput").checked = Boolean(product && product.isHot);
    $("#productNewInput").checked = product ? product.isNew : true;
    setProductEditorReadOnly(readOnly, product);
    const inventory = product ? productInventorySnapshot(product.id) : { physical: 0, locked: 0, available: 0 };
    $("#productSummaryStock").textContent = inventory.physical;
    $("#productSummaryReserved").textContent = inventory.locked;
    $("#productSummaryPublishedAt").textContent = product?.publishedAt || "尚未发布";
    $("#productNameCount").textContent = `${$("#productNameInput").value.length} / 60`;
    $("#productEditError").hidden = true;
    state.activeProductImageCount = product?.imageCount || 0;
    renderProductEditorImages(product, state.activeProductImageCount, readOnly);
    renderProductEditorSkus(product ? productSkus[product.id] : [], readOnly);
    selectProductEditorTab("basic");
    showPage("product-edit");
  }

  function readProductEditorSkus() {
    return $$("#skuRows tr").map((row) => ({
      originalId: row.dataset.skuPersisted === "true" ? row.dataset.skuId : null,
      spec: $('[data-sku-field="spec"]', row)?.value.trim() || "",
      id: $('[data-sku-field="id"]', row)?.value.trim().toUpperCase() || "",
      price: Number($('[data-sku-field="price"]', row)?.value),
      isRecommended: Boolean($('[data-sku-field="recommended"]', row)?.checked)
    }));
  }

  function openEntityEditor(type, id = null) {
    let item;
    if (type === "brand") item = brands.find((entry) => entry.id === id);
    if (type === "category") item = commissionCategories.find((entry) => entry.id === id);
    if (type === "banner") item = banners.find((entry) => entry.id === id);
    state.activeEntity = { type, id, item };
    const labels = { brand: "品牌", category: "一级分类", banner: "Banner" };
    const isMasterData = type === "brand" || type === "category";
    $("#entityModalTitle").textContent = `${item ? "编辑" : "新增"}${labels[type]}`;
    $("#entityModalSubtitle").textContent = isMasterData
      ? item ? `v${item.version} · 普通编辑不改变 ${item.status} 状态` : "initial_status 固定为 DRAFT"
      : item ? `${item.id} · 软删除保留历史引用` : "保存前校验编码、名称与关联范围";
    $("#entityCode").value = item ? item.id : "";
    $("#entityCode").disabled = Boolean(item);
    $("#entityName").value = item ? item.name : "";
    $("#entityDetail").value = item ? (type === "brand" ? item.description || "" : item.detail || "") : "";
    $("#entityDetailLabel").textContent = type === "brand" ? "品牌描述" : "跳转目标 *";
    $("#entitySort").value = item ? item.sort ?? 0 : 0;
    $("#entityStatus").value = item ? item.status : "已启用";
    $("#entityDraftNotice").hidden = !isMasterData || Boolean(item);
    $("#entityCodeField").hidden = isMasterData;
    $("#entityDetailField").hidden = type === "category";
    $("#entityStatusField").hidden = isMasterData;
    $("#entityStartField").hidden = type !== "banner";
    $("#entityEndField").hidden = type !== "banner";
    $("#entityStart").value = item && type === "banner" ? item.start : "2026-08-11";
    $("#entityEnd").value = item && type === "banner" ? item.end : "2026-09-11";
    $("#archiveEntity").hidden = isMasterData || !item;
    $("#entityError").hidden = true;
    openModal("#entityModal");
  }

  function entityByType(type, id) {
    return (type === "brand" ? brands : commissionCategories).find((item) => item.id === id);
  }

  function renderMasterData(type) {
    if (type === "brand") renderBrands();
    else {
      renderCategoryManagement();
      renderCommissionRules();
    }
  }

  function lifecyclePreview(type, item, action) {
    const labels = { ACTIVATE: "启用", DEACTIVATE: "停用", SOFT_DELETE: "归档" };
    const dependencyCount = ["DEACTIVATE", "SOFT_DELETE"].includes(action) ? item.activeProductCount || 0 : 0;
    const blocked = dependencyCount > 0;
    const targetStatus = { ACTIVATE: "ACTIVE", DEACTIVATE: "INACTIVE", SOFT_DELETE: "ARCHIVED" }[action];
    const dependencyText = blocked ? `发现 ${dependencyCount} 个 ACTIVE 商品依赖；确认提交将返回 ACTIVE_PRODUCT_DEPENDENCY 422，状态与版本不变。` : "未发现活动商品依赖，可以继续确认。";
    requestHighRiskAction({
      title: `影响预览 · ${labels[action]}${type === "brand" ? "品牌" : "分类"} · ${item.name}`,
      subtitle: `preview_token 仅绑定当前目标、动作与 v${item.version}`,
      impact: `${item.status} → ${targetStatus}。${dependencyText}`,
      confirmLabel: `确认${labels[action]}`,
      confirmError: blocked ? { code: "ACTIVE_PRODUCT_DEPENDENCY", status: 422, message: "请先迁移或下架关联的 ACTIVE 商品后重试" } : null,
      action: (reason) => {
        item.status = targetStatus;
        item.version += 1;
        if (action === "SOFT_DELETE") item.deletedAt = "2026-08-11 12:32";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:32:00", type: "内容配置", actor: "林老板", target: item.id, reason, result: `${action} · ${targetStatus} · v${item.version}`, client: "Web · Prototype", status: "成功" });
        renderMasterData(type);
        renderAuditLogs();
        showToast(`${item.name} 已${labels[action]}`);
      }
    });
  }

  function archivedParentSkuActivationError() {
    return {
      code: "STATE_CONFLICT",
      status: 409,
      message: "父商品已归档，SKU 不可启用",
      businessMessage: "该 SKU 所属商品已归档，请先恢复商品后重新检查。"
    };
  }

  function archivedProductRepair(product) {
    return () => {
      showPage("products");
      $("#productSearch").value = product.code;
      $("#productCategory").value = "";
      $("#productBrand").value = "";
      $("#productStatus").value = "ARCHIVED";
      renderProducts();
      showToast("已定位归档商品，请先恢复后重新发起 SKU 启用预览");
    };
  }

  function catalogLifecyclePreview(type, product, item, action) {
    const target = type === "product" ? product : item;
    const labels = { ACTIVATE: "启用", DEACTIVATE: "停用", SOFT_DELETE: "归档" };
    const targetStatus = { ACTIVATE: "ACTIVE", DEACTIVATE: "INACTIVE", SOFT_DELETE: "ARCHIVED" }[action];
    let confirmError = null;
    const impacts = [];
    let repairAction = null;
    let repairLabel = "去处理";

    if (type === "sku" && action === "ACTIVATE" && product.status === "ARCHIVED") {
      confirmError = archivedParentSkuActivationError();
      repairLabel = "返回最新商品";
      repairAction = archivedProductRepair(product);
      impacts.push("父商品当前已归档");
    }

    if (type === "product" && action === "ACTIVATE") {
      const brand = brands.find((entry) => entry.name === product.brand);
      const category = commissionCategories.find((entry) => entry.name === product.category);
      if (!brand || brand.status !== "ACTIVE" || !category || category.status !== "ACTIVE") {
        confirmError = { code: "STATE_CONFLICT", status: 409, message: "品牌或分类当前不可用于商品启用", businessMessage: "请先启用该商品所属的品牌和一级分类。" };
        repairLabel = "去检查品牌与分类";
        repairAction = () => showPage(!brand || brand.status !== "ACTIVE" ? "brands" : "categories");
      } else if (product.imageCount < 1) {
        confirmError = { code: "PRODUCT_PRIMARY_IMAGE_REQUIRED", status: 422, message: "请先挂接至少一张 READY/PUBLIC PRODUCT_IMAGE", businessMessage: "启用前至少需要一张可公开展示的商品图片。" };
        repairLabel = "去上传商品图片";
        repairAction = () => { openProductEditor(product.id); selectProductEditorTab("basic"); $("#uploadProductImage").focus(); };
      } else if (!activeProductSkus(product.id).length) {
        confirmError = { code: "PRODUCT_ACTIVE_SKU_REQUIRED", status: 422, message: "请先启用至少一个 SKU", businessMessage: "启用商品前，至少需要一个已启用的 SKU。" };
        repairLabel = "去管理 SKU";
        repairAction = () => { openProductEditor(product.id); selectProductEditorTab("sku"); $("#addSku").focus(); };
      }
      impacts.push(`商品图片 ${product.imageCount}/8`, `已启用 SKU ${activeProductSkus(product.id).length}`);
    }

    if (action === "SOFT_DELETE") {
      const activeSkuCount = type === "product" ? activeProductSkus(product.id).length : 0;
      const locked = type === "product"
        ? productInventorySnapshot(product.id).locked
        : skuInventorySummary(item.id).locked;
      if (activeSkuCount > 0) {
        confirmError = { code: "ACTIVE_SKU_DEPENDENCY", status: 422, message: `仍有 ${activeSkuCount} 个 ACTIVE SKU`, businessMessage: `仍有 ${activeSkuCount} 个已启用 SKU，请先逐一停用。` };
        repairLabel = "去停用 SKU";
        repairAction = () => { openProductEditor(product.id); selectProductEditorTab("sku"); $("#skuRows .sku-lifecycle")?.focus(); };
      } else if (locked > 0) {
        const lockedSku = type === "sku"
          ? inventorySkus.find((entry) => entry.id === item.id && inventorySnapshot(entry).locked > 0)
          : inventoryForProduct(product.id).find((entry) => inventorySnapshot(entry).locked > 0);
        confirmError = { code: "ACTIVE_INVENTORY_RESERVATION", status: 422, message: `仍有 ${locked} 件活动库存预占`, businessMessage: `仍有 ${locked} 件库存被订单或售后流程占用，需先完成相关业务。` };
        const relatedAftersale = lockedSku?.aftersaleReserved > 0 ? aftersales.find((entry) => entry.sku === lockedSku.id) : null;
        const relatedOrder = lockedSku?.paymentReserved > 0
          ? orders.find((entry) => entry.id === lockedSku.paymentReservationOrderId)
            || orders.find((entry) => frozenOrderDetails[entry.id]?.items.some((snapshot) => snapshot.sku.includes(lockedSku.id)))
          : null;
        repairLabel = relatedAftersale ? "查看相关售后" : "查看相关订单";
        repairAction = () => {
          if (relatedAftersale) {
            $("#aftersaleSearch").value = relatedAftersale.id;
            $("#aftersaleType").value = "";
            $("#aftersaleStatus").value = "";
            renderAftersales();
            showPage("aftersales");
          } else {
            $("#orderSearch").value = relatedOrder?.id || lockedSku?.id || product.code;
            $("#orderStatus").value = "";
            renderOrders();
            showPage("orders");
          }
          showToast("已定位占用来源，请先完成相关订单或售后流程");
        };
      }
      impacts.push(`已启用 SKU ${activeSkuCount}`, `库存预占 ${locked} 件`);
    }

    const kindLabel = type === "product" ? "商品" : "SKU";
    requestHighRiskAction({
      title: `影响预览 · ${labels[action]}${kindLabel} · ${type === "product" ? product.name : item.id}`,
      subtitle: `本次预览仅适用于当前${kindLabel}和当前版本`,
      impact: `${catalogStatusLabel(target.status)} → ${catalogStatusLabel(targetStatus)}。${impacts.length ? impacts.join("；") : "状态变化不会自动修改下级记录。"}${confirmError ? `；${confirmError.businessMessage}` : "；已通过当前检查，可以继续确认。"}`,
      confirmLabel: `确认${labels[action]}`,
      confirmError,
      repairAction,
      repairLabel,
      diagnostic: confirmError ? { code: confirmError.code, status: confirmError.status, message: confirmError.message } : null,
      catalogContext: { type, action, target, product, item, expectedVersion: target.version },
      action: (reason) => {
        target.status = targetStatus;
        target.version += 1;
        if (action === "SOFT_DELETE") target.deletedAt = "2026-08-24 11:20";
        if (type === "product" && action === "ACTIVATE" && !product.publishedAt) product.publishedAt = "2026-08-24 11:20";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-24 11:20:00", type: `${kindLabel}生命周期`, actor: "林老板", target: type === "product" ? product.code : item.id, reason, result: `${action} · ${targetStatus} · v${target.version}`, client: "Web · Prototype", status: "成功" });
        renderProducts();
        if (type === "sku" && state.activeProductId === product.id) renderProductEditorSkus(productSkus[product.id]);
        renderAuditLogs();
        showToast(`${kindLabel}已${labels[action]}`);
      }
    });
  }

  function openRestoreEntity(type, item, product = null) {
    const labels = { brand: "品牌", category: "分类", product: "商品", sku: "SKU" };
    const restoredStatus = type === "sku" ? "INACTIVE" : "DRAFT";
    state.activeEntity = { type, id: item.id, item, product };
    $("#restoreEntityTitle").textContent = `恢复${labels[type]} · ${item.name || item.code || item.id}`;
    $("#restoreEntitySubtitle").textContent = `当前已归档 · 版本 v${item.version}`;
    $("#restoreResultStatus").textContent = `恢复结果：${catalogStatusLabel(restoredStatus)}`;
    $("#restoreResultHint").textContent = "恢复后如需启用，请重新检查影响并单独确认。";
    $("#confirmRestoreEntityLabel").textContent = `恢复为${catalogStatusLabel(restoredStatus)}`;
    $("#restoreEntityReason").value = "";
    $("#restoreEntityError").hidden = true;
    openModal("#restoreEntityModal");
  }

  function openInventoryEditor(skuId, viewOnly = false, options = {}) {
    const item = inventorySkus.find((entry) => entry.id === skuId);
    if (!item) return;
    if (!options.preserveProduct) state.activeProductId = null;
    state.activeInventorySku = item.id;
    state.inventoryViewOnly = viewOnly;
    $("#stockTitle").textContent = viewOnly ? "SKU 库存流水" : "调整 SKU 库存";
    $("#stockProductName").textContent = `${item.product} · ${item.spec} · ${item.id}`;
    $("#stockSkuField").hidden = !state.activeProductId;
    if (state.activeProductId) $("#stockSkuSelect").value = item.id;
    $("#currentStock").textContent = item.available;
    $("#newStock").value = item.available;
    $("#stockWarning").value = item.warning;
    $("#stockReason").value = "";
    $("#stockNote").value = "";
    ["newStock", "stockWarning", "stockReason", "stockNote"].forEach((id) => { $("#" + id).disabled = viewOnly; });
    $("#confirmStock").hidden = viewOnly;
    $("#stockError").hidden = true;
    const ledger = inventoryLedger[item.id] || [];
    $("#stockLedger").innerHTML = ledger.length ? ledger.map((entry) => `<div><span class="audit-type ${entry.delta >= 0 ? "success" : "danger"}">${entry.delta >= 0 ? "+" : ""}${entry.delta}</span><p><strong>${entry.reason} · 结存 ${entry.result}</strong><small>${entry.time} · ${entry.actor}</small></p></div>`).join("") : `<div><span class="audit-type neutral">EMPTY</span><p><strong>暂无调整流水</strong><small>支付与售后预占使用独立流水，不改写实物库存。</small></p></div>`;
    if ($("#stockModal").hidden) openModal("#stockModal");
  }

  function openBusinessRule(key) {
    const rule = businessRules[key];
    if (!rule) return;
    state.activeBusinessRule = key;
    $("#businessRuleTitle").textContent = `配置${rule.label}`;
    $("#businessRuleSubtitle").textContent = `当前 BR-20260811-${String(rule.version).padStart(2, "0")} · 保存后生成新版本`;
    $("#businessRuleFieldLabel").textContent = `${rule.label}（${rule.unit}）*`;
    $("#businessRuleValue").value = rule.value;
    $("#businessRuleImpact").innerHTML = `<strong>影响预览</strong><p>${rule.impact}</p>`;
    $("#businessRuleReason").value = "";
    $("#businessRuleConfirm").checked = false;
    $("#businessRuleError").hidden = true;
    openModal("#businessRuleModal");
  }

  const inspectionInputs = {
    receivedQty: "#inspectionReceivedQty",
    approvedRefundQty: "#inspectionApprovedQty",
    restockQty: "#inspectionRestockQty",
    damagedQty: "#inspectionDamagedQty",
    scrapQty: "#inspectionScrapQty",
    returnToCustomerQty: "#inspectionReturnQty"
  };

  function inspectionDefaults(item) {
    return item.inspection || {
      receivedQty: item.quantity,
      approvedRefundQty: item.quantity,
      restockQty: item.restock ? item.quantity : 0,
      damagedQty: item.restock ? 0 : item.quantity,
      scrapQty: 0,
      returnToCustomerQty: 0
    };
  }

  function writeInspectionForm(item) {
    const values = inspectionDefaults(item);
    Object.entries(inspectionInputs).forEach(([key, selector]) => { $(selector).value = values[key]; });
    $("#inspectionRequested").textContent = `申请退货 ${item.quantity} 件 · 申请金额 ${money(item.amount)}`;
    updateInspectionBalance(item);
  }

  function renderInspectionEvidence(item) {
    const sealed = Boolean(item.inspection?.evidenceSealed);
    const manifest = sealed ? item.inspection.evidenceManifest : state.inspectionEvidenceDraft;
    $("#addInspectionEvidence").disabled = sealed;
    $("#addInspectionEvidence").textContent = sealed ? "证据清单已封存" : "选择证据文件";
    $("#inspectionEvidencePolicy").textContent = sealed
      ? `${item.inspection.result} · ${manifest.length} 份证据 · ${item.inspection.inspectedBy} ${item.inspection.inspectedAt} 封存`
      : "PASS 可为 0 份；ABNORMAL 至少 1 份。提交后清单与文件摘要不可改写。";
    $("#inspectionEvidenceList").innerHTML = manifest.length ? manifest.map((file, index) => `<div class="inspection-evidence-item" data-evidence-file-id="${file.fileId}"><div>${icon("upload")}<span><strong>${file.name}</strong><small>${file.fileId} · SHA256 ${file.sha256}</small></span></div>${sealed ? `<span class="tag success">SEALED</span>` : `<button class="icon-button remove-inspection-evidence" data-evidence-index="${index}" type="button" title="移除证据">${icon("x")}</button>`}</div>`).join("") : `<div class="inspection-evidence-empty" data-evidence-count="0">${sealed ? "已封存空证据清单（PASS 允许）" : "尚未选择验货证据"}</div>`;
  }

  function sealInspection(item, values, abnormalReason = null) {
    const evidenceManifest = state.inspectionEvidenceDraft.map((file) => ({ ...file }));
    return deepFreeze({
      ...values,
      abnormalReason,
      evidenceManifest,
      evidenceCount: evidenceManifest.length,
      evidenceSealed: true,
      inspectedBy: "林老板",
      inspectedAt: "2026-08-11 12:23:30",
      resolution: null,
      resolutionReason: null,
      resolvedAt: null
    });
  }

  function readInspectionForm() {
    const values = {};
    let complete = true;
    Object.entries(inspectionInputs).forEach(([key, selector]) => {
      const raw = $(selector).value.trim();
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value < 0) complete = false;
      values[key] = value;
    });
    return { ...values, complete };
  }

  function inspectionValidation(item, result) {
    const values = readInspectionForm();
    if (!values.complete) return { ok: false, message: "验货数量必须是大于等于 0 的整数" };
    if (values.receivedQty > item.quantity) return { ok: false, message: `实收数量不能超过申请数量 ${item.quantity}` };
    const refundableDispositionTotal = values.restockQty + values.damagedQty + values.scrapQty;
    const dispositionTotal = values.restockQty + values.damagedQty + values.scrapQty + values.returnToCustomerQty;
    if (values.approvedRefundQty + values.returnToCustomerQty !== values.receivedQty) {
      return { ok: false, message: `批准退款 ${values.approvedRefundQty} + 退回客户 ${values.returnToCustomerQty} 必须等于实收 ${values.receivedQty}` };
    }
    if (values.approvedRefundQty !== refundableDispositionTotal) {
      return { ok: false, message: `批准退款 ${values.approvedRefundQty} 必须等于回库、损坏、报废合计 ${refundableDispositionTotal}` };
    }
    if (result === "PASS" && (values.receivedQty !== item.quantity || values.approvedRefundQty !== item.quantity || values.returnToCustomerQty !== 0)) {
      return { ok: false, message: `PASS 必须全量实收 ${item.quantity} 件、全额批准 ${item.quantity} 件且不退回客户` };
    }
    if (result === "ABNORMAL" && state.inspectionEvidenceDraft.length < 1) return { ok: false, message: "ABNORMAL 至少需要 1 份验货证据" };
    const approvedAmount = Math.round((Number(item.amount) * values.approvedRefundQty / item.quantity) * 100) / 100;
    return { ok: true, values: { ...values, result, dispositionTotal, refundableDispositionTotal, approvedAmount } };
  }

  function inspectionImpact(values) {
    return `实收 ${values.receivedQty}；批准退款 ${values.approvedRefundQty}（${money(values.approvedAmount)}）；回库 ${values.restockQty}、损坏 ${values.damagedQty}、报废 ${values.scrapQty}、退回客户 ${values.returnToCustomerQty}。`;
  }

  function updateInspectionBalance(item) {
    if (!item || item.statusCode !== "WAITING_INSPECTION") return;
    const values = readInspectionForm();
    const refundableDispositionTotal = values.restockQty + values.damagedQty + values.scrapQty;
    const refundAllocationTotal = values.approvedRefundQty + values.returnToCustomerQty;
    const valid = values.complete && values.receivedQty <= item.quantity && refundAllocationTotal === values.receivedQty && values.approvedRefundQty === refundableDispositionTotal;
    $("#inspectionBalance").classList.toggle("invalid", !valid);
    $("#inspectionBalance").textContent = values.complete
      ? `退款分配：批准 ${values.approvedRefundQty} + 退客 ${values.returnToCustomerQty} = ${refundAllocationTotal} / 实收 ${values.receivedQty}；退款处置：回库、损坏、报废合计 ${refundableDispositionTotal} / 批准 ${values.approvedRefundQty}。${valid ? "两项等式校验通过。" : "请修正数量后提交。"}`
      : "请完整填写六项非负整数。";
  }

  function openAftersale(id) {
    const item = aftersales.find((after) => after.id === id);
    if (!item) return;
    state.activeAftersaleId = id;
    $("#aftersaleModalNo").textContent = `${item.id} · ${item.type}`;
    $("#reviewProductName").textContent = item.product;
    $("#reviewSkuQuantity").textContent = `${item.sku} × ${item.quantity}`;
    $("#reviewPaidAmount").textContent = `实付 ${money(item.amount)}`;
    $("#reviewCustomer").textContent = item.customer;
    $("#reviewAmount").textContent = money(item.amount);
    $("#reviewReason").textContent = item.reason;
    $("#reviewGoodsState").textContent = item.fulfillment === "UNSHIPPED" ? "未发货" : "已收货";
    $("#reviewCustomerNote").textContent = item.reason === "收到后包装破损" ? "外包装受挤压破损，客户申请退货退款并等待平台提供退货地址。" : `客户申请说明：${item.reason}。`;
    $("#reviewReservation").textContent = `${item.reserved ? "已占用" : "占用已释放"}可退数量 ${item.quantity} 件 · 可退金额 ${money(item.amount)}；活动占用阻断整单发货`;
    $("#reviewNote").value = "";
    $("#inspectionResolutionReason").value = "";
    const inspectionSummary = item.inspection ? `${item.inspection.result} · ${inspectionImpact({ ...item.inspection, approvedAmount: item.inspection.approvedAmount ?? Number(item.amount) })}证据 ${item.inspection.evidenceCount} 份已封存${item.inspection.resolution ? ` · ${item.inspection.resolution}` : ""}。` : "";
    const workflowCopy = {
      PENDING_REVIEW: "待审核：核对订单项、申请数量与金额占用。",
      WAITING_RETURN: `待客户寄回：总部退货地址为“浙江省杭州市余杭区总部仓售后组（AS-${item.id.slice(-4)}）”。`,
      WAITING_INSPECTION: `退货物流：${item.returnCarrier || "待录入"} ${item.returnTracking || "-"}。到仓后验货，可通过或登记异常。`,
      RETURN_EXCEPTION: `验货异常：${item.inspection?.abnormalReason || "待补充"}。${inspectionSummary}占用保持，须在 CONTINUE_REFUND / REJECT_AFTER_RETURN 中二选一。`,
      REFUNDING_AFTER_RETURN: `已选 CONTINUE_REFUND：${item.inspection?.resolutionReason || "-"}。正按封存验货数量执行退款。`,
      REJECTED_AFTER_RETURN: `已选 REJECT_AFTER_RETURN：${item.inspection?.resolutionReason || "-"}。占用已释放，验货证据与数量保持封存。`,
      REFUNDING: `退款处理中：按原支付与佣金快照执行 ${item.type === "仅退款" ? "退款" : "退货退款"}。`,
      REFUND_FAILED: `退款失败：第 ${item.refundAttempt || 1} 次尝试未成功，占用保留，可用原退款记录重试。`,
      COMPLETED: `退款完成：${item.restock ? "已按验货/未发货结果回补库存" : "不回库"}，已追加佣金冲正流水。${inspectionSummary}`,
      REJECTED: "申请已拒绝：可退数量和金额占用已释放。"
    };
    $("#aftersaleWorkflow").innerHTML = `<strong>${item.statusCode}</strong><p>${workflowCopy[item.statusCode] || item.status}</p><small>退款方式：${item.type} · ${Number(item.amount) >= 100 ? "全额/部分以订单项为准" : "部分退款示例"}</small>`;
    $("#approveAftersale").hidden = !["PENDING_REVIEW", "WAITING_INSPECTION", "REFUND_FAILED"].includes(item.statusCode);
    $("#approveAftersale").disabled = false;
    $("#approveAftersale").textContent = item.statusCode === "WAITING_INSPECTION" ? "验货通过并退款" : item.statusCode === "REFUND_FAILED" ? "重试退款" : "同意申请";
    $("#rejectAftersale").hidden = item.statusCode !== "PENDING_REVIEW";
    $("#advanceAftersale").hidden = item.statusCode !== "WAITING_RETURN";
    $("#advanceAftersale").textContent = "录入退货物流";
    $("#exceptionAftersale").hidden = item.statusCode !== "WAITING_INSPECTION";
    $("#continueRefundAfterInspection").hidden = item.statusCode !== "RETURN_EXCEPTION" || Boolean(item.inspection?.resolution);
    $("#rejectAfterInspection").hidden = item.statusCode !== "RETURN_EXCEPTION" || Boolean(item.inspection?.resolution);
    $("#inspectionResolutionPanel").hidden = item.statusCode !== "RETURN_EXCEPTION" || Boolean(item.inspection?.resolution);
    const showInspection = item.statusCode === "WAITING_INSPECTION" || Boolean(item.inspection);
    $("#inspectionFields").hidden = !showInspection;
    $("#inspectionExceptionField").hidden = item.statusCode !== "WAITING_INSPECTION";
    $("#inspectionException").value = "";
    if (item.statusCode === "WAITING_INSPECTION") state.inspectionEvidenceDraft = [];
    if (showInspection) {
      writeInspectionForm(item);
      Object.values(inspectionInputs).forEach((selector) => { $(selector).disabled = item.statusCode !== "WAITING_INSPECTION"; });
      renderInspectionEvidence(item);
    }
    openModal("#aftersaleModal");
  }

  function finalizeAftersaleRefund(item, reason) {
    const order = orders.find((entry) => entry.id === item.order);
    const approvedRefundQty = item.inspection?.approvedRefundQty ?? item.quantity;
    const approvedRefundAmount = item.inspection?.approvedAmount ?? Number(item.amount);
    const restockQty = item.inspection?.restockQty ?? (item.restock ? item.quantity : 0);
    item.status = "已完成";
    item.statusCode = "COMPLETED";
    item.reserved = false;
    item.approvedRefundQty = approvedRefundQty;
    item.refundedAmount = approvedRefundAmount;
    item.restock = restockQty > 0;
    item.refundedAt = "2026-08-11 12:24";
    const sku = inventorySkus.find((entry) => entry.id === item.sku);
    if (sku) {
      sku.aftersaleReserved = Math.max(0, sku.aftersaleReserved - item.quantity);
      if (restockQty > 0) {
        sku.available += restockQty;
        inventoryLedger[sku.id] ||= [];
        inventoryLedger[sku.id].unshift({ time: "08-11 12:24", delta: restockQty, result: sku.available, reason: item.fulfillment === "UNSHIPPED" ? "未发货退款自动回库" : "总部验货处置回库", actor: "售后系统" });
      }
    }
    if (order) {
      const full = approvedRefundAmount >= Number(order.amount);
      order.refundStatus = full ? "FULL" : "PARTIAL";
      if (full && item.fulfillment === "UNSHIPPED") {
        order.status = "退款售后";
        order.displayStatus = "退款完成";
        order.orderStatus = "CLOSED";
        order.fulfillmentStatus = "CANCELLED";
        order.closeReason = "FULL_REFUND_BEFORE_SHIPMENT";
      }
    }
    const ledgerAgent = frozenOrderDetails[item.order]?.agent;
    const agent = agents.find((entry) => entry.name === ledgerAgent);
    const commissionReversal = Math.round((item.commissionSnapshot * approvedRefundQty / item.quantity) * 100) / 100;
    if (agent) commissionLedger.unshift({ agentId: agent.id, type: order && order.orderStatus === "COMPLETED" ? "REFUND_DEBIT" : "CANCELLED", order: item.id, sku: item.sku, detail: `按支付时不可变快照追加冲正；原正向佣金 ${money(item.commissionSnapshot)} 保留`, amount: -commissionReversal });
    auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:24:00", type: "售后退款", actor: "林老板", target: item.id, reason, result: `${item.type}完成 · 批准 ${approvedRefundQty}/${item.quantity} 件 ${money(approvedRefundAmount)} · 回库 ${restockQty} 件 · 佣金已冲正`, client: "Web · Prototype", status: "成功" });
    renderAftersales();
    renderOrders();
    renderDashboardOrders();
    renderInventory();
    renderAuditLogs();
  }

  function openCustomer(id) {
    const customer = customers.find((item) => item.id === Number(id));
    if (!customer) return;
    state.activeCustomerId = customer.id;
    const aov = Math.round(customer.spend / customer.orders);
    $("#drawerAvatar").textContent = customer.avatar;
    $("#customerDrawerTitle").textContent = customer.name;
    $("#drawerPhone").textContent = customer.phone || "手机号未绑定";
    $("#drawerSpend").textContent = `¥${customer.spend.toLocaleString("zh-CN")}`;
    $("#drawerOrders").textContent = customer.orders;
    $("#drawerAov").textContent = `¥${aov}`;
    $("#drawerJoined").textContent = customer.joined;
    $("#drawerLastVisit").textContent = customer.lastVisit;
    $("#drawerCity").textContent = customer.city;
    $("#drawerPhoneSource").textContent = customer.phoneSource;
    $("#drawerRecentPurchases").innerHTML = `<div class="recent-purchase">${renderProductArt(customer.id % 2 ? "art-green" : "art-blue", customer.recent.slice(0, 2))}<div><strong>${customer.recent}</strong><span>${customer.recentDate} · 最近一笔有效订单</span></div><b>${money(Math.max(39, Math.round(customer.spend / Math.max(1, customer.orders))))}</b></div>`;
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
    $("#agentNameInput").value = agent ? agent.name : "";
    $("#agentAccountInput").value = agent ? agent.account : "";
    $("#agentStatusInput").value = agent ? agent.status : "已启用";
    $("#agentContactInput").value = agent ? agent.contact : "";
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
    $("#agentDrawerInvite").textContent = agent.invite;
    $("#agentDrawerInviteState").textContent = `${agent.inviteStatus} · ${agent.inviteExpiresAt}`;
    $("#agentDrawerAuthMode").textContent = agent.authMode;
    $("#agentDrawerAuthCount").textContent = `${agent.authorizedCount} 件`;
    $("#agentDrawerBank").textContent = `${agent.bank} · ****${agent.cardLast4}`;
    $("#agentDrawerStatus").textContent = agent.status;
    $("#agentWalletAvailable").textContent = money(agent.available);
    $("#agentWalletFrozen").textContent = money(agent.frozen);
    $("#agentWalletNegative").textContent = money(agent.negative);
    $("#agentWalletNegative").classList.toggle("negative-balance", agent.negative > 0);
    renderAgentDrilldown("customers");
    closeOverlays();
    $("#modalBackdrop").hidden = false;
    $("#agentDrawer").hidden = false;
  }

  function agentAttributedOrders(agent) {
    return orders.filter((order) => order.paymentStatus === "PAID" && frozenOrderDetails[order.id]?.agent === agent.name);
  }

  function agentDrilldownRow(agent, title, detail, amount = "") {
    return `<article class="agent-drilldown-row" data-agent-id="${agent.id}"><div><strong>${title}</strong><small>${detail}</small></div>${amount ? `<b>${amount}</b>` : ""}</article>`;
  }

  function renderAgentDrilldown(type = state.activeAgentDrilldown) {
    const agent = agents.find((item) => item.id === state.activeAgentId);
    if (!agent || !$("#agentDrilldownContent")) return;
    state.activeAgentDrilldown = type;
    $("#agentDrilldownScope").textContent = agent.id;
    $$("[data-agent-drilldown]").forEach((button) => button.classList.toggle("is-active", button.dataset.agentDrilldown === type));
    let records = [];
    if (type === "customers") {
      records = customers.filter((customer) => customer.agentId === agent.id).map((customer) => agentDrilldownRow(agent, `${customer.nickname} · ${customer.phone || "手机号未绑定"}`, `CURRENT 有效绑定 · ${customer.agentBoundAt} · ${customer.city}`, money(customer.spend)));
    }
    if (type === "orders") {
      records = agentAttributedOrders(agent).map((order) => agentDrilldownRow(agent, `${order.id} · ${order.product}`, `PAID · final_agent_id=${agent.id} · ${order.displayStatus}`, money(order.amount)));
    }
    if (type === "commissions") {
      records = commissionLedger.filter((entry) => entry.agentId === agent.id && entry.type !== "FREEZE").map((entry) => agentDrilldownRow(agent, `${entry.type} · ${entry.order}`, `${entry.sku} · ${entry.detail}`, `${entry.amount > 0 ? "+" : ""}${money(entry.amount)}`));
    }
    if (type === "wallet") {
      records = commissionLedger.filter((entry) => entry.agentId === agent.id).map((entry) => agentDrilldownRow(agent, `${entry.type} · ${entry.order}`, `钱包变动 · ${entry.detail}`, `${entry.amount > 0 ? "+" : ""}${money(entry.amount)}`));
    }
    if (type === "withdrawals") {
      records = withdrawals.filter((entry) => entry.agentId === agent.id).map((entry) => agentDrilldownRow(agent, `${entry.id} · ${entry.statusCode}`, `${entry.bank} ${entry.card} · ${entry.time}`, money(entry.amount)));
    }
    if (type === "audit") {
      records = auditLogs.filter((entry) => entry.target.includes(agent.id)).map((entry) => agentDrilldownRow(agent, `${entry.id} · ${entry.type}`, `${entry.reason} · ${entry.result}`, entry.status));
    }
    $("#agentDrilldownContent").dataset.agentId = agent.id;
    $("#agentDrilldownContent").dataset.drilldownType = type;
    $("#agentDrilldownContent").innerHTML = records.length ? records.join("") : `<div class="empty-state compact-empty" data-agent-id="${agent.id}"><strong>当前代理暂无记录</strong><span>该投影仅查询 ${agent.id}，不混入其他代理数据。</span></div>`;
  }

  function openWhitelist(agentId = state.activeAgentId) {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    state.activeAgentId = agent.id;
    $("#whitelistTitle").textContent = `配置白名单 · ${agent.name}`;
    $("#whitelistProducts").innerHTML = products.filter((item) => item.status === "ACTIVE").map((product) => `<label class="check whitelist-product"><input type="checkbox" value="${product.id}" ${agent.authMode === "全部在售商品" || agent.whitelist.includes(product.id) ? "checked" : ""}><span>${product.name}<small>${product.code} · ${product.category}</small></span></label>`).join("");
    $("#whitelistReason").value = "";
    $("#whitelistConfirm").checked = false;
    $("#whitelistError").hidden = true;
    openModal("#whitelistModal");
  }

  function rotateInvite(agent, reason) {
    const old = agent.invite;
    const nonce = Math.random().toString(36).slice(2, 6).toUpperCase();
    agent.invite = `QX-${agent.id}-${nonce}`;
    agent.inviteStatus = "有效";
    agent.inviteExpiresAt = "2026-12-31";
    auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:10:00", type: "代理状态", actor: "林老板", target: agent.id, reason, result: `${old} 立即失效；新邀请码有效至 ${agent.inviteExpiresAt}`, client: "Web · Prototype", status: "成功" });
    renderAgents();
    renderAuditLogs();
    openAgentDrawer(agent.id);
    showToast("邀请码已轮换，旧码立即失效，已有绑定不受影响");
  }

  function setCommissionRuleMode(mode) {
    state.commissionRuleMode = mode;
    $$('[data-rule-mode]').forEach((button) => button.classList.toggle("active", button.dataset.ruleMode === mode));
    const active = state.activeCommissionRule;
    const rateInput = $("#ruleRateInput");
    rateInput.disabled = mode === "inherit";
    $("#ruleRateField").classList.toggle("is-inherited", mode === "inherit");
    if (mode === "inherit" && active) {
      if (active.type === "category") rateInput.value = commissionRuleSet.platformRate;
      if (active.type === "sku") rateInput.value = categoryRate(active.item.category);
    } else if (active) {
      const currentRate = active.type === "platform" ? commissionRuleSet.platformRate : active.item.rate;
      rateInput.value = currentRate === null ? (active.type === "category" ? commissionRuleSet.platformRate : categoryRate(active.item.category)) : currentRate;
    }
    $("#ruleModeHelp").textContent = mode === "inherit" ? "不保存独立比例，后续自动使用上一级有效规则。" : "单独设置后，将覆盖上一级继承来源。";
    updateCommissionRulePreview();
  }

  function updateCommissionRulePreview() {
    const active = state.activeCommissionRule;
    if (!active) return;
    const enteredRate = Math.max(0, Math.min(100, Number($("#ruleRateInput").value) || 0));
    let effectiveRate = enteredRate;
    let source = "平台默认";
    if (active.type === "category") {
      effectiveRate = state.commissionRuleMode === "inherit" ? commissionRuleSet.platformRate : enteredRate;
      source = state.commissionRuleMode === "inherit" ? "平台默认" : `一级分类“${active.item.name}”`;
    }
    if (active.type === "sku") {
      effectiveRate = state.commissionRuleMode === "inherit" ? categoryRate(active.item.category) : enteredRate;
      source = state.commissionRuleMode === "inherit" ? `一级分类“${active.item.category}”` : `SKU 例外“${active.item.id}”`;
    }
    $("#rulePreviewRate").textContent = `有效比例 ${effectiveRate.toFixed(2)}%`;
    $("#rulePreviewSource").textContent = `规则来源：${source}${active.type === "sku" ? ` · 预计 ${money(active.item.price * effectiveRate / 100)} / 件` : ""}`;
    const explicitZero = state.commissionRuleMode === "custom" && effectiveRate === 0;
    $("#ruleZeroNotice").hidden = !explicitZero;
  }

  function openCommissionRuleEditor(type, id = null) {
    let item = null;
    if (type === "category") item = commissionCategories.find((entry) => entry.id === id);
    if (type === "sku") item = commissionSkuRules.find((entry) => entry.id === id);
    if (type !== "platform" && !item) return;
    state.activeCommissionRule = { type, item };
    const isPlatform = type === "platform";
    const isCategory = type === "category";
    const currentRate = isPlatform ? commissionRuleSet.platformRate : item.rate;
    $("#commissionRuleModalTitle").textContent = isPlatform ? "编辑平台默认佣金" : isCategory ? `编辑分类规则 · ${item.name}` : `编辑 SKU 例外 · ${item.id}`;
    $("#commissionRuleModalSubtitle").textContent = "变更适用于全部一级代理，仅影响保存后支付的订单";
    $("#ruleTargetType").textContent = isPlatform ? "平台默认" : isCategory ? "一级分类" : "商品 SKU";
    $("#ruleTargetName").textContent = isPlatform ? "全平台佣金兜底规则" : isCategory ? item.name : `${item.name} · ${item.spec}`;
    $("#ruleTargetContext").textContent = isPlatform ? "8 个一级分类 · 全部授权商品" : isCategory ? `${item.productCount} 件商品 · ${item.skuCount} 个 SKU` : `${item.category} · ${item.id} · 零售价 ${money(item.price)}`;
    $("#ruleCurrentSource").textContent = isPlatform ? "平台默认" : isCategory ? (currentRate === null ? "继承平台" : "一级分类") : currentRate === null ? "继承分类" : (currentRate === 0 ? "SKU 例外 · 0%" : "SKU 例外");
    $("#ruleCurrentSource").className = `rule-source ${isPlatform ? "platform" : isCategory ? (currentRate === null ? "platform" : "category") : currentRate === null ? "category" : currentRate === 0 ? "zero" : "sku"}`;
    $('[data-rule-mode="inherit"]').hidden = isPlatform;
    $("#ruleModeSection").classList.toggle("platform-mode", isPlatform);
    $("#ruleRateInput").value = currentRate === null ? (isCategory ? commissionRuleSet.platformRate : categoryRate(item.category)) : currentRate;
    $("#ruleChangeReason").value = "";
    $("#ruleChangeConfirm").checked = false;
    $("#ruleImpactScope").textContent = isPlatform ? "全部授权商品与全部一级代理" : isCategory ? `${item.productCount} 件商品 · ${item.skuCount} 个 SKU` : `1 个 SKU · 全部一级代理`;
    $("#ruleImpactDetail").textContent = isPlatform ? "仅在 SKU 与一级分类均未设置时命中，影响后续支付订单商品行。" : isCategory ? "仅影响保存后支付且未命中 SKU 例外的该分类订单商品行。" : "仅影响保存后支付并命中该 SKU 的订单商品行，历史快照保持不变。";
    $("#ruleNextVersion").textContent = `CR-20260811-${String(state.commissionRuleRevision + 1).padStart(2, "0")}`;
    openModal("#commissionRuleModal");
    setCommissionRuleMode(isPlatform || currentRate !== null ? "custom" : "inherit");
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
    $("#openBankVerification").hidden = item.statusCode !== "APPROVED";
    $("#copyRevealedBank").hidden = true;
    $("#withdrawalCardPolicy").textContent = item.statusCode === "APPROVED" ? "APPROVED · 可二次验证临时查看" : "仅 APPROVED 状态允许查看完整卡号";
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
    $("#withdrawalNoteLabel").textContent = pending ? "审核备注（拒绝时必填）" : awaitingPayment ? "付款备注（选填）" : "处理备注";
    $("#withdrawalReviewNote").value = "";
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
    $("#auditRule").textContent = "统一商品规则";
    $("#auditAvailable").textContent = money(agent.available);
    $("#auditFrozen").textContent = money(agent.frozen);
    $("#auditNegative").textContent = money(agent.negative);
    const ledger = commissionLedger.filter((entry) => entry.agentId === agent.id);
    $("#commissionAuditList").innerHTML = ledger.length ? ledger.map((entry) => `<div><span class="audit-type ${entry.amount < 0 ? "danger" : entry.type === "FREEZE" ? "neutral" : "success"}">${entry.type}</span><p><strong>${entry.order} · SKU ${entry.sku}</strong><small>${entry.detail}</small></p><b class="${entry.amount < 0 ? "coral-text" : "positive-text"}">${entry.amount > 0 ? "+" : ""}${money(entry.amount)}</b></div>`).join("") : `<div><span class="audit-type neutral">EMPTY</span><p><strong>暂无佣金流水</strong><small>订单支付后将按商品行生成不可变快照</small></p><b>¥0.00</b></div>`;
  }

  function secureBankPlaceholder(agentId, last4) {
    const nonce = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8).toUpperCase() : Math.random().toString(36).slice(2, 10).toUpperCase();
    return `DEMO-ACCOUNT-${agentId}-${nonce}-LAST4-${last4}`;
  }

  function openBankVerification() {
    const withdrawal = withdrawals.find((item) => item.id === state.activeWithdrawalId);
    if (!withdrawal || withdrawal.statusCode !== "APPROVED") return showToast("仅 APPROVED 提现单允许查看完整银行卡号");
    const remaining = state.bankVerifyLockedUntil - Date.now();
    if (remaining > 0) return showToast(`二次验证已锁定，请 ${Math.ceil(remaining / 60000)} 分钟后重试`);
    openModal("#bankVerifyModal");
    state.bankRevealContext = { withdrawalId: withdrawal.id, agentId: withdrawal.agentId };
    $("#bankVerifyCode").value = "";
    $("#bankVerifyRejectDemo").checked = false;
    $("#bankVerifyState").className = "verify-state";
    $("#bankVerifyState").textContent = `尚未验证 · 当前失败 ${state.bankVerifyFailures}/5 次`;
  }

  function revealVerifiedBankCard() {
    const context = state.bankRevealContext;
    if (!context) return;
    const withdrawal = withdrawals.find((item) => item.id === context.withdrawalId);
    if (!withdrawal || withdrawal.statusCode !== "APPROVED") return showToast("提现状态已变化，临时查看请求已失效");
    if (Date.now() < state.bankVerifyLockedUntil) {
      $("#bankVerifyState").className = "verify-state locked";
      $("#bankVerifyState").textContent = "验证已锁定 15 分钟；请稍后重试，锁定事件已写入审计日志。";
      return;
    }
    const code = $("#bankVerifyCode").value.trim();
    if (!/^\d{6}$/.test(code)) return showToast("请输入当前管理员本人的 6 位 TOTP");
    if ($("#bankVerifyRejectDemo").checked) {
      state.bankVerifyFailures += 1;
      const locked = state.bankVerifyFailures >= 5;
      if (locked) state.bankVerifyLockedUntil = Date.now() + 15 * 60 * 1000;
      $("#bankVerifyState").className = `verify-state ${locked ? "locked" : "error"}`;
      $("#bankVerifyState").textContent = locked ? "连续失败 5 次，已锁定 15 分钟并记录安全审计。" : `验证失败 ${state.bankVerifyFailures}/5 次；请核对管理员密码和验证码。`;
      return;
    }
    state.bankVerifyFailures = 0;
    const fullCard = secureBankPlaceholder(context.agentId, withdrawal.card.slice(-4));
    $("#bankVerifyCode").value = "";
    closeOverlays();
    openWithdrawal(context.withdrawalId);
    $("#withdrawalCard").textContent = fullCard;
    $("#openBankVerification").hidden = true;
    $("#copyRevealedBank").hidden = false;
    $("#withdrawalCardTimer").hidden = false;
    $("#withdrawalCardPolicy").textContent = "单次授权已使用 · 离页或 60 秒后清除";
    state.bankRevealGrant = { withdrawalId: context.withdrawalId, expiresAt: Date.now() + 60000, used: true };
    clearTimeout(state.bankRevealTimer);
    state.bankRevealTimer = setTimeout(() => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (item && !$("#withdrawalModal").hidden) {
        $("#withdrawalCard").textContent = item.card;
        $("#openBankVerification").hidden = item.statusCode !== "APPROVED";
        $("#copyRevealedBank").hidden = true;
        $("#withdrawalCardTimer").hidden = true;
        $("#withdrawalCardPolicy").textContent = "APPROVED · 可二次验证临时查看";
        state.bankRevealGrant = null;
      }
    }, 60000);
    showToast("模拟服务端验证通过，运行时安全占位仅展示 60 秒");
  }

  function openOrderDetail(id) {
    const order = orders.find((item) => item.id === id);
    if (!order) return;
    state.activeOrderId = id;
    $("#detailOrderNumber").textContent = `订单号 ${order.id}`;
    const status = $("#detailOrderStatus");
    status.textContent = order.status;
    status.className = `tag ${statusClass(order.status)}`;
    const canShip = canShipOrder(order);
    $("#openShipModal").hidden = !canShip;
    $("#sideShipButton").hidden = !canShip;
    renderOrderDetail(order);
    showPage("order-detail");
  }

  function setupEvents() {
    $("#loginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const username = $("#username").value.trim();
      const password = $("#password").value.trim();
      const remaining = state.loginLockedUntil - Date.now();
      if (remaining > 0) {
        $("#loginError").hidden = false;
        $("#loginError").textContent = `连续失败过多，模拟服务端已限流，请 ${Math.ceil(remaining / 60000)} 分钟后重试`;
        return;
      }
      if (!username || password.length < 8) {
        state.loginFailures += 1;
        if (state.loginFailures >= 5) state.loginLockedUntil = Date.now() + 15 * 60 * 1000;
        $("#loginError").hidden = false;
        $("#loginError").textContent = `模拟服务端校验失败（${state.loginFailures}/5）：账号必填且密码至少 8 位`;
        return;
      }
      if (username === "disabled.admin") {
        $("#loginError").hidden = false;
        $("#loginError").textContent = "该管理员账号已停用，禁止登录";
        return;
      }
      if (username === "wrong.admin") {
        state.loginFailures += 1;
        $("#loginError").hidden = false;
        $("#loginError").textContent = `模拟服务端拒绝：账号或密码错误（${state.loginFailures}/5）`;
        return;
      }
      state.loginFailures = 0;
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
        if (page === "agents" && go.dataset.agentStatus !== undefined) {
          $("#agentStatus").value = go.dataset.agentStatus;
          renderAgents();
        }
        if (page === "withdrawals" && go.dataset.withdrawalStatus !== undefined) {
          $("#withdrawalStatus").value = go.dataset.withdrawalStatus;
          renderWithdrawals();
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
        openProductEditor(editProduct.closest("tr").dataset.productId);
      }

      const viewProduct = event.target.closest(".view-product");
      if (viewProduct) {
        openProductEditor(viewProduct.closest("tr").dataset.productId);
      }

      const productLifecycle = event.target.closest(".product-lifecycle");
      if (productLifecycle) {
        const product = products.find((item) => item.id === Number(productLifecycle.closest("tr").dataset.productId));
        if (product) catalogLifecyclePreview("product", product, product, productLifecycle.dataset.lifecycleAction);
      }

      const restoreProduct = event.target.closest(".restore-product");
      if (restoreProduct) {
        const product = products.find((item) => item.id === Number(restoreProduct.closest("tr").dataset.productId));
        if (product) openRestoreEntity("product", product);
      }

      const skuLifecycle = event.target.closest(".sku-lifecycle");
      if (skuLifecycle) {
        const product = products.find((item) => item.id === state.activeProductId);
        const sku = product && productSkus[product.id]?.find((item) => item.id === skuLifecycle.closest("tr").dataset.skuId);
        if (product && sku) catalogLifecyclePreview("sku", product, sku, skuLifecycle.dataset.lifecycleAction);
      }

      const restoreSku = event.target.closest(".restore-sku");
      if (restoreSku) {
        const product = products.find((item) => item.id === state.activeProductId);
        const sku = product && productSkus[product.id]?.find((item) => item.id === restoreSku.closest("tr").dataset.skuId);
        if (product && sku) openRestoreEntity("sku", sku, product);
      }

      if (event.target.closest("#uploadProductImage")) {
        if (state.activeProductImageCount >= 8) showToast("商品图集最多 8 张");
        else {
          state.activeProductImageCount += 1;
          const product = products.find((item) => item.id === state.activeProductId);
          renderProductEditorImages(product, state.activeProductImageCount);
          showToast(`已加入第 ${state.activeProductImageCount} 张图片`);
        }
      }

      const review = event.target.closest(".review-aftersale");
      if (review) openAftersale(review.closest("tr").dataset.aftersaleId);

      const viewCustomer = event.target.closest(".view-customer");
      if (viewCustomer) openCustomer(viewCustomer.closest("tr").dataset.customerId);

      const viewAgent = event.target.closest(".view-agent");
      if (viewAgent) openAgentDrawer(viewAgent.closest("tr").dataset.agentId);

      const agentDrilldown = event.target.closest("[data-agent-drilldown]");
      if (agentDrilldown) renderAgentDrilldown(agentDrilldown.dataset.agentDrilldown);

      const removeInspectionEvidence = event.target.closest(".remove-inspection-evidence");
      if (removeInspectionEvidence) {
        const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
        if (item?.inspection?.evidenceSealed) return showToast("验货证据已封存，不可改写");
        state.inspectionEvidenceDraft.splice(Number(removeInspectionEvidence.dataset.evidenceIndex), 1);
        if (item) renderInspectionEvidence(item);
      }

      const editAgent = event.target.closest(".edit-agent");
      if (editAgent) openAgentEditor(editAgent.closest("tr").dataset.agentId);

      const toggleAgent = event.target.closest(".toggle-agent");
      if (toggleAgent) {
        const agent = agents.find((item) => item.id === toggleAgent.closest("tr").dataset.agentId);
        if (agent) {
          const nextStatus = agent.status === "已启用" ? "已停用" : "已启用";
          requestHighRiskAction({
            title: `${nextStatus === "已停用" ? "停用" : "启用"}代理 · ${agent.name}`,
            impact: nextStatus === "已停用" ? `将立即禁止 ${agent.name} 登录、新客户绑定与新佣金；历史订单、钱包和已申请提现保留。` : `将恢复 ${agent.name} 登录、新客户绑定与后续订单佣金，历史记录不回写。`,
            confirmLabel: `确认${nextStatus === "已停用" ? "停用" : "启用"}`,
            action: (reason) => {
              agent.status = nextStatus;
              auditLogs.unshift({ id: `AUD-20260811-${String(400 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:40:18", type: "代理状态", actor: "林老板", target: `${agent.id} ${agent.name}`, reason, result: nextStatus, client: "Web · 10.8.0.16", status: "成功" });
              renderAgents();
              renderAuditLogs();
              showToast(nextStatus === "已停用" ? "代理已停用，限制已立即生效" : "代理账号已恢复启用");
            }
          });
        }
      }

      const editBrand = event.target.closest(".edit-brand");
      if (editBrand) openEntityEditor("brand", editBrand.closest("tr").dataset.brandId);

      const editCategory = event.target.closest(".edit-category");
      if (editCategory) openEntityEditor("category", editCategory.closest("tr").dataset.categoryId);

      const lifecycle = event.target.closest(".entity-lifecycle");
      if (lifecycle) {
        if (state.highRiskSubmitting) return showToast("上一项生命周期操作正在提交，请稍候");
        const row = lifecycle.closest("tr");
        const type = lifecycle.dataset.entityType;
        const id = type === "brand" ? row.dataset.brandId : row.dataset.categoryId;
        const item = entityByType(type, id);
        if (item) lifecyclePreview(type, item, lifecycle.dataset.lifecycleAction);
      }

      const restoreEntity = event.target.closest(".restore-entity");
      if (restoreEntity) {
        const row = restoreEntity.closest("tr");
        const type = restoreEntity.dataset.entityType;
        const id = type === "brand" ? row.dataset.brandId : row.dataset.categoryId;
        const item = entityByType(type, id);
        if (item) openRestoreEntity(type, item);
      }

      const inventoryAdjust = event.target.closest(".inventory-adjust");
      if (inventoryAdjust) {
        const item = inventorySkus.find((entry) => entry.id === inventoryAdjust.closest("tr").dataset.inventoryId);
        if (item) openInventoryEditor(item.id, false);
      }

      const inventoryFlow = event.target.closest(".inventory-flow");
      if (inventoryFlow) openInventoryEditor(inventoryFlow.closest("tr").dataset.inventoryId, true);

      const editBanner = event.target.closest(".edit-banner");
      if (editBanner) openEntityEditor("banner", editBanner.closest(".banner-manage-card").dataset.bannerId);

      const bannerToggle = event.target.closest(".banner-toggle");
      if (bannerToggle) {
        const banner = banners.find((item) => item.id === bannerToggle.closest(".banner-manage-card").dataset.bannerId);
        if (banner) openEntityEditor("banner", banner.id);
      }

      const businessRule = event.target.closest(".edit-business-rule");
      if (businessRule) openBusinessRule(businessRule.dataset.ruleKey);

      const adminState = event.target.closest("[data-admin-state]");
      if (adminState) {
        const preview = $("#adminStatePreview");
        const states = {
          loading: ["loading-state", "clock", "正在加载", "正在读取最新规则版本，请勿重复提交..."],
          error: ["error-state", "alert", "网络错误", "请求失败，筛选条件已保留，可重新加载。"],
          forbidden: ["forbidden-state", "shield", "403 权限不足", "当前管理员无权查看完整银行卡或修改该规则。"],
          conflict: ["conflict-state", "refresh", "409 版本冲突", "记录已被其他管理员更新，请刷新后重新提交。"],
          success: ["success-state", "check", "操作成功", "规则已保存，审计编号 AUD-20260811-0386。"]
        };
        const current = states[adminState.dataset.adminState];
        preview.className = `system-state-preview ${current[0]}`;
        preview.innerHTML = `${icon(current[1])}<div><strong>${current[2]}</strong><span>${current[3]}</span></div>`;
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
        clearTimeout(state.reportRequestTimer);
        state.reportRange = reportButton.dataset.reportRange;
        state.reportStatus = "ready";
        $$("[data-report-range]").forEach((item) => item.classList.toggle("active", item === reportButton));
        renderReportRange();
        renderReportState();
      }

      if (event.target.closest("#dashboardReportRetry")) requestDashboardReport(true);

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

      const commissionTab = event.target.closest("[data-commission-tab]");
      if (commissionTab) {
        $$('[data-commission-tab]').forEach((item) => item.classList.toggle("active", item === commissionTab));
        $("#categoryRulePanel").hidden = commissionTab.dataset.commissionTab !== "category";
        $("#skuRulePanel").hidden = commissionTab.dataset.commissionTab !== "sku";
      }

      const editPlatformRule = event.target.closest(".edit-platform-rule");
      if (editPlatformRule) openCommissionRuleEditor("platform");

      const editCategoryRule = event.target.closest(".edit-category-rule");
      if (editCategoryRule) openCommissionRuleEditor("category", editCategoryRule.closest("tr").dataset.categoryId);

      const editSkuRule = event.target.closest(".edit-sku-rule");
      if (editSkuRule) openCommissionRuleEditor("sku", editSkuRule.closest("tr").dataset.skuRuleId);

      const removeSkuRule = event.target.closest(".remove-sku-rule");
      if (removeSkuRule) {
        const rule = commissionSkuRules.find((item) => item.id === removeSkuRule.closest("tr").dataset.skuRuleId);
        if (rule) {
          openCommissionRuleEditor("sku", rule.id);
          setCommissionRuleMode("inherit");
          $("#commissionRuleModalTitle").textContent = `恢复继承 · ${rule.id}`;
          $("#ruleChangeReason").placeholder = "请说明恢复分类继承的业务原因";
        }
      }

      const ruleMode = event.target.closest("[data-rule-mode]");
      if (ruleMode) setCommissionRuleMode(ruleMode.dataset.ruleMode);

      const skuDelete = event.target.closest(".sku-delete");
      if (skuDelete) {
        skuDelete.closest("tr").remove();
        $("#productSkuTabCount").textContent = $$("#skuRows tr").length;
        $("#productSummarySkuCount").textContent = $$("#skuRows tr").length;
        showToast("未保存的 SKU 已移除");
      }
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest("#notificationPanel, #notificationButton")) $("#notificationPanel").hidden = true;
    });

    $("#modalBackdrop").addEventListener("click", closeOverlays);
    $("#highRiskRepair").addEventListener("click", () => {
      const repair = state.highRiskRepairAction;
      if (!repair) return;
      closeOverlays();
      repair();
    });
    $("#simulateHighRiskConflict").addEventListener("click", () => {
      const context = state.pendingHighRiskAction?.catalogContext;
      if (!context) return;
      context.target.version += 1;
      renderProducts();
      if (context.type === "sku" && state.activeProductId === context.product.id) renderProductEditorSkus(productSkus[context.product.id]);
      $("#simulateHighRiskConflict").disabled = true;
      setHighRiskDiagnostic({ message: `已模拟其他管理员将记录更新至 v${context.target.version}；当前预览仍绑定 v${context.expectedVersion}。` });
    });
    $("#confirmHighRisk").addEventListener("click", () => {
      const pending = state.pendingHighRiskAction;
      const reason = $("#highRiskReason").value.trim();
      if (state.highRiskSubmitting) return showToast("操作正在提交，请勿重复点击");
      if (!pending || (pending.reasonRequired !== false && (reason.length < 2 || reason.length > 500)) || !$("#highRiskConfirm").checked) {
        $("#highRiskError").hidden = false;
        return;
      }
      const catalogContext = pending.catalogContext;
      if (catalogContext && catalogContext.target.version !== catalogContext.expectedVersion) {
        const currentVersion = catalogContext.target.version;
        renderProducts();
        if (catalogContext.type === "sku" && state.activeProductId === catalogContext.product.id) renderProductEditorSkus(productSkus[catalogContext.product.id]);
        showHighRiskBusinessError({
          code: "RESOURCE_VERSION_CONFLICT",
          status: 409,
          businessMessage: "记录已被其他操作更新。页面已刷新至最新版本，请重新检查影响后再确认。",
          diagnosticMessage: `旧预览绑定 v${catalogContext.expectedVersion}，当前资源为 v${currentVersion}；旧预览已销毁，不得复用或自动覆盖。`,
          subtitle: "已刷新最新记录，本次确认未生效"
        });
        $("#highRiskConfirm").checked = false;
        $("#confirmHighRisk").disabled = true;
        $("#highRiskRepair").hidden = false;
        $("#highRiskRepair").textContent = `返回最新${catalogContext.type === "product" ? "商品" : "SKU"}`;
        state.highRiskRepairAction = () => {
          if (catalogContext.type === "product") {
            renderProducts();
            showPage("products");
          } else {
            openProductEditor(catalogContext.product.id);
            selectProductEditorTab("sku");
          }
          showToast("已载入最新版本，请重新发起影响预览");
        };
        state.pendingHighRiskAction = null;
        return;
      }
      if (catalogContext?.type === "sku" && catalogContext.action === "ACTIVATE" && catalogContext.product.status === "ARCHIVED") {
        pending.confirmError = archivedParentSkuActivationError();
        setProductEditorReadOnly(true, catalogContext.product);
        renderProductEditorImages(catalogContext.product, state.activeProductImageCount, true);
        renderProductEditorSkus(productSkus[catalogContext.product.id], true);
        $("#highRiskRepair").hidden = false;
        $("#highRiskRepair").textContent = "返回最新商品";
        state.highRiskRepairAction = archivedProductRepair(catalogContext.product);
      }
      if (pending.confirmError) {
        const error = pending.confirmError;
        if (pending.catalogContext) {
          showHighRiskBusinessError(error);
          if (error.status === 409) {
            renderProducts();
            if (pending.catalogContext.type === "sku" && state.activeProductId === pending.catalogContext.product.id) {
              renderProductEditorSkus(productSkus[pending.catalogContext.product.id]);
            }
            $("#highRiskConfirm").checked = false;
            $("#confirmHighRisk").disabled = true;
            state.pendingHighRiskAction = null;
            showToast("已刷新最新数据，请处理冲突后重新发起影响预览");
            return;
          }
          $("#highRiskConfirm").checked = false;
          $("#confirmHighRisk").disabled = true;
          state.pendingHighRiskAction = null;
          showToast("本次确认未生效，请修复后重新发起影响预览");
          return;
        } else {
          $("#highRiskSubtitle").textContent = `确认失败 · HTTP ${error.status}`;
          $("#highRiskError").textContent = `${error.code}（${error.status}）：${error.message}`;
          $("#highRiskError").hidden = false;
        }
        $("#highRiskConfirm").checked = false;
        showToast("本次确认未生效，记录保持不变");
        return;
      }
      const action = pending.action;
      state.highRiskSubmitting = true;
      $("#confirmHighRisk").disabled = true;
      closeOverlays();
      action(reason || pending.auditReason || "按流程确认");
      setTimeout(() => {
        state.highRiskSubmitting = false;
        $("#confirmHighRisk").disabled = false;
      }, 350);
    });
    $("#openShipModal").addEventListener("click", () => openShipping(state.activeOrderId));
    $("#sideShipButton").addEventListener("click", () => openShipping(state.activeOrderId));

    $("#confirmShipping").addEventListener("click", () => {
      if (state.shippingSubmitting) return showToast("发货请求正在处理，请勿重复提交");
      const company = $("#shippingCompany").value;
      const tracking = $("#trackingNumber").value.trim();
      const order = orders.find((item) => item.id === state.activeOrderId);
      const blocker = order && activeAftersaleForOrder(order.id);
      if (!company || !tracking || blocker || !order || order.status !== "待发货") {
        $("#shippingError").hidden = false;
        $("#shippingError").textContent = blocker ? `${blocker.id} 仍为活动售后，单包裹整单发货已阻断` : "请选择物流公司并填写物流单号";
        return;
      }
      state.shippingSubmitting = true;
      $("#confirmShipping").disabled = true;
      if (order) { order.status = "运输中"; order.displayStatus = "运输中"; order.orderStatus = "SHIPPING"; order.fulfillmentStatus = "IN_TRANSIT"; }
      order.trackingEvents = [{ carrier: company, tracking, note: $("#shippingEventNote").value.trim() || "总部仓已发货", time: "08-11 12:16" }];
      auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:16:00", type: "订单发货", actor: "林老板", target: order.id, reason: order.trackingEvents[0].note, result: `${company} ${tracking}`, client: "Web · Prototype", status: "成功" });
      $("#detailOrderStatus").textContent = "运输中";
      $("#detailOrderStatus").className = "tag info";
      $("#openShipModal").hidden = true;
      $("#sideShipButton").hidden = true;
      if (order) renderOrderDetail(order);
      renderOrders();
      renderDashboardOrders();
      renderAuditLogs();
      closeOverlays();
      showToast(`发货成功：${company} ${tracking}`);
      setTimeout(() => { state.shippingSubmitting = false; $("#confirmShipping").disabled = false; }, 350);
    });

    $("#cancelShipping").addEventListener("click", () => {
      closeOverlays();
      showToast("已主动取消本次发货录入，订单状态未改变");
    });

    $("#confirmStock").addEventListener("click", () => {
      const item = inventorySkus.find((entry) => entry.id === state.activeInventorySku);
      const value = Number($("#newStock").value);
      const warning = Number($("#stockWarning").value);
      const reason = $("#stockReason").value;
      const note = $("#stockNote").value.trim();
      if (!item || value < 0 || warning < 0 || !Number.isInteger(value) || !Number.isInteger(warning) || !reason || !note) {
        $("#stockError").hidden = false;
        return;
      }
      const delta = value - item.available;
      item.available = value;
      item.warning = warning;
      inventoryLedger[item.id] ||= [];
      inventoryLedger[item.id].unshift({ time: "08-11 12:18", delta, result: value, reason: `${reason} · ${note}`, actor: "林老板" });
      renderProducts();
      renderRankings();
      renderInventory();
      closeOverlays();
      showToast("库存已调整，并写入库存流水");
    });

    Object.values(inspectionInputs).forEach((selector) => $(selector).addEventListener("input", () => {
      const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
      updateInspectionBalance(item);
    }));

    $("#stockSkuSelect").addEventListener("change", () => openInventoryEditor($("#stockSkuSelect").value, false, { preserveProduct: true }));

    $("#addInspectionEvidence").addEventListener("click", () => {
      const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
      if (!item || item.statusCode !== "WAITING_INSPECTION") return showToast("当前状态不能增加验货证据");
      state.inspectionEvidenceSequence += 1;
      const suffix = String(state.inspectionEvidenceSequence).padStart(2, "0");
      state.inspectionEvidenceDraft.push({ fileId: `FILE-${item.id}-${suffix}`, name: `验货证据-${suffix}.jpg`, sha256: `9F4C${item.id.slice(-4)}${suffix}A71E` });
      renderInspectionEvidence(item);
      showToast("已选择验货证据，提交结论后封存");
    });

    $("#approveAftersale").addEventListener("click", () => {
      const item = aftersales.find((after) => after.id === state.activeAftersaleId);
      const note = $("#reviewNote").value.trim();
      if (state.aftersaleSubmitting) return showToast("售后操作正在处理，请勿重复提交");
      if (!item || !note) return showToast("请填写售后处理说明");
      const inspection = item.statusCode === "WAITING_INSPECTION" ? inspectionValidation(item, "PASS") : null;
      if (inspection && !inspection.ok) return showToast(`PASS：${inspection.message}`);
      const actionLabel = item.statusCode === "REFUND_FAILED" ? "重试退款" : item.statusCode === "WAITING_INSPECTION" ? "验货通过并退款" : "同意售后";
      const impact = inspection
        ? `${inspectionImpact(inspection.values)}PASS 通过后释放占用，按批准数量退款、回库并追加佣金冲正。`
        : `${item.product} ${item.sku} × ${item.quantity}；${item.type === "退货退款" && item.statusCode === "PENDING_REVIEW" ? "同意后提供总部退货地址并等待客户物流。" : "退款成功后按验货/未发货结果回库，并按原佣金快照追加冲正。"}`;
      requestHighRiskAction({
        title: `${actionLabel} · ${item.id}`,
        reason: note,
        impact,
        confirmLabel: `确认${actionLabel}`,
        action: (reason) => {
          setOperationBusy("aftersale", true);
          if (item.type === "退货退款" && item.statusCode === "PENDING_REVIEW") {
            item.status = "待退货";
            item.statusCode = "WAITING_RETURN";
            auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:22:00", type: "售后退款", actor: "林老板", target: item.id, reason, result: "WAITING_RETURN · 已提供总部退货地址", client: "Web · Prototype", status: "成功" });
            renderAftersales();
            renderAuditLogs();
            setOperationBusy("aftersale", false);
            showToast("已同意退货退款并提供总部退货地址");
            return;
          }
          if (inspection) item.inspection = sealInspection(item, inspection.values);
          item.status = "待退款";
          item.statusCode = "REFUNDING";
          renderAftersales();
          setTimeout(() => {
            finalizeAftersaleRefund(item, reason);
            setOperationBusy("aftersale", false);
            showToast("退款成功，库存与佣金冲正已按快照处理");
          }, 260);
        }
      });
    });

    $("#rejectAftersale").addEventListener("click", () => {
      const item = aftersales.find((after) => after.id === state.activeAftersaleId);
      const note = $("#reviewNote").value.trim();
      if (!item || !note) return showToast("拒绝售后必须填写处理说明");
      requestHighRiskAction({
        title: `拒绝售后 · ${item.id}`,
        reason: note,
        impact: `将驳回 ${item.customer} 的 ${item.type} 申请，并释放已占用的可退数量与金额；客户可查看处理说明。`,
        confirmLabel: "确认拒绝",
        action: (reason) => {
          item.status = "已拒绝";
          item.statusCode = "REJECTED";
          item.reserved = false;
          auditLogs.unshift({ id: `AUD-20260811-${String(430 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:46:12", type: "售后退款", actor: "林老板", target: item.id, reason, result: "已拒绝 · 占用已释放", client: "Web · 10.8.0.16", status: "成功" });
          renderAftersales();
          renderAuditLogs();
          showToast("已拒绝售后并释放可退数量与金额占用");
        }
      });
    });

    $("#advanceAftersale").addEventListener("click", () => {
      const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
      const note = $("#reviewNote").value.trim();
      if (!item || item.statusCode !== "WAITING_RETURN" || !note) return showToast("请填写退货物流核对说明");
      item.returnCarrier = "中通快递";
      item.returnTracking = `RETURN-DEMO-${item.id.slice(-4)}`;
      item.status = "待验货";
      item.statusCode = "WAITING_INSPECTION";
      auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:23:00", type: "售后退款", actor: "林老板", target: item.id, reason: note, result: `${item.returnCarrier} ${item.returnTracking} · WAITING_INSPECTION`, client: "Web · Prototype", status: "成功" });
      renderAftersales();
      renderAuditLogs();
      openAftersale(item.id);
      showToast("退货物流已录入，等待总部验货");
    });

    $("#exceptionAftersale").addEventListener("click", () => {
      const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
      const exception = $("#inspectionException").value.trim();
      const note = $("#reviewNote").value.trim();
      if (!item || item.statusCode !== "WAITING_INSPECTION" || !exception || !note) return showToast("请填写处理说明和验货异常");
      const inspection = inspectionValidation(item, "ABNORMAL");
      if (!inspection.ok) return showToast(`ABNORMAL：${inspection.message}`);
      requestHighRiskAction({ title: `登记验货异常 · ${item.id}`, reason: note, impact: `${inspectionImpact(inspection.values)}记录异常“${exception}”，${state.inspectionEvidenceDraft.length} 份证据将与验货数量一并封存，退款占用保持。`, confirmLabel: "确认登记异常", action: (reason) => {
        item.status = "验货异常";
        item.statusCode = "RETURN_EXCEPTION";
        item.inspectionException = exception;
        item.inspection = sealInspection(item, inspection.values, exception);
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:23:30", type: "售后退款", actor: "林老板", target: item.id, reason, result: `RETURN_EXCEPTION · ABNORMAL · 证据 ${item.inspection.evidenceCount} 份已封存 · ${exception} · ${inspectionImpact(inspection.values)}`, client: "Web · Prototype", status: "成功" });
        renderAftersales();
        renderAuditLogs();
        showToast("验货事实已封存，请选择二阶段处置");
      }});
    });

    $("#continueRefundAfterInspection").addEventListener("click", () => {
      const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
      const reason = $("#inspectionResolutionReason").value.trim();
      if (!item || item.statusCode !== "RETURN_EXCEPTION" || item.inspection?.resolution) return showToast("当前验货异常已处置或状态已变更");
      if (reason.length < 2) return showToast("CONTINUE_REFUND 必须填写可审计的继续退款原因");
      requestHighRiskAction({ title: `CONTINUE_REFUND · ${item.id}`, reason, impact: `保留 ABNORMAL 验货数量与 ${item.inspection.evidenceCount} 份封存证据，按批准 ${item.inspection.approvedRefundQty} 件继续退款。该决议仅允许一次。`, confirmLabel: "确认继续退款", action: (auditReason) => {
        item.inspection = deepFreeze({ ...item.inspection, resolution: "CONTINUE_REFUND", resolutionReason: auditReason, resolvedAt: "2026-08-11 12:26:00" });
        item.status = "退款处理中";
        item.statusCode = "REFUNDING_AFTER_RETURN";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:26:00", type: "售后退款", actor: "林老板", target: item.id, reason: auditReason, result: "CONTINUE_REFUND · 验货证据保持封存", client: "Web · Prototype", status: "成功" });
        renderAftersales();
        renderAuditLogs();
        setTimeout(() => { finalizeAftersaleRefund(item, auditReason); showToast("CONTINUE_REFUND 已完成，验货事实保持封存"); }, 260);
      }});
    });

    $("#rejectAfterInspection").addEventListener("click", () => {
      const item = aftersales.find((entry) => entry.id === state.activeAftersaleId);
      const reason = $("#inspectionResolutionReason").value.trim();
      if (!item || item.statusCode !== "RETURN_EXCEPTION" || item.inspection?.resolution) return showToast("当前验货异常已处置或状态已变更");
      if (reason.length < 2) return showToast("REJECT_AFTER_RETURN 必须填写可审计的拒绝原因");
      requestHighRiskAction({ title: `REJECT_AFTER_RETURN · ${item.id}`, reason, impact: `保留 ABNORMAL 验货数量与 ${item.inspection.evidenceCount} 份封存证据，终止退款并释放占用。该决议仅允许一次。`, confirmLabel: "确认退货后拒绝", action: (auditReason) => {
        item.inspection = deepFreeze({ ...item.inspection, resolution: "REJECT_AFTER_RETURN", resolutionReason: auditReason, resolvedAt: "2026-08-11 12:26:00" });
        item.status = "退货后已拒绝";
        item.statusCode = "REJECTED_AFTER_RETURN";
        item.reserved = false;
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:26:00", type: "售后退款", actor: "林老板", target: item.id, reason: auditReason, result: "REJECT_AFTER_RETURN · 占用已释放 · 验货证据保持封存", client: "Web · Prototype", status: "成功" });
        renderAftersales();
        renderAuditLogs();
        showToast("REJECT_AFTER_RETURN 已完成，验货事实保持封存");
      }});
    });

    $("#openCreateAgent").addEventListener("click", () => openAgentEditor());
    $("#agentAuthModeInput").addEventListener("change", () => {
      const custom = $("#agentAuthModeInput").value === "自定义白名单";
      $("#agentAuthSummary").textContent = custom ? "自定义白名单 · 0 件" : "全部在售商品 · 116 件";
    });
    $("#configureAgentProducts").addEventListener("click", () => {
      if ($("#agentAuthModeInput").value === "全部在售商品") return showToast("已自动授权全部 116 件在售商品");
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (agent) openWhitelist(agent.id);
      else showToast("请先保存代理，再配置自定义白名单");
    });

    $("#saveAgent").addEventListener("click", () => {
      const name = $("#agentNameInput").value.trim();
      const account = $("#agentAccountInput").value.trim();
      if (!name || !account) return showToast("请完整填写代理名称和登录账号");
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (agent) {
        const nextStatus = $("#agentStatusInput").value;
        const contact = $("#agentContactInput").value.trim();
        const authMode = $("#agentAuthModeInput").value;
        const authorizedCount = authMode === "全部在售商品" ? 116 : Number($("#agentAuthSummary").textContent.match(/\d+/)?.[0] || 0);
        const applyChanges = () => {
          agent.name = name;
          agent.account = account;
          agent.status = nextStatus;
          agent.contact = contact;
          agent.authMode = authMode;
          agent.authorizedCount = authorizedCount;
          renderAgents();
          showToast("代理资料已保存；白名单仅限制推广，不影响已绑定客户全店计佣");
        };
        if (nextStatus !== agent.status) {
          requestHighRiskAction({
            title: `变更代理状态 · ${agent.name}`,
            impact: nextStatus === "已停用" ? "将禁止登录、新绑定与新佣金；历史订单、钱包和提现保留。" : "将恢复登录、新绑定与后续订单佣金；历史记录不回写。",
            confirmLabel: "确认保存状态变更",
            action: (reason) => {
              applyChanges();
              auditLogs.unshift({ id: `AUD-20260811-${String(460 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:52:26", type: "代理状态", actor: "林老板", target: `${agent.id} ${agent.name}`, reason, result: nextStatus, client: "Web · 10.8.0.16", status: "成功" });
              renderAuditLogs();
            }
          });
          return;
        }
        applyChanges();
        closeOverlays();
        return;
      }
      const sequence = 1040 + agents.length;
      const authMode = $("#agentAuthModeInput").value;
      agents.unshift({ id: `A${sequence}`, name, account, contact: $("#agentContactInput").value.trim(), createdAt: "2026-08-11", invite: `QX-A${sequence}`, inviteStatus: "有效", inviteExpiresAt: "2026-12-31", authMode, authorizedCount: authMode === "全部在售商品" ? 116 : 0, whitelist: [], customers: 0, sales: 0, available: 0, frozen: 0, negative: 0, bank: "未设置", cardLast4: "----", status: $("#agentStatusInput").value, avatar: name.slice(0, 1) });
      renderAgents();
      showOneTimeCredentials(account);
      showToast("代理已创建，请安全交付一次性登录凭证");
    });

    $("#openAttributionModal").addEventListener("click", () => {
      const customer = customers.find((item) => item.id === state.activeCustomerId);
      $("#attributionCustomer").textContent = `客户 · ${customer ? customer.name : "未选择"}`;
      openModal("#attributionModal");
      $("#attributionAgent").value = customer && customer.agentId ? customer.agentId : "DIRECT";
      $("#attributionConfirm").checked = false;
    });

    $("#confirmAttribution").addEventListener("click", () => {
      const reason = $("#attributionReason").value.trim();
      if (!reason) return showToast("请填写调整原因");
      if (!$("#attributionConfirm").checked) return showToast("请核对影响范围并勾选确认");
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
      auditLogs.unshift({ id: `AUD-20260811-${String(440 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:48:26", type: "客户归属", actor: "林老板", target: `${customer.id} ${customer.nickname}`, reason, result: `${previousAgent ? previousAgent.id : "DIRECT"} → ${nextAgent ? nextAgent.id : "DIRECT"}`, client: "Web · 10.8.0.16", status: "成功" });
      renderAgents();
      renderAuditLogs();
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
      if (agent) openWhitelist(agent.id);
    });
    $("#openCommissionAudit").addEventListener("click", openCommissionAudit);
    $("#openBankVerification").addEventListener("click", openBankVerification);
    $("#confirmBankVerification").addEventListener("click", revealVerifiedBankCard);
    $("#copyRevealedBank").addEventListener("click", () => {
      if (!state.bankRevealGrant || state.bankRevealGrant.withdrawalId !== state.activeWithdrawalId) return showToast("临时授权已失效");
      const value = $("#withdrawalCard").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(value).catch(() => {});
      clearBankReveal();
      showToast("安全占位已一次性复制并立即清除明文区域");
    });

    $("#viewCustomerOrders").addEventListener("click", () => {
      const customer = customers.find((item) => item.id === state.activeCustomerId);
      if (!customer) return;
      state.activeCustomerOrderFilter = customer.name;
      $("#orderSearch").value = customer.name;
      $("#orderStatus").value = "";
      renderOrders();
      showPage("orders");
      showToast(`已按客户“${customer.name}”筛选订单`);
    });

    $("#rotateAgentInvite").addEventListener("click", () => {
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (!agent) return;
      requestHighRiskAction({ title: `轮换邀请码 · ${agent.name}`, impact: `旧邀请码 ${agent.invite} 立即失效；已有客户绑定不受影响，新码有效期至 2026-12-31。`, confirmLabel: "确认轮换", action: (reason) => rotateInvite(agent, reason) });
    });

    $("#disableAgentInvite").addEventListener("click", () => {
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (!agent) return;
      requestHighRiskAction({ title: `停用邀请码 · ${agent.name}`, impact: "旧推广链接仍可打开普通商品页，但不再建立新代理候选；已有绑定和全店计佣资格不受影响。", confirmLabel: "确认停用", action: (reason) => {
        agent.inviteStatus = "已停用";
        agent.inviteExpiresAt = "-";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:28:00", type: "代理状态", actor: "林老板", target: agent.id, reason, result: "邀请码立即停用", client: "Web · Prototype", status: "成功" });
        renderAuditLogs();
        openAgentDrawer(agent.id);
        showToast("邀请码已停用，旧链接不再建立新候选");
      }});
    });

    $("#resetAgentPassword").addEventListener("click", () => {
      const agent = agents.find((item) => item.id === state.activeAgentId);
      if (!agent) return;
      requestHighRiskAction({ title: `重置密码 · ${agent.name}`, impact: "撤销代理现有会话，生成仅本次展示的运行时临时密码，首次登录必须修改。", confirmLabel: "确认重置", action: (reason) => {
        agent.sessionRevokedAt = "2026-08-11 12:29";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:29:00", type: "代理状态", actor: "林老板", target: agent.id, reason, result: "会话已撤销 · 临时凭据仅展示一次", client: "Web · Prototype", status: "成功" });
        renderAuditLogs();
        showOneTimeCredentials(agent.account);
      }});
    });

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

    $("#ruleRateInput").addEventListener("input", updateCommissionRulePreview);
    $("#saveCommissionRule").addEventListener("click", () => {
      if (state.commissionRuleSubmitting) return showToast("佣金规则正在提交，请勿重复操作");
      const active = state.activeCommissionRule;
      const reason = $("#ruleChangeReason").value.trim();
      if (!active) return;
      if (!reason) return showToast("请填写佣金规则变更原因");
      if (!$("#ruleChangeConfirm").checked) return showToast("请核对影响范围并勾选确认");
      const rate = Number($("#ruleRateInput").value);
      if (state.commissionRuleMode === "custom" && (Number.isNaN(rate) || rate < 0 || rate > 100)) return showToast("佣金比例需在 0% 至 100% 之间");
      state.commissionRuleSubmitting = true;
      $("#saveCommissionRule").disabled = true;
      if (active.type === "platform") commissionRuleSet.platformRate = rate;
      if (active.type === "category") {
        active.item.rate = state.commissionRuleMode === "inherit" ? null : rate;
        active.item.updated = "08-11 11:26";
      }
      if (active.type === "sku") {
        active.item.rate = state.commissionRuleMode === "inherit" ? null : rate;
        active.item.updated = "08-11 11:26";
      }
      state.commissionRuleRevision += 1;
      const version = `CR-20260811-${String(state.commissionRuleRevision).padStart(2, "0")}`;
      auditLogs.unshift({ id: `AUD-20260811-${String(386 + state.commissionRuleRevision).padStart(4, "0")}`, time: "08-11 11:32:18", type: "佣金规则", actor: "林老板", target: active.type === "platform" ? "平台默认" : active.type === "category" ? active.item.name : active.item.id, reason, result: version, client: "Web · 10.8.0.16", status: "成功" });
      renderCommissionRules();
      renderAuditLogs();
      closeOverlays();
      showToast(`佣金规则已保存并生成新版本 ${version}`);
      setTimeout(() => { state.commissionRuleSubmitting = false; $("#saveCommissionRule").disabled = false; }, 350);
    });

    $("#approveWithdrawal").addEventListener("click", () => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (state.financialSubmitting) return showToast("财务操作正在处理，请勿重复提交");
      if (!item || item.status !== "待审核") return;
      requestHighRiskAction({ title: `审核通过提现 · ${item.id}`, reasonRequired: false, auditReason: "提现资料核对通过", impact: `${item.agent} 的 ${money(item.amount)} 将从 PENDING 进入 APPROVED；冻结金额保持，随后开放本人 TOTP 银行卡查看和打款凭证入口。`, confirmLabel: "确认审核通过", action: (auditReason) => {
        setOperationBusy("financial", true);
        item.status = "待打款"; item.statusCode = "APPROVED";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:35:00", type: "提现", actor: "林老板", target: item.id, reason: auditReason, result: "APPROVED · 待打款", client: "Web · Prototype", status: "成功" });
        renderWithdrawals(); renderAuditLogs(); showToast("已审核通过，请完成线下转账并上传凭证");
        setTimeout(() => setOperationBusy("financial", false), 350);
      }});
    });

    $("#rejectWithdrawal").addEventListener("click", () => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (!item || item.status !== "待审核") return;
      const reviewReason = $("#withdrawalReviewNote").value.trim();
      if (!reviewReason) return showToast("拒绝提现必须填写审核原因");
      requestHighRiskAction({
        title: `拒绝提现 · ${item.id}`,
        reason: reviewReason,
        impact: `将拒绝 ${item.agent} 的 ${money(item.amount)} 提现申请，解除申请冻结并按负余额优先规则返回钱包。`,
        confirmLabel: "确认拒绝提现",
        action: (reason) => {
          const agent = agents.find((entry) => entry.id === item.agentId);
          if (agent) { agent.frozen = Math.max(0, agent.frozen - item.amount); creditAgentWallet(agent, item.amount); }
          item.status = "已拒绝";
          item.statusCode = "REJECTED";
          auditLogs.unshift({ id: `AUD-20260811-${String(450 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:50:42", type: "提现", actor: "林老板", target: item.id, reason, result: "已拒绝并解除冻结", client: "Web · 10.8.0.16", status: "成功" });
          renderWithdrawals();
          renderAgents();
          renderAuditLogs();
          showToast("已拒绝申请，冻结金额已按钱包规则处理");
        }
      });
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
      if (state.financialSubmitting) return showToast("财务操作正在处理，请勿重复提交");
      if (!item || item.status !== "待打款" || !state.paymentProofReady) return showToast("请先上传打款凭证");
      requestHighRiskAction({ title: `确认线下打款 · ${item.id}`, reasonRequired: false, auditReason: "打款凭证已核验", impact: `将把 ${money(item.amount)} 标记为已支付，留存打款凭证并从代理冻结钱包扣除；此状态不可回退。`, confirmLabel: "确认已打款", action: (auditReason) => {
        setOperationBusy("financial", true);
        const agent = agents.find((entry) => entry.id === item.agentId);
        if (agent) agent.frozen = Math.max(0, agent.frozen - item.amount);
        item.status = "已打款"; item.statusCode = "PAID"; item.proof = true;
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:36:00", type: "提现", actor: "林老板", target: item.id, reason: auditReason, result: "PAID · 凭证已留存", client: "Web · Prototype", status: "成功" });
        renderWithdrawals(); renderAgents(); renderAuditLogs(); showToast("已留存凭证并标记为已打款");
        setTimeout(() => setOperationBusy("financial", false), 350);
      }});
    });

    $("#openCreateProduct").addEventListener("click", () => openProductEditor());
    $("#openCreateBrand").addEventListener("click", () => openEntityEditor("brand"));
    $("#openCreateCategory").addEventListener("click", () => openEntityEditor("category"));
    $("#openCreateBanner").addEventListener("click", () => openEntityEditor("banner"));

    $("#productNameInput").addEventListener("input", () => { $("#productNameCount").textContent = `${$("#productNameInput").value.length} / 60`; });

    $("#saveProduct").addEventListener("click", () => {
      const name = $("#productNameInput").value.trim();
      const code = $("#productCodeInput").value.trim().toUpperCase();
      const brand = $("#productBrandInput").value;
      const category = $("#productCategoryInput").value;
      const skus = readProductEditorSkus();
      const invalidSku = skus.some((sku) => !sku.spec || !sku.id || sku.price <= 0 || !Number.isFinite(sku.price));
      const duplicateCode = products.some((item) => item.code === code && item.id !== state.activeProductId);
      const duplicateSku = skus.some((sku, index) => skus.findIndex((other) => other.id === sku.id) !== index);
      const reservedSku = skus.some((sku) => !sku.originalId && Object.values(productSkus).flat().some((existing) => existing.id === sku.id));
      if (!name || !code || !brand || !category || invalidSku || duplicateCode || duplicateSku || reservedSku) {
        $("#productEditError").hidden = false;
        $("#productEditError").textContent = duplicateCode ? "商品货号已存在且归档后仍保留" : duplicateSku ? "同一商品内 SKU 编码不可重复" : reservedSku ? "SKU 编码已存在且归档后仍保留" : "请完整填写商品资料，并确保 SKU 零售价大于 0";
        return;
      }
      let product = products.find((item) => item.id === state.activeProductId);
      if (!product) {
        product = { id: Math.max(...products.map((item) => item.id)) + 1, name, brand, category, code, sales: 0, status: "DRAFT", version: 1, publishedAt: null, imageCount: state.activeProductImageCount, isHot: $("#productRecommendedInput").checked, isNew: $("#productNewInput").checked, art: "art-green" };
        products.unshift(product);
      } else {
        Object.assign(product, { name, brand, category, imageCount: state.activeProductImageCount, isHot: $("#productRecommendedInput").checked, isNew: $("#productNewInput").checked, version: product.version + 1 });
      }
      const previousSkus = productSkus[product.id] || [];
      productSkus[product.id] = skus.map((sku) => {
        const existing = previousSkus.find((item) => item.id === sku.originalId);
        if (existing) return { ...existing, spec: sku.spec, price: sku.price, isRecommended: sku.isRecommended, version: existing.version + 1 };
        inventorySkus.push({ id: sku.id, product: name, spec: sku.spec, art: product.art, available: 0, paymentReserved: 0, aftersaleReserved: 0, warning: 0 });
        return { spec: sku.spec, id: sku.id, price: sku.price, status: "INACTIVE", version: 1, isRecommended: sku.isRecommended };
      });
      productDetails[product.id] = { sellingPoint: $("#productSellingPointInput").value.trim(), intro: $("#productIntroInput").value.trim(), ingredients: $("#productIngredientsInput").value.trim(), usage: $("#productUsageInput").value.trim(), favorites: productDetails[product.id]?.favorites || 0 };
      state.activeProductId = product.id;
      auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-24 11:18:00", type: "商品资料", actor: "林老板", target: product.code, reason: "普通资料保存与 If-Match 通过", result: `${product.status} · ${skus.length} 个 SKU · 新 SKU 固定 INACTIVE`, client: "Web · Prototype", status: "成功" });
      renderProducts();
      renderAuditLogs();
      showToast(`商品“${product.name}”已保存；生命周期状态未改变`);
      setTimeout(() => showPage("products"), 300);
    });

    $("#addSku").addEventListener("click", () => {
      const sequence = $$("#skuRows tr").length + 1;
      $("#skuRows").insertAdjacentHTML("beforeend", `<tr data-sku-persisted="false"><td><input data-sku-field="spec" value="新规格 ${sequence}"></td><td><input data-sku-field="id" value="NEW-SKU-${sequence}"></td><td><div class="money-input"><span>¥</span><input data-sku-field="price" value="1.00"></div></td><td><span class="cell-main">实物 0</span><span class="cell-sub">锁定 0 · 可售 0</span></td><td><label class="switch"><input data-sku-field="recommended" type="checkbox"><i></i></label></td><td><span class="tag neutral" data-status-code="INACTIVE">已停用</span><span class="cell-sub">保存后 v1</span></td><td><button class="icon-button danger sku-delete" title="移除未保存 SKU">${icon("trash")}</button></td></tr>`);
      $("#productSkuTabCount").textContent = $$("#skuRows tr").length;
      $("#productSummarySkuCount").textContent = $$("#skuRows tr").length;
      showToast("已新增 SKU 草稿；保存后为停用状态，库存为 0");
    });

    $("#saveEntity").addEventListener("click", () => {
      const active = state.activeEntity;
      if (!active) return;
      const isMasterData = active.type === "brand" || active.type === "category";
      const code = $("#entityCode").value.trim().toUpperCase();
      const name = $("#entityName").value.trim();
      const detail = $("#entityDetail").value.trim();
      const sort = Number($("#entitySort").value);
      const status = $("#entityStatus").value;
      const start = $("#entityStart").value;
      const end = $("#entityEnd").value;
      const list = active.type === "brand" ? brands : active.type === "category" ? commissionCategories : banners;
      const duplicate = list.some((item) => item !== active.item && ((code && item.id === code) || item.name === name));
      if ((!isMasterData && !code) || !name || (!isMasterData && !detail) || !Number.isInteger(sort) || sort < 0 || duplicate || (active.type === "banner" && (!start || !end || start > end))) {
        $("#entityError").hidden = false;
        $("#entityError").textContent = duplicate ? "名称已存在；软删除记录的名称仍被保留" : active.type === "banner" && start > end ? "结束日期不得早于开始日期" : "请完整填写必填项；排序必须是大于等于 0 的整数";
        return;
      }
      let item = active.item;
      if (active.type === "brand") {
        if (!item) { item = { id: `BR-${Date.now()}`, name, activeProductCount: 0, status: "DRAFT", version: 1, avatar: name.slice(0, 1) }; brands.push(item); }
        else item.version += 1;
        Object.assign(item, { name, description: detail || null, sort });
        renderBrands();
      } else if (active.type === "category") {
        if (!item) { item = { id: `CAT-${Date.now()}`, name, productCount: 0, activeProductCount: 0, skuCount: 0, rate: null, overrideCount: 0, updated: "新建", status: "DRAFT", version: 1, sort }; commissionCategories.push(item); }
        else item.version += 1;
        Object.assign(item, { name, sort });
        renderCategoryManagement();
        renderCommissionRules();
      } else {
        if (!item) { item = { id: code, name, tone: "green-banner" }; banners.push(item); }
        Object.assign(item, { name, detail, sort, status, start, end });
        renderBanners();
      }
      const effectiveStatus = isMasterData ? item.status : status;
      auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:31:00", type: "内容配置", actor: "林老板", target: item.id, reason: "表单校验与 If-Match 通过", result: `${effectiveStatus} · 排序 ${sort} · ${isMasterData ? `v${item.version}` : "已保存"}`, client: "Web · Prototype", status: "成功" });
      renderAuditLogs();
      closeOverlays();
      showToast(`${name} 已保存`);
    });

    $("#confirmRestoreEntity").addEventListener("click", () => {
      const active = state.activeEntity;
      const reason = $("#restoreEntityReason").value.trim();
      if (!active?.item || active.item.status !== "ARCHIVED" || reason.length < 2 || reason.length > 500) {
        $("#restoreEntityError").hidden = false;
        return;
      }
      const restoredStatus = active.type === "sku" ? "INACTIVE" : "DRAFT";
      active.item.status = restoredStatus;
      active.item.deletedAt = null;
      active.item.version += 1;
      auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-24 11:22:00", type: active.type === "product" || active.type === "sku" ? "商品生命周期" : "内容配置", actor: "林老板", target: active.item.code || active.item.id, reason, result: `RESTORE · ${restoredStatus} · v${active.item.version}`, client: "Web · Prototype", status: "成功" });
      if (["brand", "category"].includes(active.type)) renderMasterData(active.type);
      else {
        renderProducts();
        if (active.type === "sku" && active.product) renderProductEditorSkus(productSkus[active.product.id]);
      }
      renderAuditLogs();
      closeOverlays();
      showToast(`${active.item.name || active.item.id} 已恢复为 ${restoredStatus}，请单独执行启用`);
    });

    $("#archiveEntity").addEventListener("click", () => {
      const active = state.activeEntity;
      if (!active || !active.item) return;
      if (active.type === "category" && active.item.productCount > 0) return showToast("分类仍有在售商品，禁止归档");
      requestHighRiskAction({ title: `归档 ${active.item.name}`, impact: "记录将软归档并停止后续展示；历史订单、佣金版本与审计引用永久保留。", confirmLabel: "确认归档", action: (reason) => {
        active.item.status = "已停用";
        active.item.archivedAt = "2026-08-11 12:32";
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:32:00", type: "内容配置", actor: "林老板", target: active.item.id, reason, result: "SOFT_ARCHIVED", client: "Web · Prototype", status: "成功" });
        renderBrands(); renderCategoryManagement(); renderBanners(); renderAuditLogs(); showToast("记录已软归档");
      }});
    });

    $("#saveBusinessRule").addEventListener("click", () => {
      const key = state.activeBusinessRule;
      const rule = businessRules[key];
      const value = Number($("#businessRuleValue").value);
      const reason = $("#businessRuleReason").value.trim();
      if (!rule || !Number.isInteger(value) || value <= 0 || !reason || !$("#businessRuleConfirm").checked) { $("#businessRuleError").hidden = false; return; }
      rule.value = value;
      rule.version += 1;
      if (key === "AFTERSALE_DAYS") { $("#aftersaleDaysValue").textContent = value; $("#aftersaleRuleVersion").textContent = `AFTERSALE_RESERVATION · BR-20260811-${String(rule.version).padStart(2, "0")}`; }
      if (key === "MIN_WITHDRAWAL") { $("#minimumWithdrawalValue").textContent = value; $("#withdrawalRuleVersion").textContent = `WITHDRAWAL_AND_RETENTION · BR-20260811-${String(rule.version).padStart(2, "0")}`; }
      auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:33:00", type: "业务规则", actor: "林老板", target: key, reason, result: `BR-20260811-${String(rule.version).padStart(2, "0")} · ${value}${rule.unit}`, client: "Web · Prototype", status: "成功" });
      renderAuditLogs(); closeOverlays(); showToast("业务规则已保存并生成新版本");
    });

    $("#saveWhitelist").addEventListener("click", () => {
      const agent = agents.find((item) => item.id === state.activeAgentId);
      const selected = $$("#whitelistProducts input:checked").map((input) => Number(input.value));
      const reason = $("#whitelistReason").value.trim();
      if (!agent || !selected.length || !reason || !$("#whitelistConfirm").checked) { $("#whitelistError").hidden = false; return; }
      requestHighRiskAction({ title: `更新推广白名单 · ${agent.name}`, reason, impact: `授权商品 ${agent.authorizedCount} → ${selected.length} 件；撤权旧链接不再建候选，已有绑定客户购买全店 SKU 仍按统一规则计佣。`, confirmLabel: "确认更新白名单", action: (auditReason) => {
        agent.authMode = "自定义白名单"; agent.whitelist = selected; agent.authorizedCount = selected.length;
        auditLogs.unshift({ id: `AUD-${Date.now()}`, time: "08-11 12:34:00", type: "代理状态", actor: "林老板", target: agent.id, reason: auditReason, result: `白名单 ${selected.length} 件`, client: "Web · Prototype", status: "成功" });
        renderAgents(); renderAuditLogs(); showToast("推广白名单已更新，计佣范围不变");
      }});
    });

    ["productSearch", "productCategory", "productBrand", "productStatus"].forEach((id) => $("#" + id).addEventListener(id === "productSearch" ? "input" : "change", renderProducts));
    ["orderSearch", "orderStatus"].forEach((id) => $("#" + id).addEventListener(id === "orderSearch" ? "input" : "change", renderOrders));
    ["aftersaleSearch", "aftersaleType", "aftersaleStatus"].forEach((id) => $("#" + id).addEventListener(id === "aftersaleSearch" ? "input" : "change", renderAftersales));
    $("#customerSearch").addEventListener("input", renderCustomers);
    $("#agentSearch").addEventListener("input", renderAgents);
    $("#agentStatus").addEventListener("change", renderAgents);
    $("#withdrawalSearch").addEventListener("input", renderWithdrawals);
    $("#withdrawalStatus").addEventListener("change", renderWithdrawals);
    $("#commissionSkuSearch").addEventListener("input", renderCommissionRules);
    $("#commissionSkuCategory").addEventListener("change", renderCommissionRules);
    $("#brandSearch").addEventListener("input", renderBrands);
    $("#brandStatus").addEventListener("change", renderBrands);
    $("#categorySearch").addEventListener("input", renderCategoryManagement);
    $("#categoryStatus").addEventListener("change", renderCategoryManagement);
    $("#inventorySearch").addEventListener("input", renderInventory);
    $("#inventoryStatus").addEventListener("change", renderInventory);
    $("#auditSearch").addEventListener("input", renderAuditLogs);
    $("#auditType").addEventListener("change", renderAuditLogs);
    $("#dashboardReportQuery").addEventListener("click", () => {
      const input = state.reportRange === "month" ? $("#dashboardMonthInput") : $("#dashboardDayInput");
      if (!input.value) return showToast("请选择报表日期");
      if (state.reportRange === "month") state.reportMonth = input.value;
      else state.reportDate = input.value;
      renderReportRange();
      requestDashboardReport();
    });

    $("#productReset").addEventListener("click", () => {
      $("#productSearch").value = ""; $("#productCategory").value = ""; $("#productBrand").value = ""; $("#productStatus").value = ""; renderProducts();
    });
    $("#orderReset").addEventListener("click", () => { state.activeCustomerOrderFilter = null; $("#orderSearch").value = ""; $("#orderStatus").value = ""; renderOrders(); });
    $("#aftersaleReset").addEventListener("click", () => { $("#aftersaleSearch").value = ""; $("#aftersaleType").value = ""; $("#aftersaleStatus").value = ""; renderAftersales(); });
    $("#customerReset").addEventListener("click", () => { $("#customerSearch").value = ""; renderCustomers(); });
    $("#agentReset").addEventListener("click", () => { $("#agentSearch").value = ""; $("#agentStatus").value = ""; renderAgents(); });
    $("#withdrawalReset").addEventListener("click", () => { $("#withdrawalSearch").value = ""; $("#withdrawalStatus").value = ""; renderWithdrawals(); });
    $("#commissionSkuReset").addEventListener("click", () => { $("#commissionSkuSearch").value = ""; $("#commissionSkuCategory").value = ""; renderCommissionRules(); });
    $("#brandReset").addEventListener("click", () => { $("#brandSearch").value = ""; $("#brandStatus").value = ""; renderBrands(); });
    $("#categoryReset").addEventListener("click", () => { $("#categorySearch").value = ""; $("#categoryStatus").value = ""; renderCategoryManagement(); });
    $("#inventoryReset").addEventListener("click", () => { $("#inventorySearch").value = ""; $("#inventoryStatus").value = ""; renderInventory(); });
    $("#auditReset").addEventListener("click", () => { $("#auditSearch").value = ""; $("#auditType").value = ""; renderAuditLogs(); });

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
    window.addEventListener("pagehide", clearBankReveal);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clearBankReveal(); });
  }

  function init() {
    const prototypeParams = new URLSearchParams(window.location.search);
    const requestedPage = prototypeParams.get("view");
    if (requestedPage && pageTitles[requestedPage]) state.page = requestedPage;
    renderProducts();
    renderBrands();
    renderCategoryManagement();
    renderBanners();
    renderInventory();
    renderOrders();
    renderOrderDetail(orders.find((order) => order.id === state.activeOrderId) || orders[0]);
    renderDashboardOrders();
    renderRankings();
    renderReportRange();
    renderReportState();
    renderAftersales();
    renderCustomers();
    renderAgents();
    renderCommissionRules();
    renderWithdrawals();
    renderAuditLogs();
    setupEvents();
    if (state.page === "product-edit") openProductEditor(1);
    window.__ADMIN_PROTOTYPE__ = {
      getState: () => JSON.parse(JSON.stringify({ state, products, productSkus, aftersales, inventorySkus, agents, auditLogs })),
      archiveParentDuringPendingSkuActivation: () => {
        const context = state.pendingHighRiskAction?.catalogContext;
        if (!context || context.type !== "sku" || context.action !== "ACTIVATE") return false;
        context.product.status = "ARCHIVED";
        context.product.deletedAt = "2026-08-24 11:30";
        context.product.version += 1;
        renderProducts();
        return true;
      },
      inspectionIsSealed: (id) => {
        const inspection = aftersales.find((item) => item.id === id)?.inspection;
        return Boolean(inspection?.evidenceSealed && Object.isFrozen(inspection) && Object.isFrozen(inspection.evidenceManifest));
      }
    };
    if (prototypeParams.get("autologin") === "1" || sessionStorage.getItem("qingyuAdminLoggedIn") === "1") showApp();
    else showLogin();
  }

  init();
})();
