import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction, IdempotencyHashKeyRing } from './idempotency.repository';
import {
  ACCOUNT_ANONYMIZE_PREVIEW_TTL_MS,
  HIGH_RISK_PREVIEW_TTL_MS,
  HighRiskPreviewRepository,
  type IssueHighRiskPreviewInput,
} from './high-risk-preview.repository';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const actorId = generateUlid(NOW.getTime() - 5_000);
const otherActorId = generateUlid(NOW.getTime() - 4_000);
const sessionId = generateUlid(NOW.getTime() - 3_000);
const targetId = generateUlid(NOW.getTime() - 2_000);
const previewToken = 'pv_0123456789abcdefghijklmnopqrstuvwxyz';

function ring(byte = 0x31, id = 'preview-key-v1'): IdempotencyHashKeyRing {
  return { current: { id, key: Buffer.alloc(32, byte) }, previous: [] };
}

function input(overrides: Partial<IssueHighRiskPreviewInput> = {}): IssueHighRiskPreviewInput {
  return {
    action: 'BRAND.ACTIVATE',
    actorId,
    previewToken,
    request: { action: 'ACTIVATE', reason: 'Approved catalog activation' },
    resourceVersion: 3,
    sessionId,
    targetId,
    targetType: 'BRAND',
    ...overrides,
  };
}

function harness(initialNow = NOW) {
  let currentNow = initialNow;
  let record: Record<string, unknown> | null = null;
  const delegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      record = { ...data };
      return record;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; preview_token_hash?: string } }) => {
      if (!record) return null;
      if (where.id !== undefined) return where.id === record.id ? record : null;
      return where.preview_token_hash === record.preview_token_hash ? record : null;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!record || record.consumed_at !== null) return { count: 0 };
      record = { ...record, ...data };
      return { count: 1 };
    }),
  };
  const transaction = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    highRiskOperationPreview: delegate,
  };
  return {
    delegate,
    getRecord: () => record,
    repository: (keys = ring()) => new HighRiskPreviewRepository(
      {} as PrismaClient,
      keys,
      () => currentNow,
    ),
    setNow: (value: Date) => { currentNow = value; },
    transaction: transaction as unknown as DatabaseTransaction,
  };
}

describe('HighRiskPreviewRepository', () => {
  it.each([
    { action: 'AGENT.DISABLE', requestAction: 'DISABLE', targetType: 'AGENT' },
    { action: 'AGENT.INVITE_ROTATE', requestAction: 'INVITE_ROTATE', targetType: 'AGENT' },
    { action: 'AGENT.INVITE_STATUS', requestAction: 'INVITE_STATUS', targetType: 'AGENT' },
    { action: 'AGENT.PASSWORD_RESET', requestAction: 'PASSWORD_RESET', targetType: 'AGENT' },
    { action: 'AFTERSALE.REFUND', requestAction: 'REFUND', targetType: 'AFTERSALE' },
    { action: 'COMMISSION_RULE.PUBLISH', requestAction: 'PUBLISH', targetType: 'COMMISSION_RULE' },
    { action: 'AFTERSALE.REJECT', requestAction: 'REJECT', targetType: 'AFTERSALE' },
    {
      action: 'AFTERSALE.REJECT_AFTER_RETURN',
      requestAction: 'REJECT_AFTER_RETURN',
      targetType: 'AFTERSALE',
    },
    {
      action: 'CUSTOMER.ATTRIBUTION_TRANSFER',
      requestAction: 'ATTRIBUTION_TRANSFER',
      targetType: 'CUSTOMER',
    },
    { action: 'PRODUCT.ACTIVATE', requestAction: 'ACTIVATE', targetType: 'PRODUCT' },
    { action: 'PRODUCT.DEACTIVATE', requestAction: 'DEACTIVATE', targetType: 'PRODUCT' },
    { action: 'PRODUCT.SOFT_DELETE', requestAction: 'SOFT_DELETE', targetType: 'PRODUCT' },
    { action: 'SKU.ACTIVATE', requestAction: 'ACTIVATE', targetType: 'SKU' },
    { action: 'SKU.DEACTIVATE', requestAction: 'DEACTIVATE', targetType: 'SKU' },
    { action: 'SKU.SOFT_DELETE', requestAction: 'SOFT_DELETE', targetType: 'SKU' },
    {
      action: 'ORDER.MANUAL_COMPENSATION',
      requestAction: 'MANUAL_COMPENSATION',
      targetType: 'ORDER',
    },
    { action: 'REFUND.RETRY', requestAction: 'RETRY', targetType: 'REFUND' },
    { action: 'RETURN_ADDRESS.PUBLISH', requestAction: 'PUBLISH', targetType: 'RETURN_ADDRESS' },
    { action: 'WITHDRAWAL.APPROVE', requestAction: 'APPROVE', targetType: 'WITHDRAWAL' },
    { action: 'WITHDRAWAL.MARK_PAID', requestAction: 'MARK_PAID', targetType: 'WITHDRAWAL' },
    { action: 'WITHDRAWAL.REJECT', requestAction: 'REJECT', targetType: 'WITHDRAWAL' },
  ] as const)('issues and consumes the closed $action preview binding', async ({
    action,
    requestAction,
    targetType,
  }) => {
    const { getRecord, repository, transaction } = harness();
    const previews = repository();
    const boundInput = input({
      action,
      request: { action: requestAction, reason: 'Approved catalog lifecycle change' },
      targetType,
    });
    const issued = await previews.issueInTransaction(transaction, boundInput);
    expect(getRecord()).toMatchObject({ action, target_type: targetType });
    await expect(previews.consumeInTransaction(transaction, {
      ...boundInput,
      confirmationHash: issued.confirmationHash,
    })).resolves.toBeUndefined();
  });

  it('issues and consumes an INVENTORY.ADJUST preview with its normalized adjustment body', async () => {
    const { getRecord, repository, transaction } = harness();
    const previews = repository();
    const boundInput = input({
      action: 'INVENTORY.ADJUST',
      request: { physical_delta: 5, reason: 'Approved stock count correction' },
      targetType: 'INVENTORY',
    });
    const issued = await previews.issueInTransaction(transaction, boundInput);
    expect(getRecord()).toMatchObject({ action: 'INVENTORY.ADJUST', target_type: 'INVENTORY' });
    await expect(previews.consumeInTransaction(transaction, {
      ...boundInput,
      confirmationHash: issued.confirmationHash,
    })).resolves.toBeUndefined();
  });

  it('allows resource version zero only for the first COMMISSION_RULE.PUBLISH preview', async () => {
    const { delegate, repository, transaction } = harness();
    const firstPublish = input({
      action: 'COMMISSION_RULE.PUBLISH',
      request: { base_version_id: null, changes: [], reason: 'Initial commission rules' },
      resourceVersion: 0,
      targetType: 'COMMISSION_RULE',
    });
    const issued = await repository().issueInTransaction(transaction, firstPublish);
    await expect(repository().consumeInTransaction(transaction, {
      ...firstPublish,
      confirmationHash: issued.confirmationHash,
    })).resolves.toBeUndefined();

    const other = harness();
    await expect(other.repository().issueInTransaction(other.transaction, input({ resourceVersion: 0 })))
      .rejects.toThrow('resource version is outside');
    expect(other.delegate.create).not.toHaveBeenCalled();
    expect(delegate.create).toHaveBeenCalledOnce();
  });

  it.each([
    { action: 'AGENT.DISABLE', targetType: 'ACCOUNT' },
    { action: 'AGENT.PASSWORD_RESET', targetType: 'BRAND' },
    { action: 'BRAND.ACTIVATE', targetType: 'AGENT' },
    { action: 'CUSTOMER.ATTRIBUTION_TRANSFER', targetType: 'AGENT' },
    { action: 'PRODUCT.RESTORE', targetType: 'PRODUCT' },
    { action: 'INVENTORY.ADJUST', targetType: 'SKU' },
    { action: 'SKU.ACTIVATE', targetType: 'INVENTORY' },
    { action: 'AFTERSALE.REJECT', targetType: 'RETURN_ADDRESS' },
    { action: 'AFTERSALE.REFUND', targetType: 'REFUND' },
    { action: 'ORDER.MANUAL_COMPENSATION', targetType: 'REFUND' },
    { action: 'PRODUCT.ACTIVATE', targetType: 'SKU' },
    { action: 'REFUND.RETRY', targetType: 'AFTERSALE' },
    { action: 'RETURN_ADDRESS.PUBLISH', targetType: 'AFTERSALE' },
    { action: 'SKU.ACTIVATE', targetType: 'PRODUCT' },
    { action: 'WITHDRAWAL.APPROVE', targetType: 'AGENT' },
  ])('rejects an unregistered or mismatched $action/$targetType preview binding', async ({
    action,
    targetType,
  }) => {
    const { delegate, repository, transaction } = harness();
    await expect(repository().issueInTransaction(transaction, input({
      action: action as never,
      targetType: targetType as never,
    }))).rejects.toThrow();
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('rejects unregistered preview metadata before writing', async () => {
    const { delegate, repository, transaction } = harness();
    await expect(repository().issueInTransaction(transaction, input({
      action: 'BRAND.EXPORT_SECRETS' as never,
    }))).rejects.toThrow('action is not registered');
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('stores three domain-separated keyed hashes and fixes expiry to 60 seconds', async () => {
    const { getRecord, repository, transaction } = harness();
    const issued = await repository().issueInTransaction(transaction, input());
    expect(issued.expiresAt).toEqual(new Date(NOW.getTime() + HIGH_RISK_PREVIEW_TTL_MS));
    expect(issued.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.confirmationHash).toMatch(/^[a-f0-9]{64}$/);
    const stored = getRecord();
    expect(stored).toMatchObject({
      action: 'BRAND.ACTIVATE',
      actor_account_id: actorId,
      resource_version: 3,
      session_id: sessionId,
      target_id: targetId,
      target_type: 'BRAND',
    });
    expect(stored?.preview_token_hash).not.toBe(previewToken);
    expect(stored?.preview_token_hash).not.toBe(issued.requestHash);
    expect(stored?.preview_token_hash).not.toBe(issued.confirmationHash);
    expect(JSON.stringify(stored)).not.toContain('Approved catalog activation');
  });

  it('uses five minutes only for ACCOUNT.ANONYMIZE and keeps existing actions at 60 seconds', async () => {
    const accountHarness = harness();
    const accountTargetId = generateUlid(NOW.getTime() - 1_000);
    const accountPreview = await accountHarness.repository().issueInTransaction(accountHarness.transaction, input({
      action: 'ACCOUNT.ANONYMIZE',
      request: { acknowledged: true },
      targetId: accountTargetId,
      targetType: 'ACCOUNT',
    }));
    expect(accountPreview.expiresAt).toEqual(new Date(NOW.getTime() + ACCOUNT_ANONYMIZE_PREVIEW_TTL_MS));
    expect(accountHarness.getRecord()).toMatchObject({
      action: 'ACCOUNT.ANONYMIZE',
      target_id: accountTargetId,
      target_type: 'ACCOUNT',
    });

    const brandHarness = harness();
    const brandPreview = await brandHarness.repository().issueInTransaction(brandHarness.transaction, input());
    expect(brandPreview.expiresAt).toEqual(new Date(NOW.getTime() + HIGH_RISK_PREVIEW_TTL_MS));
  });

  it('consumes exactly once when every binding and hash matches', async () => {
    const { getRecord, repository, transaction } = harness();
    const previews = repository();
    const issued = await previews.issueInTransaction(transaction, input());
    await previews.consumeInTransaction(transaction, { ...input(), confirmationHash: issued.confirmationHash });
    expect(getRecord()).toMatchObject({ consumed_at: NOW });
    await expect(previews.consumeInTransaction(transaction, {
      ...input(),
      confirmationHash: issued.confirmationHash,
    })).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
  });

  it.each([
    { override: { actorId: otherActorId }, label: 'actor' },
    { override: { sessionId: generateUlid() }, label: 'session' },
    { override: { action: 'BRAND.DEACTIVATE' as const }, label: 'action' },
    { override: { action: 'CATEGORY.ACTIVATE' as const, targetType: 'CATEGORY' as const }, label: 'target type' },
    { override: { targetId: generateUlid() }, label: 'target ID' },
    { override: { request: { action: 'ACTIVATE', reason: 'Tampered reason' } }, label: 'request' },
  ])('rejects a mismatched $label binding', async ({ override }) => {
    const { repository, transaction } = harness();
    const previews = repository();
    const issued = await previews.issueInTransaction(transaction, input());
    await expect(previews.consumeInTransaction(transaction, {
      ...input(override),
      confirmationHash: issued.confirmationHash,
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
  });

  it('does not accept an initial-review rejection preview for rejection after return', async () => {
    const { repository, transaction } = harness();
    const previews = repository();
    const initialReviewInput = input({
      action: 'AFTERSALE.REJECT',
      request: { action: 'REJECT', reason: 'Initial review rejection' },
      targetType: 'AFTERSALE',
    });
    const issued = await previews.issueInTransaction(transaction, initialReviewInput);
    await expect(previews.consumeInTransaction(transaction, {
      ...initialReviewInput,
      action: 'AFTERSALE.REJECT_AFTER_RETURN',
      request: { action: 'REJECT_AFTER_RETURN', reason: 'Rejected after return inspection' },
      confirmationHash: issued.confirmationHash,
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
  });

  it('distinguishes resource version changes from confirmation tampering', async () => {
    const { repository, transaction } = harness();
    const previews = repository();
    const issued = await previews.issueInTransaction(transaction, input());
    await expect(previews.consumeInTransaction(transaction, {
      ...input({ resourceVersion: 4 }),
      confirmationHash: issued.confirmationHash,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    await expect(previews.consumeInTransaction(transaction, {
      ...input(),
      confirmationHash: '0'.repeat(64),
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
  });

  it('rejects expiry at the exact 60-second boundary without consuming', async () => {
    const { getRecord, repository, setNow, transaction } = harness();
    const previews = repository();
    const issued = await previews.issueInTransaction(transaction, input());
    setNow(new Date(NOW.getTime() + HIGH_RISK_PREVIEW_TTL_MS));
    await expect(previews.consumeInTransaction(transaction, {
      ...input(),
      confirmationHash: issued.confirmationHash,
    })).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    expect(getRecord()).toMatchObject({ consumed_at: null });
  });

  it('verifies a live preview with the matching previous key after rotation', async () => {
    const { repository, transaction } = harness();
    const oldRing = ring(0x41, 'preview-old');
    const issued = await repository(oldRing).issueInTransaction(transaction, input());
    const rotated: IdempotencyHashKeyRing = {
      current: { id: 'preview-new', key: Buffer.alloc(32, 0x42) },
      previous: [oldRing.current],
    };
    await expect(repository(rotated).consumeInTransaction(transaction, {
      ...input(),
      confirmationHash: issued.confirmationHash,
    })).resolves.toBeUndefined();
  });
});
