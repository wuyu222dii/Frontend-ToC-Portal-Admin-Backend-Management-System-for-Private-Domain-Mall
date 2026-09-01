import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

export interface AdminRefundItemQuantity {
  aftersaleItemId: string;
  quantity: number;
}

export interface AdminAftersaleRefundAction {
  items: AdminRefundItemQuantity[];
  reason: string;
}

export interface AdminAftersaleRefundConfirmation extends AdminAftersaleRefundAction {
  confirmationHash: string;
  previewToken: string;
}

export interface AdminRefundRetryAction {
  reason: string;
}

export interface AdminRefundRetryConfirmation extends AdminRefundRetryAction {
  confirmationHash: string;
  previewToken: string;
}

export interface AdminManualCompensationAction {
  amount: string;
  orderItemId: string;
  reason: string;
}

export interface AdminManualCompensationConfirmation extends AdminManualCompensationAction {
  confirmationHash: string;
  previewToken: string;
}

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

function exactFields(
  value: PlainRecord,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((field) => !accepted.has(field)) ||
    required.some((field) => !Object.hasOwn(value, field))) {
    return invalid(`${label} fields are invalid`);
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 2 || length > 500) return invalid(`${field} is invalid`);
  return normalized;
}

function ulid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function confirmationFields(body: PlainRecord): {
  confirmationHash: string;
  previewToken: string;
} {
  if (typeof body.preview_token !== 'string' ||
    body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !CONFIRMATION_HASH.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return { confirmationHash: body.confirmation_hash, previewToken: body.preview_token };
}

function refundItems(value: unknown): AdminRefundItemQuantity[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return invalid('items is invalid');
  }
  const items = value.map((entry, index) => {
    const item = plainRecord(entry, `items[${index}]`);
    exactFields(
      item,
      ['aftersale_item_id', 'quantity'],
      ['aftersale_item_id', 'quantity'],
      `items[${index}]`,
    );
    if (!Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1 ||
      (item.quantity as number) > 99) {
      return invalid(`items[${index}].quantity is invalid`);
    }
    return {
      aftersaleItemId: ulid(item.aftersale_item_id, `items[${index}].aftersale_item_id`),
      quantity: item.quantity as number,
    };
  });
  if (new Set(items.map(({ aftersaleItemId }) => aftersaleItemId)).size !== items.length) {
    return invalid('items contains duplicate aftersale_item_id values');
  }
  return items.sort((left, right) => left.aftersaleItemId.localeCompare(right.aftersaleItemId));
}

function aftersaleRefundAction(body: PlainRecord): AdminAftersaleRefundAction {
  return { items: refundItems(body.items), reason: text(body.reason, 'reason') };
}

function retryAction(body: PlainRecord): AdminRefundRetryAction {
  return { reason: text(body.reason, 'reason') };
}

function manualCompensationAction(body: PlainRecord): AdminManualCompensationAction {
  if (typeof body.amount !== 'string' || !POSITIVE_MONEY.test(body.amount)) {
    return invalid('amount is invalid');
  }
  return {
    amount: body.amount,
    orderItemId: ulid(body.order_item_id, 'order_item_id'),
    reason: text(body.reason, 'reason'),
  };
}

export function parseAdminRefundAftersaleId(value: string): string {
  return ulid(value, 'aftersale_id');
}

export function parseAdminRefundId(value: string): string {
  return ulid(value, 'refund_id');
}

export function parseAdminRefundOrderId(value: string): string {
  return ulid(value, 'order_id');
}

export function parseAdminAftersaleRefundBody(value: unknown): AdminAftersaleRefundAction {
  const body = plainRecord(value, 'Request body');
  exactFields(body, ['reason', 'items'], ['reason', 'items'], 'Request body');
  return aftersaleRefundAction(body);
}

export function parseAdminAftersaleRefundConfirmationBody(
  value: unknown,
): AdminAftersaleRefundConfirmation {
  const body = plainRecord(value, 'Request body');
  const fields = ['reason', 'items', 'preview_token', 'confirmation_hash'];
  exactFields(body, fields, fields, 'Request body');
  return { ...aftersaleRefundAction(body), ...confirmationFields(body) };
}

export function parseAdminRefundRetryBody(value: unknown): AdminRefundRetryAction {
  const body = plainRecord(value, 'Request body');
  exactFields(body, ['reason'], ['reason'], 'Request body');
  return retryAction(body);
}

export function parseAdminRefundRetryConfirmationBody(
  value: unknown,
): AdminRefundRetryConfirmation {
  const body = plainRecord(value, 'Request body');
  const fields = ['reason', 'preview_token', 'confirmation_hash'];
  exactFields(body, fields, fields, 'Request body');
  return { ...retryAction(body), ...confirmationFields(body) };
}

export function parseAdminManualCompensationBody(value: unknown): AdminManualCompensationAction {
  const body = plainRecord(value, 'Request body');
  const fields = ['order_item_id', 'amount', 'reason'];
  exactFields(body, fields, fields, 'Request body');
  return manualCompensationAction(body);
}

export function parseAdminManualCompensationConfirmationBody(
  value: unknown,
): AdminManualCompensationConfirmation {
  const body = plainRecord(value, 'Request body');
  const fields = ['order_item_id', 'amount', 'reason', 'preview_token', 'confirmation_hash'];
  exactFields(body, fields, fields, 'Request body');
  return { ...manualCompensationAction(body), ...confirmationFields(body) };
}

export function parseAdminRefundEmptyQuery(value: unknown): void {
  const query = plainRecord(value, 'Query');
  if (Object.keys(query).length > 0) return invalid('Query fields are invalid');
}
