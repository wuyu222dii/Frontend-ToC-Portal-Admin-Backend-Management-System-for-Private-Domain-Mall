import { describe, expect, it } from 'vitest';

import {
  parseAdminAftersaleApproveBody,
  parseAdminAftersaleEmptyQuery,
  parseAdminAftersaleId,
  parseAdminAftersaleListQuery,
  parseAdminAftersaleRejectBody,
  parseAdminAftersaleRejectConfirmationBody,
  parseAdminContinueRefundBody,
  parseAdminRejectAfterReturnBody,
  parseAdminRejectAfterReturnConfirmationBody,
  parseAdminReturnAddressAction,
  parseAdminReturnAddressConfirmation,
  parseAdminReturnInspectionBody,
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

function inspectionLine(overrides: Record<string, unknown> = {}) {
  return {
    approved_refund_qty: 3,
    damaged_qty: 1,
    note: '  Checked package  ',
    order_item_id: ORDER_ID,
    received_qty: 3,
    restock_qty: 2,
    return_to_customer_qty: 0,
    scrap_qty: 0,
    ...overrides,
  };
}

describe('B12 Admin aftersales DTO boundary', () => {
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

  it('normalizes closed PASS and ABNORMAL return inspections into canonical order', () => {
    const earlierOrderItemId = AFTERSALE_ID;
    expect(parseAdminReturnInspectionBody({
      evidence_file_ids: [],
      items: [
        inspectionLine(),
        inspectionLine({
          approved_refund_qty: 1,
          damaged_qty: 0,
          note: '   ',
          order_item_id: earlierOrderItemId,
          received_qty: 1,
          restock_qty: 1,
          return_to_customer_qty: 0,
        }),
      ],
      result: 'PASS',
    })).toEqual({
      abnormalReason: null,
      evidenceFileIds: [],
      items: [
        {
          approvedRefundQuantity: 1,
          damagedQuantity: 0,
          note: null,
          orderItemId: earlierOrderItemId,
          receivedQuantity: 1,
          restockQuantity: 1,
          returnToCustomerQuantity: 0,
          scrapQuantity: 0,
        },
        {
          approvedRefundQuantity: 3,
          damagedQuantity: 1,
          note: 'Checked package',
          orderItemId: ORDER_ID,
          receivedQuantity: 3,
          restockQuantity: 2,
          returnToCustomerQuantity: 0,
          scrapQuantity: 0,
        },
      ],
      result: 'PASS',
    });
    expect(parseAdminReturnInspectionBody({
      abnormal_reason: '  Package was incomplete  ',
      evidence_file_ids: [CUSTOMER_ID, AFTERSALE_ID],
      items: [inspectionLine({
        approved_refund_qty: 2,
        damaged_qty: 0,
        restock_qty: 2,
        return_to_customer_qty: 1,
      })],
      result: 'ABNORMAL',
    })).toMatchObject({
      abnormalReason: 'Package was incomplete',
      evidenceFileIds: [AFTERSALE_ID, CUSTOMER_ID],
      result: 'ABNORMAL',
    });
  });

  it('parses the typed continue and reject-after-return request pair', () => {
    expect(parseAdminContinueRefundBody({
      reason: '  Continue with accepted units  ', resolution: 'CONTINUE_REFUND',
    })).toEqual({ reason: 'Continue with accepted units', resolution: 'CONTINUE_REFUND' });
    expect(parseAdminRejectAfterReturnBody({
      reason: '  Reject after sealed inspection  ', resolution: 'REJECT_AFTER_RETURN',
    })).toEqual({ reason: 'Reject after sealed inspection', resolution: 'REJECT_AFTER_RETURN' });
    expect(parseAdminRejectAfterReturnConfirmationBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
      reason: '  Reject after sealed inspection  ',
      resolution: 'REJECT_AFTER_RETURN',
    })).toEqual({
      confirmationHash: HASH,
      previewToken: TOKEN,
      reason: 'Reject after sealed inspection',
      resolution: 'REJECT_AFTER_RETURN',
    });
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
    () => parseAdminReturnInspectionBody({
      abnormal_reason: 'Missing', evidence_file_ids: [], items: [inspectionLine()], result: 'PASS',
    }),
    () => parseAdminReturnInspectionBody({
      evidence_file_ids: [], items: [inspectionLine()], result: 'ABNORMAL',
    }),
    () => parseAdminReturnInspectionBody({
      abnormal_reason: 'Missing', evidence_file_ids: [], items: [inspectionLine()], result: 'ABNORMAL',
    }),
    () => parseAdminReturnInspectionBody({
      evidence_file_ids: [], items: [inspectionLine(), inspectionLine()], result: 'PASS',
    }),
    () => parseAdminReturnInspectionBody({
      evidence_file_ids: [], items: [inspectionLine({ received_qty: 4 })], result: 'PASS',
    }),
    () => parseAdminReturnInspectionBody({
      evidence_file_ids: [], items: [inspectionLine({ approved_refund_qty: 100 })], result: 'PASS',
    }),
    () => parseAdminContinueRefundBody({ resolution: 'REJECT_AFTER_RETURN', reason: 'Wrong action' }),
    () => parseAdminRejectAfterReturnBody({
      evidence_file_ids: [], reason: 'Rejected', resolution: 'REJECT_AFTER_RETURN',
    }),
    () => parseAdminRejectAfterReturnConfirmationBody({
      reason: 'Rejected', resolution: 'REJECT_AFTER_RETURN',
    }),
    () => parseAdminAftersaleEmptyQuery({ extra: true }),
  ])('rejects an invalid or open request', (parse) => expectInvalid(parse));
});
