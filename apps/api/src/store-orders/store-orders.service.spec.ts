import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  OwnedFulfillmentProjection,
  StoreCheckoutQuoteSnapshot,
  StoreOrderCloseResult,
  StoreOrderCreationResult,
  StoreOrderDetailSnapshot,
  StoreOrderListItemSnapshot,
  StoreOrderSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreAddressSecurityMaterial,
  createStoreOrderAddressSecurityMaterial,
  verifyStoreOrderAddressSecurityMaterial,
} from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreOrderListQuery, StoreOrderSubmitRequest } from './store-orders.dto';
import { storeOrderDisplayStatus, StoreOrdersService } from './store-orders.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const ADDRESS_ID = '01J00000000000000000000004';
const CART_ID = '01J00000000000000000000005';
const PRODUCT_ID = '01J00000000000000000000006';
const BRAND_ID = '01J00000000000000000000007';
const CATEGORY_ID = '01J00000000000000000000008';
const SKU_ID = '01J00000000000000000000009';
const INVENTORY_ID = '01J0000000000000000000000A';
const IMAGE_ID = '01J0000000000000000000000B';
const FILE_ID = '01J0000000000000000000000C';
const QUOTE_ID = '01J0000000000000000000000D';
const ORDER_ID = '01J0000000000000000000000E';
const ORDER_ITEM_ID = '01J0000000000000000000000F';
const RESERVATION_ID = '01J0000000000000000000000G';
const CANDIDATE_ID = '01J0000000000000000000000H';
const ADDRESS_SNAPSHOT_ID = '01J0000000000000000000000J';
const SHIPMENT_ID = '01J0000000000000000000000N';
const SHIPMENT_ITEM_ID = '01J0000000000000000000000P';
const LOGISTICS_EVENT_ID = '01J0000000000000000000000Q';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = 'req_00000000000000000000000000000001';
const IP_ADDRESS = '127.0.0.1';
const PHONE = ['139', '0000', '6821'].join('');
const DETAIL = '23 Queen Street';
const RECIPIENT = 'Lin';
const QUOTE_TOKEN = 'signed.checkout.quote.'.padEnd(64, 'q');
const CONFIRMATION_HASH = 'a'.repeat(64);
const NOW = new Date('2026-08-28T00:00:00.000Z');
const PAY_EXPIRES_AT = new Date('2026-08-28T00:30:00.000Z');

function fulfillmentProjection(
  overrides: Partial<OwnedFulfillmentProjection> = {},
): OwnedFulfillmentProjection {
  return {
    canConfirmReceipt: false,
    canViewLogistics: false,
    customerId: CUSTOMER_ID,
    fulfillmentStatus: 'NOT_STARTED',
    orderId: ORDER_ID,
    orderStatus: 'PENDING_PAYMENT',
    paymentResolution: 'NORMAL',
    paymentStatus: 'UNPAID',
    shipment: null,
    version: 1,
    ...overrides,
  };
}

type MockClaimResult =
  | { kind: 'execute' }
  | {
      kind: 'replay';
      record: { resource_id: string; response_body: null; response_status: number };
    };

const fieldCurrent = { id: 'field-current', key: Buffer.alloc(32, 81) };
const fieldPrevious = { id: 'field-previous', key: Buffer.alloc(32, 82) };
const phoneKey = { id: 'phone-current', key: Buffer.alloc(32, 83) };
const idempotencyKey = { id: 'idempotency-current', key: Buffer.alloc(32, 84) };
const config = {
  encryption: {
    fieldKeys: { current: fieldCurrent, previous: [fieldPrevious] },
    idempotencyHashKeys: { current: idempotencyKey, previous: [] },
    ipHashKey: Buffer.alloc(32, 85),
  },
  store: { phoneHashKeys: { current: phoneKey, previous: [] } },
} as unknown as PlatformRuntimeConfig;

const session: CurrentStoreSession = {
  accessJti: 'access:01J0000000000000000000000K',
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: '01J0000000000000000000000M',
  sessionId: SESSION_ID,
};

const input: StoreOrderSubmitRequest = {
  addressId: ADDRESS_ID,
  confirmationHash: CONFIRMATION_HASH,
  items: [{ quantity: 2, skuId: SKU_ID }],
  quoteId: QUOTE_ID,
  quoteToken: QUOTE_TOKEN,
  source: 'CART',
};

function quoteSnapshot(): StoreCheckoutQuoteSnapshot {
  const address = createStoreAddressSecurityMaterial(
    { addressId: ADDRESS_ID, detail: DETAIL, phone: PHONE },
    fieldPrevious,
    phoneKey,
  );
  return {
    address: {
      addressId: ADDRESS_ID,
      city: 'Auckland',
      customerId: CUSTOMER_ID,
      detailCiphertext: address.detailCiphertext,
      district: 'Central',
      encryptionKeyId: address.encryptionKeyId,
      isDefault: true,
      phoneCiphertext: address.phoneCiphertext,
      phoneHash: address.phoneHash,
      phoneLast4: address.phoneLast4,
      province: 'Auckland',
      recipientName: RECIPIENT,
      version: 3,
    },
    blockers: [],
    canSubmit: true,
    cart: {
      cartId: CART_ID,
      selectedItems: [{ quantity: 2, skuId: SKU_ID }],
      selectionMatches: true,
    },
    goodsAmount: '39.80',
    items: [{
      availableStock: 8,
      brandId: BRAND_ID,
      brandName: 'Qingxu',
      brandVersion: 4,
      categoryId: CATEGORY_ID,
      categoryName: 'Cleanser',
      categoryVersion: 5,
      inventoryBalanceId: INVENTORY_ID,
      inventoryVersion: 6,
      lineAmount: '39.80',
      lockedQty: 2,
      physicalQty: 10,
      primaryImageFileId: FILE_ID,
      primaryImageId: IMAGE_ID,
      primaryImageObjectKey: `public/${FILE_ID}`,
      productId: PRODUCT_ID,
      productName: 'Daily cleanser',
      productVersion: 7,
      quantity: 2,
      saleable: true,
      skuCode: 'SKU-120',
      skuId: SKU_ID,
      skuName: '120 ml',
      skuVersion: 8,
      specification: { attributes: [{ name: 'Volume', value: '120 ml' }] },
      unitPrice: '19.90',
    }],
    payableAmount: '39.80',
    shippingAmount: '0.00',
    source: 'CART',
  };
}

function orderSnapshot(overrides: Partial<StoreOrderSnapshot> = {}): StoreOrderSnapshot {
  return {
    amounts: { goods: '39.80', paid: '0.00', payable: '39.80', refunded: '0.00', shipping: '0.00' },
    closeReason: null,
    completionReason: null,
    createdAt: NOW,
    customerId: CUSTOMER_ID,
    fulfillmentStatus: 'NOT_STARTED',
    items: [{
      brandName: 'Qingxu',
      categoryId: CATEGORY_ID,
      categoryName: 'Cleanser',
      createdAt: NOW,
      lineAmount: '39.80',
      orderItemId: ORDER_ITEM_ID,
      productId: PRODUCT_ID,
      productName: 'Daily cleanser',
      quantity: 2,
      refundedAmount: '0.00',
      refundedQuantity: 0,
      reservedAftersaleAmount: '0.00',
      reservedAftersaleQuantity: 0,
      shippedQuantity: 0,
      skuCode: 'SKU-120',
      skuId: SKU_ID,
      skuName: '120 ml',
      unitPrice: '19.90',
      version: 1,
    }],
    orderId: ORDER_ID,
    orderNo: `QX${ORDER_ID}`,
    orderStatus: 'PENDING_PAYMENT',
    payExpiresAt: PAY_EXPIRES_AT,
    paymentResolution: 'NORMAL',
    paymentStatus: 'UNPAID',
    refundProcessingStatus: 'IDLE',
    refundProgressStatus: 'NONE',
    serverTime: NOW,
    source: 'CART',
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

function creationResult(order = orderSnapshot()): StoreOrderCreationResult {
  return {
    attribution: {
      bindingId: null,
      candidateAgentId: null,
      candidateId: CANDIDATE_ID,
      submitChannel: 'DIRECT',
    },
    inventory: [{
      balanceId: INVENTORY_ID,
      lockedAfter: 4,
      lockedBefore: 2,
      physicalQty: 10,
      skuId: SKU_ID,
      version: 7,
    }],
    order,
    removedCartItemCount: 1,
    reservation: { expiresAt: PAY_EXPIRES_AT, reservationId: RESERVATION_ID, status: 'ACTIVE' },
  };
}

function listItemSnapshot(overrides: Partial<StoreOrderListItemSnapshot> = {}): StoreOrderListItemSnapshot {
  return {
    aftersaleSummary: {
      activeCount: 0,
      latestAftersaleId: null,
      latestStatus: null,
      refundedAmount: '0.00',
    },
    canCancel: true,
    canPay: true,
    itemImages: [{ objectKey: `public/${FILE_ID}`, orderItemId: ORDER_ITEM_ID }],
    order: orderSnapshot(),
    ...overrides,
  };
}

function detailSnapshot(overrides: Partial<StoreOrderDetailSnapshot> = {}): StoreOrderDetailSnapshot {
  const protectedAddress = createStoreOrderAddressSecurityMaterial({
    detail: DETAIL,
    phone: PHONE,
    snapshotId: ADDRESS_SNAPSHOT_ID,
  }, fieldPrevious);
  return {
    address: {
      city: 'Auckland',
      detailCiphertext: protectedAddress.detailCiphertext,
      district: 'Central',
      encryptionKeyId: protectedAddress.encryptionKeyId,
      phoneCiphertext: protectedAddress.phoneCiphertext,
      phoneLast4: protectedAddress.phoneLast4,
      province: 'Auckland',
      recipientName: RECIPIENT,
      snapshotId: ADDRESS_SNAPSHOT_ID,
    },
    canCancel: true,
    canPay: true,
    closedAt: null,
    order: orderSnapshot(),
    paymentAttempts: [],
    refundAttempts: [],
    ...overrides,
  };
}

function closedOrder(): StoreOrderSnapshot {
  const closedAt = new Date('2026-08-28T00:10:00.000Z');
  return orderSnapshot({
    closeReason: 'USER_CANCELLED',
    orderStatus: 'CLOSED',
    serverTime: closedAt,
    updatedAt: closedAt,
    version: 2,
  });
}

function closeResult(changed = true): StoreOrderCloseResult {
  const order = closedOrder();
  return {
    before: changed ? orderSnapshot() : order,
    changed,
    order,
    reservationId: changed ? RESERVATION_ID : null,
  };
}

function harness() {
  const sequence: string[] = [];
  const snapshot = quoteSnapshot();
  let protectedAddress: unknown;
  const transaction = {};
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => sequence.push('assertHashOnlyReplay')),
    claim: vi.fn<(_transaction: unknown, _claim: unknown) => Promise<MockClaimResult>>(async () => {
      sequence.push('claim');
      return { kind: 'execute' as const };
    }),
    complete: vi.fn(async (_transaction: unknown, _claim: unknown, _result: unknown) => {
      void [_transaction, _claim, _result];
      sequence.push('complete');
    }),
  };
  const credentials = {
    authenticate: vi.fn(() => {
      sequence.push('authenticate');
      return { expiresAt: new Date('2026-08-28T00:05:00.000Z'), keyId: idempotencyKey.id, quoteId: QUOTE_ID };
    }),
    verify: vi.fn(() => {
      sequence.push('verify');
      return { expiresAt: new Date('2026-08-28T00:05:00.000Z'), keyId: idempotencyKey.id, quoteId: QUOTE_ID };
    }),
  };
  const orders = {
    cancelOwnedOrderInTransaction: vi.fn(async () => {
      sequence.push('cancel');
      return closeResult();
    }),
    createOrderInTransaction: vi.fn(async (_transaction, _input, hooks) => {
      sequence.push('create');
      hooks.verifyQuote(snapshot);
      protectedAddress = hooks.protectAddress(ADDRESS_SNAPSHOT_ID, snapshot.address);
      return creationResult();
    }),
    getOwnedOrderForReplayInTransaction: vi.fn(async () => {
      sequence.push('getReplay');
      return orderSnapshot();
    }),
    getOwnedOrderDetailInTransaction: vi.fn(async () => detailSnapshot()),
    listOwnedOrdersInTransaction: vi.fn(async () => ({ items: [listItemSnapshot()], total: 1 })),
  };
  const fulfillment = {
    getOwnedFulfillmentProjection: vi.fn(async () => fulfillmentProjection()),
    getOwnedFulfillmentProjectionInTransaction: vi.fn(async () => fulfillmentProjection()),
    listOwnedFulfillmentProjectionsInTransaction: vi.fn(async () => new Map([
      [ORDER_ID, fulfillmentProjection()],
    ])),
  };
  const audit = {
    append: vi.fn(async () => {
      sequence.push('audit');
    }),
  };
  const outbox = {
    append: vi.fn(async () => {
      sequence.push('outbox');
    }),
  };
  const storage = {
    publicUrl: vi.fn((objectKey: string) => `https://assets.example.test/${objectKey}`),
  };
  const completion = {
    confirmCustomer: vi.fn(async () => {
      sequence.push('confirmCustomer');
    }),
  };
  const service = new StoreOrdersService();
  Object.assign(service, {
    audit,
    completion,
    config,
    credentials,
    database,
    fulfillment,
    idempotency,
    orders,
    outbox,
    storage,
  });
  return {
    audit,
    completion,
    credentials,
    database,
    fulfillment,
    get protectedAddress() { return protectedAddress; },
    idempotency,
    orders,
    outbox,
    sequence,
    service,
    snapshot,
    storage,
    transaction,
  };
}

describe('B9.2-B9.3 StoreOrdersService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the shared closed display projection for pending payment and incomplete shipment axes', () => {
    expect(storeOrderDisplayStatus(orderSnapshot({ paymentStatus: 'PROCESSING' }))).toBe('待付款');
    expect(() => storeOrderDisplayStatus(orderSnapshot({
      fulfillmentStatus: 'NOT_STARTED',
      orderStatus: 'PENDING_SHIPMENT',
    }))).toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });

  it('confirms receipt through the shared transaction service and returns the current owned detail', async () => {
    const current = harness();

    await expect(current.service.confirmReceipt(
      session,
      ORDER_ID,
      3,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({ order_id: ORDER_ID, version: 1 });

    expect(current.completion.confirmCustomer).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedOrderVersion: 3,
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: IP_ADDRESS,
      orderId: ORDER_ID,
      requestId: REQUEST_ID,
    });
    expect(current.orders.getOwnedOrderDetailInTransaction).toHaveBeenCalledWith(
      current.transaction,
      { customerId: CUSTOMER_ID, orderId: ORDER_ID },
    );
  });

  it('creates, protects and records an order in the required transaction order without persisting secrets', async () => {
    const current = harness();

    await expect(current.service.createOrder(
      session,
      input,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({
      display_status: '待付款',
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      order_status: 'PENDING_PAYMENT',
      pay_expires_at: PAY_EXPIRES_AT.toISOString(),
      server_time: NOW.toISOString(),
    });

    expect(current.sequence).toEqual(['claim', 'authenticate', 'create', 'verify', 'audit', 'outbox', 'complete']);
    expect(current.credentials.authenticate).toHaveBeenCalledWith({
      confirmationHash: CONFIRMATION_HASH,
      customerId: CUSTOMER_ID,
      quoteId: QUOTE_ID,
      quoteToken: QUOTE_TOKEN,
      request: {
        address_id: ADDRESS_ID,
        items: [{ quantity: 2, sku_id: SKU_ID }],
        source: 'CART',
      },
      sessionId: SESSION_ID,
    });
    expect(current.orders.createOrderInTransaction).toHaveBeenCalledWith(
      current.transaction,
      {
        accountId: ACCOUNT_ID,
        addressId: ADDRESS_ID,
        customerId: CUSTOMER_ID,
        items: [{ quantity: 2, skuId: SKU_ID }],
        source: 'CART',
      },
      expect.objectContaining({ protectAddress: expect.any(Function), verifyQuote: expect.any(Function) }),
    );
    expect(current.credentials.verify).toHaveBeenCalledWith({
      confirmationHash: CONFIRMATION_HASH,
      customerId: CUSTOMER_ID,
      facts: expect.objectContaining({
        address: { address_id: ADDRESS_ID, version: 3 },
        cart: {
          cart_id: CART_ID,
          selected_items: [{ quantity: 2, sku_id: SKU_ID }],
        },
        payable_amount: '39.80',
      }),
      quoteId: QUOTE_ID,
      quoteToken: QUOTE_TOKEN,
      request: {
        address_id: ADDRESS_ID,
        items: [{ quantity: 2, sku_id: SKU_ID }],
        source: 'CART',
      },
      sessionId: SESSION_ID,
    });

    const protectedAddress = current.protectedAddress as {
      detailCiphertext: Uint8Array;
      encryptionKeyId: string;
      phoneCiphertext: Uint8Array;
      phoneLast4: string;
    };
    expect(protectedAddress.encryptionKeyId).toBe(fieldCurrent.id);
    expect(Buffer.from(protectedAddress.phoneCiphertext).equals(
      Buffer.from(current.snapshot.address.phoneCiphertext),
    )).toBe(false);
    expect(verifyStoreOrderAddressSecurityMaterial({
      ...protectedAddress,
      snapshotId: ADDRESS_SNAPSHOT_ID,
    }, config.encryption.fieldKeys)).toMatchObject({ detail: DETAIL, phone: PHONE });

    expect(current.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ actorId: ACCOUNT_ID, idempotencyKey: IDEMPOTENCY_KEY }),
      {
        resourceId: ORDER_ID,
        responseForHash: { order_created: { order_id: ORDER_ID, order_no: `QX${ORDER_ID}` } },
        responseStatus: 201,
        storage: 'HASH_ONLY',
      },
    );
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'CREATE',
      actorAccountId: ACCOUNT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      module: 'order',
      objectId: ORDER_ID,
      objectType: 'order',
      requestId: REQUEST_ID,
    }));
    expect(current.outbox.append).toHaveBeenCalledWith(current.transaction, {
      aggregateId: ORDER_ID,
      aggregateType: 'order',
      eventType: 'order.created',
      payload: {
        event_version: 1,
        resource_id: ORDER_ID,
        resource_type: 'order',
        resource_version: 1,
      },
    });

    const persistedMetadata = JSON.stringify([
      current.audit.append.mock.calls,
      current.outbox.append.mock.calls,
      current.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    for (const secret of [PHONE, DETAIL, RECIPIENT, QUOTE_TOKEN, CONFIRMATION_HASH]) {
      expect(persistedMetadata).not.toContain(secret);
    }
  });

  it('replays the current owned projection and verifies HASH_ONLY integrity before any credential check', async () => {
    const current = harness();
    const record = {
      resource_id: ORDER_ID,
      response_body: null,
      response_status: 201,
    };
    current.idempotency.claim.mockImplementationOnce(async () => {
      current.sequence.push('claim');
      return { kind: 'replay' as const, record };
    });
    current.credentials.verify.mockImplementation(() => {
      throw new ApplicationError('CHECKOUT_QUOTE_EXPIRED', 'expired');
    });

    await expect(current.service.createOrder(
      session,
      input,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({ order_id: ORDER_ID, server_time: NOW.toISOString() });

    expect(current.sequence).toEqual(['claim', 'getReplay', 'assertHashOnlyReplay']);
    expect(current.orders.getOwnedOrderForReplayInTransaction).toHaveBeenCalledWith(current.transaction, {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
    });
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: ORDER_ID,
      responseForHash: { order_created: { order_id: ORDER_ID, order_no: `QX${ORDER_ID}` } },
      responseStatus: 201,
      storage: 'HASH_ONLY',
    });
    expect(current.credentials.verify).not.toHaveBeenCalled();
    expect(current.credentials.authenticate).not.toHaveBeenCalled();
    expect(current.orders.createOrderInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('rolls back side-effect metadata when the current quote no longer matches', async () => {
    const current = harness();
    current.credentials.verify.mockImplementationOnce(() => {
      throw new ApplicationError('CHECKOUT_REQUOTE_REQUIRED', 'facts changed');
    });

    await expect(current.service.createOrder(
      session,
      input,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).rejects.toMatchObject({ code: 'CHECKOUT_REQUOTE_REQUIRED' });

    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('projects only the current customer list and resolves current public image keys', async () => {
    const current = harness();
    const query: StoreOrderListQuery = {
      createdAtFrom: new Date('2026-08-24T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
      displayGroup: 'PENDING_PAYMENT',
      minAmount: '19.90',
      page: 2,
      pageSize: 20,
      sort: 'CREATED_DESC',
    };

    await expect(current.service.listOrders(session, query)).resolves.toEqual({
      items: [expect.objectContaining({
        aftersale_summary: {
          active_count: 0,
          latest_aftersale_id: null,
          latest_status: null,
          refunded_amount: '0.00',
        },
        available_actions: ['PAY', 'CANCEL'],
        display_status: '待付款',
        items: [expect.objectContaining({
          order_item_id: ORDER_ITEM_ID,
          primary_image_url: `https://assets.example.test/public/${FILE_ID}`,
          product_id: PRODUCT_ID,
          sku_id: SKU_ID,
        })],
        order_id: ORDER_ID,
      })],
      pagination: { page: 2, page_size: 20, total: 1 },
    });

    expect(current.database.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(current.orders.listOwnedOrdersInTransaction).toHaveBeenCalledWith(current.transaction, {
      customerId: CUSTOMER_ID,
      ...query,
    });
    expect(current.fulfillment.listOwnedFulfillmentProjectionsInTransaction).toHaveBeenCalledWith(
      current.transaction,
      { customerId: CUSTOMER_ID, orderIds: [ORDER_ID] },
    );
    expect(current.storage.publicUrl).toHaveBeenCalledOnce();
    expect(current.storage.publicUrl).toHaveBeenCalledWith(`public/${FILE_ID}`);
  });

  it('projects current fulfillment actions in the order list and fails closed on a missing projection', async () => {
    const current = harness();
    const query: StoreOrderListQuery = {
      displayGroup: 'ALL',
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    };
    current.fulfillment.listOwnedFulfillmentProjectionsInTransaction.mockResolvedValueOnce(new Map([
      [ORDER_ID, fulfillmentProjection({ canViewLogistics: true })],
    ]));

    await expect(current.service.listOrders(session, query)).resolves.toMatchObject({
      items: [{ available_actions: ['PAY', 'CANCEL', 'VIEW_LOGISTICS'], order_id: ORDER_ID }],
    });

    current.fulfillment.listOwnedFulfillmentProjectionsInTransaction.mockResolvedValueOnce(new Map());
    await expect(current.service.listOrders(session, query)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });

  it('returns only the owned detail projection and decrypts the frozen address through key rotation', async () => {
    const current = harness();

    await expect(current.service.getOrder(session, ORDER_ID)).resolves.toMatchObject({
      aftersales: [],
      available_actions: ['PAY', 'CANCEL'],
      errors: [],
      order_id: ORDER_ID,
      packages: [],
      payment_attempts: [],
      refund_attempts: [],
      shipping_address: {
        city: 'Auckland',
        detail: DETAIL,
        district: 'Central',
        phone: PHONE,
        province: 'Auckland',
        recipient_name: RECIPIENT,
      },
      timeline: [{
        axis: 'ORDER',
        event: 'ORDER_CREATED',
        event_id: `${ORDER_ID}:created`,
        from_status: null,
        occurred_at: NOW.toISOString(),
        to_status: 'PENDING_PAYMENT',
      }],
      version: 1,
    });

    expect(current.database.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(current.orders.getOwnedOrderDetailInTransaction).toHaveBeenCalledWith(current.transaction, {
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
    });
    expect(current.fulfillment.getOwnedFulfillmentProjectionInTransaction).toHaveBeenCalledWith(
      current.transaction,
      { customerId: CUSTOMER_ID, orderId: ORDER_ID },
    );
  });

  it('returns the owned logistics projection with a nullable shipment and stable event order', async () => {
    const current = harness();
    const occurredAt = new Date('2026-08-28T02:00:00.000Z');
    const shippedAt = new Date('2026-08-28T01:00:00.000Z');
    current.fulfillment.getOwnedFulfillmentProjection.mockResolvedValueOnce(fulfillmentProjection({
      canViewLogistics: true,
      fulfillmentStatus: 'IN_TRANSIT',
      orderStatus: 'SHIPPING',
      paymentStatus: 'PAID',
      shipment: {
        carrierCode: 'DEV',
        carrierName: 'Development Carrier',
        createdAt: shippedAt,
        deliveredAt: null,
        events: [{
          actorAccountId: ACCOUNT_ID,
          carrierCode: null,
          carrierName: null,
          createdAt: occurredAt,
          description: 'In transit',
          eventId: LOGISTICS_EVENT_ID,
          eventKey: 'event-key-digest',
          eventType: 'STATUS',
          location: null,
          occurredAt,
          reason: null,
          source: 'ADMIN_MANUAL',
          statusCode: 'IN_TRANSIT',
          trackingNo: null,
        }],
        items: [{
          orderItemId: ORDER_ITEM_ID,
          productName: 'Daily cleanser',
          quantity: 2,
          shipmentItemId: SHIPMENT_ITEM_ID,
          skuId: SKU_ID,
          skuName: '120 ml',
        }],
        orderId: ORDER_ID,
        shipmentId: SHIPMENT_ID,
        shippedAt,
        status: 'IN_TRANSIT',
        trackingNo: 'DEV-TRACK-1',
        updatedAt: occurredAt,
        version: 2,
      },
    }));

    await expect(current.service.getLogistics(session, ORDER_ID)).resolves.toEqual({
      events: [{
        carrier_code: null,
        carrier_name: null,
        description: 'In transit',
        event_id: LOGISTICS_EVENT_ID,
        event_key: 'event-key-digest',
        event_type: 'STATUS',
        location: null,
        occurred_at: occurredAt.toISOString(),
        reason: null,
        status_code: 'IN_TRANSIT',
        tracking_no: null,
      }],
      shipment: {
        carrier_code: 'DEV',
        carrier_name: 'Development Carrier',
        delivered_at: null,
        items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
        order_id: ORDER_ID,
        shipment_id: SHIPMENT_ID,
        shipped_at: shippedAt.toISOString(),
        status: 'IN_TRANSIT',
        tracking_no: 'DEV-TRACK-1',
        version: 2,
      },
    });
    expect(current.fulfillment.getOwnedFulfillmentProjection).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
    });

    current.fulfillment.getOwnedFulfillmentProjection.mockResolvedValueOnce(fulfillmentProjection());
    await expect(current.service.getLogistics(session, ORDER_ID)).resolves.toEqual({
      events: [],
      shipment: null,
    });
  });

  it('fails closed with a generic error when the frozen address ciphertext is unreadable', async () => {
    const current = harness();
    const detail = detailSnapshot();
    detail.address.phoneCiphertext = Buffer.from(detail.address.phoneCiphertext);
    detail.address.phoneCiphertext[0] = (detail.address.phoneCiphertext[0] ?? 0) ^ 0xff;
    const ciphertext = Buffer.from(detail.address.phoneCiphertext).toString('base64');
    current.orders.getOwnedOrderDetailInTransaction.mockResolvedValueOnce(detail);

    const error = await current.service.getOrder(session, ORDER_ID).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ApplicationError);
    const response = (error as ApplicationError).toResponse(REQUEST_ID);
    expect(response).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: REQUEST_ID,
    });
    const serialized = JSON.stringify(response);
    for (const privateValue of [PHONE, DETAIL, RECIPIENT, ciphertext, 'cause']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('cancels once and records only closed status/version metadata in HASH_ONLY, audit and Outbox facts', async () => {
    const current = harness();

    await expect(current.service.cancelOrder(
      session,
      ORDER_ID,
      1,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({
      close_reason: 'USER_CANCELLED',
      display_status: '已关闭',
      order_id: ORDER_ID,
      order_status: 'CLOSED',
      server_time: '2026-08-28T00:10:00.000Z',
    });

    expect(current.sequence).toEqual(['claim', 'cancel', 'audit', 'outbox', 'complete']);
    expect(current.orders.cancelOwnedOrderInTransaction).toHaveBeenCalledWith(current.transaction, {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedVersion: 1,
      orderId: ORDER_ID,
    });
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'CANCEL',
      actorAccountId: ACCOUNT_ID,
      after: { status: 'CLOSED', version: 2 },
      before: { status: 'PENDING_PAYMENT', version: 1 },
      idempotencyKey: IDEMPOTENCY_KEY,
      objectId: ORDER_ID,
      requestId: REQUEST_ID,
    }));
    expect(current.outbox.append).toHaveBeenCalledWith(current.transaction, {
      aggregateId: ORDER_ID,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: {
        event_version: 1,
        resource_id: ORDER_ID,
        resource_type: 'order',
        resource_version: 2,
      },
    });
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        actorId: ACCOUNT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: {
          body: { expected_version: 1 },
          method: 'POST',
          pathParameters: { order_id: ORDER_ID },
          route: '/store/orders/{order_id}/cancel',
        },
      }),
      {
        resourceId: ORDER_ID,
        responseForHash: { order_closed: { order_id: ORDER_ID } },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      },
    );

    const persistedMetadata = JSON.stringify([
      current.audit.append.mock.calls,
      current.outbox.append.mock.calls,
      current.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    for (const privateValue of [PHONE, DETAIL, RECIPIENT]) {
      expect(persistedMetadata).not.toContain(privateValue);
    }
  });

  it('replays a complete cancellation before stale If-Match reaches the repository', async () => {
    const current = harness();
    const record = { resource_id: ORDER_ID, response_body: null, response_status: 200 };
    current.idempotency.claim.mockImplementationOnce(async () => {
      current.sequence.push('claim');
      return { kind: 'replay' as const, record };
    });
    current.orders.getOwnedOrderForReplayInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('getReplay');
      return closedOrder();
    });

    await expect(current.service.cancelOrder(
      session,
      ORDER_ID,
      1,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({ order_id: ORDER_ID, order_status: 'CLOSED' });

    expect(current.sequence).toEqual(['claim', 'getReplay', 'assertHashOnlyReplay']);
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: ORDER_ID,
      responseForHash: { order_closed: { order_id: ORDER_ID } },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(current.orders.cancelOwnedOrderInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('completes a new key for an already USER_CANCELLED order without duplicate close facts', async () => {
    const current = harness();
    current.orders.cancelOwnedOrderInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('cancel');
      return closeResult(false);
    });

    await expect(current.service.cancelOrder(
      session,
      ORDER_ID,
      2,
      '00000000-0000-4000-8000-000000000002',
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({ order_id: ORDER_ID, order_status: 'CLOSED' });

    expect(current.sequence).toEqual(['claim', 'cancel', 'complete']);
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.anything(),
      expect.objectContaining({ responseStatus: 200, storage: 'HASH_ONLY' }),
    );
  });

  it('does not append close metadata or complete idempotency when cancellation fails', async () => {
    const current = harness();
    current.orders.cancelOwnedOrderInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('cancel');
      throw new ApplicationError('ORDER_NOT_CANCELLABLE', 'not cancellable');
    });

    await expect(current.service.cancelOrder(
      session,
      ORDER_ID,
      1,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });

    expect(current.sequence).toEqual(['claim', 'cancel']);
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('leaves the idempotency fact incomplete when an in-transaction closed Outbox append fails', async () => {
    const current = harness();
    current.outbox.append.mockImplementationOnce(async () => {
      current.sequence.push('outbox');
      throw new Error('outbox unavailable');
    });

    await expect(current.service.cancelOrder(
      session,
      ORDER_ID,
      1,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).rejects.toThrow('outbox unavailable');

    expect(current.sequence).toEqual(['claim', 'cancel', 'audit', 'outbox']);
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.anything());
    expect(current.outbox.append).toHaveBeenCalledWith(current.transaction, expect.anything());
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });
});
