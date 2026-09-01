import { generateUlid } from '@qingxu/platform-core';

import { Prisma } from '../.generated/prisma/client';
import type { PaymentProvider } from '../.generated/prisma/enums';
import type { CallbackInboxModel as CallbackInbox } from '../.generated/prisma/models/CallbackInbox';
import { withBoundedSessionAdvisoryLock, withSessionAdvisoryLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';
import type { DatabaseRuntime } from './runtime';

interface ReceiveCallbackInputBase {
  eventType: string;
  providerEventId: string;
  rawBody: Uint8Array;
  payload?: Prisma.InputJsonValue;
  signatureValid: boolean;
}

export interface WechatCallbackSignatureHeaders {
  timestamp: string;
  nonce: string;
  serial: string;
  signature: string;
}

export interface MockCallbackSignatureHeaders {
  mock_signature: string;
  mock_timestamp: string;
}

export type ReceiveCallbackInput = ReceiveCallbackInputBase & (
  | { provider: 'WECHAT'; headers: WechatCallbackSignatureHeaders }
  | { provider: 'MOCK'; headers: MockCallbackSignatureHeaders }
);

const RECEIVE_CALLBACK_FIELDS = new Set([
  'eventType',
  'headers',
  'payload',
  'provider',
  'providerEventId',
  'rawBody',
  'signatureValid',
]);
const WECHAT_HEADER_FIELDS = new Set(['nonce', 'serial', 'signature', 'timestamp']);
const MOCK_HEADER_FIELDS = new Set(['mock_signature', 'mock_timestamp']);
const CALLBACK_TIMESTAMP = /^[0-9]{10,13}$/;
const SAFE_NONCE = /^[A-Za-z0-9._~-]{1,80}$/;
const SAFE_SERIAL = /^[A-Fa-f0-9]{16,128}$/;
const SAFE_SIGNATURE = /^[A-Za-z0-9._~:+/=-]{16,768}$/;
const SAFE_MOCK_SIGNATURE = /^[A-Za-z0-9._~:+/=-]{8,256}$/;
const RECONCILIATION_LOCK_TIMEOUT_MS = 15_000;

interface NormalizedCallbackHeaders {
  headers: Prisma.InputJsonObject;
  signatureTimestamp: string;
  signatureNonce: string | null;
  providerSerialNo: string | null;
}

function exactPlainRecord(value: unknown, fields: ReadonlySet<string>): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === fields.size &&
    Object.keys(value).every((key) => fields.has(key));
}

function normalizeCallbackHeaders(input: ReceiveCallbackInput): NormalizedCallbackHeaders {
  if (input.provider === 'WECHAT') {
    const headers = input.headers;
    if (!exactPlainRecord(headers, WECHAT_HEADER_FIELDS) ||
      typeof headers.timestamp !== 'string' || !CALLBACK_TIMESTAMP.test(headers.timestamp) ||
      typeof headers.nonce !== 'string' || !SAFE_NONCE.test(headers.nonce) ||
      typeof headers.serial !== 'string' || !SAFE_SERIAL.test(headers.serial) ||
      typeof headers.signature !== 'string' || !SAFE_SIGNATURE.test(headers.signature)) {
      throw new TypeError('WECHAT callback signature headers are invalid');
    }
    return {
      headers: {
        timestamp: headers.timestamp as string,
        nonce: headers.nonce as string,
        serial: headers.serial as string,
        signature: headers.signature as string,
      },
      signatureTimestamp: headers.timestamp as string,
      signatureNonce: headers.nonce as string,
      providerSerialNo: headers.serial as string,
    };
  }

  const headers = input.headers;
  if (!exactPlainRecord(headers, MOCK_HEADER_FIELDS) ||
    typeof headers.mock_signature !== 'string' || !SAFE_MOCK_SIGNATURE.test(headers.mock_signature) ||
    typeof headers.mock_timestamp !== 'string' || !CALLBACK_TIMESTAMP.test(headers.mock_timestamp)) {
    throw new TypeError('MOCK callback signature headers are invalid');
  }
  return {
    headers: {
      mock_signature: headers.mock_signature as string,
      mock_timestamp: headers.mock_timestamp as string,
    },
    signatureTimestamp: headers.mock_timestamp as string,
    signatureNonce: null,
    providerSerialNo: null,
  };
}

function callbackHeadersMatch(
  stored: Prisma.JsonValue,
  expected: Prisma.InputJsonObject,
): boolean {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return false;
  const expectedKeys = Object.keys(expected);
  const storedRecord = stored as Prisma.JsonObject;
  return Object.keys(storedRecord).length === expectedKeys.length &&
    expectedKeys.every((key) => storedRecord[key] === expected[key]);
}

function callbackFactsMatch(
  stored: CallbackInbox,
  input: ReceiveCallbackInput,
  signatureFacts: NormalizedCallbackHeaders,
): boolean {
  return stored.provider === input.provider &&
    stored.provider_event_id === input.providerEventId &&
    stored.event_type === input.eventType &&
    stored.signature_valid === true &&
    stored.signature_timestamp === signatureFacts.signatureTimestamp &&
    stored.signature_nonce === signatureFacts.signatureNonce &&
    stored.provider_serial_no === signatureFacts.providerSerialNo &&
    callbackHeadersMatch(stored.headers, signatureFacts.headers) &&
    Buffer.from(stored.raw_body).equals(Buffer.from(input.rawBody));
}

export type ReceiveCallbackResult =
  | { created: true; inbox: CallbackInbox }
  | { created: false; inbox: CallbackInbox };

export interface RequeueCallbackResult {
  created: boolean;
  inbox: CallbackInbox;
  requeued: boolean;
}

export type CallbackInboxHandler = (inbox: CallbackInbox) => Promise<void>;

export interface ProcessCallbackOptions {
  maxRetries: number;
  baseDelayMs: number;
  retryAfterExhaustion?: boolean;
}

export interface CallbackHandlerSelector {
  provider: PaymentProvider;
  eventType: string;
  retryAfterExhaustion?: boolean;
}

export interface FindDueCallbackOptions {
  limit: number;
  maxRetries: number;
  baseDelayMs: number;
  handlers: readonly CallbackHandlerSelector[];
}

export function calculateCallbackDueAt(
  receivedAt: Date,
  processedAt: Date | null,
  retryCount: number,
  baseDelayMs: number,
): Date {
  if (!Number.isSafeInteger(retryCount) || retryCount < 0) {
    throw new TypeError('Callback retry count must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 1) {
    throw new TypeError('Callback retry delay must be a positive safe integer');
  }
  if (retryCount === 0) return receivedAt;
  const anchor = processedAt ?? receivedAt;
  const delay = baseDelayMs * 2 ** Math.min(retryCount - 1, 52);
  return new Date(anchor.getTime() + Math.min(delay, 86_400_000));
}

function validateProcessingOptions(options: ProcessCallbackOptions): void {
  if (!Number.isSafeInteger(options.maxRetries) || options.maxRetries < 1 || options.maxRetries > 20) {
    throw new TypeError('Callback max retries must be between 1 and 20');
  }
  if (!Number.isSafeInteger(options.baseDelayMs) || options.baseDelayMs < 1 || options.baseDelayMs > 60_000) {
    throw new TypeError('Callback retry delay must be between 1 and 60000 ms');
  }
  if (options.retryAfterExhaustion !== undefined && typeof options.retryAfterExhaustion !== 'boolean') {
    throw new TypeError('Callback retry-after-exhaustion flag must be boolean');
  }
}

export class CallbackInboxRepository {
  constructor(
    private readonly runtime?: DatabaseRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const currentTime = this.now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new TypeError('Callback Inbox clock must return a valid Date');
    }
    return currentTime;
  }

  async receive(transaction: DatabaseTransaction, input: ReceiveCallbackInput): Promise<ReceiveCallbackResult> {
    if (typeof input !== 'object' || input === null || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some((key) => !RECEIVE_CALLBACK_FIELDS.has(key))) {
      throw new TypeError('Callback Inbox input contains unsupported fields');
    }
    if (input.signatureValid !== true) {
      throw new TypeError('Callback signature must be verified before Inbox persistence');
    }
    if ((input.provider !== 'MOCK' && input.provider !== 'WECHAT') ||
      !/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(input.eventType) ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(input.providerEventId) ||
      !(input.rawBody instanceof Uint8Array) || input.rawBody.byteLength === 0) {
      throw new TypeError('Callback Inbox facts are invalid');
    }
    const signatureFacts = normalizeCallbackHeaders(input);
    const receivedAt = this.currentTime();
    const created = await transaction.callbackInbox.createMany({
      data: [{
        id: generateUlid(receivedAt.getTime()),
        provider: input.provider,
        event_type: input.eventType,
        provider_event_id: input.providerEventId,
        raw_body: Buffer.from(input.rawBody),
        headers: signatureFacts.headers,
        payload: input.payload ?? Prisma.DbNull,
        signature_valid: true,
        signature_timestamp: signatureFacts.signatureTimestamp,
        signature_nonce: signatureFacts.signatureNonce,
        provider_serial_no: signatureFacts.providerSerialNo,
        verified_at: receivedAt,
        status: 'RECEIVED',
        error_message: null,
        received_at: receivedAt,
      }],
      skipDuplicates: true,
    });
    const inbox = await transaction.callbackInbox.findUniqueOrThrow({
      where: {
        provider_provider_event_id: {
          provider: input.provider,
          provider_event_id: input.providerEventId,
        },
      },
    });
    return { created: created.count === 1, inbox };
  }

  async receiveForReconciliation(
    input: ReceiveCallbackInput,
  ): Promise<RequeueCallbackResult> {
    if (!this.runtime) throw new Error('Callback reconciliation requires a DatabaseRuntime');
    const received = await this.runtime.withPrismaTransaction((transaction) => this.receive(transaction, input));
    const signatureFacts = normalizeCallbackHeaders(input);
    const locked = await withBoundedSessionAdvisoryLock(
      this.runtime.pool,
      'callback-inbox',
      received.inbox.id,
      RECONCILIATION_LOCK_TIMEOUT_MS,
      async (client) => {
        await client.query('BEGIN');
        try {
          const currentResult = await client.query<CallbackInbox>(
            'SELECT * FROM public.callback_inbox WHERE id = $1 FOR UPDATE',
            [received.inbox.id],
          );
          const current = currentResult.rows[0];
          if (!current || !callbackFactsMatch(current, input, signatureFacts)) {
            throw new Error('Callback reconciliation facts conflict with the authoritative Inbox');
          }
          if (current.status === 'RECEIVED') {
            await client.query('COMMIT');
            return { created: received.created, inbox: current, requeued: false };
          }
          if (current.status !== 'FAILED' && current.status !== 'PROCESSED') {
            throw new Error('Callback reconciliation could not be queued');
          }

          const requeued = await client.query<CallbackInbox>(
            `UPDATE public.callback_inbox
               SET error_message = NULL, processed_at = NULL, retry_count = 0,
                   status = 'RECEIVED'
             WHERE id = $1 AND signature_valid = TRUE AND status = $2
             RETURNING *`,
            [current.id, current.status],
          );
          const inbox = requeued.rows[0];
          if (requeued.rowCount !== 1 || !inbox || inbox.status !== 'RECEIVED') {
            throw new Error('Callback reconciliation could not be queued');
          }
          await client.query('COMMIT');
          return { created: received.created, inbox, requeued: true };
        } catch (error) {
          try {
            await client.query('ROLLBACK');
          } catch {
            throw new Error('Callback reconciliation transaction could not be rolled back', { cause: error });
          }
          throw error;
        }
      },
    );
    if (!locked.acquired) {
      throw new Error('Callback reconciliation lock timed out');
    }
    return locked.value;
  }

  async findDue(
    transaction: DatabaseTransaction,
    options: FindDueCallbackOptions,
  ): Promise<CallbackInbox[]> {
    validateProcessingOptions(options);
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new TypeError('Callback poll limit must be between 1 and 100');
    }
    if (options.handlers.length === 0) return [];
    const now = this.currentTime();
    const handlers = options.handlers.map(({ provider, eventType }) => Prisma.sql`
      (${provider}::public."PaymentProvider", ${eventType}::text)
    `);
    const durableHandlers = options.handlers
      .filter(({ retryAfterExhaustion }) => retryAfterExhaustion === true)
      .map(({ provider, eventType }) => Prisma.sql`
        (${provider}::public."PaymentProvider", ${eventType}::text)
      `);
    const retryBoundary = durableHandlers.length === 0
      ? Prisma.sql`retry_count < ${options.maxRetries}`
      : Prisma.sql`(
          retry_count < ${options.maxRetries}
          OR (provider, event_type) IN (${Prisma.join(durableHandlers)})
        )`;
    return transaction.$queryRaw<CallbackInbox[]>(Prisma.sql`
      SELECT *
      FROM public.callback_inbox
      WHERE signature_valid = TRUE
        AND status = 'RECEIVED'::public."CallbackStatus"
        AND ${retryBoundary}
        AND (provider, event_type) IN (${Prisma.join(handlers)})
        AND (
          retry_count = 0
          OR COALESCE(processed_at, received_at)
            + LEAST(
                ${options.baseDelayMs}::numeric * power(2::numeric, LEAST(retry_count - 1, 52)),
                86400000::numeric
              ) * INTERVAL '1 millisecond'
            <= ${now}
        )
      ORDER BY
        CASE WHEN retry_count = 0 THEN received_at ELSE COALESCE(processed_at, received_at) END ASC,
        received_at ASC,
        id ASC
      LIMIT ${options.limit}
    `);
  }

  async processOne(
    id: string,
    handler: CallbackInboxHandler,
    options: ProcessCallbackOptions,
  ): Promise<'busy' | 'processed' | 'retry_scheduled' | 'terminal' | 'stale'> {
    validateProcessingOptions(options);
    if (!this.runtime) throw new Error('Callback processing requires a DatabaseRuntime');
    const locked = await withSessionAdvisoryLock(this.runtime.coordinationPool, 'callback-inbox', id, async (client) => {
      const result = await client.query<CallbackInbox>(
        'SELECT * FROM public.callback_inbox WHERE id = $1',
        [id],
      );
      const current = result.rows[0];
      if (!current || current.status === 'PROCESSED') return 'stale' as const;
      if (!current.signature_valid || current.status === 'FAILED') return 'terminal' as const;
      const dueAt = calculateCallbackDueAt(
        new Date(current.received_at),
        current.processed_at === null ? null : new Date(current.processed_at),
        current.retry_count,
        options.baseDelayMs,
      );
      if (dueAt.getTime() > this.currentTime().getTime()) return 'stale' as const;

      try {
        await handler(current);
      } catch {
        const nextRetryCount = current.retry_count + 1;
        const terminal = nextRetryCount >= options.maxRetries && options.retryAfterExhaustion !== true;
        const storedRetryCount = options.retryAfterExhaustion === true
          ? Math.min(nextRetryCount, options.maxRetries)
          : nextRetryCount;
        const code = callbackErrorCode();
        await client.query(
          `UPDATE public.callback_inbox
             SET status = $2, retry_count = $3, processed_at = $4, error_message = $5
           WHERE id = $1 AND status <> 'PROCESSED'`,
          [id, terminal ? 'FAILED' : 'RECEIVED', storedRetryCount, this.currentTime(), code],
        );
        return terminal ? 'terminal' as const : 'retry_scheduled' as const;
      }

      await client.query(
        `UPDATE public.callback_inbox
           SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP, error_message = NULL
         WHERE id = $1 AND status <> 'PROCESSED'`,
        [id],
      );
      return 'processed' as const;
    });
    return locked.acquired ? locked.value : 'busy';
  }
}

function callbackErrorCode(): string {
  return 'CALLBACK_HANDLER_FAILED';
}
