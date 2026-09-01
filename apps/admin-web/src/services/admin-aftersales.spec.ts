import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decodeAdminAftersaleCommandResponse,
  decodeAdminAftersaleDetailResponse,
  decodeAdminAftersaleListResponse,
  decodeHighRiskPreviewResponse,
  decodeManualCompensationResponse,
  decodeRefundResponse,
  decodeReturnAddressResponse,
} from './admin-aftersales-decoders';
import type { HighRiskPreview } from './admin-aftersales-types';

const adminSessionRequest = vi.hoisted(() => vi.fn());
vi.mock('./admin-api', () => ({
  adminSessionRequest,
  newIdempotencyKey: () => 'generated-idempotency-key',
}));

import {
  approveAdminAftersale,
  buildAdminAftersaleListPath,
  confirmAdminAftersaleRefund,
  confirmAdminAftersaleRejection,
  confirmAdminManualCompensation,
  confirmAdminRefundRetry,
  continueAdminRefundAfterReturn,
  getAdminAftersale,
  listAdminAftersales,
  previewAdminAftersaleRejection,
  recordAdminReturnInspection,
} from './admin-aftersales';
import { getAdminFileDownloadUrl } from './admin-files';
import {
  confirmAdminReturnAddress,
  getAdminReturnAddress,
  previewAdminReturnAddress,
} from './admin-settings';

const aftersaleId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const orderId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const customerId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const agentId = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const aftersaleItemId = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const orderItemId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const refundId = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const compensationId = '01ARZ3NDEKTSV4RRFFQ69G5FB2';
const fileId = '01ARZ3NDEKTSV4RRFFQ69G5FB3';
const versionId = '01ARZ3NDEKTSV4RRFFQ69G5FB4';
const requestId = 'req_admin_aftersales';
const idempotencyKey = '00000000-0000-4000-8000-000000000001';

function envelope(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

const listItem = {
  aftersale_id: aftersaleId,
  aftersale_no: `AS${aftersaleId}`,
  agent_id: agentId,
  created_at: '2026-09-01T02:00:00.000Z',
  customer_alias: 'Development customer',
  customer_id: customerId,
  order_id: orderId,
  requested_amount: '9.00',
  status: 'PENDING_REVIEW',
  type: 'REFUND_ONLY',
  version: 4,
} as const;

const command = {
  aftersale_id: aftersaleId,
  aftersale_no: `AS${aftersaleId}`,
  inspection: null,
  items: [{
    aftersale_item_id: aftersaleItemId,
    allocated_amount: '9.00',
    approved_refund_qty: null,
    order_item_id: orderItemId,
    quantity: 1,
    reserved_amount: '9.00',
    reserved_quantity: 1,
  }],
  order_id: orderId,
  refund_id: null,
  status: 'PENDING_REVIEW',
  type: 'REFUND_ONLY',
  version: 4,
} as const;

const detail = {
  aftersale_id: aftersaleId,
  aftersale_no: `AS${aftersaleId}`,
  application_evidence_file_ids: [fileId],
  available_actions: ['APPROVE', 'REJECT', 'VIEW_ORDER'],
  commission_impact: [],
  created_at: '2026-09-01T02:00:00.000Z',
  customer: {
    customer_alias: 'Development customer',
    customer_id: customerId,
    nickname_masked: 'D***',
    phone_masked: '[masked phone]',
  },
  errors: [],
  inspection: null,
  inventory_impact: [],
  items: [{
    aftersale_item_id: aftersaleItemId,
    allocated_amount: '9.00',
    approved_refund_quantity: null,
    order_item_id: orderItemId,
    product_name: 'Development product',
    refunded_quantity: 0,
    requested_quantity: 1,
    reserved_amount: '9.00',
    reserved_quantity: 1,
    sku_name: 'Standard',
  }],
  order: {
    order_id: orderId,
    order_no: `QX${orderId}`,
    state: {
      close_reason: null,
      completion_reason: null,
      display_status: '待审核',
      fulfillment_status: 'READY_TO_SHIP',
      order_status: 'PENDING_SHIPMENT',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
    },
  },
  reason: 'Development reason',
  refund_attempts: [],
  return_address_snapshot: null,
  return_shipment: null,
  status: 'PENDING_REVIEW',
  timeline: [],
  type: 'REFUND_ONLY',
  version: 4,
} as const;

const preview: HighRiskPreview = {
  confirmation_hash: 'a'.repeat(64),
  expires_at: '2026-09-01T02:01:00.000Z',
  impact: {
    affected_count: 1,
    metrics: [{ after: 'REJECTED', before: 'PENDING_REVIEW', key: 'status', label: 'Status' }],
    warnings: ['Reservations will be released'],
  },
  preview_token: 'pvw_development_token',
  resource_etag: '"4"',
};

const refund = {
  amount: '9.00',
  items: [{
    aftersale_item_id: aftersaleItemId,
    order_item_id: orderItemId,
    quantity: 1,
    server_allocated_amount: '9.00',
  }],
  origin_type: 'AFTERSALE',
  refund_id: refundId,
  refund_no: `RF${refundId}`,
  status: 'PENDING',
} as const;

const compensation = {
  amount: '1.00',
  commission_reversal: '0.00',
  compensation_id: compensationId,
  compensation_no: `CP${compensationId}`,
  order_id: orderId,
  order_item_id: orderItemId,
  origin_type: 'MANUAL_COMPENSATION',
  refunded_amount: '0.00',
  refund_id: refundId,
  refund_no: `RF${refundId}`,
  reserved_amount: '1.00',
  status: 'PENDING',
  version: 1,
} as const;

const returnAddress = {
  city: 'Development city',
  detail_masked: 'Development ***',
  district: 'Development district',
  effective_at: '2026-09-01T02:00:00.000Z',
  phone_masked: '[masked phone]',
  province: 'Development province',
  recipient_name: 'Development recipient',
  version: 2,
  version_id: versionId,
  version_no: 2,
} as const;

const passInspection = {
  abnormal_reason: null,
  evidence_file_ids: [],
  inspected_at: '2026-09-01T02:00:00.000Z',
  inspected_by: { account_id: customerId, display_name: 'Development reviewer' },
  inspection_id: versionId,
  items: [{
    approved_refund_qty: 1,
    damaged_qty: 0,
    order_item_id: orderItemId,
    received_qty: 1,
    restock_qty: 1,
    return_to_customer_qty: 0,
    scrap_qty: 0,
  }],
  resolution: null,
  resolution_reason: null,
  resolved_at: null,
  result: 'PASS',
} as const;

beforeEach(() => adminSessionRequest.mockReset());

describe('B12.5 strict Admin aftersale decoders', () => {
  it('decodes exact list/detail/command projections', () => {
    expect(decodeAdminAftersaleListResponse(envelope({
      items: [listItem], pagination: { page: 1, page_size: 20, total: 1 },
    }))).toEqual({ items: [listItem], pagination: { page: 1, pageSize: 20, total: 1 } });
    expect(decodeAdminAftersaleDetailResponse(envelope(detail), aftersaleId)).toEqual(detail);
    expect(decodeAdminAftersaleCommandResponse(envelope(command), aftersaleId)).toEqual(command);
  });

  it('rejects undeclared fields, duplicate identifiers, bad money, bad timestamps and target swaps', () => {
    expect(() => decodeAdminAftersaleListResponse(envelope({
      items: [{ ...listItem, requested_amount: '9' }],
      pagination: { page: 1, page_size: 20, total: 1 },
    }))).toThrow('requested_amount');
    expect(() => decodeAdminAftersaleListResponse(envelope({
      items: [listItem, listItem], pagination: { page: 1, page_size: 20, total: 2 },
    }))).toThrow('response.data.items');
    expect(() => decodeAdminAftersaleDetailResponse(envelope({ ...detail, leaked_phone: '[forbidden]' }))).toThrow(
      'response.data',
    );
    expect(() => decodeAdminAftersaleDetailResponse(envelope({
      ...detail, application_evidence_file_ids: [fileId, fileId],
    }))).toThrow('application_evidence_file_ids');
    expect(() => decodeAdminAftersaleDetailResponse(envelope({
      ...detail, created_at: '2026-02-30T02:00:00Z',
    }))).toThrow('created_at');
    expect(() => decodeAdminAftersaleDetailResponse(envelope(detail), orderId)).toThrow('aftersale_id');
    expect(() => decodeAdminAftersaleDetailResponse(envelope({
      ...detail,
      inspection: {
        ...passInspection,
        resolution: 'CONTINUE_REFUND',
        resolution_reason: 'PASS 不允许异常处置',
        resolved_at: '2026-09-01T02:01:00.000Z',
      },
    }))).toThrow('response.data.inspection.resolution');
    expect(() => decodeAdminAftersaleDetailResponse(envelope({
      ...detail,
      inspection: {
        ...passInspection,
        abnormal_reason: 'Development exception',
        resolution: 'CONTINUE_REFUND',
        result: 'ABNORMAL',
      },
    }))).toThrow('response.data.inspection.resolution');
    expect(() => decodeAdminAftersaleCommandResponse(envelope({
      ...command,
      inspection: {
        ...passInspection,
        resolution: 'REJECT_AFTER_RETURN',
        resolution_reason: 'PASS 不允许拒绝退款',
        resolved_at: '2026-09-01T02:01:00.000Z',
      },
    }))).toThrow('response.data.inspection.resolution');
    expect(() => decodeAdminAftersaleCommandResponse(envelope({
      ...command,
      inspection: { ...passInspection, abnormal_reason: 'PASS 不应包含异常原因' },
    }))).toThrow('response.data.inspection.abnormal_reason');
    expect(() => decodeAdminAftersaleCommandResponse(envelope({
      ...command,
      inspection: { ...passInspection, abnormal_reason: null, result: 'ABNORMAL' },
    }))).toThrow('response.data.inspection.abnormal_reason');
  });

  it('decodes high-risk, refund, compensation and return-address responses exactly', () => {
    expect(decodeHighRiskPreviewResponse(envelope(preview))).toEqual(preview);
    expect(decodeRefundResponse(envelope(refund), refundId)).toEqual(refund);
    expect(decodeManualCompensationResponse(envelope(compensation), orderId, refundId)).toEqual(compensation);
    expect(decodeReturnAddressResponse(envelope(returnAddress))).toEqual(returnAddress);

    expect(() => decodeHighRiskPreviewResponse(envelope({
      ...preview,
      impact: { ...preview.impact, metrics: [preview.impact.metrics[0], preview.impact.metrics[0]] },
    }))).toThrow('metrics');
    expect(() => decodeHighRiskPreviewResponse(envelope({ ...preview, resource_etag: '4' }))).toThrow('resource_etag');
    expect(() => decodeRefundResponse(envelope(refund), undefined, [{
      aftersale_item_id: orderItemId,
      quantity: 1,
    }])).toThrow('response.data.items');
    expect(() => decodeManualCompensationResponse(
      envelope(compensation), orderId, refundId, aftersaleItemId, '1.00',
    )).toThrow('response.data.order_item_id');
    expect(() => decodeReturnAddressResponse(envelope({ ...returnAddress, version: 3 }))).toThrow('version');
  });
});

describe('B12.5 Admin aftersale clients', () => {
  it('builds the frozen list query and decodes list/detail responses', async () => {
    expect(buildAdminAftersaleListPath({
      aftersaleNo: 'AS-DEV', customerId, orderId, page: 2, pageSize: 10,
      status: 'PENDING_REVIEW', type: 'RETURN_REFUND',
    })).toBe(
      `/admin/aftersales?page=2&page_size=10&aftersale_no=AS-DEV&order_id=${orderId}` +
      `&status=PENDING_REVIEW&type=RETURN_REFUND&customer_id=${customerId}`,
    );
    adminSessionRequest.mockResolvedValueOnce(envelope({
      items: [listItem], pagination: { page: 1, page_size: 20, total: 1 },
    }));
    await expect(listAdminAftersales()).resolves.toMatchObject({ pagination: { total: 1 } });
    expect(adminSessionRequest).toHaveBeenLastCalledWith('/admin/aftersales', { expectedStatus: 200, signal: undefined });

    adminSessionRequest.mockResolvedValueOnce(envelope(detail));
    await expect(getAdminAftersale(aftersaleId)).resolves.toMatchObject({ aftersale_id: aftersaleId });
    expect(adminSessionRequest).toHaveBeenLastCalledWith(`/admin/aftersales/${aftersaleId}`, {
      expectedStatus: 200, signal: undefined,
    });
  });

  it('sends review and inspection commands with explicit status, idempotency and version facts', async () => {
    adminSessionRequest.mockResolvedValue(envelope(command));
    await approveAdminAftersale(aftersaleId, { note: null }, 4, idempotencyKey);
    expect(adminSessionRequest).toHaveBeenLastCalledWith(`/admin/aftersales/${aftersaleId}/approve`, {
      body: { note: null }, expectedStatus: 200, idempotencyKey, ifMatch: '"4"', method: 'POST', signal: undefined,
    });

    adminSessionRequest.mockResolvedValueOnce(envelope(preview));
    const rejectionPreview = await previewAdminAftersaleRejection(
      aftersaleId, { reason: 'Development rejection' }, idempotencyKey,
    );
    adminSessionRequest.mockResolvedValueOnce(envelope(command));
    await confirmAdminAftersaleRejection(
      aftersaleId, { reason: 'Development rejection' }, rejectionPreview, idempotencyKey,
    );
    expect(adminSessionRequest).toHaveBeenLastCalledWith(`/admin/aftersales/${aftersaleId}/reject`, {
      body: {
        confirmation_hash: preview.confirmation_hash,
        preview_token: preview.preview_token,
        reason: 'Development rejection',
      },
      expectedStatus: 200, idempotencyKey, ifMatch: '"4"', method: 'POST', signal: undefined,
    });

    await recordAdminReturnInspection(aftersaleId, {
      evidence_file_ids: [],
      items: [{
        approved_refund_qty: 1,
        damaged_qty: 0,
        order_item_id: orderItemId,
        received_qty: 1,
        restock_qty: 1,
        return_to_customer_qty: 0,
        scrap_qty: 0,
      }],
      result: 'PASS',
    }, 4, idempotencyKey);
    expect(adminSessionRequest.mock.calls.at(-1)?.[1]).toMatchObject({
      expectedStatus: 200, idempotencyKey, ifMatch: '"4"', method: 'POST',
    });

    await continueAdminRefundAfterReturn(
      aftersaleId, { reason: 'Development continue', resolution: 'CONTINUE_REFUND' }, 4, idempotencyKey,
    );
    expect(adminSessionRequest.mock.calls.at(-1)?.[0]).toContain('/return-resolution/continue-refund');
  });

  it('binds refund and compensation confirms to the preview ETag and exact success status', async () => {
    adminSessionRequest.mockResolvedValueOnce(envelope(refund));
    await confirmAdminAftersaleRefund(
      aftersaleId,
      { items: [{ aftersale_item_id: aftersaleItemId, quantity: 1 }], reason: 'Development refund' },
      preview,
      idempotencyKey,
    );
    expect(adminSessionRequest.mock.calls.at(-1)?.[1]).toMatchObject({
      expectedStatus: 200, idempotencyKey, ifMatch: '"4"', method: 'POST',
    });

    adminSessionRequest.mockResolvedValueOnce(envelope(refund));
    await confirmAdminRefundRetry(refundId, { reason: 'Development retry' }, preview, idempotencyKey);
    expect(adminSessionRequest.mock.calls.at(-1)?.[0]).toBe(`/admin/refunds/${refundId}/retry`);

    adminSessionRequest.mockResolvedValueOnce(envelope(compensation));
    await confirmAdminManualCompensation(
      orderId,
      { amount: '1.00', order_item_id: orderItemId, reason: 'Development compensation' },
      preview,
      idempotencyKey,
    );
    expect(adminSessionRequest.mock.calls.at(-1)?.[1]).toMatchObject({
      expectedStatus: 201, idempotencyKey, ifMatch: '"4"', method: 'POST',
    });
  });

  it('uses preview-confirm for the return address and safely decodes ephemeral evidence URLs', async () => {
    const addressInput = {
      city: 'Development city', detail: 'Development detail', district: 'Development district',
      phone: '[development phone]', province: 'Development province', reason: 'Development publish',
      recipient_name: 'Development recipient',
    };
    adminSessionRequest.mockResolvedValueOnce(envelope(returnAddress));
    await expect(getAdminReturnAddress()).resolves.toEqual(returnAddress);
    adminSessionRequest.mockResolvedValueOnce(envelope(preview));
    const addressPreview = await previewAdminReturnAddress(addressInput, idempotencyKey);
    adminSessionRequest.mockResolvedValueOnce(envelope(returnAddress));
    await confirmAdminReturnAddress(addressInput, addressPreview, idempotencyKey);
    expect(adminSessionRequest).toHaveBeenLastCalledWith('/admin/settings/return-address', {
      body: { ...addressInput, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
      expectedStatus: 200, idempotencyKey, ifMatch: '"4"', method: 'PATCH', signal: undefined,
    });

    adminSessionRequest.mockResolvedValueOnce(envelope({
      download_url: 'https://storage.example.test/private/evidence',
      expires_at: '2026-09-01T02:05:00.000Z',
      file_id: fileId,
    }));
    await expect(getAdminFileDownloadUrl(fileId)).resolves.toEqual({
      download_url: 'https://storage.example.test/private/evidence',
      expires_at: '2026-09-01T02:05:00.000Z',
      file_id: fileId,
    });

    adminSessionRequest.mockResolvedValueOnce(envelope({
      download_url: 'http://storage.example.test/private/evidence',
      expires_at: '2026-09-01T02:05:00.000Z',
      file_id: fileId,
    }));
    await expect(getAdminFileDownloadUrl(fileId)).rejects.toThrow('download_url');

    adminSessionRequest.mockResolvedValueOnce(envelope({
      download_url: 'https://storage.example.test/private/evidence',
      expires_at: '2026-02-30T02:05:00.000Z',
      file_id: fileId,
    }));
    await expect(getAdminFileDownloadUrl(fileId)).rejects.toThrow('response.data');
  });
});
