import { describe, expect, it } from 'vitest';

import {
  parseAdminAftersaleRefundBody,
  parseAdminAftersaleRefundConfirmationBody,
  parseAdminManualCompensationBody,
  parseAdminManualCompensationConfirmationBody,
  parseAdminRefundAftersaleId,
  parseAdminRefundEmptyQuery,
  parseAdminRefundId,
  parseAdminRefundOrderId,
  parseAdminRefundRetryBody,
  parseAdminRefundRetryConfirmationBody,
} from './admin-refunds.dto';

const AFTERSALE_ID = '01J00000000000000000000001';
const REFUND_ID = '01J00000000000000000000002';
const ORDER_ID = '01J00000000000000000000003';
const EARLIER_ITEM_ID = '01J00000000000000000000004';
const LATER_ITEM_ID = '01J00000000000000000000005';
const TOKEN = 'p'.repeat(16);
const HASH = 'a'.repeat(64);

function expectInvalid(parser: () => unknown): void {
  expect(parser).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
}

function refundBody(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { aftersale_item_id: LATER_ITEM_ID, quantity: 2 },
      { aftersale_item_id: EARLIER_ITEM_ID, quantity: 1 },
    ],
    reason: '  Approved refund  ',
    ...overrides,
  };
}

function manualBody(overrides: Record<string, unknown> = {}) {
  return {
    amount: '10.01',
    order_item_id: EARLIER_ITEM_ID,
    reason: '  Approved compensation  ',
    ...overrides,
  };
}

describe('B12 Admin refunds DTO boundary', () => {
  it('validates all frozen ULID path parameters and the closed empty query', () => {
    expect(parseAdminRefundAftersaleId(AFTERSALE_ID)).toBe(AFTERSALE_ID);
    expect(parseAdminRefundId(REFUND_ID)).toBe(REFUND_ID);
    expect(parseAdminRefundOrderId(ORDER_ID)).toBe(ORDER_ID);
    expect(parseAdminRefundEmptyQuery({})).toBeUndefined();
    expectInvalid(() => parseAdminRefundAftersaleId('not-ulid'));
    expectInvalid(() => parseAdminRefundId('not-ulid'));
    expectInvalid(() => parseAdminRefundOrderId('not-ulid'));
    expectInvalid(() => parseAdminRefundEmptyQuery({ unexpected: 'value' }));
  });

  it('normalizes refund preview and confirmation into canonical item order', () => {
    const action = {
      items: [
        { aftersaleItemId: EARLIER_ITEM_ID, quantity: 1 },
        { aftersaleItemId: LATER_ITEM_ID, quantity: 2 },
      ],
      reason: 'Approved refund',
    };
    expect(parseAdminAftersaleRefundBody(refundBody())).toEqual(action);
    expect(parseAdminAftersaleRefundConfirmationBody(refundBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
    }))).toEqual({ ...action, confirmationHash: HASH, previewToken: TOKEN });
  });

  it('rejects malformed, duplicate, oversized, and open refund item bodies', () => {
    expectInvalid(() => parseAdminAftersaleRefundBody(refundBody({ extra: true })));
    expectInvalid(() => parseAdminAftersaleRefundBody(refundBody({ items: [] })));
    expectInvalid(() => parseAdminAftersaleRefundBody(refundBody({
      items: Array.from({ length: 101 }, (_, index) => ({
        aftersale_item_id: `${AFTERSALE_ID.slice(0, -2)}${String(index).padStart(2, '0')}`,
        quantity: 1,
      })),
    })));
    expectInvalid(() => parseAdminAftersaleRefundBody(refundBody({
      items: [
        { aftersale_item_id: EARLIER_ITEM_ID, quantity: 1 },
        { aftersale_item_id: EARLIER_ITEM_ID, quantity: 2 },
      ],
    })));
    for (const quantity of [0, 1.5, 100, '1']) {
      expectInvalid(() => parseAdminAftersaleRefundBody(refundBody({
        items: [{ aftersale_item_id: EARLIER_ITEM_ID, quantity }],
      })));
    }
    expectInvalid(() => parseAdminAftersaleRefundBody(refundBody({
      items: [{ aftersale_item_id: EARLIER_ITEM_ID, quantity: 1, extra: true }],
    })));
  });

  it('parses retry preview and confirmation without accepting extra fields', () => {
    expect(parseAdminRefundRetryBody({ reason: '  Retry provider refund  ' })).toEqual({
      reason: 'Retry provider refund',
    });
    expect(parseAdminRefundRetryConfirmationBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
      reason: '  Retry provider refund  ',
    })).toEqual({
      confirmationHash: HASH,
      previewToken: TOKEN,
      reason: 'Retry provider refund',
    });
    expectInvalid(() => parseAdminRefundRetryBody({ reason: 'Retry', extra: true }));
  });

  it('parses exact positive money for compensation preview and confirmation', () => {
    const action = {
      amount: '10.01',
      orderItemId: EARLIER_ITEM_ID,
      reason: 'Approved compensation',
    };
    expect(parseAdminManualCompensationBody(manualBody())).toEqual(action);
    expect(parseAdminManualCompensationConfirmationBody(manualBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
    }))).toEqual({ ...action, confirmationHash: HASH, previewToken: TOKEN });
    for (const amount of ['0.00', '00.01', '1', '1.0', '1.001', ' 1.00', 1]) {
      expectInvalid(() => parseAdminManualCompensationBody(manualBody({ amount })));
    }
  });

  it('rejects missing or malformed confirmation fields and invalid reason text', () => {
    expectInvalid(() => parseAdminAftersaleRefundConfirmationBody(refundBody()));
    expectInvalid(() => parseAdminRefundRetryConfirmationBody({
      confirmation_hash: 'A'.repeat(64),
      preview_token: TOKEN,
      reason: 'Retry refund',
    }));
    expectInvalid(() => parseAdminManualCompensationConfirmationBody(manualBody({
      confirmation_hash: HASH,
      preview_token: 'short',
    })));
    expectInvalid(() => parseAdminRefundRetryBody({ reason: 'x' }));
    expectInvalid(() => parseAdminRefundRetryBody({ reason: 'valid\ninvalid' }));
    expectInvalid(() => parseAdminRefundRetryBody({ reason: 'x'.repeat(501) }));
  });
});
