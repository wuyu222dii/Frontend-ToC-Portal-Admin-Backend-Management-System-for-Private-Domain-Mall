import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CompletedOrderReplayResult,
  type CompleteFulfillmentOrderResult,
  type CompletionActorInput,
  type DatabaseRuntime,
  type DatabaseTransaction,
  FulfillmentRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';

const ROUTES = {
  admin: '/admin/orders/{order_id}/complete',
  customer: '/store/orders/{order_id}/confirm-receipt',
} as const;

export interface AdminOrderCompletionCommand {
  actorAccountId: string;
  expectedOrderVersion: number;
  idempotencyKey: string;
  ipAddress?: string;
  orderId: string;
  reason: string;
  requestId: string;
}

export interface CustomerOrderCompletionCommand {
  accountId: string;
  customerId: string;
  expectedOrderVersion: number;
  idempotencyKey: string;
  ipAddress?: string;
  orderId: string;
  requestId: string;
}

export type FulfillmentOrderCompletionResult =
  | CompleteFulfillmentOrderResult
  | CompletedOrderReplayResult;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

export class FulfillmentCompletionService {
  private readonly audit: AuditRepository;
  private readonly fulfillment: FulfillmentRepository;
  private readonly idempotency: IdempotencyRepository;
  private readonly outbox: OutboxRepository;

  constructor(
    config: PlatformRuntimeConfig,
    private readonly database: DatabaseRuntime,
  ) {
    this.audit = new AuditRepository(config.encryption.ipHashKey);
    this.fulfillment = new FulfillmentRepository(database.prisma, config.encryption.ipHashKey);
    this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
    this.outbox = new OutboxRepository(database);
  }

  completeAdmin(input: AdminOrderCompletionCommand): Promise<FulfillmentOrderCompletionResult> {
    return this.complete({
      actor: { actorAccountId: input.actorAccountId, kind: 'ADMIN' },
      auditAction: 'COMPLETE',
      auditRole: 'SUPER_ADMIN',
      completionReason: 'ADMIN_FORCED',
      expectedOrderVersion: input.expectedOrderVersion,
      idempotencyKey: input.idempotencyKey,
      ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
      orderId: input.orderId,
      reason: input.reason,
      requestId: input.requestId,
      route: ROUTES.admin,
    });
  }

  confirmCustomer(input: CustomerOrderCompletionCommand): Promise<FulfillmentOrderCompletionResult> {
    return this.complete({
      actor: { accountId: input.accountId, customerId: input.customerId, kind: 'CUSTOMER' },
      auditAction: 'CONFIRM',
      auditRole: 'CUSTOMER',
      completionReason: 'CUSTOMER_CONFIRMED',
      expectedOrderVersion: input.expectedOrderVersion,
      idempotencyKey: input.idempotencyKey,
      ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
      orderId: input.orderId,
      requestId: input.requestId,
      route: ROUTES.customer,
    });
  }

  private complete(input: {
    actor: CompletionActorInput;
    auditAction: 'COMPLETE' | 'CONFIRM';
    auditRole: 'CUSTOMER' | 'SUPER_ADMIN';
    completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED';
    expectedOrderVersion: number;
    idempotencyKey: string;
    ipAddress?: string;
    orderId: string;
    reason?: string;
    requestId: string;
    route: (typeof ROUTES)[keyof typeof ROUTES];
  }): Promise<FulfillmentOrderCompletionResult> {
    const claim = this.claim(input);
    return runSerializableTransaction(this.database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.resource_id !== input.orderId) {
          throw internal('Order completion replay resource is invalid');
        }
        const current = await this.fulfillment.getCompletedOrderForReplayInTransaction(transaction, {
          actor: input.actor,
          completionReason: input.completionReason,
          orderId: input.orderId,
        });
        this.idempotency.assertHashOnlyReplay(claimed.record, {
          resourceId: input.orderId,
          responseForHash: this.idempotencyResponse(input.orderId, input.completionReason),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return current;
      }

      const result = await this.fulfillment.completeOrderInTransaction(transaction, {
        actor: input.actor,
        completionReason: input.completionReason,
        expectedOrderVersion: input.expectedOrderVersion,
        orderId: input.orderId,
      });
      await this.appendAudit(transaction, input, result);
      await this.appendOutbox(transaction, result);
      await this.idempotency.complete(transaction, claim, {
        resourceId: input.orderId,
        responseForHash: this.idempotencyResponse(input.orderId, input.completionReason),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return result;
    });
  }

  private claim(input: {
    actor: CompletionActorInput;
    completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED';
    expectedOrderVersion: number;
    idempotencyKey: string;
    orderId: string;
    reason?: string;
    route: (typeof ROUTES)[keyof typeof ROUTES];
  }): IdempotencyClaim {
    const actorId = input.actor.kind === 'ADMIN' ? input.actor.actorAccountId : input.actor.accountId;
    return {
      actorId,
      idempotencyKey: input.idempotencyKey,
      request: {
        body: {
          completion_reason: input.completionReason,
          expected_version: input.expectedOrderVersion,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        method: 'POST',
        pathParameters: { order_id: input.orderId },
        route: input.route,
      },
    };
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    input: {
      actor: CompletionActorInput;
      auditAction: 'COMPLETE' | 'CONFIRM';
      auditRole: 'CUSTOMER' | 'SUPER_ADMIN';
      completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED';
      idempotencyKey: string;
      ipAddress?: string;
      orderId: string;
      reason?: string;
      requestId: string;
    },
    result: CompleteFulfillmentOrderResult,
  ) {
    const actorAccountId = input.actor.kind === 'ADMIN'
      ? input.actor.actorAccountId
      : input.actor.accountId;
    return this.audit.append(transaction, {
      action: input.auditAction,
      actorAccountId,
      actorRole: input.auditRole,
      after: { status: result.after.orderStatus, version: result.after.orderVersion },
      before: { status: result.before.orderStatus, version: result.before.orderVersion },
      idempotencyKey: input.idempotencyKey,
      ...(input.ipAddress === undefined ? {} : { ipAddress: input.ipAddress }),
      module: 'fulfillment',
      objectId: input.orderId,
      objectType: 'order',
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      requestId: input.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private async appendOutbox(
    transaction: DatabaseTransaction,
    result: CompleteFulfillmentOrderResult,
  ): Promise<void> {
    await this.outbox.append(transaction, {
      aggregateId: result.orderId,
      aggregateType: 'order',
      eventType: 'order.completed',
      payload: {
        event_version: 1,
        resource_id: result.orderId,
        resource_type: 'order',
        resource_version: result.after.orderVersion,
      },
    });
    for (const credit of [...result.commissionCredits].sort((left, right) =>
      left.ledgerId.localeCompare(right.ledgerId))) {
      await this.outbox.append(transaction, {
        aggregateId: credit.ledgerId,
        aggregateType: 'commission',
        eventType: 'commission.available.credited',
        payload: {
          event_version: 1,
          resource_id: credit.ledgerId,
          resource_type: 'commission',
          resource_version: 1,
        },
      });
    }
  }

  private idempotencyResponse(
    orderId: string,
    completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED',
  ) {
    return { order_completed: { completion_reason: completionReason, order_id: orderId } };
  }
}
