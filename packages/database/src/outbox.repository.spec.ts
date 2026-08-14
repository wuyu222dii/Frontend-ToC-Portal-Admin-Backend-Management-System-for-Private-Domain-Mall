import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

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
});
