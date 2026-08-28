import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  StoreCheckoutQuoteSnapshot,
  StoreOrderCreationResult,
  StoreOrderSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreAddressSecurityMaterial,
  verifyStoreOrderAddressSecurityMaterial,
} from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreOrderSubmitRequest } from './store-orders.dto';
import { StoreOrdersService } from './store-orders.service';

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
  const service = new StoreOrdersService();
  Object.assign(service, { audit, config, credentials, database, idempotency, orders, outbox });
  return {
    audit,
    credentials,
    database,
    get protectedAddress() { return protectedAddress; },
    idempotency,
    orders,
    outbox,
    sequence,
    service,
    snapshot,
    transaction,
  };
}

describe('B9.2 StoreOrdersService', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
