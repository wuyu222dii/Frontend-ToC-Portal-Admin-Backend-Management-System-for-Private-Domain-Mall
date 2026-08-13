import { createHash, createHmac } from 'node:crypto';

type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON does not support non-finite numbers');
    }

    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Canonical JSON does not support ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON does not support circular values');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) {
        throw new TypeError('Canonical JSON does not support sparse arrays');
      }
      return `[${value.map((item) => canonicalize(item, ancestors)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON only supports plain objects');
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], ancestors)}`);
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function strongHmacKey(key: Uint8Array): Buffer {
  if (key.byteLength < 32) {
    throw new TypeError('Canonical JSON HMAC keys must contain at least 32 bytes');
  }
  return Buffer.from(key);
}

export function hmacCanonicalJson(
  value: unknown,
  key: Uint8Array,
  domain: 'idempotency-request' | 'idempotency-response',
): string {
  return createHmac('sha256', strongHmacKey(key))
    .update(`qingxu:${domain}:v1\0`, 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

export function hashResponse(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
