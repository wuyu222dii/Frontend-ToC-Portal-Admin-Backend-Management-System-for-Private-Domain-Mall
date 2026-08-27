import { describe, expect, it } from 'vitest';

import {
  parseStorePhoneAuthorizationBody,
  parseStoreProfileUpdateBody,
} from './store-profile.dto';

function phoneAuthorizationBody() {
  return {
    provider_credential: 'mock:phone:13800000000',
    consent: {
      type: 'PHONE_AUTHORIZATION',
      document_version: 'phone-v1',
      accepted: true,
    },
  };
}

describe('B7.2 Store profile DTOs', () => {
  it('trims profile text, maps wire names and preserves explicit null clears', () => {
    expect(parseStoreProfileUpdateBody({
      nickname: '  Qing Xu  ',
      avatar_url: 'https://cdn.example.invalid/avatar/customer.png',
      city: '  Hangzhou  ',
    })).toEqual({
      nickname: 'Qing Xu',
      avatarUrl: 'https://cdn.example.invalid/avatar/customer.png',
      city: 'Hangzhou',
    });
    expect(parseStoreProfileUpdateBody({ nickname: null })).toEqual({ nickname: null });
    expect(parseStoreProfileUpdateBody({ avatar_url: null, city: null }))
      .toEqual({ avatarUrl: null, city: null });
  });

  it.each([
    null,
    [],
    {},
    { nickname: 'Qing Xu', extra: true },
    { nickname: '' },
    { nickname: '   ' },
    { nickname: 'x'.repeat(81) },
    { nickname: 'Qing\nXu' },
    { nickname: 1 },
    { city: '   ' },
    { city: 'Hang\u0000zhou' },
    { city: 'x'.repeat(121) },
    { avatar_url: '' },
    { avatar_url: 'http://cdn.example.invalid/avatar.png' },
    { avatar_url: 'https://user:secret@cdn.example.invalid/avatar.png' },
    { avatar_url: ' https://cdn.example.invalid/avatar.png' },
    { avatar_url: 'https://cdn.example.invalid/avatar.png ' },
    { avatar_url: 'https://cdn.example.invalid/avatar\n.png' },
    { avatar_url: `https://cdn.example.invalid/${'x'.repeat(501)}` },
  ])('rejects an open or malformed profile PATCH body %#', (body) => {
    expect(() => parseStoreProfileUpdateBody(body))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('parses the fixed phone authorization consent without retaining wire field names', () => {
    expect(parseStorePhoneAuthorizationBody(phoneAuthorizationBody())).toEqual({
      providerCredential: 'mock:phone:13800000000',
      consent: {
        type: 'PHONE_AUTHORIZATION',
        documentVersion: 'phone-v1',
        accepted: true,
      },
    });
  });

  it.each([
    null,
    [],
    { ...phoneAuthorizationBody(), provider: 'MOCK' },
    { consent: phoneAuthorizationBody().consent },
    { ...phoneAuthorizationBody(), provider_credential: '' },
    { ...phoneAuthorizationBody(), provider_credential: 'x'.repeat(513) },
    { ...phoneAuthorizationBody(), provider_credential: 'mock:phone:\n13800000000' },
    { ...phoneAuthorizationBody(), consent: { ...phoneAuthorizationBody().consent, accepted: false } },
    { ...phoneAuthorizationBody(), consent: { ...phoneAuthorizationBody().consent, type: 'PRIVACY_POLICY' } },
    { ...phoneAuthorizationBody(), consent: { ...phoneAuthorizationBody().consent, document_version: '' } },
    { ...phoneAuthorizationBody(), consent: { ...phoneAuthorizationBody().consent, document_version: 'x'.repeat(81) } },
    { ...phoneAuthorizationBody(), consent: { ...phoneAuthorizationBody().consent, document_version: 'phone\u007fv1' } },
    { ...phoneAuthorizationBody(), consent: { ...phoneAuthorizationBody().consent, extra: true } },
  ])('rejects an open or malformed phone authorization body %#', (body) => {
    expect(() => parseStorePhoneAuthorizationBody(body))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
