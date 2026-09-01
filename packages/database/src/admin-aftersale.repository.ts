import { createHmac } from 'node:crypto';

import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { AftersaleStatus, AftersaleType } from '../.generated/prisma/enums';
import {
  FulfillmentRepository,
  type AdminFulfillmentOrderDetail,
  type FulfillmentCommissionImpactProjection,
  type FulfillmentInventoryImpactProjection,
} from './fulfillment.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const CUSTOMER_ALIAS_DOMAIN = 'qingxu:admin-aftersale-customer-alias:v1\0';
const AFTERSALE_STATUSES = new Set<AftersaleStatus>([
  'CANCELLED', 'COMPLETED', 'PENDING_REVIEW', 'REFUND_FAILED', 'REFUNDING',
  'REFUNDING_AFTER_RETURN', 'REJECTED', 'REJECTED_AFTER_RETURN', 'RETURN_EXCEPTION',
  'WAITING_RECEIPT', 'WAITING_RETURN',
]);
const CUSTOMER_AFTERSALE_TYPES = new Set<AftersaleType>(['REFUND_ONLY', 'RETURN_REFUND']);

export interface AdminAftersaleListInput {
  aftersaleNo?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  customerId?: string;
  orderId?: string;
  page: number;
  pageSize: number;
  status?: AftersaleStatus;
  type?: 'REFUND_ONLY' | 'RETURN_REFUND';
}

export interface AdminAftersaleListItemSnapshot {
  aftersaleId: string;
  aftersaleNo: string;
  agentId: string | null;
  createdAt: Date;
  customerAlias: string;
  customerId: string;
  orderId: string;
  requestedAmount: string;
  status: AftersaleStatus;
  type: 'REFUND_ONLY' | 'RETURN_REFUND';
  version: number;
}

export interface AdminAftersaleListResult {
  items: AdminAftersaleListItemSnapshot[];
  total: number;
}

export interface AdminAftersaleReadInput {
  aftersaleId: string;
}

export interface AdminAftersaleItemSnapshot {
  aftersaleItemId: string;
  allocatedAmount: string;
  approvedRefundQuantity: number | null;
  orderItemId: string;
  productName: string;
  refundedQuantity: number;
  requestedQuantity: number;
  reservedAmount: string;
  reservedQuantity: number;
  skuId: string;
  skuName: string;
}

export interface AdminAftersaleReturnAddressMaterial {
  city: string;
  detailCiphertext: Uint8Array;
  district: string;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
  province: string;
  recipientName: string;
  snapshotId: string;
  sourceVersionId: string;
  sourceVersionNo: number;
}

export interface AdminAftersaleTimelineFact {
  action: string;
  actorRole: 'AGENT_ADMIN' | 'CUSTOMER' | 'SUPER_ADMIN' | null;
  auditId: string;
  fromStatus: AftersaleStatus | null;
  occurredAt: Date;
  toStatus: AftersaleStatus;
  version: number;
}

export type AdminAftersaleAvailableAction =
  | 'APPROVE'
  | 'CONTINUE_REFUND'
  | 'CREATE_REFUND'
  | 'RECORD_INSPECTION'
  | 'REJECT'
  | 'REJECT_AFTER_RETURN'
  | 'RETRY_REFUND'
  | 'VIEW_ORDER';

export interface AdminAftersaleRefundAttemptSnapshot {
  amount: string;
  attemptNo: number;
  failureCode: string | null;
  finishedAt: Date | null;
  refundId: string;
  refundNo: string;
  requestedAt: Date;
  status: 'FAILED' | 'INITIATED' | 'PROCESSING' | 'SUCCEEDED';
}

export interface AdminAftersaleDetailSnapshot {
  aftersaleId: string;
  aftersaleNo: string;
  applicationEvidenceFileIds: string[];
  availableActions: AdminAftersaleAvailableAction[];
  commissionImpact: FulfillmentCommissionImpactProjection[];
  completedAt: Date | null;
  createdAt: Date;
  inspection: null | {
    abnormalReason: string | null;
    evidenceFileIds: string[];
    inspectedAt: Date;
    inspectionId: string;
    inspectedBy: {
      accountId: string;
      displayName: '总部管理员';
    };
    items: Array<{
      approvedRefundQuantity: number;
      damagedQuantity: number;
      note: string | null;
      orderItemId: string;
      receivedQuantity: number;
      restockQuantity: number;
      returnToCustomerQuantity: number;
      scrapQuantity: number;
    }>;
    resolution: 'CONTINUE_REFUND' | 'REJECT_AFTER_RETURN' | null;
    resolutionReason: string | null;
    resolvedAt: Date | null;
    result: 'ABNORMAL' | 'PASS';
  };
  inventoryImpact: FulfillmentInventoryImpactProjection[];
  items: AdminAftersaleItemSnapshot[];
  orderDetail: AdminFulfillmentOrderDetail;
  orderId: string;
  reasonCode: string;
  reasonText: string | null;
  refundAttempts: AdminAftersaleRefundAttemptSnapshot[];
  returnAddress: AdminAftersaleReturnAddressMaterial | null;
  returnShipment: null | {
    carrierCode: string;
    carrierName: string;
    shipmentId: string;
    submittedAt: Date;
    trackingNo: string;
  };
  reviewedAt: Date | null;
  reviewedById: string | null;
  reviewReason: string | null;
  status: AftersaleStatus;
  timeline: AdminAftersaleTimelineFact[];
  type: 'REFUND_ONLY' | 'RETURN_REFUND';
  updatedAt: Date;
  version: number;
}

export interface AdminAftersaleAuditState {
  status: AftersaleStatus;
  version: number;
}

export interface AdminAftersaleCommandItemSnapshot {
  aftersaleItemId: string;
  allocatedAmount: string;
  approvedRefundQuantity: number | null;
  orderItemId: string;
  quantity: number;
  reservedAmount: string;
  reservedQuantity: number;
}

export interface AdminAftersaleCommandSnapshot {
  aftersaleId: string;
  aftersaleNo: string;
  inspection: AdminAftersaleDetailSnapshot['inspection'];
  items: AdminAftersaleCommandItemSnapshot[];
  orderId: string;
  refundId: string | null;
  status: AftersaleStatus;
  type: 'REFUND_ONLY' | 'RETURN_REFUND';
  version: number;
}

export interface AdminAftersaleApproveInput {
  actorAccountId: string;
  aftersaleId: string;
  expectedVersion: number;
  note?: string | null;
}

export interface AdminAftersaleSourceAddressMaterial {
  city: string;
  detailCiphertext: Uint8Array;
  district: string;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
  province: string;
  recipientName: string;
  sourceVersionId: string;
  sourceVersionNo: number;
}

export interface AdminAftersaleSnapshotProtectedMaterial {
  detailCiphertext: Uint8Array;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
}

export interface AdminAftersaleApproveHooks {
  protectReturnAddress(input: {
    snapshotId: string;
    source: AdminAftersaleSourceAddressMaterial;
  }): AdminAftersaleSnapshotProtectedMaterial | Promise<AdminAftersaleSnapshotProtectedMaterial>;
}

export interface AdminAftersaleRejectImpactItem {
  aftersaleItemId: string;
  orderItemId: string;
  releaseAmount: string;
  releaseQuantity: number;
}

export interface AdminAftersaleRejectImpactSnapshot {
  aftersaleId: string;
  affectedCount: number;
  items: AdminAftersaleRejectImpactItem[];
  orderId: string;
  releaseAmount: string;
  releaseQuantity: number;
  resourceVersion: number;
}

export interface AdminAftersaleRejectInput {
  actorAccountId: string;
  aftersaleId: string;
  expectedVersion: number;
  reason: string;
}

export interface AdminAftersaleRejectHooks {
  verifyPreview(snapshot: AdminAftersaleRejectImpactSnapshot): Promise<void> | void;
}

export interface AdminAftersaleCommandResult {
  aftersale: AdminAftersaleCommandSnapshot;
  audit: { after: AdminAftersaleAuditState; before: AdminAftersaleAuditState };
}

const LIST_INCLUDE = {
  items: { select: { requested_amount: true } },
  order: {
    select: {
      attribution_snapshot: {
        select: { privacy_projection: { select: { customer_alias: true } } },
      },
      final_agent_id: true,
    },
  },
} satisfies Prisma.AftersaleInclude;

const DETAIL_INCLUDE = {
  evidence: {
    orderBy: [{ file_id: 'asc' as const }],
    select: { file_id: true, purpose: true, return_inspection_id: true },
  },
  items: {
    orderBy: [{ order_item_id: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      order_item: {
        select: { product_name_snapshot: true, sku_id: true, sku_name_snapshot: true },
      },
      order_item_id: true,
      refunded_amount: true,
      refunded_qty: true,
      requested_amount: true,
      requested_qty: true,
      reserved_amount: true,
      reserved_qty: true,
    },
  },
  refunds: {
    orderBy: [{ requested_at: 'asc' as const }, { id: 'asc' as const }],
    select: {
      amount: true,
      attempts: {
        orderBy: [{ attempt_no: 'asc' as const }, { id: 'asc' as const }],
        select: {
          attempt_no: true,
          failure_code: true,
          finished_at: true,
          requested_at: true,
          status: true,
        },
      },
      id: true,
      refund_no: true,
    },
  },
  return_address: {
    select: {
      city: true,
      detail_ciphertext: true,
      district: true,
      encryption_key_id: true,
      id: true,
      phone_ciphertext: true,
      phone_last4: true,
      province: true,
      recipient_name: true,
      source_version: { select: { id: true, version_no: true } },
    },
  },
  return_inspection: {
    select: {
      abnormal_reason: true,
      evidence: {
        orderBy: [{ file_id: 'asc' as const }],
        select: { file_id: true },
      },
      id: true,
      inspected_at: true,
      inspected_by: { select: { id: true, role: true } },
      items: {
        orderBy: [{ order_item_id: 'asc' as const }, { id: 'asc' as const }],
        select: {
          approved_refund_qty: true,
          damaged_qty: true,
          note: true,
          order_item_id: true,
          received_qty: true,
          restock_qty: true,
          return_to_customer_qty: true,
          scrap_qty: true,
        },
      },
      resolution: true,
      resolution_note: true,
      resolved_at: true,
      status: true,
    },
  },
  return_shipment: {
    select: {
      carrier_code: true,
      carrier_name: true,
      id: true,
      submitted_at: true,
      tracking_no: true,
    },
  },
} satisfies Prisma.AftersaleInclude;

type ListRecord = Prisma.AftersaleGetPayload<{ include: typeof LIST_INCLUDE }>;
type DetailRecord = Prisma.AftersaleGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Aftersale was not found');
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Aftersale version changed');
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active SUPER_ADMIN account is required');
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!plainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function safeUlid(value: unknown, label: string): string {
  if (!isValidUlid(value)) throw internal(`${label} is invalid`);
  return value;
}

function requireVersion(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} must be a positive PostgreSQL integer`);
  }
}

function safeVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value as number;
}

function safeCounter(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value as number;
}

function safeDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function nullableDate(value: unknown, label: string): Date | null {
  return value === null ? null : safeDate(value, label);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || point === 0x7f);
  });
}

function safeText(value: unknown, maximum: number, label: string): string {
  const characters = typeof value === 'string' ? Array.from(value) : [];
  if (typeof value !== 'string' || characters.length < 1 || characters.length > maximum ||
    hasControlCharacters(value)) throw internal(`${label} is invalid`);
  return value;
}

function safePhoneLast4(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9+ -]{4}$/.test(value)) throw internal(`${label} is invalid`);
  return value;
}

function inspectionOperatorDisplayName(role: unknown): '总部管理员' {
  if (role !== 'SUPER_ADMIN') throw internal('Stored inspection operator role is invalid');
  return '总部管理员';
}

function safeMoney(value: unknown, label: string, positive = false): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || (positive && !value.greaterThan(0)) ||
    value.decimalPlaces() > 2 || value.greaterThan(MAX_MONEY)) throw internal(`${label} is invalid`);
  return value.toFixed(2);
}

function normalizeReason(value: unknown, optional: boolean): string | null {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string') throw new TypeError('Aftersale review reason must be a string');
  const normalized = value.trim();
  const minimum = optional ? 1 : 2;
  if (Array.from(normalized).length < minimum || Array.from(normalized).length > 500 ||
    hasControlCharacters(normalized)) {
    throw new TypeError(`Aftersale review reason must contain ${minimum} to 500 characters without controls`);
  }
  return normalized;
}

function validateList(input: AdminAftersaleListInput): void {
  exactObject(input, [
    'aftersaleNo', 'createdAtFrom', 'createdAtToExclusive', 'customerId', 'orderId',
    'page', 'pageSize', 'status', 'type',
  ], ['page', 'pageSize'], 'Admin aftersale list input');
  if (!Number.isSafeInteger(input.page) || input.page < 1 ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Admin aftersale pagination is invalid');
  }
  if (input.aftersaleNo !== undefined && (typeof input.aftersaleNo !== 'string' ||
    Array.from(input.aftersaleNo.trim()).length < 1 || Array.from(input.aftersaleNo.trim()).length > 32)) {
    throw new TypeError('Admin aftersale number filter is invalid');
  }
  if (input.customerId !== undefined) requireUlid(input.customerId, 'Admin aftersale Customer ID');
  if (input.orderId !== undefined) requireUlid(input.orderId, 'Admin aftersale Order ID');
  if (input.status !== undefined && !AFTERSALE_STATUSES.has(input.status)) {
    throw new TypeError('Admin aftersale status filter is invalid');
  }
  if (input.type !== undefined && !CUSTOMER_AFTERSALE_TYPES.has(input.type)) {
    throw new TypeError('Admin aftersale type filter is invalid');
  }
  for (const [label, value] of [
    ['start', input.createdAtFrom], ['end', input.createdAtToExclusive],
  ] as const) {
    if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
      throw new TypeError(`Admin aftersale ${label} date is invalid`);
    }
  }
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Admin aftersale date range is invalid');
  }
}

function validateRead(input: AdminAftersaleReadInput): void {
  exactObject(input, ['aftersaleId'], ['aftersaleId'], 'Admin aftersale read input');
  requireUlid(input.aftersaleId, 'Admin aftersale ID');
}

function validateApprove(input: AdminAftersaleApproveInput): AdminAftersaleApproveInput & { note: string | null } {
  exactObject(
    input,
    ['actorAccountId', 'aftersaleId', 'expectedVersion', 'note'],
    ['actorAccountId', 'aftersaleId', 'expectedVersion'],
    'Admin aftersale approve input',
  );
  requireUlid(input.actorAccountId, 'Admin aftersale actor ID');
  requireUlid(input.aftersaleId, 'Admin aftersale ID');
  requireVersion(input.expectedVersion, 'Admin aftersale expected version');
  return { ...input, note: normalizeReason(input.note, true) };
}

function validateReject(input: AdminAftersaleRejectInput): AdminAftersaleRejectInput {
  exactObject(
    input,
    ['actorAccountId', 'aftersaleId', 'expectedVersion', 'reason'],
    ['actorAccountId', 'aftersaleId', 'expectedVersion', 'reason'],
    'Admin aftersale reject input',
  );
  requireUlid(input.actorAccountId, 'Admin aftersale actor ID');
  requireUlid(input.aftersaleId, 'Admin aftersale ID');
  requireVersion(input.expectedVersion, 'Admin aftersale expected version');
  return { ...input, reason: normalizeReason(input.reason, false)! };
}

function typeOf(value: AftersaleType): 'REFUND_ONLY' | 'RETURN_REFUND' {
  if (!CUSTOMER_AFTERSALE_TYPES.has(value)) throw internal('Stored aftersale type is invalid');
  return value as 'REFUND_ONLY' | 'RETURN_REFUND';
}

function statusOf(value: AftersaleStatus): AftersaleStatus {
  if (!AFTERSALE_STATUSES.has(value)) throw internal('Stored aftersale status is invalid');
  return value;
}

function alias(record: ListRecord, key: Uint8Array): string {
  const stored = record.order.attribution_snapshot?.privacy_projection?.customer_alias;
  if (stored !== undefined && stored !== null) return safeText(stored, 80, 'Stored customer alias');
  const customerId = safeUlid(record.customer_id, 'Stored Customer ID');
  const digest = createHmac('sha256', key).update(CUSTOMER_ALIAS_DOMAIN).update(customerId).digest('hex');
  return `customer_${digest.slice(0, 26)}`;
}

function requestedAmount(record: Pick<ListRecord, 'items'>): string {
  const total = record.items.reduce((sum, item) => sum.plus(item.requested_amount), new Prisma.Decimal(0));
  if (!total.greaterThan(0) || total.greaterThan(MAX_MONEY)) throw internal('Stored aftersale amount is invalid');
  return total.toFixed(2);
}

function auditState(status: AftersaleStatus, version: number): AdminAftersaleAuditState {
  return { status: statusOf(status), version: safeVersion(version, 'Stored aftersale version') };
}

function inspectionSnapshot(
  inspection: DetailRecord['return_inspection'],
): AdminAftersaleDetailSnapshot['inspection'] {
  if (inspection === null) return null;
  const itemIds = inspection.items.map(({ order_item_id }) =>
    safeUlid(order_item_id, 'Stored inspection Order Item ID'));
  if (new Set(itemIds).size !== itemIds.length) {
    throw internal('Stored aftersale inspection items are duplicated');
  }
  return {
    abnormalReason: inspection.abnormal_reason,
    evidenceFileIds: inspection.evidence.map(({ file_id }) =>
      safeUlid(file_id, 'Stored inspection evidence ID')),
    inspectedAt: safeDate(inspection.inspected_at, 'Stored inspection time'),
    inspectedBy: {
      accountId: safeUlid(inspection.inspected_by.id, 'Stored inspection operator ID'),
      displayName: inspectionOperatorDisplayName(inspection.inspected_by.role),
    },
    inspectionId: safeUlid(inspection.id, 'Stored inspection ID'),
    items: inspection.items.map((item) => ({
      approvedRefundQuantity: safeCounter(item.approved_refund_qty, 'Stored inspection approved refund'),
      damagedQuantity: safeCounter(item.damaged_qty, 'Stored inspection damaged quantity'),
      note: item.note === null ? null : safeText(item.note, 500, 'Stored inspection note'),
      orderItemId: safeUlid(item.order_item_id, 'Stored inspection Order Item ID'),
      receivedQuantity: safeCounter(item.received_qty, 'Stored inspection received quantity'),
      restockQuantity: safeCounter(item.restock_qty, 'Stored inspection restock quantity'),
      returnToCustomerQuantity: safeCounter(
        item.return_to_customer_qty,
        'Stored inspection return-to-customer quantity',
      ),
      scrapQuantity: safeCounter(item.scrap_qty, 'Stored inspection scrap quantity'),
    })),
    resolution: inspection.resolution,
    resolutionReason: inspection.resolution_note,
    resolvedAt: nullableDate(inspection.resolved_at, 'Stored resolution time'),
    result: inspection.status,
  };
}

function commandSnapshot(record: DetailRecord): AdminAftersaleCommandSnapshot {
  const refundIds = record.refunds.map(({ id }) => safeUlid(id, 'Stored aftersale Refund ID'));
  if (refundIds.length > 1) throw internal('Stored aftersale has multiple refund lifecycles');
  const inspection = inspectionSnapshot(record.return_inspection);
  const inspectedItems = new Map(inspection?.items.map((item) => [item.orderItemId, item]) ?? []);
  return {
    aftersaleId: safeUlid(record.id, 'Stored aftersale ID'),
    aftersaleNo: safeText(record.aftersale_no, 32, 'Stored aftersale number'),
    inspection,
    items: record.items.map((item) => ({
      aftersaleItemId: safeUlid(item.id, 'Stored aftersale item ID'),
      allocatedAmount: safeMoney(item.requested_amount, 'Stored aftersale requested amount', true),
      approvedRefundQuantity: inspectedItems.get(item.order_item_id)?.approvedRefundQuantity ?? null,
      orderItemId: safeUlid(item.order_item_id, 'Stored Order Item ID'),
      quantity: safeCounter(item.requested_qty, 'Stored requested quantity'),
      reservedAmount: safeMoney(item.reserved_amount, 'Stored aftersale reserved amount', true),
      reservedQuantity: safeCounter(item.reserved_qty, 'Stored reserved quantity'),
    })),
    orderId: safeUlid(record.order_id, 'Stored aftersale Order ID'),
    refundId: refundIds[0] ?? null,
    status: statusOf(record.status),
    type: typeOf(record.type),
    version: safeVersion(record.version, 'Stored aftersale version'),
  };
}

function availableActions(record: DetailRecord): AdminAftersaleAvailableAction[] {
  const actions: AdminAftersaleAvailableAction[] = [];
  if (record.status === 'PENDING_REVIEW') actions.push('APPROVE', 'REJECT');
  if (record.status === 'WAITING_RECEIPT' && record.return_inspection === null) actions.push('RECORD_INSPECTION');
  if (record.status === 'RETURN_EXCEPTION' && record.return_inspection?.resolution === null) {
    actions.push('CONTINUE_REFUND', 'REJECT_AFTER_RETURN');
  }
  if ((record.status === 'REFUNDING' || record.status === 'REFUNDING_AFTER_RETURN') && record.refunds.length === 0) {
    actions.push('CREATE_REFUND');
  }
  if (record.status === 'REFUND_FAILED') actions.push('RETRY_REFUND');
  actions.push('VIEW_ORDER');
  return actions;
}

function storedAuditState(value: Prisma.JsonValue | null, label: string): AdminAftersaleAuditState | null {
  if (value === null) return null;
  if (!plainObject(value) || Object.keys(value).length !== 2 ||
    typeof value.status !== 'string' || typeof value.version !== 'number') {
    throw internal(`${label} is invalid`);
  }
  return auditState(value.status as AftersaleStatus, value.version);
}

function rejectImpact(record: {
  id: string;
  items: Array<{
    id: string;
    order_item_id: string;
    refunded_amount: Prisma.Decimal;
    refunded_qty: number;
    reserved_amount: Prisma.Decimal;
    reserved_qty: number;
  }>;
  order_id: string;
  status: AftersaleStatus;
  type: AftersaleType;
  version: number;
}): AdminAftersaleRejectImpactSnapshot {
  if (record.status !== 'PENDING_REVIEW' || !CUSTOMER_AFTERSALE_TYPES.has(record.type)) {
    throw stateConflict('Aftersale cannot be rejected in its current state');
  }
  if (record.items.length < 1) throw internal('Stored aftersale has no items');
  const items = record.items.map((item) => {
    const releaseQuantity = safeCounter(item.reserved_qty, 'Stored reserved quantity') -
      safeCounter(item.refunded_qty, 'Stored refunded quantity');
    const releaseAmount = new Prisma.Decimal(safeMoney(item.reserved_amount, 'Stored reserved amount', true))
      .minus(safeMoney(item.refunded_amount, 'Stored refunded amount'));
    if (releaseQuantity < 1 || !releaseAmount.greaterThan(0)) {
      throw internal('Reviewable aftersale has no releasable quota');
    }
    return {
      aftersaleItemId: safeUlid(item.id, 'Stored aftersale item ID'),
      orderItemId: safeUlid(item.order_item_id, 'Stored Order Item ID'),
      releaseAmount: releaseAmount.toFixed(2),
      releaseQuantity,
    };
  });
  return {
    aftersaleId: safeUlid(record.id, 'Stored aftersale ID'),
    affectedCount: items.length,
    items,
    orderId: safeUlid(record.order_id, 'Stored Order ID'),
    releaseAmount: items.reduce((sum, item) => sum.plus(item.releaseAmount), new Prisma.Decimal(0)).toFixed(2),
    releaseQuantity: items.reduce((sum, item) => sum + item.releaseQuantity, 0),
    resourceVersion: safeVersion(record.version, 'Stored aftersale version'),
  };
}

export class AdminAftersaleRepository {
  private readonly aliasHmacKey: Buffer;
  private readonly fulfillment: FulfillmentRepository;

  constructor(private readonly prisma: PrismaClient, aliasHmacKey: Uint8Array) {
    if (!(aliasHmacKey instanceof Uint8Array) || aliasHmacKey.byteLength < 32) {
      throw new TypeError('Admin aftersale customer alias HMAC key must contain at least 32 bytes');
    }
    this.aliasHmacKey = Buffer.from(aliasHmacKey);
    this.fulfillment = new FulfillmentRepository(prisma, aliasHmacKey);
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    return safeDate(rows[0]?.transaction_time, 'Database transaction time');
  }

  private async lockActor(transaction: DatabaseTransaction, actorAccountId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{
      deleted_at: Date | null;
      has_password: boolean;
      id: string;
      role: string;
      status: string;
    }>>(Prisma.sql`
      SELECT id, role::text, status::text, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account
      WHERE id = ${actorAccountId}
      FOR UPDATE
    `);
    const actor = rows[0];
    if (rows.length !== 1 || actor?.id !== actorAccountId || actor.role !== 'SUPER_ADMIN' ||
      actor.status !== 'ACTIVE' || actor.deleted_at !== null || actor.has_password !== true) {
      throw authenticationRequired();
    }
  }

  private async lockOrderEnvelope(transaction: DatabaseTransaction, orderId: string): Promise<void> {
    const order = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.sales_order WHERE id = ${orderId} FOR UPDATE
    `);
    if (order.length !== 1 || order[0]?.id !== orderId) throw notFound();
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.order_item WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.aftersale WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT ai.id
      FROM public.aftersale_item AS ai
      INNER JOIN public.aftersale AS a ON a.id = ai.aftersale_id
      WHERE a.order_id = ${orderId}
      ORDER BY ai.id ASC
      FOR UPDATE OF ai
    `);
  }

  private async locateAndLock(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    aftersaleId: string,
  ): Promise<string> {
    await this.lockActor(transaction, actorAccountId);
    const candidate = await transaction.aftersale.findUnique({
      where: { id: aftersaleId },
      select: { order_id: true, type: true },
    });
    if (!candidate || !CUSTOMER_AFTERSALE_TYPES.has(candidate.type)) throw notFound();
    await this.lockOrderEnvelope(transaction, candidate.order_id);
    return candidate.order_id;
  }

  private where(input: AdminAftersaleListInput): Prisma.AftersaleWhereInput {
    return {
      type: input.type === undefined ? { in: ['REFUND_ONLY', 'RETURN_REFUND'] } : input.type,
      ...(input.aftersaleNo === undefined ? {} : { aftersale_no: input.aftersaleNo.trim() }),
      ...(input.customerId === undefined ? {} : { customer_id: input.customerId }),
      ...(input.orderId === undefined ? {} : { order_id: input.orderId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined ? {} : {
        created_at: {
          ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
          ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
        },
      }),
    };
  }

  async listInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleListInput,
  ): Promise<AdminAftersaleListResult> {
    validateList(input);
    const where = this.where(input);
    const [total, rows] = await Promise.all([
      transaction.aftersale.count({ where }),
      transaction.aftersale.findMany({
        include: LIST_INCLUDE,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        aftersaleId: safeUlid(row.id, 'Stored aftersale ID'),
        aftersaleNo: safeText(row.aftersale_no, 32, 'Stored aftersale number'),
        agentId: row.order.final_agent_id === null
          ? null
          : safeUlid(row.order.final_agent_id, 'Stored Agent ID'),
        createdAt: safeDate(row.created_at, 'Stored aftersale creation time'),
        customerAlias: alias(row, this.aliasHmacKey),
        customerId: safeUlid(row.customer_id, 'Stored Customer ID'),
        orderId: safeUlid(row.order_id, 'Stored Order ID'),
        requestedAmount: requestedAmount(row),
        status: statusOf(row.status),
        type: typeOf(row.type),
        version: safeVersion(row.version, 'Stored aftersale version'),
      })),
      total: safeCounter(total, 'Stored aftersale total'),
    };
  }

  list(input: AdminAftersaleListInput): Promise<AdminAftersaleListResult> {
    return this.prisma.$transaction(
      (transaction) => this.listInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async readDetail(
    transaction: DatabaseTransaction,
    aftersaleId: string,
  ): Promise<AdminAftersaleDetailSnapshot> {
    const record = await transaction.aftersale.findUnique({ include: DETAIL_INCLUDE, where: { id: aftersaleId } });
    if (!record || !CUSTOMER_AFTERSALE_TYPES.has(record.type)) throw notFound();
    const [orderDetail, audits] = await Promise.all([
      this.fulfillment.getAdminOrderDetailInTransaction(transaction, { orderId: record.order_id }),
      transaction.auditLog.findMany({
        orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
        select: {
          action: true,
          actor_role: true,
          after_json: true,
          before_json: true,
          id: true,
          occurred_at: true,
        },
        where: {
          module: 'aftersale',
          object_id: aftersaleId,
          object_type: 'aftersale',
          result: 'SUCCESS',
        },
      }),
    ]);
    const itemIds = new Set(record.items.map(({ order_item_id }) => order_item_id));
    const skuIds = new Set(record.items.map(({ order_item }) => order_item.sku_id));
    const timeline = audits.map((audit) => {
      const before = storedAuditState(audit.before_json, 'Stored aftersale audit before');
      const after = storedAuditState(audit.after_json, 'Stored aftersale audit after');
      if (after === null) throw internal('Stored aftersale audit after state is missing');
      return {
        action: safeText(audit.action, 120, 'Stored aftersale audit action'),
        actorRole: audit.actor_role,
        auditId: safeUlid(audit.id, 'Stored aftersale audit ID'),
        fromStatus: before?.status ?? null,
        occurredAt: safeDate(audit.occurred_at, 'Stored aftersale audit time'),
        toStatus: after.status,
        version: after.version,
      } satisfies AdminAftersaleTimelineFact;
    }).sort((left, right) => left.version - right.version ||
      left.occurredAt.getTime() - right.occurredAt.getTime() || left.auditId.localeCompare(right.auditId));
    const inspection = inspectionSnapshot(record.return_inspection);
    const inspectionItems = new Map(inspection?.items.map((item) => [item.orderItemId, item]) ?? []);
    const items: AdminAftersaleItemSnapshot[] = record.items.map((item) => ({
      aftersaleItemId: safeUlid(item.id, 'Stored aftersale item ID'),
      allocatedAmount: safeMoney(item.requested_amount, 'Stored requested amount', true),
      approvedRefundQuantity: inspectionItems.get(item.order_item_id)?.approvedRefundQuantity ?? null,
      orderItemId: safeUlid(item.order_item_id, 'Stored Order Item ID'),
      productName: safeText(item.order_item.product_name_snapshot, 200, 'Stored Product name'),
      refundedQuantity: safeCounter(item.refunded_qty, 'Stored refunded quantity'),
      requestedQuantity: safeCounter(item.requested_qty, 'Stored requested quantity'),
      reservedAmount: safeMoney(item.reserved_amount, 'Stored reserved amount', true),
      reservedQuantity: safeCounter(item.reserved_qty, 'Stored reserved quantity'),
      skuId: safeUlid(item.order_item.sku_id, 'Stored SKU ID'),
      skuName: safeText(item.order_item.sku_name_snapshot, 160, 'Stored SKU name'),
    }));
    if (items.length < 1) throw internal('Stored aftersale has no items');
    const returnAddress = record.return_address === null ? null : {
      city: safeText(record.return_address.city, 80, 'Stored return city'),
      detailCiphertext: Buffer.from(record.return_address.detail_ciphertext),
      district: safeText(record.return_address.district, 80, 'Stored return district'),
      encryptionKeyId: safeText(record.return_address.encryption_key_id, 80, 'Stored return encryption key'),
      phoneCiphertext: Buffer.from(record.return_address.phone_ciphertext),
      phoneLast4: safePhoneLast4(record.return_address.phone_last4, 'Stored return phone tail'),
      province: safeText(record.return_address.province, 80, 'Stored return province'),
      recipientName: safeText(record.return_address.recipient_name, 80, 'Stored return recipient'),
      snapshotId: safeUlid(record.return_address.id, 'Stored return address snapshot ID'),
      sourceVersionId: safeUlid(record.return_address.source_version.id, 'Stored return address version ID'),
      sourceVersionNo: safeVersion(record.return_address.source_version.version_no, 'Stored return address version'),
    };
    return {
      aftersaleId: safeUlid(record.id, 'Stored aftersale ID'),
      aftersaleNo: safeText(record.aftersale_no, 32, 'Stored aftersale number'),
      applicationEvidenceFileIds: record.evidence
        .filter(({ return_inspection_id }) => return_inspection_id === null)
        .map(({ file_id }) => safeUlid(file_id, 'Stored application evidence ID')),
      availableActions: availableActions(record),
      commissionImpact: orderDetail.commissionImpact.filter(({ orderItemId }) => itemIds.has(orderItemId)),
      completedAt: nullableDate(record.completed_at, 'Stored aftersale completion time'),
      createdAt: safeDate(record.created_at, 'Stored aftersale creation time'),
      inspection,
      inventoryImpact: orderDetail.inventoryImpact.filter(({ skuId }) => skuIds.has(skuId)),
      items,
      orderDetail,
      orderId: safeUlid(record.order_id, 'Stored Order ID'),
      reasonCode: safeText(record.reason_code, 80, 'Stored aftersale reason code'),
      reasonText: record.reason_text,
      refundAttempts: record.refunds.flatMap((refund) => refund.attempts.map((attempt) => ({
        amount: safeMoney(refund.amount, 'Stored Refund amount', true),
        attemptNo: safeCounter(attempt.attempt_no, 'Stored Refund attempt number'),
        failureCode: attempt.failure_code,
        finishedAt: nullableDate(attempt.finished_at, 'Stored Refund finish time'),
        refundId: safeUlid(refund.id, 'Stored Refund ID'),
        refundNo: safeText(refund.refund_no, 32, 'Stored Refund number'),
        requestedAt: safeDate(attempt.requested_at, 'Stored Refund request time'),
        status: attempt.status,
      }))),
      returnAddress,
      returnShipment: record.return_shipment === null ? null : {
        carrierCode: safeText(record.return_shipment.carrier_code, 40, 'Stored carrier code'),
        carrierName: safeText(record.return_shipment.carrier_name, 80, 'Stored carrier name'),
        shipmentId: safeUlid(record.return_shipment.id, 'Stored return shipment ID'),
        submittedAt: safeDate(record.return_shipment.submitted_at, 'Stored return shipment time'),
        trackingNo: safeText(record.return_shipment.tracking_no, 120, 'Stored tracking number'),
      },
      reviewedAt: nullableDate(record.reviewed_at, 'Stored review time'),
      reviewedById: record.reviewed_by_id === null ? null : safeUlid(record.reviewed_by_id, 'Stored reviewer ID'),
      reviewReason: record.review_reason,
      status: statusOf(record.status),
      timeline,
      type: typeOf(record.type),
      updatedAt: safeDate(record.updated_at, 'Stored aftersale update time'),
      version: safeVersion(record.version, 'Stored aftersale version'),
    };
  }

  async getDetailInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleReadInput,
  ): Promise<AdminAftersaleDetailSnapshot> {
    validateRead(input);
    return this.readDetail(transaction, input.aftersaleId);
  }

  getDetail(input: AdminAftersaleReadInput): Promise<AdminAftersaleDetailSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.getDetailInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async previewRejectInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleReadInput,
  ): Promise<AdminAftersaleRejectImpactSnapshot> {
    validateRead(input);
    const current = await transaction.aftersale.findUnique({
      where: { id: input.aftersaleId },
      select: {
        id: true,
        items: {
          orderBy: [{ id: 'asc' }],
          select: {
            id: true,
            order_item_id: true,
            refunded_amount: true,
            refunded_qty: true,
            reserved_amount: true,
            reserved_qty: true,
          },
        },
        order_id: true,
        status: true,
        type: true,
        version: true,
      },
    });
    if (!current || !CUSTOMER_AFTERSALE_TYPES.has(current.type)) throw notFound();
    return rejectImpact(current);
  }

  previewReject(input: AdminAftersaleReadInput): Promise<AdminAftersaleRejectImpactSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.previewRejectInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async currentForCommand(transaction: DatabaseTransaction, aftersaleId: string): Promise<DetailRecord> {
    const record = await transaction.aftersale.findUnique({ include: DETAIL_INCLUDE, where: { id: aftersaleId } });
    if (!record || !CUSTOMER_AFTERSALE_TYPES.has(record.type)) throw notFound();
    return record;
  }

  async getForReplayInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleReadInput & { actorAccountId: string },
  ): Promise<AdminAftersaleCommandSnapshot> {
    exactObject(input, ['actorAccountId', 'aftersaleId'], ['actorAccountId', 'aftersaleId'], 'Admin aftersale replay');
    requireUlid(input.actorAccountId, 'Admin aftersale actor ID');
    requireUlid(input.aftersaleId, 'Admin aftersale ID');
    await this.locateAndLock(transaction, input.actorAccountId, input.aftersaleId);
    return commandSnapshot(await this.currentForCommand(transaction, input.aftersaleId));
  }

  async approveInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleApproveInput,
    hooks: AdminAftersaleApproveHooks,
  ): Promise<AdminAftersaleCommandResult> {
    const normalized = validateApprove(input);
    const orderId = await this.locateAndLock(transaction, normalized.actorAccountId, normalized.aftersaleId);
    const current = await this.currentForCommand(transaction, normalized.aftersaleId);
    const before = auditState(current.status, current.version);
    if (before.version !== normalized.expectedVersion) throw versionConflict();
    if (current.status !== 'PENDING_REVIEW' || current.reviewed_at !== null || current.reviewed_by_id !== null ||
      current.return_shipment !== null || current.return_inspection !== null || current.refunds.length > 0) {
      throw stateConflict('Aftersale cannot be approved in its current state');
    }
    const order = await transaction.salesOrder.findUnique({ where: { id: orderId }, select: { version: true } });
    if (!order) throw internal('Stored aftersale Order is missing');
    const orderVersion = safeVersion(order.version, 'Stored Order version');
    const occurredAt = await this.transactionTime(transaction);
    let nextStatus: 'REFUNDING' | 'WAITING_RETURN';
    if (current.type === 'RETURN_REFUND') {
      const publishedRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM public.return_address_version
        WHERE status = 'PUBLISHED'::"ConfigVersionStatus"
        ORDER BY version_no DESC, id DESC
        FOR UPDATE
      `);
      if (publishedRows.length === 0) {
        throw new ApplicationError('RETURN_ADDRESS_NOT_CONFIGURED', 'A published return address is required');
      }
      if (publishedRows.length !== 1) throw internal('Published return address cardinality is invalid');
      const source = await transaction.returnAddressVersion.findUnique({
        where: { id: publishedRows[0]!.id },
      });
      if (!source || source.status !== 'PUBLISHED') throw stateConflict('Published return address changed');
      const sourceMaterial: AdminAftersaleSourceAddressMaterial = {
        city: safeText(source.city, 80, 'Stored return city'),
        detailCiphertext: Buffer.from(source.detail_ciphertext),
        district: safeText(source.district, 80, 'Stored return district'),
        encryptionKeyId: safeText(source.encryption_key_id, 80, 'Stored return encryption key'),
        phoneCiphertext: Buffer.from(source.phone_ciphertext),
        phoneLast4: safePhoneLast4(source.phone_last4, 'Stored return phone tail'),
        province: safeText(source.province, 80, 'Stored return province'),
        recipientName: safeText(source.recipient_name, 80, 'Stored return recipient'),
        sourceVersionId: safeUlid(source.id, 'Stored return address version ID'),
        sourceVersionNo: safeVersion(source.version_no, 'Stored return address version'),
      };
      const snapshotId = generateUlid(occurredAt.getTime());
      const protectedMaterial = await hooks.protectReturnAddress({ snapshotId, source: sourceMaterial });
      if (!plainObject(protectedMaterial) || !(protectedMaterial.phoneCiphertext instanceof Uint8Array) ||
        !(protectedMaterial.detailCiphertext instanceof Uint8Array) ||
        protectedMaterial.phoneCiphertext.byteLength < 1 || protectedMaterial.detailCiphertext.byteLength < 1 ||
        protectedMaterial.phoneLast4 !== sourceMaterial.phoneLast4 ||
        typeof protectedMaterial.encryptionKeyId !== 'string' ||
        protectedMaterial.encryptionKeyId.length < 1 || protectedMaterial.encryptionKeyId.length > 80) {
        throw internal('Protected return address snapshot material is invalid');
      }
      await transaction.returnAddressSnapshot.create({
        data: {
          aftersale_id: current.id,
          captured_at: occurredAt,
          city: sourceMaterial.city,
          detail_ciphertext: Buffer.from(protectedMaterial.detailCiphertext),
          district: sourceMaterial.district,
          encryption_key_id: protectedMaterial.encryptionKeyId,
          id: snapshotId,
          phone_ciphertext: Buffer.from(protectedMaterial.phoneCiphertext),
          phone_last4: protectedMaterial.phoneLast4,
          province: sourceMaterial.province,
          recipient_name: sourceMaterial.recipientName,
          source_version_id: sourceMaterial.sourceVersionId,
        },
        select: { id: true },
      });
      nextStatus = 'WAITING_RETURN';
    } else {
      nextStatus = 'REFUNDING';
    }
    const changed = await transaction.aftersale.updateMany({
      data: {
        review_reason: normalized.note,
        reviewed_at: occurredAt,
        reviewed_by_id: normalized.actorAccountId,
        status: nextStatus,
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: current.id, status: 'PENDING_REVIEW', version: current.version },
    });
    if (changed.count !== 1) throw stateConflict('Aftersale changed during approval');
    const orderChanged = await transaction.salesOrder.updateMany({
      data: { updated_at: occurredAt, version: { increment: 1 } },
      where: { id: orderId, version: orderVersion },
    });
    if (orderChanged.count !== 1) throw stateConflict('Aftersale Order changed during approval');
    const aftersale = commandSnapshot(await this.currentForCommand(transaction, current.id));
    return { aftersale, audit: { after: auditState(aftersale.status, aftersale.version), before } };
  }

  async rejectInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleRejectInput,
    hooks: AdminAftersaleRejectHooks,
  ): Promise<AdminAftersaleCommandResult> {
    const normalized = validateReject(input);
    const orderId = await this.locateAndLock(transaction, normalized.actorAccountId, normalized.aftersaleId);
    const current = await transaction.aftersale.findUnique({
      where: { id: normalized.aftersaleId },
      select: {
        id: true,
        items: {
          orderBy: [{ id: 'asc' }],
          select: {
            id: true,
            order_item_id: true,
            refunded_amount: true,
            refunded_qty: true,
            reserved_amount: true,
            reserved_qty: true,
          },
        },
        order_id: true,
        refunds: { select: { id: true } },
        return_inspection: { select: { id: true } },
        return_shipment: { select: { id: true } },
        reviewed_at: true,
        status: true,
        type: true,
        version: true,
      },
    });
    if (!current || !CUSTOMER_AFTERSALE_TYPES.has(current.type)) throw notFound();
    const before = auditState(current.status, current.version);
    if (before.version !== normalized.expectedVersion) throw versionConflict();
    if (current.reviewed_at !== null || current.refunds.length > 0 || current.return_inspection !== null ||
      current.return_shipment !== null) throw stateConflict('Aftersale already has review or downstream facts');
    const impact = rejectImpact(current);
    await hooks.verifyPreview(impact);
    const order = await transaction.salesOrder.findUnique({ where: { id: orderId }, select: { version: true } });
    if (!order) throw internal('Stored aftersale Order is missing');
    const orderVersion = safeVersion(order.version, 'Stored Order version');
    const orderItems = await transaction.orderItem.findMany({
      orderBy: [{ id: 'asc' }],
      where: { id: { in: impact.items.map(({ orderItemId }) => orderItemId) }, order_id: orderId },
      select: { aftersale_reserved_amount: true, aftersale_reserved_qty: true, id: true, version: true },
    });
    const orderItemById = new Map(orderItems.map((item) => [item.id, item]));
    if (orderItemById.size !== impact.items.length) throw internal('Stored aftersale Order Item envelope is invalid');
    const occurredAt = await this.transactionTime(transaction);
    for (const item of impact.items) {
      const orderItem = orderItemById.get(item.orderItemId)!;
      const quantityAfter = orderItem.aftersale_reserved_qty - item.releaseQuantity;
      const amountAfter = orderItem.aftersale_reserved_amount.minus(item.releaseAmount);
      if (quantityAfter < 0 || amountAfter.isNegative()) throw internal('Aftersale quota cannot be released');
      const updated = await transaction.orderItem.updateMany({
        data: {
          aftersale_reserved_amount: amountAfter,
          aftersale_reserved_qty: quantityAfter,
          version: { increment: 1 },
        },
        where: {
          aftersale_reserved_amount: orderItem.aftersale_reserved_amount,
          aftersale_reserved_qty: orderItem.aftersale_reserved_qty,
          id: item.orderItemId,
          order_id: orderId,
          version: orderItem.version,
        },
      });
      if (updated.count !== 1) throw stateConflict('Aftersale quota changed during rejection');
    }
    const changed = await transaction.aftersale.updateMany({
      data: {
        review_reason: normalized.reason,
        reviewed_at: occurredAt,
        reviewed_by_id: normalized.actorAccountId,
        status: 'REJECTED',
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: current.id, status: 'PENDING_REVIEW', version: current.version },
    });
    if (changed.count !== 1) throw stateConflict('Aftersale changed during rejection');
    const orderChanged = await transaction.salesOrder.updateMany({
      data: { updated_at: occurredAt, version: { increment: 1 } },
      where: { id: orderId, version: orderVersion },
    });
    if (orderChanged.count !== 1) throw stateConflict('Aftersale Order changed during rejection');
    const aftersale = commandSnapshot(await this.currentForCommand(transaction, current.id));
    return { aftersale, audit: { after: auditState(aftersale.status, aftersale.version), before } };
  }
}
