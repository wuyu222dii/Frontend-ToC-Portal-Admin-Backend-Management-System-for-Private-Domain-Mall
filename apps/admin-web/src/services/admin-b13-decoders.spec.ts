import { describe, expect, it } from 'vitest';

import {
  decodeAdminAgentCreateResponse,
  decodeAdminAgentDetailResponse,
} from './admin-b13-decoders';

const AGENT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const INVITE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAB';
const FILE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAC';
const PROMOTION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAD';
const REQUEST_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAE';

function agent() {
  return {
    agent_id: AGENT_ID,
    agent_no: 'AGT-01ARZ3NDEKTSV4RRFFQ69G5FAA',
    name: '青序一级',
    contact_name: '张三',
    contact_phone_tail: '1234',
    status: 'ACTIVE',
    product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
    version: 1,
  };
}

function storefront() {
  return {
    promotion_asset_id: PROMOTION_ID,
    public_url: 'https://store.example/miniapp?invite=AGT-ABCDEFGHJKLMNPQR',
    qr_file: {
      file_id: FILE_ID,
      status: 'READY',
      visibility: 'PRIVATE',
      purpose: 'PROMOTION_QR',
    },
  };
}

function envelope(data: unknown) {
  return {
    code: 'OK',
    message: 'success',
    data,
    request_id: REQUEST_ID,
  };
}

describe('admin agent storefront disclosure', () => {
  it('accepts FIRST_ISSUE with an independent storefront QR', () => {
    const result = decodeAdminAgentCreateResponse(envelope({
      agent: agent(),
      temporary_password: 'TempPassword1!',
      expires_at: '2026-09-19T04:10:00.000Z',
      must_change_password: true,
      initial_invite_code: {
        invite_code_id: INVITE_ID,
        code: 'AGT-ABCDEFGHJKLMNPQR',
        status: 'ACTIVE',
        expires_at: null,
        version: 1,
      },
      storefront_promotion: storefront(),
      disclosure_state: 'FIRST_ISSUE',
      reissue_required: false,
    }));
    expect(result.disclosure_state).toBe('FIRST_ISSUE');
    expect(result.storefront_promotion).toEqual(storefront());
  });

  it('keeps replay redacted and rejects a second QR disclosure', () => {
    expect(decodeAdminAgentCreateResponse(envelope({
      agent: agent(),
      temporary_password: null,
      expires_at: null,
      must_change_password: true,
      initial_invite_code: null,
      storefront_promotion: null,
      disclosure_state: 'REPLAY_REDACTED',
      reissue_required: true,
    })).storefront_promotion).toBeNull();

    expect(() => decodeAdminAgentCreateResponse(envelope({
      agent: agent(),
      temporary_password: null,
      expires_at: null,
      must_change_password: true,
      initial_invite_code: null,
      storefront_promotion: storefront(),
      disclosure_state: 'REPLAY_REDACTED',
      reissue_required: true,
    }))).toThrow(TypeError);
  });

  it('accepts a downloadable storefront projection on agent detail', () => {
    const result = decodeAdminAgentDetailResponse(envelope({
      agent: agent(),
      invite_code: {
        invite_code_id: INVITE_ID,
        code_masked: 'AGT-****NPQR',
        status: 'ACTIVE',
        expires_at: null,
        version: 1,
      },
      storefront_promotion: storefront(),
      operating_summary: {
        net_sales_amount: '0.00',
        paid_order_count: 0,
        active_customer_count: 0,
        new_binding_count: 0,
      },
      wallet_summary: {
        expected_commission: '0.00',
        available_balance: '0.00',
        frozen_balance: '0.00',
        negative_balance: '0.00',
        version: 1,
      },
      withdrawal_summary: {
        pending_count: 0,
        approved_count: 0,
        paid_count: 0,
        total_paid_amount: '0.00',
        latest_withdrawal_at: null,
      },
    }), AGENT_ID);
    expect(result.storefront_promotion?.qr_file.file_id).toBe(FILE_ID);
  });
});
