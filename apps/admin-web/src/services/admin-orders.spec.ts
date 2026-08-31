import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminOrderDetail } from '../types/orders';
import {
  decodeAdminFulfillmentAddressResponse,
  decodeAdminOrderCommandResponse,
  decodeAdminOrderDetailResponse,
  decodeAdminOrderListResponse,
  decodeLogisticsResponse,
  decodeShipmentResponse,
} from './admin-orders-decoders';

const adminSessionRequest = vi.hoisted(() => vi.fn());
vi.mock('./admin-api', () => ({ adminSessionRequest }));

import {
  appendAdminLogisticsEvent,
  buildAdminOrderListPath,
  completeAdminOrder,
  createAdminShipment,
  getAdminFulfillmentAddress,
  getAdminOrder,
  listAdminOrders,
} from './admin-orders';

const orderId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const customerId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const productId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const skuId = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const orderItemId = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const shipmentId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const snapshotId = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const eventId = '01ARZ3NDEKTSV4RRFFQ69G5FB2';
const secondEventId = '01ARZ3NDEKTSV4RRFFQ69G5FB3';
const requestId = 'req_admin_orders';
const idempotencyKey = '00000000-0000-4000-8000-000000000001';

const amounts = { goods: '18.00', paid: '18.00', payable: '18.00', refunded: '0.00', shipping: '0.00' };
const orderItem = {
  line_amount: '18.00',
  order_item_id: orderItemId,
  product_id: productId,
  product_name: 'Development Product',
  quantity: 2,
  refunded_quantity: 0,
  reserved_aftersale_quantity: 0,
  shipped_quantity: 0,
  sku_id: skuId,
  sku_name: 'Standard',
  unit_price: '9.00',
};
const logisticsEvent = {
  carrier_code: null,
  carrier_name: null,
  description: 'Accepted by carrier',
  event_id: eventId,
  event_key: 'event-key',
  event_type: 'STATUS',
  location: 'Development location',
  occurred_at: '2026-08-31T04:05:00.000Z',
  reason: null,
  status_code: 'IN_TRANSIT',
  tracking_no: null,
} as const;
const shipment = {
  carrier_code: 'DEV',
  carrier_name: 'Development Carrier',
  delivered_at: null,
  items: [{ order_item_id: orderItemId, quantity: 2 }],
  order_id: orderId,
  shipment_id: shipmentId,
  shipped_at: '2026-08-31T04:00:00.000Z',
  status: 'SHIPPED',
  tracking_no: 'DEV-TRACK-001',
  version: 3,
} as const;

const detail: AdminOrderDetail = {
  aftersales: [],
  amounts,
  attribution: { agent_id: null, agent_name: null, frozen_at: null, source: 'DIRECT' },
  available_actions: ['ADD_LOGISTICS_EVENT', 'COMPLETE', 'READ_FULFILLMENT_ADDRESS'],
  close_reason: null,
  commission_impact: [],
  completion_reason: null,
  customer: {
    customer_alias: 'Customer 001',
    customer_id: customerId,
    nickname_masked: 'D***',
    phone_masked: '138****0000',
  },
  display_status: '运输中',
  errors: [],
  fulfillment_status: 'SHIPPED',
  inventory_impact: [],
  items: [orderItem],
  order_id: orderId,
  order_no: `QX${orderId}`,
  order_status: 'SHIPPING',
  packages: [{
    carrier_name: shipment.carrier_name,
    delivered_at: null,
    events: [logisticsEvent],
    items: [{
      order_item_id: orderItemId,
      product_name: orderItem.product_name,
      quantity: 2,
      sku_id: skuId,
      sku_name: orderItem.sku_name,
    }],
    shipment_id: shipmentId,
    shipped_at: shipment.shipped_at,
    status: 'SHIPPED',
    tracking_no: shipment.tracking_no,
    version: 3,
  }],
  pay_expires_at: '2026-08-31T03:00:00.000Z',
  payment_attempts: [],
  payment_resolution: 'NORMAL',
  payment_status: 'PAID',
  refund_attempts: [],
  refund_processing_status: 'IDLE',
  refund_progress_status: 'NONE',
  shipping_address_masked: {
    detail_masked: 'Example ***',
    phone_masked: '138****0000',
    recipient_name_masked: 'D***',
    region_summary: 'Example Province Example City',
  },
  timeline: [{
    axis: 'ORDER',
    event: 'ORDER_CREATED',
    event_id: `${orderId}:created`,
    from_status: null,
    occurred_at: '2026-08-31T02:00:00.000Z',
    to_status: 'PENDING_PAYMENT',
  }],
  version: 5,
};

function envelope(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

function listItem() {
  return {
    agent_id: null,
    agent_name: null,
    created_at: '2026-08-31T02:00:00.000Z',
    customer_alias: 'Customer 001',
    customer_id: customerId,
    display_status: '运输中',
    fulfillment_status: 'SHIPPED',
    order_id: orderId,
    order_no: `QX${orderId}`,
    order_status: 'SHIPPING',
    payable_amount: '18.00',
    payment_status: 'PAID',
    recipient_phone_masked: '138****0000',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    version: 5,
  };
}

function commandResult() {
  return {
    address_snapshot: detail.shipping_address_masked,
    aftersale_ids: [],
    amounts,
    close_reason: null,
    completion_reason: 'ADMIN_FORCED',
    display_status: '已完成',
    fulfillment_status: 'DELIVERED',
    items: [orderItem],
    order_id: orderId,
    order_no: `QX${orderId}`,
    order_status: 'COMPLETED',
    payment_attempts: [],
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    version: 6,
  };
}

describe('B11.4 strict Admin order decoders', () => {
  it('decodes list and complete-command envelopes with their exact generated shapes', () => {
    expect(decodeAdminOrderListResponse(envelope({
      items: [listItem()],
      pagination: { page: 1, page_size: 20, total: 1 },
    }))).toEqual({ items: [listItem()], pagination: { page: 1, pageSize: 20, total: 1 } });
    expect(decodeAdminOrderCommandResponse(envelope(commandResult())).completion_reason).toBe('ADMIN_FORCED');
  });

  it('decodes the complete detail, package, address, shipment and logistics projections', () => {
    expect(decodeAdminOrderDetailResponse(envelope(detail))).toEqual(detail);
    expect(decodeShipmentResponse(envelope(shipment))).toEqual(shipment);
    expect(decodeLogisticsResponse(envelope({ events: [logisticsEvent], shipment }))).toEqual({
      events: [logisticsEvent], shipment,
    });

    const address = {
      access_expires_at: '2026-08-31T04:10:00.000Z',
      city: 'Example City',
      detail: 'Development address',
      district: 'Example District',
      order_id: orderId,
      order_no: `QX${orderId}`,
      phone: '[development phone]',
      province: 'Example Province',
      purpose: 'ORDER_FULFILLMENT',
      recipient_name: 'Development Recipient',
      snapshot_at: '2026-08-31T02:00:00.000Z',
      snapshot_id: snapshotId,
    };
    expect(decodeAdminFulfillmentAddressResponse(envelope(address))).toEqual(address);
  });

  it('rejects undeclared PII and missing package concurrency versions', () => {
    expect(() => decodeAdminOrderListResponse(envelope({
      items: [{ ...listItem(), recipient_phone: '[forbidden]' }],
      pagination: { page: 1, page_size: 20, total: 1 },
    }))).toThrow('response.data.items[0]');

    const packageWithoutVersion = { ...detail.packages[0] } as Record<string, unknown>;
    delete packageWithoutVersion.version;
    expect(() => decodeAdminOrderDetailResponse(envelope({
      ...detail,
      packages: [packageWithoutVersion],
    }))).toThrow('response.data.packages[0]');
    expect(() => decodeAdminOrderDetailResponse(envelope({
      ...detail,
      packages: [detail.packages[0], detail.packages[0]],
    }))).toThrow('response.data.packages');
    expect(() => decodeShipmentResponse(envelope({
      ...shipment,
      items: [],
    }))).toThrow('response.data.items');
    expect(() => decodeShipmentResponse(envelope({
      ...shipment,
      items: [shipment.items[0], shipment.items[0]],
    }))).toThrow('response.data.items');
    expect(() => decodeAdminOrderDetailResponse(envelope({
      ...detail,
      packages: [{
        ...detail.packages[0],
        items: [detail.packages[0]!.items[0]!, detail.packages[0]!.items[0]!],
      }],
    }))).toThrow('response.data.packages[0].items');
    expect(() => decodeAdminOrderListResponse(envelope({
      items: [listItem()],
      pagination: { page: 1, page_size: 101, total: 1 },
    }))).toThrow('response.data.pagination.page_size');
    expect(() => decodeAdminOrderCommandResponse(envelope({
      ...commandResult(),
      aftersale_ids: [snapshotId, snapshotId],
    }))).toThrow('response.data.aftersale_ids');
  });

  it('rejects unknown actions and cross-branch logistics values', () => {
    expect(() => decodeAdminOrderDetailResponse(envelope({
      ...detail,
      available_actions: [...detail.available_actions, 'REFUND'],
    }))).toThrow('response.data.available_actions[3]');
    expect(() => decodeLogisticsResponse(envelope({
      events: [{ ...logisticsEvent, status_code: 'CANCELLED' }],
      shipment,
    }))).toThrow('response.data.events[0].status_code');
    expect(() => decodeLogisticsResponse(envelope({
      events: [{ ...logisticsEvent, event_id: 'not-an-ulid' }],
      shipment,
    }))).toThrow('response.data.events[0].event_id');
    expect(() => decodeAdminOrderDetailResponse(envelope({
      ...detail,
      available_actions: ['COMPLETE', 'COMPLETE'],
    }))).toThrow('response.data.available_actions');
  });

  it('rejects non-RFC3339 and calendar-invalid date-time values', () => {
    expect(() => decodeShipmentResponse(envelope({
      ...shipment,
      shipped_at: '2026-08-31',
    }))).toThrow('response.data.shipped_at');
    expect(() => decodeShipmentResponse(envelope({
      ...shipment,
      shipped_at: '2026-02-30T04:00:00.000Z',
    }))).toThrow('response.data.shipped_at');
    expect(() => decodeShipmentResponse(envelope({
      ...shipment,
      shipped_at: '2026-08-31T04:00:00+24:00',
    }))).toThrow('response.data.shipped_at');
  });

  it('rejects duplicate and unstable logistics event projections', () => {
    expect(() => decodeAdminOrderDetailResponse(envelope({
      ...detail,
      packages: [{
        ...detail.packages[0],
        events: [logisticsEvent, logisticsEvent],
      }],
    }))).toThrow('response.data.packages[0].events');

    expect(() => decodeLogisticsResponse(envelope({
      events: [
        { ...logisticsEvent, event_id: secondEventId, occurred_at: '2026-08-31T04:06:00.000Z' },
        logisticsEvent,
      ],
      shipment,
    }))).toThrow('response.data.events');

    expect(() => decodeLogisticsResponse(envelope({
      events: [
        { ...logisticsEvent, event_id: secondEventId },
        logisticsEvent,
      ],
      shipment,
    }))).toThrow('response.data.events');
  });
});

describe('B11.4 Admin order API service', () => {
  beforeEach(() => adminSessionRequest.mockReset());

  it('builds the closed filter query and strictly decodes list/detail reads', async () => {
    expect(buildAdminOrderListPath({
      agentId: customerId,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      fulfillmentStatus: 'SHIPPED',
      maxAmount: '99.00',
      minAmount: '1.00',
      orderNo: 'QX-001',
      orderStatus: 'SHIPPING',
      page: 2,
      pageSize: 50,
      paymentStatus: 'PAID',
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'NONE',
      sort: 'PAID_DESC',
    })).toBe(
      '/admin/orders?page=2&page_size=50&order_no=QX-001&order_status=SHIPPING&payment_status=PAID' +
      '&refund_progress_status=NONE&refund_processing_status=IDLE&fulfillment_status=SHIPPED' +
      '&date_from=2026-08-01&date_to=2026-08-31&min_amount=1.00&max_amount=99.00' +
      `&sort=PAID_DESC&agent_id=${customerId}`,
    );

    adminSessionRequest
      .mockResolvedValueOnce(envelope({ items: [listItem()], pagination: { page: 1, page_size: 20, total: 1 } }))
      .mockResolvedValueOnce(envelope(detail));
    await expect(listAdminOrders()).resolves.toMatchObject({ pagination: { total: 1 } });
    await expect(getAdminOrder(orderId)).resolves.toEqual(detail);
  });

  it('sends a UTF-8 encoded purpose-bound address reason without placing it in the URL', async () => {
    const address = {
      access_expires_at: '2026-08-31T04:10:00.000Z', city: 'City', detail: 'Address', district: 'District',
      order_id: orderId, order_no: `QX${orderId}`, phone: '[development phone]', province: 'Province',
      purpose: 'ORDER_FULFILLMENT', recipient_name: 'Recipient', snapshot_at: '2026-08-31T02:00:00.000Z',
      snapshot_id: snapshotId,
    };
    adminSessionRequest.mockResolvedValue(envelope(address));
    await getAdminFulfillmentAddress(orderId, '核对本订单发货收件信息');
    expect(adminSessionRequest).toHaveBeenCalledWith(`/admin/orders/${orderId}/fulfillment-address`, {
      expectedStatus: 200,
      headers: {
        'X-Access-Purpose': 'ORDER_FULFILLMENT',
        'X-Access-Reason': `UTF-8''${encodeURIComponent('核对本订单发货收件信息')}`,
      },
      signal: undefined,
    });

    adminSessionRequest.mockResolvedValue(envelope({ ...address, order_id: customerId }));
    await expect(getAdminFulfillmentAddress(orderId, '核对本订单发货收件信息'))
      .rejects.toThrow('response.data.order_id');
  });

  it('sends exact idempotency and version headers for shipment, logistics and completion', async () => {
    adminSessionRequest
      .mockResolvedValueOnce(envelope(shipment))
      .mockResolvedValueOnce(envelope({ events: [logisticsEvent], shipment }))
      .mockResolvedValueOnce(envelope(commandResult()));

    const shipmentBody = {
      carrier_code: 'DEV', carrier_name: 'Development Carrier', tracking_no: 'DEV-TRACK-001',
      items: [{ order_item_id: orderItemId, quantity: 2 }],
    };
    await createAdminShipment(orderId, shipmentBody, 5, idempotencyKey);
    await appendAdminLogisticsEvent(shipmentId, {
      description: 'Accepted by carrier', event_type: 'STATUS', location: null,
      occurred_at: '2026-08-31T04:05:00.000Z', status_code: 'IN_TRANSIT',
    }, 3, idempotencyKey);
    await completeAdminOrder(orderId, 'Verified delivery', 5, idempotencyKey);

    expect(adminSessionRequest.mock.calls.map(([path, options]) => ({
      body: options.body,
      expectedStatus: options.expectedStatus,
      idempotencyKey: options.idempotencyKey,
      ifMatch: options.ifMatch,
      path,
    }))).toEqual([
      {
        body: shipmentBody,
        expectedStatus: 201,
        idempotencyKey,
        ifMatch: '"5"',
        path: `/admin/orders/${orderId}/shipments`,
      },
      {
        body: {
          description: 'Accepted by carrier', event_type: 'STATUS', location: null,
          occurred_at: '2026-08-31T04:05:00.000Z', status_code: 'IN_TRANSIT',
        },
        expectedStatus: 200,
        idempotencyKey,
        ifMatch: '"3"',
        path: `/admin/shipments/${shipmentId}/events`,
      },
      {
        body: { completion_reason: 'ADMIN_FORCED', reason: 'Verified delivery' },
        expectedStatus: 200,
        idempotencyKey,
        ifMatch: '"5"',
        path: `/admin/orders/${orderId}/complete`,
      },
    ]);
  });

  it('fails closed when order and shipment responses target another resource', async () => {
    adminSessionRequest.mockResolvedValueOnce(envelope({ ...detail, order_id: customerId }));
    await expect(getAdminOrder(orderId)).rejects.toThrow('response.data.order_id');

    adminSessionRequest.mockResolvedValueOnce(envelope({ ...shipment, order_id: customerId }));
    await expect(createAdminShipment(orderId, {
      carrier_code: 'DEV',
      carrier_name: 'Development Carrier',
      items: [{ order_item_id: orderItemId, quantity: 2 }],
      tracking_no: 'DEV-TRACK-001',
    }, 5, idempotencyKey)).rejects.toThrow('response.data.order_id');

    adminSessionRequest.mockResolvedValueOnce(envelope({
      events: [logisticsEvent],
      shipment: { ...shipment, shipment_id: customerId },
    }));
    await expect(appendAdminLogisticsEvent(shipmentId, {
      description: 'Accepted by carrier',
      event_type: 'STATUS',
      location: null,
      occurred_at: '2026-08-31T04:05:00.000Z',
      status_code: 'IN_TRANSIT',
    }, 3, idempotencyKey)).rejects.toThrow('response.data.shipment.shipment_id');

    adminSessionRequest.mockResolvedValueOnce(envelope({ ...commandResult(), order_id: customerId }));
    await expect(completeAdminOrder(orderId, 'Verified delivery', 5, idempotencyKey))
      .rejects.toThrow('response.data.order_id');
  });
});
