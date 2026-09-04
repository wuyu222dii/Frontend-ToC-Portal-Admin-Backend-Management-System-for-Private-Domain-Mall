import { describe, expect, it } from 'vitest';

import { formatMoney, formatRate, moneyMinor, sumNonNegativeMoney } from './presentation';

describe('agent presentation values', () => {
  it('formats contract money and rates without floating point conversion', () => {
    expect(formatMoney('12345678901234567890.12')).toBe('¥ 12,345,678,901,234,567,890.12');
    expect(formatMoney('-6.00')).toBe('- ¥ 6.00');
    expect(formatRate('0.0000')).toBe('0%');
    expect(formatRate('12.5000')).toBe('12.5%');
  });

  it('compares money through exact minor units', () => {
    expect(moneyMinor('9007199254740993.01')).toBe(900719925474099301n);
    expect(moneyMinor('-0.01')).toBe(-1n);
    expect(moneyMinor('1.1')).toBeNull();
    expect(sumNonNegativeMoney(['9999999999999999.99', '0.01'])).toBe('10000000000000000.00');
  });
});
