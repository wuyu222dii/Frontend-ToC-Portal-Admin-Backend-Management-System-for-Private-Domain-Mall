import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  calculateCallbackDueAt,
  CallbackInboxRepository,
} from './callback-inbox.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import type { DatabaseRuntime } from './runtime';

const mockHeaders = {
  mock_signature: 'mock-signature-value',
  mock_timestamp: '1786582800000',
};

function callbackInbox(status: 'FAILED' | 'PROCESSED' | 'PROCESSING' | 'RECEIVED') {
  const receivedAt = new Date('2026-08-01T01:00:00.000Z');
  return {
    error_message: status === 'FAILED' ? 'CALLBACK_HANDLER_FAILED' : null,
    event_type: 'payment.succeeded',
    headers: { ...mockHeaders },
    id: '01K1JAGG800000000000000000',
    payload: { event: 'payment.succeeded' },
    processed_at: status === 'RECEIVED' ? null : new Date('2026-08-01T01:01:00.000Z'),
    provider: 'MOCK' as const,
    provider_event_id: 'provider-event-1',
    provider_serial_no: null,
    raw_body: Buffer.from('trusted'),
    received_at: receivedAt,
    retry_count: status === 'FAILED' ? 8 : 0,
    signature_nonce: null,
    signature_timestamp: mockHeaders.mock_timestamp,
    signature_valid: true,
    status,
    verified_at: receivedAt,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function reconciliationHarness(
  initialStatus: 'FAILED' | 'PROCESSED' | 'PROCESSING' | 'RECEIVED',
  options: {
    created?: boolean;
    lockAcquisition?: Promise<void>;
    onLockWait?: () => void;
  } = {},
) {
  let state = callbackInbox(initialStatus);
  const createMany = vi.fn(async () => ({ count: options.created === true ? 1 : 0 }));
  const findUniqueOrThrow = vi.fn(async () => ({ ...state }));
  const transaction = {
    callbackInbox: { createMany, findUniqueOrThrow },
  } as unknown as DatabaseTransaction;
  const queries: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('pg_advisory_lock(')) {
        options.onLockWait?.();
        await options.lockAcquisition;
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('pg_try_advisory_lock(')) return { rowCount: 1, rows: [{ acquired: true }] };
      if (sql.includes('SELECT * FROM public.callback_inbox')) {
        return { rowCount: 1, rows: [{ ...state }] };
      }
      if (sql.includes('UPDATE public.callback_inbox')) {
        if (state.status !== values?.[1]) return { rowCount: 0, rows: [] };
        state = callbackInbox('RECEIVED');
        return { rowCount: 1, rows: [{ ...state }] };
      }
      return { rowCount: null, rows: [] };
    }),
    release: vi.fn(),
  }) as unknown as PoolClient;
  const coordinationPool = { connect: vi.fn(async () => client) };
  const pool = { connect: vi.fn(async () => client) };
  const runtime = {
    coordinationPool,
    pool,
    withPrismaTransaction: vi.fn(async (work: (current: DatabaseTransaction) => Promise<unknown>) => work(transaction)),
  } as unknown as DatabaseRuntime;
  return {
    client,
    coordinationPool,
    pool,
    queries,
    repository: new CallbackInboxRepository(runtime),
    setStatus(status: 'FAILED' | 'PROCESSED' | 'PROCESSING' | 'RECEIVED') {
      state = callbackInbox(status);
    },
  };
}

const reconciliationInput = {
  eventType: 'payment.succeeded',
  headers: mockHeaders,
  provider: 'MOCK' as const,
  providerEventId: 'provider-event-1',
  rawBody: Buffer.from('trusted'),
  signatureValid: true,
};

describe('callback inbox retry scheduling', () => {
  it('rejects an invalid signature before accessing the authoritative Inbox', async () => {
    const createMany = vi.fn();
    const findUniqueOrThrow = vi.fn();
    const transaction = {
      callbackInbox: { createMany, findUniqueOrThrow },
    } as unknown as DatabaseTransaction;

    await expect(new CallbackInboxRepository().receive(transaction, {
      eventType: 'payment.succeeded',
      headers: mockHeaders,
      provider: 'MOCK',
      providerEventId: 'provider-event-1',
      rawBody: Buffer.from('untrusted'),
      signatureValid: false,
    })).rejects.toThrow('must be verified before Inbox persistence');
    expect(createMany).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('processes a first attempt immediately regardless of backlog age', () => {
    const receivedAt = new Date('2026-08-01T00:00:00.000Z');
    expect(calculateCallbackDueAt(receivedAt, null, 0, 1_000)).toEqual(receivedAt);
  });

  it('anchors retries to the latest failed attempt instead of original receipt time', () => {
    const receivedAt = new Date('2026-08-01T00:00:00.000Z');
    const failedAt = new Date('2026-08-01T01:00:00.000Z');

    expect(calculateCallbackDueAt(receivedAt, failedAt, 1, 1_000)).toEqual(
      new Date('2026-08-01T01:00:01.000Z'),
    );
    expect(calculateCallbackDueAt(receivedAt, failedAt, 2, 1_000)).toEqual(
      new Date('2026-08-01T01:00:02.000Z'),
    );
  });

  it('delegates due filtering and limiting to PostgreSQL so a blocked prefix cannot starve ready rows', async () => {
    const readyRows = Array.from({ length: 10 }, (_, index) => ({ id: `ready-${index}` }));
    const queryRaw = vi.fn(async () => readyRows);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;

    const result = await new CallbackInboxRepository().findDue(transaction, {
      baseDelayMs: 1_000,
      handlers: [{ provider: 'MOCK', eventType: 'payment.succeeded' }],
      limit: 10,
      maxRetries: 8,
    });

    expect(result).toEqual(readyRows);
    expect(queryRaw).toHaveBeenCalledOnce();
    const query = queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[]; values?: readonly unknown[] };
    const sql = query.strings?.join('?') ?? '';
    expect(sql).toContain('COALESCE(processed_at, received_at)');
    expect(sql).toContain('LIMIT ?');
    expect(query.values).toContain('payment.succeeded');
    expect(sql).not.toContain('payment.succeeded');
  });

  it('uses an internal receipt clock and rejects caller-controlled time', async () => {
    const receivedAt = new Date('2026-08-01T01:00:00.000Z');
    const createMany = vi.fn(async () => ({ count: 1 }));
    const findUniqueOrThrow = vi.fn(async () => ({ id: 'inbox-id' }));
    const transaction = {
      callbackInbox: { createMany, findUniqueOrThrow },
    } as unknown as DatabaseTransaction;
    const repository = new CallbackInboxRepository(undefined, () => receivedAt);

    await repository.receive(transaction, {
      eventType: 'payment.succeeded',
      headers: mockHeaders,
      provider: 'MOCK',
      providerEventId: 'provider-event-1',
      rawBody: Buffer.from('trusted'),
      signatureValid: true,
    });
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ received_at: receivedAt, verified_at: receivedAt })],
    }));
    await expect(repository.receive(transaction, {
      eventType: 'payment.succeeded',
      headers: mockHeaders,
      provider: 'MOCK',
      providerEventId: 'provider-event-2',
      rawBody: Buffer.from('trusted'),
      receivedAt: new Date('2100-01-01T00:00:00.000Z'),
      signatureValid: true,
    } as never)).rejects.toThrow('unsupported fields');
    expect(() => new CallbackInboxRepository(undefined, () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');
  });

  it('persists only the closed MOCK signature header DTO', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      callbackInbox: {
        createMany,
        findUniqueOrThrow: vi.fn(async () => ({ id: 'inbox-id' })),
      },
    } as unknown as DatabaseTransaction;

    await new CallbackInboxRepository().receive(transaction, {
      eventType: 'payment.succeeded',
      headers: mockHeaders,
      provider: 'MOCK',
      providerEventId: 'provider-event-1',
      rawBody: Buffer.from('trusted'),
      signatureValid: true,
    });

    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        headers: mockHeaders,
        provider_serial_no: null,
        signature_nonce: null,
        signature_timestamp: mockHeaders.mock_timestamp,
      })],
    }));
  });

  it.each(['FAILED', 'PROCESSED'] as const)(
    'requeues an exactly matching %s callback only through the explicit reconciliation path',
    async (status) => {
      const current = reconciliationHarness(status);

      const result = await current.repository.receiveForReconciliation(reconciliationInput);

      expect(result).toEqual({ created: false, inbox: callbackInbox('RECEIVED'), requeued: true });
      expect(current.queries.some((query) => query.includes('FOR UPDATE'))).toBe(true);
      const update = current.client.query.mock.calls.find(([query]) =>
        String(query).includes('UPDATE public.callback_inbox'));
      expect(update?.[1]).toEqual([callbackInbox(status).id, status]);
      expect(current.client.release).toHaveBeenCalledWith(false);
      expect(current.pool.connect).toHaveBeenCalledOnce();
      expect(current.coordinationPool.connect).not.toHaveBeenCalled();
    },
  );

  it('processes callbacks under the dedicated coordination pool so a poolMax=1 handler can use Prisma', async () => {
    const current = reconciliationHarness('RECEIVED');
    const handler = vi.fn(async () => undefined);

    await expect(current.repository.processOne(callbackInbox('RECEIVED').id, handler, {
      baseDelayMs: 1_000,
      maxRetries: 8,
    })).resolves.toBe('processed');

    expect(handler).toHaveBeenCalledOnce();
    expect(current.coordinationPool.connect).toHaveBeenCalledOnce();
    expect(current.pool.connect).not.toHaveBeenCalled();
  });

  it('keeps an existing RECEIVED callback queued without rewriting its retry facts', async () => {
    const current = reconciliationHarness('RECEIVED');

    await expect(current.repository.receiveForReconciliation(reconciliationInput)).resolves.toEqual({
      created: false,
      inbox: callbackInbox('RECEIVED'),
      requeued: false,
    });
    expect(current.queries.some((query) => query.includes('UPDATE public.callback_inbox'))).toBe(false);
  });

  it('waits for the callback processor lock and re-reads the processed state before requeueing', async () => {
    const workerReleased = deferred();
    const lockWaitStarted = deferred();
    const current = reconciliationHarness('RECEIVED', {
      lockAcquisition: workerReleased.promise,
      onLockWait: lockWaitStarted.resolve,
    });

    const reconciliation = current.repository.receiveForReconciliation(reconciliationInput);
    await lockWaitStarted.promise;
    expect(current.queries.some((query) => query.includes('FOR UPDATE'))).toBe(false);

    current.setStatus('PROCESSED');
    workerReleased.resolve();
    await expect(reconciliation).resolves.toEqual({
      created: false,
      inbox: callbackInbox('RECEIVED'),
      requeued: true,
    });
    expect(current.queries.findIndex((query) => query.includes('pg_advisory_lock(')))
      .toBeLessThan(current.queries.findIndex((query) => query.includes('FOR UPDATE')));
  });

  it.each([
    { field: 'raw body', input: { ...reconciliationInput, rawBody: Buffer.from('different') } },
    {
      field: 'signature headers',
      input: {
        ...reconciliationInput,
        headers: { ...mockHeaders, mock_signature: 'different-signature-value' },
      },
    },
  ])('rejects reconciliation when the signed callback $field differs from the stored event', async ({ input }) => {
    const current = reconciliationHarness('PROCESSED');

    await expect(current.repository.receiveForReconciliation(input)).rejects.toThrow('facts conflict');
    expect(current.queries.some((query) => query.includes('UPDATE public.callback_inbox'))).toBe(false);
    expect(current.queries).toContain('ROLLBACK');
  });

  it('rejects a reconciliation attempt while an authoritative PROCESSING state remains under the lock', async () => {
    const current = reconciliationHarness('PROCESSING');

    await expect(current.repository.receiveForReconciliation(reconciliationInput))
      .rejects.toThrow('could not be queued');
    expect(current.queries.some((query) => query.includes('UPDATE public.callback_inbox'))).toBe(false);
  });

  it('normalizes the closed WECHAT signature header DTO into signature facts', async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      callbackInbox: {
        createMany,
        findUniqueOrThrow: vi.fn(async () => ({ id: 'inbox-id' })),
      },
    } as unknown as DatabaseTransaction;
    const headers = {
      timestamp: '1786582800',
      nonce: 'nonce_0123456789',
      serial: 'ABCDEF0123456789',
      signature: 'base64-signature-value==',
    };

    await new CallbackInboxRepository().receive(transaction, {
      eventType: 'TRANSACTION.SUCCESS',
      headers,
      provider: 'WECHAT',
      providerEventId: 'wechat-event-1',
      rawBody: Buffer.from('trusted'),
      signatureValid: true,
    });

    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        headers,
        provider_serial_no: headers.serial,
        signature_nonce: headers.nonce,
        signature_timestamp: headers.timestamp,
      })],
    }));
  });

  it.each([
    { ...mockHeaders, authorization: 'Bearer private' },
    { ...mockHeaders, cookie: 'session=private' },
    { ...mockHeaders, unknown: 'value' },
    { mock_signature: 'short', mock_timestamp: mockHeaders.mock_timestamp },
    { mock_signature: mockHeaders.mock_signature, mock_timestamp: 1786582800000 },
  ])('rejects unsafe or unknown MOCK callback headers: %j', async (headers) => {
    const createMany = vi.fn();
    const transaction = {
      callbackInbox: { createMany, findUniqueOrThrow: vi.fn() },
    } as unknown as DatabaseTransaction;

    await expect(new CallbackInboxRepository().receive(transaction, {
      eventType: 'payment.succeeded',
      headers,
      provider: 'MOCK',
      providerEventId: 'provider-event-1',
      rawBody: Buffer.from('trusted'),
      signatureValid: true,
    } as never)).rejects.toThrow('MOCK callback signature headers are invalid');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('rejects a WECHAT signature header DTO containing an HTTP authorization header', async () => {
    const createMany = vi.fn();
    const transaction = {
      callbackInbox: { createMany, findUniqueOrThrow: vi.fn() },
    } as unknown as DatabaseTransaction;

    await expect(new CallbackInboxRepository().receive(transaction, {
      eventType: 'TRANSACTION.SUCCESS',
      headers: {
        authorization: 'Bearer private',
        nonce: 'nonce_0123456789',
        serial: 'ABCDEF0123456789',
        signature: 'base64-signature-value==',
        timestamp: '1786582800',
      },
      provider: 'WECHAT',
      providerEventId: 'wechat-event-1',
      rawBody: Buffer.from('trusted'),
      signatureValid: true,
    } as never)).rejects.toThrow('WECHAT callback signature headers are invalid');
    expect(createMany).not.toHaveBeenCalled();
  });
});
