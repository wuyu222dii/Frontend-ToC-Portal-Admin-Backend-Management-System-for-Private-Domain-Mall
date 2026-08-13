import { calculateOutboxBackoffMs, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma } from '../.generated/prisma/client';
import type { OutboxEventModel as OutboxEvent } from '../.generated/prisma/models/OutboxEvent';
import { withSessionAdvisoryLock } from './advisory-lock';
import type { DatabaseRuntime } from './runtime';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AppendOutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: ResourceOutboxPayloadV1;
}

export interface ResourceOutboxPayloadV1 {
  event_version: 1;
  resource_type: string;
  resource_id: string;
  resource_version: number;
}

export interface OutboxPollOptions {
  limit: number;
  eventTypes?: readonly string[];
}

export interface PublishOutboxOptions {
  maxRetries: number;
  initialDelayMs: number;
  maximumDelayMs?: number;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<void>;

const OUTBOX_AGGREGATE_TYPE = new Set([
  'account',
  'agent',
  'aftersale',
  'banner',
  'binding',
  'brand',
  'business_rule',
  'cart',
  'category',
  'commission_rule',
  'customer',
  'file',
  'integration_fixture',
  'inventory',
  'order',
  'payment',
  'product',
  'promotion',
  'refund',
  'session',
  'shipment',
  'sku',
  'withdrawal',
]);
const OUTBOX_PAYLOAD_FIELDS = new Set([
  'event_version',
  'resource_id',
  'resource_type',
  'resource_version',
]);
const OUTBOX_INPUT_FIELDS = new Set(['aggregateId', 'aggregateType', 'eventType', 'payload']);

function validateAppendInput(input: AppendOutboxEventInput): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).length !== OUTBOX_INPUT_FIELDS.size ||
    Object.keys(input).some((key) => !OUTBOX_INPUT_FIELDS.has(key))) {
    throw new TypeError('Outbox append input contains unsupported fields');
  }
  if (!OUTBOX_AGGREGATE_TYPE.has(input.aggregateType)) {
    throw new TypeError('Outbox aggregate type is not registered');
  }
  if (!isValidUlid(input.aggregateId)) throw new TypeError('Outbox aggregate ID must be a ULID');
  if (!/^[a-z][a-z0-9_.-]{2,119}$/.test(input.eventType)) {
    throw new TypeError('Outbox event type has an invalid format');
  }
  if (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload) ||
    Object.getPrototypeOf(input.payload) !== Object.prototype ||
    Object.keys(input.payload).length !== OUTBOX_PAYLOAD_FIELDS.size ||
    Object.keys(input.payload).some((key) => !OUTBOX_PAYLOAD_FIELDS.has(key)) ||
    input.payload.event_version !== 1 ||
    input.payload.resource_type !== input.aggregateType ||
    input.payload.resource_id !== input.aggregateId ||
    !Number.isSafeInteger(input.payload.resource_version) || input.payload.resource_version < 1) {
    throw new TypeError('Outbox payload must be a matching RESOURCE_EVENT_V1 reference');
  }
}

function validatePollOptions(options: OutboxPollOptions): void {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new TypeError('Outbox poll limit must be between 1 and 100');
  }
}

function validatePublishOptions(options: PublishOutboxOptions): void {
  if (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 1 || options.maxRetries > 20) {
    throw new TypeError('Outbox max retries must be between 1 and 20');
  }
  if (!Number.isSafeInteger(options.initialDelayMs) || options.initialDelayMs < 1 || options.initialDelayMs > 60_000) {
    throw new TypeError('Outbox initial retry delay must be between 1 and 60000 ms');
  }
  if (options.maximumDelayMs !== undefined && (
    !Number.isSafeInteger(options.maximumDelayMs) ||
    options.maximumDelayMs < options.initialDelayMs ||
    options.maximumDelayMs > 86_400_000
  )) {
    throw new TypeError('Outbox maximum retry delay must be between the initial delay and 86400000 ms');
  }
}

function errorCode(): string {
  return 'OUTBOX_HANDLER_FAILED';
}

export class OutboxRepository {
  constructor(
    private readonly runtime: DatabaseRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const currentTime = this.now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new TypeError('Outbox clock must return a valid Date');
    }
    return currentTime;
  }

  async append(transaction: DatabaseTransaction, input: AppendOutboxEventInput): Promise<OutboxEvent> {
    validateAppendInput(input);
    const createdAt = this.currentTime();
    return transaction.outboxEvent.create({
      data: {
        id: generateUlid(createdAt.getTime()),
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        event_type: input.eventType,
        payload: input.payload as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
        created_at: createdAt,
      },
    });
  }

  async findDue(options: OutboxPollOptions): Promise<OutboxEvent[]> {
    validatePollOptions(options);
    const now = this.currentTime();
    if (options.eventTypes?.length === 0) return [];
    return this.runtime.prisma.outboxEvent.findMany({
      where: {
        ...(options.eventTypes === undefined ? {} : { event_type: { in: [...options.eventTypes] } }),
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED', next_retry_at: { lte: now } },
        ],
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: options.limit,
    });
  }

  async publishOne(
    eventId: string,
    handler: OutboxHandler,
    options: PublishOutboxOptions,
  ): Promise<'busy' | 'published' | 'retry_scheduled' | 'terminal' | 'stale'> {
    validatePublishOptions(options);
    const locked = await withSessionAdvisoryLock(this.runtime.pool, 'outbox', eventId, async (client) => {
      const currentResult = await client.query<OutboxEvent>(
        `SELECT * FROM public.outbox_event WHERE id = $1`,
        [eventId],
      );
      const current = currentResult.rows[0];
      if (!current || current.status === 'PUBLISHED') return 'stale' as const;
      if (current.status === 'FAILED' && current.next_retry_at === null) return 'terminal' as const;
      if (current.next_retry_at && new Date(current.next_retry_at).getTime() > this.currentTime().getTime()) {
        return 'stale' as const;
      }

      // The handler may perform network I/O. The session advisory lock prevents a competing
      // worker from publishing this event while keeping all database transactions closed.
      try {
        await handler(current);
      } catch {
        const retryCount = current.retry_count + 1;
        const terminal = retryCount >= options.maxRetries;
        const backoffOptions = options.maximumDelayMs === undefined
          ? { initialDelayMs: options.initialDelayMs }
          : { initialDelayMs: options.initialDelayMs, maximumDelayMs: options.maximumDelayMs };
        const nextRetryAt = terminal ? null : new Date(this.currentTime().getTime() + calculateOutboxBackoffMs(
          current.retry_count,
          backoffOptions,
        ));
        await client.query(
          `UPDATE public.outbox_event
             SET status = 'FAILED', retry_count = $2, next_retry_at = $3, error_message = $4
           WHERE id = $1 AND status <> 'PUBLISHED'`,
          [eventId, retryCount, nextRetryAt, errorCode()],
        );
        return terminal ? 'terminal' as const : 'retry_scheduled' as const;
      }

      await client.query(
        `UPDATE public.outbox_event
           SET status = 'PUBLISHED', published_at = CURRENT_TIMESTAMP,
               next_retry_at = NULL, error_message = NULL
         WHERE id = $1 AND status <> 'PUBLISHED'`,
        [eventId],
      );
      return 'published' as const;
    });
    return locked.acquired ? locked.value : 'busy';
  }
}

export function createOutboxRepository(runtime: DatabaseRuntime): OutboxRepository {
  return new OutboxRepository(runtime);
}
