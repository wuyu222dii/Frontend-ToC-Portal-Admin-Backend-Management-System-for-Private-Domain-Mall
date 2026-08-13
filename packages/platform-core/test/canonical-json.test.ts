import { describe, expect, it } from 'vitest';

import { canonicalJson, hashResponse, hmacCanonicalJson, sha256Hex } from '../src';

const requestHashKey = Buffer.alloc(32, 0x35);

describe('canonical JSON hashing', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    const first = { z: [{ b: 2, a: 1 }, 3], a: { d: true, c: null } };
    const second = { a: { c: null, d: true }, z: [{ a: 1, b: 2 }, 3] };

    expect(canonicalJson(first)).toBe('{"a":{"c":null,"d":true},"z":[{"a":1,"b":2},3]}');
    const firstDigest = hmacCanonicalJson(first, requestHashKey, 'idempotency-request');
    expect(firstDigest).toBe(hmacCanonicalJson(second, requestHashKey, 'idempotency-request'));
    expect(firstDigest).not.toBe(hashResponse(first));
    expect(firstDigest).not.toBe(hmacCanonicalJson(first, requestHashKey, 'idempotency-response'));
    expect(firstDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashes UTF-8 bytes', () => {
    expect(sha256Hex('qingxu')).toBe('d628fc10e70efe499350a5f29e0ab4e38b257186c546aac11655eb5bc34800c4');
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, Symbol('value')])(
    'rejects non-JSON input: %s',
    (value) => {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    },
  );

  it('rejects circular and non-plain values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => canonicalJson(circular)).toThrow('circular');
    expect(() => canonicalJson(new Date())).toThrow('plain objects');
  });

  it('rejects sparse arrays instead of producing invalid JSON text', () => {
    const sparse = new Array<unknown>(1);

    expect(() => canonicalJson(sparse)).toThrow('sparse arrays');
  });

  it('requires a strong independent HMAC key', () => {
    expect(() => hmacCanonicalJson({ password: 'not-persisted' }, Buffer.alloc(31), 'idempotency-request'))
      .toThrow('at least 32 bytes');
  });
});
