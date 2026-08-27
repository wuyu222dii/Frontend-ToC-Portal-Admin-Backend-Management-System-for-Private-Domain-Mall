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
  it('HMACs the raw IP inside the repository', async () => {
    const transaction = transactionStub();
    await new AuditRepository(ipHashKey).append(transaction, { ...baseInput, ipAddress: '127.0.0.1' });

    expect(transaction.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ip_hash: hashIpAddress('127.0.0.1', ipHashKey) }),
    }));
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

  it('NONE policy rejects caller-defined summary keys', async () => {
    await expect(new AuditRepository(ipHashKey).append(transactionStub(), {
      ...baseInput,
      after: { status: 'ACTIVE', version: 2 },
      summaryPolicy: 'NONE',
    })).rejects.toThrow('must not contain fields');
  });
});
