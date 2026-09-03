import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CommissionRulePublishPreviewSnapshot,
  CommissionRuleVersionSnapshot,
  DatabaseRuntime,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import type { CommissionRuleConfirmationInput } from './admin-commissions.dto';
import { AdminCommissionsService } from './admin-commissions.service';

const ACCOUNT_ID = generateUlid();
const AGENT_ID = generateUlid();
const CATEGORY_ID = generateUlid();
const LEDGER_ID = generateUlid();
const ORDER_ID = generateUlid();
const ORDER_ITEM_ID = generateUlid();
const PRODUCT_ID = generateUlid();
const SESSION_ID = generateUlid();
const SNAPSHOT_ID = generateUlid();
const SKU_ID = generateUlid();
const VERSION_ID = generateUlid();
const WALLET_LEDGER_ID = generateUlid();
const NOW = new Date('2026-09-03T00:00:00.000Z');

const request = {
  accessSession: { sessionId: SESSION_ID },
  principal: { accountId: ACCOUNT_ID, role: 'SUPER_ADMIN' },
  requestId: `req_${'1'.repeat(32)}`,
  socket: { remoteAddress: '127.0.0.1' },
} as unknown as AdminCatalogRequestContext;

const input: CommissionRuleConfirmationInput = {
  baseVersionId: null,
  changes: [{ configuredRate: '0.0000', targetId: null, targetType: 'PLATFORM' }],
  confirmationHash: 'a'.repeat(64),
  previewToken: 'pvw_0123456789abcdefghijklmnop',
  reason: 'Publish initial commission rules',
};

const sku = {
  categoryId: CATEGORY_ID,
  categoryName: 'Hair care',
  configuredRate: null,
  effectiveRate: '0.0000',
  productId: PRODUCT_ID,
  productName: 'Development shampoo',
  skuCode: 'DEV-SKU-1',
  skuId: SKU_ID,
  source: 'PLATFORM' as const,
};

const preview: CommissionRulePublishPreviewSnapshot = {
  action: input,
  currentPublishedId: null,
  impact: {
    affectedSkuCount: 1,
    affectedSkus: [sku],
    changedTargetCount: 1,
    warnings: ['New payments use this version'],
  },
  maxVersionNo: 0,
  resourceVersion: 0,
};

const version: CommissionRuleVersionSnapshot = {
  baseVersionId: null,
  changes: input.changes,
  createdAt: NOW,
  createdById: ACCOUNT_ID,
  effectiveAt: NOW,
  reason: input.reason,
  status: 'PUBLISHED',
  versionId: VERSION_ID,
  versionNo: 1,
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
  const commissions = {
    getCurrentRules: vi.fn(async () => ({
      categories: [{
        categoryId: CATEGORY_ID,
        categoryName: 'Hair care',
        configuredRate: '0.0000',
        effectiveRate: '0.0000',
        source: 'CATEGORY' as const,
      }],
      items: [sku],
      platformRate: '0.0000',
      version: 1,
      versionId: VERSION_ID,
      versionNo: 1,
    })),
    getOrderExplanation: vi.fn(async () => ({
      items: [{
        categoryId: CATEGORY_ID,
        categoryName: 'Hair care',
        commissionBase: '10.00',
        commissionSnapshotId: SNAPSHOT_ID,
        effectiveRate: '0.0000',
        expectedRemaining: '0.00',
        hitPath: ['VERSION:1', 'HIT:PLATFORM:0.0000'],
        ledger: [],
        orderItemId: ORDER_ITEM_ID,
        originalCommission: '0.00',
        positionState: 'NONE' as const,
        productId: PRODUCT_ID,
        productName: sku.productName,
        reversalTotal: '0.00',
        roundingMode: 'HALF_UP' as const,
        roundingScale: 2 as const,
        ruleSource: 'PLATFORM' as const,
        ruleVersionId: VERSION_ID,
        ruleVersionNo: 1,
        skuId: SKU_ID,
        skuName: '300 ml',
      }],
      orderId: ORDER_ID,
      orderNo: 'QX-DEV-1',
    })),
    getRuleVersion: vi.fn(async () => version),
    getRuleVersionForReplayInTransaction: vi.fn(async () => {
      sequence.push('replay-read');
      return version;
    }),
    listAdminAgentCommissions: vi.fn(async () => ({
      items: [{
        agentId: AGENT_ID,
        availableChange: '0.00',
        categoryId: CATEGORY_ID,
        categoryName: 'Hair care',
        commissionBase: '10.00',
        commissionSnapshotId: SNAPSHOT_ID,
        effectiveRate: '0.0000',
        expectedChange: '0.00',
        expectedRemaining: '0.00',
        ledgerId: LEDGER_ID,
        ledgerType: 'EXPECTED_CREATED' as const,
        occurredAt: NOW,
        orderId: ORDER_ID,
        orderItemId: ORDER_ITEM_ID,
        orderNo: 'QX-DEV-1',
        originalCommission: '0.00',
        positionState: 'NONE' as const,
        productId: PRODUCT_ID,
        productName: sku.productName,
        refundId: null,
        reversalTotal: '0.00',
        ruleSource: 'PLATFORM' as const,
        ruleVersionId: VERSION_ID,
        ruleVersionNo: 1,
        skuId: SKU_ID,
        skuName: '300 ml',
      }],
      total: 1,
    })),
    listAdminAgentWalletLedger: vi.fn(async () => ({
      items: [{
        agentId: AGENT_ID,
        availableBalanceAfter: '0.00',
        availableChange: '-10.00',
        expectedBalanceAfter: '0.00',
        expectedChange: '0.00',
        frozenBalanceAfter: '10.00',
        frozenChange: '10.00',
        ledgerType: 'WITHDRAWAL_FREEZE' as const,
        occurredAt: NOW,
        referenceId: generateUlid(),
        referenceType: 'WITHDRAWAL' as const,
        refundId: null,
        walletLedgerId: WALLET_LEDGER_ID,
      }],
      total: 1,
    })),
    listRuleSkus: vi.fn(async () => ({ items: [sku], total: 1, versionId: VERSION_ID, versionNo: 1 })),
    listRuleVersions: vi.fn(async () => ({ items: [version], total: 1 })),
    previewRulePublishInTransaction: vi.fn(async () => {
      sequence.push('preview-facts');
      return preview;
    }),
    publishRuleVersionInTransaction: vi.fn(async (_transaction, _publishInput, hooks) => {
      sequence.push('publish');
      await hooks.verifyPreview(preview);
      return {
        after: { status: 'PUBLISHED' as const, version: 1, versionId: VERSION_ID },
        before: null,
        impact: preview.impact,
        version,
      };
    }),
  };
  const audit = { append: vi.fn(async () => sequence.push('audit')) };
  type ClaimResult = { kind: 'execute' } | { kind: 'replay'; record: { resource_id: string } };
  let claimResult: ClaimResult = { kind: 'execute' };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => sequence.push('assert-replay')),
    assertKeyNotUsedForRequest: vi.fn(async () => sequence.push('assert-different-key')),
    claim: vi.fn<() => Promise<ClaimResult>>(async () => {
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
  const service = new AdminCommissionsService();
  Object.assign(service as unknown as Record<string, unknown>, {
    audit,
    commissions,
    config,
    database,
    idempotency,
    outbox,
    previews,
  });
  return {
    audit,
    commissions,
    idempotency,
    outbox,
    previews,
    sequence,
    service,
    setClaimResult: (result: ClaimResult) => {
      claimResult = result;
    },
    transaction,
  };
}

describe('AdminCommissionsService', () => {
  it('maps current, history, ledger and order explanation projections without losing 0%', async () => {
    const { service } = harness();
    const current = await service.getCurrentRules();
    const skus = await service.listRuleSkus({ page: 1, pageSize: 20 });
    const versions = await service.listRuleVersions({ page: 1, pageSize: 20 });
    const detail = await service.getRuleVersion(VERSION_ID);
    const commissions = await service.listAgentCommissions(AGENT_ID, { page: 1, pageSize: 20 });
    const wallet = await service.listAgentWalletLedger(AGENT_ID, { page: 1, pageSize: 20 });
    const explanation = await service.getOrderExplanation(ORDER_ID);

    expect(current).toMatchObject({
      categories: [{ configured_rate: '0.0000', effective_rate: '0.0000' }],
      items: [{ configured_rate: null, effective_rate: '0.0000' }],
      platform_rate: '0.0000',
    });
    expect(skus).toMatchObject({ pagination: { total: 1 }, version_id: VERSION_ID });
    expect(versions.items[0]).toMatchObject({ base_version_id: null, created_by_account_id: ACCOUNT_ID });
    expect(detail).toMatchObject({ changes: [{ configured_rate: '0.0000' }], version_id: VERSION_ID });
    expect(commissions.items[0]).toMatchObject({ ledger_id: LEDGER_ID, refund_id: null });
    expect(wallet.items[0]).toMatchObject({
      frozen_change: '10.00',
      ledger_type: 'WITHDRAWAL_FREEZE',
    });
    expect(explanation.items[0]).toMatchObject({
      commission_snapshot_id: SNAPSHOT_ID,
      position_state: 'NONE',
      rounding_mode: 'HALF_UP',
    });
  });

  it('issues a HASH_ONLY preview bound to the first-publication facts', async () => {
    const { idempotency, previews, sequence, service } = harness();
    const response = await service.previewRulePublish(request, input, 'preview-key');

    expect(response).toMatchObject({
      confirmation_hash: 'b'.repeat(64),
      impact: { affected_count: 1 },
      resource_etag: '"0"',
    });
    expect(previews.issueInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'COMMISSION_RULE.PUBLISH',
      request: expect.objectContaining({
        current_published_id: null,
        impact: expect.objectContaining({ affected_count: 1 }),
        max_version_no: 0,
      }),
      resourceVersion: 0,
      targetId: '00000000000000000000000000',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: '00000000000000000000000000',
      responseForHash: expect.objectContaining({ resource_etag: '"0"' }),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(sequence).toEqual(['claim', 'preview-facts', 'issue', 'complete']);
  });

  it('publishes, consumes, audits, emits and completes in one transaction', async () => {
    const { audit, commissions, idempotency, outbox, previews, sequence, service } = harness();
    const response = await service.publishRuleVersion(request, input, 0, 'confirm-key');

    expect(response).toMatchObject({ status: 'PUBLISHED', version_id: VERSION_ID, version_no: 1 });
    expect(commissions.previewRulePublishInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        baseVersionId: input.baseVersionId,
        changes: input.changes,
        reason: input.reason,
      },
    );
    expect(commissions.publishRuleVersionInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedCurrentPublishedId: null, expectedMaxVersionNo: 0, expectedVersion: 0 }),
      expect.objectContaining({ verifyPreview: expect.any(Function) }),
    );
    expect(previews.consumeInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      confirmationHash: input.confirmationHash,
      request: expect.objectContaining({ impact: expect.objectContaining({ affected_count: 1 }) }),
      resourceVersion: 0,
      targetId: '00000000000000000000000000',
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'PUBLISH',
      module: 'commission',
      objectId: VERSION_ID,
      objectType: 'commission_rule',
    }));
    expect(outbox.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateId: VERSION_ID,
      eventType: 'commission_rule.published',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      resourceId: VERSION_ID,
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

  it('replays a published version only after HASH_ONLY integrity validation', async () => {
    const { audit, commissions, idempotency, outbox, sequence, service, setClaimResult } = harness();
    setClaimResult({ kind: 'replay', record: { resource_id: VERSION_ID } });

    await expect(service.publishRuleVersion(request, input, 0, 'confirm-key'))
      .resolves.toMatchObject({ version_id: VERSION_ID });
    expect(idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(
      { resource_id: VERSION_ID },
      expect.objectContaining({ resourceId: VERSION_ID, storage: 'HASH_ONLY' }),
    );
    expect(sequence).toEqual(['claim', 'replay-read', 'assert-replay']);
    expect(commissions.publishRuleVersionInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
