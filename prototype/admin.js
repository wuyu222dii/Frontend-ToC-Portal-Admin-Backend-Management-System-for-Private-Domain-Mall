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
    { id: "QY202608060028", customer: "林晓月", phone: "138****6821", avatar: "林", product: "氨基酸洁面乳等 2 款", count: 3, amount: "227.00", payment: "微信支付", status: "待发货", orderStatus: "PENDING_SHIPMENT", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "READY_TO_SHIP", closeReason: null, displayStatus: "待发货", time: "08-06 09:18", arts: ["art-green", "art-blue"] },
    { id: "QY202608060027", customer: "周敏", phone: "186****3096", avatar: "周", product: "无硅油蓬松洗发水", count: 1, amount: "89.00", payment: "微信支付", status: "退款售后", orderStatus: "COMPLETED", paymentStatus: "PAID", refundStatus: "FULL", fulfillmentStatus: "DELIVERED", closeReason: null, displayStatus: "退款售后", time: "08-06 09:02", arts: ["art-blue"] },
    { id: "QY202608060026", customer: "陈嘉禾", phone: "159****2218", avatar: "陈", product: "酵素浓缩洗衣凝珠", count: 2, amount: "84.00", payment: "微信支付", status: "运输中", orderStatus: "SHIPPING", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "IN_TRANSIT", closeReason: null, displayStatus: "运输中", time: "08-06 08:46", arts: ["art-amber"] },
    { id: "QY202608060025", customer: "赵倩", phone: "133****5107", avatar: "赵", product: "积雪草舒缓修护霜", count: 1, amount: "109.00", payment: "微信支付", status: "已完成", orderStatus: "COMPLETED", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "DELIVERED", closeReason: null, displayStatus: "已完成", time: "08-06 08:25", arts: ["art-coral"] },
    { id: "QY202608060024", customer: "王悦", phone: "137****8432", avatar: "王", product: "白茶香氛沐浴露等 3 款", count: 5, amount: "326.00", payment: "微信支付", status: "待付款", orderStatus: "PENDING_PAYMENT", paymentStatus: "UNPAID", refundStatus: "NONE", fulfillmentStatus: "NOT_STARTED", closeReason: null, displayStatus: "待付款", time: "08-06 08:12", arts: ["art-coral", "art-purple"] },
    { id: "QY202608060023", customer: "刘雨晴", phone: "188****0076", avatar: "刘", product: "烟酰胺焕亮精华液", count: 1, amount: "139.00", payment: "微信支付", status: "待发货", orderStatus: "PENDING_SHIPMENT", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "READY_TO_SHIP", closeReason: null, displayStatus: "待发货", time: "08-06 07:58", arts: ["art-purple"] },
    { id: "QY202608060022", customer: "何文", phone: "135****6190", avatar: "何", product: "氨基酸洁面乳旅行装", count: 2, amount: "50.00", payment: "微信支付", status: "运输中", orderStatus: "SHIPPING", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "IN_TRANSIT", closeReason: null, displayStatus: "运输中", time: "08-06 07:31", arts: ["art-green"] },
    { id: "QY202608060021", customer: "孙可心", phone: "180****4175", avatar: "孙", product: "轻透倍护防晒乳", count: 1, amount: "99.00", payment: "微信支付", status: "已完成", orderStatus: "COMPLETED", paymentStatus: "PAID", refundStatus: "NONE", fulfillmentStatus: "DELIVERED", closeReason: null, displayStatus: "已完成", time: "08-06 07:16", arts: ["art-blue"] }
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
    { id: 1, name: "林晓月", nickname: "Moon", phone: "138****6821", phoneSource: "微信授权 · 已验证", city: "广东省深圳市", spend: 3286, orders: 18, recent: "氨基酸洁面乳", recentDate: "今天 09:18", joined: "2025-11-18", lastVisit: "今天 09:17", avatar: "林", agentId: "A1038", agentName: "清源生活馆", agentBoundAt: "2026-07-18 14:26" },
    { id: 2, name: "周敏", nickname: "Mina", phone: "186****3096", phoneSource: "微信授权 · 已验证", city: "广东省珠海市", spend: 1688, orders: 9, recent: "无硅油洗发水", recentDate: "今天 09:02", joined: "2026-01-08", lastVisit: "今天 09:01", avatar: "周", agentId: "A1038", agentName: "清源生活馆", agentBoundAt: "2026-07-28 09:16" },
    { id: 3, name: "陈嘉禾", nickname: "嘉禾", phone: "159****2218", phoneSource: "微信授权 · 已验证", city: "浙江省绍兴市", spend: 892, orders: 6, recent: "浓缩洗衣凝珠", recentDate: "今天 08:46", joined: "2026-03-22", lastVisit: "今天 08:44", avatar: "陈", agentId: "A1026", agentName: "清悦日用馆", agentBoundAt: "2026-06-12 11:40" },
    { id: 4, name: "赵倩", nickname: "Zoe", phone: "133****5107", phoneSource: "微信授权 · 已验证", city: "浙江省杭州市", spend: 4290, orders: 26, recent: "积雪草修护霜", recentDate: "今天 08:25", joined: "2025-08-16", lastVisit: "今天 08:22", avatar: "赵", agentId: null, agentName: "平台直接客户", agentBoundAt: "2026-05-08 16:08" },
    { id: 5, name: "王悦", nickname: "悦悦", phone: "137****8432", phoneSource: "微信授权 · 已验证", city: "浙江省湖州市", spend: 2386, orders: 13, recent: "白茶香氛沐浴露", recentDate: "今天 08:12", joined: "2025-12-09", lastVisit: "今天 08:10", avatar: "王", agentId: "A1019", agentName: "简木洗护顾问", agentBoundAt: "2026-04-20 10:32" },
    { id: 6, name: "刘雨晴", nickname: "Yuki", phone: "188****0076", phoneSource: "微信授权 · 已验证", city: "浙江省嘉兴市", spend: 658, orders: 4, recent: "烟酰胺焕亮精华", recentDate: "今天 07:58", joined: "2026-05-19", lastVisit: "今天 07:55", avatar: "刘", agentId: "A1026", agentName: "清悦日用馆", agentBoundAt: "2026-07-09 18:26" },
    { id: 7, name: "孙可心", nickname: "Kira", phone: null, phoneSource: "未绑定 · 未授权", city: "浙江省金华市", spend: 1928, orders: 11, recent: "轻透倍护防晒乳", recentDate: "今天 07:16", joined: "2026-02-14", lastVisit: "今天 07:14", avatar: "孙", agentId: null, agentName: "平台直接客户", agentBoundAt: "2026-02-14 12:06" }
  ];

  const agents = [
    { id: "A1038", name: "清源生活馆", account: "qingyuan.store", contact: "安然 138****3916", invite: "QX-A1038", authMode: "全部在售商品", authorizedCount: 116, customers: 386, sales: 86420, available: 4820.6, frozen: 2680, negative: 0, bank: "招商银行", cardLast4: "3916", status: "已启用", avatar: "清" },
    { id: "A1026", name: "清悦日用馆", account: "qingyue.store", contact: "陈悦 186****2077", invite: "QX-A1026", authMode: "自定义白名单", authorizedCount: 42, customers: 274, sales: 62180, available: 3686.2, frozen: 1200, negative: 0, bank: "中国建设银行", cardLast4: "2077", status: "已启用", avatar: "悦" },
    { id: "A1019", name: "简木洗护顾问", account: "jianmu.care", contact: "林木 159****6128", invite: "QX-A1019", authMode: "全部在售商品", authorizedCount: 116, customers: 226, sales: 58960, available: 5218.4, frozen: 3200, negative: 0, bank: "中国工商银行", cardLast4: "6128", status: "已启用", avatar: "简" },
    { id: "A1012", name: "素研生活家", account: "suyan.life", contact: "徐研 137****4632", invite: "QX-A1012", authMode: "自定义白名单", authorizedCount: 28, customers: 198, sales: 41860, available: 0, frozen: 0, negative: 328.5, bank: "中国农业银行", cardLast4: "4632", status: "已启用", avatar: "素" },
    { id: "A1007", name: "白茶日用馆", account: "baicha.store", contact: "宋宁 135****7810", invite: "QX-A1007", authMode: "全部在售商品", authorizedCount: 116, customers: 184, sales: 36240, available: 896.8, frozen: 0, negative: 0, bank: "中国银行", cardLast4: "7810", status: "已停用", avatar: "白" }
  ];

  const commissionRuleSet = { platformRate: 5 };
  const commissionCategories = [
    { id: "CAT-SKIN", name: "护肤品", productCount: 36, skuCount: 52, rate: 10, overrideCount: 1, updated: "08-11 10:18" },
    { id: "CAT-HAIR", name: "洗发水", productCount: 18, skuCount: 27, rate: 8, overrideCount: 1, updated: "08-11 09:42" },
    { id: "CAT-BODY", name: "沐浴露", productCount: 16, skuCount: 25, rate: 7, overrideCount: 0, updated: "08-10 17:06" },
    { id: "CAT-SUN", name: "防晒产品", productCount: 9, skuCount: 12, rate: 9, overrideCount: 0, updated: "08-10 16:28" },
    { id: "CAT-FRAGRANCE", name: "香水", productCount: 12, skuCount: 19, rate: 8, overrideCount: 0, updated: "08-09 15:12" },
    { id: "CAT-MAKEUP", name: "彩妆", productCount: 14, skuCount: 31, rate: 10, overrideCount: 1, updated: "08-11 08:56" },
    { id: "CAT-MEN", name: "男士护理", productCount: 11, skuCount: 16, rate: 7, overrideCount: 0, updated: "08-08 13:20" },
    { id: "CAT-HOME", name: "家庭清洁", productCount: 20, skuCount: 34, rate: 5, overrideCount: 1, updated: "08-11 08:16" }
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
    { id: "BR-ZCY", name: "植萃研", products: 36, story: "完整", sort: 10, status: "已启用", avatar: "植" },
    { id: "BR-MG", name: "沐光", products: 28, story: "完整", sort: 20, status: "已启用", avatar: "沐" },
    { id: "BR-QMX", name: "青木序", products: 31, story: "完整", sort: 30, status: "已启用", avatar: "青" },
    { id: "BR-JJ", name: "净简", products: 33, story: "待完善", sort: 40, status: "已停用", avatar: "净" }
  ];

  const inventorySkus = [
    { id: "CLEAN-120", product: "植萃研氨基酸净澈洁面乳", spec: "120g 单支", art: "art-green", available: 286, paymentReserved: 8, aftersaleReserved: 2, warning: 30 },
    { id: "CLEAN-120X2", product: "植萃研氨基酸净澈洁面乳", spec: "120g 两支装", art: "art-green", available: 96, paymentReserved: 3, aftersaleReserved: 0, warning: 20 },
    { id: "HAIR-500", product: "沐光无硅油蓬松洗发水", spec: "500ml 正装", art: "art-blue", available: 16, paymentReserved: 6, aftersaleReserved: 1, warning: 20 },
    { id: "HAIR-500R", product: "沐光无硅油蓬松洗发水", spec: "500ml 补充装", art: "art-blue", available: 52, paymentReserved: 4, aftersaleReserved: 0, warning: 15 },
    { id: "BODY-500", product: "沐光白茶香氛沐浴露", spec: "500ml 正装", art: "art-coral", available: 186, paymentReserved: 10, aftersaleReserved: 3, warning: 30 },
    { id: "SKIN-050", product: "青木序积雪草舒缓修护霜", spec: "50g 正装", art: "art-coral", available: 8, paymentReserved: 4, aftersaleReserved: 1, warning: 15 },
    { id: "HOME-030", product: "净简酵素浓缩洗衣凝珠", spec: "30 颗", art: "art-amber", available: 238, paymentReserved: 7, aftersaleReserved: 0, warning: 40 },
    { id: "SUN-050", product: "青木序轻透倍护防晒乳", spec: "50ml 正装", art: "art-blue", available: 0, paymentReserved: 0, aftersaleReserved: 0, warning: 20 }
  ];

  const auditLogs = [
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
      message: "请用环保包装，谢谢",
      version: "CR-20260811-03",
      items: [
        { name: "植萃研氨基酸净澈洁面乳", brand: "植萃研", art: "art-green", sku: "120g 单支 · CLEAN-120", quantity: 2, price: 69, base: 138, rate: 10, source: "一级分类“护肤品”", commission: 13.8 },
        { name: "沐光无硅油蓬松洗发水", brand: "沐光", art: "art-blue", sku: "500ml 正装 · HAIR-500", quantity: 1, price: 89, base: 89, rate: 8, source: "一级分类“洗发水”", commission: 7.12 }
      ]
    },
    QY202608060027: {
      address: "广东省 珠海市 香洲区 情侣中路 88 号",
      agent: "清源生活馆",
      message: "无",
      version: "CR-20260811-03",
      items: [{ name: "沐光无硅油蓬松洗发水", brand: "沐光", art: "art-blue", sku: "500ml 正装 · HAIR-500", quantity: 1, price: 89, base: 89, rate: 8, source: "一级分类“洗发水”", commission: 7.12, refundDebit: 7.12 }]
    }
  };

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
    bankRevealTimer: null,
    activeCommissionRule: null,
    commissionRuleMode: "custom",
    commissionRuleRevision: 3,
    pendingHighRiskAction: null,
    bankVerifyFailures: 0,
    bankVerifyLockedUntil: 0,
    bankRevealGrant: null
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
      "已打款": "success",
      "成功": "success",
      "冲突": "danger",
      "正常": "success",
      "低库存": "warning",
      "缺货": "danger"
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

  function renderBrands() {
    const keyword = $("#brandSearch").value.trim().toLowerCase();
    const status = $("#brandStatus").value;
    const filtered = brands.filter((brand) => (!keyword || `${brand.name}${brand.id}`.toLowerCase().includes(keyword)) && (!status || brand.status === status));
    $("#brandCount").textContent = `共 ${filtered.length} 个品牌`;
    $("#brandRows").innerHTML = filtered.length ? filtered.map((brand) => `<tr data-brand-id="${brand.id}"><td><div class="customer-cell"><span class="avatar soft-green">${brand.avatar}</span><div><span class="cell-main">${brand.name}</span><span class="cell-sub">品牌主页已配置</span></div></div></td><td>${brand.id}</td><td>${brand.products} 件</td><td><span class="tag ${brand.story === "完整" ? "success" : "warning"}">${brand.story}</span></td><td>${brand.sort}</td><td><span class="tag ${statusClass(brand.status)}">${brand.status}</span></td><td><div class="row-actions"><button class="icon-button" type="button" data-toast="品牌 ${brand.name} 编辑器已打开" title="编辑品牌">${icon("edit")}</button><button class="button text brand-toggle" type="button">${brand.status === "已启用" ? "停用" : "启用"}</button></div></td></tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">${icon("star")}<strong>没有匹配品牌</strong><span>请调整搜索或状态筛选</span></div></td></tr>`;
  }

  function renderCategoryManagement() {
    $("#categoryManageRows").innerHTML = commissionCategories.map((category, index) => {
      const hasLiveProducts = category.productCount > 0;
      return `<tr data-category-id="${category.id}"><td><span class="cell-main">${category.name}</span><span class="cell-sub">首页入口 ${index + 1}</span></td><td>${category.id}</td><td><span class="cell-main">${category.productCount} 件商品</span><span class="cell-sub">${category.skuCount} 个 SKU</span></td><td><span class="tag success">显示</span></td><td><span class="rule-source ${category.rate === null ? "platform" : "category"}">${category.rate === null ? "平台默认" : `${category.rate.toFixed(2)}%`}</span></td><td><span class="tag success">已启用</span></td><td><div class="row-actions"><button class="icon-button" type="button" data-toast="分类 ${category.name} 编辑器已打开" title="编辑分类">${icon("edit")}</button><button class="button text category-disable" type="button" ${hasLiveProducts ? "data-category-blocked='1'" : ""}>停用</button></div></td></tr>`;
    }).join("");
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
      return matches && (!status || agent.status === status);
    });
    $("#agentCount").textContent = `共 ${filtered.length} 个代理`;
    $("#agentRows").innerHTML = filtered.length ? filtered.map((agent) => `<tr data-agent-id="${agent.id}">
      <td><div class="agent-cell"><span class="avatar soft-green">${agent.avatar}</span><div><strong>${agent.name}</strong><span>${agent.account} · ${agent.contact}</span></div></div></td>
      <td><span class="cell-main">统一商品规则</span><span class="cell-sub">SKU &gt; 分类 &gt; 平台</span></td>
      <td><button class="invite-code copy-agent-invite" type="button" title="复制邀请码">${agent.invite}${icon("copy")}</button></td>
      <td><span class="cell-main">${agent.customers.toLocaleString("zh-CN")}</span><span class="cell-sub">有效归属</span></td>
      <td><span class="cell-main">¥${agent.sales.toLocaleString("zh-CN")}</span><span class="cell-sub">本月净商品额</span></td>
      <td><span class="cell-main ${agent.negative > 0 ? "negative-balance" : ""}">¥${agent.available.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span><span class="cell-sub">${agent.negative > 0 ? `负余额 ¥${agent.negative.toFixed(2)}` : `冻结 ¥${agent.frozen.toFixed(2)}`}</span></td>
      <td><span class="tag ${statusClass(agent.status)}">${agent.status}</span></td>
      <td><div class="row-actions"><button class="icon-button view-agent" type="button" title="查看代理">${icon("eye")}</button><button class="icon-button edit-agent" type="button" title="编辑代理">${icon("edit")}</button><button class="button text toggle-agent" type="button">${agent.status === "已启用" ? "停用" : "启用"}</button></div></td>
    </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">${icon("users")}<strong>没有找到匹配代理</strong><span>请调整搜索或状态筛选</span></div></td></tr>`;
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
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function requestHighRiskAction(config) {
    $("#highRiskTitle").textContent = config.title;
    $("#highRiskSubtitle").textContent = config.subtitle || "操作将写入不可变审计日志";
    $("#highRiskImpact").textContent = config.impact;
    $("#highRiskReason").value = config.reason || "";
    $("#highRiskConfirm").checked = false;
    $("#highRiskError").hidden = true;
    $("#highRiskConfirmLabel").textContent = config.confirmLabel || "确认执行";
    openModal("#highRiskModal");
    state.pendingHighRiskAction = config;
  }

  function clearBankReveal() {
    clearTimeout(state.bankRevealTimer);
    state.bankRevealTimer = null;
    state.bankRevealGrant = null;
    const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
    if ($("#withdrawalCard") && item) $("#withdrawalCard").textContent = item.card;
    if ($("#withdrawalCardTimer")) $("#withdrawalCardTimer").hidden = true;
    if ($("#openBankVerification")) $("#openBankVerification").hidden = !(item && item.statusCode === "APPROVED");
  }

  function closeOverlays() {
    const credentialWasVisible = $("#credentialModal") && !$("#credentialModal").hidden;
    $("#modalBackdrop").hidden = true;
    $$(".modal, .drawer").forEach((item) => { item.hidden = true; });
    $("#notificationPanel").hidden = true;
    clearBankReveal();
    state.bankRevealContext = null;
    state.pendingHighRiskAction = null;
    if (credentialWasVisible) {
      state.oneTimeCredentials = null;
      $("#credentialAccount").textContent = "已隐藏";
      $("#credentialPassword").textContent = "已隐藏";
    }
  }

  function orderDetail(order) {
    const customer = customers.find((item) => item.name === order.customer);
    const product = products.find((item) => item.name.includes(order.product.split("等")[0].replace("氨基酸洁面乳", "氨基酸净澈洁面乳"))) || products[0];
    const fallbackRate = categoryRate(product.category);
    const override = orderDetailOverrides[order.id] || {};
    return {
      address: override.address || `${customer ? customer.city : "收货城市未记录"} · 详细地址已按订单快照保存`,
      agent: override.agent || (customer ? customer.agentName : "平台直接客户"),
      message: override.message || "无",
      version: override.version || "CR-20260811-03",
      customer,
      items: override.items || [{ name: order.product, brand: product.brand, art: product.art, sku: `${product.code}-DEFAULT`, quantity: order.count, price: Number(order.amount) / order.count, base: Number(order.amount), rate: fallbackRate, source: `一级分类“${product.category}”`, commission: Number((Number(order.amount) * fallbackRate / 100).toFixed(2)) }]
    };
  }

  function renderOrderDetail(order) {
    const detail = orderDetail(order);
    const totalCommission = detail.items.reduce((sum, item) => sum + item.commission, 0);
    const refundDebit = detail.items.reduce((sum, item) => sum + (item.refundDebit || 0), 0);
    $("#detailItemCount").textContent = `共 ${order.count} 件`;
    $("#detailOrderProducts").innerHTML = detail.items.map((item) => `<div class="order-product">${renderProductArt(item.art, item.brand)}<div><strong>${item.name}</strong><span>规格：${item.sku}</span><small>${money(item.price)} × ${item.quantity}</small><em class="commission-snapshot">净商品额 ${money(item.base)} × ${item.rate.toFixed(2)}% · ${item.source} · 原始佣金 ${money(item.commission)}${item.refundDebit ? ` · REFUND_DEBIT ${money(-item.refundDebit)}` : ""}</em></div><b>${money(item.base)}</b></div>`).join("");
    $("#detailAmountSummary").innerHTML = `<div><span>商品小计</span><b>${money(order.amount)}</b></div><div><span>运费</span><b>¥0.00</b></div><div><span>原始代理佣金</span><b>${money(totalCommission)}</b></div>${refundDebit ? `<div><span>独立退款冲正</span><b class="coral-text">${money(-refundDebit)}</b></div>` : ""}<div class="total"><span>实付金额</span><strong>${money(order.amount)}</strong></div>`;
    const customer = detail.customer || { avatar: order.avatar, name: order.customer, phone: order.phone, city: "" };
    $("#detailReceiver").innerHTML = `<span class="avatar soft-green">${customer.avatar || order.avatar}</span><div><strong>${order.customer} <small>${order.phone || "账户手机号未绑定"}</small></strong><p>${detail.address.replace(" · ", "<br>")}</p></div>`;
    $("#copyDetailReceiver").dataset.copy = `${order.customer} ${order.phone || "未绑定"} ${detail.address}`;
    $("#detailOrderInfo").innerHTML = `<div><dt>展示状态</dt><dd>${order.displayStatus}</dd></div><div><dt>订单状态</dt><dd>${order.orderStatus}</dd></div><div><dt>支付状态</dt><dd>${order.paymentStatus}</dd></div><div><dt>退款状态</dt><dd>${order.refundStatus}</dd></div><div><dt>履约状态</dt><dd>${order.fulfillmentStatus}</dd></div><div><dt>关闭原因</dt><dd>${order.closeReason || "-"}</dd></div><div><dt>订单来源</dt><dd>微信小程序</dd></div><div><dt>服务归属</dt><dd>${detail.agent}</dd></div><div><dt>佣金快照</dt><dd>${detail.items.length} 条商品行 · 原始 ${money(totalCommission)}${refundDebit ? `<br><small>冲正 ${money(-refundDebit)}</small>` : ""}<br><small>规则版本 ${detail.version}</small></dd></div><div><dt>支付方式</dt><dd>${order.payment}（模拟）</dd></div><div><dt>配送方式</dt><dd>普通快递</dd></div><div><dt>买家留言</dt><dd>${detail.message}</dd></div><div><dt>内部备注</dt><dd class="muted">暂无</dd></div>`;
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
    }
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
    $("#reviewGoodsState").textContent = item.type === "仅退款" ? "未发货 / 未收到货" : "已收到，待寄回";
    $("#reviewCustomerNote").textContent = item.reason === "收到后包装破损" ? "外包装受挤压破损，客户申请退货退款并等待平台提供退货地址。" : `客户申请说明：${item.reason}。`;
    $("#reviewReservation").textContent = `已占用可退数量 1 件 · 可退金额 ${money(item.amount)}；待处理数量禁止发货`;
    $("#reviewNote").value = item.status === "待审核" ? "已核对订单、库存占用与客户说明，请填写本次处理意见。" : `当前状态：${item.status}，仅供查看。`;
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
    $("#agentNameInput").value = agent ? agent.name : "清和日用馆";
    $("#agentAccountInput").value = agent ? agent.account : "qinghe.store";
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
    $("#agentDrawerInvite").textContent = agent.invite;
    $("#agentDrawerAuthMode").textContent = agent.authMode;
    $("#agentDrawerAuthCount").textContent = `${agent.authorizedCount} 件`;
    $("#agentDrawerBank").textContent = `${agent.bank} · ****${agent.cardLast4}`;
    $("#agentDrawerStatus").textContent = agent.status;
    $("#agentWalletAvailable").textContent = money(agent.available);
    $("#agentWalletFrozen").textContent = money(agent.frozen);
    $("#agentWalletNegative").textContent = money(agent.negative);
    $("#agentWalletNegative").classList.toggle("negative-balance", agent.negative > 0);
    const recentCustomers = customers.filter((customer) => customer.agentId === agent.id).slice(0, 3);
    $("#agentRecentCustomers").innerHTML = recentCustomers.length ? recentCustomers.map((customer) => `<div class="masked-customer"><span class="avatar soft-green">${customer.avatar}</span><div><strong>${customer.nickname}</strong><small>${customer.phone || "手机号未绑定"} · ${customer.city}</small></div><b>累计 ¥${customer.spend.toLocaleString("zh-CN")}</b></div>`).join("") : `<div class="empty-state compact-empty"><strong>暂无归属客户</strong><span>新客户确认绑定后显示在此处</span></div>`;
    closeOverlays();
    $("#modalBackdrop").hidden = false;
    $("#agentDrawer").hidden = false;
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
    if (!withdrawal || withdrawal.statusCode !== "APPROVED") return showToast("仅 APPROVED 提现单允许查看完整银行卡号");
    const remaining = state.bankVerifyLockedUntil - Date.now();
    if (remaining > 0) return showToast(`二次验证已锁定，请 ${Math.ceil(remaining / 60000)} 分钟后重试`);
    openModal("#bankVerifyModal");
    state.bankRevealContext = { withdrawalId: withdrawal.id, agentId: withdrawal.agentId };
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
    const password = $("#bankVerifyPassword").value.trim();
    const code = $("#bankVerifyCode").value.trim();
    if (!password || !/^\d{6}$/.test(code)) return showToast("请完成密码和 6 位安全验证码");
    if (password !== "demo-pass" || code !== "826413") {
      state.bankVerifyFailures += 1;
      const locked = state.bankVerifyFailures >= 5;
      if (locked) state.bankVerifyLockedUntil = Date.now() + 15 * 60 * 1000;
      $("#bankVerifyState").className = `verify-state ${locked ? "locked" : "error"}`;
      $("#bankVerifyState").textContent = locked ? "连续失败 5 次，已锁定 15 分钟并记录安全审计。" : `验证失败 ${state.bankVerifyFailures}/5 次；请核对管理员密码和验证码。`;
      return;
    }
    state.bankVerifyFailures = 0;
    const fullCard = secureBankCard(context.agentId);
    closeOverlays();
    openWithdrawal(context.withdrawalId);
    $("#withdrawalCard").textContent = fullCard;
    $("#openBankVerification").hidden = true;
    $("#withdrawalCardTimer").hidden = false;
    $("#withdrawalCardPolicy").textContent = "单次授权已使用 · 离页或 60 秒后清除";
    state.bankRevealGrant = { withdrawalId: context.withdrawalId, expiresAt: Date.now() + 60000, used: true };
    clearTimeout(state.bankRevealTimer);
    state.bankRevealTimer = setTimeout(() => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (item && !$("#withdrawalModal").hidden) {
        $("#withdrawalCard").textContent = item.card;
        $("#openBankVerification").hidden = item.statusCode !== "APPROVED";
        $("#withdrawalCardTimer").hidden = true;
        $("#withdrawalCardPolicy").textContent = "APPROVED · 可二次验证临时查看";
        state.bankRevealGrant = null;
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
    renderOrderDetail(order);
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

      const brandToggle = event.target.closest(".brand-toggle");
      if (brandToggle) {
        const brand = brands.find((item) => item.id === brandToggle.closest("tr").dataset.brandId);
        if (brand) { brand.status = brand.status === "已启用" ? "已停用" : "已启用"; renderBrands(); showToast(`品牌 ${brand.name} 已${brand.status === "已启用" ? "启用" : "停用"}`); }
      }

      const categoryDisable = event.target.closest(".category-disable");
      if (categoryDisable) {
        const row = categoryDisable.closest("tr");
        const category = commissionCategories.find((item) => item.id === row.dataset.categoryId);
        if (categoryDisable.dataset.categoryBlocked === "1") showToast(`${category.name} 仍有关联在售商品，请先迁移或下架后再停用`);
      }

      const inventoryAdjust = event.target.closest(".inventory-adjust");
      if (inventoryAdjust) {
        const item = inventorySkus.find((entry) => entry.id === inventoryAdjust.closest("tr").dataset.inventoryId);
        if (item) showToast(`库存调整：${item.id} · 当前可售 ${item.available}，正式版进入 SKU 库存流水弹窗`);
      }

      const inventoryFlow = event.target.closest(".inventory-flow");
      if (inventoryFlow) showToast(`已打开 ${inventoryFlow.closest("tr").dataset.inventoryId} 的库存流水`);

      const bannerToggle = event.target.closest(".banner-toggle");
      if (bannerToggle) {
        const active = !bannerToggle.classList.contains("active");
        bannerToggle.classList.toggle("active", active);
        bannerToggle.setAttribute("aria-pressed", active);
        showToast(active ? "Banner 已启用并加入投放队列" : "Banner 已暂停投放");
      }

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
    $("#confirmHighRisk").addEventListener("click", () => {
      const pending = state.pendingHighRiskAction;
      const reason = $("#highRiskReason").value.trim();
      if (!pending || !reason || !$("#highRiskConfirm").checked) {
        $("#highRiskError").hidden = false;
        return;
      }
      const action = pending.action;
      closeOverlays();
      action(reason);
    });
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
      if (order) { order.status = "运输中"; order.displayStatus = "运输中"; order.orderStatus = "SHIPPING"; order.fulfillmentStatus = "IN_TRANSIT"; }
      $("#detailOrderStatus").textContent = "运输中";
      $("#detailOrderStatus").className = "tag info";
      $("#openShipModal").hidden = true;
      $("#sideShipButton").hidden = true;
      if (order) renderOrderDetail(order);
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
      const note = $("#reviewNote").value.trim();
      if (!item || !note) return showToast("请填写退款处理说明");
      requestHighRiskAction({
        title: `同意退款 · ${item.id}`,
        reason: note,
        impact: `${item.product} 将进入退款；未发货数量退款成功后自动回补对应 SKU 库存，佣金按原快照追加冲正流水。`,
        confirmLabel: "确认同意退款",
        action: (reason) => {
          item.status = "待退款";
          auditLogs.unshift({ id: `AUD-20260811-${String(420 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:45:10", type: "售后退款", actor: "林老板", target: item.id, reason, result: "待退款 · 已保留售后占用", client: "Web · 10.8.0.16", status: "成功" });
          renderAftersales();
          renderAuditLogs();
          showToast("已同意退款；未发货退款成功后自动回补库存");
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
          auditLogs.unshift({ id: `AUD-20260811-${String(430 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:46:12", type: "售后退款", actor: "林老板", target: item.id, reason, result: "已拒绝 · 占用已释放", client: "Web · 10.8.0.16", status: "成功" });
          renderAftersales();
          renderAuditLogs();
          showToast("已拒绝售后并释放可退数量与金额占用");
        }
      });
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
      agents.unshift({ id: `A${sequence}`, name, account, contact: $("#agentContactInput").value.trim(), invite: `QX-A${sequence}`, authMode, authorizedCount: authMode === "全部在售商品" ? 116 : 42, customers: 0, sales: 0, available: 0, frozen: 0, negative: 0, bank: "未设置", cardLast4: "----", status: $("#agentStatusInput").value, avatar: name.slice(0, 1) });
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

    $("#ruleRateInput").addEventListener("input", updateCommissionRulePreview);
    $("#saveCommissionRule").addEventListener("click", () => {
      const active = state.activeCommissionRule;
      const reason = $("#ruleChangeReason").value.trim();
      if (!active) return;
      if (!reason) return showToast("请填写佣金规则变更原因");
      if (!$("#ruleChangeConfirm").checked) return showToast("请核对影响范围并勾选确认");
      const rate = Number($("#ruleRateInput").value);
      if (state.commissionRuleMode === "custom" && (Number.isNaN(rate) || rate < 0 || rate > 100)) return showToast("佣金比例需在 0% 至 100% 之间");
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
    });

    $("#approveWithdrawal").addEventListener("click", () => {
      const item = withdrawals.find((withdrawal) => withdrawal.id === state.activeWithdrawalId);
      if (!item || item.status !== "待审核") return;
      item.status = "待打款";
      item.statusCode = "APPROVED";
      auditLogs.unshift({ id: `AUD-20260811-${String(470 + auditLogs.length).padStart(4, "0")}`, time: "08-11 11:54:08", type: "提现", actor: "林老板", target: item.id, reason: $("#withdrawalReviewNote").value.trim() || "收款信息核对通过", result: "APPROVED · 待打款", client: "Web · 10.8.0.16", status: "成功" });
      renderWithdrawals();
      renderAuditLogs();
      closeOverlays();
      showToast("已审核通过，请完成线下转账并上传凭证");
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
      if (!item || item.status !== "待打款" || !state.paymentProofReady) return showToast("请先上传打款凭证");
      const agent = agents.find((entry) => entry.id === item.agentId);
      if (agent) agent.frozen = Math.max(0, agent.frozen - item.amount);
      item.status = "已打款";
      item.statusCode = "PAID";
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
      $("#skuRows").insertAdjacentHTML("beforeend", `<tr><td><input value="新规格"></td><td><input value="NEW-SKU"></td><td><div class="money-input"><span>¥</span><input value="0.00"></div></td><td><input type="number" value="0"></td><td><div class="sku-commission-cell"><strong>10.00%</strong><small>预计 ¥0.00 / 件</small></div></td><td><span class="rule-source category">一级分类</span></td><td><button class="icon-button danger sku-delete" title="删除规格">${icon("trash")}</button></td></tr>`);
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
    $("#commissionSkuSearch").addEventListener("input", renderCommissionRules);
    $("#commissionSkuCategory").addEventListener("change", renderCommissionRules);
    $("#brandSearch").addEventListener("input", renderBrands);
    $("#brandStatus").addEventListener("change", renderBrands);
    $("#inventorySearch").addEventListener("input", renderInventory);
    $("#inventoryStatus").addEventListener("change", renderInventory);
    $("#auditSearch").addEventListener("input", renderAuditLogs);
    $("#auditType").addEventListener("change", renderAuditLogs);

    $("#productReset").addEventListener("click", () => {
      $("#productSearch").value = ""; $("#productCategory").value = ""; $("#productBrand").value = ""; $("#productStatus").value = ""; renderProducts();
    });
    $("#orderReset").addEventListener("click", () => { $("#orderSearch").value = ""; $("#orderStatus").value = ""; renderOrders(); });
    $("#aftersaleReset").addEventListener("click", () => { $("#aftersaleSearch").value = ""; $("#aftersaleType").value = ""; $("#aftersaleStatus").value = ""; renderAftersales(); });
    $("#customerReset").addEventListener("click", () => { $("#customerSearch").value = ""; renderCustomers(); });
    $("#agentReset").addEventListener("click", () => { $("#agentSearch").value = ""; $("#agentStatus").value = ""; renderAgents(); });
    $("#withdrawalReset").addEventListener("click", () => { $("#withdrawalSearch").value = ""; $("#withdrawalStatus").value = ""; renderWithdrawals(); });
    $("#commissionSkuReset").addEventListener("click", () => { $("#commissionSkuSearch").value = ""; $("#commissionSkuCategory").value = ""; renderCommissionRules(); });
    $("#brandReset").addEventListener("click", () => { $("#brandSearch").value = ""; $("#brandStatus").value = ""; renderBrands(); });
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
  }

  function init() {
    const prototypeParams = new URLSearchParams(window.location.search);
    const requestedPage = prototypeParams.get("view");
    if (requestedPage && pageTitles[requestedPage]) state.page = requestedPage;
    renderProducts();
    renderBrands();
    renderCategoryManagement();
    renderInventory();
    renderOrders();
    renderOrderDetail(orders.find((order) => order.id === state.activeOrderId) || orders[0]);
    renderDashboardOrders();
    renderRankings();
    renderReportRange();
    renderAftersales();
    renderCustomers();
    renderAgents();
    renderCommissionRules();
    renderWithdrawals();
    renderAuditLogs();
    setupEvents();
    if (prototypeParams.get("autologin") === "1" || sessionStorage.getItem("qingyuAdminLoggedIn") === "1") showApp();
    else showLogin();
  }

  init();
})();
