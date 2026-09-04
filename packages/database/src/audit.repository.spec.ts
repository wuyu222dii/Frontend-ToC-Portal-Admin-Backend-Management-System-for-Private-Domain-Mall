import { randomUUID } from 'node:crypto';

import { generateUlid, hashIpAddress } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { AuditRepository } from './audit.repository';
import type { DatabaseTransaction } from './idempotency.repository';

function transactionStub(): DatabaseTransaction {
  return {
    auditLog: {
      create: vi.fn(async ({ data }: { data: object }) => data),
    },
  } as unknown as DatabaseTransaction;
}

const baseInput = {
  action: 'UPDATE',
  module: 'catalog',
  objectId: generateUlid(),
  objectType: 'product',
  requestId: 'req_0123456789abcdef0123456789abcdef',
  result: 'SUCCESS' as const,
  summaryPolicy: 'STATUS_VERSION' as const,
};
const ipHashKey = Buffer.alloc(32, 41);
const sensitivePhone = ['138', '0013', '8000'].join('');

describe('AuditRepository', () => {
  it.each([
    'PENDING_PAYMENT',
    'PENDING_SHIPMENT',
    'READY_TO_SHIP',
    'SHIPPING',
    'SHIPPED',
    'IN_TRANSIT',
    'DELIVERED',
  ])(
    'accepts the closed Store order %s status',
    async (status) => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      after: { status, version: 1 },
      module: 'order',
      objectId: '01J0000000000000000000000A',
      objectType: 'order',
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    },
  );

  it('HMACs the raw IP inside the repository', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, { ...baseInput, ipAddress: '127.0.0.1' });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ip_hash: hashIpAddress('127.0.0.1', ipHashKey) }),
    }));
  });

  it('stores a bounded Agent authorization summary and an invite-code lifecycle object', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      after: { mode: 'CUSTOM_WHITELIST', product_count: 2, version: 4 },
      before: { mode: 'ALL_ACTIVE_PRODUCTS', product_count: 0, version: 3 },
      module: 'agent',
      objectType: 'agent',
      summaryPolicy: 'AGENT_AUTHORIZATION',
    });
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      action: 'ROTATE',
      after: { status: 'ROTATED', version: 4 },
      before: { status: 'ACTIVE', version: 3 },
      module: 'agent',
      objectType: 'agent_invite_code',
    });
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(2);
  });

  it('requires an independent strong HMAC key', () => {
    expect(() => new AuditRepository(Buffer.alloc(16))).toThrow('HMAC key must contain at least 32 bytes');
  });

  it.each([
    'password=do-not-store',
    'Authorization: Bearer secret-token-value',
    'postgresql://mall_runtime:password@example.test/postgres',
    `请联系 ${sensitivePhone}`,
    'CATALOG.UNKNOWN_REASON',
  ])('rejects unregistered audit reason text: %s', async (reasonCode) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), { ...baseInput, reasonCode }))
      .rejects.toThrow('reason code is not registered');
  });

  it('stores a registered reason code', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      reasonCode: 'CATALOG.STATUS_CORRECTION',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: 'CATALOG.STATUS_CORRECTION' }),
    }));
  });

  it.each([
    '上线',
    '原'.repeat(500),
  ])('stores a free lifecycle reason within the 2-500 character boundary', async (reason) => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, { ...baseInput, reason });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason }),
    }));
  });

  it.each([
    '',
    '单',
    '超'.repeat(501),
    42,
  ])('rejects an invalid free lifecycle reason: %j', async (reason) => {
    await expect(new AuditRepository(ipHashKey).append(
      transactionStub(),
      { ...baseInput, reason } as never,
    )).rejects.toThrow('reason');
  });

  it('rejects ambiguous reason and reasonCode metadata', async () => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      reason: '商品生命周期调整',
      reasonCode: 'CATALOG.STATUS_CORRECTION',
    })).rejects.toThrow('mutually exclusive');
  });

  it.each([
    'CATALOG.BRAND_ACTIVATE',
    'CATALOG.BRAND_DEACTIVATE',
    'CATALOG.BRAND_SOFT_DELETE',
    'CATALOG.BRAND_RESTORE',
    'CATALOG.CATEGORY_ACTIVATE',
    'CATALOG.CATEGORY_DEACTIVATE',
    'CATALOG.CATEGORY_SOFT_DELETE',
    'CATALOG.CATEGORY_RESTORE',
  ])('stores a closed B3 master-data reason code: %s', async (reasonCode) => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, { ...baseInput, reasonCode });
    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: reasonCode }),
    }));
  });

  it('uses an internal clock and rejects caller-controlled audit time', async () => {
    const transaction = transactionStub();
    const occurredAt = new Date('2026-08-13T00:00:00.000Z');
    await new AuditRepository(ipHashKey, () => occurredAt).append(transaction, baseInput);

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ occurred_at: occurredAt }),
    }));
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      occurredAt: new Date('2100-01-01T00:00:00.000Z'),
    } as never)).rejects.toThrow('unsupported fields');
    expect(() => new AuditRepository(ipHashKey, () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');
  });

  it.each([
    ['module', { module: 'password=secret123' }],
    ['object type', { objectType: 'Authorization: Bearer abc' }],
    ['object ID', { objectId: sensitivePhone }],
    ['object ID', { objectId: `customer:${sensitivePhone}` }],
    ['action', { action: 'POSTGRESQL://MALL_RUNTIME:SECRET@DB/POSTGRES' }],
    ['request ID', { requestId: sensitivePhone }],
    ['request ID', { requestId: 'otp-123456' }],
    ['idempotency key', { idempotencyKey: 'recovery-code-SECRET' }],
    ['result code', { resultCode: 'token=PRIVATE' }],
  ])('rejects sensitive or unregistered audit %s metadata', async (_label, override) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), { ...baseInput, ...override }))
      .rejects.toThrow();
  });

  it('accepts validated actor, request, idempotency and result metadata', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      actorAccountId: generateUlid(),
      actorRole: 'SUPER_ADMIN',
      idempotencyKey: randomUUID(),
      requestId: 'trace_0123456789abcdef0123456789abcdef',
      resultCode: 'OK',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it.each([
    { actorAccountId: generateUlid() },
    { actorRole: 'CUSTOMER' as const },
    { ipAddress: 'not-an-ip-address' },
  ])('rejects incomplete or invalid audit metadata: %j', async (override) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), { ...baseInput, ...override }))
      .rejects.toThrow();
  });

  it('stores only typed status and version summaries', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      after: { status: 'ACTIVE', version: 2 },
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after_json: {
          status: 'ACTIVE',
          version: 2,
        },
      }),
    }));
  });

  it('stores only the closed address state for customer address audit events', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      after: { is_default: true, status: 'ACTIVE', version: 2 },
      before: { is_default: false, status: 'ACTIVE', version: 1 },
      module: 'customer',
      objectType: 'address',
      summaryPolicy: 'ADDRESS_STATE',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after_json: { is_default: true, status: 'ACTIVE', version: 2 },
        before_json: { is_default: false, status: 'ACTIVE', version: 1 },
        module: 'customer',
        object_type: 'address',
      }),
    }));
  });

  it('stores the closed non-sensitive business rule values before and after publishing', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      action: 'PUBLISH',
      after: {
        aftersale_window_days: 14,
        minimum_withdrawal_amount: '200.00',
        status: 'PUBLISHED',
        version: 4,
      },
      before: {
        aftersale_window_days: 7,
        minimum_withdrawal_amount: '100.00',
        status: 'PUBLISHED',
        version: 3,
      },
      module: 'config',
      objectType: 'business_rule',
      summaryPolicy: 'BUSINESS_RULE_CHANGE',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after_json: {
          aftersale_window_days: 14,
          minimum_withdrawal_amount: '200.00',
          status: 'PUBLISHED',
          version: 4,
        },
        before_json: {
          aftersale_window_days: 7,
          minimum_withdrawal_amount: '100.00',
          status: 'PUBLISHED',
          version: 3,
        },
      }),
    }));
  });

  it('allows the controlled initial business rule publish to omit only the before snapshot', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      action: 'PUBLISH',
      after: {
        aftersale_window_days: 7,
        minimum_withdrawal_amount: '100.00',
        status: 'PUBLISHED',
        version: 1,
      },
      module: 'config',
      objectType: 'business_rule',
      summaryPolicy: 'BUSINESS_RULE_CHANGE',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before_json: expect.anything() }),
    }));
  });

  it.each([
    {
      after: {
        aftersale_window_days: 14,
        legal_record_retention_years: 10,
        minimum_withdrawal_amount: '200.00',
        status: 'PUBLISHED',
        version: 4,
      },
      module: 'config',
      objectType: 'business_rule',
    },
    {
      after: {
        aftersale_window_days: 0,
        minimum_withdrawal_amount: '200.00',
        status: 'PUBLISHED',
        version: 4,
      },
      module: 'config',
      objectType: 'business_rule',
    },
    {
      after: {
        aftersale_window_days: 14,
        minimum_withdrawal_amount: '0.00',
        status: 'PUBLISHED',
        version: 4,
      },
      module: 'config',
      objectType: 'business_rule',
    },
    {
      after: {
        aftersale_window_days: 14,
        minimum_withdrawal_amount: '200.00',
        status: 'PUBLISHED',
        version: 4,
      },
      module: 'catalog',
      objectType: 'product',
    },
  ])('rejects an invalid or cross-domain business rule audit summary: %j', async (override) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      action: 'PUBLISH',
      summaryPolicy: 'BUSINESS_RULE_CHANGE',
      ...override,
    } as never)).rejects.toThrow();
  });

  it('requires the dedicated safe-value policy for business rule publishing', async () => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      action: 'PUBLISH',
      after: { status: 'PUBLISHED', version: 4 },
      module: 'config',
      objectType: 'business_rule',
    })).rejects.toThrow('BUSINESS_RULE_CHANGE');

    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      action: 'PUBLISH',
      module: 'config',
      objectType: 'business_rule',
      summaryPolicy: 'BUSINESS_RULE_CHANGE',
    })).rejects.toThrow('BUSINESS_RULE_CHANGE');
  });

  it.each([
    { is_default: true, phone: sensitivePhone, status: 'ACTIVE', version: 2 },
    { is_default: 'true', status: 'ACTIVE', version: 2 },
    { is_default: true, status: 'ACTIVE' },
    { is_default: true, status: 'UNKNOWN', version: 2 },
  ])('rejects invalid or sensitive address audit state: %j', async (after) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      after,
      module: 'customer',
      objectType: 'address',
      summaryPolicy: 'ADDRESS_STATE',
    } as never)).rejects.toThrow();
  });

  it.each([
    { module: 'catalog', objectType: 'product', summaryPolicy: 'ADDRESS_STATE' },
    { module: 'customer', objectType: 'address', summaryPolicy: 'STATUS_VERSION' },
    { module: 'privacy', objectType: 'address', summaryPolicy: 'ADDRESS_STATE' },
  ])('rejects address summary policy outside its closed owner: %j', async (override) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      after: { is_default: true, status: 'ACTIVE', version: 2 },
      ...override,
    } as never)).rejects.toThrow();
  });

  it.each([
    { after: { status: ['138', '0013', '8000'].join('-') } },
    { after: { status: 'RECOVERY-CODE-ABC123' } },
    { after: { version: 0 } },
    { after: { version: sensitivePhone } },
    { after: { [`phone_${sensitivePhone}`]: 'changed' } },
    { after: { recovery_code_ABCDEF123456: 'changed' } },
    { after: { nickname: 'Alice' } },
  ])('rejects invalid typed summary values: %j', async (override) => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), { ...baseInput, ...override }))
      .rejects.toThrow();
  });

  it('accepts the closed PROCESSING status used by refund-attempt lifecycle audits', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      after: { status: 'PROCESSING', version: 2 },
      before: { status: 'PENDING', version: 1 },
      module: 'refund',
      objectType: 'refund',
      summaryPolicy: 'STATUS_VERSION',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after_json: { status: 'PROCESSING', version: 2 },
        before_json: { status: 'PENDING', version: 1 },
      }),
    }));
  });

  it('accepts the closed published return-address configuration audit', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      action: 'PUBLISH',
      after: { status: 'PUBLISHED', version: 1 },
      module: 'config',
      objectType: 'return_address',
      summaryPolicy: 'STATUS_VERSION',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after_json: { status: 'PUBLISHED', version: 1 },
        before_json: expect.anything(),
        module: 'config',
        object_type: 'return_address',
      }),
    }));
  });

  it.each([
    'PENDING_REVIEW',
    'REFUNDING',
    'WAITING_RETURN',
    'WAITING_RECEIPT',
    'RETURN_EXCEPTION',
    'REFUNDING_AFTER_RETURN',
    'REJECTED_AFTER_RETURN',
    'REFUND_FAILED',
  ])('accepts the closed aftersale lifecycle status %s', async (status) => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      after: { status, version: 2 },
      before: { status: 'PENDING_REVIEW', version: 1 },
      module: 'aftersale',
      objectType: 'aftersale',
      summaryPolicy: 'STATUS_VERSION',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it.each([
    ['CONTINUE_REFUND', 'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN'],
    ['RECORD_INSPECTION', 'WAITING_RECEIPT', 'REFUNDING_AFTER_RETURN'],
    ['REJECT_AFTER_RETURN', 'RETURN_EXCEPTION', 'REJECTED_AFTER_RETURN'],
  ])('accepts the closed B12 aftersale audit action %s', async (action, beforeStatus, afterStatus) => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, {
      ...baseInput,
      action,
      after: { status: afterStatus, version: 4 },
      before: { status: beforeStatus, version: 3 },
      module: 'aftersale',
      objectType: 'aftersale',
      summaryPolicy: 'STATUS_VERSION',
    });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action }),
    }));
  });

  it('NONE policy rejects caller-defined summary keys', async () => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      after: { status: 'ACTIVE', version: 2 },
      summaryPolicy: 'NONE',
    })).rejects.toThrow('must not contain fields');
  });
});
