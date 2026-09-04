import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseAdminWithdrawalEmptyQuery,
  parseAdminWithdrawalId,
  parseAdminWithdrawalListQuery,
  parseWithdrawalApprovePreviewBody,
  parseWithdrawalConfirmationBody,
  parseWithdrawalMarkPaidBody,
  parseWithdrawalMarkPaidConfirmationBody,
  parseWithdrawalPayoutRevealBody,
  parseWithdrawalProofsBody,
  parseWithdrawalRejectBody,
  parseWithdrawalRejectConfirmationBody,
} from './admin-withdrawals.dto';

const FILE_ID = generateUlid();
const WITHDRAWAL_ID = generateUlid();
const HASH = 'a'.repeat(64);
const TOKEN = 'preview-token-with-sufficient-length';

function invalid(work: () => unknown): void {
  expect(work).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
}

describe('Admin withdrawal DTOs', () => {
  it('parses list filters with Shanghai date boundaries and exact decimal strings', () => {
    expect(parseAdminWithdrawalListQuery({
      agent_id: generateUlid(),
      date_from: '2026-09-03',
      date_to: '2026-09-04',
      max_amount: '9999999999999999.99',
      min_amount: '0.00',
      page: '2',
      page_size: '50',
      status: 'APPROVED',
      withdrawal_no: '  WD-20260904-1  ',
    })).toMatchObject({
      createdAtFrom: new Date('2026-09-02T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-04T16:00:00.000Z'),
      maxAmount: '9999999999999999.99',
      minAmount: '0.00',
      page: 2,
      pageSize: 50,
      status: 'APPROVED',
      withdrawalNo: 'WD-20260904-1',
    });
    expect(parseAdminWithdrawalListQuery({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('rejects unknown, inverted, malformed, and oversized list filters', () => {
    invalid(() => parseAdminWithdrawalListQuery({ debug: '1' }));
    invalid(() => parseAdminWithdrawalListQuery({ date_from: '2026-09-05', date_to: '2026-09-04' }));
    invalid(() => parseAdminWithdrawalListQuery({ min_amount: '10.01', max_amount: '10.00' }));
    invalid(() => parseAdminWithdrawalListQuery({ min_amount: '01.00' }));
    invalid(() => parseAdminWithdrawalListQuery({ max_amount: '10000000000000000.00' }));
    invalid(() => parseAdminWithdrawalListQuery({ page_size: '101' }));
    invalid(() => parseAdminWithdrawalListQuery({ status: 'CANCELLED' }));
    invalid(() => parseAdminWithdrawalListQuery({ withdrawal_no: 'x'.repeat(33) }));
  });

  it('parses ULIDs and requires empty query/body records', () => {
    expect(parseAdminWithdrawalId(WITHDRAWAL_ID)).toBe(WITHDRAWAL_ID);
    expect(parseWithdrawalApprovePreviewBody({})).toEqual({});
    expect(parseAdminWithdrawalEmptyQuery({})).toBeUndefined();
    invalid(() => parseAdminWithdrawalId('withdrawal-1'));
    invalid(() => parseWithdrawalApprovePreviewBody({ reason: 'not allowed' }));
    invalid(() => parseAdminWithdrawalEmptyQuery({ debug: '1' }));
  });

  it('strictly parses approve and reject preview-confirm bodies', () => {
    expect(parseWithdrawalConfirmationBody({ confirmation_hash: HASH, preview_token: TOKEN }))
      .toEqual({ confirmationHash: HASH, previewToken: TOKEN });
    expect(parseWithdrawalRejectBody({ reason: '  Invalid account details  ' }))
      .toEqual({ reason: 'Invalid account details' });
    expect(parseWithdrawalRejectConfirmationBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
      reason: 'Invalid account details',
    })).toEqual({ confirmationHash: HASH, previewToken: TOKEN, reason: 'Invalid account details' });
    invalid(() => parseWithdrawalConfirmationBody({ confirmation_hash: HASH.toUpperCase(), preview_token: TOKEN }));
    invalid(() => parseWithdrawalRejectBody({ reason: 'x', extra: true }));
  });

  it('strictly parses grants and unique proof file IDs without echoing rejected values', () => {
    expect(parseWithdrawalPayoutRevealBody({ reauth_grant: 'rag_0123456789abcdefghijklmnop' }))
      .toEqual({ reauthGrant: 'rag_0123456789abcdefghijklmnop' });
    expect(parseWithdrawalProofsBody({ file_ids: [FILE_ID] })).toEqual({ fileIds: [FILE_ID] });
    expect(parseWithdrawalMarkPaidBody({ proof_file_ids: [FILE_ID] })).toEqual({ proofFileIds: [FILE_ID] });
    expect(parseWithdrawalMarkPaidConfirmationBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
      proof_file_ids: [FILE_ID],
    })).toEqual({ confirmationHash: HASH, previewToken: TOKEN, proofFileIds: [FILE_ID] });
    invalid(() => parseWithdrawalProofsBody({ file_ids: [FILE_ID, FILE_ID] }));
    invalid(() => parseWithdrawalMarkPaidBody({ proof_file_ids: [] }));
    invalid(() => parseWithdrawalPayoutRevealBody({ reauth_grant: 'short', debug: true }));
  });
});
