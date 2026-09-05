import { describe, expect, it } from 'vitest';

import { StoreEnvelopeFormatError } from './store-client';
import {
  decodeAttributionCandidateCreate,
  decodeCustomerProfile,
  decodeCustomerSession,
  decodeDeletionPreview,
  decodeLegalDocuments,
  decodeWechatAuthData,
} from './store-identity-decoders';

const session = {
  access_token: 'a'.repeat(20),
  refresh_token: 'r'.repeat(20),
  role: 'CUSTOMER',
  assurance: 'WECHAT',
  access_expires_at: '2030-01-01T00:00:00.000Z',
  refresh_expires_at: '2030-02-01T00:00:00.000Z',
};

const candidate = {
  candidate_id: '01JTESTCANDIDATE0000000000',
  agent_id: '01JTESTAGENT00000000000000',
  display_name: '青序服务代理',
  confirmation_required: true,
  attribution_eligible: true,
  public_target_url: 'https://mall.example.test/products/one',
  expires_at: '2030-01-01T00:30:00.000Z',
  remaining_seconds: 1_800,
};

const impacts = [
  'REVOKE_ALL_SESSIONS',
  'END_SERVICE_AGENT_BINDING',
  'INVALIDATE_ATTRIBUTION_CANDIDATES',
  'ANONYMIZE_ACCOUNT_PROFILE',
  'DELETE_NON_TRANSACTIONAL_PII',
  'ANONYMIZE_AGENT_HISTORY',
  'RETAIN_REQUIRED_TRANSACTION_FACTS',
];

describe('B7 identity exact-shape response decoders', () => {
  it('accepts only CUSTOMER/WECHAT sessions with exact fields', () => {
    expect(decodeCustomerSession(session)).toEqual(session);
    expect(() => decodeCustomerSession({ ...session, role: 'SUPER_ADMIN' }))
      .toThrow(StoreEnvelopeFormatError);
    expect(() => decodeCustomerSession({ ...session, provider: 'MOCK' }))
      .toThrow(StoreEnvelopeFormatError);
  });

  it('rejects unsafe legal URLs and extra document fields', () => {
    const legal = {
      user_agreement: {
        type: 'USER_AGREEMENT', document_version: 'v1', title: '用户协议',
        content_url: 'https://legal.example.test/user', required: true,
      },
      privacy_policy: {
        type: 'PRIVACY_POLICY', document_version: 'v1', title: '隐私政策',
        content_url: 'https://legal.example.test/privacy', required: true,
      },
      phone_authorization: {
        type: 'PHONE_AUTHORIZATION', document_version: 'v1', title: '手机号授权说明',
        content_url: 'https://legal.example.test/phone', required: true,
      },
    };
    expect(decodeLegalDocuments(legal)).toEqual(legal);
    expect(() => decodeLegalDocuments({
      ...legal,
      user_agreement: { ...legal.user_agreement, content_url: 'https://' },
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeLegalDocuments({ ...legal, extra: true }))
      .toThrow(StoreEnvelopeFormatError);
  });

  it('enforces the login candidate discriminated union', () => {
    expect(decodeWechatAuthData({
      session,
      confirmation_required: false,
      candidate: null,
    })).toMatchObject({ confirmation_required: false });
    expect(() => decodeWechatAuthData({
      session,
      confirmation_required: false,
      candidate,
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeWechatAuthData({
      session,
      confirmation_required: true,
      candidate: null,
    })).toThrow(StoreEnvelopeFormatError);
  });

  it('enforces all-null or all-verified profile phone fields and mask consistency', () => {
    const profile = {
      customer_id: '01JTESTCUSTOMER00000000000',
      nickname: '青序用户',
      avatar_url: null,
      city: null,
      phone_tail: null,
      phone_masked: null,
      phone_source: null,
      phone_verified_at: null,
      version: 1,
    };
    expect(decodeCustomerProfile(profile)).toEqual(profile);
    expect(decodeCustomerProfile({
      ...profile,
      phone_tail: '8000',
      phone_masked: '138 **** 8000',
      phone_source: 'MOCK',
      phone_verified_at: '2030-01-01T00:00:00.000Z',
    })).toMatchObject({ phone_tail: '8000' });
    expect(() => decodeCustomerProfile({ ...profile, phone_tail: '8000' }))
      .toThrow(StoreEnvelopeFormatError);
    expect(() => decodeCustomerProfile({
      ...profile,
      phone_tail: '8000',
      phone_masked: '138****9999',
      phone_source: 'MOCK',
      phone_verified_at: '2030-01-01T00:00:00.000Z',
    })).toThrow(StoreEnvelopeFormatError);
  });

  it('enforces all three mutually exclusive candidate create branches', () => {
    expect(decodeAttributionCandidateCreate({
      candidate: {
        ...candidate,
        public_target_url: 'http://127.0.0.1:4173/products/one',
      },
      candidate_token: 't'.repeat(32),
      service_agent: null,
      public_fallback: null,
    })).toMatchObject({ candidate: { public_target_url: 'http://127.0.0.1:4173/products/one' } });
    expect(() => decodeAttributionCandidateCreate({
      candidate: { ...candidate, public_target_url: 'http://mall.example.test/products/one' },
      candidate_token: 't'.repeat(32),
      service_agent: null,
      public_fallback: null,
    })).toThrow(StoreEnvelopeFormatError);
    expect(decodeAttributionCandidateCreate({
      candidate,
      candidate_token: 't'.repeat(32),
      service_agent: null,
      public_fallback: null,
    })).toMatchObject({ candidate_token: 't'.repeat(32) });
    expect(decodeAttributionCandidateCreate({
      candidate: null,
      candidate_token: null,
      service_agent: {
        agent_id: candidate.agent_id,
        display_name: candidate.display_name,
        bound_at: '2030-01-01T00:00:00.000Z',
      },
      public_fallback: null,
    })).toMatchObject({ candidate: null });
    expect(decodeAttributionCandidateCreate({
      candidate: null,
      candidate_token: null,
      service_agent: null,
      public_fallback: {
        attribution_eligible: false,
        public_target_url: candidate.public_target_url,
      },
    })).toMatchObject({ public_fallback: { attribution_eligible: false } });
    expect(() => decodeAttributionCandidateCreate({
      candidate,
      candidate_token: 't'.repeat(32),
      service_agent: {
        agent_id: candidate.agent_id,
        display_name: candidate.display_name,
        bound_at: '2030-01-01T00:00:00.000Z',
      },
      public_fallback: null,
    })).toThrow(StoreEnvelopeFormatError);
  });

  it('enforces eligible and blocked deletion unions, order, and uniqueness', () => {
    expect(decodeDeletionPreview({
      eligible: true,
      blockers: [],
      impacts,
      preview_token: 'p'.repeat(32),
      confirmation_hash: 'a'.repeat(64),
      expires_at: '2030-01-01T00:05:00.000Z',
      account_version: 2,
    })).toMatchObject({ eligible: true });
    expect(decodeDeletionPreview({
      eligible: false,
      blockers: [
        { resource_type: 'ORDER', count: 1 },
        { resource_type: 'PAYMENT', count: 2 },
      ],
      impacts,
      preview_token: null,
      confirmation_hash: null,
      expires_at: null,
      account_version: 2,
    })).toMatchObject({ eligible: false });
    expect(() => decodeDeletionPreview({
      eligible: false,
      blockers: [],
      impacts,
      preview_token: null,
      confirmation_hash: null,
      expires_at: null,
      account_version: 2,
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeDeletionPreview({
      eligible: false,
      blockers: [
        { resource_type: 'PAYMENT', count: 1 },
        { resource_type: 'ORDER', count: 1 },
      ],
      impacts,
      preview_token: null,
      confirmation_hash: null,
      expires_at: null,
      account_version: 2,
    })).toThrow(StoreEnvelopeFormatError);
  });
});
