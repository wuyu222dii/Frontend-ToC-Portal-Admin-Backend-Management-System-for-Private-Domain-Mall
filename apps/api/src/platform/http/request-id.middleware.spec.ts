import { describe, expect, it } from 'vitest';

import { createRequestId } from './request-id.middleware';

describe('createRequestId', () => {
  const fixturePhone = ['138', '0013', '8000'];

  it('accepts a bounded visible client identifier', () => {
    const requestId = 'trace_0123456789abcdef0123456789abcdef';
    expect(createRequestId(requestId)).toBe(requestId);
  });

  it.each([
    undefined,
    '',
    'has spaces',
    '\nforged',
    'valid\r\nforged',
    '请求-1',
    ['one', 'two'],
    'a'.repeat(81),
    fixturePhone.join(''),
    fixturePhone.join('-'),
    fixturePhone.join('.'),
    'token-private-ABCDEF123456',
    'trace_0123456789abcdef0123456789abcdeg',
  ])(
    'replaces an unsafe client identifier: %j',
    (candidate) => {
      expect(createRequestId(candidate)).toMatch(/^req_[0-9a-f]{32}$/);
    },
  );
});
