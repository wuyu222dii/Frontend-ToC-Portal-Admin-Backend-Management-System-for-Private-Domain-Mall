import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  BusinessRulePublishPreviewSnapshot,
  BusinessRuleVersionSnapshot,
  DatabaseRuntime,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import type { AdminBusinessRuleConfirmation } from './admin-settings.dto';
import { AdminSettingsService } from './admin-settings.service';

const NOW = new Date('2026-09-04T06:00:00.000Z');
const ACCOUNT_ID = generateUlid(NOW.getTime() - 30_000);
const SESSION_ID = generateUlid(NOW.getTime() - 20_000);
const CURRENT_ID = generateUlid(NOW.getTime() - 10_000);
const NEXT_ID = generateUlid(NOW.getTime());

const request = {
  accessSession: { sessionId: SESSION_ID },
  principal: { accountId: ACCOUNT_ID, role: 'SUPER_ADMIN' },
  requestId: `req_${'1'.repeat(32)}`,
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as AdminCatalogRequestContext;

const current: BusinessRuleVersionSnapshot = {
  aftersaleWindowDays: 7,
  effectiveAt: new Date(NOW.getTime() - 10_000),
  legalRecordRetentionYears: 10,
  minimumWithdrawalAmount: '100.00',
  orderPaymentTimeoutMinutes: 30,
  version: 3,
  versionId: CURRENT_ID,
  versionNo: 3,
};

const next: BusinessRuleVersionSnapshot = {
  ...current,
  aftersaleWindowDays: 14,
  effectiveAt: NOW,
  minimumWithdrawalAmount: '200.00',
  version: 4,
  versionId: NEXT_ID,
  versionNo: 4,
};

const preview: BusinessRulePublishPreviewSnapshot = {
  changedFields: ['minimum_withdrawal_amount', 'aftersale_window_days'],
  current,
  currentPublishedId: CURRENT_ID,
  maxVersionNo: 3,
  next: { ...current, aftersaleWindowDays: 14, minimumWithdrawalAmount: '200.00' },
  resourceVersion: 3,
};

const input: AdminBusinessRuleConfirmation = {
  changes: { aftersaleWindowDays: 14, minimumWithdrawalAmount: '200.00' },
  confirmationHash: 'a'.repeat(64),
  previewToken: 'pvw_0123456789abcdefghijklmnop',
  reason: 'Update business rules',
};

function harness() {
  const sequence: string[] = [];
  const transaction = {};
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  } as unknown as DatabaseRuntime;
  const config = {
    encryption: {
      idempotencyHashKeys: { current: { id: 'current', key: Buffer.alloc(32, 1) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 2),
    },
  } as unknown as PlatformRuntimeConfig;
  const businessRules = {
    getForReplayInTransaction: vi.fn(async () => {
      sequence.push('replay-read');
      return next;
    }),
    previewPublishInTransaction: vi.fn(async () => {
      sequence.push('preview-facts');
      return preview;
    }),
    publishInTransaction: vi.fn(async (_transaction, _publishInput, hooks) => {
      sequence.push('publish');
      await hooks.verifyPreview(preview);
      return {
        audit: {
          after: {
            aftersale_window_days: 14,
            minimum_withdrawal_amount: '200.00',
            status: 'PUBLISHED' as const,
            version: 4,
          },
          before: {
            aftersale_window_days: 7,
            minimum_withdrawal_amount: '100.00',
            status: 'PUBLISHED' as const,
            version: 3,
          },
        },
        rule: next,
      };
    }),
    readCurrent: vi.fn(async () => current),
  };
  const audit = { append: vi.fn(async () => sequence.push('audit')) };
  type ClaimResult = { kind: 'execute' } | { kind: 'replay'; record: { resource_id: string } };
  let claimResult: ClaimResult = { kind: 'execute' };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => sequence.push('assert-replay')),
    assertKeyNotUsedForRequest: vi.fn(async () => sequence.push('assert-different-key')),
    claim: vi.fn(async () => {
      sequence.push('claim');
      return claimResult;
    }),
    complete: vi.fn(async () => sequence.push('complete')),
  };
  const outbox = { append: vi.fn(async () => sequence.push('outbox')) };
  const previews = {
    consumeInTransaction: vi.fn(async () => sequence.push('consume')),
    issueInTransaction: vi.fn(async () => {
      sequence.push('issue');
      return { confirmationHash: 'b'.repeat(64), expiresAt: new Date(NOW.getTime() + 60_000) };
    }),
  };
  const service = new AdminSettingsService();
  Object.assign(service as unknown as Record<string, unknown>, {
    audit,
    businessRules,
    config,
    database,
    idempotency,
    outbox,
    previews,
  });
  return {
    audit,
    businessRules,
    idempotency,
    outbox,
    previews,
    sequence,
    service,
    setClaimResult: (result: ClaimResult) => {
      claimResult = result;
    },
  };
}

describe('AdminSettingsService', () => {
  it('maps the published rule while preserving fixed read-only values', async () => {
    await expect(harness().service.getBusinessRules()).resolves.toEqual({
      aftersale_window_days: 7,
      effective_at: current.effectiveAt.toISOString(),
      legal_record_retention_years: 10,
      minimum_withdrawal_amount: '100.00',
      order_payment_timeout_minutes: 30,
      version: 3,
      version_id: CURRENT_ID,
      version_no: 3,
    });
  });

  it('issues a HASH_ONLY preview bound to the current rule facts', async () => {
    const { idempotency, previews, sequence, service } = harness();
    const response = await service.previewBusinessRules(request, input, 'preview-key');

    expect(response).toMatchObject({
      confirmation_hash: 'b'.repeat(64),
      impact: { affected_count: 2 },
      resource_etag: '"3"',
    });
    expect(previews.issueInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'BUSINESS_RULE.PUBLISH',
      request: expect.objectContaining({ current_published_id: CURRENT_ID, max_version_no: 3 }),
      resourceVersion: 3,
      targetId: '00000000000000000000000000',
      targetType: 'BUSINESS_RULE',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      responseForHash: expect.objectContaining({ resource_etag: '"3"' }),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(sequence).toEqual(['claim', 'preview-facts', 'issue', 'complete']);
  });

  it('publishes, consumes, audits, emits and completes in one transaction', async () => {
    const { audit, businessRules, idempotency, outbox, previews, sequence, service } = harness();
    const response = await service.publishBusinessRules(request, input, 3, 'confirm-key');

    expect(response).toMatchObject({ version: 4, version_id: NEXT_ID, version_no: 4 });
    expect(businessRules.publishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expectedCurrentPublishedId: CURRENT_ID,
        expectedMaxVersionNo: 3,
        expectedVersion: 3,
      }),
      expect.objectContaining({ verifyPreview: expect.any(Function) }),
    );
    expect(previews.consumeInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      confirmationHash: input.confirmationHash,
      resourceVersion: 3,
      targetType: 'BUSINESS_RULE',
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
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
    }));
    expect(outbox.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateId: NEXT_ID,
      eventType: 'business_rule.published',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      resourceId: NEXT_ID,
      storage: 'HASH_ONLY',
    }));
    expect(sequence).toEqual([
      'claim',
      'assert-different-key',
      'preview-facts',
      'publish',
      'consume',
      'audit',
      'outbox',
      'complete',
    ]);
  });

  it('replays an existing version only after HASH_ONLY integrity validation', async () => {
    const { audit, businessRules, idempotency, outbox, sequence, service, setClaimResult } = harness();
    setClaimResult({ kind: 'replay', record: { resource_id: NEXT_ID } });

    await expect(service.publishBusinessRules(request, input, 3, 'confirm-key'))
      .resolves.toMatchObject({ version_id: NEXT_ID });
    expect(idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(
      { resource_id: NEXT_ID },
      expect.objectContaining({ resourceId: NEXT_ID, storage: 'HASH_ONLY' }),
    );
    expect(sequence).toEqual(['claim', 'replay-read', 'assert-replay']);
    expect(businessRules.publishInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
