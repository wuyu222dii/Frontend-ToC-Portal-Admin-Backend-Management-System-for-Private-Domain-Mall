import { describe, expect, it } from 'vitest';

import { StoreCheckoutQuoteCredential } from './store-checkout-quote-credential';

const CUSTOMER_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const OTHER_SESSION_ID = '01J00000000000000000000003';
const QUOTE_ID = '01J00000000000000000000004';
const NOW = new Date('2026-08-28T00:00:00.000Z');
const OLD_KEY = { id: 'checkout-v1', key: Buffer.alloc(32, 31) };
const NEW_KEY = { id: 'checkout-v2', key: Buffer.alloc(32, 32) };

const requestBinding = {
  address_id: '01J00000000000000000000005',
  items: [{ quantity: 2, sku_id: '01J00000000000000000000006' }],
  source: 'BUY_NOW',
};
const factBinding = {
  address: { address_id: requestBinding.address_id, version: 3 },
  items: [{ available_stock: 8, inventory_version: 4, sku_id: requestBinding.items[0]!.sku_id }],
  payable_amount: '39.80',
};

function input(overrides: Partial<Parameters<StoreCheckoutQuoteCredential['issue']>[0]> = {}) {
  return {
    customerId: CUSTOMER_ID,
    facts: factBinding,
    quoteId: QUOTE_ID,
    request: requestBinding,
    sessionId: SESSION_ID,
    ...overrides,
  };
}

describe('StoreCheckoutQuoteCredential', () => {
  it('issues a five-minute credential and verifies all bound facts', () => {
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(input());

    expect(issued.expiresAt.toISOString()).toBe('2026-08-28T00:05:00.000Z');
    expect(issued.issuedAt).toEqual(NOW);
    expect(issued.quoteToken.length).toBeGreaterThanOrEqual(32);
    expect(issued.quoteToken.length).toBeLessThanOrEqual(512);
    expect(issued.confirmationHash).toMatch(/^[a-f0-9]{64}$/);
    const payload = JSON.parse(Buffer.from(issued.quoteToken.split('.')[0]!, 'base64url').toString('utf8')) as {
      e: number;
      i: number;
    };
    expect(payload.i).toBe(Math.floor(NOW.getTime() / 1_000));
    expect(payload.e - payload.i).toBe(300);
    expect(credential.verify({
      ...input(),
      confirmationHash: issued.confirmationHash,
      quoteToken: issued.quoteToken,
    })).toEqual({
      expiresAt: issued.expiresAt,
      keyId: OLD_KEY.id,
      quoteId: QUOTE_ID,
    });
  });

  it.each([
    ['token', { quoteToken: 'x' }],
    ['signature', { mutateToken: true }],
    ['confirmation', { confirmationHash: '0'.repeat(64) }],
    ['request', { request: { ...requestBinding, source: 'CART' } }],
    ['quote', { quoteId: '01J00000000000000000000007' }],
    ['customer', { customerId: '01J00000000000000000000008' }],
    ['session', { sessionId: OTHER_SESSION_ID }],
  ])('rejects %s tampering or cross-boundary reuse', (_label, mutation) => {
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(input());
    const quoteToken = 'mutateToken' in mutation
      ? `${issued.quoteToken.slice(0, -1)}${issued.quoteToken.endsWith('A') ? 'B' : 'A'}`
      : ('quoteToken' in mutation ? mutation.quoteToken : issued.quoteToken);

    expect(() => credential.verify({
      ...input(),
      ...mutation,
      confirmationHash: 'confirmationHash' in mutation
        ? mutation.confirmationHash
        : issued.confirmationHash,
      quoteToken,
    })).toThrowError(expect.objectContaining({ code: 'CHECKOUT_QUOTE_MISMATCH' }));
  });

  it('requires a new quote when authenticated current facts have drifted', () => {
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(input());

    expect(() => credential.verify({
      ...input({ facts: { ...factBinding, payable_amount: '40.00' } }),
      confirmationHash: issued.confirmationHash,
      quoteToken: issued.quoteToken,
    })).toThrowError(expect.objectContaining({ code: 'CHECKOUT_REQUOTE_REQUIRED' }));
  });

  it('authenticates the signed request before current checkout facts are available', () => {
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(input());
    const authentication = {
      confirmationHash: issued.confirmationHash,
      customerId: CUSTOMER_ID,
      quoteId: QUOTE_ID,
      quoteToken: issued.quoteToken,
      request: requestBinding,
      sessionId: SESSION_ID,
    };

    expect(credential.authenticate(authentication)).toEqual({
      expiresAt: issued.expiresAt,
      keyId: OLD_KEY.id,
      quoteId: QUOTE_ID,
    });
    expect(() => credential.authenticate({
      ...authentication,
      request: { ...requestBinding, items: [{ ...requestBinding.items[0], quantity: 3 }] },
    })).toThrowError(expect.objectContaining({ code: 'CHECKOUT_QUOTE_MISMATCH' }));
  });

  it('rejects the credential at its exact expiry boundary', () => {
    let now = NOW;
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => now },
    );
    const issued = credential.issue(input());
    now = issued.expiresAt;

    expect(() => credential.verify({
      ...input(),
      confirmationHash: issued.confirmationHash,
      quoteToken: issued.quoteToken,
    })).toThrowError(expect.objectContaining({ code: 'CHECKOUT_QUOTE_EXPIRED' }));
  });

  it('reports expiry before comparing current facts', () => {
    let now = NOW;
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => now },
    );
    const issued = credential.issue(input());
    now = issued.expiresAt;

    expect(() => credential.verify({
      ...input({ facts: { ...factBinding, payable_amount: '40.00' } }),
      confirmationHash: issued.confirmationHash,
      quoteToken: issued.quoteToken,
    })).toThrowError(expect.objectContaining({ code: 'CHECKOUT_QUOTE_EXPIRED' }));
  });

  it('fails closed when the signed issuance time is in the verifier future', () => {
    let now = NOW;
    const credential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => now },
    );
    const issued = credential.issue(input());
    now = new Date(NOW.getTime() - 1_000);

    expect(() => credential.verify({
      ...input(),
      confirmationHash: issued.confirmationHash,
      quoteToken: issued.quoteToken,
    })).toThrowError(expect.objectContaining({ code: 'CHECKOUT_QUOTE_MISMATCH' }));
  });

  it('accepts a credential under a retained previous key and rejects it after retirement', () => {
    const oldCredential = new StoreCheckoutQuoteCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = oldCredential.issue(input());
    const verifyInput = {
      ...input(),
      confirmationHash: issued.confirmationHash,
      quoteToken: issued.quoteToken,
    };

    const rotated = new StoreCheckoutQuoteCredential(
      { current: NEW_KEY, previous: [OLD_KEY] },
      { clock: () => NOW },
    );
    expect(rotated.verify(verifyInput)).toMatchObject({ keyId: OLD_KEY.id });

    const retired = new StoreCheckoutQuoteCredential(
      { current: NEW_KEY, previous: [] },
      { clock: () => NOW },
    );
    expect(() => retired.verify(verifyInput))
      .toThrowError(expect.objectContaining({ code: 'CHECKOUT_QUOTE_MISMATCH' }));
  });

  it('keeps the maximum configured key ID within the contract token limit', () => {
    const credential = new StoreCheckoutQuoteCredential(
      { current: { id: 'k'.repeat(80), key: Buffer.alloc(32, 33) }, previous: [] },
      { clock: () => NOW },
    );
    expect(credential.issue(input()).quoteToken.length).toBeLessThanOrEqual(512);
  });
});
