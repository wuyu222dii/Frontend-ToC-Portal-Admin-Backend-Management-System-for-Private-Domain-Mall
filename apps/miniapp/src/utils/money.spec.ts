import { describe, expect, it } from 'vitest';

import { sumMoney } from './money';

describe('sumMoney', () => {
  it('adds contract-sized amounts without losing cents', () => {
    expect(sumMoney(['9999999999999999.99', '0.01'])).toBe('10000000000000000.00');
  });

  it('returns the closed zero representation for an empty list', () => {
    expect(sumMoney([])).toBe('0.00');
  });

  it('rejects values outside the money contract', () => {
    expect(() => sumMoney(['1.1'])).toThrow(TypeError);
    expect(() => sumMoney(['-1.00'])).toThrow(TypeError);
  });
});
