import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StoreCheckoutRepository } from './store-checkout.repository';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B9_STORE_CHECKOUT_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B9_STORE_CHECKOUT_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const transactionOptions = {
  isolationLevel: 'RepeatableRead' as const,
  maxWait: 15_000,
  timeout: 60_000,
};
const rollbackSentinel = Object.freeze({ code: 'B9_STORE_CHECKOUT_ROLLBACK_SENTINEL' });

interface FixtureIds {
  accountId: string;
  addressId: string;
  balanceId: string;
  brandId: string;
  cartId: string;
  cartItemId: string;
  categoryId: string;
  customerId: string;
  fileId: string;
  imageId: string;
  inactiveSkuId: string;
  missingBalanceSkuId: string;
  productId: string;
  skuId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B9 Store checkout database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B9 Store checkout tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B9 Store checkout tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b91-store-checkout-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B9 Store checkout tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b91-store-checkout-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function createFixtureIds(): FixtureIds {
  return {
    accountId: generateUlid(),
    addressId: generateUlid(),
    balanceId: generateUlid(),
    brandId: generateUlid(),
    cartId: generateUlid(),
    cartItemId: generateUlid(),
    categoryId: generateUlid(),
    customerId: generateUlid(),
    fileId: generateUlid(),
    imageId: generateUlid(),
    inactiveSkuId: generateUlid(),
    missingBalanceSkuId: generateUlid(),
    productId: generateUlid(),
    skuId: generateUlid(),
  };
}

function transactionBoundRepository(transaction: DatabaseTransaction): StoreCheckoutRepository {
  const client = {
    $transaction: async (work: (nested: DatabaseTransaction) => unknown) => work(transaction),
  } as unknown as PrismaClient;
  return new StoreCheckoutRepository(client);
}

databaseDescribe('B9 Store checkout database integration', () => {
  let runtime: DatabaseRuntime;
  let now: Date;

  beforeAll(async () => {
    runtime = runtimeForMode();
    now = new Date();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function seedFixture(transaction: DatabaseTransaction, ids: FixtureIds): Promise<void> {
    await transaction.account.create({
      data: {
        created_at: now,
        id: ids.accountId,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
        wechat_open_id: `b91-openid-${ids.accountId}`,
      },
    });
    await transaction.customerProfile.create({
      data: {
        account_id: ids.accountId,
        created_at: now,
        id: ids.customerId,
        registered_at: now,
        updated_at: now,
      },
    });
    await transaction.customerAddress.create({
      data: {
        city: 'Auckland',
        created_at: now,
        customer_id: ids.customerId,
        detail_ciphertext: Buffer.from('b91-detail-ciphertext'),
        district: 'Central',
        encryption_key_id: 'b91-test-key',
        id: ids.addressId,
        is_default: true,
        phone_ciphertext: Buffer.from('b91-phone-ciphertext'),
        phone_hash: 'b'.repeat(64),
        phone_last4: '6789',
        province: 'Auckland',
        recipient_name: 'B9 Checkout Recipient',
        updated_at: now,
      },
    });
    await transaction.brand.create({
      data: {
        created_at: now,
        id: ids.brandId,
        name: `B91 Brand ${ids.brandId}`,
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    await transaction.category.create({
      data: {
        created_at: now,
        id: ids.categoryId,
        name: `B91 Category ${ids.categoryId}`,
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    await transaction.product.create({
      data: {
        brand_id: ids.brandId,
        category_id: ids.categoryId,
        created_at: now,
        id: ids.productId,
        name: `B91 Product ${ids.productId}`,
        published_at: now,
        spu_code: `B91-SPU-${ids.productId}`,
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    await transaction.fileAsset.create({
      data: {
        byte_size: 1_024n,
        created_at: now,
        id: ids.fileId,
        mime_type: 'image/png',
        object_key: `public/${ids.fileId}`,
        original_name: 'b91-product.png',
        purpose: 'PRODUCT_IMAGE',
        sha256: 'c'.repeat(64),
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    await transaction.productImage.create({
      data: {
        created_at: now,
        file_id: ids.fileId,
        id: ids.imageId,
        product_id: ids.productId,
        sort_order: 0,
      },
    });
    await transaction.sku.createMany({
      data: [
        {
          code: `B91-SKU-${ids.skuId}`,
          created_at: now,
          id: ids.skuId,
          name: 'B91 active SKU',
          product_id: ids.productId,
          retail_price: '12.50',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B91-SKU-${ids.inactiveSkuId}`,
          created_at: now,
          id: ids.inactiveSkuId,
          name: 'B91 inactive SKU',
          product_id: ids.productId,
          retail_price: '5.00',
          status: 'INACTIVE',
          updated_at: now,
        },
        {
          code: `B91-SKU-${ids.missingBalanceSkuId}`,
          created_at: now,
          id: ids.missingBalanceSkuId,
          name: 'B91 missing balance SKU',
          product_id: ids.productId,
          retail_price: '3.00',
          status: 'ACTIVE',
          updated_at: now,
        },
      ],
    });
    await transaction.inventoryBalance.create({
      data: {
        id: ids.balanceId,
        locked_qty: 2,
        physical_qty: 7,
        sku_id: ids.skuId,
        updated_at: now,
      },
    });
    await transaction.cart.create({
      data: { created_at: now, customer_id: ids.customerId, id: ids.cartId, updated_at: now },
    });
    await transaction.cartItem.create({
      data: {
        cart_id: ids.cartId,
        created_at: now,
        id: ids.cartItemId,
        quantity: 2,
        selected: true,
        sku_id: ids.skuId,
        updated_at: now,
      },
    });
  }

  async function assertFixtureFacts(checkout: StoreCheckoutRepository, ids: FixtureIds): Promise<void> {
    const cartQuote = await checkout.quote({
      accountId: ids.accountId,
      addressId: ids.addressId,
      customerId: ids.customerId,
      items: [{ quantity: 2, skuId: ids.skuId }],
      source: 'CART',
    });
    expect(cartQuote).toMatchObject({
      address: { addressId: ids.addressId, phoneLast4: '6789', version: 1 },
      blockers: [],
      canSubmit: true,
      goodsAmount: '25.00',
      items: [{ availableStock: 5, lineAmount: '25.00', saleable: true, unitPrice: '12.50' }],
    });
    expect(cartQuote.address).not.toHaveProperty('phone');
    expect(cartQuote.address).not.toHaveProperty('detail');
    expect(Buffer.from(cartQuote.address.phoneCiphertext).toString()).toBe('b91-phone-ciphertext');
    expect(Buffer.from(cartQuote.address.detailCiphertext).toString()).toBe('b91-detail-ciphertext');

    const changedCart = await checkout.quote({
      accountId: ids.accountId,
      addressId: ids.addressId,
      customerId: ids.customerId,
      items: [{ quantity: 1, skuId: ids.skuId }],
      source: 'CART',
    });
    expect(changedCart.blockers).toEqual(['CART_SELECTION_CHANGED']);

    const inactive = await checkout.quote({
      accountId: ids.accountId,
      addressId: ids.addressId,
      customerId: ids.customerId,
      items: [{ quantity: 1, skuId: ids.inactiveSkuId }],
      source: 'BUY_NOW',
    });
    expect(inactive.blockers).toContain('ITEM_UNAVAILABLE');

    const missingBalance = await checkout.quote({
      accountId: ids.accountId,
      addressId: ids.addressId,
      customerId: ids.customerId,
      items: [{ quantity: 1, skuId: ids.missingBalanceSkuId }],
      source: 'BUY_NOW',
    });
    expect(missingBalance).toMatchObject({
      blockers: ['INSUFFICIENT_STOCK'],
      items: [{ availableStock: 0, inventoryBalanceId: null, inventoryVersion: null, saleable: false }],
    });

    await expect(checkout.quote({
      accountId: ids.accountId,
      addressId: generateUlid(),
      customerId: ids.customerId,
      items: [{ quantity: 1, skuId: ids.skuId }],
      source: 'BUY_NOW',
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(checkout.quote({
      accountId: ids.accountId,
      addressId: ids.addressId,
      customerId: ids.customerId,
      items: [{ quantity: 1, skuId: generateUlid() }],
      source: 'BUY_NOW',
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  }

  async function assertNoFixtureFacts(ids: FixtureIds): Promise<void> {
    await expect(Promise.all([
      runtime.prisma.cartItem.count({ where: { id: ids.cartItemId } }),
      runtime.prisma.cart.count({ where: { id: ids.cartId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: ids.balanceId } }),
      runtime.prisma.sku.count({
        where: { id: { in: [ids.skuId, ids.inactiveSkuId, ids.missingBalanceSkuId] } },
      }),
      runtime.prisma.productImage.count({ where: { id: ids.imageId } }),
      runtime.prisma.fileAsset.count({ where: { id: ids.fileId } }),
      runtime.prisma.product.count({ where: { id: ids.productId } }),
      runtime.prisma.category.count({ where: { id: ids.categoryId } }),
      runtime.prisma.brand.count({ where: { id: ids.brandId } }),
      runtime.prisma.customerAddress.count({ where: { id: ids.addressId } }),
      runtime.prisma.customerProfile.count({ where: { id: ids.customerId } }),
      runtime.prisma.account.count({ where: { id: ids.accountId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }

  it('quotes CART and BUY_NOW from one snapshot and leaves no fixture facts after rollback', async () => {
    const ids = createFixtureIds();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedFixture(transaction, ids);
      await assertFixtureFacts(transactionBoundRepository(transaction), ids);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(ids);
  }, 90_000);
});
