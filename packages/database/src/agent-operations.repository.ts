import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AgentOperationsIdentity {
  accountId: string;
  agentId: string;
}

export interface AgentCustomerListInput extends AgentOperationsIdentity {
  boundAtFrom?: Date;
  boundAtToExclusive?: Date;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface AgentCustomerReadInput extends AgentOperationsIdentity {
  customerId: string;
}

export type AgentOrderSort = 'AMOUNT_DESC' | 'CREATED_DESC' | 'PAID_DESC';

export interface AgentOrderListInput extends AgentOperationsIdentity {
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  customerId?: string;
  fulfillmentStatus?: 'CANCELLED' | 'DELIVERED' | 'IN_TRANSIT' | 'NOT_STARTED' | 'READY_TO_SHIP' | 'SHIPPED';
  hasAftersale?: boolean;
  maxAmount?: string;
  minAmount?: string;
  orderNo?: string;
  orderStatus?: 'CLOSED' | 'COMPLETED' | 'PENDING_SHIPMENT' | 'SHIPPING';
  page: number;
  pageSize: number;
  refundProcessingStatus?: 'FAILED' | 'IDLE' | 'REFUNDING';
  refundProgressStatus?: 'FULL' | 'NONE' | 'PARTIAL';
  sort: AgentOrderSort;
}

export interface AgentOrderReadInput extends AgentOperationsIdentity {
  orderId: string;
}

export interface AgentCustomerSnapshot {
  bindingId: string;
  bindingStartedAt: Date;
  city: string | null;
  consumptionAmount: string;
  consumptionCount: number;
  customerAlias: string;
  customerId: string;
  customerVersion: number;
  lastProductName: string | null;
  nicknameMasked: string | null;
  phoneTail: string | null;
  registeredAt: Date;
}

export interface AgentCustomerListResult {
  items: AgentCustomerSnapshot[];
  total: number;
}

export interface AgentCustomerOrderSnapshot {
  displayAxes: AgentOrderDisplayAxes;
  orderId: string;
  orderNo: string;
  paidAt: Date;
  payableAmount: string;
}

export interface AgentRecentProductSnapshot {
  lastPurchasedAt: Date;
  productId: string;
  productName: string;
  skuId: string;
  skuName: string;
}

export interface AgentCustomerDetailSnapshot {
  customer: AgentCustomerSnapshot;
  orders: AgentCustomerOrderSnapshot[];
  recentProducts: AgentRecentProductSnapshot[];
}

export interface AgentOrderDisplayAxes {
  fulfillmentStatus: 'CANCELLED' | 'DELIVERED' | 'IN_TRANSIT' | 'NOT_STARTED' | 'READY_TO_SHIP' | 'SHIPPED';
  orderStatus: 'CLOSED' | 'COMPLETED' | 'PENDING_SHIPMENT' | 'SHIPPING';
  paymentResolution: 'LATE_SUCCESS_REFUND_PENDING' | 'LATE_SUCCESS_REFUNDED' | 'MANUAL_REQUIRED' | 'NORMAL';
  paymentStatus: 'PAID';
  refundProcessingStatus: 'FAILED' | 'IDLE' | 'REFUNDING';
  refundProgressStatus: 'FULL' | 'NONE' | 'PARTIAL';
}

export interface AgentOrderItemSnapshot {
  lineAmount: string;
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  refundedQuantity: number;
  reservedAftersaleQuantity: number;
  shippedQuantity: number;
  skuId: string;
  skuName: string;
  unitPrice: string;
}

export interface AgentOrderAftersaleListSnapshot {
  activeCount: number;
  latestAftersaleId: string | null;
  latestStatus: AgentAftersaleStatus | null;
  refundedAmount: string;
}

export interface AgentOrderListSnapshot extends AgentOrderDisplayAxes {
  aftersaleSummary: AgentOrderAftersaleListSnapshot;
  closeReason: 'FULL_REFUND_BEFORE_SHIPMENT' | null;
  completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED' | 'FULL_REFUND_AFTER_SHIPMENT' | null;
  createdAt: Date;
  customerAlias: string;
  customerCity: string | null;
  customerId: string;
  finalAgentId: string;
  items: AgentOrderItemSnapshot[];
  orderId: string;
  orderNo: string;
  paidAt: Date;
  payableAmount: string;
}

export interface AgentOrderListResult {
  items: AgentOrderListSnapshot[];
  total: number;
}

export type AgentAftersaleStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'PENDING_REVIEW'
  | 'REFUNDING'
  | 'REFUNDING_AFTER_RETURN'
  | 'REFUND_FAILED'
  | 'REJECTED'
  | 'REJECTED_AFTER_RETURN'
  | 'RETURN_EXCEPTION'
  | 'WAITING_RECEIPT'
  | 'WAITING_RETURN';

export interface AgentOrderAftersaleSnapshot {
  aftersaleId: string;
  aftersaleNo: string;
  createdAt: Date;
  requestedAmount: string;
  status: AgentAftersaleStatus;
  type: 'REFUND_ONLY' | 'RETURN_REFUND';
}

export interface AgentOrderCommissionSnapshot {
  effectiveRate: string;
  orderItemId: string;
  originalCommission: string;
  ruleSource: 'CATEGORY' | 'PLATFORM' | 'SKU';
  state: 'AVAILABLE' | 'CANCELLED' | 'EXPECTED' | 'NONE';
}

export interface AgentOrderTimelineSnapshot {
  axis: 'AFTERSALE' | 'FULFILLMENT' | 'PAYMENT' | 'REFUND';
  eventCode:
    | 'AFTERSALE_CREATED'
    | 'AFTERSALE_STATUS_CHANGED'
    | 'DELIVERED'
    | 'IN_TRANSIT'
    | 'PAYMENT_SUCCEEDED'
    | 'READY_TO_SHIP'
    | 'REFUND_FAILED'
    | 'REFUND_STARTED'
    | 'REFUND_SUCCEEDED'
    | 'SHIPPED';
  eventId: string;
  fromStatus: string | null;
  occurredAt: Date;
  toStatus: string;
}

export interface AgentOrderDetailSnapshot extends AgentOrderDisplayAxes {
  addressSummaryMasked: string | null;
  aftersales: AgentOrderAftersaleSnapshot[];
  closeReason: 'FULL_REFUND_BEFORE_SHIPMENT' | 'PAYMENT_TIMEOUT' | 'USER_CANCELLED' | null;
  commissionItems: AgentOrderCommissionSnapshot[];
  completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED' | 'FULL_REFUND_AFTER_SHIPMENT' | null;
  createdAt: Date;
  customerAlias: string;
  customerCity: string | null;
  customerId: string;
  customerNicknameMasked: string | null;
  customerPhoneTail: string | null;
  finalAgentId: string;
  items: AgentOrderItemSnapshot[];
  orderId: string;
  orderNo: string;
  paidAt: Date;
  payableAmount: string;
  timeline: AgentOrderTimelineSnapshot[];
}

const AGENT_SELECT = {
  account: { select: { deleted_at: true, id: true, role: true, status: true } },
  account_id: true,
  deleted_at: true,
  id: true,
  status: true,
  version: true,
} satisfies Prisma.AgentProfileSelect;

const CUSTOMER_BINDING_SELECT = {
  customer: {
    select: {
      account: { select: { deleted_at: true, id: true, role: true, status: true } },
      account_id: true,
      anonymized_at: true,
      id: true,
      phone_verifications: {
        orderBy: [{ verified_at: 'desc' as const }, { id: 'desc' as const }],
        select: { phone_last4: true },
        take: 2,
        where: { revoked_at: null },
      },
      registered_at: true,
      version: true,
    },
  },
  id: true,
  started_at: true,
} satisfies Prisma.CustomerAgentBindingSelect;

const PRIVACY_SELECT = {
  agent_id: true,
  anonymized_at: true,
  city: true,
  customer_alias: true,
  customer_id: true,
  nickname_masked: true,
  phone_tail: true,
} satisfies Prisma.AgentCustomerPrivacyProjectionSelect;

const ORDER_ITEM_SELECT = {
  aftersale_reserved_qty: true,
  id: true,
  line_paid_amount: true,
  product_id: true,
  product_name_snapshot: true,
  quantity: true,
  refunded_qty: true,
  shipped_qty: true,
  sku_id: true,
  sku_name_snapshot: true,
  unit_price: true,
} satisfies Prisma.OrderItemSelect;

const CURRENT_PERIOD_ORDER_SELECT = {
  attribution_snapshot: {
    select: {
      agent_id_snapshot: true,
      binding_id_snapshot: true,
      privacy_projection: { select: PRIVACY_SELECT },
    },
  },
  close_reason: true,
  completion_reason: true,
  created_at: true,
  customer_id: true,
  final_agent_id: true,
  fulfillment_status: true,
  id: true,
  items: {
    orderBy: [{ created_at: 'asc' as const }, { id: 'asc' as const }],
    select: ORDER_ITEM_SELECT,
  },
  order_no: true,
  order_status: true,
  paid_amount: true,
  paid_at: true,
  payable_amount: true,
  payment_resolution: true,
  payment_status: true,
  refund_processing_status: true,
  refund_progress_status: true,
  refunded_amount: true,
} satisfies Prisma.SalesOrderSelect;

const ACTIVE_AFTERSALE_STATUSES: AgentAftersaleStatus[] = [
  'PENDING_REVIEW',
  'REFUNDING',
  'WAITING_RETURN',
  'WAITING_RECEIPT',
  'RETURN_EXCEPTION',
  'REFUNDING_AFTER_RETURN',
  'REFUND_FAILED',
];

const ORDER_LIST_SELECT = {
  _count: {
    select: {
      aftersales: {
        where: {
          status: { in: ACTIVE_AFTERSALE_STATUSES },
          type: { in: ['REFUND_ONLY' as const, 'RETURN_REFUND' as const] },
        },
      },
    },
  },
  aftersales: {
    orderBy: [{ created_at: 'desc' as const }, { id: 'desc' as const }],
    select: { id: true, status: true, type: true },
    take: 1,
    where: { type: { in: ['REFUND_ONLY' as const, 'RETURN_REFUND' as const] } },
  },
  ...CURRENT_PERIOD_ORDER_SELECT,
} satisfies Prisma.SalesOrderSelect;

const ORDER_DETAIL_SELECT = {
  ...CURRENT_PERIOD_ORDER_SELECT,
  address_snapshot: { select: { city: true, province: true } },
  aftersales: {
    orderBy: [{ created_at: 'asc' as const }, { id: 'asc' as const }],
    select: {
      aftersale_no: true,
      created_at: true,
      id: true,
      items: { select: { requested_amount: true } },
      status: true,
      type: true,
      updated_at: true,
    },
    where: { type: { in: ['REFUND_ONLY' as const, 'RETURN_REFUND' as const] } },
  },
  items: {
    orderBy: [{ created_at: 'asc' as const }, { id: 'asc' as const }],
    select: {
      ...ORDER_ITEM_SELECT,
      commission_snapshot: {
        select: {
          agent_id: true,
          effective_rate: true,
          original_commission: true,
          position: { select: { state: true } },
          source_type: true,
        },
      },
    },
  },
  refunds: {
    orderBy: [{ requested_at: 'asc' as const }, { id: 'asc' as const }],
    select: { failed_at: true, id: true, requested_at: true, status: true, succeeded_at: true },
  },
  shipment: {
    select: {
      events: {
        orderBy: [{ occurred_at: 'asc' as const }, { id: 'asc' as const }],
        select: { id: true, occurred_at: true, status_code: true },
      },
      id: true,
      shipped_at: true,
    },
  },
} satisfies Prisma.SalesOrderSelect;

type AgentRecord = Prisma.AgentProfileGetPayload<{ select: typeof AGENT_SELECT }>;
type CustomerBindingRecord = Prisma.CustomerAgentBindingGetPayload<{ select: typeof CUSTOMER_BINDING_SELECT }>;
type CurrentPeriodOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof CURRENT_PERIOD_ORDER_SELECT }>;
type OrderListRecord = Prisma.SalesOrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;
type OrderDetailRecord = Prisma.SalesOrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(message: string): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function validDate(value: Date | undefined, label: string): void {
  if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
    throw new TypeError(`${label} is invalid`);
  }
}

function validateIdentity(input: AgentOperationsIdentity): void {
  requireUlid(input.accountId, 'Agent account ID');
  requireUlid(input.agentId, 'Agent ID');
  if (input.accountId === input.agentId) throw new TypeError('Agent and account IDs must differ');
}

function validatePage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize) || (page - 1) * pageSize > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Agent pagination is invalid');
  }
}

function validateCustomerListInput(input: AgentCustomerListInput): void {
  validateIdentity(input);
  validatePage(input.page, input.pageSize);
  validDate(input.boundAtFrom, 'Agent customer date_from');
  validDate(input.boundAtToExclusive, 'Agent customer date_to');
  if (input.boundAtFrom !== undefined && input.boundAtToExclusive !== undefined &&
    input.boundAtFrom.getTime() >= input.boundAtToExclusive.getTime()) {
    throw new TypeError('Agent customer date range is invalid');
  }
  if (input.keyword !== undefined && (input.keyword.trim() !== input.keyword ||
    Array.from(input.keyword).length < 1 || Array.from(input.keyword).length > 200)) {
    throw new TypeError('Agent customer keyword is invalid');
  }
}

function validateCustomerReadInput(input: AgentCustomerReadInput): void {
  validateIdentity(input);
  requireUlid(input.customerId, 'Agent customer ID');
}

function validateOrderListInput(input: AgentOrderListInput): void {
  validateIdentity(input);
  validatePage(input.page, input.pageSize);
  validDate(input.createdAtFrom, 'Agent order date_from');
  validDate(input.createdAtToExclusive, 'Agent order date_to');
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Agent order date range is invalid');
  }
  if (input.customerId !== undefined) requireUlid(input.customerId, 'Agent order customer ID');
  if (input.orderNo !== undefined && (input.orderNo.trim() !== input.orderNo || input.orderNo.length < 1 ||
    input.orderNo.length > 32)) throw new TypeError('Agent order number is invalid');
  for (const [label, value] of [['minimum', input.minAmount], ['maximum', input.maxAmount]] as const) {
    if (value !== undefined && (!MONEY.test(value) || new Prisma.Decimal(value).greaterThan('9999999999999999.99'))) {
      throw new TypeError(`Agent order ${label} amount is invalid`);
    }
  }
  if (input.minAmount !== undefined && input.maxAmount !== undefined &&
    new Prisma.Decimal(input.minAmount).greaterThan(input.maxAmount)) {
    throw new TypeError('Agent order amount range is invalid');
  }
}

function validateOrderReadInput(input: AgentOrderReadInput): void {
  validateIdentity(input);
  requireUlid(input.orderId, 'Agent order ID');
}

function safeDate(value: Date | null, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function safeText(value: string, maximum: number, label: string): string {
  const length = Array.from(value).length;
  if (length < 1 || length > maximum || /\p{Cc}/u.test(value)) throw internal(`${label} is invalid`);
  return value;
}

function nullableSafeText(value: string | null, maximum: number, label: string): string | null {
  return value === null ? null : safeText(value, maximum, label);
}

function safeCount(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function safeMoney(value: Prisma.Decimal, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || value.decimalPlaces() > 2 ||
    value.greaterThan('9999999999999999.99')) throw internal(`${label} is invalid`);
  return value.toFixed(2);
}

function safeRate(value: Prisma.Decimal): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || value.greaterThan(100) || value.decimalPlaces() > 4) {
    throw internal('Stored commission rate is invalid');
  }
  return value.toFixed(4);
}

function activeAgent(record: AgentRecord | null, identity: AgentOperationsIdentity): void {
  if (!record || record.id !== identity.agentId || record.account_id !== identity.accountId ||
    record.deleted_at !== null || record.status !== 'ACTIVE' || record.version < 1 ||
    record.account.id !== identity.accountId || record.account.deleted_at !== null ||
    record.account.role !== 'AGENT_ADMIN' || record.account.status !== 'ACTIVE') {
    throw notFound('Active Agent does not exist');
  }
}

function currentCustomerWhere(
  input: Pick<AgentCustomerListInput, 'agentId' | 'boundAtFrom' | 'boundAtToExclusive' | 'keyword'>,
): Prisma.CustomerAgentBindingWhereInput {
  const activeCustomer: Prisma.CustomerProfileWhereInput = {
    account: { is: { deleted_at: null, role: 'CUSTOMER', status: 'ACTIVE' } },
    anonymized_at: null,
  };
  const keyword = input.keyword;
  const keywordFilter: Prisma.CustomerAgentBindingWhereInput | undefined = keyword === undefined
    ? undefined
    : {
        OR: [
          ...(keyword.toLowerCase().startsWith('customer_')
            ? [{ id: { contains: keyword.slice('customer_'.length), mode: 'insensitive' as const } }]
            : []),
          {
            customer: {
              is: {
                OR: [
                  { id: { contains: keyword, mode: 'insensitive' } },
                  {
                    agent_privacy_projections: {
                      some: {
                        agent_id: input.agentId,
                        OR: [
                          { customer_alias: { contains: keyword, mode: 'insensitive' } },
                          { nickname_masked: { contains: keyword, mode: 'insensitive' } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      };
  return {
    AND: [
      { agent_id: input.agentId, customer: { is: activeCustomer }, ended_at: null },
      ...(input.boundAtFrom === undefined && input.boundAtToExclusive === undefined
        ? []
        : [{
            started_at: {
              ...(input.boundAtFrom === undefined ? {} : { gte: input.boundAtFrom }),
              ...(input.boundAtToExclusive === undefined ? {} : { lt: input.boundAtToExclusive }),
            },
          }]),
      ...(keywordFilter === undefined ? [] : [keywordFilter]),
    ],
  };
}

function safeBinding(record: CustomerBindingRecord): CustomerBindingRecord {
  requireUlid(record.id, 'Stored Agent customer binding ID');
  requireUlid(record.customer.id, 'Stored Agent customer ID');
  if (record.customer.anonymized_at !== null || record.customer.account.deleted_at !== null ||
    record.customer.account.id !== record.customer.account_id || record.customer.account.role !== 'CUSTOMER' ||
    record.customer.account.status !== 'ACTIVE' || record.customer.version < 1 ||
    record.customer.phone_verifications.length > 1) {
    throw internal('Stored current Agent customer is invalid');
  }
  safeDate(record.started_at, 'Stored Agent customer binding start');
  safeDate(record.customer.registered_at, 'Stored Agent customer registration time');
  return record;
}

function orderAxes(record: CurrentPeriodOrderRecord): AgentOrderDisplayAxes {
  if (record.payment_status !== 'PAID' ||
    (record.order_status !== 'PENDING_SHIPMENT' && record.order_status !== 'SHIPPING' &&
      record.order_status !== 'COMPLETED' && record.order_status !== 'CLOSED')) {
    throw internal('Stored Agent paid order status is invalid');
  }
  return {
    fulfillmentStatus: record.fulfillment_status,
    orderStatus: record.order_status,
    paymentResolution: record.payment_resolution,
    paymentStatus: 'PAID',
    refundProcessingStatus: record.refund_processing_status,
    refundProgressStatus: record.refund_progress_status,
  };
}

function privacy(record: CurrentPeriodOrderRecord, agentId: string, bindingId?: string) {
  const attribution = record.attribution_snapshot;
  const projection = attribution?.privacy_projection;
  if (!attribution || attribution.agent_id_snapshot !== agentId ||
    (bindingId !== undefined && attribution.binding_id_snapshot !== bindingId) ||
    record.final_agent_id !== agentId || !projection || projection.agent_id !== agentId ||
    projection.customer_id !== record.customer_id) {
    throw internal('Stored Agent order attribution snapshot is invalid');
  }
  requireUlid(record.customer_id, 'Stored Agent order customer ID');
  if (projection.phone_tail !== null && !/^[0-9]{4}$/.test(projection.phone_tail)) {
    throw internal('Stored Agent customer phone tail is invalid');
  }
  return {
    customerAlias: safeText(projection.customer_alias, 80, 'Stored Agent customer alias'),
    customerCity: nullableSafeText(projection.city, 120, 'Stored Agent customer city'),
    customerNicknameMasked: nullableSafeText(
      projection.nickname_masked,
      80,
      'Stored Agent customer masked nickname',
    ),
    customerPhoneTail: projection.phone_tail,
  };
}

function orderItem(record: CurrentPeriodOrderRecord['items'][number]): AgentOrderItemSnapshot {
  requireUlid(record.id, 'Stored Agent order item ID');
  requireUlid(record.product_id, 'Stored Agent order product ID');
  requireUlid(record.sku_id, 'Stored Agent order SKU ID');
  const quantity = safeCount(record.quantity, 'Stored Agent order item quantity', 1);
  const refundedQuantity = safeCount(record.refunded_qty, 'Stored Agent refunded quantity');
  const reservedAftersaleQuantity = safeCount(
    record.aftersale_reserved_qty,
    'Stored Agent aftersale reserved quantity',
  );
  const shippedQuantity = safeCount(record.shipped_qty, 'Stored Agent shipped quantity');
  if (refundedQuantity > quantity || reservedAftersaleQuantity > quantity - refundedQuantity ||
    shippedQuantity > quantity) throw internal('Stored Agent order item counters are inconsistent');
  return {
    lineAmount: safeMoney(record.line_paid_amount, 'Stored Agent order line amount'),
    orderItemId: record.id,
    productId: record.product_id,
    productName: safeText(record.product_name_snapshot, 200, 'Stored Agent product name'),
    quantity,
    refundedQuantity,
    reservedAftersaleQuantity,
    shippedQuantity,
    skuId: record.sku_id,
    skuName: safeText(record.sku_name_snapshot, 160, 'Stored Agent SKU name'),
    unitPrice: safeMoney(record.unit_price, 'Stored Agent unit price'),
  };
}

function fallbackAlias(bindingId: string): string {
  return `customer_${bindingId.toLowerCase()}`;
}

function currentPeriodOrdersWhere(
  agentId: string,
  bindingIds: string[],
): Prisma.SalesOrderWhereInput {
  return {
    attribution_snapshot: {
      is: { agent_id_snapshot: agentId, binding_id_snapshot: { in: bindingIds } },
    },
    final_agent_id: agentId,
    paid_at: { not: null },
    payment_status: 'PAID',
  };
}

function customerSnapshot(
  bindingValue: CustomerBindingRecord,
  orders: CurrentPeriodOrderRecord[],
  agentId: string,
): AgentCustomerSnapshot {
  const binding = safeBinding(bindingValue);
  const sorted = [...orders].sort((left, right) => {
    const leftPaid = safeDate(left.paid_at, 'Stored Agent order paid time').getTime();
    const rightPaid = safeDate(right.paid_at, 'Stored Agent order paid time').getTime();
    return rightPaid - leftPaid || right.id.localeCompare(left.id);
  });
  let consumption = new Prisma.Decimal(0);
  for (const order of sorted) {
    orderAxes(order);
    privacy(order, agentId, binding.id);
    consumption = consumption.plus(order.paid_amount).minus(order.refunded_amount);
  }
  if (consumption.isNegative()) throw internal('Stored Agent customer net consumption is invalid');
  const latest = sorted[0];
  const latestPrivacy = latest === undefined ? undefined : privacy(latest, agentId, binding.id);
  const phoneTail = binding.customer.phone_verifications[0]?.phone_last4 ?? null;
  if (phoneTail !== null && !/^[0-9]{4}$/.test(phoneTail)) {
    throw internal('Stored Agent customer phone tail is invalid');
  }
  return {
    bindingId: binding.id,
    bindingStartedAt: safeDate(binding.started_at, 'Stored Agent customer binding start'),
    city: latestPrivacy?.customerCity ?? null,
    consumptionAmount: safeMoney(consumption, 'Stored Agent customer consumption'),
    consumptionCount: safeCount(sorted.length, 'Stored Agent customer consumption count'),
    customerAlias: latestPrivacy?.customerAlias ?? fallbackAlias(binding.id),
    customerId: binding.customer.id,
    customerVersion: safeCount(binding.customer.version, 'Stored Agent customer version', 1),
    lastProductName: latest?.items[0] === undefined
      ? null
      : safeText(latest.items[0].product_name_snapshot, 200, 'Stored Agent last product name'),
    nicknameMasked: latestPrivacy?.customerNicknameMasked ?? null,
    phoneTail,
    registeredAt: safeDate(binding.customer.registered_at, 'Stored Agent customer registration time'),
  };
}

function currentCustomerOrders(
  records: CurrentPeriodOrderRecord[],
  bindingId: string,
  agentId: string,
): AgentCustomerOrderSnapshot[] {
  return records.map((record) => {
    requireUlid(record.id, 'Stored Agent order ID');
    privacy(record, agentId, bindingId);
    return {
      displayAxes: orderAxes(record),
      orderId: record.id,
      orderNo: safeText(record.order_no, 32, 'Stored Agent order number'),
      paidAt: safeDate(record.paid_at, 'Stored Agent order paid time'),
      payableAmount: safeMoney(record.payable_amount, 'Stored Agent order payable amount'),
    };
  });
}

function recentProducts(records: CurrentPeriodOrderRecord[]): AgentRecentProductSnapshot[] {
  const result = new Map<string, AgentRecentProductSnapshot>();
  for (const record of records) {
    const paidAt = safeDate(record.paid_at, 'Stored Agent order paid time');
    for (const item of record.items) {
      const key = `${item.product_id}:${item.sku_id}`;
      if (result.has(key)) continue;
      const safe = orderItem(item);
      result.set(key, {
        lastPurchasedAt: paidAt,
        productId: safe.productId,
        productName: safe.productName,
        skuId: safe.skuId,
        skuName: safe.skuName,
      });
    }
  }
  return [...result.values()];
}

function orderListWhere(
  input: AgentOrderListInput,
  currentBindingId: string | undefined,
): Prisma.SalesOrderWhereInput {
  return {
    ...(input.hasAftersale === undefined
      ? {}
      : { aftersales: input.hasAftersale ? { some: {} } : { none: {} } }),
    attribution_snapshot: {
      is: {
        agent_id_snapshot: input.agentId,
        ...(currentBindingId === undefined ? {} : { binding_id_snapshot: currentBindingId }),
      },
    },
    ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined
      ? {}
      : {
          created_at: {
            ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
            ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
          },
        }),
    ...(input.customerId === undefined ? {} : { customer_id: input.customerId }),
    final_agent_id: input.agentId,
    ...(input.fulfillmentStatus === undefined ? {} : { fulfillment_status: input.fulfillmentStatus }),
    ...(input.maxAmount === undefined && input.minAmount === undefined
      ? {}
      : {
          payable_amount: {
            ...(input.maxAmount === undefined ? {} : { lte: new Prisma.Decimal(input.maxAmount) }),
            ...(input.minAmount === undefined ? {} : { gte: new Prisma.Decimal(input.minAmount) }),
          },
        }),
    ...(input.orderNo === undefined ? {} : { order_no: input.orderNo }),
    ...(input.orderStatus === undefined ? {} : { order_status: input.orderStatus }),
    paid_at: { not: null },
    payment_status: 'PAID',
    ...(input.refundProcessingStatus === undefined
      ? {}
      : { refund_processing_status: input.refundProcessingStatus }),
    ...(input.refundProgressStatus === undefined
      ? {}
      : { refund_progress_status: input.refundProgressStatus }),
  };
}

function orderListOrderBy(sort: AgentOrderSort): Prisma.SalesOrderOrderByWithRelationInput[] {
  if (sort === 'AMOUNT_DESC') return [{ payable_amount: 'desc' }, { id: 'desc' }];
  if (sort === 'PAID_DESC') return [{ paid_at: { nulls: 'last', sort: 'desc' } }, { id: 'desc' }];
  return [{ created_at: 'desc' }, { id: 'desc' }];
}

function listOrder(record: OrderListRecord, agentId: string): AgentOrderListSnapshot {
  requireUlid(record.id, 'Stored Agent order ID');
  const projection = privacy(record, agentId);
  if (record.items.length < 1) throw internal('Stored Agent order has no items');
  if (record.close_reason !== null && record.close_reason !== 'FULL_REFUND_BEFORE_SHIPMENT') {
    throw internal('Stored Agent order close reason is not list-safe');
  }
  if (record.payment_resolution === 'LATE_SUCCESS_REFUND_PENDING') {
    throw internal('Stored Agent order payment resolution is not list-safe');
  }
  const latest = record.aftersales[0];
  return {
    ...orderAxes(record),
    aftersaleSummary: {
      activeCount: safeCount(record._count.aftersales, 'Stored Agent active aftersale count'),
      latestAftersaleId: latest?.id ?? null,
      latestStatus: latest?.status ?? null,
      refundedAmount: safeMoney(record.refunded_amount, 'Stored Agent order refunded amount'),
    },
    closeReason: record.close_reason,
    completionReason: record.completion_reason,
    createdAt: safeDate(record.created_at, 'Stored Agent order creation time'),
    customerAlias: projection.customerAlias,
    customerCity: projection.customerCity,
    customerId: record.customer_id,
    finalAgentId: agentId,
    items: record.items.map(orderItem),
    orderId: record.id,
    orderNo: safeText(record.order_no, 32, 'Stored Agent order number'),
    paidAt: safeDate(record.paid_at, 'Stored Agent order paid time'),
    payableAmount: safeMoney(record.payable_amount, 'Stored Agent order payable amount'),
  };
}

function aftersales(record: OrderDetailRecord): AgentOrderAftersaleSnapshot[] {
  return record.aftersales.map((aftersale) => {
    requireUlid(aftersale.id, 'Stored Agent aftersale ID');
    if (aftersale.type !== 'REFUND_ONLY' && aftersale.type !== 'RETURN_REFUND') {
      throw internal('Stored Agent aftersale type is invalid');
    }
    const requested = aftersale.items.reduce(
      (total, item) => total.plus(item.requested_amount),
      new Prisma.Decimal(0),
    );
    if (!requested.greaterThan(0)) throw internal('Stored Agent aftersale requested amount is invalid');
    return {
      aftersaleId: aftersale.id,
      aftersaleNo: safeText(aftersale.aftersale_no, 32, 'Stored Agent aftersale number'),
      createdAt: safeDate(aftersale.created_at, 'Stored Agent aftersale creation time'),
      requestedAmount: safeMoney(requested, 'Stored Agent aftersale requested amount'),
      status: aftersale.status,
      type: aftersale.type,
    };
  });
}

function commissions(record: OrderDetailRecord, agentId: string): AgentOrderCommissionSnapshot[] {
  return record.items.map((item) => {
    const commission = item.commission_snapshot;
    if (!commission || commission.agent_id !== agentId || !commission.position) {
      throw internal('Stored Agent order commission snapshot is invalid');
    }
    return {
      effectiveRate: safeRate(commission.effective_rate),
      orderItemId: item.id,
      originalCommission: safeMoney(commission.original_commission, 'Stored original commission'),
      ruleSource: commission.source_type,
      state: commission.position.state,
    };
  });
}

function timeline(record: OrderDetailRecord): AgentOrderTimelineSnapshot[] {
  const paidAt = safeDate(record.paid_at, 'Stored Agent order paid time');
  const events: AgentOrderTimelineSnapshot[] = [
    {
      axis: 'PAYMENT',
      eventCode: 'PAYMENT_SUCCEEDED',
      eventId: `${record.id}:payment-succeeded`,
      fromStatus: null,
      occurredAt: paidAt,
      toStatus: 'PAID',
    },
    {
      axis: 'FULFILLMENT',
      eventCode: 'READY_TO_SHIP',
      eventId: `${record.id}:ready-to-ship`,
      fromStatus: 'NOT_STARTED',
      occurredAt: paidAt,
      toStatus: 'READY_TO_SHIP',
    },
  ];
  for (const refund of record.refunds) {
    requireUlid(refund.id, 'Stored Agent refund ID');
    events.push({
      axis: 'REFUND',
      eventCode: 'REFUND_STARTED',
      eventId: `${refund.id}:started`,
      fromStatus: null,
      occurredAt: safeDate(refund.requested_at, 'Stored Agent refund request time'),
      toStatus: 'REFUNDING',
    });
    if (refund.status === 'SUCCEEDED') {
      events.push({
        axis: 'REFUND',
        eventCode: 'REFUND_SUCCEEDED',
        eventId: `${refund.id}:succeeded`,
        fromStatus: 'REFUNDING',
        occurredAt: safeDate(refund.succeeded_at, 'Stored Agent refund success time'),
        toStatus: 'SUCCEEDED',
      });
    } else if (refund.status === 'FAILED') {
      events.push({
        axis: 'REFUND',
        eventCode: 'REFUND_FAILED',
        eventId: `${refund.id}:failed`,
        fromStatus: 'REFUNDING',
        occurredAt: safeDate(refund.failed_at, 'Stored Agent refund failure time'),
        toStatus: 'FAILED',
      });
    }
  }
  if (record.shipment !== null) {
    events.push({
      axis: 'FULFILLMENT',
      eventCode: 'SHIPPED',
      eventId: `${record.shipment.id}:shipped`,
      fromStatus: 'READY_TO_SHIP',
      occurredAt: safeDate(record.shipment.shipped_at, 'Stored Agent shipment time'),
      toStatus: 'SHIPPED',
    });
    for (const event of record.shipment.events) {
      if (event.status_code !== 'SHIPPED' && event.status_code !== 'IN_TRANSIT' &&
        event.status_code !== 'DELIVERED') continue;
      events.push({
        axis: 'FULFILLMENT',
        eventCode: event.status_code,
        eventId: event.id,
        fromStatus: null,
        occurredAt: safeDate(event.occurred_at, 'Stored Agent logistics event time'),
        toStatus: event.status_code,
      });
    }
  }
  for (const aftersale of record.aftersales) {
    const createdAt = safeDate(aftersale.created_at, 'Stored Agent aftersale creation time');
    const updatedAt = safeDate(aftersale.updated_at, 'Stored Agent aftersale update time');
    events.push({
      axis: 'AFTERSALE',
      eventCode: 'AFTERSALE_CREATED',
      eventId: `${aftersale.id}:created`,
      fromStatus: null,
      occurredAt: createdAt,
      toStatus: 'PENDING_REVIEW',
    });
    if (updatedAt.getTime() !== createdAt.getTime() || aftersale.status !== 'PENDING_REVIEW') {
      events.push({
        axis: 'AFTERSALE',
        eventCode: 'AFTERSALE_STATUS_CHANGED',
        eventId: `${aftersale.id}:status`,
        fromStatus: null,
        occurredAt: updatedAt,
        toStatus: aftersale.status,
      });
    }
  }
  return events.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime() ||
    left.eventId.localeCompare(right.eventId));
}

function detailOrder(record: OrderDetailRecord, agentId: string): AgentOrderDetailSnapshot {
  requireUlid(record.id, 'Stored Agent order ID');
  const projection = privacy(record, agentId);
  if (record.items.length < 1) throw internal('Stored Agent order has no items');
  let addressSummaryMasked: string | null = null;
  if (record.address_snapshot !== null) {
    const province = safeText(record.address_snapshot.province, 80, 'Stored Agent order province');
    const city = safeText(record.address_snapshot.city, 80, 'Stored Agent order address city');
    addressSummaryMasked = province === city ? city : `${province} ${city}`;
  }
  return {
    ...orderAxes(record),
    addressSummaryMasked,
    aftersales: aftersales(record),
    closeReason: record.close_reason,
    commissionItems: commissions(record, agentId),
    completionReason: record.completion_reason,
    createdAt: safeDate(record.created_at, 'Stored Agent order creation time'),
    customerAlias: projection.customerAlias,
    customerCity: projection.customerCity,
    customerId: record.customer_id,
    customerNicknameMasked: projection.customerNicknameMasked,
    customerPhoneTail: projection.customerPhoneTail,
    finalAgentId: agentId,
    items: record.items.map(orderItem),
    orderId: record.id,
    orderNo: safeText(record.order_no, 32, 'Stored Agent order number'),
    paidAt: safeDate(record.paid_at, 'Stored Agent order paid time'),
    payableAmount: safeMoney(record.payable_amount, 'Stored Agent order payable amount'),
    timeline: timeline(record),
  };
}

export class AgentOperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async requireActiveAgent(
    transaction: DatabaseTransaction,
    identity: AgentOperationsIdentity,
  ): Promise<void> {
    activeAgent(await transaction.agentProfile.findUnique({ select: AGENT_SELECT, where: { id: identity.agentId } }), identity);
  }

  private async currentBinding(
    transaction: DatabaseTransaction,
    identity: AgentOperationsIdentity,
    customerId: string,
  ): Promise<CustomerBindingRecord> {
    const binding = await transaction.customerAgentBinding.findFirst({
      select: CUSTOMER_BINDING_SELECT,
      where: {
        ...currentCustomerWhere({ agentId: identity.agentId }),
        customer_id: customerId,
      },
    });
    if (!binding) throw notFound('Agent customer does not exist');
    return safeBinding(binding);
  }

  async listCustomers(input: AgentCustomerListInput): Promise<AgentCustomerListResult> {
    validateCustomerListInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const where = currentCustomerWhere(input);
      const [bindings, total] = await Promise.all([
        transaction.customerAgentBinding.findMany({
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          select: CUSTOMER_BINDING_SELECT,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.customerAgentBinding.count({ where }),
      ]);
      if (!Number.isSafeInteger(total) || total < 0) throw internal('Stored Agent customer total is invalid');
      const bindingIds = bindings.map((binding) => safeBinding(binding).id);
      const orders = bindingIds.length === 0 ? [] : await transaction.salesOrder.findMany({
        orderBy: [{ paid_at: 'desc' }, { id: 'desc' }],
        select: CURRENT_PERIOD_ORDER_SELECT,
        where: currentPeriodOrdersWhere(input.agentId, bindingIds),
      });
      const byBinding = new Map<string, CurrentPeriodOrderRecord[]>();
      for (const order of orders) {
        const bindingId = order.attribution_snapshot?.binding_id_snapshot;
        if (bindingId === null || bindingId === undefined || !bindingIds.includes(bindingId)) {
          throw internal('Stored Agent customer order binding is invalid');
        }
        const current = byBinding.get(bindingId) ?? [];
        current.push(order);
        byBinding.set(bindingId, current);
      }
      return {
        items: bindings.map((binding) => customerSnapshot(
          binding,
          byBinding.get(binding.id) ?? [],
          input.agentId,
        )),
        total,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getCustomer(input: AgentCustomerReadInput): Promise<AgentCustomerDetailSnapshot> {
    validateCustomerReadInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const binding = await this.currentBinding(transaction, input, input.customerId);
      const orders = await transaction.salesOrder.findMany({
        orderBy: [{ paid_at: 'desc' }, { id: 'desc' }],
        select: CURRENT_PERIOD_ORDER_SELECT,
        where: currentPeriodOrdersWhere(input.agentId, [binding.id]),
      });
      return {
        customer: customerSnapshot(binding, orders, input.agentId),
        orders: currentCustomerOrders(orders, binding.id, input.agentId),
        recentProducts: recentProducts(orders),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listOrders(input: AgentOrderListInput): Promise<AgentOrderListResult> {
    validateOrderListInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const binding = input.customerId === undefined
        ? undefined
        : await this.currentBinding(transaction, input, input.customerId);
      const where = orderListWhere(input, binding?.id);
      const [orders, total] = await Promise.all([
        transaction.salesOrder.findMany({
          orderBy: orderListOrderBy(input.sort),
          select: ORDER_LIST_SELECT,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.salesOrder.count({ where }),
      ]);
      if (!Number.isSafeInteger(total) || total < 0) throw internal('Stored Agent order total is invalid');
      return { items: orders.map((order) => listOrder(order, input.agentId)), total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getOrder(input: AgentOrderReadInput): Promise<AgentOrderDetailSnapshot> {
    validateOrderReadInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const order = await transaction.salesOrder.findFirst({
        select: ORDER_DETAIL_SELECT,
        where: {
          attribution_snapshot: { is: { agent_id_snapshot: input.agentId } },
          final_agent_id: input.agentId,
          id: input.orderId,
          paid_at: { not: null },
          payment_status: 'PAID',
        },
      });
      if (!order) throw notFound('Agent order does not exist');
      return detailOrder(order, input.agentId);
    }, { isolationLevel: 'RepeatableRead' });
  }
}
