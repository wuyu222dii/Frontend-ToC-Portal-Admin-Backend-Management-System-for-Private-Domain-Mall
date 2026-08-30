import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  CallbackInboxRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  type Prisma,
  runSerializableTransaction,
  StorePaymentRepository,
  StoreOrderRepository,
  type StoreOrderCloseClaimResult,
  type StoreOrderClosePaymentIntent,
  type StoreOrderCloseProviderInput,
  type StoreOrderCloseProviderOutcome,
  type StoreOrderSnapshot,
  type StorePaymentIntentSnapshot,
  type StorePaymentProviderFinalization,
} from '@qingxu/database';
import {
  createSignedMockPaymentSuccessCallback,
  type MockPaymentResultPort,
  type PaymentProviderIntentResult,
  type PaymentProviderPort,
  verifyMockPaymentCallback,
} from '@qingxu/payment';
import { ApplicationError } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { StoreMockPaymentResultRequest } from './store-payments.dto';

const PAYMENT_INTENT_ROUTE = '/store/orders/{order_id}/payment-intents';
const MOCK_PAYMENT_RESULT_ROUTE = '/store/mock-payments/{payment_intent_id}/result';
const RECONCILE_DELAY_MS = 60_000;

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

interface PreparedPaymentCommand {
  intent: StorePaymentIntentSnapshot;
  providerOperation: 'CREATE' | 'QUERY';
}

/**
 * Result of the three-phase order close workflow.  The Provider capability or
 * any other Provider payload is intentionally absent: a close request either
 * converges to a closed order or remains pending while the reservation stays
 * locked.
 */
export interface StoreOrderCancellationResult {
  kind: 'CLOSED' | 'PAYMENT_CONFIRMED' | 'PENDING';
  order: StoreOrderSnapshot;
  paymentIntent: StoreOrderClosePaymentIntent | null;
  statusCode: 200 | 202;
}

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

function providerUnavailable(): ApplicationError {
  return new ApplicationError('PAYMENT_PROVIDER_UNAVAILABLE', 'Payment Provider is unavailable');
}

function configurationUnavailable(): ApplicationError {
  return new ApplicationError('PAYMENT_CONFIGURATION_UNAVAILABLE', 'Payment configuration is unavailable');
}

function resultConflict(): ApplicationError {
  return new ApplicationError('PAYMENT_RESULT_CONFLICT', 'Mock payment result conflicts with current state');
}

function safeProviderErrorCode(result: PaymentProviderIntentResult): string {
  return result.failureCode ?? (result.outcome === 'NOT_FOUND' ? 'PROVIDER_NOT_FOUND' : 'PROVIDER_UNKNOWN');
}

@Injectable()
export class StorePaymentsService {
  private readonly orders!: StoreOrderRepository;
  private readonly payments!: StorePaymentRepository;
  private readonly audit!: AuditRepository;
  private readonly callbackInbox!: CallbackInboxRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider?: PaymentProviderPort,
  ) {
    if (config && database) {
      this.orders = new StoreOrderRepository(database.prisma);
      this.payments = new StorePaymentRepository();
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.callbackInbox = new CallbackInboxRepository(database);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
    }
  }

  /**
   * Request a customer cancellation using the same claim -> Provider
   * query/close -> finalize protocol as the timeout worker.  No Provider call
   * is made while a database transaction is open.
   */
  async requestOrderCancellation(
    session: CurrentStoreSession,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ): Promise<StoreOrderCancellationResult> {
    const claim = this.orderCloseClaim(session.accountId, orderId, expectedVersion, idempotencyKey);
    const prepared = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId !== orderId) throw internal('Order cancellation replay resource is invalid');
        const order = await this.orderRepository().getOwnedOrderForReplayInTransaction(transaction, {
          accountId: session.accountId,
          customerId: session.customerId,
          orderId,
        });
        const responseStatus = claimed.record.response_status === 202 ? 202 : 200;
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: orderId,
          responseForHash: this.orderCloseIdempotencyResponse(orderId),
          responseStatus,
          storage: 'HASH_ONLY',
        });
        return {
          kind: responseStatus === 202 ? 'PENDING' as const : 'CLOSED' as const,
          order,
          paymentIntent: null,
          statusCode: responseStatus as 200 | 202,
        };
      }

      const result = await this.orderRepository().claimOrderCloseInTransaction(transaction, {
        accountId: session.accountId,
        customerId: session.customerId,
        expectedVersion,
        mode: 'USER_CANCELLED',
        orderId,
      });
      if (result.kind === 'CLOSED') {
        if (result.changed) {
          await this.appendOrderCloseAudit(
            transaction,
            session,
            result,
            idempotencyKey,
            requestId,
            ipAddress,
          );
          await this.appendOrderCloseOutbox(transaction, result.order);
        }
        await this.idempotencyRepository().complete(transaction, claim, {
          resourceId: orderId,
          responseForHash: this.orderCloseIdempotencyResponse(orderId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return {
          kind: 'CLOSED' as const,
          order: result.order,
          paymentIntent: null,
          statusCode: 200 as const,
        };
      }
      if (result.kind === 'SKIPPED') {
        throw new ApplicationError('ORDER_NOT_CANCELLABLE', 'Order cannot be cancelled');
      }
      return { kind: 'EXECUTE' as const, claimResult: result };
    });

    if (prepared.kind !== 'EXECUTE') return prepared;
    const providerInput = await this.closeProviderInput(prepared.claimResult);
    const finalized = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const reclaimed = await this.idempotencyRepository().claim(transaction, claim);
      if (reclaimed.kind === 'replay') {
        const resourceId = reclaimed.record.resource_id;
        if (resourceId !== orderId) throw internal('Order cancellation replay resource is invalid');
        const order = await this.orderRepository().getOwnedOrderForReplayInTransaction(transaction, {
          accountId: session.accountId,
          customerId: session.customerId,
          orderId,
        });
        const responseStatus = reclaimed.record.response_status === 202 ? 202 : 200;
        this.idempotencyRepository().assertHashOnlyReplay(reclaimed.record, {
          resourceId: orderId,
          responseForHash: this.orderCloseIdempotencyResponse(orderId),
          responseStatus,
          storage: 'HASH_ONLY',
        });
        if (providerInput.outcome === 'SUCCEEDED' && prepared.claimResult.paymentIntent !== null) {
          await this.persistRecoveredMockSuccess(
            transaction,
            prepared.claimResult.paymentIntent,
            providerInput,
          );
        }
        return {
          kind: responseStatus === 202 ? 'PENDING' as const : 'CLOSED' as const,
          order,
          paymentIntent: null,
          statusCode: responseStatus as 200 | 202,
        };
      }

      const result = await this.orderRepository().finalizeOrderCloseInTransaction(transaction, providerInput);
      if (result.kind === 'PAYMENT_CONFIRMED') {
        await this.persistRecoveredMockSuccess(transaction, result.paymentIntent, providerInput);
      }
      if (result.kind === 'CLOSED' && result.closeResult?.changed) {
        await this.appendOrderCloseAudit(
          transaction,
          session,
          result.closeResult,
          idempotencyKey,
          requestId,
          ipAddress,
        );
        await this.appendOrderCloseOutbox(transaction, result.order);
      }
      const statusCode: 200 | 202 = result.kind === 'CLOSED' ? 200 : 202;
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: orderId,
        responseForHash: this.orderCloseIdempotencyResponse(orderId),
        responseStatus: statusCode,
        storage: 'HASH_ONLY',
      });
      return { ...result, statusCode };
    });
    return {
      kind: finalized.kind,
      order: finalized.order,
      paymentIntent: finalized.paymentIntent,
      statusCode: finalized.statusCode,
    };
  }

  async createOrReuseIntent(
    session: CurrentStoreSession,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.paymentIntentClaim(session.accountId, orderId, expectedVersion, idempotencyKey);
    const prepared = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const paymentIntentId = claimed.record.resource_id;
        if (paymentIntentId === null) throw internal('Payment idempotency record has no resource');
        const intent = await this.repository().getOwnedPaymentIntentInTransaction(transaction, {
          customerId: session.customerId,
          paymentIntentId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: paymentIntentId,
          responseForHash: this.paymentIntentIdempotencyResponse(paymentIntentId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return { kind: 'replay' as const, intent };
      }

      const result = await this.repository().prepareOwnedPaymentIntentInTransaction(transaction, {
        accountId: session.accountId,
        customerId: session.customerId,
        expectedVersion,
        orderId,
        provider: this.providerName(),
        reconcileAfterMs: RECONCILE_DELAY_MS,
      });
      if (result.created) {
        await this.appendAudit(
          transaction,
          session,
          undefined,
          result.intent,
          'CREATE',
          idempotencyKey,
          requestId,
          ipAddress,
        );
        await this.appendOutbox(transaction, result.intent, 'payment.intent.created');
      }
      return {
        kind: 'execute' as const,
        intent: result.intent,
        providerOperation: result.providerOperation,
      };
    });
    if (prepared.kind === 'replay') return this.intentView(prepared.intent);

    const providerResult = await this.callProvider(prepared, session);
    if (providerResult.outcome === 'SUCCEEDED' || providerResult.outcome === 'UNKNOWN' ||
      providerResult.outcome === 'NOT_FOUND' ||
      (providerResult.outcome === 'OPEN' && providerResult.providerIntentId === null)) {
      await this.recordUncertainProviderResult(prepared.intent, providerResult);
      throw providerUnavailable();
    }

    const finalization = this.providerFinalization(prepared.intent, providerResult);
    const finalized = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const paymentIntentId = claimed.record.resource_id;
        if (paymentIntentId === null) throw internal('Payment idempotency record has no resource');
        const intent = await this.repository().getOwnedPaymentIntentInTransaction(transaction, {
          customerId: session.customerId,
          paymentIntentId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: paymentIntentId,
          responseForHash: this.paymentIntentIdempotencyResponse(paymentIntentId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return intent;
      }

      const finalized = await this.repository().finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: prepared.intent.version,
        orderId: prepared.intent.orderId,
        paymentIntentId: prepared.intent.paymentIntentId,
        provider: prepared.intent.provider,
        result: finalization,
      });
      const intent = finalized.intent;
      if (finalized.changed) {
        await this.appendAudit(
          transaction,
          session,
          prepared.intent,
          intent,
          'PAY',
          idempotencyKey,
          requestId,
          ipAddress,
        );
        await this.appendOutbox(transaction, intent, 'payment.intent.updated');
      }
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: intent.paymentIntentId,
        responseForHash: this.paymentIntentIdempotencyResponse(intent.paymentIntentId),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return intent;
    });
    return this.intentView(finalized, providerResult.capability);
  }

  async submitMockResult(
    session: CurrentStoreSession,
    paymentIntentId: string,
    input: StoreMockPaymentResultRequest,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    void requestId;
    void ipAddress;
    this.assertMockResultEnabled();
    const claim = this.mockResultClaim(session.accountId, paymentIntentId, input, idempotencyKey);
    const prepared = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Mock payment idempotency record has no resource');
        const intent = await this.repository().getOwnedPaymentIntentInTransaction(transaction, {
          customerId: session.customerId,
          paymentIntentId: resourceId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId,
          responseForHash: this.mockResultIdempotencyResponse(resourceId, input.result),
          responseStatus: 202,
          storage: 'HASH_ONLY',
        });
        return { kind: 'replay' as const, intent };
      }
      const intent = await this.repository().getOwnedPaymentIntentInTransaction(transaction, {
        customerId: session.customerId,
        paymentIntentId,
      });
      if (intent.provider !== 'MOCK') throw new ApplicationError('RESOURCE_NOT_FOUND', 'Payment intent not found');
      return { kind: 'execute' as const, intent };
    });
    if (prepared.kind === 'replay') return this.intentView(prepared.intent);

    const mockProvider = this.mockResultProvider();
    let submission: Awaited<ReturnType<MockPaymentResultPort['submitResult']>>;
    try {
      submission = await mockProvider.submitResult({
        intentNo: prepared.intent.intentNo,
        providerIntentId: prepared.intent.providerIntentId,
        result: input.result,
      });
    } catch {
      throw providerUnavailable();
    }
    if (submission.submission === 'CONFLICT') throw resultConflict();
    if (submission.submission !== 'ACCEPTED' || submission.callback === null) throw providerUnavailable();
    const signingKey = this.runtimeConfig().payment.mockSigningKey;
    if (signingKey === undefined || !verifyMockPaymentCallback(submission.callback, signingKey)) {
      throw providerUnavailable();
    }

    const result = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Mock payment idempotency record has no resource');
        const intent = await this.repository().getOwnedPaymentIntentInTransaction(transaction, {
          customerId: session.customerId,
          paymentIntentId: resourceId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId,
          responseForHash: this.mockResultIdempotencyResponse(resourceId, input.result),
          responseStatus: 202,
          storage: 'HASH_ONLY',
        });
        return intent;
      }
      const intent = await this.repository().getOwnedPaymentIntentInTransaction(transaction, {
        customerId: session.customerId,
        paymentIntentId,
      });
      if (intent.provider !== 'MOCK') throw new ApplicationError('RESOURCE_NOT_FOUND', 'Payment intent not found');
      await this.inboxRepository().receive(transaction, {
        eventType: submission.callback.eventType,
        headers: submission.callback.headers,
        payload: submission.callback.payload as unknown as Prisma.InputJsonValue,
        provider: 'MOCK',
        providerEventId: submission.callback.providerEventId,
        rawBody: submission.callback.rawBody,
        signatureValid: true,
      });
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: intent.paymentIntentId,
        responseForHash: this.mockResultIdempotencyResponse(intent.paymentIntentId, input.result),
        responseStatus: 202,
        storage: 'HASH_ONLY',
      });
      return intent;
    });
    return this.intentView(result);
  }

  private async callProvider(
    prepared: PreparedPaymentCommand,
    session: CurrentStoreSession,
  ): Promise<PaymentProviderIntentResult> {
    const provider = this.paymentProvider();
    try {
      let result = prepared.providerOperation === 'CREATE'
        ? await provider.create({
            amount: prepared.intent.amount,
            expiresAt: prepared.intent.expiresAt,
            intentNo: prepared.intent.intentNo,
          })
        : await provider.query({
            intentNo: prepared.intent.intentNo,
            providerIntentId: prepared.intent.providerIntentId,
          });
      if (prepared.providerOperation === 'QUERY' && result.outcome === 'NOT_FOUND') {
        await runSerializableTransaction(this.runtime().prisma, async (transaction) =>
          this.repository().revalidateProviderCreateInTransaction(transaction, {
            accountId: session.accountId,
            customerId: session.customerId,
            expectedIntentVersion: prepared.intent.version,
            orderId: prepared.intent.orderId,
            paymentIntentId: prepared.intent.paymentIntentId,
            provider: prepared.intent.provider,
          }));
        result = await provider.create({
          amount: prepared.intent.amount,
          expiresAt: prepared.intent.expiresAt,
          intentNo: prepared.intent.intentNo,
        });
      }
      return result;
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      return {
        capability: null,
        failureCode: 'PROVIDER_UNAVAILABLE',
        occurredAt: null,
        outcome: 'UNKNOWN',
        providerEventId: null,
        providerIntentId: null,
        providerTransactionId: null,
      };
    }
  }

  private async recordUncertainProviderResult(
    intent: StorePaymentIntentSnapshot,
    result: PaymentProviderIntentResult,
  ): Promise<void> {
    const nextReconcileAt = this.nextReconcileAt(intent);
    await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      await this.repository().finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: intent.version,
        orderId: intent.orderId,
        paymentIntentId: intent.paymentIntentId,
        provider: intent.provider,
        result: {
          errorCode: result.outcome === 'SUCCEEDED' ? 'PAYMENT_RESULT_PENDING' : safeProviderErrorCode(result),
          kind: 'UNKNOWN',
          nextReconcileAt,
          providerState: result.outcome,
        },
      });
    });
  }

  /** Execute the external close/query operation using only stable intent facts. */
  private async closeProviderInput(
    claim: StoreOrderCloseClaimResult,
  ): Promise<StoreOrderCloseProviderInput> {
    const intent = claim.paymentIntent;
    if (intent === null || claim.providerOperation === null) {
      throw internal('Order close Provider facts are unavailable');
    }
    let providerResult: PaymentProviderIntentResult;
    try {
      const locate = {
        intentNo: intent.intentNo,
        providerIntentId: intent.providerIntentId,
      };
      providerResult = claim.providerOperation === 'QUERY'
        ? await this.paymentProvider().query(locate)
        : await this.paymentProvider().close(locate);

      // A CREATING intent has no Provider ID yet.  If query finds an OPEN
      // external intent, close it in the same provider phase; terminal and
      // NOT_FOUND results can be finalized directly.
      if (claim.providerOperation === 'QUERY' && providerResult.outcome === 'OPEN' &&
        providerResult.providerIntentId !== null) {
        providerResult = await this.paymentProvider().close({
          intentNo: intent.intentNo,
          providerIntentId: providerResult.providerIntentId,
        });
      }
    } catch {
      providerResult = {
        capability: null,
        failureCode: 'PROVIDER_UNAVAILABLE',
        occurredAt: null,
        outcome: 'UNKNOWN',
        providerEventId: null,
        providerIntentId: intent.providerIntentId,
        providerTransactionId: null,
      };
    }

    return {
      errorCode: providerResult.failureCode,
      expectedIntentVersion: intent.version,
      occurredAt: providerResult.occurredAt,
      outcome: this.normalizeCloseOutcome(providerResult.outcome),
      orderId: claim.order.orderId,
      paymentIntentId: intent.paymentIntentId,
      providerEventId: providerResult.providerEventId,
      providerIntentId: providerResult.providerIntentId,
      providerState: providerResult.outcome,
      providerTransactionId: providerResult.providerTransactionId,
    };
  }

  private normalizeCloseOutcome(
    outcome: PaymentProviderIntentResult['outcome'],
  ): StoreOrderCloseProviderOutcome {
    // Provider's CLOSED/FAILED/CANCELLED/EXPIRED/NOT_FOUND/OPEN/SUCCEEDED/
    // UNKNOWN union is intentionally mirrored by the repository contract.
    switch (outcome) {
      case 'CANCELLED':
      case 'CLOSED':
      case 'FAILED':
      case 'NOT_FOUND':
      case 'OPEN':
      case 'SUCCEEDED':
      case 'UNKNOWN':
        return outcome;
      default:
        throw internal('Provider close outcome is unsupported');
    }
  }

  private async persistRecoveredMockSuccess(
    transaction: DatabaseTransaction,
    intent: StoreOrderClosePaymentIntent,
    providerInput: StoreOrderCloseProviderInput,
  ): Promise<void> {
    const signingKey = this.runtimeConfig().payment.mockSigningKey;
    if (intent.provider !== 'MOCK' || this.runtimeConfig().payment.provider !== 'MOCK' || signingKey === undefined) {
      throw internal('Recovered payment success cannot be verified');
    }
    const callback = createSignedMockPaymentSuccessCallback(signingKey, intent.amount, {
      capability: null,
      failureCode: null,
      occurredAt: providerInput.occurredAt ?? null,
      outcome: 'SUCCEEDED',
      providerEventId: providerInput.providerEventId ?? null,
      providerIntentId: providerInput.providerIntentId ?? null,
      providerTransactionId: providerInput.providerTransactionId ?? null,
    });
    if (!verifyMockPaymentCallback(callback, signingKey)) {
      throw internal('Recovered payment success signature is invalid');
    }
    await this.inboxRepository().receive(transaction, {
      eventType: callback.eventType,
      headers: callback.headers,
      payload: callback.payload as unknown as Prisma.InputJsonValue,
      provider: 'MOCK',
      providerEventId: callback.providerEventId,
      rawBody: callback.rawBody,
      signatureValid: true,
    });
  }

  private orderCloseClaim(
    actorId: string,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: { expected_version: expectedVersion },
        method: 'POST',
        pathParameters: { order_id: orderId },
        route: '/store/orders/{order_id}/cancel',
      },
    };
  }

  private orderCloseIdempotencyResponse(orderId: string) {
    return { order_closed: { order_id: orderId } };
  }

  private async appendOrderCloseAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    result: { before: StoreOrderSnapshot; order: StoreOrderSnapshot },
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ): Promise<void> {
    await this.auditRepository().append(transaction, {
      action: 'CANCEL',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { status: result.order.orderStatus, version: result.order.version },
      before: { status: result.before.orderStatus, version: result.before.version },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'order',
      objectId: result.order.orderId,
      objectType: 'order',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOrderCloseOutbox(
    transaction: DatabaseTransaction,
    order: StoreOrderSnapshot,
  ) {
    return this.outboxRepository().append(transaction, {
      aggregateId: order.orderId,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: {
        event_version: 1,
        resource_id: order.orderId,
        resource_type: 'order',
        resource_version: order.version,
      },
    });
  }

  private providerFinalization(
    intent: StorePaymentIntentSnapshot,
    result: PaymentProviderIntentResult,
  ): StorePaymentProviderFinalization {
    if (result.outcome === 'OPEN') {
      if (result.providerIntentId === null) {
        return {
          errorCode: 'INVALID_PROVIDER_STATE',
          kind: 'UNKNOWN',
          nextReconcileAt: this.nextReconcileAt(intent),
          providerState: 'OPEN',
        };
      }
      return {
        kind: 'OPEN',
        nextReconcileAt: this.nextReconcileAt(intent),
        providerIntentId: result.providerIntentId,
        providerState: 'OPEN',
      };
    }
    if (result.outcome !== 'FAILED' && result.outcome !== 'CANCELLED' && result.outcome !== 'CLOSED') {
      throw internal('Provider outcome cannot be finalized in B10.1');
    }
    return {
      errorCode: result.outcome === 'FAILED' ? result.failureCode ?? 'PAYMENT_FAILED' : null,
      kind: 'TERMINAL',
      providerIntentId: result.providerIntentId,
      providerState: result.outcome,
      status: result.outcome,
    };
  }

  private nextReconcileAt(intent: StorePaymentIntentSnapshot): Date {
    return new Date(intent.serverTime.getTime() + RECONCILE_DELAY_MS);
  }

  private paymentIntentClaim(
    actorId: string,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: { expected_version: expectedVersion },
        method: 'POST',
        pathParameters: { order_id: orderId },
        route: PAYMENT_INTENT_ROUTE,
      },
    };
  }

  private mockResultClaim(
    actorId: string,
    paymentIntentId: string,
    input: StoreMockPaymentResultRequest,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: { result: input.result },
        method: 'POST',
        pathParameters: { payment_intent_id: paymentIntentId },
        route: MOCK_PAYMENT_RESULT_ROUTE,
      },
    };
  }

  private paymentIntentIdempotencyResponse(paymentIntentId: string) {
    return { payment_intent_command_completed: { payment_intent_id: paymentIntentId } };
  }

  private mockResultIdempotencyResponse(paymentIntentId: string, result: StoreMockPaymentResultRequest['result']) {
    return { mock_payment_result_received: { payment_intent_id: paymentIntentId, result } };
  }

  private intentView(intent: StorePaymentIntentSnapshot, capability: PaymentProviderIntentResult['capability'] = null) {
    return {
      expires_at: intent.expiresAt.toISOString(),
      intent_no: intent.intentNo,
      intent_status: intent.status,
      last_error_code: intent.lastErrorCode,
      next_reconcile_at: intent.nextReconcileAt?.toISOString() ?? null,
      payment_intent_id: intent.paymentIntentId,
      provider_payload: capability === null ? null : {
        app_id: capability.appId,
        expires_at: capability.expiresAt.toISOString(),
        nonce_str: capability.nonceStr,
        package: capability.package,
        pay_sign: capability.paySign,
        sign_type: capability.signType,
        time_stamp: capability.timeStamp,
      },
    };
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    before: StorePaymentIntentSnapshot | undefined,
    after: StorePaymentIntentSnapshot,
    action: 'CREATE' | 'PAY',
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.auditRepository().append(transaction, {
      action,
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { status: after.status, version: after.version },
      ...(before === undefined ? {} : { before: { status: before.status, version: before.version } }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'payment',
      objectId: after.paymentIntentId,
      objectType: 'payment',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOutbox(
    transaction: DatabaseTransaction,
    intent: StorePaymentIntentSnapshot,
    eventType: 'payment.intent.created' | 'payment.intent.updated',
  ) {
    return this.outboxRepository().append(transaction, {
      aggregateId: intent.paymentIntentId,
      aggregateType: 'payment',
      eventType,
      payload: {
        event_version: 1,
        resource_id: intent.paymentIntentId,
        resource_type: 'payment',
        resource_version: intent.version,
      },
    });
  }

  private assertMockResultEnabled(): void {
    if (this.runtimeConfig().environment !== 'development' || this.providerName() !== 'MOCK') {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Resource not found');
    }
  }

  private mockResultProvider(): PaymentProviderPort & MockPaymentResultPort {
    const provider = this.paymentProvider() as PaymentProviderPort & Partial<MockPaymentResultPort>;
    if (typeof provider.submitResult !== 'function') throw configurationUnavailable();
    return provider as PaymentProviderPort & MockPaymentResultPort;
  }

  private providerName(): 'MOCK' | 'WECHAT' {
    const provider = this.runtimeConfig().payment.provider;
    if (provider === 'WECHAT') throw configurationUnavailable();
    return provider;
  }

  private runtime(): DatabaseRuntime {
    if (!this.database) throw internal('Store payment database runtime is unavailable');
    return this.database;
  }

  private runtimeConfig(): PlatformRuntimeConfig {
    if (!this.config) throw internal('Store payment runtime configuration is unavailable');
    return this.config;
  }

  private paymentProvider(): PaymentProviderPort {
    if (!this.provider) throw internal('Payment Provider runtime is unavailable');
    return this.provider;
  }

  private repository(): StorePaymentRepository {
    if (!this.payments) throw internal('Store payment repository is unavailable');
    return this.payments;
  }

  private orderRepository(): StoreOrderRepository {
    if (!this.orders) throw internal('Store order close repository is unavailable');
    return this.orders;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw internal('Audit repository is unavailable');
    return this.audit;
  }

  private inboxRepository(): CallbackInboxRepository {
    if (!this.callbackInbox) throw internal('Callback Inbox repository is unavailable');
    return this.callbackInbox;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw internal('Idempotency repository is unavailable');
    return this.idempotency;
  }

  private outboxRepository(): OutboxRepository {
    if (!this.outbox) throw internal('Outbox repository is unavailable');
    return this.outbox;
  }
}
