import { describe, expect, it } from 'vitest';

import { isRetryableTransactionError } from './transaction';

describe('database retry logic', () => {
  it('only retries PostgreSQL serialization and deadlock failures', () => {
    expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
    expect(isRetryableTransactionError({ cause: { code: '40P01' } })).toBe(true);
    expect(isRetryableTransactionError({ code: 'P2034' })).toBe(true);
    expect(isRetryableTransactionError({
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { originalCode: '40001' },
        },
      },
    })).toBe(true);
    expect(isRetryableTransactionError({
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { sqlState: '40P01' },
        },
      },
    })).toBe(true);
    expect(isRetryableTransactionError({ code: 'P2010' })).toBe(false);
    expect(isRetryableTransactionError({ code: '23505' })).toBe(false);
    expect(isRetryableTransactionError(new Error('network failed'))).toBe(false);
  });
});
