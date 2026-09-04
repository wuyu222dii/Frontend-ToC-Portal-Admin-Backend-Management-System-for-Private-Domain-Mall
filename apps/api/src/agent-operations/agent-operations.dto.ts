import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MONEY = '9999999999999999.99';
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

const ORDER_STATUSES = ['PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED'] as const;
const REFUND_PROGRESS_STATUSES = ['NONE', 'PARTIAL', 'FULL'] as const;
const REFUND_PROCESSING_STATUSES = ['IDLE', 'REFUNDING', 'FAILED'] as const;
const FULFILLMENT_STATUSES = [
  'NOT_STARTED',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
] as const;
const ORDER_SORTS = ['CREATED_DESC', 'PAID_DESC', 'AMOUNT_DESC'] as const;
const COMMISSION_LEDGER_TYPES = [
  'EXPECTED_CREATED',
  'EXPECTED_REDUCED',
  'EXPECTED_CANCELLED',
  'AVAILABLE_CREDIT',
  'REFUND_DEBIT',
] as const;
const COMMISSION_POSITION_STATES = ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE'] as const;
const WITHDRAWAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;

export interface AgentBankAccountWriteInput {
  accountHolder: string;
  accountNumber: string;
  bankName: string;
}

export interface AgentCreateWithdrawalInput {
  amount: string;
  bankAccountId: string;
}

export interface AgentDashboardQuery {
  days: 7 | 30;
}

export interface AgentCustomerListQuery {
  boundAtFrom?: Date;
  boundAtToExclusive?: Date;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface AgentOrderListQuery {
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  customerId?: string;
  fulfillmentStatus?: (typeof FULFILLMENT_STATUSES)[number];
  hasAftersale?: boolean;
  maxAmount?: string;
  minAmount?: string;
  orderNo?: string;
  orderStatus?: (typeof ORDER_STATUSES)[number];
  page: number;
  pageSize: number;
  refundProcessingStatus?: (typeof REFUND_PROCESSING_STATUSES)[number];
  refundProgressStatus?: (typeof REFUND_PROGRESS_STATUSES)[number];
  sort: (typeof ORDER_SORTS)[number];
}

export interface AgentCommissionListQuery {
  ledgerType?: (typeof COMMISSION_LEDGER_TYPES)[number];
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  orderNo?: string;
  page: number;
  pageSize: number;
  state?: (typeof COMMISSION_POSITION_STATES)[number];
}

export interface AgentWithdrawalListQuery {
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  maxAmount?: string;
  minAmount?: string;
  page: number;
  pageSize: number;
  status?: (typeof WITHDRAWAL_STATUSES)[number];
  withdrawalNo?: string;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Query must be a plain object');
  }
  return value as PlainRecord;
}

function exactBody(value: unknown, fields: readonly string[]): PlainRecord {
  const body = plainRecord(value);
  const allowed = new Set(fields);
  if (fields.some((field) => !Object.prototype.hasOwnProperty.call(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function boundedText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  if (Array.from(normalized).length < 1 || Array.from(normalized).length > maximum) {
    return invalid(`${field} is invalid`);
  }
  return normalized;
}

function requiredText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function optionalUlid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  fallback: T[number] | undefined,
  field: string,
): T[number] | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    return invalid(`${field} is invalid`);
  }
  return value as T[number];
}

function shanghaiBoundary(value: unknown, field: 'date_from' | 'date_to', nextDay: boolean): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const calendar = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return new Date(calendar.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? DAY_MS : 0));
}

function compareMoney(left: string, right: string): number {
  const [leftInteger = '', leftFraction = ''] = left.split('.');
  const [rightInteger = '', rightFraction = ''] = right.split('.');
  if (leftInteger.length !== rightInteger.length) return leftInteger.length < rightInteger.length ? -1 : 1;
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}

function money(value: unknown, field: 'max_amount' | 'min_amount'): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MONEY.test(value) || compareMoney(value, MAX_MONEY) > 0) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function positiveMoney(value: unknown): string {
  if (typeof value !== 'string' ||
    !/^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/.test(value)) {
    return invalid('amount is invalid');
  }
  return value;
}

function addDateRange(
  query: PlainRecord,
  output: { boundAtFrom?: Date; boundAtToExclusive?: Date } | {
    createdAtFrom?: Date;
    createdAtToExclusive?: Date;
  },
  customer: boolean,
): void {
  const from = query.date_from === undefined ? undefined : shanghaiBoundary(query.date_from, 'date_from', false);
  const to = query.date_to === undefined ? undefined : shanghaiBoundary(query.date_to, 'date_to', true);
  if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  if (customer) {
    const customerOutput = output as AgentCustomerListQuery;
    if (from !== undefined) customerOutput.boundAtFrom = from;
    if (to !== undefined) customerOutput.boundAtToExclusive = to;
  } else {
    const orderOutput = output as AgentOrderListQuery;
    if (from !== undefined) orderOutput.createdAtFrom = from;
    if (to !== undefined) orderOutput.createdAtToExclusive = to;
  }
}

export function parseAgentOperationsResourceId(
  value: string,
  field: 'commission_snapshot_id' | 'customer_id' | 'order_id' | 'withdrawal_id',
): string {
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

export function parseAgentBankAccountWriteBody(value: unknown): AgentBankAccountWriteInput {
  const body = exactBody(value, ['account_holder', 'bank_name', 'account_number']);
  if (typeof body.account_number !== 'string' || body.account_number.length < 6 ||
    body.account_number.length > 64 ||
    !/^(?=(?:[ -]*[0-9]){6,32}$)[0-9][0-9 -]*[0-9]$/.test(body.account_number)) {
    return invalid('account_number is invalid');
  }
  return {
    accountHolder: requiredText(body.account_holder, 'account_holder', 2, 120),
    accountNumber: body.account_number,
    bankName: requiredText(body.bank_name, 'bank_name', 2, 160),
  };
}

export function parseAgentCreateWithdrawalBody(value: unknown): AgentCreateWithdrawalInput {
  const body = exactBody(value, ['amount', 'bank_account_id']);
  if (typeof body.bank_account_id !== 'string' || !isValidUlid(body.bank_account_id)) {
    return invalid('bank_account_id is invalid');
  }
  return {
    amount: positiveMoney(body.amount),
    bankAccountId: body.bank_account_id,
  };
}

export function parseAgentOperationsEmptyQuery(value: unknown): void {
  if (Object.keys(plainRecord(value)).length !== 0) return invalid('Query fields are invalid');
}

export function parseAgentDashboardQuery(value: unknown): AgentDashboardQuery {
  const query = plainRecord(value);
  if (Object.keys(query).some((field) => field !== 'days')) return invalid('Query fields are invalid');
  const days = positiveInteger(query.days, 7, 30, 'days');
  if (days !== 7 && days !== 30) return invalid('days is invalid');
  return { days };
}

export function parseAgentCustomerListQuery(value: unknown): AgentCustomerListQuery {
  const query = plainRecord(value);
  const allowed = new Set(['date_from', 'date_to', 'keyword', 'page', 'page_size']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AgentCustomerListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((output.page - 1) * output.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  const keyword = boundedText(query.keyword, 'keyword', 200);
  if (keyword !== undefined) output.keyword = keyword;
  addDateRange(query, output, true);
  return output;
}

export function parseAgentOrderListQuery(value: unknown): AgentOrderListQuery {
  const query = plainRecord(value);
  const allowed = new Set([
    'customer_id',
    'date_from',
    'date_to',
    'fulfillment_status',
    'has_aftersale',
    'max_amount',
    'min_amount',
    'order_no',
    'order_status',
    'page',
    'page_size',
    'refund_processing_status',
    'refund_progress_status',
    'sort',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AgentOrderListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
    sort: enumValue(query.sort, ORDER_SORTS, 'CREATED_DESC', 'sort')!,
  };
  if ((output.page - 1) * output.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  const customerId = optionalUlid(query.customer_id, 'customer_id');
  const fulfillmentStatus = enumValue(
    query.fulfillment_status,
    FULFILLMENT_STATUSES,
    undefined,
    'fulfillment_status',
  );
  const maxAmount = money(query.max_amount, 'max_amount');
  const minAmount = money(query.min_amount, 'min_amount');
  const orderNo = boundedText(query.order_no, 'order_no', 32);
  const orderStatus = enumValue(query.order_status, ORDER_STATUSES, undefined, 'order_status');
  const refundProcessingStatus = enumValue(
    query.refund_processing_status,
    REFUND_PROCESSING_STATUSES,
    undefined,
    'refund_processing_status',
  );
  const refundProgressStatus = enumValue(
    query.refund_progress_status,
    REFUND_PROGRESS_STATUSES,
    undefined,
    'refund_progress_status',
  );
  if (query.has_aftersale !== undefined) {
    if (query.has_aftersale !== 'true' && query.has_aftersale !== 'false') {
      return invalid('has_aftersale is invalid');
    }
    output.hasAftersale = query.has_aftersale === 'true';
  }
  if (customerId !== undefined) output.customerId = customerId;
  if (fulfillmentStatus !== undefined) output.fulfillmentStatus = fulfillmentStatus;
  if (maxAmount !== undefined) output.maxAmount = maxAmount;
  if (minAmount !== undefined) output.minAmount = minAmount;
  if (orderNo !== undefined) output.orderNo = orderNo;
  if (orderStatus !== undefined) output.orderStatus = orderStatus;
  if (refundProcessingStatus !== undefined) output.refundProcessingStatus = refundProcessingStatus;
  if (refundProgressStatus !== undefined) output.refundProgressStatus = refundProgressStatus;
  addDateRange(query, output, false);
  if (minAmount !== undefined && maxAmount !== undefined && compareMoney(minAmount, maxAmount) > 0) {
    return invalid('min_amount must not be greater than max_amount');
  }
  return output;
}

export function parseAgentCommissionListQuery(value: unknown): AgentCommissionListQuery {
  const query = plainRecord(value);
  const allowed = new Set(['date_from', 'date_to', 'ledger_type', 'order_no', 'page', 'page_size', 'state']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AgentCommissionListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((output.page - 1) * output.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  const from = query.date_from === undefined
    ? undefined
    : shanghaiBoundary(query.date_from, 'date_from', false);
  const to = query.date_to === undefined
    ? undefined
    : shanghaiBoundary(query.date_to, 'date_to', true);
  if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  const ledgerType = enumValue(query.ledger_type, COMMISSION_LEDGER_TYPES, undefined, 'ledger_type');
  const orderNo = boundedText(query.order_no, 'order_no', 32);
  const state = enumValue(query.state, COMMISSION_POSITION_STATES, undefined, 'state');
  if (from !== undefined) output.occurredAtFrom = from;
  if (to !== undefined) output.occurredAtToExclusive = to;
  if (ledgerType !== undefined) output.ledgerType = ledgerType;
  if (orderNo !== undefined) output.orderNo = orderNo;
  if (state !== undefined) output.state = state;
  return output;
}

export function parseAgentWithdrawalListQuery(value: unknown): AgentWithdrawalListQuery {
  const query = plainRecord(value);
  const allowed = new Set([
    'date_from',
    'date_to',
    'max_amount',
    'min_amount',
    'page',
    'page_size',
    'status',
    'withdrawal_no',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AgentWithdrawalListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((output.page - 1) * output.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  const from = query.date_from === undefined
    ? undefined
    : shanghaiBoundary(query.date_from, 'date_from', false);
  const to = query.date_to === undefined
    ? undefined
    : shanghaiBoundary(query.date_to, 'date_to', true);
  if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  const maxAmount = money(query.max_amount, 'max_amount');
  const minAmount = money(query.min_amount, 'min_amount');
  if (minAmount !== undefined && maxAmount !== undefined && compareMoney(minAmount, maxAmount) > 0) {
    return invalid('min_amount must not be greater than max_amount');
  }
  const status = enumValue(query.status, WITHDRAWAL_STATUSES, undefined, 'status');
  const withdrawalNo = boundedText(query.withdrawal_no, 'withdrawal_no', 32);
  if (from !== undefined) output.createdAtFrom = from;
  if (to !== undefined) output.createdAtToExclusive = to;
  if (maxAmount !== undefined) output.maxAmount = maxAmount;
  if (minAmount !== undefined) output.minAmount = minAmount;
  if (status !== undefined) output.status = status;
  if (withdrawalNo !== undefined) output.withdrawalNo = withdrawalNo;
  return output;
}
