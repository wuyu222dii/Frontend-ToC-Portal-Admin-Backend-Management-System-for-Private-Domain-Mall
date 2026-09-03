import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const RATE = /^(?:100\.0000|(?:0|[1-9][0-9]?)\.[0-9]{4})$/;

export type CommissionRuleTargetType = 'PLATFORM' | 'CATEGORY' | 'SKU';
export type CommissionRuleVersionState = 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
export type CommissionPositionState = 'AVAILABLE' | 'CANCELLED' | 'EXPECTED' | 'NONE';
export type CommissionLedgerKind =
  | 'AVAILABLE_CREDIT'
  | 'EXPECTED_CANCELLED'
  | 'EXPECTED_CREATED'
  | 'EXPECTED_REDUCED'
  | 'REFUND_DEBIT'
  | 'WITHDRAWAL_FREEZE'
  | 'WITHDRAWAL_PAID'
  | 'WITHDRAWAL_RELEASE';

export interface CommissionRuleChange {
  configuredRate: string | null;
  targetId: string | null;
  targetType: CommissionRuleTargetType;
}

export interface CommissionRuleActionInput {
  baseVersionId: string | null;
  changes: readonly CommissionRuleChange[];
  reason: string;
}

export interface CommissionRuleSkuSnapshot {
  categoryId: string;
  categoryName: string;
  configuredRate: string | null;
  effectiveRate: string;
  productId: string;
  productName: string;
  skuCode: string;
  skuId: string;
  source: CommissionRuleTargetType;
}

export interface CommissionRuleCategorySnapshot {
  categoryId: string;
  categoryName: string;
  configuredRate: string | null;
  effectiveRate: string;
  source: 'CATEGORY' | 'PLATFORM';
}

export interface CommissionRuleImpact {
  affectedSkuCount: number;
  affectedSkus: CommissionRuleSkuSnapshot[];
  changedTargetCount: number;
  warnings: string[];
}

export interface CommissionRuleVersionSnapshot {
  baseVersionId: string | null;
  changes: CommissionRuleChange[];
  createdAt: Date;
  createdById: string;
  effectiveAt: Date | null;
  reason: string;
  status: CommissionRuleVersionState;
  versionId: string;
  versionNo: number;
}

export interface CommissionRulePublishPreviewSnapshot {
  action: CommissionRuleActionInput;
  currentPublishedId: string | null;
  impact: CommissionRuleImpact;
  maxVersionNo: number;
  resourceVersion: number;
}

export interface CommissionRulePublishInput extends CommissionRuleActionInput {
  actorAccountId: string;
  expectedCurrentPublishedId: string | null;
  expectedMaxVersionNo: number;
  expectedVersion: number;
}

export interface CommissionRulePublishHooks {
  verifyPreview(snapshot: CommissionRulePublishPreviewSnapshot): Promise<void> | void;
}

export interface CommissionRuleAuditState {
  status: 'PUBLISHED';
  version: number;
  versionId: string;
}

export interface CommissionRulePublishResult {
  after: CommissionRuleAuditState;
  before: CommissionRuleAuditState | null;
  impact: CommissionRuleImpact;
  version: CommissionRuleVersionSnapshot;
}

export interface CommissionCurrentRulesSnapshot {
  categories: CommissionRuleCategorySnapshot[];
  items: CommissionRuleSkuSnapshot[];
  platformRate: string;
  version: number;
  versionId: string;
  versionNo: number;
}

export interface CommissionRuleSkuListInput {
  categoryId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  source?: CommissionRuleTargetType;
}

export interface CommissionRuleSkuListResult {
  items: CommissionRuleSkuSnapshot[];
  total: number;
  versionId: string;
  versionNo: number;
}

export interface CommissionRuleVersionListInput {
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  page: number;
  pageSize: number;
  status?: CommissionRuleVersionState;
}

export interface CommissionRuleVersionListResult {
  items: CommissionRuleVersionSnapshot[];
  total: number;
}

export interface AdminAgentCommissionListInput {
  agentId: string;
  ledgerType?: Extract<CommissionLedgerKind,
    'AVAILABLE_CREDIT' | 'EXPECTED_CANCELLED' | 'EXPECTED_CREATED' | 'EXPECTED_REDUCED' | 'REFUND_DEBIT'>;
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  page: number;
  pageSize: number;
  positionState?: CommissionPositionState;
}

export interface AdminAgentCommissionItem {
  agentId: string;
  availableChange: string;
  categoryId: string;
  categoryName: string;
  commissionBase: string;
  commissionSnapshotId: string;
  effectiveRate: string;
  expectedChange: string;
  expectedRemaining: string;
  ledgerId: string;
  ledgerType: Extract<CommissionLedgerKind,
    'AVAILABLE_CREDIT' | 'EXPECTED_CANCELLED' | 'EXPECTED_CREATED' | 'EXPECTED_REDUCED' | 'REFUND_DEBIT'>;
  occurredAt: Date;
  orderId: string;
  orderItemId: string;
  orderNo: string;
  originalCommission: string;
  positionState: CommissionPositionState;
  productId: string;
  productName: string;
  refundId: string | null;
  reversalTotal: string;
  ruleSource: CommissionRuleTargetType;
  ruleVersionId: string;
  ruleVersionNo: number;
  skuId: string;
  skuName: string;
}

export interface AdminAgentCommissionListResult {
  items: AdminAgentCommissionItem[];
  total: number;
}

export interface AdminAgentWalletLedgerListInput {
  agentId: string;
  ledgerType?: CommissionLedgerKind;
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  page: number;
  pageSize: number;
}

export interface AdminAgentWalletLedgerItem {
  agentId: string;
  availableBalanceAfter: string;
  availableChange: string;
  expectedBalanceAfter: string;
  expectedChange: string;
  frozenBalanceAfter: string;
  frozenChange: string;
  ledgerType: CommissionLedgerKind;
  occurredAt: Date;
  referenceId: string;
  referenceType: 'COMMISSION_LEDGER' | 'REFUND' | 'WITHDRAWAL';
  refundId: string | null;
  walletLedgerId: string;
}

export interface AdminAgentWalletLedgerListResult {
  items: AdminAgentWalletLedgerItem[];
  total: number;
}

export interface CommissionExplanationLedgerSnapshot {
  availableChange: string;
  expectedChange: string;
  frozenChange: string;
  ledgerId: string;
  ledgerType: Extract<CommissionLedgerKind,
    'AVAILABLE_CREDIT' | 'EXPECTED_CANCELLED' | 'EXPECTED_CREATED' | 'EXPECTED_REDUCED' | 'REFUND_DEBIT'>;
  occurredAt: Date;
  reason: string;
  refundId: string | null;
}

export interface CommissionExplanationItem {
  categoryId: string;
  categoryName: string;
  commissionBase: string;
  commissionSnapshotId: string;
  effectiveRate: string;
  expectedRemaining: string;
  hitPath: string[];
  ledger: CommissionExplanationLedgerSnapshot[];
  orderItemId: string;
  originalCommission: string;
  positionState: CommissionPositionState;
  productId: string;
  productName: string;
  reversalTotal: string;
  roundingMode: 'HALF_UP';
  roundingScale: 2;
  ruleSource: CommissionRuleTargetType;
  ruleVersionId: string;
  ruleVersionNo: number;
  skuId: string;
  skuName: string;
}

export interface OrderCommissionExplanation {
  items: CommissionExplanationItem[];
  orderId: string;
  orderNo: string;
}

const RULE_INCLUDE = {
  entries: { orderBy: [{ target_key: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.CommissionRuleVersionInclude;

const RULE_DETAIL_INCLUDE = {
  ...RULE_INCLUDE,
  base_version: { include: RULE_INCLUDE },
} satisfies Prisma.CommissionRuleVersionInclude;

const ADMIN_COMMISSION_INCLUDE = {
  snapshot: {
    include: {
      order_item: { include: { order: true } },
      ledger: true,
      position: true,
      rule_version: { include: RULE_INCLUDE },
    },
  },
} satisfies Prisma.CommissionLedgerInclude;

const ORDER_EXPLANATION_INCLUDE = {
  items: {
    include: {
      commission_snapshot: {
        include: {
          ledger: { orderBy: [{ occurred_at: 'asc' as const }, { id: 'asc' as const }] },
          position: true,
          rule_version: { include: RULE_INCLUDE },
        },
      },
    },
    orderBy: [{ id: 'asc' as const }],
  },
} satisfies Prisma.SalesOrderInclude;

const COMMISSION_LEDGER_CLOSURE_SELECT = {
  agent_id: true,
  category_id_snapshot: true,
  commission_base: true,
  created_at: true,
  effective_rate: true,
  id: true,
  ledger: true,
  order_item: {
    select: {
      category_id: true,
      id: true,
      line_paid_amount: true,
      order: {
        select: {
          attribution_snapshot: { select: { agent_id_snapshot: true } },
          final_agent_id: true,
          final_channel: true,
          id: true,
          paid_at: true,
          payment_status: true,
        },
      },
      order_id: true,
      product_id: true,
      sku_id: true,
    },
  },
  order_item_id: true,
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
  rule_version: { include: RULE_INCLUDE },
  rule_version_id: true,
  sku_id_snapshot: true,
  source_type: true,
} satisfies Prisma.OrderItemCommissionSnapshotSelect;

type RuleRecord = Prisma.CommissionRuleVersionGetPayload<{ include: typeof RULE_INCLUDE }>;
type RuleDetailRecord = Prisma.CommissionRuleVersionGetPayload<{ include: typeof RULE_DETAIL_INCLUDE }>;
type AdminCommissionRecord = Prisma.CommissionLedgerGetPayload<{ include: typeof ADMIN_COMMISSION_INCLUDE }>;
type ExplanationOrderRecord = Prisma.SalesOrderGetPayload<{ include: typeof ORDER_EXPLANATION_INCLUDE }>;

interface RuleValue {
  rate: Prisma.Decimal;
  targetId: string | null;
  targetKey: string;
  targetType: CommissionRuleTargetType;
}

interface RuleEntriesFact {
  entries: Array<{
    configured_rate: Prisma.Decimal;
    id: string;
    rule_version_id: string;
    target_id: string | null;
    target_key: string;
    target_type: string;
  }>;
  id: string;
}

interface CatalogSku {
  categoryId: string;
  categoryName: string;
  productId: string;
  productName: string;
  skuCode: string;
  skuId: string;
}

interface CatalogCategory {
  categoryId: string;
  categoryName: string;
}

interface CommissionCatalog {
  categories: CatalogCategory[];
  skus: CatalogSku[];
}

interface TargetRow {
  deleted_at: Date | null;
  id: string;
}

interface WalletWindowRow {
  agent_id: string;
  available_balance_after: Prisma.Decimal;
  available_change: Prisma.Decimal;
  expected_balance_after: Prisma.Decimal;
  expected_change: Prisma.Decimal;
  frozen_balance_after: Prisma.Decimal;
  frozen_change: Prisma.Decimal;
  id: string;
  ledger_type: string;
  occurred_at: Date;
  refund_id: string | null;
  snapshot_id: string | null;
  withdrawal_id: string | null;
}

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(message: string): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(message = 'Commission rule version changed'): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', message);
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

function storedUlid(value: unknown, label: string): string {
  if (!isValidUlid(value)) throw internal(`${label} is invalid`);
  return value;
}

function requireVersion(value: unknown, label: string, allowZero = false): asserts value is number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} is invalid`);
  }
}

function storedVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value as number;
}

function requireDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} is invalid`);
}

function storedDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || point === 0x7f);
  });
}

function normalizeText(value: unknown, maximum: number, label: string, minimum = 1): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum || hasControlCharacters(normalized)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function storedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > maximum ||
    hasControlCharacters(value)) throw internal(`${label} is invalid`);
  return value;
}

function storedCount(value: bigint | number, label: string): number {
  const count = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(count) || count < 0 || count > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return count;
}

function decimal(value: unknown, label: string, allowNegative: boolean): Prisma.Decimal {
  if (!Prisma.Decimal.isDecimal(value) || !value.isFinite() || (!allowNegative && value.isNegative()) ||
    value.decimalPlaces() > 2 || value.abs().greaterThan(MAX_MONEY)) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function money(value: unknown, label: string, allowNegative = false): string {
  return decimal(value, label, allowNegative).toFixed(2);
}

function rate(value: unknown, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || !value.isFinite() || value.isNegative() || value.greaterThan(100) ||
    value.decimalPlaces() > 4) throw internal(`${label} is invalid`);
  return value.toFixed(4);
}

function inputRate(value: unknown, label: string): Prisma.Decimal {
  if (typeof value !== 'string' || !RATE.test(value)) throw new TypeError(`${label} is invalid`);
  return new Prisma.Decimal(value);
}

function validatePage(page: unknown, pageSize: unknown, label: string): void {
  if (!Number.isSafeInteger(page) || (page as number) < 1) throw new TypeError(`${label} page must be positive`);
  if (!Number.isSafeInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
    throw new TypeError(`${label} page size must be between 1 and 100`);
  }
  const offset = ((page as number) - 1) * (pageSize as number);
  if (!Number.isSafeInteger(offset) || offset > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} page offset is invalid`);
  }
}

function validateDateRange(from: Date | undefined, to: Date | undefined, label: string): void {
  if (from !== undefined) requireDate(from, `${label} start time`);
  if (to !== undefined) requireDate(to, `${label} end time`);
  if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
    throw new TypeError(`${label} date range must be increasing`);
  }
}

function normalizeAction(input: CommissionRuleActionInput): CommissionRuleActionInput {
  exactObject(input, ['baseVersionId', 'changes', 'reason'], ['baseVersionId', 'changes', 'reason'],
    'Commission rule action');
  if (input.baseVersionId !== null) requireUlid(input.baseVersionId, 'Commission rule base version ID');
  if (!Array.isArray(input.changes) || input.changes.length < 1) {
    throw new TypeError('Commission rule changes must not be empty');
  }
  const seen = new Set<string>();
  const changes = input.changes.map((change, index): CommissionRuleChange => {
    exactObject(change, ['configuredRate', 'targetId', 'targetType'],
      ['configuredRate', 'targetId', 'targetType'], `Commission rule change ${index}`);
    if (change.targetType !== 'PLATFORM' && change.targetType !== 'CATEGORY' && change.targetType !== 'SKU') {
      throw new TypeError(`Commission rule change ${index} target type is invalid`);
    }
    if (change.targetType === 'PLATFORM') {
      if (change.targetId !== null || change.configuredRate === null) {
        throw new TypeError('Platform commission rule requires a non-null rate and null target ID');
      }
    } else {
      requireUlid(change.targetId, `Commission rule change ${index} target ID`);
    }
    const targetKey = change.targetType === 'PLATFORM' ? 'PLATFORM' : `${change.targetType}:${change.targetId}`;
    if (seen.has(targetKey)) throw new TypeError('Commission rule changes contain a duplicate target');
    seen.add(targetKey);
    return {
      configuredRate: change.configuredRate === null
        ? null
        : inputRate(change.configuredRate, `Commission rule change ${index} rate`).toFixed(4),
      targetId: change.targetId,
      targetType: change.targetType,
    };
  });
  return {
    baseVersionId: input.baseVersionId,
    changes,
    reason: normalizeText(input.reason, 500, 'Commission rule reason', 2),
  };
}

function validatePublishInput(input: CommissionRulePublishInput): CommissionRulePublishInput {
  exactObject(input, [
    'actorAccountId', 'baseVersionId', 'changes', 'expectedCurrentPublishedId',
    'expectedMaxVersionNo', 'expectedVersion', 'reason',
  ], [
    'actorAccountId', 'baseVersionId', 'changes', 'expectedCurrentPublishedId',
    'expectedMaxVersionNo', 'expectedVersion', 'reason',
  ], 'Commission rule publish input');
  requireUlid(input.actorAccountId, 'Commission rule actor Account ID');
  if (input.expectedCurrentPublishedId !== null) {
    requireUlid(input.expectedCurrentPublishedId, 'Expected published commission rule ID');
  }
  requireVersion(input.expectedMaxVersionNo, 'Expected maximum commission rule version', true);
  requireVersion(input.expectedVersion, 'Expected commission rule resource version', true);
  return { ...input, ...normalizeAction({
    baseVersionId: input.baseVersionId,
    changes: input.changes,
    reason: input.reason,
  }) };
}

function validateRuleSkuList(input: CommissionRuleSkuListInput): string | undefined {
  exactObject(input, ['categoryId', 'keyword', 'page', 'pageSize', 'source'], ['page', 'pageSize'],
    'Commission rule SKU list input');
  validatePage(input.page, input.pageSize, 'Commission rule SKU list');
  if (input.categoryId !== undefined) requireUlid(input.categoryId, 'Commission rule SKU category ID');
  if (input.source !== undefined && input.source !== 'PLATFORM' && input.source !== 'CATEGORY' &&
    input.source !== 'SKU') throw new TypeError('Commission rule SKU source is invalid');
  return input.keyword === undefined ? undefined : normalizeText(input.keyword, 200, 'Commission rule SKU keyword');
}

function validateRuleVersionList(input: CommissionRuleVersionListInput): void {
  exactObject(input, ['createdAtFrom', 'createdAtToExclusive', 'page', 'pageSize', 'status'],
    ['page', 'pageSize'], 'Commission rule version list input');
  validatePage(input.page, input.pageSize, 'Commission rule version list');
  validateDateRange(input.createdAtFrom, input.createdAtToExclusive, 'Commission rule version list');
  if (input.status !== undefined && input.status !== 'ARCHIVED' && input.status !== 'DRAFT' &&
    input.status !== 'PUBLISHED') throw new TypeError('Commission rule version status is invalid');
}

const COMMISSION_LEDGER_TYPES = new Set<CommissionLedgerKind>([
  'AVAILABLE_CREDIT', 'EXPECTED_CANCELLED', 'EXPECTED_CREATED', 'EXPECTED_REDUCED', 'REFUND_DEBIT',
  'WITHDRAWAL_FREEZE', 'WITHDRAWAL_PAID', 'WITHDRAWAL_RELEASE',
]);
const COMMISSION_ONLY_LEDGER_TYPES = new Set<CommissionLedgerKind>([
  'AVAILABLE_CREDIT', 'EXPECTED_CANCELLED', 'EXPECTED_CREATED', 'EXPECTED_REDUCED', 'REFUND_DEBIT',
]);

function validateAdminLedgerList(
  input: AdminAgentCommissionListInput | AdminAgentWalletLedgerListInput,
  wallet: boolean,
): void {
  exactObject(input, wallet
    ? ['agentId', 'ledgerType', 'occurredAtFrom', 'occurredAtToExclusive', 'page', 'pageSize']
    : ['agentId', 'ledgerType', 'occurredAtFrom', 'occurredAtToExclusive', 'page', 'pageSize', 'positionState'],
    ['agentId', 'page', 'pageSize'], wallet ? 'Admin Agent wallet ledger list input' : 'Admin Agent commission list input');
  requireUlid(input.agentId, 'Admin Agent ledger Agent ID');
  validatePage(input.page, input.pageSize, wallet ? 'Admin Agent wallet ledger list' : 'Admin Agent commission list');
  validateDateRange(input.occurredAtFrom, input.occurredAtToExclusive,
    wallet ? 'Admin Agent wallet ledger list' : 'Admin Agent commission list');
  if (input.ledgerType !== undefined && !(wallet ? COMMISSION_LEDGER_TYPES : COMMISSION_ONLY_LEDGER_TYPES)
    .has(input.ledgerType)) throw new TypeError('Admin Agent ledger type is invalid');
  if ('positionState' in input && input.positionState !== undefined &&
    input.positionState !== 'AVAILABLE' && input.positionState !== 'CANCELLED' &&
    input.positionState !== 'EXPECTED' && input.positionState !== 'NONE') {
    throw new TypeError('Admin Agent commission position state is invalid');
  }
}

function targetKey(targetType: CommissionRuleTargetType, targetId: string | null): string {
  return targetType === 'PLATFORM' ? 'PLATFORM' : `${targetType}:${targetId}`;
}

function ruleValues(record: RuleEntriesFact): Map<string, RuleValue> {
  const values = new Map<string, RuleValue>();
  for (const entry of record.entries) {
    storedUlid(entry.id, 'Stored commission rule entry ID');
    if (entry.rule_version_id !== record.id) throw internal('Stored commission rule entry parent is invalid');
    const type = entry.target_type as CommissionRuleTargetType;
    const validTarget = type === 'PLATFORM'
      ? entry.target_id === null && entry.target_key === 'PLATFORM'
      : (type === 'CATEGORY' || type === 'SKU') && isValidUlid(entry.target_id) &&
        entry.target_key === `${type}:${entry.target_id}`;
    if (!validTarget || values.has(entry.target_key)) throw internal('Stored commission rule target is invalid');
    rate(entry.configured_rate, 'Stored commission rule rate');
    values.set(entry.target_key, {
      rate: entry.configured_rate,
      targetId: entry.target_id,
      targetKey: entry.target_key,
      targetType: type,
    });
  }
  if (!values.has('PLATFORM')) throw internal('Stored commission rule has no platform default');
  return values;
}

function validateRuleRecord(record: RuleRecord): Map<string, RuleValue> {
  storedUlid(record.id, 'Stored commission rule version ID');
  storedUlid(record.created_by_id, 'Stored commission rule creator ID');
  storedVersion(record.version_no, 'Stored commission rule version number');
  storedText(record.reason, 500, 'Stored commission rule reason');
  storedDate(record.created_at, 'Stored commission rule creation time');
  if (record.base_version_id !== null) storedUlid(record.base_version_id, 'Stored base commission rule ID');
  if (record.status !== 'ARCHIVED' && record.status !== 'DRAFT' && record.status !== 'PUBLISHED') {
    throw internal('Stored commission rule status is invalid');
  }
  if (record.status === 'PUBLISHED' && record.effective_at === null) {
    throw internal('Stored published commission rule has no effective time');
  }
  if (record.status === 'DRAFT' && record.effective_at !== null) {
    throw internal('Stored draft commission rule has an effective time');
  }
  if (record.effective_at !== null) storedDate(record.effective_at, 'Stored commission rule effective time');
  return ruleValues(record);
}

function diffRuleValues(
  values: ReadonlyMap<string, RuleValue>,
  base: ReadonlyMap<string, RuleValue> | null,
): CommissionRuleChange[] {
  const keys = new Set([...(base?.keys() ?? []), ...values.keys()]);
  return [...keys].sort().flatMap((key) => {
    const before = base?.get(key);
    const after = values.get(key);
    if (before !== undefined && after !== undefined && before.rate.equals(after.rate)) return [];
    const source = after ?? before;
    if (source === undefined) throw internal('Commission rule difference target is missing');
    return [{
      configuredRate: after === undefined ? null : rate(after.rate, 'Stored commission rule difference rate'),
      targetId: source.targetId,
      targetType: source.targetType,
    }];
  });
}

function versionSnapshot(
  record: RuleRecord,
  baseValues: ReadonlyMap<string, RuleValue> | null,
): CommissionRuleVersionSnapshot {
  const values = validateRuleRecord(record);
  if ((record.base_version_id === null) !== (baseValues === null)) {
    throw internal('Stored commission rule base relationship is invalid');
  }
  return {
    baseVersionId: record.base_version_id,
    changes: diffRuleValues(values, baseValues),
    createdAt: storedDate(record.created_at, 'Stored commission rule creation time'),
    createdById: record.created_by_id,
    effectiveAt: record.effective_at === null
      ? null
      : storedDate(record.effective_at, 'Stored commission rule effective time'),
    reason: record.reason,
    status: record.status,
    versionId: record.id,
    versionNo: record.version_no,
  };
}

export function validateCommissionSnapshotRule(snapshot: {
  category_id_snapshot: string;
  created_at: Date;
  effective_rate: Prisma.Decimal;
  rule_version: {
    effective_at: Date | null;
    entries: RuleEntriesFact['entries'];
    id: string;
    status: string;
    version_no: number;
  };
  sku_id_snapshot: string;
  source_type: string;
}, paidAt: Date | null): void {
  const snapshotCreatedAt = storedDate(snapshot.created_at, 'Stored commission snapshot creation time');
  if (paidAt === null) throw internal('Stored commission snapshot has no payment time');
  const paymentAt = storedDate(paidAt, 'Stored commission payment time');
  const effectiveAt = snapshot.rule_version.effective_at;
  if ((snapshot.rule_version.status !== 'PUBLISHED' && snapshot.rule_version.status !== 'ARCHIVED') ||
    effectiveAt === null) {
    throw internal('Stored commission snapshot references an inactive commission rule version');
  }
  const ruleEffectiveAt = storedDate(effectiveAt, 'Stored commission rule effective time');
  if (ruleEffectiveAt > paymentAt || ruleEffectiveAt > snapshotCreatedAt) {
    throw internal('Stored commission snapshot references a rule version that was not yet effective');
  }
  storedVersion(snapshot.rule_version.version_no, 'Stored commission rule version number');
  const values = ruleValues(snapshot.rule_version);
  const resolved = values.get(`SKU:${snapshot.sku_id_snapshot}`) ??
    values.get(`CATEGORY:${snapshot.category_id_snapshot}`) ?? values.get('PLATFORM');
  if (resolved === undefined || resolved.targetType !== snapshot.source_type ||
    !resolved.rate.equals(snapshot.effective_rate)) {
    throw internal('Stored commission snapshot rule hit cannot be reproduced');
  }
}

function detailSnapshot(record: RuleDetailRecord): CommissionRuleVersionSnapshot {
  if (record.base_version_id === null) {
    if (record.base_version !== null) throw internal('Stored commission rule has an unexpected base relation');
    return versionSnapshot(record, null);
  }
  if (record.base_version === null || record.base_version.id !== record.base_version_id) {
    throw internal('Stored commission rule base version is missing');
  }
  return versionSnapshot(record, validateRuleRecord(record.base_version));
}

function applyChanges(
  base: ReadonlyMap<string, RuleValue> | null,
  changes: readonly CommissionRuleChange[],
): Map<string, RuleValue> {
  const values = new Map(base ?? []);
  for (const change of changes) {
    const key = targetKey(change.targetType, change.targetId);
    if (change.configuredRate === null) {
      values.delete(key);
    } else {
      values.set(key, {
        rate: new Prisma.Decimal(change.configuredRate),
        targetId: change.targetId,
        targetKey: key,
        targetType: change.targetType,
      });
    }
  }
  if (!values.has('PLATFORM')) throw new TypeError('Commission rule requires a platform default');
  return values;
}

function resolveRule(values: ReadonlyMap<string, RuleValue>, sku: CatalogSku): RuleValue {
  const resolved = values.get(`SKU:${sku.skuId}`) ?? values.get(`CATEGORY:${sku.categoryId}`) ??
    values.get('PLATFORM');
  if (resolved === undefined) throw internal('Commission rule resolution has no platform default');
  return resolved;
}

function skuSnapshot(values: ReadonlyMap<string, RuleValue>, sku: CatalogSku): CommissionRuleSkuSnapshot {
  const resolved = resolveRule(values, sku);
  return {
    categoryId: sku.categoryId,
    categoryName: sku.categoryName,
    configuredRate: values.get(`SKU:${sku.skuId}`)?.rate.toFixed(4) ?? null,
    effectiveRate: resolved.rate.toFixed(4),
    productId: sku.productId,
    productName: sku.productName,
    skuCode: sku.skuCode,
    skuId: sku.skuId,
    source: resolved.targetType,
  };
}

function categorySnapshot(
  values: ReadonlyMap<string, RuleValue>,
  category: CatalogCategory,
): CommissionRuleCategorySnapshot {
  const configured = values.get(`CATEGORY:${category.categoryId}`);
  const resolved = configured ?? values.get('PLATFORM');
  if (resolved === undefined || (resolved.targetType !== 'CATEGORY' && resolved.targetType !== 'PLATFORM')) {
    throw internal('Commission category rule resolution is invalid');
  }
  return {
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    configuredRate: configured?.rate.toFixed(4) ?? null,
    effectiveRate: resolved.rate.toFixed(4),
    source: resolved.targetType,
  };
}

function impact(
  catalog: readonly CatalogSku[],
  before: ReadonlyMap<string, RuleValue> | null,
  after: ReadonlyMap<string, RuleValue>,
): CommissionRuleImpact {
  const affectedSkus = catalog.flatMap((sku) => {
    const next = skuSnapshot(after, sku);
    if (before === null) return [next];
    const previous = resolveRule(before, sku);
    return previous.targetType === next.source && previous.rate.toFixed(4) === next.effectiveRate ? [] : [next];
  });
  return {
    affectedSkuCount: affectedSkus.length,
    affectedSkus,
    changedTargetCount: diffRuleValues(after, before).length,
    warnings: ['Only payments completed after publication use the new commission rule version'],
  };
}

function historyFacts(records: readonly RuleRecord[]): {
  current: RuleRecord | null;
  currentValues: Map<string, RuleValue> | null;
  maxVersionNo: number;
} {
  const ids = new Set<string>();
  const versionNumbers = new Set<number>();
  let maxVersionNo = 0;
  const published: RuleRecord[] = [];
  for (const record of records) {
    storedUlid(record.id, 'Stored commission rule version ID');
    const versionNo = storedVersion(record.version_no, 'Stored commission rule version number');
    if (ids.has(record.id) || versionNumbers.has(versionNo)) throw internal('Stored commission rule history is duplicated');
    ids.add(record.id);
    versionNumbers.add(versionNo);
    maxVersionNo = Math.max(maxVersionNo, versionNo);
    if (record.status === 'PUBLISHED') published.push(record);
  }
  if (published.length > 1) throw internal('Published commission rule cardinality is invalid');
  if (published.length === 0 && records.length > 0) {
    throw internal('Commission rule history exists without a published version');
  }
  const current = published[0] ?? null;
  return {
    current,
    currentValues: current === null ? null : validateRuleRecord(current),
    maxVersionNo,
  };
}

function ruleAuditState(record: RuleRecord): CommissionRuleAuditState {
  return {
    status: 'PUBLISHED',
    version: storedVersion(record.version_no, 'Stored commission rule version number'),
    versionId: storedUlid(record.id, 'Stored commission rule version ID'),
  };
}

function commissionLedgerType(value: unknown, allowWithdrawal: boolean): CommissionLedgerKind {
  if (typeof value !== 'string' || !(allowWithdrawal ? COMMISSION_LEDGER_TYPES : COMMISSION_ONLY_LEDGER_TYPES)
    .has(value as CommissionLedgerKind)) throw internal('Stored commission ledger type is invalid');
  return value as CommissionLedgerKind;
}

function validateLedgerEnvelope(record: {
  available_change: unknown;
  expected_change: unknown;
  frozen_change: unknown;
  ledger_type: unknown;
  refund_id: string | null;
  snapshot_id: string | null;
  withdrawal_id: string | null;
}): CommissionLedgerKind {
  const type = commissionLedgerType(record.ledger_type, true);
  const expected = decimal(record.expected_change, 'Stored commission ledger expected change', true);
  const available = decimal(record.available_change, 'Stored commission ledger available change', true);
  const frozen = decimal(record.frozen_change, 'Stored commission ledger frozen change', true);
  if (record.snapshot_id !== null) storedUlid(record.snapshot_id, 'Stored commission ledger snapshot ID');
  if (record.refund_id !== null) storedUlid(record.refund_id, 'Stored commission ledger refund ID');
  if (record.withdrawal_id !== null) storedUlid(record.withdrawal_id, 'Stored commission ledger withdrawal ID');
  const valid = type === 'EXPECTED_CREATED'
    ? record.snapshot_id !== null && record.refund_id === null && record.withdrawal_id === null &&
      expected.isPositive() && available.isZero() && frozen.isZero()
    : type === 'EXPECTED_REDUCED' || type === 'EXPECTED_CANCELLED'
      ? record.snapshot_id !== null && record.refund_id !== null && record.withdrawal_id === null &&
        expected.isNegative() && available.isZero() && frozen.isZero()
      : type === 'AVAILABLE_CREDIT'
        ? record.snapshot_id !== null && record.refund_id === null && record.withdrawal_id === null &&
          expected.isNegative() && available.equals(expected.negated()) && frozen.isZero()
        : type === 'REFUND_DEBIT'
          ? record.snapshot_id !== null && record.refund_id !== null && record.withdrawal_id === null &&
            expected.isZero() && available.isNegative() && frozen.isZero()
          : type === 'WITHDRAWAL_FREEZE'
            ? record.snapshot_id === null && record.refund_id === null && record.withdrawal_id !== null &&
              expected.isZero() && available.isNegative() && frozen.equals(available.negated())
            : type === 'WITHDRAWAL_RELEASE'
              ? record.snapshot_id === null && record.refund_id === null && record.withdrawal_id !== null &&
                expected.isZero() && available.isPositive() && frozen.equals(available.negated())
              : record.snapshot_id === null && record.refund_id === null && record.withdrawal_id !== null &&
                expected.isZero() && available.isZero() && frozen.isNegative();
  if (!valid) throw internal('Stored commission ledger balance-change envelope is invalid');
  return type;
}

interface PositionMaterial {
  expectedRemaining: Prisma.Decimal;
  reversalTotal: Prisma.Decimal;
  state: CommissionPositionState;
}

function positionMaterial(snapshot: {
  id: string;
  original_commission: Prisma.Decimal;
  position: {
    expected_remaining: Prisma.Decimal;
    id: string;
    original_commission: Prisma.Decimal;
    reversed_total: Prisma.Decimal;
    snapshot_id: string;
    state: string;
    version: number;
  } | null;
}): PositionMaterial {
  const position = snapshot.position;
  if (position === null || position.snapshot_id !== snapshot.id) {
    throw internal('Stored commission position is missing or belongs to another snapshot');
  }
  storedUlid(position.id, 'Stored commission position ID');
  storedVersion(position.version, 'Stored commission position version');
  const original = decimal(snapshot.original_commission, 'Stored original commission', false);
  const positionOriginal = decimal(position.original_commission, 'Stored position original commission', false);
  const expected = decimal(position.expected_remaining, 'Stored expected commission', false);
  const reversed = decimal(position.reversed_total, 'Stored reversed commission', false);
  if (!positionOriginal.equals(original) || reversed.greaterThan(original) ||
    (position.state !== 'AVAILABLE' && position.state !== 'CANCELLED' && position.state !== 'EXPECTED' &&
      position.state !== 'NONE')) throw internal('Stored commission position is inconsistent');
  if (position.state === 'NONE') {
    if (!original.isZero() || !expected.isZero() || !reversed.isZero()) {
      throw internal('Stored NONE commission position is inconsistent');
    }
  } else if (position.state === 'EXPECTED') {
    if (expected.isZero() || !expected.add(reversed).equals(original)) {
      throw internal('Stored EXPECTED commission position is inconsistent');
    }
  } else if (position.state === 'CANCELLED') {
    if (!expected.isZero() || !reversed.equals(original)) {
      throw internal('Stored CANCELLED commission position is inconsistent');
    }
  } else if (!expected.isZero()) {
    throw internal('Stored AVAILABLE commission position is inconsistent');
  }
  return { expectedRemaining: expected, reversalTotal: reversed, state: position.state };
}

export function validateCommissionSnapshotLedgerClosure(snapshot: {
  agent_id: string;
  id: string;
  ledger: Array<{
    agent_id: string;
    available_change: Prisma.Decimal;
    expected_change: Prisma.Decimal;
    frozen_change: Prisma.Decimal;
    ledger_type: string;
    refund_id: string | null;
    snapshot_id: string | null;
    withdrawal_id: string | null;
  }>;
  original_commission: Prisma.Decimal;
  position: {
    expected_remaining: Prisma.Decimal;
    id: string;
    original_commission: Prisma.Decimal;
    reversed_total: Prisma.Decimal;
    snapshot_id: string;
    state: string;
    version: number;
  } | null;
}): void {
  const position = positionMaterial(snapshot);
  let expectedTotal = new Prisma.Decimal(0);
  let availableTotal = new Prisma.Decimal(0);
  for (const record of snapshot.ledger) {
    if (record.agent_id !== snapshot.agent_id || record.snapshot_id !== snapshot.id || record.withdrawal_id !== null) {
      throw internal('Stored commission ledger ownership is inconsistent');
    }
    const type = validateLedgerEnvelope(record);
    if (!COMMISSION_ONLY_LEDGER_TYPES.has(type)) {
      throw internal('Stored commission snapshot contains a withdrawal ledger');
    }
    expectedTotal = expectedTotal.add(record.expected_change);
    availableTotal = availableTotal.add(record.available_change);
  }
  const expectedAvailable = position.state === 'AVAILABLE'
    ? snapshot.original_commission.minus(position.reversalTotal)
    : new Prisma.Decimal(0);
  if (!expectedTotal.equals(position.expectedRemaining) || !availableTotal.equals(expectedAvailable)) {
    throw internal('Stored commission ledger does not close to its position');
  }
}

export async function validateAgentCommissionLedgerClosureInTransaction(
  transaction: DatabaseTransaction,
  agentId: string,
): Promise<void> {
  requireUlid(agentId, 'Commission closure Agent ID');
  const snapshots = await transaction.orderItemCommissionSnapshot.findMany({
    orderBy: [{ id: 'asc' }],
    select: COMMISSION_LEDGER_CLOSURE_SELECT,
    where: { agent_id: agentId },
  });
  for (const snapshot of snapshots) {
    const item = snapshot.order_item;
    const order = item.order;
    if (snapshot.agent_id !== agentId || snapshot.order_item_id !== item.id || item.order_id !== order.id ||
      snapshot.rule_version_id !== snapshot.rule_version.id || order.final_agent_id !== agentId ||
      order.final_channel !== 'AGENT' || order.payment_status !== 'PAID' || order.paid_at === null ||
      order.attribution_snapshot?.agent_id_snapshot !== agentId || snapshot.category_id_snapshot !== item.category_id ||
      snapshot.product_id_snapshot !== item.product_id || snapshot.sku_id_snapshot !== item.sku_id) {
      throw internal('Stored commission snapshot ownership or payment facts are inconsistent');
    }
    validateCommissionSnapshotRule(snapshot, order.paid_at);
    const base = decimal(snapshot.commission_base, 'Stored commission base', false);
    const linePaid = decimal(item.line_paid_amount, 'Stored commission order-item paid amount', false);
    const original = decimal(snapshot.original_commission, 'Stored original commission', false);
    const calculated = base.mul(snapshot.effective_rate).div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (!base.equals(linePaid) || !calculated.equals(original)) {
      throw internal('Stored commission snapshot amount facts are inconsistent');
    }
    validateCommissionSnapshotLedgerClosure(snapshot);
  }
}

function adminCommissionItem(record: AdminCommissionRecord, expectedAgentId: string): AdminAgentCommissionItem {
  const ledgerId = storedUlid(record.id, 'Stored commission ledger ID');
  if (record.agent_id !== expectedAgentId || record.snapshot === null || record.snapshot_id !== record.snapshot.id ||
    record.withdrawal_id !== null) throw internal('Stored Agent commission ownership is inconsistent');
  const ledgerType = validateLedgerEnvelope(record);
  if (!COMMISSION_ONLY_LEDGER_TYPES.has(ledgerType)) {
    throw internal('Stored Agent commission list contains a withdrawal ledger');
  }
  const snapshot = record.snapshot;
  storedUlid(snapshot.id, 'Stored commission snapshot ID');
  if (snapshot.agent_id !== expectedAgentId || snapshot.rule_version_id !== snapshot.rule_version.id ||
    snapshot.order_item_id !== snapshot.order_item.id) {
    throw internal('Stored commission snapshot references are inconsistent');
  }
  const item = snapshot.order_item;
  const order = item.order;
  if (order.payment_status !== 'PAID' || order.paid_at === null) {
    throw internal('Stored commission order payment is incomplete');
  }
  validateCommissionSnapshotRule(snapshot, order.paid_at);
  if (order.final_channel !== 'AGENT' || order.final_agent_id !== expectedAgentId || item.order_id !== order.id ||
    snapshot.category_id_snapshot !== item.category_id || snapshot.product_id_snapshot !== item.product_id ||
    snapshot.sku_id_snapshot !== item.sku_id) {
    throw internal('Stored commission order attribution is inconsistent');
  }
  const effectiveRate = rate(snapshot.effective_rate, 'Stored effective commission rate');
  const commissionBase = decimal(snapshot.commission_base, 'Stored commission base', false);
  const original = decimal(snapshot.original_commission, 'Stored original commission', false);
  const calculated = commissionBase.mul(snapshot.effective_rate).div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (!calculated.equals(original)) throw internal('Stored original commission cannot be reproduced');
  const position = positionMaterial(snapshot);
  validateCommissionSnapshotLedgerClosure(snapshot);
  return {
    agentId: expectedAgentId,
    availableChange: money(record.available_change, 'Stored commission available change', true),
    categoryId: storedUlid(snapshot.category_id_snapshot, 'Stored commission category ID'),
    categoryName: storedText(snapshot.category_name_snapshot, 120, 'Stored commission category name'),
    commissionBase: commissionBase.toFixed(2),
    commissionSnapshotId: snapshot.id,
    effectiveRate,
    expectedChange: money(record.expected_change, 'Stored commission expected change', true),
    expectedRemaining: position.expectedRemaining.toFixed(2),
    ledgerId,
    ledgerType: ledgerType as AdminAgentCommissionItem['ledgerType'],
    occurredAt: storedDate(record.occurred_at, 'Stored commission ledger time'),
    orderId: storedUlid(order.id, 'Stored commission order ID'),
    orderItemId: storedUlid(item.id, 'Stored commission order item ID'),
    orderNo: storedText(order.order_no, 32, 'Stored commission order number'),
    originalCommission: original.toFixed(2),
    positionState: position.state,
    productId: storedUlid(item.product_id, 'Stored commission product ID'),
    productName: storedText(item.product_name_snapshot, 200, 'Stored commission product name'),
    refundId: record.refund_id,
    reversalTotal: position.reversalTotal.toFixed(2),
    ruleSource: snapshot.source_type,
    ruleVersionId: storedUlid(snapshot.rule_version.id, 'Stored commission rule version ID'),
    ruleVersionNo: storedVersion(snapshot.rule_version.version_no, 'Stored commission rule version number'),
    skuId: storedUlid(item.sku_id, 'Stored commission SKU ID'),
    skuName: storedText(item.sku_name_snapshot, 160, 'Stored commission SKU name'),
  };
}

function explanationItem(
  item: ExplanationOrderRecord['items'][number],
  expectedAgentId: string,
  paidAt: Date,
): CommissionExplanationItem {
  const snapshot = item.commission_snapshot;
  if (snapshot === null || snapshot.order_item_id !== item.id || snapshot.agent_id !== expectedAgentId ||
    snapshot.product_id_snapshot !== item.product_id || snapshot.sku_id_snapshot !== item.sku_id ||
    snapshot.category_id_snapshot !== item.category_id || snapshot.rule_version_id !== snapshot.rule_version.id) {
    throw internal('Stored order-item commission snapshot is inconsistent');
  }
  validateCommissionSnapshotRule(snapshot, paidAt);
  const values = validateRuleRecord(snapshot.rule_version);
  const source = resolveRule(values, {
    categoryId: snapshot.category_id_snapshot,
    categoryName: snapshot.category_name_snapshot,
    productId: snapshot.product_id_snapshot,
    productName: item.product_name_snapshot,
    skuCode: item.sku_code_snapshot,
    skuId: snapshot.sku_id_snapshot,
  });
  if (source.targetType !== snapshot.source_type || !source.rate.equals(snapshot.effective_rate)) {
    throw internal('Stored commission rule hit cannot be reproduced');
  }
  const effectiveRate = rate(snapshot.effective_rate, 'Stored effective commission rate');
  const base = decimal(snapshot.commission_base, 'Stored commission base', false);
  const original = decimal(snapshot.original_commission, 'Stored original commission', false);
  if (!base.mul(snapshot.effective_rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .equals(original)) throw internal('Stored original commission cannot be reproduced');
  const position = positionMaterial(snapshot);
  validateCommissionSnapshotLedgerClosure(snapshot);
  const ledger = snapshot.ledger.map((record): CommissionExplanationLedgerSnapshot => {
    if (record.agent_id !== expectedAgentId || record.snapshot_id !== snapshot.id || record.withdrawal_id !== null) {
      throw internal('Stored commission explanation ledger ownership is inconsistent');
    }
    const type = validateLedgerEnvelope(record);
    if (!COMMISSION_ONLY_LEDGER_TYPES.has(type)) {
      throw internal('Stored commission explanation contains a withdrawal ledger');
    }
    return {
      availableChange: money(record.available_change, 'Stored commission available change', true),
      expectedChange: money(record.expected_change, 'Stored commission expected change', true),
      frozenChange: money(record.frozen_change, 'Stored commission frozen change', true),
      ledgerId: storedUlid(record.id, 'Stored commission ledger ID'),
      ledgerType: type as CommissionExplanationLedgerSnapshot['ledgerType'],
      occurredAt: storedDate(record.occurred_at, 'Stored commission ledger time'),
      reason: storedText(record.reason, 500, 'Stored commission ledger reason'),
      refundId: record.refund_id,
    };
  });
  const categoryEntry = values.get(`CATEGORY:${snapshot.category_id_snapshot}`);
  const skuEntry = values.get(`SKU:${snapshot.sku_id_snapshot}`);
  return {
    categoryId: storedUlid(snapshot.category_id_snapshot, 'Stored commission category ID'),
    categoryName: storedText(snapshot.category_name_snapshot, 120, 'Stored commission category name'),
    commissionBase: base.toFixed(2),
    commissionSnapshotId: storedUlid(snapshot.id, 'Stored commission snapshot ID'),
    effectiveRate,
    expectedRemaining: position.expectedRemaining.toFixed(2),
    hitPath: [
      `VERSION:${snapshot.rule_version.version_no}`,
      `PLATFORM:${values.get('PLATFORM')!.rate.toFixed(4)}`,
      categoryEntry === undefined
        ? `CATEGORY:${snapshot.category_id_snapshot}:INHERIT`
        : `CATEGORY:${snapshot.category_id_snapshot}:${categoryEntry.rate.toFixed(4)}`,
      skuEntry === undefined
        ? `SKU:${snapshot.sku_id_snapshot}:INHERIT`
        : `SKU:${snapshot.sku_id_snapshot}:${skuEntry.rate.toFixed(4)}`,
      `HIT:${snapshot.source_type}:${effectiveRate}`,
    ],
    ledger,
    orderItemId: storedUlid(item.id, 'Stored commission order item ID'),
    originalCommission: original.toFixed(2),
    positionState: position.state,
    productId: storedUlid(item.product_id, 'Stored commission product ID'),
    productName: storedText(item.product_name_snapshot, 200, 'Stored commission product name'),
    reversalTotal: position.reversalTotal.toFixed(2),
    roundingMode: 'HALF_UP',
    roundingScale: 2,
    ruleSource: snapshot.source_type,
    ruleVersionId: storedUlid(snapshot.rule_version.id, 'Stored commission rule version ID'),
    ruleVersionNo: storedVersion(snapshot.rule_version.version_no, 'Stored commission rule version number'),
    skuId: storedUlid(item.sku_id, 'Stored commission SKU ID'),
    skuName: storedText(item.sku_name_snapshot, 160, 'Stored commission SKU name'),
  };
}

export class CommissionRepository {
  constructor(private readonly prisma: PrismaClient) {}

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

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    return storedDate(rows[0]?.transaction_time, 'Database transaction time');
  }

  private async readChangeTargets(
    transaction: DatabaseTransaction,
    changes: readonly CommissionRuleChange[],
    lock: boolean,
  ): Promise<void> {
    const categoryIds = changes.flatMap(({ targetId, targetType }) =>
      targetType === 'CATEGORY' && targetId !== null ? [targetId] : []).sort();
    const skuIds = changes.flatMap(({ targetId, targetType }) =>
      targetType === 'SKU' && targetId !== null ? [targetId] : []).sort();
    const read = async (table: 'category' | 'sku', ids: readonly string[]): Promise<void> => {
      if (ids.length === 0) return;
      const rows = await transaction.$queryRaw<TargetRow[]>(lock ? Prisma.sql`
        SELECT id, deleted_at FROM public.${Prisma.raw(table)}
        WHERE id IN (${Prisma.join(ids, ', ')})
        ORDER BY id ASC
        FOR SHARE
      ` : Prisma.sql`
        SELECT id, deleted_at FROM public.${Prisma.raw(table)}
        WHERE id IN (${Prisma.join(ids, ', ')})
        ORDER BY id ASC
      `);
      if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index] || row.deleted_at !== null)) {
        throw notFound(`Commission rule ${table} target does not exist`);
      }
    };
    await read('category', categoryIds);
    await read('sku', skuIds);
  }

  private async readCatalog(transaction: DatabaseTransaction): Promise<CommissionCatalog> {
    const [records, categoryRecords] = await Promise.all([
      transaction.sku.findMany({
        orderBy: [{ id: 'asc' }],
        select: {
          code: true,
          id: true,
          product: {
            select: { category: { select: { name: true } }, category_id: true, id: true, name: true },
          },
        },
        where: {
          deleted_at: null,
          product: { deleted_at: null, category: { deleted_at: null } },
        },
      }),
      transaction.category.findMany({
        orderBy: [{ id: 'asc' }],
        select: { id: true, name: true },
        where: { deleted_at: null },
      }),
    ]);
    const seen = new Set<string>();
    const skus = records.map((record): CatalogSku => {
      const skuId = storedUlid(record.id, 'Stored commission catalog SKU ID');
      if (seen.has(skuId)) throw internal('Stored commission catalog contains a duplicate SKU');
      seen.add(skuId);
      return {
        categoryId: storedUlid(record.product.category_id, 'Stored commission catalog category ID'),
        categoryName: storedText(record.product.category.name, 120, 'Stored commission catalog category name'),
        productId: storedUlid(record.product.id, 'Stored commission catalog product ID'),
        productName: storedText(record.product.name, 200, 'Stored commission catalog product name'),
        skuCode: storedText(record.code, 80, 'Stored commission catalog SKU code'),
        skuId,
      };
    });
    const categories = categoryRecords.map((record): CatalogCategory => ({
      categoryId: storedUlid(record.id, 'Stored commission catalog category ID'),
      categoryName: storedText(record.name, 120, 'Stored commission catalog category name'),
    }));
    if (new Set(categories.map(({ categoryId }) => categoryId)).size !== categories.length) {
      throw internal('Stored commission catalog contains a duplicate category');
    }
    return { categories, skus };
  }

  private async readHistory(transaction: DatabaseTransaction, lock: boolean): Promise<RuleRecord[]> {
    let lockedIds: string[] | null = null;
    if (lock) {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM public.commission_rule_version
        ORDER BY version_no ASC, id ASC
        FOR UPDATE
      `);
      lockedIds = rows.map(({ id }) => storedUlid(id, 'Locked commission rule version ID'));
    }
    const records = await transaction.commissionRuleVersion.findMany({
      include: RULE_INCLUDE,
      orderBy: [{ version_no: 'asc' }, { id: 'asc' }],
    });
    if (lockedIds !== null && (lockedIds.length !== records.length ||
      lockedIds.some((id, index) => id !== records[index]?.id))) {
      throw internal('Commission rule history changed after its lock');
    }
    return records;
  }

  private previewFromFacts(
    action: CommissionRuleActionInput,
    records: readonly RuleRecord[],
    catalog: CommissionCatalog,
  ): CommissionRulePublishPreviewSnapshot {
    const facts = historyFacts(records);
    if (action.baseVersionId !== facts.current?.id && !(action.baseVersionId === null && facts.current === null)) {
      throw versionConflict('Commission rule base version changed');
    }
    const next = applyChanges(facts.currentValues, action.changes);
    const nextImpact = impact(catalog.skus, facts.currentValues, next);
    if (nextImpact.changedTargetCount === 0) throw stateConflict('Commission rule changes have no effect');
    return {
      action,
      currentPublishedId: facts.current?.id ?? null,
      impact: nextImpact,
      maxVersionNo: facts.maxVersionNo,
      resourceVersion: facts.current?.version_no ?? 0,
    };
  }

  async previewRulePublishInTransaction(
    transaction: DatabaseTransaction,
    input: CommissionRuleActionInput,
  ): Promise<CommissionRulePublishPreviewSnapshot> {
    const action = normalizeAction(input);
    await this.readChangeTargets(transaction, action.changes, false);
    const [records, catalog] = await Promise.all([
      this.readHistory(transaction, false),
      this.readCatalog(transaction),
    ]);
    return this.previewFromFacts(action, records, catalog);
  }

  previewRulePublish(input: CommissionRuleActionInput): Promise<CommissionRulePublishPreviewSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.previewRulePublishInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async publishRuleVersionInTransaction(
    transaction: DatabaseTransaction,
    input: CommissionRulePublishInput,
    hooks: CommissionRulePublishHooks,
  ): Promise<CommissionRulePublishResult> {
    const normalized = validatePublishInput(input);
    if (!plainObject(hooks) || typeof hooks.verifyPreview !== 'function') {
      throw new TypeError('Commission rule publish hooks are invalid');
    }
    await this.lockActor(transaction, normalized.actorAccountId);
    await this.readChangeTargets(transaction, normalized.changes, true);
    const catalog = await this.readCatalog(transaction);
    await acquireTransactionLock(transaction, 'commission-rule-config', ['singleton']);
    const records = await this.readHistory(transaction, true);
    const preview = this.previewFromFacts(normalized, records, catalog);
    if (preview.currentPublishedId !== normalized.expectedCurrentPublishedId ||
      preview.maxVersionNo !== normalized.expectedMaxVersionNo ||
      preview.resourceVersion !== normalized.expectedVersion) {
      throw versionConflict('Commission rule preview facts changed');
    }
    await hooks.verifyPreview(preview);
    const facts = historyFacts(records);
    const nextValues = applyChanges(facts.currentValues, normalized.changes);
    const occurredAt = await this.transactionTime(transaction);
    const nextVersionNo = facts.maxVersionNo + 1;
    if (nextVersionNo > MAX_POSTGRES_INTEGER) throw internal('Commission rule version is exhausted');
    const versionId = generateUlid(occurredAt.getTime());
    await transaction.commissionRuleVersion.create({
      data: {
        base_version_id: facts.current?.id ?? null,
        created_at: occurredAt,
        created_by_id: normalized.actorAccountId,
        effective_at: null,
        id: versionId,
        reason: normalized.reason,
        status: 'DRAFT',
        version_no: nextVersionNo,
      },
      select: { id: true },
    });
    await transaction.commissionRuleEntry.createMany({
      data: [...nextValues.values()].sort((left, right) => left.targetKey.localeCompare(right.targetKey))
        .map((entry) => ({
          configured_rate: entry.rate,
          created_at: occurredAt,
          id: generateUlid(occurredAt.getTime()),
          rule_version_id: versionId,
          target_id: entry.targetId,
          target_key: entry.targetKey,
          target_type: entry.targetType,
        })),
    });
    if (facts.current !== null) {
      const archived = await transaction.commissionRuleVersion.updateMany({
        data: { status: 'ARCHIVED' },
        where: { id: facts.current.id, status: 'PUBLISHED' },
      });
      if (archived.count !== 1) throw versionConflict('Published commission rule changed during archive');
    }
    const published = await transaction.commissionRuleVersion.updateMany({
      data: { effective_at: occurredAt, status: 'PUBLISHED' },
      where: { effective_at: null, id: versionId, status: 'DRAFT' },
    });
    if (published.count !== 1) throw versionConflict('New commission rule could not be published');
    const stored = await transaction.commissionRuleVersion.findUnique({
      include: RULE_INCLUDE,
      where: { id: versionId },
    });
    if (stored === null || stored.status !== 'PUBLISHED') throw internal('Published commission rule disappeared');
    const version = versionSnapshot(stored, facts.currentValues);
    return {
      after: ruleAuditState(stored),
      before: facts.current === null ? null : ruleAuditState(facts.current),
      impact: preview.impact,
      version,
    };
  }

  async getRuleVersionForReplayInTransaction(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    versionId: string,
  ): Promise<CommissionRuleVersionSnapshot> {
    requireUlid(actorAccountId, 'Commission rule replay actor Account ID');
    requireUlid(versionId, 'Commission rule replay version ID');
    await this.lockActor(transaction, actorAccountId);
    await acquireTransactionLock(transaction, 'commission-rule-config', ['singleton']);
    const records = await this.readHistory(transaction, true);
    const record = records.find(({ id }) => id === versionId);
    if (record === undefined || (record.status !== 'PUBLISHED' && record.status !== 'ARCHIVED')) {
      throw notFound('Commission rule version does not exist');
    }
    const base = record.base_version_id === null
      ? null
      : records.find(({ id }) => id === record.base_version_id);
    if (record.base_version_id !== null && base === undefined) {
      throw internal('Stored commission rule base version is missing');
    }
    return versionSnapshot(record, base === null || base === undefined ? null : validateRuleRecord(base));
  }

  async getCurrentRules(): Promise<CommissionCurrentRulesSnapshot> {
    return this.prisma.$transaction(async (transaction) => {
      const [records, catalog] = await Promise.all([
        this.readHistory(transaction, false),
        this.readCatalog(transaction),
      ]);
      const facts = historyFacts(records);
      if (facts.current === null || facts.currentValues === null) {
        throw notFound('Published commission rule does not exist');
      }
      return {
        categories: catalog.categories.map((category) => categorySnapshot(facts.currentValues!, category)),
        items: catalog.skus.map((sku) => skuSnapshot(facts.currentValues!, sku)),
        platformRate: facts.currentValues.get('PLATFORM')!.rate.toFixed(4),
        version: facts.current.version_no,
        versionId: facts.current.id,
        versionNo: facts.current.version_no,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listRuleSkus(input: CommissionRuleSkuListInput): Promise<CommissionRuleSkuListResult> {
    const keyword = validateRuleSkuList(input)?.toLocaleLowerCase('en-US');
    return this.prisma.$transaction(async (transaction) => {
      const [records, catalog] = await Promise.all([
        this.readHistory(transaction, false),
        this.readCatalog(transaction),
      ]);
      const facts = historyFacts(records);
      if (facts.current === null || facts.currentValues === null) {
        throw notFound('Published commission rule does not exist');
      }
      const filtered = catalog.skus.map((sku) => skuSnapshot(facts.currentValues!, sku)).filter((sku) =>
        (input.categoryId === undefined || sku.categoryId === input.categoryId) &&
        (input.source === undefined || sku.source === input.source) &&
        (keyword === undefined || sku.skuCode.toLocaleLowerCase('en-US').includes(keyword) ||
          sku.productName.toLocaleLowerCase('en-US').includes(keyword)));
      const total = storedCount(filtered.length, 'Commission rule SKU result count');
      const offset = (input.page - 1) * input.pageSize;
      return {
        items: filtered.slice(offset, offset + input.pageSize),
        total,
        versionId: facts.current.id,
        versionNo: facts.current.version_no,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listRuleVersions(input: CommissionRuleVersionListInput): Promise<CommissionRuleVersionListResult> {
    validateRuleVersionList(input);
    const where: Prisma.CommissionRuleVersionWhereInput = {
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined ? {} : {
        created_at: {
          ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
          ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
        },
      }),
    };
    return this.prisma.$transaction(async (transaction) => {
      const [records, totalValue] = await Promise.all([
        transaction.commissionRuleVersion.findMany({
          include: RULE_DETAIL_INCLUDE,
          orderBy: [{ version_no: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.commissionRuleVersion.count({ where }),
      ]);
      return {
        items: records.map(detailSnapshot),
        total: storedCount(totalValue, 'Stored commission rule version count'),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getRuleVersion(versionId: string): Promise<CommissionRuleVersionSnapshot> {
    requireUlid(versionId, 'Commission rule version ID');
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.commissionRuleVersion.findUnique({
        include: RULE_DETAIL_INCLUDE,
        where: { id: versionId },
      });
      if (record === null) throw notFound('Commission rule version does not exist');
      return detailSnapshot(record);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listAdminAgentCommissions(
    input: AdminAgentCommissionListInput,
  ): Promise<AdminAgentCommissionListResult> {
    validateAdminLedgerList(input, false);
    const where: Prisma.CommissionLedgerWhereInput = {
      agent_id: input.agentId,
      ledger_type: input.ledgerType ?? { in: [...COMMISSION_ONLY_LEDGER_TYPES] },
      ...(input.occurredAtFrom === undefined && input.occurredAtToExclusive === undefined ? {} : {
        occurred_at: {
          ...(input.occurredAtFrom === undefined ? {} : { gte: input.occurredAtFrom }),
          ...(input.occurredAtToExclusive === undefined ? {} : { lt: input.occurredAtToExclusive }),
        },
      }),
      snapshot_id: { not: null },
      ...(input.positionState === undefined ? {} : {
        snapshot: { is: { position: { is: { state: input.positionState } } } },
      }),
    };
    return this.prisma.$transaction(async (transaction) => {
      const agent = await transaction.agentProfile.findUnique({ select: { id: true }, where: { id: input.agentId } });
      if (agent === null) throw notFound('Agent does not exist');
      if (agent.id !== input.agentId) throw internal('Stored Agent commission identity is inconsistent');
      const [records, totalValue] = await Promise.all([
        transaction.commissionLedger.findMany({
          include: ADMIN_COMMISSION_INCLUDE,
          orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.commissionLedger.count({ where }),
      ]);
      return {
        items: records.map((record) => adminCommissionItem(record, input.agentId)),
        total: storedCount(totalValue, 'Stored Agent commission ledger count'),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listAdminAgentWalletLedger(
    input: AdminAgentWalletLedgerListInput,
  ): Promise<AdminAgentWalletLedgerListResult> {
    validateAdminLedgerList(input, true);
    const where: Prisma.CommissionLedgerWhereInput = {
      agent_id: input.agentId,
      ...(input.ledgerType === undefined ? {} : { ledger_type: input.ledgerType }),
      ...(input.occurredAtFrom === undefined && input.occurredAtToExclusive === undefined ? {} : {
        occurred_at: {
          ...(input.occurredAtFrom === undefined ? {} : { gte: input.occurredAtFrom }),
          ...(input.occurredAtToExclusive === undefined ? {} : { lt: input.occurredAtToExclusive }),
        },
      }),
    };
    return this.prisma.$transaction(async (transaction) => {
      const agent = await transaction.agentProfile.findUnique({
        select: {
          id: true,
          wallet: { select: { agent_id: true, available_balance: true, frozen_balance: true, id: true, version: true } },
        },
        where: { id: input.agentId },
      });
      if (agent === null) throw notFound('Agent does not exist');
      if (agent.id !== input.agentId || agent.wallet === null || agent.wallet.agent_id !== input.agentId) {
        throw internal('Stored Agent wallet is missing or inconsistent');
      }
      await validateAgentCommissionLedgerClosureInTransaction(transaction, input.agentId);
      storedUlid(agent.wallet.id, 'Stored Agent wallet ID');
      storedVersion(agent.wallet.version, 'Stored Agent wallet version');
      const [ledgerTotals, positionTotals, totalValue] = await Promise.all([
        transaction.commissionLedger.aggregate({
          _sum: { available_change: true, expected_change: true, frozen_change: true },
          where: { agent_id: input.agentId },
        }),
        transaction.orderItemCommissionPosition.aggregate({
          _sum: { expected_remaining: true },
          where: { snapshot: { agent_id: input.agentId } },
        }),
        transaction.commissionLedger.count({ where }),
      ]);
      const expectedTotal = decimal(ledgerTotals._sum.expected_change ?? new Prisma.Decimal(0),
        'Stored Agent expected ledger total', false);
      const availableTotal = decimal(ledgerTotals._sum.available_change ?? new Prisma.Decimal(0),
        'Stored Agent available ledger total', true);
      const frozenTotal = decimal(ledgerTotals._sum.frozen_change ?? new Prisma.Decimal(0),
        'Stored Agent frozen ledger total', false);
      const positionExpected = decimal(positionTotals._sum.expected_remaining ?? new Prisma.Decimal(0),
        'Stored Agent expected position total', false);
      const walletAvailable = decimal(agent.wallet.available_balance, 'Stored Agent available wallet balance', true);
      const walletFrozen = decimal(agent.wallet.frozen_balance, 'Stored Agent frozen wallet balance', false);
      if (!expectedTotal.equals(positionExpected) || !availableTotal.equals(walletAvailable) ||
        !frozenTotal.equals(walletFrozen)) {
        throw internal('Stored Agent wallet does not reconcile to immutable commission facts');
      }

      const typeFilter = input.ledgerType === undefined ? Prisma.sql`` : Prisma.sql`
        AND ledger_type = CAST(${input.ledgerType} AS public."CommissionLedgerType")
      `;
      const fromFilter = input.occurredAtFrom === undefined ? Prisma.sql`` : Prisma.sql`
        AND occurred_at >= ${input.occurredAtFrom}
      `;
      const toFilter = input.occurredAtToExclusive === undefined ? Prisma.sql`` : Prisma.sql`
        AND occurred_at < ${input.occurredAtToExclusive}
      `;
      const rows = await transaction.$queryRaw<WalletWindowRow[]>(Prisma.sql`
        WITH ledger_window AS MATERIALIZED (
          SELECT ledger.id, ledger.agent_id, ledger.snapshot_id, ledger.refund_id, ledger.withdrawal_id,
            ledger.ledger_type::text AS ledger_type, ledger.expected_change, ledger.available_change,
            ledger.frozen_change, ledger.occurred_at,
            CASE ledger.ledger_type
              WHEN 'EXPECTED_CREATED' THEN 10
              WHEN 'EXPECTED_REDUCED' THEN 20
              WHEN 'EXPECTED_CANCELLED' THEN 21
              WHEN 'AVAILABLE_CREDIT' THEN 30
              WHEN 'REFUND_DEBIT' THEN 40
              WHEN 'WITHDRAWAL_FREEZE' THEN 50
              WHEN 'WITHDRAWAL_RELEASE' THEN 60
              WHEN 'WITHDRAWAL_PAID' THEN 70
            END AS lifecycle_rank,
            SUM(ledger.expected_change) OVER (
              ORDER BY ledger.occurred_at ASC,
                CASE ledger.ledger_type
                  WHEN 'EXPECTED_CREATED' THEN 10 WHEN 'EXPECTED_REDUCED' THEN 20
                  WHEN 'EXPECTED_CANCELLED' THEN 21 WHEN 'AVAILABLE_CREDIT' THEN 30
                  WHEN 'REFUND_DEBIT' THEN 40 WHEN 'WITHDRAWAL_FREEZE' THEN 50
                  WHEN 'WITHDRAWAL_RELEASE' THEN 60 WHEN 'WITHDRAWAL_PAID' THEN 70
                END ASC,
                ledger.id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS expected_balance_after,
            SUM(ledger.available_change) OVER (
              ORDER BY ledger.occurred_at ASC,
                CASE ledger.ledger_type
                  WHEN 'EXPECTED_CREATED' THEN 10 WHEN 'EXPECTED_REDUCED' THEN 20
                  WHEN 'EXPECTED_CANCELLED' THEN 21 WHEN 'AVAILABLE_CREDIT' THEN 30
                  WHEN 'REFUND_DEBIT' THEN 40 WHEN 'WITHDRAWAL_FREEZE' THEN 50
                  WHEN 'WITHDRAWAL_RELEASE' THEN 60 WHEN 'WITHDRAWAL_PAID' THEN 70
                END ASC,
                ledger.id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS available_balance_after,
            SUM(ledger.frozen_change) OVER (
              ORDER BY ledger.occurred_at ASC,
                CASE ledger.ledger_type
                  WHEN 'EXPECTED_CREATED' THEN 10 WHEN 'EXPECTED_REDUCED' THEN 20
                  WHEN 'EXPECTED_CANCELLED' THEN 21 WHEN 'AVAILABLE_CREDIT' THEN 30
                  WHEN 'REFUND_DEBIT' THEN 40 WHEN 'WITHDRAWAL_FREEZE' THEN 50
                  WHEN 'WITHDRAWAL_RELEASE' THEN 60 WHEN 'WITHDRAWAL_PAID' THEN 70
                END ASC,
                ledger.id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS frozen_balance_after
          FROM public.commission_ledger AS ledger
          WHERE ledger.agent_id = ${input.agentId}
        )
        SELECT id, agent_id, snapshot_id, refund_id, withdrawal_id, ledger_type, expected_change,
          available_change, frozen_change, occurred_at, expected_balance_after, available_balance_after,
          frozen_balance_after
        FROM ledger_window
        WHERE TRUE ${typeFilter} ${fromFilter} ${toFilter}
        ORDER BY occurred_at DESC, lifecycle_rank DESC, id DESC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      `);
      const items = rows.map((row): AdminAgentWalletLedgerItem => {
        if (row.agent_id !== input.agentId) throw internal('Stored wallet ledger belongs to another Agent');
        const ledgerType = validateLedgerEnvelope(row);
        const expectedAfter = decimal(row.expected_balance_after, 'Stored expected ledger running balance', false);
        const availableAfter = decimal(row.available_balance_after, 'Stored available ledger running balance', true);
        const frozenAfter = decimal(row.frozen_balance_after, 'Stored frozen ledger running balance', false);
        const ledgerId = storedUlid(row.id, 'Stored wallet ledger ID');
        const referenceType = row.withdrawal_id !== null
          ? 'WITHDRAWAL'
          : row.refund_id !== null ? 'REFUND' : 'COMMISSION_LEDGER';
        return {
          agentId: input.agentId,
          availableBalanceAfter: availableAfter.toFixed(2),
          availableChange: money(row.available_change, 'Stored wallet ledger available change', true),
          expectedBalanceAfter: expectedAfter.toFixed(2),
          expectedChange: money(row.expected_change, 'Stored wallet ledger expected change', true),
          frozenBalanceAfter: frozenAfter.toFixed(2),
          frozenChange: money(row.frozen_change, 'Stored wallet ledger frozen change', true),
          ledgerType,
          occurredAt: storedDate(row.occurred_at, 'Stored wallet ledger time'),
          referenceId: row.withdrawal_id ?? row.refund_id ?? ledgerId,
          referenceType,
          refundId: row.refund_id,
          walletLedgerId: ledgerId,
        };
      });
      return { items, total: storedCount(totalValue, 'Stored Agent wallet ledger count') };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getOrderExplanation(orderId: string): Promise<OrderCommissionExplanation> {
    requireUlid(orderId, 'Commission explanation order ID');
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.salesOrder.findUnique({
        include: ORDER_EXPLANATION_INCLUDE,
        where: { id: orderId },
      });
      if (order === null) throw notFound('Order does not exist');
      storedUlid(order.id, 'Stored commission explanation order ID');
      const orderNo = storedText(order.order_no, 32, 'Stored commission explanation order number');
      const snapshots = order.items.filter(({ commission_snapshot: snapshot }) => snapshot !== null);
      if (order.final_channel === 'AGENT') {
        const agentId = storedUlid(order.final_agent_id, 'Stored commission explanation Agent ID');
        if (order.payment_status !== 'PAID' || order.paid_at === null || snapshots.length !== order.items.length) {
          throw internal('Stored Agent order has incomplete commission snapshots');
        }
        const paidAt = storedDate(order.paid_at, 'Stored commission explanation payment time');
        return {
          items: order.items.map((item) => explanationItem(item, agentId, paidAt)),
          orderId: order.id,
          orderNo,
        };
      }
      if (order.final_agent_id !== null || snapshots.length !== 0) {
        throw internal('Stored direct or unsettled order has unexpected commission snapshots');
      }
      return { items: [], orderId: order.id, orderNo };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
