import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createEncryptionContext,
  encryptEnvelope,
  generateUlid,
  hmacStoreAccountPhone,
} from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { StorePhoneHashMaintenance } from './store-phone-hash-maintenance';

const FIELD_KEY = { id: 'maintenance-field-v1', key: Buffer.alloc(32, 31) };
const HASH_CURRENT = { id: 'maintenance-phone-v2', key: Buffer.alloc(32, 32) };
const HASH_PREVIOUS = { id: 'maintenance-phone-v1', key: Buffer.alloc(32, 33) };
const PHONE_A = ['138', '0000', '6821'].join('');
const PHONE_B = ['139', '0000', '7932'].join('');

interface TestPhoneRow {
  encryption_key_id: string;
  id: string;
  phone_ciphertext: Buffer;
  phone_hash: string;
  phone_last4: string;
  revoked_at: Date | null;
}

function config(previous = true): PlatformRuntimeConfig {
  return {
    encryption: {
      fieldKeys: { current: FIELD_KEY, previous: [] },
    },
    store: {
      phoneHashKeys: { current: HASH_CURRENT, previous: previous ? [HASH_PREVIOUS] : [] },
    },
  } as unknown as PlatformRuntimeConfig;
}

function phoneRow(options: {
  aadId?: string;
  hashKey?: typeof HASH_CURRENT;
  id?: string;
  phone?: string;
  revokedAt?: Date | null;
} = {}): TestPhoneRow {
  const id = options.id ?? generateUlid();
  const phone = options.phone ?? PHONE_A;
  const envelope = encryptEnvelope(phone, { key: FIELD_KEY.key, keyId: FIELD_KEY.id }, createEncryptionContext(
    'customer_phone_verification', options.aadId ?? id, 'phone_ciphertext',
  ));
  return {
    encryption_key_id: FIELD_KEY.id,
    id,
    phone_ciphertext: Buffer.from(JSON.stringify(envelope)),
    phone_hash: hmacStoreAccountPhone(phone, options.hashKey?.key ?? HASH_PREVIOUS.key),
    phone_last4: phone.slice(-4),
    revoked_at: options.revokedAt ?? null,
  };
}

function cloneRows(rows: readonly TestPhoneRow[]): TestPhoneRow[] {
  return rows.map((row) => ({ ...row, phone_ciphertext: Buffer.from(row.phone_ciphertext) }));
}

function databaseHarness(initialRows: readonly TestPhoneRow[], options: {
  lockError?: Error;
  role?: string;
} = {}) {
  let rows = cloneRows(initialRows);
  let transactionSnapshot: TestPhoneRow[] | undefined;
  let rollbackCount = 0;
  const updateFacts: { id: string; nextHash: string; previousHash: string }[] = [];
  const queries: string[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    const normalized = sql.replaceAll(/\s+/g, ' ').trim();
    queries.push(normalized);
    if (normalized === 'BEGIN') {
      transactionSnapshot = cloneRows(rows);
      return { rowCount: null, rows: [] };
    }
    if (normalized === 'SELECT current_user AS current_user') {
      return { rowCount: 1, rows: [{ current_user: options.role ?? 'mall_migrator' }] };
    }
    if (normalized.startsWith('SET LOCAL lock_timeout')) return { rowCount: null, rows: [] };
    if (normalized.startsWith('LOCK TABLE public.customer_phone_verification')) {
      if (options.lockError) throw options.lockError;
      return { rowCount: null, rows: [] };
    }
    if (normalized.startsWith('SELECT id, phone_ciphertext')) {
      return { rowCount: rows.length, rows: cloneRows(rows) };
    }
    if (normalized.startsWith('UPDATE public.customer_phone_verification')) {
      const [nextHash, id, previousHash] = values as [string, string, string];
      const row = rows.find((candidate) => candidate.id === id && candidate.phone_hash === previousHash);
      if (!row) return { rowCount: 0, rows: [] };
      row.phone_hash = nextHash;
      updateFacts.push({ id, nextHash, previousHash });
      return { rowCount: 1, rows: [] };
    }
    if (normalized === 'COMMIT') {
      transactionSnapshot = undefined;
      return { rowCount: null, rows: [] };
    }
    if (normalized === 'ROLLBACK') {
      rollbackCount += 1;
      if (transactionSnapshot) rows = cloneRows(transactionSnapshot);
      transactionSnapshot = undefined;
      return { rowCount: null, rows: [] };
    }
    throw new TypeError('Unexpected maintenance test query');
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) };
  return {
    maintenance: new StorePhoneHashMaintenance(config(), pool as never),
    pool,
    queries,
    query,
    rollbackCount: () => rollbackCount,
    rows: () => cloneRows(rows),
    updateFacts,
  };
}

describe('Store phone HMAC maintenance', () => {
  it('converges mixed current/previous rows including revoked rows and is idempotent', async () => {
    const previousActive = phoneRow();
    const previousRevoked = phoneRow({ phone: PHONE_B, revokedAt: new Date('2026-08-01T00:00:00.000Z') });
    const currentActive = phoneRow({ hashKey: HASH_CURRENT, phone: PHONE_B });
    const state = databaseHarness([previousActive, previousRevoked, currentActive]);

    await expect(state.maintenance.rehashAndVerify()).resolves.toEqual({ rehashed: 2, verified: 3 });
    expect(state.rows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: previousRevoked.id,
        phone_hash: hmacStoreAccountPhone(PHONE_B, HASH_CURRENT.key),
        revoked_at: previousRevoked.revoked_at,
      }),
    ]));
    expect(state.rows().every(({ phone_hash }, index) => phone_hash === hmacStoreAccountPhone(
      index === 0 ? PHONE_A : PHONE_B, HASH_CURRENT.key,
    ))).toBe(true);
    expect(state.updateFacts).toHaveLength(2);

    await expect(state.maintenance.rehashAndVerify()).resolves.toEqual({ rehashed: 0, verified: 3 });
    expect(state.updateFacts).toHaveLength(2);

    const lockIndex = state.queries.findIndex((query) => query.startsWith('LOCK TABLE'));
    const scanIndex = state.queries.findIndex((query) => query.startsWith('SELECT id, phone_ciphertext'));
    const updateIndex = state.queries.findIndex((query) => query.startsWith('UPDATE public'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(scanIndex).toBeGreaterThan(lockIndex);
    expect(updateIndex).toBeGreaterThan(scanIndex);
    expect(state.queries[lockIndex]).toContain('IN ACCESS EXCLUSIVE MODE');
  });

  it.each([
    ['ciphertext', (row: TestPhoneRow) => ({ ...row, phone_ciphertext: Buffer.from('invalid-envelope') })],
    ['last4', (row: TestPhoneRow) => ({ ...row, phone_last4: '0000' })],
    ['hash', (row: TestPhoneRow) => ({ ...row, phone_hash: '0'.repeat(64) })],
    ['AAD', (row: TestPhoneRow) => phoneRow({ aadId: generateUlid(), id: row.id, phone: PHONE_B })],
  ])('rolls back with zero persistent updates when any retained row has invalid %s', async (_label, tamper) => {
    const valid = phoneRow();
    const invalid = tamper(phoneRow({ phone: PHONE_B }));
    const initial = [valid, invalid];
    const state = databaseHarness(initial);

    await expect(state.maintenance.rehashAndVerify()).rejects.toBeInstanceOf(Error);
    expect(state.updateFacts).toHaveLength(0);
    expect(state.rollbackCount()).toBe(1);
    expect(state.rows()).toEqual(initial);
    expect(state.queries).not.toContain('COMMIT');
  });

  it('rejects a non-migrator role before taking the table lock', async () => {
    const state = databaseHarness([phoneRow()], { role: 'mall_runtime' });
    await expect(state.maintenance.rehashAndVerify()).rejects.toThrow('requires mall_migrator');
    expect(state.rollbackCount()).toBe(1);
    expect(state.queries.some((query) => query.startsWith('LOCK TABLE'))).toBe(false);
    expect(state.updateFacts).toHaveLength(0);
  });

  it('rolls back when the blocking table lock times out or fails', async () => {
    const lockError = Object.assign(new Error('lock timeout'), { code: '55P03' });
    const state = databaseHarness([phoneRow()], { lockError });
    await expect(state.maintenance.rehashAndVerify()).rejects.toBe(lockError);
    expect(state.rollbackCount()).toBe(1);
    expect(state.updateFacts).toHaveLength(0);
    expect(state.queries.some((query) => query.startsWith('SELECT id, phone_ciphertext'))).toBe(false);
  });

  it('supports current-only verification after convergence and rejects an old-key row', async () => {
    const current = databaseHarness([phoneRow({ hashKey: HASH_CURRENT })]);
    const currentOnly = new StorePhoneHashMaintenance(config(false), current.pool as never);
    await expect(currentOnly.verifyCurrentOnly()).resolves.toEqual({ verified: 1 });
    expect(current.updateFacts).toHaveLength(0);

    const previous = databaseHarness([phoneRow()]);
    const withoutPrevious = new StorePhoneHashMaintenance(config(false), previous.pool as never);
    await expect(withoutPrevious.verifyCurrentOnly()).rejects.toThrow('HMAC is invalid');
    expect(previous.rollbackCount()).toBe(1);
    expect(previous.updateFacts).toHaveLength(0);
  });
});
