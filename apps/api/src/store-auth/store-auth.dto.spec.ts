import { describe, expect, it } from 'vitest';

import {
  parseStoreAuthEmptyQuery,
  parseStoreEmptyBody,
  parseStoreRefreshBody,
  parseStoreWechatLoginBody,
} from './store-auth.dto';

function loginBody() {
  return {
    code: 'mock:customer_0001',
    consents: [
      { type: 'USER_AGREEMENT', document_version: 'user-v1', accepted: true },
      { type: 'PRIVACY_POLICY', document_version: 'privacy-v1', accepted: true },
    ],
  };
}

describe('B7.1 Store auth DTOs', () => {
  it('parses the ordered two-consent login tuple without retaining wire field names', () => {
    expect(parseStoreWechatLoginBody(loginBody())).toEqual({
      candidateToken: null,
      code: 'mock:customer_0001',
      consents: [
        { type: 'USER_AGREEMENT', documentVersion: 'user-v1', accepted: true },
        { type: 'PRIVACY_POLICY', documentVersion: 'privacy-v1', accepted: true },
      ],
    });
    expect(parseStoreWechatLoginBody({
      ...loginBody(),
      candidate_token: 'c'.repeat(32),
    }).candidateToken).toBe('c'.repeat(32));
  });

  it.each([
    null,
    [],
    { ...loginBody(), extra: true },
    { ...loginBody(), code: '' },
    { ...loginBody(), code: 'x'.repeat(513) },
    { ...loginBody(), candidate_token: 'short' },
    { ...loginBody(), consents: [loginBody().consents[0]] },
    { ...loginBody(), consents: [...loginBody().consents].reverse() },
    { ...loginBody(), consents: [loginBody().consents[0], loginBody().consents[0]] },
    {
      ...loginBody(),
      consents: [
        { ...loginBody().consents[0], accepted: false },
        loginBody().consents[1],
      ],
    },
    {
      ...loginBody(),
      consents: [
        { ...loginBody().consents[0], extra: true },
        loginBody().consents[1],
      ],
    },
  ])('rejects an open or malformed login body %#', (body) => {
    expect(() => parseStoreWechatLoginBody(body)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('closes refresh, logout body and query inputs', () => {
    expect(parseStoreRefreshBody({ refresh_token: 'rfr_01234567890123456789' }))
      .toEqual({ refreshToken: 'rfr_01234567890123456789' });
    expect(() => parseStoreRefreshBody({ refresh_token: 'short' })).toThrow();
    expect(() => parseStoreRefreshBody({ refresh_token: 'r'.repeat(20), extra: true })).toThrow();
    expect(parseStoreEmptyBody(undefined)).toBeUndefined();
    expect(parseStoreEmptyBody({})).toBeUndefined();
    expect(() => parseStoreEmptyBody({ acknowledged: true })).toThrow();
    expect(parseStoreAuthEmptyQuery({})).toBeUndefined();
    expect(() => parseStoreAuthEmptyQuery({ page: '1' })).toThrow();
  });
});
