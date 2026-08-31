import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  type AppendFulfillmentLogisticsEventInput,
  type CreateFulfillmentShipmentInput,
  FulfillmentRepository,
} from './fulfillment.repository';

const NOW = new Date('2026-08-31T10:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const actorId = id(-20_000);
const orderId = id(-19_000);
const shipmentId = id(-18_000);
const orderItemIds = [id(-17_000), id(-16_000)] as const;
const shipmentItemIds = [id(-15_000), id(-14_000)] as const;
const eventId = id(-13_000);
const skuIds = [id(-12_000), id(-11_000)] as const;
const aftersaleId = id(-10_000);

function queryText(query: unknown): string {
  const strings = (query as { strings?: readonly string[] }).strings;
  return strings?.join(' ') ?? String(query);
}

function commandOrder(overrides: Record<string, unknown> = {}) {
  return {
    fulfillment_status: 'READY_TO_SHIP',
    id: orderId,
    order_status: 'PENDING_SHIPMENT',
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    version: 7,
    ...overrides,
  };
}

function lockedItems(overrides: Array<Record<string, unknown>> = []) {
  return orderItemIds.map((itemId, index) => ({
    id: itemId,
    pre_shipment_refunded_qty: 0,
    quantity: index + 2,
    shipped_qty: 0,
    version: 3,
    ...overrides[index],
  }));
}

function logisticsEvent(
  overrides: Record<string, unknown> = {},
) {
  return {
    actor_account_id: actorId,
    carrier_code: null,
    carrier_name: null,
    created_at: NOW,
    description: 'Parcel entered transit',
    event_key: 'fulfillment-event-key-1',
    event_type: 'STATUS',
    id: eventId,
    location: 'Sorting centre',
    occurred_at: new Date(NOW.getTime() + 2_000),
    reason: null,
    shipment_id: shipmentId,
    source: 'MANUAL',
    status_code: 'IN_TRANSIT',
    tracking_no: null,
    ...overrides,
  };
}

function shipmentRecord(overrides: Record<string, unknown> = {}) {
  return {
    carrier_code: 'DEV',
    carrier_name: 'Development Carrier',
    created_at: NOW,
    delivered_at: null,
    events: [],
    id: shipmentId,
    items: orderItemIds.map((itemId, index) => ({
      created_at: NOW,
      id: shipmentItemIds[index],
      order_item: {
        id: itemId,
        order_id: orderId,
        product_name_snapshot: `Product ${index + 1}`,
        sku_id: skuIds[index],
        sku_name_snapshot: `SKU ${index + 1}`,
      },
      order_item_id: itemId,
      quantity: index + 2,
      shipment_id: shipmentId,
    })),
    order_id: orderId,
    shipped_at: NOW,
    status: 'SHIPPED',
    tracking_no: 'TRACK-001',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

interface TransactionOptions {
  actor?: { deleted_at: Date | null; has_password: boolean; id: string; role: string; status: string } | null;
  aftersales?: Array<{ id: string; status: string }>;
  existingShipmentId?: string | null;
  items?: ReturnType<typeof lockedItems>;
  order?: ReturnType<typeof commandOrder>;
  shipment?: ReturnType<typeof shipmentRecord>;
}

function transaction(options: TransactionOptions = {}) {
  const actor = options.actor === undefined
    ? { deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' }
    : options.actor;
  const order = options.order ?? commandOrder();
  const items = options.items ?? lockedItems();
  const aftersales = options.aftersales ?? [];
  const existingShipmentId = options.existingShipmentId ?? null;
  const currentShipment = options.shipment ?? shipmentRecord();
  const tx = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = queryText(query);
      if (sql.includes('FROM public.account')) return actor === null ? [] : [actor];
      if (sql.includes('FROM public.sales_order')) return [{ id: orderId }];
      if (sql.includes('FROM public.order_item')) return items;
      if (sql.includes('FROM public.aftersale')) return aftersales;
      if (sql.includes('FROM public.shipment') && sql.includes('WHERE order_id')) {
        return existingShipmentId === null ? [] : [{ id: existingShipmentId }];
      }
      if (sql.includes('FROM public.shipment')) return [{ id: shipmentId }];
      if (sql.includes('FROM public.logistics_event')) {
        return currentShipment.events.map((event) => ({ id: event.id }));
      }
      throw new Error(`Unexpected lock query: ${sql}`);
    }),
    logisticsEvent: { create: vi.fn(async () => ({})) },
    orderItem: { updateMany: vi.fn(async () => ({ count: 1 })) },
    salesOrder: {
      findUnique: vi.fn(async () => order),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    shipment: {
      create: vi.fn(async () => currentShipment),
      findUnique: vi.fn(async (args: { select?: unknown }) => args.select === undefined
        ? currentShipment
        : { order_id: orderId }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  return tx as unknown as DatabaseTransaction;
}

function createInput(overrides: Partial<CreateFulfillmentShipmentInput> = {}): CreateFulfillmentShipmentInput {
  return {
    actorAccountId: actorId,
    carrierCode: 'DEV',
    carrierName: 'Development Carrier',
    expectedOrderVersion: 7,
    items: orderItemIds.map((itemId, index) => ({
      orderItemId: itemId,
      quantity: index + 2,
      shipmentItemId: shipmentItemIds[index],
    })),
    orderId,
    shipmentId,
    trackingNo: 'TRACK-001',
    ...overrides,
  };
}

function statusEventInput(
  overrides: Partial<AppendFulfillmentLogisticsEventInput> = {},
): AppendFulfillmentLogisticsEventInput {
  return {
    actorAccountId: actorId,
    event: {
      description: 'Parcel entered transit',
      eventType: 'STATUS',
      location: 'Sorting centre',
      occurredAt: new Date(NOW.getTime() + 2_000),
      statusCode: 'IN_TRANSIT',
    },
    eventId,
    eventKey: 'fulfillment-event-key-1',
    expectedShipmentVersion: 1,
    shipmentId,
    ...overrides,
  };
}

function repository(): FulfillmentRepository {
  return new FulfillmentRepository({} as PrismaClient, undefined, () => NOW);
}

describe('FulfillmentRepository shipment commands', () => {
  it.each([
    ['inactive', { deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'DISABLED' }],
    ['wrong-role', { deleted_at: null, has_password: true, id: actorId, role: 'CUSTOMER', status: 'ACTIVE' }],
    ['passwordless', { deleted_at: null, has_password: false, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' }],
    ['deleted', { deleted_at: NOW, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' }],
  ])('rejects an %s actor under lock before shipment business reads or writes', async (_label, actor) => {
    const tx = transaction({ actor });
    await expect(repository().createShipmentInTransaction(tx, createInput()))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.salesOrder.findUnique).not.toHaveBeenCalled();
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('locks in the frozen order and atomically ships the exact remaining quantities without an initial event', async () => {
    const tx = transaction({
      items: lockedItems([{ pre_shipment_refunded_qty: 1, quantity: 3 }, { shipped_qty: 1, quantity: 4 }]),
      shipment: shipmentRecord({
        items: shipmentRecord().items.map((item, index) => ({ ...item, quantity: 2 + index })),
      }),
    });
    const input = createInput({
      items: orderItemIds.map((itemId, index) => ({
        orderItemId: itemId,
        quantity: 2 + index,
        shipmentItemId: shipmentItemIds[index],
      })),
    });

    await expect(repository().createShipmentInTransaction(tx, input)).resolves.toMatchObject({
      kind: 'created',
      orderVersion: 8,
      shipment: { events: [], shipmentId, status: 'SHIPPED', version: 1 },
    });

    const locks = vi.mocked(tx.$queryRaw).mock.calls.map(([query]) => queryText(query));
    expect(locks.map((sql) => {
      if (sql.includes('public.account')) return 'actor';
      if (sql.includes('public.sales_order')) return 'order';
      if (sql.includes('public.order_item')) return 'items';
      if (sql.includes('public.aftersale')) return 'aftersales';
      return 'shipment';
    })).toEqual(['actor', 'order', 'items', 'aftersales', 'shipment']);
    expect(tx.orderItem.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING' }),
      where: expect.objectContaining({ id: orderId, version: 7 }),
    }));
    expect(tx.shipment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.not.objectContaining({ events: expect.anything() }),
      include: expect.objectContaining({
        events: expect.objectContaining({ orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }] }),
      }),
    }));
    expect(tx.logisticsEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing item', createInput({ items: [createInput().items[0]!] })],
    ['duplicate order item', createInput({ items: [
      createInput().items[0]!,
      { ...createInput().items[0]!, shipmentItemId: shipmentItemIds[1] },
    ] })],
    ['foreign item', createInput({ items: [
      createInput().items[0]!,
      { ...createInput().items[1]!, orderItemId: id(-9_000) },
    ] })],
    ['short quantity', createInput({ items: [createInput().items[0]!, { ...createInput().items[1]!, quantity: 2 }] })],
    ['excess quantity', createInput({ items: [createInput().items[0]!, { ...createInput().items[1]!, quantity: 4 }] })],
  ])('rejects %s as an exact shipment-item mismatch before writing', async (_label, input) => {
    const tx = transaction();
    await expect(repository().createShipmentInTransaction(tx, input)).rejects.toMatchObject({
      code: 'SHIPMENT_ITEMS_MISMATCH',
    });
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('rejects active aftersale facts after locking them and leaves no shipment shell', async () => {
    const tx = transaction({ aftersales: [{ id: aftersaleId, status: 'WAITING_RETURN' }] });
    await expect(repository().createShipmentInTransaction(tx, createInput())).rejects.toMatchObject({
      code: 'ACTIVE_AFTERSALE_BLOCKS_SHIPMENT',
    });
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('maps a fully exhausted remaining set to SHIPMENT_ITEMS_MISMATCH', async () => {
    const tx = transaction({
      items: lockedItems([{ pre_shipment_refunded_qty: 2 }, { pre_shipment_refunded_qty: 3 }]),
    });
    await expect(repository().createShipmentInTransaction(tx, createInput())).rejects.toMatchObject({
      code: 'SHIPMENT_ITEMS_MISMATCH',
    });
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('allows terminal aftersales and stops before shipment creation on an item CAS failure', async () => {
    const tx = transaction({ aftersales: [{ id: aftersaleId, status: 'COMPLETED' }] });
    vi.mocked(tx.orderItem.updateMany).mockResolvedValueOnce({ count: 0 });
    await expect(repository().createShipmentInTransaction(tx, createInput())).rejects.toMatchObject({
      code: 'SHIPMENT_STATE_CONFLICT',
    });
    expect(tx.shipment.create).not.toHaveBeenCalled();
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['unpaid order', { payment_status: 'UNPAID' }, 'SHIPMENT_STATE_CONFLICT'],
    ['payment resolution', { payment_resolution: 'MANUAL_REQUIRED' }, 'SHIPMENT_STATE_CONFLICT'],
    ['wrong order status', { order_status: 'SHIPPING' }, 'SHIPMENT_STATE_CONFLICT'],
    ['wrong fulfillment status', { fulfillment_status: 'SHIPPED' }, 'SHIPMENT_STATE_CONFLICT'],
    ['stale order version', { version: 8 }, 'RESOURCE_VERSION_CONFLICT'],
  ])('fails closed for %s', async (_label, override, code) => {
    const tx = transaction({ order: commandOrder(override) });
    await expect(repository().createShipmentInTransaction(tx, createInput())).rejects.toMatchObject({ code });
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('returns an exact existing winner before the stale original order version is revalidated', async () => {
    const tx = transaction({
      existingShipmentId: shipmentId,
      order: commandOrder({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING', version: 8 }),
    });
    await expect(repository().createShipmentInTransaction(tx, createInput())).resolves.toMatchObject({
      kind: 'winner', orderVersion: 8, shipment: { shipmentId },
    });
    expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('maps a non-identical unique-package winner to SHIPMENT_STATE_CONFLICT', async () => {
    const tx = transaction({
      existingShipmentId: shipmentId,
      order: commandOrder({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING', version: 8 }),
      shipment: shipmentRecord({ tracking_no: 'OTHER-TRACKING' }),
    });
    await expect(repository().createShipmentInTransaction(tx, createInput())).rejects.toMatchObject({
      code: 'SHIPMENT_STATE_CONFLICT',
    });
  });

  it('rejects closed input shapes before acquiring database locks', async () => {
    const tx = transaction();
    const invalid = { ...createInput(), unexpected: true };
    await expect(repository().createShipmentInTransaction(tx, invalid as never)).rejects.toBeInstanceOf(TypeError);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('reads the current shipment for HASH_ONLY replay and enforces optional order scope', async () => {
    const tx = transaction();
    await expect(repository().getAdminShipmentInTransaction(tx, { orderId, shipmentId }))
      .resolves.toMatchObject({ orderId, shipmentId });
    await expect(repository().getAdminShipmentInTransaction(tx, { orderId: id(-1), shipmentId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('FulfillmentRepository logistics event commands', () => {
  it.each([
    ['inactive', { deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'DISABLED' }],
    ['wrong-role', { deleted_at: null, has_password: true, id: actorId, role: 'CUSTOMER', status: 'ACTIVE' }],
    ['passwordless', { deleted_at: null, has_password: false, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' }],
    ['deleted', { deleted_at: NOW, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' }],
  ])('rejects an %s actor under lock before logistics business reads or writes', async (_label, actor) => {
    const tx = transaction({ actor });
    await expect(repository().appendLogisticsEventInTransaction(tx, statusEventInput()))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.shipment.findUnique).not.toHaveBeenCalled();
    expect(tx.logisticsEvent.create).not.toHaveBeenCalled();
    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
  });

  it('advances SHIPPED to IN_TRANSIT, synchronizes the order and appends one immutable event', async () => {
    const current = shipmentRecord();
    const refreshed = shipmentRecord({
      events: [logisticsEvent()],
      status: 'IN_TRANSIT',
      updated_at: NOW,
      version: 2,
    });
    const tx = transaction({
      order: commandOrder({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING' }),
      shipment: current,
    });
    vi.mocked(tx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce(refreshed as never);

    await expect(repository().appendLogisticsEventInTransaction(tx, statusEventInput())).resolves.toMatchObject({
      event: { eventId, eventType: 'STATUS', statusCode: 'IN_TRANSIT' },
      kind: 'applied',
      shipment: { status: 'IN_TRANSIT', version: 2 },
    });
    const locks = vi.mocked(tx.$queryRaw).mock.calls.map(([query]) => queryText(query));
    expect(locks.map((sql) => {
      if (sql.includes('public.account')) return 'actor';
      if (sql.includes('public.sales_order')) return 'order';
      if (sql.includes('public.shipment')) return 'shipment';
      return 'events';
    })).toEqual(['actor', 'order', 'shipment', 'events']);
    const eventRead = locks.find((sql) => sql.includes('public.logistics_event'));
    expect(eventRead).toBeDefined();
    expect(eventRead).not.toContain('FOR UPDATE');
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'IN_TRANSIT' }),
      where: { id: shipmentId, status: 'SHIPPED', version: 1 },
    }));
    expect(tx.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fulfillment_status: 'IN_TRANSIT' }),
    }));
    expect(tx.logisticsEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        carrier_code: null,
        event_key: 'fulfillment-event-key-1',
        event_type: 'STATUS',
        reason: null,
        status_code: 'IN_TRANSIT',
        tracking_no: null,
      }),
    });
  });

  it('advances IN_TRANSIT to DELIVERED and records the supplied delivery time', async () => {
    const occurredAt = new Date(NOW.getTime() + 4_000);
    const current = shipmentRecord({ status: 'IN_TRANSIT', version: 2 });
    const event = logisticsEvent({
      description: 'Parcel delivered',
      location: null,
      occurred_at: occurredAt,
      status_code: 'DELIVERED',
    });
    const refreshed = shipmentRecord({
      delivered_at: occurredAt,
      events: [event],
      status: 'DELIVERED',
      version: 3,
    });
    const tx = transaction({
      order: commandOrder({ fulfillment_status: 'IN_TRANSIT', order_status: 'SHIPPING' }),
      shipment: current,
    });
    vi.mocked(tx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce(refreshed as never);

    await repository().appendLogisticsEventInTransaction(tx, statusEventInput({
      event: {
        description: 'Parcel delivered',
        eventType: 'STATUS',
        location: null,
        occurredAt,
        statusCode: 'DELIVERED',
      },
      expectedShipmentVersion: 2,
    }));
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ delivered_at: occurredAt, status: 'DELIVERED' }),
    }));
  });

  it('maps a delivered_at value before shipped_at to SHIPMENT_STATE_CONFLICT before writes', async () => {
    const current = shipmentRecord({ status: 'IN_TRANSIT', version: 2 });
    const tx = transaction({
      order: commandOrder({ fulfillment_status: 'IN_TRANSIT', order_status: 'SHIPPING' }),
      shipment: current,
    });
    vi.mocked(tx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(current as never);
    await expect(repository().appendLogisticsEventInTransaction(tx, statusEventInput({
      event: {
        description: 'Invalid delivery time',
        eventType: 'STATUS',
        location: null,
        occurredAt: new Date(NOW.getTime() - 1),
        statusCode: 'DELIVERED',
      },
      expectedShipmentVersion: 2,
    }))).rejects.toMatchObject({ code: 'SHIPMENT_STATE_CONFLICT' });
    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['skip IN_TRANSIT', 'SHIPPED', 'DELIVERED'],
    ['repeat IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT'],
    ['move back from DELIVERED', 'DELIVERED', 'IN_TRANSIT'],
  ] as const)('rejects status transition: %s', async (_label, currentStatus, targetStatus) => {
    const current = shipmentRecord({
      ...(currentStatus === 'DELIVERED' ? { delivered_at: NOW } : {}),
      status: currentStatus,
    });
    const tx = transaction({
      order: commandOrder({ fulfillment_status: currentStatus, order_status: 'SHIPPING' }),
      shipment: current,
    });
    vi.mocked(tx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(current as never);
    await expect(repository().appendLogisticsEventInTransaction(tx, statusEventInput({
      event: { ...statusEventInput().event, eventType: 'STATUS', statusCode: targetStatus },
    }))).rejects.toMatchObject({ code: 'SHIPMENT_STATE_CONFLICT' });
    expect(tx.logisticsEvent.create).not.toHaveBeenCalled();
  });

  it('corrects current tracking facts without changing shipment or order status', async () => {
    const correction = {
      carrierCode: 'CORRECTED',
      carrierName: 'Corrected Carrier',
      description: 'Corrected manually',
      eventType: 'TRACKING_CORRECTION' as const,
      location: null,
      occurredAt: new Date(NOW.getTime() - 60_000),
      reason: 'Operator verified the label',
      trackingNo: 'CORRECTED-TRACK',
    };
    const current = shipmentRecord();
    const event = logisticsEvent({
      carrier_code: correction.carrierCode,
      carrier_name: correction.carrierName,
      description: correction.description,
      event_type: 'TRACKING_CORRECTION',
      location: null,
      occurred_at: correction.occurredAt,
      reason: correction.reason,
      status_code: null,
      tracking_no: correction.trackingNo,
    });
    const refreshed = shipmentRecord({
      carrier_code: correction.carrierCode,
      carrier_name: correction.carrierName,
      events: [event],
      tracking_no: correction.trackingNo,
      version: 2,
    });
    const tx = transaction({
      order: commandOrder({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING' }),
      shipment: current,
    });
    vi.mocked(tx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(current as never)
      .mockResolvedValueOnce(refreshed as never);

    await expect(repository().appendLogisticsEventInTransaction(tx, statusEventInput({ event: correction })))
      .resolves.toMatchObject({
        event: { eventType: 'TRACKING_CORRECTION', reason: correction.reason },
        shipment: { status: 'SHIPPED', trackingNo: correction.trackingNo, version: 2 },
      });
    expect(tx.shipment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        carrier_code: correction.carrierCode,
        carrier_name: correction.carrierName,
        tracking_no: correction.trackingNo,
      }),
    }));
    expect(tx.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('returns an exact event-key winner before If-Match and rejects a mismatched winner', async () => {
    const existing = logisticsEvent();
    const winnerShipment = shipmentRecord({ events: [existing], status: 'IN_TRANSIT', version: 2 });
    const winnerTx = transaction({ shipment: winnerShipment });
    vi.mocked(winnerTx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(winnerShipment as never);
    await expect(repository().appendLogisticsEventInTransaction(
      winnerTx,
      statusEventInput({ expectedShipmentVersion: 99 }),
    )).resolves.toMatchObject({ kind: 'winner', shipment: { version: 2 } });
    expect(winnerTx.shipment.updateMany).not.toHaveBeenCalled();

    const mismatch = shipmentRecord({ events: [logisticsEvent({ description: 'Different fact' })] });
    const mismatchTx = transaction({ shipment: mismatch });
    vi.mocked(mismatchTx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(mismatch as never);
    await expect(repository().appendLogisticsEventInTransaction(mismatchTx, statusEventInput()))
      .rejects.toMatchObject({ code: 'SHIPMENT_STATE_CONFLICT' });
  });

  it.each([
    ['stale shipment version', commandOrder({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING' }), 2,
      'RESOURCE_VERSION_CONFLICT'],
    ['unpaid order', commandOrder({ fulfillment_status: 'SHIPPED', order_status: 'SHIPPING', payment_status: 'UNPAID' }),
      1, 'SHIPMENT_STATE_CONFLICT'],
    ['payment resolution', commandOrder({
      fulfillment_status: 'SHIPPED', order_status: 'SHIPPING', payment_resolution: 'MANUAL_REQUIRED',
    }), 1, 'SHIPMENT_STATE_CONFLICT'],
    ['fulfillment drift', commandOrder({ fulfillment_status: 'IN_TRANSIT', order_status: 'SHIPPING' }), 1,
      'SHIPMENT_STATE_CONFLICT'],
  ])('fails closed for %s', async (_label, order, expectedShipmentVersion, code) => {
    const current = shipmentRecord();
    const tx = transaction({ order, shipment: current });
    vi.mocked(tx.shipment.findUnique)
      .mockResolvedValueOnce({ order_id: orderId } as never)
      .mockResolvedValueOnce(current as never);
    await expect(repository().appendLogisticsEventInTransaction(
      tx,
      statusEventInput({ expectedShipmentVersion }),
    )).rejects.toMatchObject({ code });
    expect(tx.logisticsEvent.create).not.toHaveBeenCalled();
  });

  it('rejects mutually mixed logistics event fields before database access', async () => {
    const tx = transaction();
    const input = statusEventInput();
    const mixed = { ...input, event: { ...input.event, reason: 'Not allowed' } };
    await expect(repository().appendLogisticsEventInTransaction(tx, mixed as never))
      .rejects.toBeInstanceOf(TypeError);
    expect(tx.shipment.findUnique).not.toHaveBeenCalled();
  });
});
