import { describe, expect, it } from 'vitest';

import { generateUlid, isValidUlid } from '../src';

describe('ULID identifiers', () => {
  it('generates database-compatible Crockford Base32 identifiers', () => {
    const identifier = generateUlid(1_700_000_000_000);

    expect(identifier).toHaveLength(26);
    expect(isValidUlid(identifier)).toBe(true);
  });

  it.each([
    '01HF7YAT00ABCDEFGHJKMNPQRST',
    '01hf7yat00abcdefghjkmnpqrs',
    '01HF7YAT00ABCDEFGHJKMNPQRI',
    '01HF7YAT00ABCDEFGHJKMNPQR',
    1,
    null,
  ])('rejects values outside the migration ULID grammar: %s', (value) => {
    expect(isValidUlid(value)).toBe(false);
  });
});
