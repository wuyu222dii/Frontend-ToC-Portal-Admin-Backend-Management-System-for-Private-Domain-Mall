import { describe, expect, it } from 'vitest';

import { StoreAftersalePreviewCredential } from './store-aftersale-preview-credential';

const CUSTOMER_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const OTHER_SESSION_ID = '01J00000000000000000000003';
const ORDER_ID = '01J00000000000000000000004';
const ORDER_ITEM_ID = '01J00000000000000000000005';
const NOW = new Date('2026-09-01T00:00:00.000Z');
const PREVIEW_KEY = '11111111-1111-4111-8111-111111111111';
const CONFIRM_KEY = '22222222-2222-4222-8222-222222222222';
const OTHER_CONFIRM_KEY = '33333333-3333-4333-8333-333333333333';
const OLD_KEY = { id: 'aftersale-v1', key: Buffer.alloc(32, 41) };
const NEW_KEY = { id: 'aftersale-v2', key: Buffer.alloc(32, 42) };

const requestBinding = {
  evidence_file_ids: [] as string[],
  items: [{ order_item_id: ORDER_ITEM_ID, quantity: 2 }],
  order_id: ORDER_ID,
  reason_code: 'ITEM_DAMAGED',
  reason_text: null,
  type: 'REFUND_ONLY',
};
const factBinding = {
  evidence: [] as unknown[],
  items: [{
    allocated_amount: '39.80',
    aftersale_reserved_amount: '0.00',
    aftersale_reserved_qty: 0,
    order_item_id: ORDER_ITEM_ID,
    refunded_amount: '0.00',
    refunded_qty: 0,
    version: 3,
  }],
  order: { order_id: ORDER_ID, version: 4 },
};

function issueInput(overrides: Partial<Parameters<StoreAftersalePreviewCredential['issue']>[0]> = {}) {
  return {
    customerId: CUSTOMER_ID,
    facts: factBinding,
    previewIdempotencyKey: PREVIEW_KEY,
    request: requestBinding,
    sessionId: SESSION_ID,
    ...overrides,
  };
}

function verifier(
  credential: StoreAftersalePreviewCredential,
  issued: ReturnType<StoreAftersalePreviewCredential['issue']>,
  overrides: Partial<Parameters<StoreAftersalePreviewCredential['verify']>[0]> = {},
) {
  return {
    confirmationHash: issued.confirmationHash,
    confirmIdempotencyKey: CONFIRM_KEY,
    customerId: CUSTOMER_ID,
    facts: factBinding,
    previewToken: issued.previewToken,
    request: requestBinding,
    sessionId: SESSION_ID,
    ...overrides,
  };
}

describe('B12.1 StoreAftersalePreviewCredential', () => {
  it('issues a five-minute credential bound to request, facts and an irreversible preview-key digest', () => {
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(issueInput());
    const payload = JSON.parse(Buffer.from(issued.previewToken.split('.')[0]!, 'base64url').toString('utf8')) as {
      e: number;
      i: number;
      p: string;
    };

    expect(issued.issuedAt).toEqual(NOW);
    expect(issued.expiresAt.toISOString()).toBe('2026-09-01T00:05:00.000Z');
    expect(issued.previewToken.length).toBeGreaterThanOrEqual(16);
    expect(issued.previewToken.length).toBeLessThanOrEqual(512);
    expect(issued.confirmationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.e - payload.i).toBe(300);
    expect(payload.p).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.p).not.toContain(PREVIEW_KEY);
    expect(credential.verify(verifier(credential, issued))).toEqual({
      expiresAt: issued.expiresAt,
      keyId: OLD_KEY.id,
    });
  });

  it('authenticates signed identity and request before current facts are available', () => {
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(issueInput());
    const input = verifier(credential, issued);
    const authentication = {
      confirmationHash: input.confirmationHash,
      confirmIdempotencyKey: input.confirmIdempotencyKey,
      customerId: input.customerId,
      previewToken: input.previewToken,
      request: input.request,
      sessionId: input.sessionId,
    };

    expect(credential.authenticate(authentication)).toEqual({
      expiresAt: issued.expiresAt,
      keyId: OLD_KEY.id,
    });
  });

  it('rejects reuse of the PREVIEW Idempotency-Key, including different UUID casing', () => {
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(issueInput({ previewIdempotencyKey: PREVIEW_KEY.toUpperCase() }));

    expect(() => credential.verify(verifier(credential, issued, {
      confirmIdempotencyKey: PREVIEW_KEY,
    }))).toThrowError(expect.objectContaining({ code: 'AFTERSALE_PREVIEW_MISMATCH' }));
    expect(credential.verify(verifier(credential, issued, {
      confirmIdempotencyKey: OTHER_CONFIRM_KEY,
    }))).toMatchObject({ keyId: OLD_KEY.id });
  });

  it.each([
    ['token', { previewToken: 'x' }],
    ['signature', { mutateToken: true }],
    ['confirmation', { confirmationHash: '0'.repeat(64) }],
    ['request', { request: { ...requestBinding, reason_code: 'QUALITY_ISSUE' } }],
    ['customer', { customerId: '01J00000000000000000000006' }],
    ['session', { sessionId: OTHER_SESSION_ID }],
  ])('rejects %s tampering or cross-boundary reuse', (_label, mutation) => {
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(issueInput());
    const previewToken = 'mutateToken' in mutation
      ? `${issued.previewToken.slice(0, -1)}${issued.previewToken.endsWith('A') ? 'B' : 'A'}`
      : ('previewToken' in mutation ? mutation.previewToken : issued.previewToken);

    expect(() => credential.verify(verifier(credential, issued, {
      ...mutation,
      previewToken,
    }))).toThrowError(expect.objectContaining({ code: 'AFTERSALE_PREVIEW_MISMATCH' }));
  });

  it('requires a new preview when authenticated current facts drift', () => {
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = credential.issue(issueInput());

    expect(() => credential.verify(verifier(credential, issued, {
      facts: { ...factBinding, order: { order_id: ORDER_ID, version: 5 } },
    }))).toThrowError(expect.objectContaining({ code: 'AFTERSALE_REQUOTE_REQUIRED' }));
  });

  it('rejects the credential at its exact expiry boundary before comparing facts', () => {
    let now = NOW;
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => now },
    );
    const issued = credential.issue(issueInput());
    now = issued.expiresAt;

    expect(() => credential.verify(verifier(credential, issued, {
      facts: { ...factBinding, order: { order_id: ORDER_ID, version: 5 } },
    }))).toThrowError(expect.objectContaining({ code: 'AFTERSALE_PREVIEW_EXPIRED' }));
  });

  it('fails closed when issuance time is in the verifier future', () => {
    let now = NOW;
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => now },
    );
    const issued = credential.issue(issueInput());
    now = new Date(NOW.getTime() - 1_000);

    expect(() => credential.verify(verifier(credential, issued)))
      .toThrowError(expect.objectContaining({ code: 'AFTERSALE_PREVIEW_MISMATCH' }));
  });

  it('accepts a retained previous key and rejects the credential after key retirement', () => {
    const original = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    const issued = original.issue(issueInput());
    const input = verifier(original, issued);

    const rotated = new StoreAftersalePreviewCredential(
      { current: NEW_KEY, previous: [OLD_KEY] },
      { clock: () => NOW },
    );
    expect(rotated.verify(input)).toMatchObject({ keyId: OLD_KEY.id });

    const retired = new StoreAftersalePreviewCredential(
      { current: NEW_KEY, previous: [] },
      { clock: () => NOW },
    );
    expect(() => retired.verify(input))
      .toThrowError(expect.objectContaining({ code: 'AFTERSALE_PREVIEW_MISMATCH' }));
  });

  it('rejects malformed key material and invalid idempotency identifiers', () => {
    expect(() => new StoreAftersalePreviewCredential({
      current: { id: 'x', key: Buffer.alloc(32, 1) },
      previous: [],
    })).toThrowError(TypeError);
    const credential = new StoreAftersalePreviewCredential(
      { current: OLD_KEY, previous: [] },
      { clock: () => NOW },
    );
    expect(() => credential.issue(issueInput({ previewIdempotencyKey: 'preview-key' })))
      .toThrowError(TypeError);
    const issued = credential.issue(issueInput());
    expect(() => credential.verify(verifier(credential, issued, { confirmIdempotencyKey: 'confirm-key' })))
      .toThrowError(TypeError);
  });

  it('keeps the maximum configured key ID within the contract token limit', () => {
    const credential = new StoreAftersalePreviewCredential(
      { current: { id: 'k'.repeat(80), key: Buffer.alloc(32, 43) }, previous: [] },
      { clock: () => NOW },
    );
    expect(credential.issue(issueInput()).previewToken.length).toBeLessThanOrEqual(512);
  });
});
