import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  runSerializableTransaction,
  type AuditRepository,
  type DatabaseRuntime,
  type OutboxRepository,
  type StorePaymentCallbackInput,
  type StorePaymentCallbackResult,
  type StorePaymentRepository,
} from '@qingxu/database';

import { DATABASE_RUNTIME } from './database-runtime.provider';
import type {
  CallbackHandlerRegistration,
  WorkerCallbackHandler,
} from './outbox-dispatcher.service';
import { OUTBOX_REPOSITORY } from './outbox-dispatcher.service';

const CALLBACK_FIELDS = [
  'amount',
  'occurred_at',
  'outcome',
  'provider_event_id',
  'provider_intent_id',
  'provider_transaction_id',
  'version',
] as const;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SAFE_MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const SAFE_MOCK_SIGNATURE = /^[A-Za-z0-9._~:+/=-]{8,256}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_CALLBACK_BYTES = 4_096;

export const MOCK_PAYMENT_CALLBACK_EVENT_TYPES = [
  'payment.succeeded',
  'payment.failed',
  'payment.cancelled',
] as const;

export type MockPaymentCallbackEventType = typeof MOCK_PAYMENT_CALLBACK_EVENT_TYPES[number];
export type MockPaymentCallbackOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export type PaymentCallbackRepositoryInput = StorePaymentCallbackInput;
export type WorkerPaymentCallbackRepository = Pick<StorePaymentRepository, 'applyPaymentCallbackInTransaction'>;

export const PAYMENT_CALLBACK_REPOSITORY = Symbol('PAYMENT_CALLBACK_REPOSITORY');
export const PAYMENT_CALLBACK_AUDIT_REPOSITORY = Symbol('PAYMENT_CALLBACK_AUDIT_REPOSITORY');

export type PaymentCallbackAuditRepository = Pick<AuditRepository, 'append'>;
export type PaymentCallbackOutboxRepository = Pick<OutboxRepository, 'append'>;

type CallbackInboxEvent = Parameters<WorkerCallbackHandler>[0];

interface DecodedMockPaymentPayload {
  amount: string;
  occurredAt: Date;
  occurredAtText: string;
  outcome: MockPaymentCallbackOutcome;
  providerEventId: string;
  providerIntentId: string;
  providerTransactionId: string | null;
}

function exactRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === CALLBACK_FIELDS.length &&
    Object.keys(value).every((key) => (CALLBACK_FIELDS as readonly string[]).includes(key));
}

function invalidCallback(): TypeError {
  return new TypeError('Mock payment callback is invalid');
}

function validReference(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REFERENCE.test(value);
}

function validMockHeaders(value: unknown, timestamp: string): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 2 &&
    Object.keys(value).every((key) => key === 'mock_signature' || key === 'mock_timestamp') &&
    typeof (value as Record<string, unknown>).mock_signature === 'string' &&
    SAFE_MOCK_SIGNATURE.test((value as Record<string, unknown>).mock_signature as string) &&
    (value as Record<string, unknown>).mock_timestamp === timestamp;
}

function decodePayload(value: unknown): DecodedMockPaymentPayload {
  if (!exactRecord(value) || value.version !== 1 ||
    !validReference(value.provider_event_id) || !validReference(value.provider_intent_id) ||
    (value.outcome !== 'SUCCEEDED' && value.outcome !== 'FAILED' && value.outcome !== 'CANCELLED') ||
    typeof value.amount !== 'string' || !SAFE_MONEY.test(value.amount) ||
    BigInt(value.amount.replace('.', '')) < 1n ||
    typeof value.occurred_at !== 'string' || !ISO_INSTANT.test(value.occurred_at)) {
    throw invalidCallback();
  }
  const occurredAt = new Date(value.occurred_at);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== value.occurred_at) {
    throw invalidCallback();
  }
  const providerTransactionId = value.provider_transaction_id;
  if (value.outcome === 'SUCCEEDED') {
    if (!validReference(providerTransactionId)) throw invalidCallback();
  } else if (providerTransactionId !== null) {
    throw invalidCallback();
  }
  return {
    amount: value.amount,
    occurredAt,
    occurredAtText: value.occurred_at,
    outcome: value.outcome,
    providerEventId: value.provider_event_id,
    providerIntentId: value.provider_intent_id,
    providerTransactionId,
  };
}

function samePayload(left: DecodedMockPaymentPayload, right: DecodedMockPaymentPayload): boolean {
  return left.amount === right.amount && left.occurredAtText === right.occurredAtText &&
    left.outcome === right.outcome && left.providerEventId === right.providerEventId &&
    left.providerIntentId === right.providerIntentId &&
    left.providerTransactionId === right.providerTransactionId;
}

function eventTypeFor(outcome: MockPaymentCallbackOutcome): MockPaymentCallbackEventType {
  if (outcome === 'SUCCEEDED') return 'payment.succeeded';
  if (outcome === 'FAILED') return 'payment.failed';
  return 'payment.cancelled';
}

function safeVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647;
}

function assertRepositoryResult(
  input: PaymentCallbackRepositoryInput,
  result: StorePaymentCallbackResult,
): void {
  if (result.outcome !== input.outcome || result.providerEventId !== input.providerEventId ||
    !safeVersion(result.before.intentVersion) || !safeVersion(result.after.intentVersion) ||
    !safeVersion(result.before.orderVersion) || !safeVersion(result.after.orderVersion) ||
    !Array.isArray(result.commissionLedgerIds) ||
    new Set(result.commissionLedgerIds).size !== result.commissionLedgerIds.length ||
    result.commissionLedgerIds.some((id) => typeof id !== 'string')) {
    throw new TypeError('Payment callback repository result is invalid');
  }
  if (result.changed === (result.kind === 'REPLAY') ||
    (input.outcome === 'SUCCEEDED' && result.kind !== 'SETTLED' && result.kind !== 'MANUAL_REQUIRED' &&
      result.kind !== 'REPLAY') ||
    (input.outcome !== 'SUCCEEDED' && result.kind !== 'ATTEMPT_RECORDED' &&
      result.kind !== 'TERMINAL' && result.kind !== 'REPLAY')) {
    throw new TypeError('Payment callback repository result is invalid');
  }
  if (result.changed && result.before.intentStatus === result.after.intentStatus &&
    result.kind !== 'ATTEMPT_RECORDED' && result.kind !== 'SETTLED') {
    throw new TypeError('Payment callback repository result is invalid');
  }
}

function resourcePayload(resourceType: string, resourceId: string, resourceVersion: number) {
  return {
    event_version: 1 as const,
    resource_id: resourceId,
    resource_type: resourceType,
    resource_version: resourceVersion,
  };
}

export function decodeMockPaymentCallback(event: CallbackInboxEvent): PaymentCallbackRepositoryInput {
  if (event.provider !== 'MOCK' || event.signature_valid !== true || event.status !== 'RECEIVED' ||
    !(event.raw_body instanceof Uint8Array) || event.raw_body.byteLength < 1 ||
    event.raw_body.byteLength > MAX_CALLBACK_BYTES) {
    throw invalidCallback();
  }
  let rawValue: unknown;
  try {
    const rawText = new TextDecoder('utf-8', { fatal: true }).decode(event.raw_body);
    rawValue = JSON.parse(rawText) as unknown;
  } catch {
    throw invalidCallback();
  }
  const signedPayload = decodePayload(rawValue);
  const storedPayload = decodePayload(event.payload);
  const expectedEventType = eventTypeFor(signedPayload.outcome);
  if (!samePayload(signedPayload, storedPayload) || event.event_type !== expectedEventType ||
    event.provider_event_id !== signedPayload.providerEventId ||
    event.signature_timestamp !== String(signedPayload.occurredAt.getTime()) ||
    !validMockHeaders(event.headers, event.signature_timestamp) ||
    event.signature_nonce !== null || event.provider_serial_no !== null) {
    throw invalidCallback();
  }
  return {
    amount: signedPayload.amount,
    eventType: expectedEventType,
    occurredAt: signedPayload.occurredAt,
    outcome: signedPayload.outcome,
    provider: 'MOCK',
    providerEventId: signedPayload.providerEventId,
    providerIntentId: signedPayload.providerIntentId,
    providerTransactionId: signedPayload.providerTransactionId,
  };
}

@Injectable()
export class PaymentCallbackService {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(PAYMENT_CALLBACK_REPOSITORY) private readonly payments: WorkerPaymentCallbackRepository,
    @Inject(PAYMENT_CALLBACK_AUDIT_REPOSITORY) private readonly audit: PaymentCallbackAuditRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: PaymentCallbackOutboxRepository,
  ) {}

  registrations(): readonly CallbackHandlerRegistration[] {
    return MOCK_PAYMENT_CALLBACK_EVENT_TYPES.map((eventType) => ({
      eventType,
      handle: (event: CallbackInboxEvent) => this.handle(event),
      provider: 'MOCK' as const,
    }));
  }

  async handle(event: CallbackInboxEvent): Promise<void> {
    const input = decodeMockPaymentCallback(event);
    await runSerializableTransaction(this.database.prisma, async (transaction) => {
      const result = await this.payments.applyPaymentCallbackInTransaction(transaction, input);
      assertRepositoryResult(input, result);
      if (!result.changed) return;
      const requestId = `req_${createHash('sha256').update(input.providerEventId).digest('hex').slice(0, 32)}`;
      if (result.before.intentStatus !== result.after.intentStatus) {
        await this.audit.append(transaction, {
          action: 'PAY',
          after: { status: result.after.intentStatus, version: result.after.intentVersion },
          before: { status: result.before.intentStatus, version: result.before.intentVersion },
          module: 'payment',
          objectId: result.paymentIntentId,
          objectType: 'payment',
          requestId,
          result: 'SUCCESS',
          resultCode: 'OK',
          summaryPolicy: 'STATUS_VERSION',
        });
        await this.outbox.append(transaction, {
          aggregateId: result.paymentIntentId,
          aggregateType: 'payment',
          eventType: input.eventType,
          payload: resourcePayload('payment', result.paymentIntentId, result.after.intentVersion),
        });
      }
      if (result.kind === 'SETTLED') {
        await this.audit.append(transaction, {
          action: 'PAY',
          after: { status: result.after.orderStatus, version: result.after.orderVersion },
          before: { status: result.before.orderStatus, version: result.before.orderVersion },
          module: 'payment',
          objectId: result.orderId,
          objectType: 'order',
          requestId,
          result: 'SUCCESS',
          resultCode: 'OK',
          summaryPolicy: 'STATUS_VERSION',
        });
        await this.outbox.append(transaction, {
          aggregateId: result.orderId,
          aggregateType: 'order',
          eventType: 'order.paid',
          payload: resourcePayload('order', result.orderId, result.after.orderVersion),
        });
        for (const commissionLedgerId of [...result.commissionLedgerIds].sort()) {
          await this.outbox.append(transaction, {
            aggregateId: commissionLedgerId,
            aggregateType: 'commission',
            eventType: 'commission.expected.created',
            payload: resourcePayload('commission', commissionLedgerId, 1),
          });
        }
      } else if (result.kind === 'MANUAL_REQUIRED') {
        await this.audit.append(transaction, {
          action: 'PAY',
          after: { status: result.after.orderStatus, version: result.after.orderVersion },
          before: { status: result.before.orderStatus, version: result.before.orderVersion },
          module: 'payment',
          objectId: result.orderId,
          objectType: 'order',
          requestId,
          result: 'SUCCESS',
          resultCode: 'OK',
          summaryPolicy: 'STATUS_VERSION',
        });
        await this.outbox.append(transaction, {
          aggregateId: result.orderId,
          aggregateType: 'order',
          eventType: 'order.payment_manual_required',
          payload: resourcePayload('order', result.orderId, result.after.orderVersion),
        });
      }
    });
  }
}
