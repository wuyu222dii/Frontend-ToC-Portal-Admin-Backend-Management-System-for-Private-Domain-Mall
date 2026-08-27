import { describe, expect, it } from 'vitest';

import { parseStoreAddressId, parseStoreAddressWriteBody } from './store-address.dto';

const ADDRESS_ID = '01J00000000000000000000001';

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    city: ' 杭州市 ',
    detail: ' 滨江区江南大道 100 号 ',
    district: ' 滨江区 ',
    is_default: true,
    phone: '13800000000',
    province: ' 浙江省 ',
    recipient_name: ' 林晓月 ',
    ...overrides,
  };
}

describe('B8.3 Store address DTO', () => {
  it('parses the closed full-write shape and trims non-phone text', () => {
    expect(parseStoreAddressWriteBody(body())).toEqual({
      city: '杭州市',
      detail: '滨江区江南大道 100 号',
      district: '滨江区',
      isDefault: true,
      phone: '13800000000',
      province: '浙江省',
      recipientName: '林晓月',
    });
  });

  it.each([
    undefined,
    null,
    [],
    'address',
    body({ is_default: 'true' }),
    body({ phone: '1380000000' }),
    body({ phone: '138000000000' }),
    body({ phone: ' 13800000000' }),
    body({ phone: '１３８００００００００' }),
    body({ recipient_name: '   ' }),
    body({ recipient_name: 'A\nB' }),
    body({ province: 'A\u007fB' }),
    body({ province: 'A\u0085B' }),
    body({ city: 'A'.repeat(81) }),
    body({ district: '' }),
    body({ detail: 'A'.repeat(301) }),
    { ...body(), unexpected: true },
    (() => {
      const value = body();
      delete value.detail;
      return value;
    })(),
  ])('rejects an invalid or open address write body', (value) => {
    expect(() => parseStoreAddressWriteBody(value)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('counts Unicode code points at the frozen text limits', () => {
    expect(parseStoreAddressWriteBody(body({ recipient_name: '清'.repeat(80) })).recipientName)
      .toHaveLength(80);
    expect(() => parseStoreAddressWriteBody(body({ recipient_name: '清'.repeat(81) })))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(parseStoreAddressWriteBody(body({ detail: '洁'.repeat(300) })).detail).toHaveLength(300);
  });

  it('accepts only a strict Address ULID path value', () => {
    expect(parseStoreAddressId(ADDRESS_ID)).toBe(ADDRESS_ID);
    for (const value of ['', ADDRESS_ID.toLowerCase(), 'not-an-ulid', `${ADDRESS_ID}0`]) {
      expect(() => parseStoreAddressId(value)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
      );
    }
  });
});
