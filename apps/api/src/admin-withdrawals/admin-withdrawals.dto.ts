import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MONEY = '9999999999999999.99';
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const WITHDRAWAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const;

export type AdminWithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export interface AdminWithdrawalListInput {
  agentId?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  maxAmount?: string;
  minAmount?: string;
  page: number;
  pageSize: number;
  status?: AdminWithdrawalStatus;
  withdrawalNo?: string;
}

export interface WithdrawalConfirmationInput {
  confirmationHash: string;
  previewToken: string;
}

export interface WithdrawalRejectInput {
  reason: string;
}

export interface WithdrawalRejectConfirmationInput extends WithdrawalRejectInput, WithdrawalConfirmationInput {}

export interface WithdrawalPayoutRevealInput {
  reauthGrant: string;
}

export interface WithdrawalProofsInput {
  fileIds: string[];
}

export interface WithdrawalMarkPaidInput {
  proofFileIds: string[];
}

export interface WithdrawalMarkPaidConfirmationInput extends WithdrawalMarkPaidInput, WithdrawalConfirmationInput {}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(`${label} must be a plain object`);
  }
  return value as PlainRecord;
}

function closedRecord(value: unknown, label: string, required: readonly string[]): PlainRecord {
  const record = plainRecord(value, label);
  if (Object.keys(record).length !== required.length ||
    required.some((field) => !Object.hasOwn(record, field)) ||
    Object.keys(record).some((field) => !required.includes(field))) {
    return invalid(`${label} fields are invalid`);
  }
  return record;
}

function boundedText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function shanghaiBoundary(value: unknown, field: 'date_from' | 'date_to', nextDay: boolean): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return new Date(parsed.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? DAY_MS : 0));
}

function money(value: unknown, field: 'min_amount' | 'max_amount'): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MONEY.test(value) || compareMoney(value, MAX_MONEY) > 0) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function compareMoney(left: string, right: string): number {
  const [leftInteger = '', leftFraction = ''] = left.split('.');
  const [rightInteger = '', rightFraction = ''] = right.split('.');
  if (leftInteger.length !== rightInteger.length) return leftInteger.length < rightInteger.length ? -1 : 1;
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}

function resourceId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function confirmationFields(body: PlainRecord): WithdrawalConfirmationInput {
  if (typeof body.preview_token !== 'string' || body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !CONFIRMATION_HASH.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return { confirmationHash: body.confirmation_hash, previewToken: body.preview_token };
}

function fileIds(value: unknown, field: 'file_ids' | 'proof_file_ids'): string[] {
  if (!Array.isArray(value) || value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !isValidUlid(item)) ||
    new Set(value).size !== value.length) {
    return invalid(`${field} is invalid`);
  }
  return [...value] as string[];
}

export function parseAdminWithdrawalId(value: string): string {
  return resourceId(value, 'withdrawal_id');
}

export function parseAdminWithdrawalEmptyQuery(value: unknown): void {
  if (Object.keys(plainRecord(value, 'Query')).length !== 0) return invalid('Query fields are invalid');
}

export function parseAdminWithdrawalListQuery(value: unknown): AdminWithdrawalListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set([
    'agent_id', 'date_from', 'date_to', 'max_amount', 'min_amount', 'page', 'page_size', 'status', 'withdrawal_no',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AdminWithdrawalListInput = {
    page: positiveInteger(query.page, 1, 2_147_483_647, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((output.page - 1) * output.pageSize > 2_147_483_647) return invalid('pagination offset is invalid');
  if (query.agent_id !== undefined) output.agentId = resourceId(query.agent_id, 'agent_id');
  if (query.withdrawal_no !== undefined) {
    output.withdrawalNo = boundedText(query.withdrawal_no, 'withdrawal_no', 1, 32);
  }
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !(WITHDRAWAL_STATUSES as readonly string[]).includes(query.status)) {
      return invalid('status is invalid');
    }
    output.status = query.status as AdminWithdrawalStatus;
  }
  const minAmount = money(query.min_amount, 'min_amount');
  const maxAmount = money(query.max_amount, 'max_amount');
  if (minAmount !== undefined) output.minAmount = minAmount;
  if (maxAmount !== undefined) output.maxAmount = maxAmount;
  if (minAmount !== undefined && maxAmount !== undefined && compareMoney(minAmount, maxAmount) > 0) {
    return invalid('min_amount must not be greater than max_amount');
  }
  if (query.date_from !== undefined) output.createdAtFrom = shanghaiBoundary(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) output.createdAtToExclusive = shanghaiBoundary(query.date_to, 'date_to', true);
  if (output.createdAtFrom !== undefined && output.createdAtToExclusive !== undefined &&
    output.createdAtFrom.getTime() >= output.createdAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  return output;
}

export function parseWithdrawalApprovePreviewBody(value: unknown): Record<string, never> {
  closedRecord(value, 'Request body', []);
  return {};
}

export function parseWithdrawalConfirmationBody(value: unknown): WithdrawalConfirmationInput {
  return confirmationFields(closedRecord(value, 'Request body', ['preview_token', 'confirmation_hash']));
}

export function parseWithdrawalRejectBody(value: unknown): WithdrawalRejectInput {
  const body = closedRecord(value, 'Request body', ['reason']);
  return { reason: boundedText(body.reason, 'reason', 2, 500) };
}

export function parseWithdrawalRejectConfirmationBody(value: unknown): WithdrawalRejectConfirmationInput {
  const body = closedRecord(value, 'Request body', ['reason', 'preview_token', 'confirmation_hash']);
  return { reason: boundedText(body.reason, 'reason', 2, 500), ...confirmationFields(body) };
}

export function parseWithdrawalPayoutRevealBody(value: unknown): WithdrawalPayoutRevealInput {
  const body = closedRecord(value, 'Request body', ['reauth_grant']);
  return { reauthGrant: boundedText(body.reauth_grant, 'reauth_grant', 16, 512) };
}

export function parseWithdrawalProofsBody(value: unknown): WithdrawalProofsInput {
  const body = closedRecord(value, 'Request body', ['file_ids']);
  return { fileIds: fileIds(body.file_ids, 'file_ids') };
}

export function parseWithdrawalMarkPaidBody(value: unknown): WithdrawalMarkPaidInput {
  const body = closedRecord(value, 'Request body', ['proof_file_ids']);
  return { proofFileIds: fileIds(body.proof_file_ids, 'proof_file_ids') };
}

export function parseWithdrawalMarkPaidConfirmationBody(value: unknown): WithdrawalMarkPaidConfirmationInput {
  const body = closedRecord(value, 'Request body', ['proof_file_ids', 'preview_token', 'confirmation_hash']);
  return { proofFileIds: fileIds(body.proof_file_ids, 'proof_file_ids'), ...confirmationFields(body) };
}
