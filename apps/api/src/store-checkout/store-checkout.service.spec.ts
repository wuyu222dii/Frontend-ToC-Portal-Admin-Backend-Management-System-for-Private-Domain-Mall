import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  StoreCheckoutQuoteSnapshot,
} from '@qingxu/database';
import { createStoreAddressSecurityMaterial } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreCheckoutService } from './store-checkout.service';

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
const PHONE = ['139', '0000', '6821'].join('');
const DETAIL = '23 Queen Street';
const NOW = new Date('2026-08-28T00:00:00.000Z');

const fieldKey = { id: 'field-v1', key: Buffer.alloc(32, 41) };
const phoneKey = { id: 'phone-v1', key: Buffer.alloc(32, 42) };
const idempotencyKey = { id: 'idempotency-v1', key: Buffer.alloc(32, 43) };
const config = {
  encryption: {
    fieldKeys: { current: fieldKey, previous: [] },
    idempotencyHashKeys: { current: idempotencyKey, previous: [] },
  },
  store: { phoneHashKeys: { current: phoneKey, previous: [] } },
} as unknown as PlatformRuntimeConfig;

const session: CurrentStoreSession = {
  accessJti: 'access:01J0000000000000000000000D',
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: '01J0000000000000000000000E',
  sessionId: SESSION_ID,
};

const request = {
  addressId: ADDRESS_ID,
  items: [{ quantity: 2, skuId: SKU_ID }],
  source: 'CART' as const,
};

function quoteSnapshot(): StoreCheckoutQuoteSnapshot {
  const protectedAddress = createStoreAddressSecurityMaterial(
    { addressId: ADDRESS_ID, detail: DETAIL, phone: PHONE },
    fieldKey,
    phoneKey,
  );
  return {
    address: {
      addressId: ADDRESS_ID,
      city: 'Auckland',
      customerId: CUSTOMER_ID,
      detailCiphertext: protectedAddress.detailCiphertext,
      district: 'Central',
      encryptionKeyId: protectedAddress.encryptionKeyId,
      isDefault: true,
      phoneCiphertext: protectedAddress.phoneCiphertext,
      phoneHash: protectedAddress.phoneHash,
      phoneLast4: protectedAddress.phoneLast4,
      province: 'Auckland',
      recipientName: 'Lin',
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
      brandVersion: 4,
      categoryId: CATEGORY_ID,
      categoryVersion: 5,
      inventoryBalanceId: INVENTORY_ID,
      inventoryVersion: 6,
      lineAmount: '39.80',
      primaryImageFileId: FILE_ID,
      primaryImageId: IMAGE_ID,
      primaryImageObjectKey: `public/${FILE_ID}`,
      productId: PRODUCT_ID,
      productName: 'Daily cleanser',
      productVersion: 7,
      quantity: 2,
      saleable: true,
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

function harness() {
  const snapshot = quoteSnapshot();
  const checkout = { quote: vi.fn().mockResolvedValue(snapshot) };
  const credentials = {
    issue: vi.fn().mockReturnValue({
      confirmationHash: 'a'.repeat(64),
      expiresAt: new Date('2026-08-28T00:05:00.000Z'),
      issuedAt: NOW,
      quoteToken: 'signed.quote-token',
    }),
  };
  const storage = {
    publicUrl: vi.fn((key: string) => `https://assets.example.test/${key}`),
  } as unknown as ObjectStoragePort;
  const service = new StoreCheckoutService();
  Object.assign(service, { checkout, config, credentials, storage });
  return { checkout, credentials, service, snapshot, storage };
}

describe('StoreCheckoutService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the protected quote projection and signs only non-PII versioned facts', async () => {
    const { checkout, credentials, service, storage } = harness();

    await expect(service.quote(session, request)).resolves.toMatchObject({
      address: {
        address_id: ADDRESS_ID,
        detail_masked: '23 ****',
        is_default: true,
        phone_masked: '139 **** 6821',
        recipient_name_masked: 'L**',
        version: 3,
      },
      blockers: [],
      can_submit: true,
      confirmation_hash: 'a'.repeat(64),
      expires_at: '2026-08-28T00:05:00.000Z',
      goods_amount: '39.80',
      items: [{
        primary_image_url: `https://assets.example.test/public/${FILE_ID}`,
        saleable: true,
        sku_id: SKU_ID,
      }],
      payable_amount: '39.80',
      quote_token: 'signed.quote-token',
      server_time: NOW.toISOString(),
      shipping_amount: '0.00',
      source: 'CART',
    });
    expect(checkout.quote).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      addressId: ADDRESS_ID,
      customerId: CUSTOMER_ID,
      items: request.items,
      source: 'CART',
    });
    expect(storage.publicUrl).toHaveBeenCalledWith(`public/${FILE_ID}`);
    expect(credentials.issue).toHaveBeenCalledWith(expect.objectContaining({
      customerId: CUSTOMER_ID,
      quoteId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      request: {
        address_id: ADDRESS_ID,
        items: [{ quantity: 2, sku_id: SKU_ID }],
        source: 'CART',
      },
      sessionId: SESSION_ID,
    }));
    const serializedFacts = JSON.stringify(credentials.issue.mock.calls[0]?.[0]?.facts);
    expect(serializedFacts).not.toContain('Lin');
    expect(serializedFacts).not.toContain(PHONE);
    expect(serializedFacts).not.toContain(DETAIL);
    expect(serializedFacts).not.toContain('Ciphertext');
    expect(serializedFacts).toContain('inventory_version');
    expect(serializedFacts).toContain('product_version');
  });

  it('returns known blockers as a 200-compatible projection without issuing a credential', async () => {
    const { checkout, credentials, service, snapshot } = harness();
    checkout.quote.mockResolvedValue({
      ...snapshot,
      blockers: ['INSUFFICIENT_STOCK'],
      canSubmit: false,
      items: snapshot.items.map((item) => ({ ...item, availableStock: 0, saleable: false })),
    });

    await expect(service.quote(session, request)).resolves.toMatchObject({
      blockers: ['INSUFFICIENT_STOCK'],
      can_submit: false,
      confirmation_hash: null,
      expires_at: null,
      quote_token: null,
    });
    expect(credentials.issue).not.toHaveBeenCalled();
  });

  it('fails closed when protected address material cannot be verified', async () => {
    const { checkout, service, snapshot } = harness();
    checkout.quote.mockResolvedValue({
      ...snapshot,
      address: { ...snapshot.address, phoneCiphertext: Buffer.from('invalid') },
    });

    await expect(service.quote(session, request))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('fails closed when a stored SKU specification violates the public contract', async () => {
    const { checkout, service, snapshot } = harness();
    checkout.quote.mockResolvedValue({
      ...snapshot,
      items: snapshot.items.map((item) => ({ ...item, specification: { attributes: [] } })),
    });

    await expect(service.quote(session, request))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('fails closed when repository blocker and cart facts disagree', async () => {
    const { checkout, credentials, service, snapshot } = harness();
    checkout.quote.mockResolvedValue({
      ...snapshot,
      blockers: [],
      canSubmit: true,
      cart: { ...snapshot.cart, selectionMatches: false },
    });

    await expect(service.quote(session, request))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(credentials.issue).not.toHaveBeenCalled();
  });
});
