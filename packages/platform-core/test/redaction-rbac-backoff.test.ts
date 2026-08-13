import { describe, expect, it } from 'vitest';

import {
  AUDIT_SENSITIVE_CHANGE,
  REDACTED_VALUE,
  calculateOutboxBackoffMs,
  hasAllPermissions,
  hasPermission,
  hasRole,
  isSensitiveFieldName,
  isSensitiveText,
  redactAuditValue,
  redactLogValue,
  redactValueByAllowlist,
  type RbacPrincipal,
} from '../src';

describe('allowlist-oriented redaction', () => {
  it('preserves approved operational fields and recursively redacts everything else', () => {
    const circular: Record<string, unknown> = {
      request_id: 'req_01',
      order_id: 'order_01',
      password: 'never-log-this',
      nested: {
        status: 'FAILED',
        phone: 'full-phone-value',
      },
    };
    circular.circular = circular;

    expect(redactLogValue(circular)).toEqual({
      request_id: 'req_01',
      order_id: 'order_01',
      password: REDACTED_VALUE,
      nested: REDACTED_VALUE,
      circular: REDACTED_VALUE,
    });
  });

  it('does not allow a caller allowlist to expose known sensitive field names', () => {
    expect(
      redactValueByAllowlist(
        {
          status: 'ACTIVE',
          refresh_token: 'token-value',
          profile: { status: 'READY', secret: 'secret-value' },
        },
        { allowedFields: ['status', 'refresh_token', 'profile', 'secret'] },
      ),
    ).toEqual({
      status: 'ACTIVE',
      refresh_token: REDACTED_VALUE,
      profile: { status: 'READY', secret: REDACTED_VALUE },
    });
  });

  it('uses the frozen audit display marker for omitted and sensitive values', () => {
    expect(
      redactAuditValue(
        { version: 2, nickname: 'visible-only-if-approved', password_hash: 'hash-value' },
        ['version', 'nickname', 'password_hash'],
      ),
    ).toEqual({
      version: 2,
      nickname: 'visible-only-if-approved',
      password_hash: AUDIT_SENSITIVE_CHANGE,
    });
  });

  const sensitivePhone = ['contact: 138', '1234', '5678'].join('');

  it.each([
    'Bearer access-token-value',
    'Basic dXNlcjpwYXNzd29yZA==',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMUhGN1lBVDAwIn0.signature-value',
    'postgresql://mall_runtime:database-password@database.example.com:5432/postgres',
    'https://api-user:api-password@example.com/private',
    '4111 1111 1111 1111',
    '6222 0212 3456 7896',
    sensitivePhone,
    ' 123456 ',
  ])('redacts a sensitive scalar string: %s', (value) => {
    expect(redactValueByAllowlist({ message: value }, { allowedFields: ['message'] })).toEqual({
      message: REDACTED_VALUE,
    });
  });

  it('exposes the same fail-closed checks to persistence and HTTP boundaries', () => {
    expect(isSensitiveFieldName('delivery_address')).toBe(true);
    expect(isSensitiveFieldName('status')).toBe(false);
    expect(isSensitiveText('token=private-value')).toBe(true);
    expect(isSensitiveText('浙江省杭州市西湖区文三路 1 号')).toBe(true);
    expect(isSensitiveText('Inventory adjustment approved')).toBe(false);
  });

  it.each([
    'req_01HF7YAT00ABCDEFGHJKMNPQRS',
    'order_01HF7YAT00ABCDEFGHJKMNPQRS',
    'request completed successfully',
    'https://example.com/public/path',
    'version 12345',
  ])('preserves an approved non-sensitive scalar string: %s', (value) => {
    expect(redactValueByAllowlist({ message: value }, { allowedFields: ['message'] })).toEqual({
      message: value,
    });
  });
});

describe('RBAC primitives', () => {
  const principal: RbacPrincipal = {
    accountId: '01HF7YAT00ABCDEFGHJKMNPQRS',
    sessionId: '01HF7YAT00ABCDEFGHJKMNPQRT',
    role: 'SUPER_ADMIN',
    permissions: ['ORDER_FULFILLMENT_PII_READ', 'AUDIT_READ'],
    assurance: 'MFA',
    restriction: 'NONE',
  };

  it('checks roles and permissions without treating available actions as roles', () => {
    expect(hasRole(principal, ['SUPER_ADMIN'])).toBe(true);
    expect(hasRole(principal, ['AGENT_ADMIN', 'CUSTOMER'])).toBe(false);
    expect(hasPermission(principal, 'ORDER_FULFILLMENT_PII_READ')).toBe(true);
    expect(hasAllPermissions(principal, ['ORDER_FULFILLMENT_PII_READ', 'AUDIT_READ'])).toBe(true);
    expect(hasAllPermissions(principal, ['ORDER_FULFILLMENT_PII_READ', 'MISSING'])).toBe(false);
  });
});

describe('Outbox exponential backoff', () => {
  it('doubles from the configured base and caps at the configured maximum', () => {
    expect(calculateOutboxBackoffMs(0, { initialDelayMs: 100, maximumDelayMs: 1_000 })).toBe(100);
    expect(calculateOutboxBackoffMs(1, { initialDelayMs: 100, maximumDelayMs: 1_000 })).toBe(200);
    expect(calculateOutboxBackoffMs(4, { initialDelayMs: 100, maximumDelayMs: 1_000 })).toBe(1_000);
    expect(calculateOutboxBackoffMs(1_000, { initialDelayMs: 100, maximumDelayMs: 1_000 })).toBe(1_000);
  });

  it.each([-1, 0.5, Number.NaN])('rejects an invalid retry count: %s', (retryCount) => {
    expect(() => calculateOutboxBackoffMs(retryCount)).toThrow(TypeError);
  });

  it('rejects an inverted delay range', () => {
    expect(() => calculateOutboxBackoffMs(0, { initialDelayMs: 2, maximumDelayMs: 1 })).toThrow(TypeError);
  });
});
