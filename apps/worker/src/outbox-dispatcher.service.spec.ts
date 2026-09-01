import { Logger } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime, OutboxEventModel } from '@qingxu/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OutboxDispatcherService,
  type WorkerCallbackHandler,
  type WorkerCallbackInboxRepository,
  type WorkerHandlerRegistry,
  type WorkerOutboxRepository,
} from './outbox-dispatcher.service';

const config: PlatformRuntimeConfig = {
  banner: { targetOrigins: [] },
  authentication: {
    accessTokenTtlSeconds: 900,
    audience: 'disabled',
    issuer: 'disabled',
    preAuthTokenTtlSeconds: 300,
    secretHashKeys: { current: { id: 'disabled', key: Buffer.alloc(32) }, previous: [] },
    sessionTtlSeconds: 604_800,
    signingKeys: { current: { id: 'disabled', key: Buffer.alloc(32) }, previous: [] },
  },
  environment: 'test',
  service: 'worker',
  port: 3001,
  database: {
    url: '',
    poolMax: 1,
    connectionTimeoutMs: 100,
    projectRef: undefined,
    sslRootCertPath: undefined,
    allowInsecureLocalhost: false,
  },
  encryption: {
    fieldKeys: { current: { id: 'test', key: Buffer.alloc(32) }, previous: [] },
    ipHashKey: Buffer.alloc(32, 1),
    idempotencyHashKeys: {
      current: { id: 'test-current', key: Buffer.alloc(32, 2) },
      previous: [],
    },
  },
  payment: { mockSigningKey: Buffer.alloc(32, 3), provider: 'MOCK', providerTimeoutMs: 1_000 },
  redis: { url: 'redis://:runtime-test-password@127.0.0.1:6379/0' },
  store: {
    authTokenAudience: 'qingxu-store',
    identityProvider: 'MOCK',
    phoneHashKeys: { current: { id: 'disabled', key: Buffer.alloc(32) }, previous: [] },
    phoneProvider: 'MOCK',
    wechatAppId: 'qingxu-mock-store-worker-test',
    wechatAppSecret: undefined,
    legalDocuments: {
      userAgreement: { version: 'test-v1', title: 'User agreement', url: 'https://example.test/user' },
      privacyPolicy: { version: 'test-v1', title: 'Privacy policy', url: 'https://example.test/privacy' },
      phoneAuthorization: { version: 'test-v1', title: 'Phone notice', url: 'https://example.test/phone' },
    },
    legalRateLimitMax: 120,
    legalRateLimitWindowSeconds: 60,
    loginRateLimitMax: 10,
    loginRateLimitWindowSeconds: 900,
    customerRateLimitMax: 120,
    customerRateLimitWindowSeconds: 60,
  },
  storage: {
    accessKey: 'minio-access-key',
    bucket: 'mall-test',
    endpoint: 'http://127.0.0.1:9000',
    forcePathStyle: true,
    maxUploadBytes: 5_242_880,
    pendingCleanupAgeSeconds: 86_400,
    privateDownloadTtlSeconds: 300,
    publicBaseUrl: 'http://127.0.0.1:9000/mall-test',
    region: 'us-east-1',
    secretKey: 'minio-secret-value',
    uploadTtlSeconds: 900,
  },
  worker: { pollIntervalMs: 1_000, batchSize: 10, maxRetries: 3, baseRetryDelayMs: 100 },
};

const outboxEvent = {
  id: '01K00000000000000000000000',
  aggregate_type: 'order',
  aggregate_id: '01K00000000000000000000001',
  event_type: 'order.created',
  payload: { secret: 'payload-must-not-be-logged' },
  status: 'PENDING',
  retry_count: 0,
  next_retry_at: null,
  error_message: null,
  created_at: new Date(),
  published_at: null,
} as OutboxEventModel;

const callbackEvent = {
  id: '01K00000000000000000000002',
  provider: 'MOCK',
  event_type: 'payment.succeeded',
  provider_event_id: 'mock-event-1',
  signature_valid: true,
  status: 'RECEIVED',
  retry_count: 0,
  received_at: new Date(),
} as Parameters<WorkerCallbackHandler>[0];

function createMocks() {
  const database = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    withPrismaTransaction: vi.fn(async (work: (transaction: object) => Promise<unknown>) => work({})),
  } as unknown as DatabaseRuntime;
  const outbox = {
    findDue: vi.fn(async () => []),
    publishOne: vi.fn(),
  } as unknown as WorkerOutboxRepository;
  const callbacks = {
    findDue: vi.fn(async () => []),
    processOne: vi.fn(),
  } as unknown as WorkerCallbackInboxRepository;
  return { database, outbox, callbacks };
}

function createService(registry: WorkerHandlerRegistry, mocks = createMocks()): OutboxDispatcherService {
  return new OutboxDispatcherService(mocks.database, config, registry, mocks.outbox, mocks.callbacks);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OutboxDispatcherService', () => {
  it('does not own the shared database lifecycle', async () => {
    const mocks = createMocks();
    const service = createService({ outbox: [], callbacks: [] }, mocks);

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(mocks.database.connect).not.toHaveBeenCalled();
    expect(mocks.database.disconnect).not.toHaveBeenCalled();
  });

  it('does not query or consume events when both registries are empty', async () => {
    const mocks = createMocks();
    const service = createService({ outbox: [], callbacks: [] }, mocks);

    await service.pollOnce();

    expect(mocks.outbox.findDue).not.toHaveBeenCalled();
    expect(mocks.outbox.publishOne).not.toHaveBeenCalled();
    expect(mocks.callbacks.findDue).not.toHaveBeenCalled();
    expect(mocks.callbacks.processOne).not.toHaveBeenCalled();
    expect(mocks.database.withPrismaTransaction).not.toHaveBeenCalled();
  });

  it('dispatches only a registered outbox event type', async () => {
    const mocks = createMocks();
    const handler = vi.fn(async () => undefined);
    vi.mocked(mocks.outbox.findDue).mockResolvedValue([outboxEvent]);
    vi.mocked(mocks.outbox.publishOne).mockImplementation(async (_id, registeredHandler) => {
      await registeredHandler(outboxEvent);
      return 'published';
    });
    const service = createService({
      outbox: [{ eventType: outboxEvent.event_type, handle: handler }],
      callbacks: [],
    }, mocks);

    await service.pollOnce();

    expect(mocks.outbox.findDue).toHaveBeenCalledWith({
      limit: config.worker.batchSize,
      eventTypes: [outboxEvent.event_type],
    });
    expect(mocks.outbox.publishOne).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(outboxEvent);
  });

  it('passes durable retry policy only for an explicitly registered outbox handler', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.outbox.findDue).mockResolvedValue([outboxEvent]);
    vi.mocked(mocks.outbox.publishOne).mockResolvedValue('retry_scheduled');
    const service = createService({
      outbox: [{ eventType: outboxEvent.event_type, handle: vi.fn(), retryAfterExhaustion: true }],
      callbacks: [],
    }, mocks);

    await service.pollOnce();

    expect(mocks.outbox.publishOne).toHaveBeenCalledWith(
      outboxEvent.id,
      expect.any(Function),
      {
        initialDelayMs: config.worker.baseRetryDelayMs,
        maximumDelayMs: 86_400_000,
        maxRetries: config.worker.maxRetries,
        retryAfterExhaustion: true,
      },
    );
  });

  it('does not consume an outbox event outside the registry even if a repository returns it', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.outbox.findDue).mockResolvedValue([outboxEvent]);
    const service = createService({
      outbox: [{ eventType: 'customer.updated', handle: vi.fn() }],
      callbacks: [],
    }, mocks);

    await service.pollOnce();

    expect(mocks.outbox.publishOne).not.toHaveBeenCalled();
  });

  it('dispatches a callback only through its provider and event type registration', async () => {
    const mocks = createMocks();
    const handler = vi.fn(async () => undefined);
    vi.mocked(mocks.callbacks.findDue).mockResolvedValue([callbackEvent]);
    vi.mocked(mocks.callbacks.processOne).mockImplementation(async (_id, registeredHandler) => {
      await registeredHandler(callbackEvent);
      return 'processed';
    });
    const service = createService({
      outbox: [],
      callbacks: [{ provider: 'MOCK', eventType: callbackEvent.event_type, handle: handler }],
    }, mocks);

    await service.pollOnce();

    expect(mocks.database.withPrismaTransaction).toHaveBeenCalledOnce();
    expect(mocks.callbacks.findDue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      handlers: [{ provider: 'MOCK', eventType: callbackEvent.event_type }],
    }));
    expect(mocks.callbacks.processOne).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(callbackEvent);
  });

  it('passes durable retry policy through callback selection and processing', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.callbacks.findDue).mockResolvedValue([callbackEvent]);
    vi.mocked(mocks.callbacks.processOne).mockResolvedValue('retry_scheduled');
    const service = createService({
      outbox: [],
      callbacks: [{
        provider: 'MOCK',
        eventType: callbackEvent.event_type,
        handle: vi.fn(),
        retryAfterExhaustion: true,
      }],
    }, mocks);

    await service.pollOnce();

    expect(mocks.callbacks.findDue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      handlers: [{
        provider: 'MOCK',
        eventType: callbackEvent.event_type,
        retryAfterExhaustion: true,
      }],
    }));
    expect(mocks.callbacks.processOne).toHaveBeenCalledWith(
      callbackEvent.id,
      expect.any(Function),
      {
        baseDelayMs: config.worker.baseRetryDelayMs,
        maxRetries: config.worker.maxRetries,
        retryAfterExhaustion: true,
      },
    );
  });

  it('does not consume a callback outside the registry even if a repository returns it', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.callbacks.findDue).mockResolvedValue([callbackEvent]);
    const service = createService({
      outbox: [],
      callbacks: [{ provider: 'MOCK', eventType: 'refund.succeeded', handle: vi.fn() }],
    }, mocks);

    await service.pollOnce();

    expect(mocks.callbacks.processOne).not.toHaveBeenCalled();
  });

  it('does not expose raw polling errors or event payloads in logs', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.outbox.findDue).mockRejectedValue(new Error('database password and private payload'));
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = createService({
      outbox: [{ eventType: outboxEvent.event_type, handle: vi.fn() }],
      callbacks: [],
    }, mocks);

    await service.pollOnce();

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain('WORKER_OUTBOX_POLL_FAILED');
    expect(logged).not.toContain('database password');
    expect(logged).not.toContain('payload-must-not-be-logged');
  });

  it('logs only allowlisted event metadata when retries are exhausted', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.outbox.findDue).mockResolvedValue([outboxEvent]);
    vi.mocked(mocks.outbox.publishOne).mockResolvedValue('terminal');
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = createService({
      outbox: [{ eventType: outboxEvent.event_type, handle: vi.fn() }],
      callbacks: [],
    }, mocks);

    await service.pollOnce();

    expect(errorLog).toHaveBeenCalledWith({
      code: 'WORKER_OUTBOX_RETRY_EXHAUSTED',
      eventId: outboxEvent.id,
      eventType: outboxEvent.event_type,
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('payload-must-not-be-logged');
  });

  it('rejects duplicate registry keys before polling', () => {
    const handler = vi.fn(async () => undefined);
    expect(() => createService({
      outbox: [
        { eventType: 'order.created', handle: handler },
        { eventType: 'order.created', handle: handler },
      ],
      callbacks: [],
    })).toThrow('Duplicate outbox handler');
  });

  it('rejects a duplicate payment callback provider and event type before polling', () => {
    const handler = vi.fn(async () => undefined);
    expect(() => createService({
      callbacks: [
        { provider: 'MOCK', eventType: 'payment.succeeded', handle: handler },
        { provider: 'MOCK', eventType: 'payment.succeeded', handle: handler },
      ],
      outbox: [],
    })).toThrow('Duplicate callback handler');
  });
});
