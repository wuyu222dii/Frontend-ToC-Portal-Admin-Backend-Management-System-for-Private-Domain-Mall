import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import { parseIfMatchHeader } from './if-match.decorator';

describe('parseIfMatchHeader', () => {
  it.each([
    ['"1"', 1],
    ['"12"', 12],
    ['"2147483647"', 2_147_483_647],
  ] as const)('parses %s', (header, expected) => {
    expect(parseIfMatchHeader(header)).toBe(expected);
  });

  it.each([
    undefined,
    '1',
    'W/"1"',
    '*',
    '"0"',
    '"01"',
    '"2147483648"',
    ['"1"', '"2"'],
  ])('rejects an invalid or ambiguous value: %j', (header) => {
    try {
      parseIfMatchHeader(header);
      throw new Error('expected parsing to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError);
      expect((error as ApplicationError).code).toBe('INVALID_ARGUMENT');
      expect((error as ApplicationError).details).toEqual([
        expect.objectContaining({ field: 'If-Match' }),
      ]);
    }
  });
});
