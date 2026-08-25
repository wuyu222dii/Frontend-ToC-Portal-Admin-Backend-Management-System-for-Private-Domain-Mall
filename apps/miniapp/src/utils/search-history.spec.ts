import { describe, expect, it } from 'vitest';

import { mergeSearchHistory, normalizeSearchTerm, parseSearchHistory } from './search-history';

describe('store search history', () => {
  it('normalizes the same 1 to 200 character boundary as the Store contract', () => {
    expect(normalizeSearchTerm('  cleanser  ')).toBe('cleanser');
    expect(normalizeSearchTerm('   ')).toBeNull();
    expect(normalizeSearchTerm('a'.repeat(200))).toBe('a'.repeat(200));
    expect(normalizeSearchTerm('a'.repeat(201))).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
  });

  it('drops malformed values and deduplicates case-insensitively', () => {
    expect(parseSearchHistory(['Cleanser', 'cleanser', '', 3, 'Shampoo'])).toEqual([
      'Cleanser',
      'Shampoo',
    ]);
  });

  it('moves the latest query first and keeps at most eight values', () => {
    const history = Array.from({ length: 8 }, (_, index) => `term-${index}`);
    expect(mergeSearchHistory(history, ' TERM-3 ')).toEqual([
      'TERM-3',
      'term-0',
      'term-1',
      'term-2',
      'term-4',
      'term-5',
      'term-6',
      'term-7',
    ]);
  });
});
