import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreApiError } from '../api/store-client';
import type { StoreAftersale, StoreAftersaleConfirmInput } from '../types/store-aftersales';
import {
  AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY,
  AFTERSALE_CONFIRM_JOURNAL_TTL_MS,
  AftersaleConfirmJournalError,
  clearAftersaleConfirmJournalForCustomer,
  executeAftersaleConfirmJournal,
  parseAftersaleConfirmJournal,
  prepareAftersaleConfirmJournal,
  recoverAftersaleConfirmJournal,
} from './aftersale-confirm-journal';

const mocks = vi.hoisted(() => ({
  authenticatedRequest: vi.fn(),
  confirmStoreAftersale: vi.fn(),
  createIdempotencyKey: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
  getCustomerProfile: vi.fn(),
}));

vi.mock('../api/store-identity', () => ({
  authenticatedRequest: mocks.authenticatedRequest,
  createIdempotencyKey: mocks.createIdempotencyKey,
  getCustomerProfile: mocks.getCustomerProfile,
}));

vi.mock('../api/store-aftersales', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/store-aftersales')>();
  return { ...actual, confirmStoreAftersale: mocks.confirmStoreAftersale };
});

const CUSTOMER_A_ID = '01J00000000000000000000000';
const CUSTOMER_B_ID = '01J10000000000000000000000';
const ORDER_ID = '01J20000000000000000000000';
const ORDER_ITEM_ID = '01J30000000000000000000000';
const FILE_ID = '01J40000000000000000000000';
const AFTERSALE_ID = '01J50000000000000000000000';
const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';
const ORIGINAL_REASON = '外包装破损，凭证已上传';
const NOW = Date.parse('2099-09-02T01:00:00.000Z');
const result = { aftersale_id: AFTERSALE_ID } as StoreAftersale;

function request(reasonText: string = ORIGINAL_REASON): StoreAftersaleConfirmInput {
  return {
    action: 'CONFIRM',
    order_id: ORDER_ID,
    type: 'RETURN_REFUND',
    reason_code: 'ITEM_DAMAGED',
    reason_text: reasonText,
    items: [{ order_item_id: ORDER_ITEM_ID, quantity: 1 }],
    evidence_file_ids: [FILE_ID],
    preview_token: 'preview-token-at-least-sixteen-characters',
    confirmation_hash: 'a'.repeat(64),
  };
}

function profile(customerId: string) {
  return { customer_id: customerId };
}

function storageEnvironment() {
  const values = new Map<string, unknown>();
  const getStorageSync = vi.fn((key: string) => values.get(key));
  const setStorageSync = vi.fn((key: string, value: unknown) => values.set(key, value));
  const removeStorageSync = vi.fn((key: string) => values.delete(key));
  vi.stubEnv('UNI_PLATFORM', 'mp-weixin');
  vi.stubGlobal('uni', { getStorageSync, removeStorageSync, setStorageSync });
  return { getStorageSync, removeStorageSync, setStorageSync, values };
}

function expectJournalError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(AftersaleConfirmJournalError);
  expect(error).toMatchObject({ code });
}

describe('B12 aftersale confirm journal safety', () => {
  afterEach(() => {
    mocks.authenticatedRequest.mockReset();
    mocks.confirmStoreAftersale.mockReset();
    mocks.createIdempotencyKey.mockReset().mockReturnValue(IDEMPOTENCY_KEY);
    mocks.getCustomerProfile.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('persists a customer-bound exact request hash without raw customer or free-form reason text', async () => {
    const storage = storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));

    const journal = await prepareAftersaleConfirmJournal(request(), NOW);
    const serialized = JSON.stringify(storage.values.get(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY));

    expect(journal.idempotency_key).toBe(IDEMPOTENCY_KEY);
    expect(journal.request_salt).toMatch(/^[a-f0-9]{32}$/);
    expect(journal.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain(CUSTOMER_A_ID);
    expect(serialized).not.toContain(ORIGINAL_REASON);
    expect(serialized).toContain(journal.request_hash);
    expect(mocks.getCustomerProfile).toHaveBeenCalledOnce();
    expect(storage.setStorageSync).toHaveBeenCalledOnce();
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();
  });

  it('rejects a changed re-entered reason locally, preserves the journal, then replays the original key', async () => {
    const storage = storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    mocks.confirmStoreAftersale.mockResolvedValue(result);
    await prepareAftersaleConfirmJournal(request(), NOW);
    const recovered = await recoverAftersaleConfirmJournal(NOW);
    expect(recovered).not.toBeNull();

    await executeAftersaleConfirmJournal(recovered!, '完全不同的补充说明').then(
      () => { throw new Error('Expected reason mismatch'); },
      (error: unknown) => expectJournalError(error, 'REQUEST_MISMATCH'),
    );
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();
    expect(storage.values.has(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)).toBe(true);

    await expect(executeAftersaleConfirmJournal(recovered!, ORIGINAL_REASON)).resolves.toBe(result);
    expect(mocks.confirmStoreAftersale).toHaveBeenCalledWith(
      request(),
      IDEMPOTENCY_KEY,
    );
    expect(storage.values.has(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('recovers an ambiguous response under a new same-customer session with the same body and key', async () => {
    const storage = storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    const lost = new StoreApiError('response lost', { status: 0, code: 'NETWORK_ERROR' });
    mocks.confirmStoreAftersale.mockRejectedValueOnce(lost).mockResolvedValueOnce(result);
    const prepared = await prepareAftersaleConfirmJournal(request(), NOW);

    await expect(executeAftersaleConfirmJournal(prepared)).rejects.toBe(lost);
    expect(storage.values.has(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)).toBe(true);

    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    const recovered = await recoverAftersaleConfirmJournal(NOW);
    await expect(executeAftersaleConfirmJournal(recovered!, ORIGINAL_REASON)).resolves.toBe(result);

    expect(mocks.confirmStoreAftersale).toHaveBeenCalledTimes(2);
    expect(mocks.confirmStoreAftersale.mock.calls[0]).toEqual(
      mocks.confirmStoreAftersale.mock.calls[1],
    );
  });

  it('selects per-customer entries and never deletes another account journal on mismatch', async () => {
    const storage = storageEnvironment();
    let customerId = CUSTOMER_A_ID;
    mocks.getCustomerProfile.mockImplementation(async () => profile(customerId));
    const journalA = await prepareAftersaleConfirmJournal(request(), NOW);

    customerId = CUSTOMER_B_ID;
    expect(await recoverAftersaleConfirmJournal(NOW)).toBeNull();
    mocks.createIdempotencyKey.mockReturnValue('223e4567-e89b-42d3-a456-426614174001');
    const journalB = await prepareAftersaleConfirmJournal({
      ...request(),
      order_id: '01J60000000000000000000000',
    }, NOW);

    await executeAftersaleConfirmJournal(journalA, ORIGINAL_REASON).then(
      () => { throw new Error('Expected customer mismatch'); },
      (error: unknown) => expectJournalError(error, 'CUSTOMER_MISMATCH'),
    );
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();
    expect(JSON.stringify(storage.values.get(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)))
      .toContain(journalA.idempotency_key);

    customerId = CUSTOMER_A_ID;
    expect(await recoverAftersaleConfirmJournal(NOW)).toEqual(journalA);
    customerId = CUSTOMER_B_ID;
    expect(await recoverAftersaleConfirmJournal(NOW)).toEqual(journalB);
  });

  it('clears only the confirmed deleted customer entry', async () => {
    const storage = storageEnvironment();
    let customerId = CUSTOMER_A_ID;
    mocks.getCustomerProfile.mockImplementation(async () => profile(customerId));
    const journalA = await prepareAftersaleConfirmJournal(request(), NOW);
    customerId = CUSTOMER_B_ID;
    mocks.createIdempotencyKey.mockReturnValue('223e4567-e89b-42d3-a456-426614174001');
    const journalB = await prepareAftersaleConfirmJournal({
      ...request(), order_id: '01J60000000000000000000000',
    }, NOW);

    clearAftersaleConfirmJournalForCustomer(CUSTOMER_A_ID);
    const stored = JSON.stringify(storage.values.get(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY));
    expect(stored).not.toContain(journalA.idempotency_key);
    expect(stored).toContain(journalB.idempotency_key);
  });

  it('fails closed on profile, storage read, and storage write failures', async () => {
    const storage = storageEnvironment();
    const profileFailure = new StoreApiError('profile failed', {
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    mocks.getCustomerProfile.mockRejectedValue(profileFailure);
    await expect(prepareAftersaleConfirmJournal(request(), NOW)).rejects.toBe(profileFailure);
    expect(storage.setStorageSync).not.toHaveBeenCalled();
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();

    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    storage.getStorageSync.mockImplementationOnce(() => { throw new Error('read unavailable'); });
    await expect(recoverAftersaleConfirmJournal(NOW)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();

    storage.setStorageSync.mockImplementationOnce(() => { throw new Error('quota exceeded'); });
    await expect(prepareAftersaleConfirmJournal(request(), NOW)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();
  });

  it('does not execute or delete the stored command when current-profile lookup fails', async () => {
    const storage = storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    const journal = await prepareAftersaleConfirmJournal(request(), NOW);
    const profileFailure = new StoreApiError('profile unavailable', {
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    mocks.getCustomerProfile.mockRejectedValue(profileFailure);

    await expect(executeAftersaleConfirmJournal(journal)).rejects.toBe(profileFailure);
    expect(mocks.confirmStoreAftersale).not.toHaveBeenCalled();
    expect(JSON.stringify(storage.values.get(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)))
      .toContain(journal.idempotency_key);
  });

  it('keeps the exact journal when post-response cleanup fails and safely replays it', async () => {
    const storage = storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    mocks.confirmStoreAftersale.mockResolvedValue(result);
    const journal = await prepareAftersaleConfirmJournal(request(), NOW);
    storage.removeStorageSync.mockImplementationOnce(() => {
      throw new Error('storage cleanup unavailable');
    });

    await expect(executeAftersaleConfirmJournal(journal)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(storage.values.has(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)).toBe(true);

    await expect(executeAftersaleConfirmJournal(journal)).resolves.toBe(result);
    expect(mocks.confirmStoreAftersale).toHaveBeenCalledTimes(2);
    expect(mocks.confirmStoreAftersale.mock.calls[0]).toEqual(
      mocks.confirmStoreAftersale.mock.calls[1],
    );
  });

  it('preserves an uncertain state conflict and expires only the current timed-out entry', async () => {
    const storage = storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    const conflict = new StoreApiError('session changed', { status: 409, code: 'STATE_CONFLICT' });
    mocks.confirmStoreAftersale.mockRejectedValue(conflict);
    const journal = await prepareAftersaleConfirmJournal(request(), NOW);

    await expect(executeAftersaleConfirmJournal(journal)).rejects.toBe(conflict);
    expect(storage.values.has(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)).toBe(true);
    expect(await recoverAftersaleConfirmJournal(NOW + AFTERSALE_CONFIRM_JOURNAL_TTL_MS - 1))
      .toEqual(journal);
    expect(await recoverAftersaleConfirmJournal(NOW + AFTERSALE_CONFIRM_JOURNAL_TTL_MS))
      .toBeNull();
    expect(storage.values.has(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('rejects a missing or malformed request hash in stored data', async () => {
    storageEnvironment();
    mocks.getCustomerProfile.mockResolvedValue(profile(CUSTOMER_A_ID));
    const journal = await prepareAftersaleConfirmJournal(request(), NOW);
    const { request_hash: removedRequestHash, ...withoutRequestHash } = journal;
    expect(removedRequestHash).toBe(journal.request_hash);

    expect(() => parseAftersaleConfirmJournal(withoutRequestHash)).toThrow(AftersaleConfirmJournalError);
    expect(() => parseAftersaleConfirmJournal({ ...journal, request_hash: 'not-a-hash' }))
      .toThrow(AftersaleConfirmJournalError);
    expect(() => parseAftersaleConfirmJournal({ ...journal, request_salt: 'not-a-salt' }))
      .toThrow(AftersaleConfirmJournalError);
  });
});
