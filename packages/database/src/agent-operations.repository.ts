import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  validateAgentCommissionLedgerClosureInTransaction,
  validateCommissionSnapshotLedgerClosure,
  validateCommissionSnapshotRule,
} from './commission.repository';
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

export type AgentCommissionLedgerType =
  | 'AVAILABLE_CREDIT'
  | 'EXPECTED_CANCELLED'
  | 'EXPECTED_CREATED'
  | 'EXPECTED_REDUCED'
  | 'REFUND_DEBIT';

export type AgentCommissionPositionState = 'AVAILABLE' | 'CANCELLED' | 'EXPECTED' | 'NONE';

export interface AgentCommissionListInput extends AgentOperationsIdentity {
  ledgerType?: AgentCommissionLedgerType;
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  orderNo?: string;
  page: number;
  pageSize: number;
  state?: AgentCommissionPositionState;
}

export interface AgentCommissionReadInput extends AgentOperationsIdentity {
  commissionSnapshotId: string;
}

export interface AgentCommissionLedgerSnapshot {
  availableChange: string;
  commissionBase: string;
  commissionSnapshotId: string;
  effectiveRate: string;
  expectedChange: string;
  ledgerId: string;
  ledgerType: AgentCommissionLedgerType;
  occurredAt: Date;
  orderId: string;
  orderItemId: string;
  orderNo: string;
  originalCommission: string;
  positionState: AgentCommissionPositionState;
  productId: string;
  productName: string;
  reason: string;
  refundId: string | null;
  skuId: string;
  skuName: string;
}

export interface AgentCommissionListResult {
  items: AgentCommissionLedgerSnapshot[];
  total: number;
}

export interface AgentCommissionExplanationLedgerSnapshot {
  availableChange: string;
  expectedChange: string;
  frozenChange: string;
  ledgerId: string;
  ledgerType: AgentCommissionLedgerType;
  occurredAt: Date;
  reason: string;
  refundId: string | null;
}

export interface AgentCommissionDetailSnapshot {
  categoryId: string;
  categoryName: string;
  commissionBase: string;
  commissionSnapshotId: string;
  effectiveRate: string;
  expectedRemaining: string;
  hitPath: string[];
  ledger: AgentCommissionExplanationLedgerSnapshot[];
  orderId: string;
  orderItemId: string;
  orderNo: string;
  originalCommission: string;
  positionState: AgentCommissionPositionState;
  productId: string;
  productName: string;
  reversalTotal: string;
  ruleSource: 'CATEGORY' | 'PLATFORM' | 'SKU';
  ruleVersionId: string;
  ruleVersionNo: number;
  skuId: string;
  skuName: string;
}

export interface AgentWalletSnapshot {
  availableBalance: string;
  blockedReason: 'INSUFFICIENT_BALANCE' | 'NEGATIVE_BALANCE' | null;
  expectedCommission: string;
  frozenBalance: string;
  isNegative: boolean;
  negativeBalance: string;
  version: number;
  withdrawalAllowed: boolean;
}

export interface AgentDashboardTrendSnapshot {
  businessDate: string;
  commissionChange: string;
  netSalesAmount: string;
  paidOrderCount: number;
}

export interface AgentDashboardSnapshot {
  agentId: string;
  asOf: Date;
  attributedCustomerCount: number;
  availableBalance: string;
  commissionExceptionCount: number;
  expectedCommission: string;
  frozenBalance: string;
  monthNetSalesAmount: string;
  negativeBalance: string;
  pendingWithdrawalCount: number;
  todayNetSalesAmount: string;
  todayPaidOrderCount: number;
  trend: AgentDashboardTrendSnapshot[];
  withdrawalActionCount: number;
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
  commissionSnapshotId: string;
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
  category_id: true,
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

const COMMISSION_RULE_FACT_SELECT = {
  effective_at: true,
  entries: {
    orderBy: [{ target_key: 'asc' as const }, { id: 'asc' as const }],
    select: {
      configured_rate: true,
      id: true,
      rule_version_id: true,
      target_id: true,
      target_key: true,
      target_type: true,
    },
  },
  id: true,
  status: true,
  version_no: true,
} satisfies Prisma.CommissionRuleVersionSelect;

const COMMISSION_LEDGER_FACT_SELECT = {
  agent_id: true,
  available_change: true,
  expected_change: true,
  frozen_change: true,
  id: true,
  ledger_type: true,
  occurred_at: true,
  reason: true,
  refund_id: true,
  snapshot_id: true,
  withdrawal_id: true,
} satisfies Prisma.CommissionLedgerSelect;

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
          category_id_snapshot: true,
          created_at: true,
          effective_rate: true,
          id: true,
          ledger: {
            orderBy: [{ occurred_at: 'asc' as const }, { id: 'asc' as const }],
            select: COMMISSION_LEDGER_FACT_SELECT,
          },
          original_commission: true,
          position: {
            select: {
              expected_remaining: true,
              id: true,
              original_commission: true,
              reversed_total: true,
              snapshot_id: true,
              state: true,
              version: true,
            },
          },
          product_id_snapshot: true,
          rule_version: { select: COMMISSION_RULE_FACT_SELECT },
          rule_version_id: true,
          sku_id_snapshot: true,
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

const COMMISSION_SNAPSHOT_FACT_SELECT = {
  agent_id: true,
  category_id_snapshot: true,
  category_name_snapshot: true,
  commission_base: true,
  created_at: true,
  effective_rate: true,
  id: true,
  ledger: {
    orderBy: [{ occurred_at: 'asc' as const }, { id: 'asc' as const }],
    select: COMMISSION_LEDGER_FACT_SELECT,
  },
  order_item: {
    select: {
      category_id: true,
      id: true,
      order: {
        select: {
          attribution_snapshot: { select: { agent_id_snapshot: true } },
          final_agent_id: true,
          final_channel: true,
          id: true,
          order_no: true,
          paid_at: true,
          payment_status: true,
        },
      },
      product_id: true,
      product_name_snapshot: true,
      sku_id: true,
      sku_name_snapshot: true,
    },
  },
  original_commission: true,
  position: {
    select: {
      expected_remaining: true,
      id: true,
      original_commission: true,
      reversed_total: true,
      snapshot_id: true,
      state: true,
      version: true,
    },
  },
  product_id_snapshot: true,
  rule_version: { select: COMMISSION_RULE_FACT_SELECT },
  rule_version_id: true,
  sku_id_snapshot: true,
  source_type: true,
} satisfies Prisma.OrderItemCommissionSnapshotSelect;

const COMMISSION_LEDGER_LIST_SELECT = {
  ...COMMISSION_LEDGER_FACT_SELECT,
  snapshot: { select: COMMISSION_SNAPSHOT_FACT_SELECT },
} satisfies Prisma.CommissionLedgerSelect;

const COMMISSION_DETAIL_SELECT = {
  ...COMMISSION_SNAPSHOT_FACT_SELECT,
  ledger: {
    orderBy: [{ occurred_at: 'asc' as const }, { id: 'asc' as const }],
    select: COMMISSION_LEDGER_FACT_SELECT,
  },
} satisfies Prisma.OrderItemCommissionSnapshotSelect;

const AGENT_WALLET_SELECT = {
  agent_id: true,
  available_balance: true,
  frozen_balance: true,
  id: true,
  version: true,
} satisfies Prisma.AgentWalletSelect;

type AgentRecord = Prisma.AgentProfileGetPayload<{ select: typeof AGENT_SELECT }>;
type CustomerBindingRecord = Prisma.CustomerAgentBindingGetPayload<{ select: typeof CUSTOMER_BINDING_SELECT }>;
type CurrentPeriodOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof CURRENT_PERIOD_ORDER_SELECT }>;
type OrderListRecord = Prisma.SalesOrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;
type OrderDetailRecord = Prisma.SalesOrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;
type CommissionLedgerListRecord = Prisma.CommissionLedgerGetPayload<{
  select: typeof COMMISSION_LEDGER_LIST_SELECT;
}>;
type CommissionDetailRecord = Prisma.OrderItemCommissionSnapshotGetPayload<{
  select: typeof COMMISSION_DETAIL_SELECT;
}>;
type CommissionSnapshotFactRecord = Prisma.OrderItemCommissionSnapshotGetPayload<{
  select: typeof COMMISSION_SNAPSHOT_FACT_SELECT;
}>;
type CommissionLedgerFactRecord = Prisma.CommissionLedgerGetPayload<{
  select: typeof COMMISSION_LEDGER_FACT_SELECT;
}>;

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const AGENT_COMMISSION_LEDGER_TYPES = new Set<AgentCommissionLedgerType>([
  'AVAILABLE_CREDIT',
  'EXPECTED_CANCELLED',
  'EXPECTED_CREATED',
  'EXPECTED_REDUCED',
  'REFUND_DEBIT',
]);
const AGENT_COMMISSION_POSITION_STATES = new Set<AgentCommissionPositionState>([
  'AVAILABLE',
  'CANCELLED',
  'EXPECTED',
  'NONE',
]);

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

function validateCommissionListInput(input: AgentCommissionListInput): void {
  validateIdentity(input);
  validatePage(input.page, input.pageSize);
  validDate(input.occurredAtFrom, 'Agent commission date_from');
  validDate(input.occurredAtToExclusive, 'Agent commission date_to');
  if (input.occurredAtFrom !== undefined && input.occurredAtToExclusive !== undefined &&
    input.occurredAtFrom.getTime() >= input.occurredAtToExclusive.getTime()) {
    throw new TypeError('Agent commission date range is invalid');
  }
  if (input.ledgerType !== undefined && !AGENT_COMMISSION_LEDGER_TYPES.has(input.ledgerType)) {
    throw new TypeError('Agent commission ledger type is invalid');
  }
  if (input.state !== undefined && !AGENT_COMMISSION_POSITION_STATES.has(input.state)) {
    throw new TypeError('Agent commission state is invalid');
  }
  if (input.orderNo !== undefined && (input.orderNo.trim() !== input.orderNo || input.orderNo.length < 1 ||
    input.orderNo.length > 32 || /\p{Cc}/u.test(input.orderNo))) {
    throw new TypeError('Agent commission order number is invalid');
  }
}

function validateCommissionReadInput(input: AgentCommissionReadInput): void {
  validateIdentity(input);
  requireUlid(input.commissionSnapshotId, 'Agent commission snapshot ID');
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

function safeSignedMoney(value: Prisma.Decimal, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || value.decimalPlaces() > 2 || value.abs().greaterThan(MAX_MONEY)) {
    throw internal(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function aggregateDecimal(value: Prisma.Decimal | null | undefined, label: string): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  if (!Prisma.Decimal.isDecimal(value) || value.decimalPlaces() > 2 || value.abs().greaterThan(MAX_MONEY)) {
    throw internal(`${label} is invalid`);
  }
  return value;
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
  const paidAt = safeDate(record.paid_at, 'Stored Agent order paid time');
  return record.items.map((item) => {
    const commission = item.commission_snapshot;
    if (!commission || commission.agent_id !== agentId || !commission.position ||
      commission.rule_version_id !== commission.rule_version.id ||
      commission.category_id_snapshot !== item.category_id || commission.product_id_snapshot !== item.product_id ||
      commission.sku_id_snapshot !== item.sku_id) {
      throw internal('Stored Agent order commission snapshot is invalid');
    }
    requireUlid(commission.id, 'Stored Agent order commission snapshot ID');
    validateCommissionSnapshotRule(commission, paidAt);
    validateCommissionSnapshotLedgerClosure(commission);
    return {
      commissionSnapshotId: commission.id,
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

function commissionOrderWhere(agentId: string, orderNo?: string): Prisma.SalesOrderWhereInput {
  return {
    attribution_snapshot: { is: { agent_id_snapshot: agentId } },
    final_agent_id: agentId,
    final_channel: 'AGENT',
    ...(orderNo === undefined ? {} : { order_no: orderNo }),
    paid_at: { not: null },
    payment_status: 'PAID',
  };
}

function commissionSnapshotWhere(
  agentId: string,
  state?: AgentCommissionPositionState,
  orderNo?: string,
): Prisma.OrderItemCommissionSnapshotWhereInput {
  return {
    agent_id: agentId,
    order_item: { order: commissionOrderWhere(agentId, orderNo) },
    ...(state === undefined ? {} : { position: { is: { state } } }),
  };
}

function commissionLedgerWhere(input: AgentCommissionListInput): Prisma.CommissionLedgerWhereInput {
  return {
    agent_id: input.agentId,
    ...(input.ledgerType === undefined ? {} : { ledger_type: input.ledgerType }),
    ...(input.occurredAtFrom === undefined && input.occurredAtToExclusive === undefined
      ? {}
      : {
          occurred_at: {
            ...(input.occurredAtFrom === undefined ? {} : { gte: input.occurredAtFrom }),
            ...(input.occurredAtToExclusive === undefined ? {} : { lt: input.occurredAtToExclusive }),
          },
        }),
    snapshot: { is: commissionSnapshotWhere(input.agentId, input.state, input.orderNo) },
    withdrawal_id: null,
  };
}

type CommissionSnapshotProjection = Omit<AgentCommissionDetailSnapshot, 'hitPath' | 'ledger'>;

function commissionSnapshot(
  record: CommissionSnapshotFactRecord,
  agentId: string,
): CommissionSnapshotProjection {
  const orderItem = record.order_item;
  const order = orderItem.order;
  const position = record.position;
  requireUlid(record.id, 'Stored Agent commission snapshot ID');
  requireUlid(record.agent_id, 'Stored Agent commission agent ID');
  requireUlid(record.category_id_snapshot, 'Stored Agent commission category ID');
  requireUlid(record.product_id_snapshot, 'Stored Agent commission product ID');
  requireUlid(record.sku_id_snapshot, 'Stored Agent commission SKU ID');
  requireUlid(record.rule_version_id, 'Stored Agent commission rule version ID');
  requireUlid(record.rule_version.id, 'Stored Agent commission related rule version ID');
  requireUlid(orderItem.id, 'Stored Agent commission order item ID');
  requireUlid(order.id, 'Stored Agent commission order ID');
  if (record.agent_id !== agentId || record.rule_version.id !== record.rule_version_id ||
    order.final_agent_id !== agentId || order.final_channel !== 'AGENT' || order.payment_status !== 'PAID' ||
    order.attribution_snapshot?.agent_id_snapshot !== agentId || order.paid_at === null ||
    orderItem.category_id !== record.category_id_snapshot || orderItem.product_id !== record.product_id_snapshot ||
    orderItem.sku_id !== record.sku_id_snapshot || position === null || position.snapshot_id !== record.id ||
    !AGENT_COMMISSION_POSITION_STATES.has(position.state)) {
    throw internal('Stored Agent commission ownership or snapshot facts are inconsistent');
  }
  validateCommissionSnapshotRule(record, order.paid_at);
  validateCommissionSnapshotLedgerClosure(record);
  safeDate(order.paid_at, 'Stored Agent commission order payment time');
  const originalCommission = safeMoney(record.original_commission, 'Stored Agent original commission');
  const positionOriginal = safeMoney(position.original_commission, 'Stored Agent position original commission');
  const expectedRemaining = safeMoney(position.expected_remaining, 'Stored Agent expected commission');
  const reversalTotal = safeMoney(position.reversed_total, 'Stored Agent reversed commission');
  safeCount(position.version, 'Stored Agent commission position version', 1);
  const accounted = position.expected_remaining.add(position.reversed_total);
  if (positionOriginal !== originalCommission || accounted.greaterThan(record.original_commission) ||
    (position.state === 'NONE' && (!record.original_commission.isZero() || !accounted.isZero())) ||
    (position.state === 'EXPECTED' && (position.expected_remaining.isZero() || !accounted.equals(record.original_commission))) ||
    (position.state === 'CANCELLED' && (!position.expected_remaining.isZero() ||
      !position.reversed_total.equals(record.original_commission))) ||
    (position.state === 'AVAILABLE' && !position.expected_remaining.isZero())) {
    throw internal('Stored Agent commission position amounts are inconsistent');
  }
  return {
    categoryId: record.category_id_snapshot,
    categoryName: safeText(record.category_name_snapshot, 120, 'Stored Agent commission category name'),
    commissionBase: safeMoney(record.commission_base, 'Stored Agent commission base'),
    commissionSnapshotId: record.id,
    effectiveRate: safeRate(record.effective_rate),
    expectedRemaining,
    orderId: order.id,
    orderItemId: orderItem.id,
    orderNo: safeText(order.order_no, 32, 'Stored Agent commission order number'),
    originalCommission,
    positionState: position.state,
    productId: record.product_id_snapshot,
    productName: safeText(orderItem.product_name_snapshot, 200, 'Stored Agent commission product name'),
    reversalTotal,
    ruleSource: record.source_type,
    ruleVersionId: record.rule_version_id,
    ruleVersionNo: safeCount(record.rule_version.version_no, 'Stored Agent commission rule version number', 1),
    skuId: record.sku_id_snapshot,
    skuName: safeText(orderItem.sku_name_snapshot, 160, 'Stored Agent commission SKU name'),
  };
}

function commissionLedger(
  record: CommissionLedgerFactRecord,
  agentId: string,
  snapshotId: string,
): AgentCommissionExplanationLedgerSnapshot {
  requireUlid(record.id, 'Stored Agent commission ledger ID');
  if (record.snapshot_id === null) throw internal('Stored Agent commission ledger snapshot is missing');
  requireUlid(record.snapshot_id, 'Stored Agent commission ledger snapshot ID');
  if (record.refund_id !== null) requireUlid(record.refund_id, 'Stored Agent commission ledger refund ID');
  const expected = aggregateDecimal(record.expected_change, 'Stored Agent expected ledger change');
  const available = aggregateDecimal(record.available_change, 'Stored Agent available ledger change');
  const frozen = aggregateDecimal(record.frozen_change, 'Stored Agent frozen ledger change');
  if (record.agent_id !== agentId || record.snapshot_id !== snapshotId || record.withdrawal_id !== null ||
    !AGENT_COMMISSION_LEDGER_TYPES.has(record.ledger_type as AgentCommissionLedgerType) || !frozen.isZero()) {
    throw internal('Stored Agent commission ledger ownership or reference shape is inconsistent');
  }
  const positiveExpected = expected.isPositive() && available.isZero() && record.refund_id === null;
  const reducedExpected = expected.isNegative() && available.isZero() && record.refund_id !== null;
  const availableCredit = expected.isNegative() && available.isPositive() &&
    expected.add(available).isZero() && record.refund_id === null;
  const refundDebit = expected.isZero() && available.isNegative() && record.refund_id !== null;
  if ((record.ledger_type === 'EXPECTED_CREATED' && !positiveExpected) ||
    ((record.ledger_type === 'EXPECTED_REDUCED' || record.ledger_type === 'EXPECTED_CANCELLED') && !reducedExpected) ||
    (record.ledger_type === 'AVAILABLE_CREDIT' && !availableCredit) ||
    (record.ledger_type === 'REFUND_DEBIT' && !refundDebit)) {
    throw internal('Stored Agent commission ledger amount shape is inconsistent');
  }
  return {
    availableChange: safeSignedMoney(available, 'Stored Agent available ledger change'),
    expectedChange: safeSignedMoney(expected, 'Stored Agent expected ledger change'),
    frozenChange: safeSignedMoney(frozen, 'Stored Agent frozen ledger change'),
    ledgerId: record.id,
    ledgerType: record.ledger_type as AgentCommissionLedgerType,
    occurredAt: safeDate(record.occurred_at, 'Stored Agent commission ledger time'),
    reason: safeText(record.reason, 500, 'Stored Agent commission ledger reason'),
    refundId: record.refund_id,
  };
}

function commissionListItem(record: CommissionLedgerListRecord, agentId: string): AgentCommissionLedgerSnapshot {
  if (record.snapshot === null) throw internal('Stored Agent commission list snapshot is missing');
  const snapshot = commissionSnapshot(record.snapshot, agentId);
  const ledger = commissionLedger(record, agentId, snapshot.commissionSnapshotId);
  return {
    ...snapshot,
    availableChange: ledger.availableChange,
    expectedChange: ledger.expectedChange,
    ledgerId: ledger.ledgerId,
    ledgerType: ledger.ledgerType,
    occurredAt: ledger.occurredAt,
    reason: ledger.reason,
    refundId: ledger.refundId,
  };
}

function commissionHitPath(snapshot: CommissionSnapshotProjection): string[] {
  const path = [`RULE_VERSION:${snapshot.ruleVersionId}`, 'PLATFORM'];
  if (snapshot.ruleSource === 'CATEGORY' || snapshot.ruleSource === 'SKU') {
    path.push(`CATEGORY:${snapshot.categoryId}`);
  }
  if (snapshot.ruleSource === 'SKU') path.push(`SKU:${snapshot.skuId}`);
  return path;
}

function commissionDetail(record: CommissionDetailRecord, agentId: string): AgentCommissionDetailSnapshot {
  const snapshot = commissionSnapshot(record, agentId);
  return {
    ...snapshot,
    hitPath: commissionHitPath(snapshot),
    ledger: record.ledger.map((entry) => commissionLedger(entry, agentId, snapshot.commissionSnapshotId)),
  };
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

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    return safeDate(rows[0]?.transaction_time ?? null, 'Agent dashboard database transaction clock');
  }

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

  private async reconciledWallet(
    transaction: DatabaseTransaction,
    agentId: string,
  ): Promise<AgentWalletSnapshot> {
    await validateAgentCommissionLedgerClosureInTransaction(transaction, agentId);
    const [wallet, ledger, positions] = await Promise.all([
      transaction.agentWallet.findUnique({ select: AGENT_WALLET_SELECT, where: { agent_id: agentId } }),
      transaction.commissionLedger.aggregate({
        _sum: { available_change: true, expected_change: true, frozen_change: true },
        where: { agent_id: agentId },
      }),
      transaction.orderItemCommissionPosition.aggregate({
        _sum: { expected_remaining: true },
        where: { snapshot: { agent_id: agentId } },
      }),
    ]);
    if (wallet === null) throw internal('Stored Agent wallet is missing');
    requireUlid(wallet.id, 'Stored Agent wallet ID');
    if (wallet.agent_id !== agentId) throw internal('Stored Agent wallet ownership is inconsistent');
    const available = aggregateDecimal(wallet.available_balance, 'Stored Agent wallet available balance');
    const frozen = aggregateDecimal(wallet.frozen_balance, 'Stored Agent wallet frozen balance');
    const ledgerAvailable = aggregateDecimal(ledger._sum.available_change, 'Stored Agent ledger available balance');
    const ledgerFrozen = aggregateDecimal(ledger._sum.frozen_change, 'Stored Agent ledger frozen balance');
    const ledgerExpected = aggregateDecimal(ledger._sum.expected_change, 'Stored Agent ledger expected balance');
    const positionExpected = aggregateDecimal(
      positions._sum.expected_remaining,
      'Stored Agent position expected balance',
    );
    if (frozen.isNegative() || ledgerExpected.isNegative() || positionExpected.isNegative() ||
      !available.equals(ledgerAvailable) || !frozen.equals(ledgerFrozen) ||
      !ledgerExpected.equals(positionExpected)) {
      throw internal('Stored Agent wallet and commission ledger do not reconcile');
    }
    const isNegative = available.isNegative();
    const withdrawalAllowed = available.greaterThan(0);
    return {
      availableBalance: safeSignedMoney(available, 'Stored Agent wallet available balance'),
      blockedReason: isNegative ? 'NEGATIVE_BALANCE' : withdrawalAllowed ? null : 'INSUFFICIENT_BALANCE',
      expectedCommission: safeMoney(ledgerExpected, 'Stored Agent expected commission'),
      frozenBalance: safeMoney(frozen, 'Stored Agent wallet frozen balance'),
      isNegative,
      negativeBalance: safeMoney(isNegative ? available.abs() : new Prisma.Decimal(0), 'Stored Agent negative balance'),
      version: safeCount(wallet.version, 'Stored Agent wallet version', 1),
      withdrawalAllowed,
    };
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

  async listCommissions(input: AgentCommissionListInput): Promise<AgentCommissionListResult> {
    validateCommissionListInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const where = commissionLedgerWhere(input);
      const [items, total] = await Promise.all([
        transaction.commissionLedger.findMany({
          orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
          select: COMMISSION_LEDGER_LIST_SELECT,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.commissionLedger.count({ where }),
      ]);
      return {
        items: items.map((item) => commissionListItem(item, input.agentId)),
        total: safeCount(total, 'Stored Agent commission total'),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getCommission(input: AgentCommissionReadInput): Promise<AgentCommissionDetailSnapshot> {
    validateCommissionReadInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const snapshot = await transaction.orderItemCommissionSnapshot.findFirst({
        select: COMMISSION_DETAIL_SELECT,
        where: {
          ...commissionSnapshotWhere(input.agentId),
          id: input.commissionSnapshotId,
        },
      });
      if (snapshot === null) throw notFound('Agent commission does not exist');
      return commissionDetail(snapshot, input.agentId);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getWallet(input: AgentOperationsIdentity): Promise<AgentWalletSnapshot> {
    validateIdentity(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      return this.reconciledWallet(transaction, input.agentId);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getDashboard(input: AgentOperationsIdentity): Promise<AgentDashboardSnapshot> {
    validateIdentity(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.requireActiveAgent(transaction, input);
      const asOf = await this.transactionTime(transaction);
      const businessDate = new Date(asOf.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
      const localMidnight = Date.parse(`${businessDate}T00:00:00.000Z`);
      const todayStart = new Date(localMidnight - SHANGHAI_OFFSET_MS);
      const monthStart = new Date(Date.parse(`${businessDate.slice(0, 7)}-01T00:00:00.000Z`) - SHANGHAI_OFFSET_MS);
      const trendStart = new Date(todayStart.getTime() - 6 * DAY_MS);
      const dataStart = monthStart.getTime() < trendStart.getTime() ? monthStart : trendStart;
      const ownedSnapshot = commissionSnapshotWhere(input.agentId);
      const [
        wallet,
        paidOrders,
        refunds,
        trendLedgers,
        attributedCustomerCount,
        pendingWithdrawalCount,
        commissionExceptionCount,
      ] = await Promise.all([
        this.reconciledWallet(transaction, input.agentId),
        transaction.salesOrder.findMany({
          orderBy: [{ paid_at: 'asc' }, { id: 'asc' }],
          select: { id: true, paid_amount: true, paid_at: true },
          where: {
            ...commissionOrderWhere(input.agentId),
            paid_at: { gte: dataStart, lte: asOf },
          },
        }),
        transaction.refund.findMany({
          orderBy: [{ succeeded_at: 'asc' }, { id: 'asc' }],
          select: { amount: true, id: true, succeeded_at: true },
          where: {
            order: commissionOrderWhere(input.agentId),
            status: 'SUCCEEDED',
            succeeded_at: { gte: dataStart, lte: asOf },
          },
        }),
        transaction.commissionLedger.findMany({
          orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
          select: COMMISSION_LEDGER_FACT_SELECT,
          where: {
            agent_id: input.agentId,
            occurred_at: { gte: trendStart, lte: asOf },
            snapshot: { is: ownedSnapshot },
            withdrawal_id: null,
          },
        }),
        transaction.customerAgentBinding.count({ where: currentCustomerWhere({ agentId: input.agentId }) }),
        transaction.withdrawal.count({
          where: { agent_id: input.agentId, status: { in: ['APPROVED', 'PENDING'] } },
        }),
        transaction.salesOrder.count({
          where: {
            attribution_candidate: {
              is: { candidate_agent_id: input.agentId, submit_channel: 'AGENT' },
            },
            paid_at: { not: null },
            payment_resolution: 'MANUAL_REQUIRED',
            payment_status: 'PAID',
          },
        }),
      ]);

      type TrendAccumulator = {
        commission: Prisma.Decimal;
        orders: number;
        refunds: Prisma.Decimal;
        sales: Prisma.Decimal;
      };
      const trend = new Map<string, TrendAccumulator>();
      for (let offset = 0; offset < 7; offset += 1) {
        const date = new Date(trendStart.getTime() + offset * DAY_MS);
        const key = new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
        trend.set(key, {
          commission: new Prisma.Decimal(0),
          orders: 0,
          refunds: new Prisma.Decimal(0),
          sales: new Prisma.Decimal(0),
        });
      }
      let todaySales = new Prisma.Decimal(0);
      let monthSales = new Prisma.Decimal(0);
      let todayRefunds = new Prisma.Decimal(0);
      let monthRefunds = new Prisma.Decimal(0);
      let todayPaidOrderCount = 0;
      for (const order of paidOrders) {
        requireUlid(order.id, 'Stored Agent dashboard order ID');
        const paidAt = safeDate(order.paid_at, 'Stored Agent dashboard order payment time');
        safeMoney(order.paid_amount, 'Stored Agent dashboard paid amount');
        if (paidAt.getTime() >= monthStart.getTime()) monthSales = monthSales.add(order.paid_amount);
        if (paidAt.getTime() >= todayStart.getTime()) {
          todaySales = todaySales.add(order.paid_amount);
          todayPaidOrderCount += 1;
        }
        const key = new Date(paidAt.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
        const point = trend.get(key);
        if (point !== undefined) {
          point.sales = point.sales.add(order.paid_amount);
          point.orders += 1;
        }
      }
      for (const refund of refunds) {
        requireUlid(refund.id, 'Stored Agent dashboard refund ID');
        const succeededAt = safeDate(refund.succeeded_at, 'Stored Agent dashboard refund success time');
        safeMoney(refund.amount, 'Stored Agent dashboard refund amount');
        if (succeededAt.getTime() >= monthStart.getTime()) monthRefunds = monthRefunds.add(refund.amount);
        if (succeededAt.getTime() >= todayStart.getTime()) todayRefunds = todayRefunds.add(refund.amount);
        const key = new Date(succeededAt.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
        const point = trend.get(key);
        if (point !== undefined) point.refunds = point.refunds.add(refund.amount);
      }
      for (const ledgerRecord of trendLedgers) {
        if (ledgerRecord.snapshot_id === null) throw internal('Stored dashboard commission snapshot is missing');
        const ledger = commissionLedger(ledgerRecord, input.agentId, ledgerRecord.snapshot_id);
        const key = new Date(ledger.occurredAt.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
        const point = trend.get(key);
        if (point !== undefined) {
          point.commission = point.commission
            .add(new Prisma.Decimal(ledger.expectedChange))
            .add(new Prisma.Decimal(ledger.availableChange));
        }
      }
      return {
        agentId: input.agentId,
        asOf,
        attributedCustomerCount: safeCount(attributedCustomerCount, 'Stored Agent attributed customer count'),
        availableBalance: wallet.availableBalance,
        commissionExceptionCount: safeCount(commissionExceptionCount, 'Stored Agent commission exception count'),
        expectedCommission: wallet.expectedCommission,
        frozenBalance: wallet.frozenBalance,
        monthNetSalesAmount: safeSignedMoney(
          monthSales.minus(monthRefunds),
          'Stored Agent monthly net sales amount',
        ),
        negativeBalance: wallet.negativeBalance,
        pendingWithdrawalCount: safeCount(pendingWithdrawalCount, 'Stored Agent pending withdrawal count'),
        todayNetSalesAmount: safeSignedMoney(
          todaySales.minus(todayRefunds),
          'Stored Agent daily net sales amount',
        ),
        todayPaidOrderCount: safeCount(todayPaidOrderCount, 'Stored Agent daily paid order count'),
        trend: [...trend.entries()].map(([date, point]) => ({
          businessDate: date,
          commissionChange: safeSignedMoney(point.commission, 'Stored Agent daily commission change'),
          netSalesAmount: safeSignedMoney(point.sales.minus(point.refunds), 'Stored Agent daily net sales amount'),
          paidOrderCount: safeCount(point.orders, 'Stored Agent daily paid order count'),
        })),
        withdrawalActionCount: 0,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
