import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decodeAdminAuditLogListResponse,
  decodeAdminBusinessRulesResponse,
  decodeAdminCustomerListResponse,
  decodeAdminHighRiskPreviewResponse,
  decodeAdminOrderCommissionExplanationResponse,
  decodeAdminWithdrawalResponse,
} from './admin-b13-decoders';

const adminSessionRequest = vi.hoisted(() => vi.fn());
vi.mock('./admin-api', () => ({ adminSessionRequest }));

import { confirmAdminCustomerTransfer } from './admin-customers';
import { updateAdminAgentProductAuthorization } from './admin-agents';
import {
  buildAdminCommissionRuleSkuListPath,
  buildAdminCommissionRuleVersionListPath,
  previewAdminCommissionRules,
} from './admin-commissions';
import { revealAdminPayoutAccount } from './admin-withdrawals';

const customerId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const agentId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const bindingId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const withdrawalId = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const accountId = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const auditId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const versionId = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const proofId = '01ARZ3NDEKTSV4RRFFQ69G5FB2';
const payoutAccountFixture = ['123', '456', '789'].join('');
const requestId = 'req_b13_admin';
const idempotencyKey = '00000000-0000-4000-8000-000000000001';

function envelope(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

const customer = {
  account_status: 'ACTIVE',
  binding: {
    agent_id: agentId,
    agent_name: 'Development agent',
    binding_id: bindingId,
    customer_id: customerId,
    customer_version: 3,
    started_at: '2026-09-01T00:00:00.000Z',
  },
  city: 'Development city',
  consumption_amount: '12.00',
  consumption_count: 2,
  customer_alias: 'Customer 001',
  customer_id: customerId,
  deletion_request_status: null,
  last_order_id: null,
  last_product_name: 'Development product',
  last_purchase_at: '2026-09-02T00:00:00.000Z',
  management_note_present: false,
  nickname_masked: 'D***',
  phone_masked: '138****0000',
  registered_at: '2026-09-01T00:00:00.000Z',
  version: 3,
} as const;

const preview = {
  confirmation_hash: 'a'.repeat(64),
  expires_at: '2026-09-04T00:01:00.000Z',
  impact: {
    affected_count: 1,
    metrics: [{ after: 'new', before: 'old', key: 'status', label: 'Status' }],
    warnings: [],
  },
  preview_token: 'preview-token',
  resource_etag: '"3"',
};

const withdrawal = {
  agent_id: agentId,
  agent_name: 'Development agent',
  agent_no: 'AG0001',
  amount: '10.00',
  created_at: '2026-09-03T00:00:00.000Z',
  paid_at: '2026-09-03T01:00:00.000Z',
  payout_account_snapshot: {
    account_holder_masked: 'D***',
    account_no_last4: '1234',
    account_number_masked: '******1234',
    bank_name: 'Development Bank',
    snapshot_at: '2026-09-03T00:00:00.000Z',
  },
  proof_file_ids: [proofId],
  request_balance_snapshot: {
    available_after: '90.00',
    available_before: '100.00',
    captured_at: '2026-09-03T00:00:00.000Z',
    frozen_after: '10.00',
    frozen_before: '0.00',
  },
  review_reason: null,
  reviewed_at: '2026-09-03T00:30:00.000Z',
  status: 'PAID',
  version: 4,
  withdrawal_id: withdrawalId,
  withdrawal_no: 'WD0001',
} as const;

beforeEach(() => adminSessionRequest.mockReset());

describe('B13.8 strict Admin finance decoders', () => {
  it('serializes only the commission filters declared by the contract', () => {
    expect(buildAdminCommissionRuleSkuListPath({ categoryId: agentId, source: 'SKU' }))
      .toBe(`/admin/commission-rules/skus?category_id=${agentId}&source=SKU`);
    expect(buildAdminCommissionRuleVersionListPath({ dateFrom: '2026-09-01', status: 'PUBLISHED' }))
      .toBe('/admin/commission-rule-versions?status=PUBLISHED&date_from=2026-09-01');
  });

  it('accepts exact customer data and rejects undeclared sensitive fields', () => {
    const data = { items: [customer], pagination: { page: 1, page_size: 20, total: 1 } };
    expect(decodeAdminCustomerListResponse(envelope(data))).toEqual(data);
    expect(() => decodeAdminCustomerListResponse(envelope({
      ...data,
      items: [{ ...customer, bank_account_number: 'not-allowed' }],
    }))).toThrow('response.data.items[0]');
  });

  it('permits the commission bootstrap ETag only on its explicit decoder branch', () => {
    const bootstrap = { ...preview, resource_etag: '"0"' };
    expect(decodeAdminHighRiskPreviewResponse(envelope(bootstrap), true)).toEqual(bootstrap);
    expect(() => decodeAdminHighRiskPreviewResponse(envelope(bootstrap))).toThrow('resource_etag');
    expect(() => decodeAdminHighRiskPreviewResponse(envelope({
      ...preview,
      expires_at: '2026-02-30T00:01:00.000Z',
    }))).toThrow('expires_at');
  });

  it('fails closed on leaked audit values and invalid PAID withdrawal evidence', () => {
    const audit = {
      action: 'UPDATE',
      actor_account_id: accountId,
      actor_role: 'SUPER_ADMIN',
      after_summary: [{ display_value: '发生变化', field: 'account_number', sensitive: true }],
      after_version: 2,
      audit_id: auditId,
      before_summary: [],
      before_version: 1,
      created_at: '2026-09-04T00:00:00.000Z',
      idempotency_key: idempotencyKey,
      ip_hash: 'hash_only_1234567',
      module: 'WITHDRAWAL',
      request_id: requestId,
      result: 'SUCCESS',
      result_code: 'OK',
      target_id: withdrawalId,
      target_type: 'WITHDRAWAL',
    } as const;
    expect(decodeAdminAuditLogListResponse(envelope({
      items: [audit], pagination: { page: 1, page_size: 20, total: 1 },
    })).items[0]).toEqual(audit);
    expect(decodeAdminAuditLogListResponse(envelope({
      items: [{ ...audit, actor_account_id: 'SYSTEM' }],
      pagination: { page: 1, page_size: 20, total: 1 },
    })).items[0]?.actor_account_id).toBe('SYSTEM');
    expect(() => decodeAdminAuditLogListResponse(envelope({
      items: [{ ...audit, actor_account_id: 'unknown' }],
      pagination: { page: 1, page_size: 20, total: 1 },
    }))).toThrow('actor_account_id');
    expect(() => decodeAdminAuditLogListResponse(envelope({
      items: [{
        ...audit,
        after_summary: [{ display_value: 'unsafe-plaintext', field: 'account_number', sensitive: true }],
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    }))).toThrow('display_value');
    expect(() => decodeAdminAuditLogListResponse(envelope({
      items: [{ ...audit, ip_hash: 'too-short' }],
      pagination: { page: 1, page_size: 20, total: 1 },
    }))).toThrow('ip_hash');
    expect(decodeAdminWithdrawalResponse(envelope(withdrawal), withdrawalId)).toEqual(withdrawal);
    expect(() => decodeAdminWithdrawalResponse(envelope({ ...withdrawal, proof_file_ids: [] }))).toThrow(
      'response.data',
    );
  });

  it('enforces immutable business-rule constants', () => {
    const rules = {
      aftersale_window_days: 7,
      effective_at: '2026-09-04T00:00:00.000Z',
      legal_record_retention_years: 7,
      minimum_withdrawal_amount: '100.00',
      order_payment_timeout_minutes: 30,
      version: 2,
      version_id: versionId,
      version_no: 2,
    } as const;
    expect(decodeAdminBusinessRulesResponse(envelope(rules))).toEqual(rules);
    expect(() => decodeAdminBusinessRulesResponse(envelope({
      ...rules, order_payment_timeout_minutes: 15,
    }))).toThrow('order_payment_timeout_minutes');
    expect(() => decodeAdminBusinessRulesResponse(envelope({
      ...rules, aftersale_window_days: 366,
    }))).toThrow('aftersale_window_days');
    expect(() => decodeAdminBusinessRulesResponse(envelope({
      ...rules, legal_record_retention_years: 101,
    }))).toThrow('legal_record_retention_years');
  });

  it('requires every order commission explanation to have a server hit path', () => {
    const item = {
      category_id: accountId,
      category_name: 'Development category',
      commission_base: '100.00',
      commission_snapshot_id: proofId,
      effective_rate: '5.0000',
      expected_remaining: '5.00',
      hit_path: ['Platform 5.0000%'],
      ledger: [],
      order_item_id: bindingId,
      original_commission: '5.00',
      position_state: 'EXPECTED',
      product_id: agentId,
      product_name: 'Development product',
      reversal_total: '0.00',
      rounding_mode: 'HALF_UP',
      rounding_scale: 2,
      rule_source: 'PLATFORM',
      rule_version_id: versionId,
      rule_version_no: 1,
      sku_id: withdrawalId,
      sku_name: 'Development SKU',
    } as const;
    const explanation = { items: [item], order_id: customerId, order_no: 'ORDER-001' };

    expect(decodeAdminOrderCommissionExplanationResponse(envelope(explanation), customerId)).toEqual(explanation);
    expect(() => decodeAdminOrderCommissionExplanationResponse(envelope({
      ...explanation,
      items: [{ ...item, hit_path: [] }],
    }), customerId)).toThrow('hit_path');
  });
});

describe('B13.8 Admin finance services', () => {
  it('allows a custom product authorization with an empty whitelist', async () => {
    const authorization = {
      agent_id: agentId,
      mode: 'CUSTOM_WHITELIST',
      product_ids: [],
      version: 2,
    } as const;
    adminSessionRequest.mockResolvedValueOnce(envelope(authorization));

    await expect(updateAdminAgentProductAuthorization(
      agentId,
      { mode: 'CUSTOM_WHITELIST', product_ids: [] },
      1,
      idempotencyKey,
    )).resolves.toEqual(authorization);
    expect(adminSessionRequest).toHaveBeenCalledWith(
      `/admin/agents/${agentId}/product-authorization`,
      expect.objectContaining({
        body: { mode: 'CUSTOM_WHITELIST', product_ids: [] },
        idempotencyKey,
        ifMatch: '"1"',
        method: 'PATCH',
      }),
    );
  });

  it('binds customer confirmation to the preview token, hash and ETag', async () => {
    adminSessionRequest.mockResolvedValueOnce(envelope(customer));
    await expect(confirmAdminCustomerTransfer(
      customerId,
      { reason: 'Development transfer', target_agent_id: agentId },
      preview,
      idempotencyKey,
    )).resolves.toEqual(customer);
    expect(adminSessionRequest).toHaveBeenCalledWith(
      `/admin/customers/${customerId}/attribution-transfers`,
      expect.objectContaining({
        body: {
          confirmation_hash: preview.confirmation_hash,
          preview_token: preview.preview_token,
          reason: 'Development transfer',
          target_agent_id: agentId,
        },
        idempotencyKey,
        ifMatch: '"3"',
        method: 'POST',
      }),
    );
  });

  it('uses the special commission preview decoder and explicit payout authorization headers', async () => {
    const bootstrap = { ...preview, resource_etag: '"0"' };
    adminSessionRequest.mockResolvedValueOnce(envelope(bootstrap));
    await expect(previewAdminCommissionRules({
      base_version_id: null,
      changes: [{ configured_rate: '10.0000', target_id: null, target_type: 'PLATFORM' }],
      reason: 'Initial rule',
    }, idempotencyKey)).resolves.toEqual(bootstrap);

    const reveal = {
      account_holder: 'Development Holder',
      account_number: payoutAccountFixture,
      bank_name: 'Development Bank',
      expires_at: '2026-09-04T00:01:00.000Z',
    };
    adminSessionRequest.mockResolvedValueOnce(envelope(reveal));
    await expect(revealAdminPayoutAccount(
      withdrawalId,
      'single-use-grant',
      4,
      idempotencyKey,
    )).resolves.toEqual(reveal);
    expect(adminSessionRequest).toHaveBeenLastCalledWith(
      `/admin/withdrawals/${withdrawalId}/payout-account-reveal`,
      expect.objectContaining({
        body: { reauth_grant: 'single-use-grant' },
        idempotencyKey,
        ifMatch: '"4"',
        method: 'POST',
      }),
    );
  });
});
