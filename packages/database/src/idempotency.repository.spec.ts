import { generateUlid, hmacCanonicalJson } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import {
  IdempotencyRepository,
  type CacheableCommandResponse,
  type DatabaseTransaction,
  deriveIdempotencyScope,
  type IdempotencyHashKey,
} from './idempotency.repository';

const hashKey = Buffer.alloc(32, 0x35);
const currentHashKey: IdempotencyHashKey = { id: 'test-current-v2', key: hashKey };
const previousHashKey: IdempotencyHashKey = { id: 'test-previous-v1', key: Buffer.alloc(32, 0x36) };
const phoneFixture = ['138', '0013', '8000'].join('');
const cardFixture = ['6222', '0202', '0202', '0202'].join('');
const baseClaim = {
  actorId: generateUlid(),
  idempotencyKey: '9ece497e-0847-4c3b-b4c2-2d777784c3fe',
  request: {
    body: { operation: 'create' },
    method: 'POST' as const,
    pathParameters: {},
    route: '/test/resources',
  },
};

function repository(): IdempotencyRepository {
  return new IdempotencyRepository({ current: currentHashKey, previous: [] });
}

function requestHash(key: IdempotencyHashKey, claim = baseClaim): string {
  return hmacCanonicalJson(
    { key_id: key.id, request: claim.request },
    key.key,
    'idempotency-request',
  );
}

function responseHash(key: IdempotencyHashKey, response: unknown): string {
  return hmacCanonicalJson(
    { key_id: key.id, response },
    key.key,
    'idempotency-response',
  );
}

function commandResponse(override: Partial<CacheableCommandResponse> = {}): CacheableCommandResponse {
  return {
    code: 'OK',
    data: {
      occurred_at: '2026-08-13T00:00:00.000Z',
      resource_id: generateUlid(),
      resource_type: 'product',
      status: 'ACTIVE',
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  };
}

function transactionStub(): DatabaseTransaction {
  return {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    idempotencyRecord: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: { create: object }) => create),
    },
  } as unknown as DatabaseTransaction;
}

describe('IdempotencyRepository', () => {
  it('rejects malformed actor and key identifiers before accessing the database', async () => {
    const subject = repository();
    const transaction = transactionStub();

    await expect(subject.claim(transaction, { ...baseClaim, actorId: 'not-an-ulid' }))
      .rejects.toThrow('actor ID must be a ULID');
    await expect(subject.claim(transaction, { ...baseClaim, idempotencyKey: 'not-a-uuid' }))
      .rejects.toThrow('Idempotency key must be a UUID');
    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('stores an approved CommandResponse and computes its canonical hash', async () => {
    const transaction = transactionStub();
    const responseBody = commandResponse();

    await repository().complete(transaction, baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 201,
      storage: 'CACHEABLE',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        resource_id: responseBody.data.resource_id,
        response_body: responseBody,
        response_body_hash: responseHash(currentHashKey, responseBody),
      }),
    }));
  });

  it('derives CACHEABLE resource identity from the closed response body', async () => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'COMMAND_RESPONSE',
      resourceId: generateUlid(),
      responseBody: commandResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('unsupported fields');
  });

  it('stores no response body in fail-closed HASH_ONLY mode', async () => {
    const transaction = transactionStub();
    const responseForHash = { full_card_number: 'sensitive-value' };

    await repository().complete(transaction, baseClaim, {
      responseForHash,
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        response_body: Prisma.DbNull,
        response_body_hash: responseHash(currentHashKey, responseForHash),
      }),
    }));
  });

  it('requires a strong repository-owned HMAC key and a normalized mutation descriptor', async () => {
    expect(() => new IdempotencyRepository({
      current: { id: 'test-short', key: Buffer.alloc(31) },
      previous: [],
    })).toThrow('at least 32 bytes');
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      request: { ...baseClaim.request, method: 'GET' as 'POST' },
    })).rejects.toThrow('request descriptor is invalid');
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      request: { ...baseClaim.request, route: '/test/resources?token=private' },
    })).rejects.toThrow('request descriptor is invalid');
  });

  it('derives an opaque persisted scope instead of accepting caller metadata', async () => {
    const transaction = transactionStub();
    const request = { ...baseClaim.request, route: '/api/v1/customers/{customer_id}' };
    await repository().complete(transaction, { ...baseClaim, request }, {
      responseForHash: { code: 'OK' },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });

    const scope = vi.mocked(transaction.idempotencyRecord.upsert).mock.calls[0]?.[0].create.scope;
    expect(scope).toMatch(/^idempotency:v1:[a-f0-9]{64}$/);
    expect(scope).not.toContain('customers');
    expect(scope).not.toContain('customer_id');
  });

  it('rejects a caller-controlled scope field', async () => {
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      scope: `phone:${phoneFixture}`,
    } as never)).rejects.toThrow('claim contains unsupported fields');
  });

  it.each([
    { access_token: 'opaque-value' },
    { invite_code: 'ABCDEF123456' },
    { recovery_codes: ['ABCDEF123456'] },
    { refresh: 'ABCDEF123456' },
    { pre_auth: 'ABCDEF123456' },
    { reauth_grant: 'ABCDEF123456' },
    { amount: phoneFixture },
    { amount: cardFixture },
    { status: 'RECOVERY-CODE-ABC123' },
    { code: 'PRE-AUTH-TOKEN-ABC123' },
  ])('rejects non-CommandResponse CACHEABLE content: %j', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid COMMAND_RESPONSE');
  });

  it.each([
    commandResponse({ code: 'PRIVATE' as 'OK' }),
    commandResponse({ message: 'ABCDEF123456' as 'success' }),
    commandResponse({ request_id: phoneFixture }),
    commandResponse({ data: { ...commandResponse().data, resource_id: 'ABCDEF123456' } }),
    commandResponse({ data: { ...commandResponse().data, resource_type: 'access_token' } }),
    commandResponse({ data: { ...commandResponse().data, status: 'RECOVERY-CODE-ABC123' } }),
    commandResponse({ data: { ...commandResponse().data, version: 0 } }),
    commandResponse({ data: { ...commandResponse().data, occurred_at: 'not-a-timestamp' } }),
    { ...commandResponse(), extra: 'ACTIVE' },
    { ...commandResponse(), data: { ...commandResponse().data, extra: 'ACTIVE' } },
  ])('rejects malformed closed CommandResponse content: %j', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid COMMAND_RESPONSE');
  });

  it('always uses the fixed 24-hour retention period', async () => {
    const transaction = transactionStub();
    const now = new Date('2026-08-13T00:00:00.000Z');
    await new IdempotencyRepository({ current: currentHashKey, previous: [] }, () => now)
      .complete(transaction, baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody: commandResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ expires_at: new Date('2026-08-14T00:00:00.000Z') }),
    }));
  });

  it('rejects caller-controlled digest and expiry fields', async () => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      responseForHash: { code: 'OK' },
      responseHash: 'a'.repeat(64),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    } as never)).rejects.toThrow('unsupported fields');
    await expect(repository().complete(transactionStub(), baseClaim, {
      expiresAt: new Date(),
      policy: 'COMMAND_RESPONSE',
      responseBody: commandResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('unsupported fields');
  });

  it('rejects caller-controlled time and an invalid internal clock', async () => {
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      now: new Date('2100-01-01T00:00:00.000Z'),
    } as never)).rejects.toThrow('claim contains unsupported fields');
    expect(() => new IdempotencyRepository(
      { current: currentHashKey, previous: [] },
      () => new Date(Number.NaN),
    ))
      .toThrow('clock must return a valid Date');
  });

  it('replays an unexpired record signed by a retained previous key after rotation', async () => {
    const responseBody = commandResponse();
    const record = {
      actor_id: baseClaim.actorId,
      created_at: new Date('2026-08-12T00:00:00.000Z'),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      id: generateUlid(),
      idempotency_key: baseClaim.idempotencyKey,
      request_hash: requestHash(previousHashKey),
      resource_id: responseBody.data.resource_id,
      response_body: responseBody,
      response_body_hash: responseHash(previousHashKey, responseBody),
      response_status: 201,
      scope: deriveIdempotencyScope(baseClaim.request),
    };
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue(record as never);
    const rotated = new IdempotencyRepository({
      current: currentHashKey,
      previous: [previousHashKey],
    });

    await expect(rotated.claim(transaction, baseClaim)).resolves.toEqual({ kind: 'replay', record });
  });

  it('fails closed instead of re-executing when a still-required previous key was removed', async () => {
    const responseBody = commandResponse();
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue({
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      request_hash: requestHash(previousHashKey),
      response_body: responseBody,
      response_body_hash: responseHash(previousHashKey, responseBody),
      response_status: 200,
      resource_id: responseBody.data.resource_id,
    } as never);

    await expect(repository().claim(transaction, baseClaim)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it.each([
    (record: Record<string, unknown>) => ({ ...record, response_body: commandResponse() }),
    (record: Record<string, unknown>) => ({ ...record, response_body_hash: '0'.repeat(64) }),
    (record: Record<string, unknown>) => ({ ...record, resource_id: generateUlid() }),
    (record: Record<string, unknown>) => ({ ...record, response_status: 500 }),
  ])('rejects a corrupted cache record before replay', async (corrupt) => {
    const responseBody = commandResponse();
    const baseRecord = {
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      request_hash: requestHash(currentHashKey),
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
      resource_id: responseBody.data.resource_id,
    };
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue(corrupt(baseRecord) as never);

    await expect(repository().claim(transaction, baseClaim)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('rejects a corrupted existing record reached through complete', async () => {
    const responseBody = commandResponse();
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue({
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      request_hash: requestHash(currentHashKey),
      response_body: responseBody,
      response_body_hash: '0'.repeat(64),
      response_status: 200,
      resource_id: responseBody.data.resource_id,
    } as never);

    await expect(repository().complete(transaction, baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(transaction.idempotencyRecord.upsert).not.toHaveBeenCalled();
  });
});
