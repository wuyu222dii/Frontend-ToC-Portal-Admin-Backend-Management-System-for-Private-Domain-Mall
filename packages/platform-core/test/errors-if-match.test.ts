import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  assertIfMatch,
  formatVersionEtag,
  getApplicationErrorHttpStatus,
  parseIdempotencyKey,
  parseIfMatch,
} from '../src';

describe('application errors', () => {
  const fixturePhone = ['138', '0013', '8000'];

  it('uses the frozen HTTP mapping and OpenAPI error envelope', () => {
    const error = new ApplicationError('INVALID_ARGUMENT', 'Invalid input', [
      { field: 'quantity', reason: 'must be positive', rejected_value: '0' },
    ]);

    expect(error.httpStatus).toBe(400);
    expect(getApplicationErrorHttpStatus('RESOURCE_VERSION_CONFLICT')).toBe(409);
    expect(getApplicationErrorHttpStatus('SOFT_DELETED_KEY_RESERVED')).toBe(409);
    expect(getApplicationErrorHttpStatus('ACTIVE_PRODUCT_DEPENDENCY')).toBe(422);
    expect(getApplicationErrorHttpStatus('PRODUCT_PRIMARY_IMAGE_REQUIRED')).toBe(422);
    expect(getApplicationErrorHttpStatus('PRODUCT_ACTIVE_SKU_REQUIRED')).toBe(422);
    expect(getApplicationErrorHttpStatus('ACTIVE_SKU_DEPENDENCY')).toBe(422);
    expect(getApplicationErrorHttpStatus('ACTIVE_INVENTORY_RESERVATION')).toBe(422);
    expect(getApplicationErrorHttpStatus('INVENTORY_QUANTITY_OUT_OF_RANGE')).toBe(422);
    expect(getApplicationErrorHttpStatus('FILE_CONTENT_MISMATCH')).toBe(422);
    expect(error.toResponse('req_test')).toEqual({
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
      details: [{ field: 'quantity', reason: 'The value was rejected', rejected_value: null }],
      request_id: 'req_test',
    });
  });

  it.each([
    ['SOFT_DELETED_KEY_RESERVED', 'The archived business key is reserved'],
    ['ACTIVE_PRODUCT_DEPENDENCY', 'Active products must be deactivated or moved first'],
    ['PRODUCT_PRIMARY_IMAGE_REQUIRED', 'A product requires at least one ready public image'],
    ['PRODUCT_ACTIVE_SKU_REQUIRED', 'A product requires at least one active SKU'],
    ['ACTIVE_SKU_DEPENDENCY', 'Active SKUs must be deactivated first'],
    ['ACTIVE_INVENTORY_RESERVATION', 'Active inventory reservations must be released first'],
    ['INVENTORY_QUANTITY_OUT_OF_RANGE', 'The resulting inventory quantity is outside the supported range'],
    ['FILE_CONTENT_MISMATCH', 'The uploaded file does not match its declaration'],
  ] as const)('uses a fixed public message for catalog error %s', (code, message) => {
    expect(new ApplicationError(code, 'private implementation detail').toResponse('req_test')).toEqual({
      code,
      message,
      request_id: 'req_test',
    });
  });

  it.each([
    `phone_${fixturePhone.join('')}`,
    'recovery_code_ABCDEF123456',
    `body.phone_${fixturePhone.join('')}`,
    'body.recovery_code_ABCDEF123456',
  ])('does not echo an unregistered or sensitive field name: %s', (field) => {
    const response = new ApplicationError('INVALID_ARGUMENT', 'invalid', [
      { field, reason: 'dynamic reason', rejected_value: 'private' },
    ]).toResponse('req_0123456789abcdef0123456789abcdef');

    expect(response.details).toEqual([{ field: null, reason: 'The value was rejected', rejected_value: null }]);
  });

  it('keeps only registered protocol header fields', () => {
    const response = new ApplicationError('INVALID_ARGUMENT', 'invalid', [
      { field: 'If-Match', reason: 'dynamic reason' },
      { field: 'headers.if_match', reason: 'dynamic reason' },
    ]).toResponse('req_0123456789abcdef0123456789abcdef');

    expect(response.details).toEqual([
      { field: 'If-Match', reason: 'The value was rejected' },
      { field: 'headers.if_match', reason: 'The value was rejected' },
    ]);
  });

  it('forces a generic message and no details for every internal error', () => {
    const error = new ApplicationError('INTERNAL_ERROR', 'provider-sensitive-marker', [
      { field: 'credential', reason: 'raw database error', rejected_value: 'private-value' },
    ]);
    expect(error.toResponse('req_test')).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: 'req_test',
    });
    expect(error.message).not.toContain('provider-sensitive-marker');
    expect(error.details).toEqual([]);
  });

  it('uses fixed public text and never reflects dynamic client error values', () => {
    const error = new ApplicationError(
      'INVALID_ARGUMENT',
      'postgresql://mall_runtime:server-secret@example.test/postgres',
      [
        {
          field: 'password',
          reason: 'credential=private-value',
          rejected_value: 'private-value',
        },
        {
          field: 'If-Match',
          reason: 'Expected a strong ETag',
          rejected_value: 'Bearer private-token',
        },
      ],
    );

    expect(error.toResponse('request_1')).toEqual({
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
      request_id: 'request_1',
      details: [
        { field: null, reason: 'The value was rejected', rejected_value: null },
        { field: 'If-Match', reason: 'The value was rejected', rejected_value: null },
      ],
    });
  });

  it.each([
    fixturePhone.join(' '),
    fixturePhone.join('-'),
    '北京市朝阳区望京SOHO T1',
    '验证码 123456',
    'my password is secret123',
    'postgresql%3A%2F%2Fmall_runtime%3Asecret%40example.test%2Fpostgres',
    'openid=private-value',
  ])('does not expose an unclassified dynamic message: %s', (message) => {
    const response = new ApplicationError('STATE_CONFLICT', message, [
      { field: message, reason: message, rejected_value: message },
    ]).toResponse('request_2');

    expect(response).toEqual({
      code: 'STATE_CONFLICT',
      message: 'The resource state conflicts with this request',
      request_id: 'request_2',
      details: [{ field: null, reason: 'The value was rejected', rejected_value: null }],
    });
    expect(JSON.stringify(response)).not.toContain(message);
  });
});

describe('If-Match versions', () => {
  it('accepts only a quoted, positive PostgreSQL integer', () => {
    expect(parseIfMatch('"12"')).toBe(12);
    expect(formatVersionEtag(12)).toBe('"12"');
    expect(assertIfMatch('"12"', 12)).toBe(12);
  });

  it.each([undefined, '12', 'W/"12"', '"0"', '"01"', '"-1"', '"2147483648"', '"1", "2"']) (
    'rejects an invalid If-Match value: %s',
    (value) => {
      expect(() => parseIfMatch(value)).toThrow(ApplicationError);
    },
  );

  it('reports a resource conflict instead of silently accepting a stale version', () => {
    expect(() => assertIfMatch('"11"', 12)).toThrow(
      expect.objectContaining({ code: 'RESOURCE_VERSION_CONFLICT', httpStatus: 409 }),
    );
  });
});

describe('Idempotency-Key values', () => {
  it('accepts and canonicalizes an RFC 4122 UUID', () => {
    expect(parseIdempotencyKey('9B2C3D4E-5F60-4781-9234-56789ABCDEF0')).toBe(
      '9b2c3d4e-5f60-4781-9234-56789abcdef0',
    );
  });

  it.each([
    undefined,
    '',
    'not-a-uuid',
    '00000000-0000-0000-0000-000000000000',
    '9b2c3d4e-5f60-0781-9234-56789abcdef0',
    '9b2c3d4e-5f60-4781-1234-56789abcdef0',
  ])('rejects an invalid idempotency key: %j', (value) => {
    expect(() => parseIdempotencyKey(value)).toThrow(ApplicationError);
  });
});
