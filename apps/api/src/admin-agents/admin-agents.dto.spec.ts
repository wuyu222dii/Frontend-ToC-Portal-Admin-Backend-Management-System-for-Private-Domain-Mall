import { describe, expect, it } from 'vitest';

import {
  parseAdminAgentCreateBody,
  parseAdminAgentEmptyBody,
  parseAdminAgentListQuery,
  parseAdminAgentUpdateBody,
  parseAgentStatusConfirmationBody,
  parseInviteRotationActionBody,
  parseInviteStatusConfirmationBody,
  parseProductAuthorizationBody,
} from './admin-agents.dto';

const PRODUCT_A = '01J00000000000000000000001';
const PRODUCT_B = '01J00000000000000000000002';

describe('Admin Agent DTO parsing', () => {
  it('normalizes a bounded ASCII login name and optional contact values', () => {
    expect(parseAdminAgentCreateBody({
      contact_name: '  Contact  ',
      contact_phone: '13900001234',
      login_name: 'Agent.One',
      name: '  Demo Agent  ',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
    })).toEqual({
      contactName: 'Contact',
      contactPhone: '13900001234',
      loginName: 'agent.one',
      name: 'Demo Agent',
      productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
    });
  });

  it.each([
    ['Unicode login', { login_name: '代理商', contact_name: '', name: 'A',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS' }],
    ['short phone', { login_name: 'agent', contact_name: '', contact_phone: '1234', name: 'A',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS' }],
    ['null required contact', { login_name: 'agent', contact_name: null, name: 'A',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS' }],
    ['unknown field', { login_name: 'agent', contact_name: '', name: 'A', secret: 'x',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS' }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseAdminAgentCreateBody(body)).toThrow();
  });

  it('distinguishes omitted and explicitly cleared profile fields', () => {
    expect(parseAdminAgentUpdateBody({ contact_name: null })).toEqual({ contactName: null });
    expect(parseAdminAgentUpdateBody({ contact_phone: null })).toEqual({ contactPhone: null });
    expect(() => parseAdminAgentUpdateBody({ contact_phone: '' })).toThrow();
    expect(() => parseAdminAgentUpdateBody({})).toThrow();
  });

  it('parses inclusive Shanghai calendar dates into an exclusive upper bound', () => {
    const parsed = parseAdminAgentListQuery({ date_from: '2026-09-01', date_to: '2026-09-02' });
    expect(parsed.createdAtFrom?.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(parsed.createdAtToExclusive?.toISOString()).toBe('2026-09-02T16:00:00.000Z');
  });

  it('requires closed high-risk confirmation fields', () => {
    expect(parseAgentStatusConfirmationBody({
      confirmation_hash: 'a'.repeat(64),
      preview_token: `pvw_${'x'.repeat(32)}`,
      reason: 'Disable for test',
      target_status: 'DISABLED',
    })).toMatchObject({ targetStatus: 'DISABLED', reason: 'Disable for test' });
    expect(() => parseAgentStatusConfirmationBody({
      confirmation_hash: 'a'.repeat(64),
      preview_token: `pvw_${'x'.repeat(32)}`,
      reason: 'Disable for test',
      target_status: 'ACTIVE',
    })).toThrow();
  });

  it('rejects a body on the bodyless reactivate command', () => {
    expect(() => parseAdminAgentEmptyBody({ unexpected: true })).toThrow();
    expect(() => parseAdminAgentEmptyBody({})).not.toThrow();
    expect(() => parseAdminAgentEmptyBody(undefined)).not.toThrow();
  });

  it('closes and canonicalizes an Agent product whitelist', () => {
    expect(parseProductAuthorizationBody({
      mode: 'CUSTOM_WHITELIST',
      product_ids: [PRODUCT_B, PRODUCT_A],
    })).toEqual({ mode: 'CUSTOM_WHITELIST', productIds: [PRODUCT_A, PRODUCT_B] });
    expect(parseProductAuthorizationBody({
      mode: 'ALL_ACTIVE_PRODUCTS',
      product_ids: [],
    })).toEqual({ mode: 'ALL_ACTIVE_PRODUCTS', productIds: [] });
    expect(() => parseProductAuthorizationBody({
      mode: 'CUSTOM_WHITELIST',
      product_ids: [PRODUCT_A, PRODUCT_A],
    })).toThrow();
    expect(() => parseProductAuthorizationBody({
      mode: 'ALL_ACTIVE_PRODUCTS',
      product_ids: [PRODUCT_A],
    })).toThrow();
  });

  it('preserves omitted, null, and normalized invite-code expiries in closed actions', () => {
    expect(parseInviteRotationActionBody({ reason: 'Rotate compromised invite' }))
      .toEqual({ reason: 'Rotate compromised invite' });
    expect(parseInviteRotationActionBody({
      expires_at: '2026-09-03T12:30:00+12:00',
      reason: 'Rotate compromised invite',
    })).toEqual({ expiresAt: new Date('2026-09-03T00:30:00.000Z'), reason: 'Rotate compromised invite' });
    expect(parseInviteStatusConfirmationBody({
      confirmation_hash: 'a'.repeat(64),
      expires_at: null,
      preview_token: `pvw_${'x'.repeat(32)}`,
      reason: 'Disable campaign invite',
      status: 'DISABLED',
    })).toEqual({
      confirmationHash: 'a'.repeat(64),
      expiresAt: null,
      previewToken: `pvw_${'x'.repeat(32)}`,
      reason: 'Disable campaign invite',
      status: 'DISABLED',
    });
    expect(() => parseInviteRotationActionBody({
      expires_at: 'not-a-date',
      reason: 'Rotate compromised invite',
    })).toThrow();
    expect(() => parseInviteRotationActionBody({
      expires_at: '2026-02-30T00:00:00Z',
      reason: 'Rotate compromised invite',
    })).toThrow();
    expect(() => parseInviteRotationActionBody({
      expires_at: '9999-12-31T23:59:59-14:00',
      reason: 'Rotate compromised invite',
    })).toThrow();
    expect(() => parseInviteStatusConfirmationBody({
      confirmation_hash: 'a'.repeat(64),
      extra: true,
      preview_token: `pvw_${'x'.repeat(32)}`,
      reason: 'Disable campaign invite',
      status: 'DISABLED',
    })).toThrow();
  });
});
