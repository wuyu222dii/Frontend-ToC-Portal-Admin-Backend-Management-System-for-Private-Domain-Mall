import { generateUlid, isValidUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  ReturnAddressRepository,
  type ReturnAddressProtectedMaterial,
  type ReturnAddressPublishHooks,
  type ReturnAddressPublishInput,
} from './return-address.repository';

const NOW = new Date('2026-09-01T06:00:00.000Z');
const actorAccountId = generateUlid(NOW.getTime() - 20_000);
const currentVersionId = generateUlid(NOW.getTime() - 10_000);
const otherVersionId = generateUlid(NOW.getTime() - 5_000);

interface TestAddressRow {
  city: string;
  created_at: Date;
  detail_ciphertext: Uint8Array;
  district: string;
  effective_at: Date | null;
  encryption_key_id: string;
  id: string;
  phone_ciphertext: Uint8Array;
  phone_last4: string;
  province: string;
  recipient_name: string;
  status: string;
  version_no: number;
}

function queryText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join(' ') ?? String(query);
}

function addressRow(overrides: Partial<TestAddressRow> = {}): TestAddressRow {
  return {
    city: 'Hangzhou',
    created_at: new Date(NOW.getTime() - 10_000),
    detail_ciphertext: Buffer.from('stored-detail-envelope'),
    district: 'Xihu',
    effective_at: new Date(NOW.getTime() - 9_000),
    encryption_key_id: 'return-address-key-v1',
    id: currentVersionId,
    phone_ciphertext: Buffer.from('stored-phone-envelope'),
    phone_last4: '2468',
    province: 'Zhejiang',
    recipient_name: 'Return Desk',
    status: 'PUBLISHED',
    version_no: 3,
    ...overrides,
  };
}

function publishInput(overrides: Partial<ReturnAddressPublishInput> = {}): ReturnAddressPublishInput {
  return {
    actorAccountId,
    city: ' Hangzhou ',
    district: ' Binjiang ',
    expectedCurrentPublishedId: null,
    expectedMaxVersionNo: 0,
    expectedVersion: 1,
    province: ' Zhejiang ',
    reason: ' Publish current return address ',
    recipientName: ' Returns Team ',
    ...overrides,
  };
}

function protectedMaterial(
  overrides: Partial<ReturnAddressProtectedMaterial> = {},
): ReturnAddressProtectedMaterial {
  return {
    detailCiphertext: Buffer.from('new-detail-envelope'),
    encryptionKeyId: 'return-address-key-v2',
    phoneCiphertext: Buffer.from('new-phone-envelope'),
    phoneLast4: '1357',
    ...overrides,
  };
}

function harness(initialRows: TestAddressRow[] = []) {
  const rows = initialRows.map((row) => ({
    ...row,
    detail_ciphertext: Buffer.from(row.detail_ciphertext),
    phone_ciphertext: Buffer.from(row.phone_ciphertext),
  }));
  const events: string[] = [];
  const returnAddressVersion = {
    create: vi.fn(async ({ data }: { data: TestAddressRow }) => {
      events.push('create-draft');
      rows.push({ ...data });
      return { id: data.id };
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      events.push('read-published');
      return rows.find(({ id }) => id === where.id) ?? null;
    }),
    updateMany: vi.fn(async ({ data, where }: {
      data: Partial<TestAddressRow>;
      where: { effective_at?: null; id: string; status: string };
    }) => {
      const row = rows.find(({ id }) => id === where.id);
      if (!row || row.status !== where.status ||
        (where.effective_at === null && row.effective_at !== null)) return { count: 0 };
      events.push(data.status === 'ARCHIVED' ? 'archive-current' : 'publish-new');
      Object.assign(row, data);
      return { count: 1 };
    }),
  };
  const transaction = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = queryText(query);
      if (sql.includes('FROM public.account')) {
        events.push('lock-actor');
        return [{
          deleted_at: null,
          has_password: true,
          id: actorAccountId,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        }];
      }
      if (sql.includes('transaction_timestamp()')) {
        events.push('read-transaction-time');
        return [{ transaction_time: NOW }];
      }
      if (sql.includes('FROM public.return_address_version')) {
        events.push(sql.includes('FOR UPDATE') ? 'lock-address-history' : 'read-address-history');
        return [...rows].sort((left, right) => left.version_no - right.version_no ||
          left.id.localeCompare(right.id));
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
    $queryRawUnsafe: vi.fn(async () => {
      events.push('lock-singleton');
      return [{ acquired: 1 }];
    }),
    returnAddressVersion,
  };
  return {
    events,
    repository: new ReturnAddressRepository({} as PrismaClient),
    returnAddressVersion,
    rows,
    transaction: transaction as unknown as DatabaseTransaction,
  };
}

function hooks(events: string[], material = protectedMaterial()): ReturnAddressPublishHooks & {
  protectVersion: ReturnType<typeof vi.fn>;
  verifyPreview: ReturnType<typeof vi.fn>;
} {
  return {
    protectVersion: vi.fn(async () => {
      events.push('protect-version');
      return material;
    }),
    verifyPreview: vi.fn(async () => {
      events.push('verify-preview');
    }),
  };
}

describe('ReturnAddressRepository', () => {
  it('binds the first publish to resource version 1 with no current or historical version', async () => {
    const state = harness();
    const publishHooks = hooks(state.events);

    const result = await state.repository.publishInTransaction(
      state.transaction,
      publishInput(),
      publishHooks,
    );

    expect(publishHooks.verifyPreview).toHaveBeenCalledWith({
      current: null,
      currentPublishedId: null,
      maxVersionNo: 0,
      resourceVersion: 1,
    });
    expect(result).toMatchObject({
      address: {
        city: 'Hangzhou',
        district: 'Binjiang',
        phoneLast4: '1357',
        province: 'Zhejiang',
        recipientName: 'Returns Team',
        version: 1,
        versionNo: 1,
      },
      audit: { after: { status: 'PUBLISHED', version: 1 }, before: null },
    });
    expect(state.events).toEqual([
      'lock-actor',
      'lock-singleton',
      'lock-address-history',
      'verify-preview',
      'read-transaction-time',
      'protect-version',
      'create-draft',
      'publish-new',
      'read-published',
    ]);
  });

  it('creates a protected replacement, archives the current version, then publishes the new version', async () => {
    const state = harness([addressRow()]);
    const publishHooks = hooks(state.events);

    const result = await state.repository.publishInTransaction(state.transaction, publishInput({
      expectedCurrentPublishedId: currentVersionId,
      expectedMaxVersionNo: 3,
      expectedVersion: 3,
    }), publishHooks);

    const createInput = state.returnAddressVersion.create.mock.calls[0]?.[0];
    const versionId = createInput?.data.id;
    expect(isValidUlid(versionId)).toBe(true);
    expect(publishHooks.protectVersion).toHaveBeenCalledWith({ versionId });
    expect(createInput).toEqual({
      data: expect.objectContaining({
        detail_ciphertext: new Uint8Array(Buffer.from('new-detail-envelope')),
        encryption_key_id: 'return-address-key-v2',
        id: versionId,
        phone_ciphertext: new Uint8Array(Buffer.from('new-phone-envelope')),
        phone_last4: '1357',
        status: 'DRAFT',
        version_no: 4,
      }),
      select: { id: true },
    });
    expect(state.events.indexOf('archive-current')).toBeLessThan(state.events.indexOf('publish-new'));
    expect(state.rows.find(({ id }) => id === currentVersionId)?.status).toBe('ARCHIVED');
    expect(state.rows.find(({ id }) => id === versionId)?.status).toBe('PUBLISHED');
    expect(result.audit).toEqual({
      after: { status: 'PUBLISHED', version: 4 },
      before: { status: 'PUBLISHED', version: 3 },
    });
  });

  it.each([
    ['current address', { expectedCurrentPublishedId: otherVersionId }],
    ['maximum version', { expectedMaxVersionNo: 4 }],
    ['resource version', { expectedVersion: 4 }],
  ] as const)('rejects a stale %s binding before preview verification or protection', async (_, stale) => {
    const state = harness([addressRow()]);
    const publishHooks = hooks(state.events);

    await expect(state.repository.publishInTransaction(state.transaction, publishInput({
      expectedCurrentPublishedId: currentVersionId,
      expectedMaxVersionNo: 3,
      expectedVersion: 3,
      ...stale,
    }), publishHooks)).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    expect(publishHooks.verifyPreview).not.toHaveBeenCalled();
    expect(publishHooks.protectVersion).not.toHaveBeenCalled();
    expect(state.returnAddressVersion.create).not.toHaveBeenCalled();
  });

  it('locks in order and replays the exact archived version instead of the current published version', async () => {
    const state = harness([
      addressRow({ id: currentVersionId, status: 'ARCHIVED', version_no: 1 }),
      addressRow({
        id: otherVersionId,
        phone_last4: '9753',
        status: 'PUBLISHED',
        version_no: 2,
      }),
    ]);

    await expect(state.repository.getForReplayInTransaction(
      state.transaction,
      actorAccountId,
      currentVersionId,
    )).resolves.toMatchObject({ versionId: currentVersionId, version: 1, phoneLast4: '2468' });

    expect(state.events).toEqual(['lock-actor', 'lock-singleton', 'lock-address-history']);
    expect(state.returnAddressVersion.create).not.toHaveBeenCalled();
    expect(state.returnAddressVersion.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['DRAFT', [
      addressRow({ effective_at: null, id: currentVersionId, status: 'DRAFT', version_no: 1 }),
      addressRow({ id: otherVersionId, status: 'PUBLISHED', version_no: 2 }),
    ]],
    ['missing', [addressRow({ id: otherVersionId, status: 'PUBLISHED', version_no: 2 })]],
  ] as const)('returns 404 when the requested replay version is %s', async (_, rows) => {
    const state = harness([...rows]);

    await expect(state.repository.getForReplayInTransaction(
      state.transaction,
      actorAccountId,
      currentVersionId,
    )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(state.events).toEqual(['lock-actor', 'lock-singleton', 'lock-address-history']);
    expect(state.returnAddressVersion.create).not.toHaveBeenCalled();
    expect(state.returnAddressVersion.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['phone tail', { phone_last4: '12x4' }],
    ['phone ciphertext', { phone_ciphertext: Buffer.alloc(0) }],
    ['detail ciphertext', { detail_ciphertext: Buffer.alloc(0) }],
  ] as const)('fails closed when stored published %s is malformed', async (_, malformed) => {
    const state = harness([addressRow(malformed)]);

    await expect(state.repository.previewPublishInTransaction(state.transaction))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it.each([
    ['phone tail', protectedMaterial({ phoneLast4: '12x4' })],
    ['phone ciphertext', protectedMaterial({ phoneCiphertext: Buffer.alloc(0) })],
    ['detail ciphertext', protectedMaterial({ detailCiphertext: Buffer.alloc(0) })],
  ] as const)('fails closed before persistence when protected %s is malformed', async (_, malformed) => {
    const state = harness();
    const publishHooks = hooks(state.events, malformed);

    await expect(state.repository.publishInTransaction(state.transaction, publishInput(), publishHooks))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(publishHooks.protectVersion).toHaveBeenCalledOnce();
    expect(state.returnAddressVersion.create).not.toHaveBeenCalled();
  });
});
