import { generateUlid } from '@qingxu/platform-core';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import type { DatabaseTransaction } from './idempotency.repository';
import { OutboxRepository, type ResourceOutboxPayloadV1 } from './outbox.repository';
import type { DatabaseRuntime } from './runtime';

function transactionStub(): DatabaseTransaction {
  return {
    outboxEvent: {
      create: vi.fn(async ({ data }: { data: object }) => data),
    },
  } as unknown as DatabaseTransaction;
}

function input() {
  const aggregateId = generateUlid();
  const payload: ResourceOutboxPayloadV1 = {
    event_version: 1,
    resource_id: aggregateId,
    resource_type: 'order',
    resource_version: 1,
  };
  return {
    aggregateId,
    aggregateType: 'order',
    eventType: 'order.updated',
    payload,
  };
}

describe('OutboxRepository append boundary', () => {
  const fixturePhone = ['138', '0013', '8000'].join('');

  it('stores only a closed versioned resource reference', async () => {
    const transaction = transactionStub();
    const event = input();
    const createdAt = new Date('2026-08-13T00:00:00.000Z');

    await new OutboxRepository({} as DatabaseRuntime, () => createdAt).append(transaction, event);

    expect(transaction.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aggregate_id: event.aggregateId,
        aggregate_type: 'order',
        event_type: 'order.updated',
        payload: event.payload,
        created_at: createdAt,
        next_retry_at: null,
      }),
    }));
  });

  it('accepts the registered commission aggregate without widening its payload', async () => {
    const transaction = transactionStub();
    const aggregateId = generateUlid();

    await new OutboxRepository({} as DatabaseRuntime).append(transaction, {
      aggregateId,
      aggregateType: 'commission',
      eventType: 'commission.expected.created',
      payload: {
        event_version: 1,
        resource_id: aggregateId,
        resource_type: 'commission',
        resource_version: 1,
      },
    });

    expect(transaction.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        aggregate_id: aggregateId,
        aggregate_type: 'commission',
        event_type: 'commission.expected.created',
      }),
    }));
  });

  it('stores a future availability boundary in the existing retry timestamp', async () => {
    const transaction = transactionStub();
    const createdAt = new Date('2026-08-13T00:00:00.000Z');
    const availableAt = new Date('2026-08-14T00:15:00.000Z');

    await new OutboxRepository({} as DatabaseRuntime, () => createdAt).append(transaction, {
      ...input(),
      availableAt,
    });

    expect(transaction.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ next_retry_at: availableAt }),
    }));
  });

  it('rejects caller-controlled event time and an invalid internal clock', async () => {
    await expect(new OutboxRepository({} as DatabaseRuntime).append(transactionStub(), {
      ...input(),
      createdAt: new Date('2100-01-01T00:00:00.000Z'),
    } as never)).rejects.toThrow('unsupported fields');
    expect(() => new OutboxRepository({} as DatabaseRuntime, () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');
  });

  it('rejects an invalid or pre-creation availability boundary', async () => {
    const createdAt = new Date('2026-08-13T00:00:00.000Z');
    const repository = new OutboxRepository({} as DatabaseRuntime, () => createdAt);
    await expect(repository.append(transactionStub(), {
      ...input(),
      availableAt: new Date(createdAt.getTime() - 1),
    })).rejects.toThrow('at or after creation');
    await expect(repository.append(transactionStub(), {
      ...input(),
      availableAt: new Date(Number.NaN),
    })).rejects.toThrow('valid date');
  });

  it.each([
    { payload: { access_token: 'private' } },
    { payload: { ...input().payload, phone: fixturePhone } },
    { payload: { ...input().payload, resource_type: 'payment' } },
    { payload: { ...input().payload, resource_id: generateUlid() } },
    { payload: { ...input().payload, resource_version: 0 } },
  ])('rejects an unregistered or mismatched payload: %j', async (override) => {
    await expect(new OutboxRepository({} as DatabaseRuntime).append(transactionStub(), {
      ...input(),
      ...override,
    } as never)).rejects.toThrow('RESOURCE_EVENT_V1');
  });

  it('rejects unregistered metadata before touching the database', async () => {
    const transaction = transactionStub();
    await expect(new OutboxRepository({} as DatabaseRuntime).append(transaction, {
      ...input(),
      aggregateType: 'token_private',
    })).rejects.toThrow('aggregate type is not registered');
    await expect(new OutboxRepository({} as DatabaseRuntime).append(transaction, {
      ...input(),
      eventType: 'recovery-code-ABCDEF123456',
    })).rejects.toThrow('event type has an invalid format');
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('OutboxRepository due boundary', () => {
  it('includes PENDING events only when their availability time is null or due', async () => {
    const now = new Date('2026-08-14T00:00:00.000Z');
    const findMany = vi.fn(async () => []);
    const runtime = { prisma: { outboxEvent: { findMany } } } as unknown as DatabaseRuntime;

    await new OutboxRepository(runtime, () => now).findDue({
      eventTypes: ['file.staging_cleanup_requested'],
      limit: 20,
    });

    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 20,
      where: {
        event_type: { in: ['file.staging_cleanup_requested'] },
        OR: [
          {
            status: 'PENDING',
            OR: [
              { next_retry_at: null },
              { next_retry_at: { lte: now } },
            ],
          },
          { status: 'FAILED', next_retry_at: { lte: now } },
        ],
      },
    });
  });

  it('keeps an explicitly durable financial event retryable after the ordinary limit', async () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    const current = {
      aggregate_id: generateUlid(),
      aggregate_type: 'refund',
      created_at: new Date(now.getTime() - 10_000),
      error_message: 'OUTBOX_HANDLER_FAILED',
      event_type: 'refund.execution.requested',
      id: generateUlid(),
      next_retry_at: new Date(now.getTime() - 1),
      payload: {},
      published_at: null,
      retry_count: 2,
      status: 'FAILED',
    };
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
        if (sql.includes('SELECT * FROM public.outbox_event')) return { rows: [current] };
        return { rows: [] };
      }),
      release: vi.fn(),
    }) as unknown as PoolClient;
    const runtime = { pool: { connect: vi.fn(async () => client) } } as unknown as DatabaseRuntime;
    const repository = new OutboxRepository(runtime, () => now);

    await expect(repository.publishOne(current.id, async () => {
      throw new Error('provider remains unknown');
    }, {
      initialDelayMs: 100,
      maximumDelayMs: 86_400_000,
      maxRetries: 2,
      retryAfterExhaustion: true,
    })).resolves.toBe('retry_scheduled');

    const update = queries.find(({ sql }) => sql.includes('UPDATE public.outbox_event'));
    expect(update?.values?.[1]).toBe(2);
    expect(update?.values?.[2]).toEqual(new Date(now.getTime() + 200));
    expect(client.release).toHaveBeenCalledWith(false);
  });
});
