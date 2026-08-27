import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

export interface StoreAddressWriteRequest {
  city: string;
  detail: string;
  district: string;
  isDefault: boolean;
  phone: string;
  province: string;
  recipientName: string;
}

type PlainRecord = Record<string, unknown>;

const WRITE_FIELDS = [
  'recipient_name',
  'phone',
  'province',
  'city',
  'district',
  'detail',
  'is_default',
] as const;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function exactObject(value: unknown): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be an object');
  }
  const body = value as PlainRecord;
  const allowed = new Set<string>(WRITE_FIELDS);
  if (WRITE_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function addressText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  if (/\p{Cc}/u.test(value)) {
    return invalid(`${field} is invalid`);
  }
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function phone(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{11}$/.test(value)) {
    return invalid('phone is invalid');
  }
  return value;
}

export function parseStoreAddressId(value: string): string {
  if (!isValidUlid(value)) return invalid('address_id is invalid');
  return value;
}

export function parseStoreAddressWriteBody(value: unknown): StoreAddressWriteRequest {
  const body = exactObject(value);
  if (typeof body.is_default !== 'boolean') return invalid('is_default is invalid');
  return {
    city: addressText(body.city, 'city', 80),
    detail: addressText(body.detail, 'detail', 300),
    district: addressText(body.district, 'district', 80),
    isDefault: body.is_default,
    phone: phone(body.phone),
    province: addressText(body.province, 'province', 80),
    recipientName: addressText(body.recipient_name, 'recipient_name', 80),
  };
}
