const moneyPattern = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;

export function sumMoney(values: readonly string[]): string {
  const cents = values.reduce((total, value) => {
    if (!moneyPattern.test(value)) throw new TypeError('money amount is invalid');
    return total + BigInt(value.replace('.', ''));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
