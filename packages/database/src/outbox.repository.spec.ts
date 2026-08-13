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
      }),
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
