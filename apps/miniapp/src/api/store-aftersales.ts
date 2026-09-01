import type {
  StoreAftersale,
  StoreAftersaleCancelInput,
  StoreAftersaleConfirmInput,
  StoreAftersaleDetail,
  StoreAftersaleList,
  StoreAftersaleListQuery,
  StoreAftersalePreview,
  StoreAftersalePreviewInput,
  StoreAftersaleReturnShipmentInput,
} from '../types/store-aftersales';
import { authenticatedRequest, createIdempotencyKey } from './store-identity';
import { StoreEnvelopeFormatError } from './store-client';
import {
  decodeStoreAftersale,
  decodeStoreAftersaleDetail,
  decodeStoreAftersaleList,
  decodeStoreAftersalePreview,
} from './store-aftersale-decoders';

type RecordValue = Record<string, unknown>;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const confirmationHashPattern = /^[a-f0-9]{64}$/;
const calendarDatePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const aftersaleTypes = new Set(['REFUND_ONLY', 'RETURN_REFUND']);
const reasonCodes = new Set([
  'UNSHIPPED_NO_LONGER_NEEDED', 'ITEM_DAMAGED', 'ITEM_NOT_AS_DESCRIBED', 'WRONG_ITEM',
  'MISSING_ITEM', 'QUALITY_ISSUE', 'OTHER',
]);
const aftersaleStatuses = new Set([
  'PENDING_REVIEW', 'REJECTED', 'REFUNDING', 'WAITING_RETURN', 'WAITING_RECEIPT',
  'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN', 'REJECTED_AFTER_RETURN', 'REFUND_FAILED',
  'COMPLETED', 'CANCELLED',
]);

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
  field = 'input',
): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} is invalid`);
  }
  const current = value as RecordValue;
  const allowed = new Set([...required, ...optional]);
  if (!required.every((key) => Object.hasOwn(current, key)) ||
    Object.keys(current).some((key) => !allowed.has(key))) {
    throw new Error(`${field} is invalid`);
  }
  return current;
}

function ulid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ulidPattern.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function versionHeader(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('version is invalid');
  return `"${version}"`;
}

function enumValue(value: unknown, values: ReadonlySet<string>, field: string): string {
  if (typeof value !== 'string' || !values.has(value)) throw new Error(`${field} is invalid`);
  return value;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function normalizedText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || hasControlCharacter(value)) {
    throw new Error(`${field} is invalid`);
  }
  const normalized = value.trim();
  if (Array.from(normalized).length < minimum || Array.from(normalized).length > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function normalizeCreateInput(
  value: StoreAftersalePreviewInput | StoreAftersaleConfirmInput,
  action: 'PREVIEW' | 'CONFIRM',
): StoreAftersalePreviewInput | StoreAftersaleConfirmInput {
  const common = ['action', 'order_id', 'type', 'reason_code', 'items'];
  const optional = ['reason_text', 'evidence_file_ids'];
  const current = exactRecord(
    value,
    action === 'CONFIRM' ? [...common, 'preview_token', 'confirmation_hash'] : common,
    optional,
  );
  if (current.action !== action) throw new Error('action is invalid');
  const orderId = ulid(current.order_id, 'order_id');
  const type = enumValue(current.type, aftersaleTypes, 'type') as StoreAftersalePreviewInput['type'];
  const reasonCode = enumValue(current.reason_code, reasonCodes, 'reason_code') as StoreAftersalePreviewInput['reason_code'];
  let reasonText: string | null | undefined;
  if (current.reason_text === null) reasonText = null;
  else if (current.reason_text !== undefined) {
    reasonText = normalizedText(current.reason_text, 'reason_text', 2, 500);
  }
  if (reasonCode === 'OTHER' && (reasonText === undefined || reasonText === null)) {
    throw new Error('reason_text is invalid');
  }
  if (!Array.isArray(current.items) || current.items.length < 1 || current.items.length > 100) {
    throw new Error('items is invalid');
  }
  const items = current.items.map((entry) => {
    const item = exactRecord(entry, ['order_item_id', 'quantity'], [], 'items');
    if (!Number.isInteger(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 99) {
      throw new Error('quantity is invalid');
    }
    return {
      order_item_id: ulid(item.order_item_id, 'order_item_id'),
      quantity: Number(item.quantity),
    };
  }).sort((left, right) => left.order_item_id.localeCompare(right.order_item_id));
  if (new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) {
    throw new Error('order_item_id is duplicated');
  }
  let evidenceFileIds: string[] | undefined;
  if (current.evidence_file_ids !== undefined) {
    if (!Array.isArray(current.evidence_file_ids) || current.evidence_file_ids.length > 9) {
      throw new Error('evidence_file_ids is invalid');
    }
    evidenceFileIds = current.evidence_file_ids
      .map((entry) => ulid(entry, 'evidence_file_ids'))
      .sort((left, right) => left.localeCompare(right));
    if (new Set(evidenceFileIds).size !== evidenceFileIds.length) {
      throw new Error('evidence_file_ids is duplicated');
    }
  }
  const base = {
    action,
    order_id: orderId,
    type,
    reason_code: reasonCode,
    ...(reasonText === undefined ? {} : { reason_text: reasonText }),
    items,
    ...(evidenceFileIds === undefined ? {} : { evidence_file_ids: evidenceFileIds }),
  };
  if (action === 'PREVIEW') return base as StoreAftersalePreviewInput;
  const previewToken = current.preview_token;
  const confirmationHash = current.confirmation_hash;
  if (typeof previewToken !== 'string' || previewToken.length < 16 || previewToken.length > 512) {
    throw new Error('preview_token is invalid');
  }
  if (typeof confirmationHash !== 'string' || !confirmationHashPattern.test(confirmationHash)) {
    throw new Error('confirmation_hash is invalid');
  }
  return {
    ...base,
    action: 'CONFIRM',
    preview_token: previewToken,
    confirmation_hash: confirmationHash,
  } as StoreAftersaleConfirmInput;
}

export function normalizeStoreAftersaleConfirmInput(
  value: unknown,
): StoreAftersaleConfirmInput {
  return normalizeCreateInput(value as StoreAftersaleConfirmInput, 'CONFIRM') as StoreAftersaleConfirmInput;
}

function calendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !calendarDatePattern.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function normalizeListQuery(value: StoreAftersaleListQuery): StoreAftersaleListQuery {
  const current = exactRecord(value, [], [
    'page', 'page_size', 'aftersale_no', 'order_id', 'status', 'type', 'date_from', 'date_to',
  ], 'query');
  const result: StoreAftersaleListQuery = {};
  if (current.page !== undefined) {
    if (!Number.isInteger(current.page) || Number(current.page) < 1) throw new Error('page is invalid');
    result.page = Number(current.page);
  }
  if (current.page_size !== undefined) {
    if (!Number.isInteger(current.page_size) || Number(current.page_size) < 1 || Number(current.page_size) > 100) {
      throw new Error('page_size is invalid');
    }
    result.page_size = Number(current.page_size);
  }
  if (current.aftersale_no !== undefined) {
    result.aftersale_no = normalizedText(current.aftersale_no, 'aftersale_no', 1, 32);
  }
  if (current.order_id !== undefined) result.order_id = ulid(current.order_id, 'order_id');
  if (current.status !== undefined) {
    result.status = enumValue(current.status, aftersaleStatuses, 'status') as NonNullable<StoreAftersaleListQuery['status']>;
  }
  if (current.type !== undefined) {
    result.type = enumValue(current.type, aftersaleTypes, 'type') as NonNullable<StoreAftersaleListQuery['type']>;
  }
  if (current.date_from !== undefined) result.date_from = calendarDate(current.date_from, 'date_from');
  if (current.date_to !== undefined) result.date_to = calendarDate(current.date_to, 'date_to');
  if (result.date_from !== undefined && result.date_to !== undefined && result.date_from > result.date_to) {
    throw new Error('date range is invalid');
  }
  return result;
}

function normalizeCancelInput(value: StoreAftersaleCancelInput): StoreAftersaleCancelInput {
  const current = exactRecord(value, [], ['reason']);
  return current.reason === undefined
    ? {}
    : { reason: normalizedText(current.reason, 'reason', 2, 500) };
}

function normalizeReturnShipment(
  value: StoreAftersaleReturnShipmentInput,
): StoreAftersaleReturnShipmentInput {
  const current = exactRecord(value, ['carrier_code', 'carrier_name', 'tracking_no']);
  const carrierCode = normalizedText(current.carrier_code, 'carrier_code', 1, 40);
  const carrierName = normalizedText(current.carrier_name, 'carrier_name', 1, 80);
  const trackingNo = normalizedText(current.tracking_no, 'tracking_no', 1, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(carrierCode)) {
    throw new Error('carrier_code is invalid');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(trackingNo)) {
    throw new Error('tracking_no is invalid');
  }
  return { carrier_code: carrierCode, carrier_name: carrierName, tracking_no: trackingNo };
}

function targetDecoder<T extends { aftersale_id: string }>(
  aftersaleId: string,
  decoder: (value: unknown) => T,
): (value: unknown) => T {
  return (value) => {
    const decoded = decoder(value);
    if (decoded.aftersale_id !== aftersaleId) throw new StoreEnvelopeFormatError();
    return decoded;
  };
}

export function previewStoreAftersale(
  input: StoreAftersalePreviewInput,
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreAftersalePreview> {
  return authenticatedRequest('/store/aftersales', {
    data: normalizeCreateInput(input, 'PREVIEW'),
    decode: decodeStoreAftersalePreview,
    expectedStatus: 200,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function confirmStoreAftersale(
  input: StoreAftersaleConfirmInput,
  idempotencyKey: string,
): Promise<StoreAftersale> {
  return authenticatedRequest('/store/aftersales', {
    data: normalizeStoreAftersaleConfirmInput(input),
    decode: decodeStoreAftersale,
    expectedStatus: 201,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function listStoreAftersales(
  query: StoreAftersaleListQuery = {},
): Promise<StoreAftersaleList> {
  return authenticatedRequest('/store/aftersales', {
    decode: decodeStoreAftersaleList,
    query: normalizeListQuery(query),
  });
}

export function getStoreAftersale(aftersaleId: string): Promise<StoreAftersaleDetail> {
  const id = ulid(aftersaleId, 'aftersale_id');
  return authenticatedRequest(`/store/aftersales/${encodeURIComponent(id)}`, {
    decode: targetDecoder(id, decodeStoreAftersaleDetail),
  });
}

export function cancelStoreAftersale(
  aftersaleId: string,
  version: number,
  input: StoreAftersaleCancelInput = {},
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreAftersale> {
  const id = ulid(aftersaleId, 'aftersale_id');
  return authenticatedRequest(`/store/aftersales/${encodeURIComponent(id)}/cancel`, {
    data: normalizeCancelInput(input),
    decode: targetDecoder(id, decodeStoreAftersale),
    expectedStatus: 200,
    headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': versionHeader(version) },
    method: 'POST',
  });
}

export function submitStoreAftersaleReturnShipment(
  aftersaleId: string,
  input: StoreAftersaleReturnShipmentInput,
  version: number,
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreAftersale> {
  const id = ulid(aftersaleId, 'aftersale_id');
  return authenticatedRequest(`/store/aftersales/${encodeURIComponent(id)}/return-shipment`, {
    data: normalizeReturnShipment(input),
    decode: targetDecoder(id, decodeStoreAftersale),
    expectedStatus: 200,
    headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': versionHeader(version) },
    method: 'POST',
  });
}
