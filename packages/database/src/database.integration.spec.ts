import { randomUUID } from 'node:crypto';

import { generateUlid, hmacCanonicalJson } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withSessionAdvisoryLock } from './advisory-lock';
import { AuditRepository } from './audit.repository';
import { CallbackInboxRepository } from './callback-inbox.repository';
import {
  deriveIdempotencyScope,
  IdempotencyRepository,
  type IdempotencyHashKey,
} from './idempotency.repository';
import { OutboxRepository } from './outbox.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B1_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B1_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const remoteRollbackTransactionOptions = mode === 'rollback'
  ? {
      isolationLevel: 'Serializable' as const,
      maxWait: 15_000,
      timeout: 60_000,
    }
  : undefined;
const remoteRollbackTestTimeoutMs = 90_000;
const auditKey = Buffer.alloc(32, 0x42);
const idempotencyHashKey = Buffer.alloc(32, 0x43);
const currentIdempotencyHashKey: IdempotencyHashKey = {
  id: 'integration-current-v2',
  key: idempotencyHashKey,
};
const previousIdempotencyHashKey: IdempotencyHashKey = {
  id: 'integration-previous-v1',
  key: Buffer.alloc(32, 0x44),
};
const rollbackSentinel = Object.freeze({ code: 'B1_ROLLBACK_SENTINEL' });
const mockHeaders = {
  mock_signature: 'mock-signature-value',
  mock_timestamp: '1786582800000',
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B1 database integration tests`);
  return value;
}

function createIntegrationRuntime(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B1 database tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new TypeError('Full B1 database tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      applicationName: 'qingxu-b1-integration',
      allowInsecureLocalhost: true,
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 12,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B1 database tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b1-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function uniqueLabel(prefix: string, maxLength = 80): string {
  return `${prefix}.${generateUlid()}`.slice(0, maxLength);
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function mutationRequest(body: unknown) {
  return {
    body,
    method: 'POST' as const,
    pathParameters: {},
    route: '/b1/integration-fixtures',
  };
}

function outboxPayload(resourceId: string) {
  return {
    event_version: 1 as const,
    resource_id: resourceId,
    resource_type: 'integration_fixture',
    resource_version: 1,
  };
}

function commandResponse(resourceId: string, status = 'ACTIVE') {
  return {
    code: 'OK' as const,
    data: {
      occurred_at: new Date().toISOString(),
      resource_id: resourceId,
      resource_type: 'integration_fixture',
      status,
      version: 1,
    },
    message: 'success' as const,
    request_id: requestId(),
  };
}

function idempotencyRequestHash(key: IdempotencyHashKey, request: unknown): string {
  return hmacCanonicalJson({ key_id: key.id, request }, key.key, 'idempotency-request');
}

function idempotencyResponseHash(key: IdempotencyHashKey, response: unknown): string {
  return hmacCanonicalJson({ key_id: key.id, response }, key.key, 'idempotency-response');
}

function findPostgresCode(error: unknown, seen = new Set<object>()): string | undefined {
  if (typeof error !== 'object' || error === null || seen.has(error)) return undefined;
  seen.add(error);
  for (const value of Object.values(error)) {
    if (value === '42501') return value;
    const nested = findPostgresCode(value, seen);
    if (nested) return nested;
  }
  return undefined;
}

async function waitFor(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

databaseDescribe('B1 database runtime integration', () => {
  let runtime: DatabaseRuntime;
  let audit: AuditRepository;
  let callbacks: CallbackInboxRepository;
  let idempotency: IdempotencyRepository;
  let outbox: OutboxRepository;

  beforeAll(async () => {
    runtime = createIntegrationRuntime();
    audit = new AuditRepository(auditKey);
    callbacks = new CallbackInboxRepository(runtime);
    idempotency = new IdempotencyRepository({ current: currentIdempotencyHashKey, previous: [] });
    outbox = new OutboxRepository(runtime);
    await runtime.connect();
  }, 30_000);

  afterAll(async () => {
    await runtime?.disconnect();
  }, 30_000);

  async function verifyAtomicRollback(): Promise<void> {
    const actorId = generateUlid();
    const aggregateId = generateUlid();
    const idempotencyKey = randomUUID();
    const providerEventId = uniqueLabel('rollback-callback', 128);
    const auditRequestId = requestId();
    const eventType = 'b1.rollback.v1';
    const claim = {
      actorId,
      idempotencyKey,
      request: mutationRequest({ operation: 'ROLLBACK_TEST' }),
    };

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      expect(await idempotency.claim(transaction, claim)).toEqual({ kind: 'execute' });
      await audit.append(transaction, {
        action: 'CREATE',
        after: { status: 'PENDING' },
        module: 'b1_test',
        objectId: aggregateId,
        objectType: 'integration_fixture',
        reasonCode: 'B1.ROLLBACK_TEST',
        requestId: auditRequestId,
        result: 'SUCCESS',
        summaryPolicy: 'STATUS_VERSION',
      });
      await callbacks.receive(transaction, {
        eventType,
        headers: mockHeaders,
        provider: 'MOCK',
        providerEventId,
        rawBody: Buffer.from('{"event":"ROLLBACK_TEST"}'),
        signatureValid: true,
      });
      await outbox.append(transaction, {
        aggregateId,
        aggregateType: 'integration_fixture',
        eventType,
        payload: outboxPayload(aggregateId),
      });
      await idempotency.complete(transaction, claim, {
        responseForHash: { code: 'ROLLED_BACK' },
        responseStatus: 201,
        storage: 'HASH_ONLY',
      });
      throw rollbackSentinel;
    }, remoteRollbackTransactionOptions)).rejects.toBe(rollbackSentinel);

    const [recordCount, auditCount, callbackCount, outboxCount] = await Promise.all([
      runtime.prisma.idempotencyRecord.count({ where: { actor_id: actorId, idempotency_key: idempotencyKey } }),
      runtime.prisma.auditLog.count({ where: { request_id: auditRequestId } }),
      runtime.prisma.callbackInbox.count({ where: { provider: 'MOCK', provider_event_id: providerEventId } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: aggregateId, event_type: eventType } }),
    ]);
    expect([recordCount, auditCount, callbackCount, outboxCount]).toEqual([0, 0, 0, 0]);
  }

  rollbackIt('writes all four B1 facts inside one transaction and leaves Supabase unchanged after rollback', async () => {
    await verifyAtomicRollback();
  }, remoteRollbackTestTimeoutMs);

  fullIt('connects only as the runtime role and pings PostgreSQL', async () => {
    await runtime.ping();
    const result = await runtime.pool.query<{ role: string }>('SELECT current_user AS role');
    expect(result.rows[0]?.role).toBe('mall_runtime');
  });

  fullIt('rolls back idempotency, audit, callback and outbox facts atomically', async () => {
    await verifyAtomicRollback();
  });

  fullIt('executes one side effect for concurrent requests sharing an idempotency key', async () => {
    const actorId = generateUlid();
    const aggregateId = generateUlid();
    const idempotencyKey = randomUUID();
    const eventType = 'b1.idempotent.v1';
    const auditRequestId = requestId();
    const claim = {
      actorId,
      idempotencyKey,
      request: mutationRequest({ aggregateId }),
    };

    const execute = () => runSerializableTransaction(runtime.prisma, async (transaction) => {
      const result = await idempotency.claim(transaction, claim);
      if (result.kind === 'replay') return 'replay' as const;
      await outbox.append(transaction, {
        aggregateId,
        aggregateType: 'integration_fixture',
        eventType,
        payload: outboxPayload(aggregateId),
      });
      await audit.append(transaction, {
        action: 'CREATE',
        module: 'b1_test',
        objectId: aggregateId,
        objectType: 'integration_fixture',
        requestId: auditRequestId,
        result: 'SUCCESS',
        summaryPolicy: 'NONE',
      });
      await waitFor(25);
      await idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: commandResponse(aggregateId),
        responseStatus: 201,
        storage: 'CACHEABLE',
      });
      return 'execute' as const;
    }, { maxAttempts: 5, initialDelayMs: 5 });

    const results = await Promise.all([execute(), execute()]);
    expect(results.sort()).toEqual(['execute', 'replay']);
    expect(await runtime.prisma.outboxEvent.count({ where: { aggregate_id: aggregateId, event_type: eventType } })).toBe(1);
    expect(await runtime.prisma.auditLog.count({ where: { request_id: auditRequestId } })).toBe(1);

    await expect(runtime.withPrismaTransaction((transaction) => idempotency.claim(transaction, {
      ...claim,
      request: mutationRequest({ aggregateId, changed: true }),
    }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  }, 30_000);

  fullIt('reuses an expired idempotency key and resets its expiry to exactly 24 hours', async () => {
    const actorId = generateUlid();
    const idempotencyKey = randomUUID();
    const now = new Date();
    const createdAt = new Date(now.getTime() - 48 * 60 * 60 * 1_000);
    const claim = {
      actorId,
      idempotencyKey,
      request: mutationRequest({ code: 'NEW_REQUEST' }),
    };
    await runtime.prisma.idempotencyRecord.create({
      data: {
        actor_id: actorId,
        created_at: createdAt,
        expires_at: new Date(createdAt.getTime() + 60 * 60 * 1_000),
        id: generateUlid(createdAt.getTime()),
        idempotency_key: idempotencyKey,
        request_hash: idempotencyRequestHash(
          currentIdempotencyHashKey,
          mutationRequest({ code: 'OLD_REQUEST' }),
        ),
        response_body_hash: idempotencyResponseHash(currentIdempotencyHashKey, { code: 'OLD' }),
        response_status: 200,
        scope: deriveIdempotencyScope(claim.request),
      },
    });

    const clockedIdempotency = new IdempotencyRepository(
      { current: currentIdempotencyHashKey, previous: [] },
      () => now,
    );
    const record = await runtime.withPrismaTransaction(async (transaction) => {
      expect(await clockedIdempotency.claim(transaction, claim)).toEqual({ kind: 'execute' });
      return clockedIdempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: commandResponse(actorId),
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
    });
    expect(record.expires_at.getTime()).toBe(now.getTime() + 24 * 60 * 60 * 1_000);
  });

  fullIt('replays across a key rotation without creating a second idempotency fact', async () => {
    const actorId = generateUlid();
    const resourceId = generateUlid();
    const idempotencyKey = randomUUID();
    const claim = {
      actorId,
      idempotencyKey,
      request: mutationRequest({ resourceId }),
    };
    const previousRepository = new IdempotencyRepository({
      current: previousIdempotencyHashKey,
      previous: [],
    });
    await runtime.withPrismaTransaction((transaction) => previousRepository.complete(transaction, claim, {
      policy: 'COMMAND_RESPONSE',
      responseBody: commandResponse(resourceId),
      responseStatus: 201,
      storage: 'CACHEABLE',
    }));

    const rotatedRepository = new IdempotencyRepository({
      current: currentIdempotencyHashKey,
      previous: [previousIdempotencyHashKey],
    });
    await expect(runtime.withPrismaTransaction((transaction) => rotatedRepository.claim(transaction, claim)))
      .resolves.toMatchObject({ kind: 'replay' });
    await expect(runtime.withPrismaTransaction((transaction) => idempotency.claim(transaction, claim)))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await runtime.prisma.idempotencyRecord.count({
      where: { actor_id: actorId, idempotency_key: idempotencyKey },
    })).toBe(1);
  });

  fullIt('preserves the first callback facts when a provider event is delivered twice', async () => {
    const providerEventId = uniqueLabel('duplicate-callback', 128);
    const eventType = uniqueLabel('b1.duplicate', 80);
    const [first, duplicate] = await runtime.withPrismaTransaction(async (transaction) => {
      const created = await callbacks.receive(transaction, {
        eventType,
        headers: { ...mockHeaders, mock_signature: 'mock-signature-first' },
        provider: 'MOCK',
        providerEventId,
        rawBody: Buffer.from('FIRST'),
        signatureValid: true,
      });
      const repeated = await callbacks.receive(transaction, {
        eventType: 'must.not.replace',
        headers: { ...mockHeaders, mock_signature: 'mock-signature-second' },
        provider: 'MOCK',
        providerEventId,
        rawBody: Buffer.from('SECOND'),
        signatureValid: true,
      });
      return [created, repeated] as const;
    });
    expect(first.created).toBe(true);
    expect(duplicate.created).toBe(false);
    expect(Buffer.from(duplicate.inbox.raw_body).toString()).toBe('FIRST');
    expect(duplicate.inbox.headers).toEqual({ ...mockHeaders, mock_signature: 'mock-signature-first' });
    expect(duplicate.inbox.signature_valid).toBe(true);
  });

  fullIt('does not let an invalid signature occupy an authoritative provider event ID', async () => {
    const providerEventId = uniqueLabel('invalid-first-callback', 128);
    const eventType = uniqueLabel('b1.invalid-first', 80);

    await expect(runtime.withPrismaTransaction((transaction) => callbacks.receive(transaction, {
      eventType,
      headers: { ...mockHeaders, mock_signature: 'mock-signature-untrusted' },
      provider: 'MOCK',
      providerEventId,
      rawBody: Buffer.from('UNTRUSTED'),
      signatureValid: false,
    }))).rejects.toThrow('must be verified before Inbox persistence');
    expect(await runtime.prisma.callbackInbox.count({
      where: { provider: 'MOCK', provider_event_id: providerEventId },
    })).toBe(0);

    const valid = await runtime.withPrismaTransaction((transaction) => callbacks.receive(transaction, {
      eventType,
      headers: { ...mockHeaders, mock_signature: 'mock-signature-trusted' },
      provider: 'MOCK',
      providerEventId,
      rawBody: Buffer.from('TRUSTED'),
      signatureValid: true,
    }));
    expect(valid.created).toBe(true);
    expect(Buffer.from(valid.inbox.raw_body).toString()).toBe('TRUSTED');
    expect(valid.inbox.signature_valid).toBe(true);
  });

  fullIt('does not let forty delayed retries starve ten ready callbacks', async () => {
    const eventType = uniqueLabel('b1.starvation', 80);
    const prefix = uniqueLabel('starvation', 80);
    const now = new Date();
    const blockedIds: string[] = [];
    const readyIds: string[] = [];
    await runtime.withPrismaTransaction(async (transaction) => {
      for (let index = 0; index < 50; index += 1) {
        const receiptTime = index < 40
          ? new Date(now.getTime() - 60 * 60 * 1_000)
          : new Date(now.getTime() - 1_000);
        const receiptCallbacks = new CallbackInboxRepository(runtime, () => receiptTime);
        const result = await receiptCallbacks.receive(transaction, {
          eventType,
          headers: { ...mockHeaders, mock_signature: `mock-signature-${String(index)}` },
          provider: 'MOCK',
          providerEventId: `${prefix}.${String(index)}`,
          rawBody: Buffer.from(`EVENT-${String(index)}`),
          signatureValid: true,
        });
        (index < 40 ? blockedIds : readyIds).push(result.inbox.id);
      }
      await transaction.callbackInbox.updateMany({
        data: { processed_at: now, retry_count: 1 },
        where: { id: { in: blockedIds } },
      });
    });

    const dueCallbacks = new CallbackInboxRepository(runtime, () => now);
    const due = await runtime.withPrismaTransaction((transaction) => dueCallbacks.findDue(transaction, {
      baseDelayMs: 60_000,
      handlers: [{ eventType, provider: 'MOCK' }],
      limit: 10,
      maxRetries: 8,
    }));
    expect(due.map(({ id }) => id).sort()).toEqual(readyIds.sort());
  }, 30_000);

  fullIt('anchors callback retries to the latest failure and processes a due retry once', async () => {
    const eventType = uniqueLabel('b1.callback-retry', 80);
    const receiptCallbacks = new CallbackInboxRepository(
      runtime,
      () => new Date(Date.now() - 60 * 60 * 1_000),
    );
    const received = await runtime.withPrismaTransaction((transaction) => receiptCallbacks.receive(transaction, {
      eventType,
      headers: { ...mockHeaders, mock_signature: 'mock-signature-old-backlog' },
      provider: 'MOCK',
      providerEventId: uniqueLabel('old-backlog', 128),
      rawBody: Buffer.from('OLD_BACKLOG'),
      signatureValid: true,
    }));
    const options = { baseDelayMs: 60_000, maxRetries: 3 };
    await expect(callbacks.processOne(received.inbox.id, async () => {
      throw Object.assign(new Error('private failure detail'), { code: 'TEST_CALLBACK_FAILURE' });
    }, options)).resolves.toBe('retry_scheduled');
    await expect(callbacks.processOne(received.inbox.id, async () => undefined, options)).resolves.toBe('stale');

    await runtime.prisma.callbackInbox.update({
      data: { processed_at: new Date(Date.now() - 60_100) },
      where: { id: received.inbox.id },
    });
    let handled = 0;
    const results = await Promise.all([
      callbacks.processOne(received.inbox.id, async () => { handled += 1; await waitFor(30); }, options),
      callbacks.processOne(received.inbox.id, async () => { handled += 1; }, options),
    ]);
    expect(handled).toBe(1);
    expect(results).toContain('processed');
    expect(results.some((result) => result === 'busy' || result === 'stale')).toBe(true);
  });

  fullIt('keeps an explicitly durable callback eligible after the ordinary retry limit', async () => {
    const eventType = uniqueLabel('b1.durable-callback', 80);
    const received = await runtime.withPrismaTransaction((transaction) => callbacks.receive(transaction, {
      eventType,
      headers: { ...mockHeaders, mock_signature: 'mock-signature-durable-callback' },
      provider: 'MOCK',
      providerEventId: uniqueLabel('durable-callback', 128),
      rawBody: Buffer.from('DURABLE_CALLBACK'),
      signatureValid: true,
    }));
    const options = { baseDelayMs: 1, maxRetries: 1, retryAfterExhaustion: true };

    await expect(callbacks.processOne(received.inbox.id, async () => {
      throw new Error('temporary callback failure');
    }, options)).resolves.toBe('retry_scheduled');
    await runtime.prisma.callbackInbox.update({
      data: { processed_at: new Date(Date.now() - 10) },
      where: { id: received.inbox.id },
    });
    const due = await runtime.withPrismaTransaction((transaction) => callbacks.findDue(transaction, {
      ...options,
      handlers: [{ eventType, provider: 'MOCK', retryAfterExhaustion: true }],
      limit: 10,
    }));
    expect(due.map(({ id }) => id)).toContain(received.inbox.id);
    await expect(callbacks.processOne(received.inbox.id, async () => undefined, options))
      .resolves.toBe('processed');
    await expect(runtime.prisma.callbackInbox.findUniqueOrThrow({ where: { id: received.inbox.id } }))
      .resolves.toMatchObject({ retry_count: 1, status: 'PROCESSED' });
  });

  fullIt('publishes an outbox event once without keeping a database transaction open during the handler', async () => {
    const aggregateId = generateUlid();
    const event = await runtime.withPrismaTransaction((transaction) => outbox.append(transaction, {
      aggregateId,
      aggregateType: 'integration_fixture',
      eventType: 'b1.publish.v1',
      payload: outboxPayload(aggregateId),
    }));
    let handled = 0;
    const handler = async () => {
      handled += 1;
      const lockSessions = await runtime.pool.query<{ open_transactions: number }>(`
        SELECT count(*) FILTER (WHERE activity.xact_start IS NOT NULL)::int AS open_transactions
        FROM pg_catalog.pg_locks AS locks
        JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory'
          AND locks.granted = TRUE
          AND activity.application_name = 'qingxu-b1-integration'
      `);
      expect(lockSessions.rows[0]?.open_transactions).toBe(0);
      await waitFor(30);
    };
    const options = { initialDelayMs: 10, maxRetries: 3, maximumDelayMs: 1_000 };
    const results = await Promise.all([
      outbox.publishOne(event.id, handler, options),
      outbox.publishOne(event.id, handler, options),
    ]);
    expect(handled).toBe(1);
    expect(results).toContain('published');
    expect(results.some((result) => result === 'busy' || result === 'stale')).toBe(true);
  });

  fullIt('sanitizes outbox failures and stops after the configured retry maximum', async () => {
    const aggregateId = generateUlid();
    const event = await runtime.withPrismaTransaction((transaction) => outbox.append(transaction, {
      aggregateId,
      aggregateType: 'integration_fixture',
      eventType: 'b1.retry.v1',
      payload: outboxPayload(aggregateId),
    }));
    const handler = async () => { throw new Error('private credential detail'); };
    const options = { initialDelayMs: 1, maxRetries: 2, maximumDelayMs: 10 };
    await expect(outbox.publishOne(event.id, handler, options)).resolves.toBe('retry_scheduled');
    await runtime.prisma.outboxEvent.update({
      data: { next_retry_at: new Date(Date.now() - 1) },
      where: { id: event.id },
    });
    await expect(outbox.publishOne(event.id, handler, options)).resolves.toBe('terminal');
    const stored = await runtime.prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored).toMatchObject({
      error_message: 'OUTBOX_HANDLER_FAILED',
      next_retry_at: null,
      retry_count: 2,
      status: 'FAILED',
    });
  });

  fullIt('keeps an explicitly durable outbox event retryable after the ordinary limit', async () => {
    const aggregateId = generateUlid();
    const event = await runtime.withPrismaTransaction((transaction) => outbox.append(transaction, {
      aggregateId,
      aggregateType: 'integration_fixture',
      eventType: 'b1.durable-retry.v1',
      payload: outboxPayload(aggregateId),
    }));
    const options = {
      initialDelayMs: 1,
      maximumDelayMs: 86_400_000,
      maxRetries: 1,
      retryAfterExhaustion: true,
    };
    await expect(outbox.publishOne(event.id, async () => {
      throw new Error('temporary outbox failure');
    }, options)).resolves.toBe('retry_scheduled');
    await runtime.prisma.outboxEvent.update({
      data: { next_retry_at: new Date(Date.now() - 1) },
      where: { id: event.id },
    });
    await expect(outbox.publishOne(event.id, async () => undefined, options)).resolves.toBe('published');
    await expect(runtime.prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }))
      .resolves.toMatchObject({ next_retry_at: null, retry_count: 1, status: 'PUBLISHED' });
  });

  fullIt('enforces append-only audit facts for the runtime role', async () => {
    const entry = await runtime.withPrismaTransaction((transaction) => audit.append(transaction, {
      action: 'CREATE',
      module: 'b1_test',
      objectId: generateUlid(),
      objectType: 'integration_fixture',
      requestId: requestId(),
      result: 'SUCCESS',
      summaryPolicy: 'NONE',
    }));
    for (const statement of [
      ['UPDATE public.audit_log SET reason = $2 WHERE id = $1', [entry.id, 'ILLEGAL_UPDATE']],
      ['DELETE FROM public.audit_log WHERE id = $1', [entry.id]],
    ] as const) {
      try {
        await runtime.pool.query(statement[0], statement[1]);
        throw new Error('Expected runtime audit mutation to be denied');
      } catch (error) {
        expect(findPostgresCode(error)).toBe('42501');
      }
    }
  });

  fullIt('releases a session advisory lock when handler work throws', async () => {
    const key = generateUlid();
    const original = new Error('expected handler failure');
    await expect(withSessionAdvisoryLock(runtime.pool, 'b1-lock-release', key, async () => {
      throw original;
    })).rejects.toBe(original);
    await expect(withSessionAdvisoryLock(runtime.pool, 'b1-lock-release', key, async () => 'acquired'))
      .resolves.toEqual({ acquired: true, value: 'acquired' });
  });
});
