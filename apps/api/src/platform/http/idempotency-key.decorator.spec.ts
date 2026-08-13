import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import { parseIdempotencyKeyHeader } from './idempotency-key.decorator';

describe('parseIdempotencyKeyHeader', () => {
  it('parses and canonicalizes one UUID value', () => {
    expect(parseIdempotencyKeyHeader('9B2C3D4E-5F60-4781-9234-56789ABCDEF0')).toBe(
      '9b2c3d4e-5f60-4781-9234-56789abcdef0',
    );
  });

  it.each([
    undefined,
    '',
    'not-a-uuid',
    ['9b2c3d4e-5f60-4781-9234-56789abcdef0'],
  ])('rejects a missing, invalid, or ambiguous value: %j', (value) => {
    try {
      parseIdempotencyKeyHeader(value);
      throw new Error('expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError);
      expect((error as ApplicationError).code).toBe('INVALID_ARGUMENT');
      expect((error as ApplicationError).details).toEqual([
        expect.objectContaining({ field: 'Idempotency-Key' }),
      ]);
    }
  });
});
