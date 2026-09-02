import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CacheableCommandResponse,
  DatabaseRuntime,
  InventoryAdjustmentImpact,
  InventoryAdjustmentResult,
  InventorySnapshot,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { AdminInventoryService } from './admin-inventory.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const factorId = '01J00000000000000000000002';
const skuId = '01J00000000000000000000003';
const balanceId = '01J00000000000000000000004';
const ledgerId = '01J00000000000000000000005';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const occurredAt = new Date('2026-08-25T05:00:00.000Z');

function config(): PlatformRuntimeConfig {
  return {
    authentication: {} as PlatformRuntimeConfig['authentication'],
    agent: {} as PlatformRuntimeConfig['agent'],
    store: {} as PlatformRuntimeConfig['store'],
    banner: { targetOrigins: [] },
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank', key: Buffer.alloc(32, 4) }, previous: [] },
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { provider: 'MOCK', mockSigningKey: Buffer.alloc(32, 4), providerTimeoutMs: 5_000 },
    port: 3000,
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function requestContext(): AdminCatalogRequestContext {
  return {
    accessSession: {
      accountId,
      accountVersion: 1,
      accessJti: 'access-jti',
      expiresAt: new Date('2026-08-25T06:00:00.000Z'),
      factorEncryptionKeyId: 'key',
      factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-08-25T04:00:00.000Z'),
      sessionFamily: '01J00000000000000000000006',
      sessionId,
    },
    principal: {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
    },
    requestId,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function inventory(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    activeReservationQty: 3,
    availableQty: 7,
    balanceId,
    lockedQty: 3,
    physicalQty: 10,
    productName: 'Daily wash',
    skuCode: 'SKU-001',
    skuId,
    skuName: '500 ml',
    skuStatus: 'ACTIVE',
    version: 4,
    ...overrides,
  };
}

function impact(overrides: Partial<InventoryAdjustmentImpact> = {}): InventoryAdjustmentImpact {
  return {
    activeReservationQty: 3,
    availableAfter: 12,
    availableBefore: 7,
    balanceId,
    lockedAfter: 3,
    lockedBefore: 3,
    physicalAfter: 15,
    physicalBefore: 10,
    skuId,
    skuStatus: 'ACTIVE',
    version: 4,
    warnings: [],
    ...overrides,
  };
}

function adjustmentResult(overrides: Partial<InventoryAdjustmentResult> = {}): InventoryAdjustmentResult {
  return {
    impact: impact({ version: 5 }),
    ledger: {
      id: ledgerId,
      type: 'MANUAL_INCREASE',
      lockedAfter: 3,
      lockedBefore: 3,
      lockedChange: 0,
      occurredAt,
      physicalAfter: 15,
      physicalBefore: 10,
      physicalChange: 5,
      reason: 'Cycle count correction',
    },
    ...overrides,
  };
}

function cachedCommand(overrides: Partial<CacheableCommandResponse['data']> = {}): CacheableCommandResponse {
  return {
    code: 'OK',
    data: {
      occurred_at: occurredAt.toISOString(),
      resource_id: skuId,
      resource_type: 'inventory',
      status: 'SUCCEEDED',
      version: 5,
      ...overrides,
    },
    message: 'success',
    request_id: requestId,
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  idempotency: {
    claim: ReturnType<typeof vi.fn>;
    commandReplay: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  inventory: {
    applyAdjustmentInTransaction: ReturnType<typeof vi.fn>;
    getAdjustmentImpactInTransaction: ReturnType<typeof vi.fn>;
    listInventory: ReturnType<typeof vi.fn>;
    listLedger: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  previews: {
    consumeInTransaction: ReturnType<typeof vi.fn>;
    issueInTransaction: ReturnType<typeof vi.fn>;
  };
}

function harness() {
  const transaction = {};
  const prisma = {
    $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
  };
  const database = { pool: {}, prisma } as unknown as DatabaseRuntime;
  const service = new AdminInventoryService(config(), database);
  const mocks: ServiceInternals = {
    audit: { append: vi.fn().mockResolvedValue({}) },
    idempotency: {
      claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
      commandReplay: vi.fn().mockReturnValue(cachedCommand()),
      complete: vi.fn().mockResolvedValue({}),
    },
    inventory: {
      applyAdjustmentInTransaction: vi.fn().mockResolvedValue(adjustmentResult()),
      getAdjustmentImpactInTransaction: vi.fn().mockResolvedValue(impact()),
      listInventory: vi.fn().mockResolvedValue({ items: [inventory()], total: 1 }),
      listLedger: vi.fn().mockResolvedValue({ items: [adjustmentResult().ledger], total: 1 }),
    },
    outbox: { append: vi.fn().mockResolvedValue({}) },
    previews: {
      consumeInTransaction: vi.fn().mockResolvedValue(undefined),
      issueInTransaction: vi.fn().mockResolvedValue({
        confirmationHash: 'a'.repeat(64),
        expiresAt: new Date('2026-08-25T05:01:00.000Z'),
      }),
    },
  };
  Object.assign(service as unknown as ServiceInternals, mocks);
  return { mocks, service };
}

describe('AdminInventoryService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails closed when the runtime dependencies are unavailable', async () => {
    const service = new AdminInventoryService();
    await expect(service.listInventory({ page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('maps inventory without subtracting the active reservation review value twice', async () => {
    const { service } = harness();
    await expect(service.listInventory({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [{
        active_reservation_qty: 3,
        available_qty: 7,
        locked_qty: 3,
        physical_qty: 10,
        product_name: 'Daily wash',
        sku_code: 'SKU-001',
        sku_id: skuId,
        sku_name: '500 ml',
        sku_status: 'ACTIVE',
        version: 4,
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
  });

  it('maps append-only ledger before values and pagination exactly', async () => {
    const { mocks, service } = harness();
    await expect(service.listLedger(skuId, { page: 2, pageSize: 10 })).resolves.toEqual({
      items: [{
        ledger_id: ledgerId,
        ledger_type: 'MANUAL_INCREASE',
        locked_after: 3,
        locked_before: 3,
        locked_change: 0,
        occurred_at: occurredAt.toISOString(),
        physical_after: 15,
        physical_before: 10,
        physical_change: 5,
        reason: 'Cycle count correction',
      }],
      pagination: { page: 2, page_size: 10, total: 1 },
    });
    expect(mocks.inventory.listLedger).toHaveBeenCalledWith({ page: 2, pageSize: 10, skuId });
  });

  it('issues a bound HASH_ONLY preview without storing the preview token', async () => {
    const { mocks, service } = harness();
    const response = await service.previewAdjustment(
      requestContext(), skuId, { physicalDelta: 5, reason: 'Cycle count correction' }, idempotencyKey,
    );

    expect(response).toMatchObject({
      confirmation_hash: 'a'.repeat(64),
      expires_at: '2026-08-25T05:01:00.000Z',
      impact: {
        affected_count: 1,
        available_after: 12,
        available_before: 7,
        locked_after: 3,
        locked_before: 3,
        physical_after: 15,
        physical_before: 10,
        warnings: [],
      },
      preview_token: expect.stringMatching(/^pvw_[A-Za-z0-9_-]{43}$/),
      resource_etag: '"4"',
    });
    expect(mocks.previews.issueInTransaction).toHaveBeenCalledWith(expect.anything(), {
      action: 'INVENTORY.ADJUST',
      actorId: accountId,
      previewToken: response.preview_token,
      request: { physical_delta: 5, reason: 'Cycle count correction' },
      resourceVersion: 4,
      sessionId,
      targetId: skuId,
      targetType: 'INVENTORY',
    });
    expect(mocks.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: skuId,
      responseForHash: expect.not.objectContaining({ preview_token: expect.anything() }),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(mocks.idempotency.claim.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.inventory.getAdjustmentImpactInTransaction.mock.invocationCallOrder[0] as number,
    );
    expect(mocks.inventory.getAdjustmentImpactInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.previews.issueInTransaction.mock.invocationCallOrder[0] as number,
    );
  });

  it('returns the locked-stock warning in a successful preview', async () => {
    const { mocks, service } = harness();
    mocks.inventory.getAdjustmentImpactInTransaction.mockResolvedValue(impact({
      availableAfter: -1,
      physicalAfter: 2,
      warnings: ['STOCK_INSUFFICIENT'],
    }));
    await expect(service.previewAdjustment(
      requestContext(), skuId, { physicalDelta: -8, reason: 'Cycle count correction' }, idempotencyKey,
    )).resolves.toMatchObject({ impact: { warnings: ['STOCK_INSUFFICIENT'] } });
  });

  it('requires a new preview idempotency key', async () => {
    const { mocks, service } = harness();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
    await expect(service.previewAdjustment(
      requestContext(), skuId, { physicalDelta: 1, reason: 'Cycle count correction' }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(mocks.inventory.getAdjustmentImpactInTransaction).not.toHaveBeenCalled();
    expect(mocks.previews.issueInTransaction).not.toHaveBeenCalled();
  });

  it('confirms in order and writes one command, audit and outbox fact', async () => {
    const { mocks, service } = harness();
    const input = {
      confirmationHash: 'a'.repeat(64),
      physicalDelta: 5,
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Cycle count correction',
    };
    const response = await service.confirmAdjustment(requestContext(), skuId, input, 4, idempotencyKey);

    expect(response.envelope).toEqual(cachedCommand());
    expect(mocks.previews.consumeInTransaction).toHaveBeenCalledWith(expect.anything(), {
      action: 'INVENTORY.ADJUST',
      actorId: accountId,
      confirmationHash: input.confirmationHash,
      previewToken: input.previewToken,
      request: { physical_delta: 5, reason: 'Cycle count correction' },
      resourceVersion: 4,
      sessionId,
      targetId: skuId,
      targetType: 'INVENTORY',
    });
    expect(mocks.inventory.applyAdjustmentInTransaction).toHaveBeenCalledWith(expect.anything(), {
      actorId: accountId,
      expectedVersion: 4,
      ledgerId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      physicalDelta: 5,
      reason: 'Cycle count correction',
      skuId,
    });
    expect(mocks.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'ADJUST',
      after: { version: 5 },
      before: { version: 4 },
      module: 'inventory',
      objectId: skuId,
      objectType: 'inventory',
      reason: 'Cycle count correction',
    }));
    expect(mocks.outbox.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateId: skuId,
      aggregateType: 'inventory',
      eventType: 'inventory.adjusted',
    }));
    expect(mocks.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      policy: 'COMMAND_RESPONSE',
      responseBody: cachedCommand(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
    const order = [
      mocks.idempotency.claim,
      mocks.previews.consumeInTransaction,
      mocks.inventory.applyAdjustmentInTransaction,
      mocks.audit.append,
      mocks.outbox.append,
      mocks.idempotency.complete,
    ].map((mock) => mock.mock.invocationCallOrder[0] as number);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('replays the original command without touching mutable facts', async () => {
    const { mocks, service } = harness();
    const response = cachedCommand();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record: { response_status: 200 } });
    mocks.idempotency.commandReplay.mockReturnValue(response);
    const result = await service.confirmAdjustment(requestContext(), skuId, {
      confirmationHash: 'a'.repeat(64),
      physicalDelta: 5,
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Cycle count correction',
    }, 4, idempotencyKey);
    expect(result.envelope).toEqual(response);
    expect(mocks.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(mocks.inventory.applyAdjustmentInTransaction).not.toHaveBeenCalled();
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
  });

  it.each([
    [{ response_status: 201 }, cachedCommand()],
    [{ response_status: 200 }, cachedCommand({ resource_type: 'sku' })],
    [{ response_status: 200 }, cachedCommand({ resource_id: balanceId })],
    [{ response_status: 200 }, cachedCommand({ status: 'FAILED' })],
  ])('fails closed for an invalid cached command', async (record, cached) => {
    const { mocks, service } = harness();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record });
    mocks.idempotency.commandReplay.mockReturnValue(cached);
    await expect(service.confirmAdjustment(requestContext(), skuId, {
      confirmationHash: 'a'.repeat(64),
      physicalDelta: 5,
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Cycle count correction',
    }, 4, idempotencyKey)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(mocks.previews.consumeInTransaction).not.toHaveBeenCalled();
  });

  it('does not complete a failed confirmation', async () => {
    const { mocks, service } = harness();
    mocks.inventory.applyAdjustmentInTransaction.mockRejectedValue(
      new ApplicationError('STOCK_INSUFFICIENT', 'Physical inventory cannot fall below locked inventory'),
    );
    await expect(service.confirmAdjustment(requestContext(), skuId, {
      confirmationHash: 'a'.repeat(64),
      physicalDelta: -8,
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Cycle count correction',
    }, 4, idempotencyKey)).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
    expect(mocks.idempotency.complete).not.toHaveBeenCalled();
  });
});
