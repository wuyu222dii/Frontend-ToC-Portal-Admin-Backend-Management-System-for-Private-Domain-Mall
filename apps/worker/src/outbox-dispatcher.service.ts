import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CallbackInboxRepository,
  DatabaseRuntime,
  OutboxEventModel,
  OutboxRepository,
} from '@qingxu/database';

import { DATABASE_RUNTIME } from './database-runtime.provider';

type CallbackInboxModel = Awaited<ReturnType<CallbackInboxRepository['findDue']>>[number];

export type WorkerOutboxHandler = (event: OutboxEventModel) => Promise<void>;
export type WorkerCallbackHandler = (event: CallbackInboxModel) => Promise<void>;

export interface OutboxHandlerRegistration {
  eventType: string;
  handle: WorkerOutboxHandler;
}

export interface CallbackHandlerRegistration {
  provider: 'MOCK' | 'WECHAT';
  eventType: string;
  handle: WorkerCallbackHandler;
}

export interface WorkerHandlerRegistry {
  outbox: readonly OutboxHandlerRegistration[];
  callbacks: readonly CallbackHandlerRegistration[];
}

export type WorkerOutboxRepository = Pick<OutboxRepository, 'findDue' | 'publishOne'>;
export type WorkerCallbackInboxRepository = Pick<CallbackInboxRepository, 'findDue' | 'processOne'>;

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
export const WORKER_HANDLER_REGISTRY = Symbol('WORKER_HANDLER_REGISTRY');
export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
export const CALLBACK_INBOX_REPOSITORY = Symbol('CALLBACK_INBOX_REPOSITORY');

export function callbackHandlerKey(provider: 'MOCK' | 'WECHAT', eventType: string): string {
  return `${provider}:${eventType}`;
}

function assertUniqueHandlers(registry: WorkerHandlerRegistry): void {
  const outboxKeys = new Set<string>();
  for (const registration of registry.outbox) {
    if (outboxKeys.has(registration.eventType)) {
      throw new Error(`Duplicate outbox handler: ${registration.eventType}`);
    }
    outboxKeys.add(registration.eventType);
  }

  const callbackKeys = new Set<string>();
  for (const registration of registry.callbacks) {
    const key = callbackHandlerKey(registration.provider, registration.eventType);
    if (callbackKeys.has(key)) throw new Error(`Duplicate callback handler: ${key}`);
    callbackKeys.add(key);
  }
}

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private readonly outboxHandlers = new Map<string, WorkerOutboxHandler>();
  private readonly callbackHandlers = new Map<string, WorkerCallbackHandler>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopping = false;

  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(WORKER_CONFIG) private readonly config: PlatformRuntimeConfig,
    @Inject(WORKER_HANDLER_REGISTRY) private readonly registry: WorkerHandlerRegistry,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: WorkerOutboxRepository,
    @Inject(CALLBACK_INBOX_REPOSITORY) private readonly callbacks: WorkerCallbackInboxRepository,
  ) {
    assertUniqueHandlers(registry);
    for (const registration of registry.outbox) {
      this.outboxHandlers.set(registration.eventType, registration.handle);
    }
    for (const registration of registry.callbacks) {
      this.callbackHandlers.set(
        callbackHandlerKey(registration.provider, registration.eventType),
        registration.handle,
      );
    }
  }

  async onModuleInit(): Promise<void> {
    await this.database.connect();
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
    await this.database.disconnect();
  }

  async pollOnce(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.pollOutbox();
      await this.pollCallbacks();
    } finally {
      this.running = false;
    }
  }

  private async pollOutbox(): Promise<void> {
    const eventTypes = [...this.outboxHandlers.keys()];
    if (eventTypes.length === 0) return;

    try {
      const events = await this.outbox.findDue({
        limit: this.config.worker.batchSize,
        eventTypes,
      });
      for (const event of events) {
        const handler = this.outboxHandlers.get(event.event_type);
        if (!handler) continue;
        const result = await this.outbox.publishOne(event.id, handler, {
          maxRetries: this.config.worker.maxRetries,
          initialDelayMs: this.config.worker.baseRetryDelayMs,
        });
        if (result === 'terminal') {
          this.logger.error({
            code: 'WORKER_OUTBOX_RETRY_EXHAUSTED',
            eventId: event.id,
            eventType: event.event_type,
          });
        }
      }
    } catch {
      this.logger.error({ code: 'WORKER_OUTBOX_POLL_FAILED' });
    }
  }

  private async pollCallbacks(): Promise<void> {
    if (this.registry.callbacks.length === 0) return;

    try {
      const events = await this.database.withPrismaTransaction((transaction) => this.callbacks.findDue(
        transaction,
        {
          limit: this.config.worker.batchSize,
          maxRetries: this.config.worker.maxRetries,
          baseDelayMs: this.config.worker.baseRetryDelayMs,
          handlers: this.registry.callbacks.map(({ provider, eventType }) => ({ provider, eventType })),
        },
      ));
      for (const event of events) {
        const handler = this.callbackHandlers.get(callbackHandlerKey(event.provider, event.event_type));
        if (!handler) continue;
        const result = await this.callbacks.processOne(event.id, handler, {
          maxRetries: this.config.worker.maxRetries,
          baseDelayMs: this.config.worker.baseRetryDelayMs,
        });
        if (result === 'terminal') {
          this.logger.error({
            code: 'WORKER_CALLBACK_RETRY_EXHAUSTED',
            eventId: event.id,
            eventType: event.event_type,
            provider: event.provider,
          });
        }
      }
    } catch {
      this.logger.error({ code: 'WORKER_CALLBACK_POLL_FAILED' });
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => this.schedule(this.config.worker.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }
}
