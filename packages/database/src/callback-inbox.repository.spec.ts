import { describe, expect, it, vi } from 'vitest';

import {
  calculateCallbackDueAt,
  CallbackInboxRepository,
} from './callback-inbox.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const mockHeaders = {
  mock_signature: 'mock-signature-value',
  mock_timestamp: '1786582800000',
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
