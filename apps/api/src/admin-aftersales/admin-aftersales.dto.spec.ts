import { describe, expect, it } from 'vitest';

import {
  parseAdminAftersaleApproveBody,
  parseAdminAftersaleEmptyQuery,
  parseAdminAftersaleId,
  parseAdminAftersaleListQuery,
  parseAdminAftersaleRejectBody,
  parseAdminAftersaleRejectConfirmationBody,
  parseAdminReturnAddressAction,
  parseAdminReturnAddressConfirmation,
} from './admin-aftersales.dto';

const AFTERSALE_ID = '01J00000000000000000000001';
const ORDER_ID = '01J00000000000000000000002';
const CUSTOMER_ID = '01J00000000000000000000003';
const TOKEN = 'p'.repeat(16);
const HASH = 'a'.repeat(64);

function address(overrides: Record<string, unknown> = {}) {
  return {
    city: '  Central  ',
    detail: '  Development return desk  ',
    district: '  Harbour  ',
    phone: '  +1 2-3  ',
    province: '  Auckland  ',
    reason: '  Update returns desk  ',
    recipient_name: '  Returns team  ',
    ...overrides,
  };
}

function expectInvalid(parser: () => unknown): void {
  expect(parser).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
}

describe('B12.2 Admin aftersales DTO boundary', () => {
  it('parses a closed list query and Shanghai calendar boundaries', () => {
    expect(parseAdminAftersaleListQuery({
      aftersale_no: '  AS-1  ',
      customer_id: CUSTOMER_ID,
      date_from: '2026-08-31',
      date_to: '2026-09-01',
      order_id: ORDER_ID,
      page: '2',
      page_size: '50',
      status: 'PENDING_REVIEW',
      type: 'RETURN_REFUND',
    })).toEqual({
      aftersaleNo: 'AS-1',
      createdAtFrom: new Date('2026-08-30T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-01T16:00:00.000Z'),
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      page: 2,
      pageSize: 50,
      status: 'PENDING_REVIEW',
      type: 'RETURN_REFUND',
    });
    expect(parseAdminAftersaleId(AFTERSALE_ID)).toBe(AFTERSALE_ID);
  });

  it('normalizes approve and exact reject preview/confirmation bodies', () => {
    expect(parseAdminAftersaleApproveBody({})).toEqual({ note: null });
    expect(parseAdminAftersaleApproveBody({ note: '  Accepted  ' })).toEqual({ note: 'Accepted' });
    expect(parseAdminAftersaleApproveBody({ note: 'A' })).toEqual({ note: 'A' });
    expect(parseAdminAftersaleRejectBody({ reason: '  Missing evidence  ' })).toEqual({
      reason: 'Missing evidence',
    });
    expect(parseAdminAftersaleRejectConfirmationBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
      reason: '  Missing evidence  ',
    })).toEqual({ confirmationHash: HASH, previewToken: TOKEN, reason: 'Missing evidence' });
  });

  it('normalizes contract-wide return-address phone characters and confirmation fields', () => {
    const parsed = {
      city: 'Central',
      detail: 'Development return desk',
      district: 'Harbour',
      phone: '+1 2-3',
      province: 'Auckland',
      reason: 'Update returns desk',
      recipientName: 'Returns team',
    };
    expect(parseAdminReturnAddressAction(address())).toEqual(parsed);
    expect(parseAdminReturnAddressConfirmation(address({
      confirmation_hash: HASH,
      preview_token: TOKEN,
    }))).toEqual({ ...parsed, confirmationHash: HASH, previewToken: TOKEN });
  });

  it.each([
    () => parseAdminAftersaleId('aftersale'),
    () => parseAdminAftersaleListQuery({ unknown: true }),
    () => parseAdminAftersaleListQuery({ page_size: '101' }),
    () => parseAdminAftersaleListQuery({ customer_id: 'customer' }),
    () => parseAdminAftersaleListQuery({ date_from: '2026-09-02', date_to: '2026-09-01' }),
    () => parseAdminAftersaleApproveBody({ note: 'bad\nnote' }),
    () => parseAdminAftersaleRejectBody({ reason: ' ' }),
    () => parseAdminAftersaleRejectConfirmationBody({
      confirmation_hash: 'A'.repeat(64), preview_token: TOKEN, reason: 'Rejected',
    }),
    () => parseAdminReturnAddressAction(address({ phone: '12345' })),
    () => parseAdminReturnAddressAction(address({ detail: 'bad\ndetail' })),
    () => parseAdminReturnAddressAction(address({ extra: true })),
    () => parseAdminAftersaleEmptyQuery({ extra: true }),
  ])('rejects an invalid or open request', (parse) => expectInvalid(parse));
});
