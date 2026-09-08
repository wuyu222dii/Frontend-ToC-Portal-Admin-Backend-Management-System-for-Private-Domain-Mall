import { describe, expect, it } from 'vitest';

import { hasControlCharacter, internalError, requirePage, requireUlid } from '../src';

describe('shared input guards', () => {
  it('rejects control characters and accepts ordinary text', () => {
    expect(hasControlCharacter('ok')).toBe(false);
    expect(hasControlCharacter('line\nbreak')).toBe(true);
    expect(hasControlCharacter('\u007f')).toBe(true);
  });

  it('requires a ULID', () => {
    expect(() => requireUlid('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'Sample ID')).not.toThrow();
    expect(() => requireUlid('not-a-ulid', 'Sample ID')).toThrow(/Sample ID must be a ULID/);
  });

  it('requires a bounded page', () => {
    expect(() => requirePage(1, 20)).not.toThrow();
    expect(() => requirePage(0, 20)).toThrow(/Page must be a positive integer/);
    expect(() => requirePage(1, 101)).toThrow(/Page size must be between 1 and 100/);
  });

  it('builds an internal application error', () => {
    const error = internalError('hidden');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.httpStatus).toBe(500);
  });
});
