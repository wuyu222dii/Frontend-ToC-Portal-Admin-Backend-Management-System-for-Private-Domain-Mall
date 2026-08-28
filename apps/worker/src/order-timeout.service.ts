import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type AuditRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type OutboxRepository,
  runSerializableTransaction,
  type StoreOrderCloseResult,
  type StoreOrderRepository,
} from '@qingxu/database';

import { DATABASE_RUNTIME } from './database-runtime.provider';
import { OUTBOX_REPOSITORY, WORKER_CONFIG } from './outbox-dispatcher.service';

export const ORDER_TIMEOUT_REPOSITORY = Symbol('ORDER_TIMEOUT_REPOSITORY');
export const ORDER_TIMEOUT_AUDIT_REPOSITORY = Symbol('ORDER_TIMEOUT_AUDIT_REPOSITORY');

export type OrderTimeoutRepository = Pick<StoreOrderRepository, 'expireNextOrderInTransaction'>;
export type OrderTimeoutAuditRepository = Pick<AuditRepository, 'append'>;
export type OrderTimeoutOutboxRepository = Pick<OutboxRepository, 'append'>;

@Injectable()
export class OrderTimeoutService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OrderTimeoutService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopping = false;

  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(WORKER_CONFIG) private readonly config: PlatformRuntimeConfig,
    @Inject(ORDER_TIMEOUT_REPOSITORY) private readonly orders: OrderTimeoutRepository,
    @Inject(ORDER_TIMEOUT_AUDIT_REPOSITORY) private readonly audit: OrderTimeoutAuditRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OrderTimeoutOutboxRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async pollOnce(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.expireBatch();
    } catch {
      this.logger.error({ code: 'ORDER_TIMEOUT_POLL_FAILED' });
    } finally {
      this.running = false;
    }
  }

  private async expireBatch(): Promise<void> {
    for (let processed = 0; processed < this.config.worker.batchSize; processed += 1) {
      const kind = await runSerializableTransaction(this.database.prisma, async (transaction) => {
        const result = await this.orders.expireNextOrderInTransaction(transaction);
        if (result.kind === 'closed') await this.appendCloseFacts(transaction, result.result);
        return result.kind;
      });
      if (kind === 'none') return;
    }
  }

  private async appendCloseFacts(
    transaction: DatabaseTransaction,
    result: StoreOrderCloseResult,
  ): Promise<void> {
    await this.audit.append(transaction, {
      action: 'CANCEL',
      after: { status: result.order.orderStatus, version: result.order.version },
      before: { status: result.before.orderStatus, version: result.before.version },
      module: 'order',
      objectId: result.order.orderId,
      objectType: 'order',
      requestId: `trace_${randomUUID().replaceAll('-', '')}`,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
    await this.outbox.append(transaction, {
      aggregateId: result.order.orderId,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: {
        event_version: 1,
        resource_id: result.order.orderId,
        resource_type: 'order',
        resource_version: result.order.version,
      },
    });
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => this.schedule(this.config.worker.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }
}
