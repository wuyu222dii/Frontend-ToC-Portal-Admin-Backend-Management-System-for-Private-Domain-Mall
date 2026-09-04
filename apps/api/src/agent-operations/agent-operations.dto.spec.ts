import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseAgentBankAccountWriteBody,
  parseAgentCommissionListQuery,
  parseAgentCreateWithdrawalBody,
  parseAgentCustomerListQuery,
  parseAgentOperationsResourceId,
  parseAgentOrderListQuery,
  parseAgentWithdrawalListQuery,
} from './agent-operations.dto';

describe('Agent operations DTO', () => {
  it('strictly parses customer pagination and Shanghai inclusive calendar dates', () => {
    expect(parseAgentCustomerListQuery({
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      keyword: '  customer_abc  ',
      page: '2',
      page_size: '50',
    })).toEqual({
      boundAtFrom: new Date('2026-08-31T16:00:00.000Z'),
      boundAtToExclusive: new Date('2026-09-03T16:00:00.000Z'),
      keyword: 'customer_abc',
      page: 2,
      pageSize: 50,
    });
    expect(() => parseAgentCustomerListQuery({ binding_status: 'ENDED' })).toThrow();
    expect(() => parseAgentCustomerListQuery({ date_from: '2026-09-04', date_to: '2026-09-03' })).toThrow();
  });

  it('parses all order filters without accepting unsupported state axes', () => {
    const customerId = generateUlid(new Date('2026-09-03T00:00:00.000Z').getTime());
    expect(parseAgentOrderListQuery({
      customer_id: customerId,
      fulfillment_status: 'SHIPPED',
      has_aftersale: 'false',
      max_amount: '99.90',
      min_amount: '10.00',
      order_status: 'SHIPPING',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    })).toMatchObject({
      customerId,
      fulfillmentStatus: 'SHIPPED',
      hasAftersale: false,
      maxAmount: '99.90',
      minAmount: '10.00',
      orderStatus: 'SHIPPING',
      page: 1,
      pageSize: 20,
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    });
    expect(() => parseAgentOrderListQuery({ payment_status: 'UNPAID' })).toThrow();
    expect(() => parseAgentOrderListQuery({ has_aftersale: '1' })).toThrow();
    expect(() => parseAgentOrderListQuery({ min_amount: '10.01', max_amount: '10.00' })).toThrow();
  });

  it('requires ULIDs for both resource paths', () => {
    const resourceId = generateUlid(new Date('2026-09-03T00:00:00.000Z').getTime());
    expect(parseAgentOperationsResourceId(resourceId, 'order_id')).toBe(resourceId);
    expect(() => parseAgentOperationsResourceId('other-agent-order', 'order_id')).toThrow();
  });

  it('strictly parses commission filters and Shanghai inclusive dates', () => {
    expect(parseAgentCommissionListQuery({
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      ledger_type: 'REFUND_DEBIT',
      order_no: '  QX-COMMISSION-1  ',
      page: '2',
      page_size: '40',
      state: 'AVAILABLE',
    })).toEqual({
      ledgerType: 'REFUND_DEBIT',
      occurredAtFrom: new Date('2026-08-31T16:00:00.000Z'),
      occurredAtToExclusive: new Date('2026-09-03T16:00:00.000Z'),
      orderNo: 'QX-COMMISSION-1',
      page: 2,
      pageSize: 40,
      state: 'AVAILABLE',
    });
    expect(() => parseAgentCommissionListQuery({ ledger_type: 'WITHDRAWAL_PAID' })).toThrow();
    expect(() => parseAgentCommissionListQuery({ agent_id: generateUlid() })).toThrow();
  });

  it('requires a ULID commission snapshot path value', () => {
    const snapshotId = generateUlid(new Date('2026-09-03T00:00:00.000Z').getTime());
    expect(parseAgentOperationsResourceId(snapshotId, 'commission_snapshot_id')).toBe(snapshotId);
    expect(() => parseAgentOperationsResourceId('another-agent-snapshot', 'commission_snapshot_id')).toThrow();
  });

  it('strictly parses bank-account writes without disclosing rejected account numbers', () => {
    expect(parseAgentBankAccountWriteBody({
      account_holder: '  Example Holder  ',
      account_number: '1234 5678-9012 3456',
      bank_name: '  Example Bank  ',
    })).toEqual({
      accountHolder: 'Example Holder',
      accountNumber: '1234 5678-9012 3456',
      bankName: 'Example Bank',
    });
    expect(() => parseAgentBankAccountWriteBody({
      account_holder: 'X',
      account_number: '1234567890123456',
      bank_name: 'Example Bank',
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => parseAgentBankAccountWriteBody({
      account_holder: 'Example Holder',
      account_number: '6222-0200-secret',
      bank_name: 'Example Bank',
    })).toThrow(expect.objectContaining({
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
    }));
    expect(() => parseAgentBankAccountWriteBody({
      account_holder: 'Example Holder',
      account_number: '1234567890123456',
      bank_name: 'Example Bank',
      plaintext_echo: true,
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('strictly parses positive withdrawal commands and ULID bank-account references', () => {
    const bankAccountId = generateUlid();
    expect(parseAgentCreateWithdrawalBody({ amount: '100.00', bank_account_id: bankAccountId }))
      .toEqual({ amount: '100.00', bankAccountId });
    for (const amount of ['0.00', '1.0', '01.00', '10000000000000000.00']) {
      expect(() => parseAgentCreateWithdrawalBody({ amount, bank_account_id: bankAccountId })).toThrow();
    }
    expect(() => parseAgentCreateWithdrawalBody({ amount: '1.00', bank_account_id: 'bank-1' })).toThrow();
    expect(() => parseAgentCreateWithdrawalBody({
      amount: '1.00',
      bank_account_id: bankAccountId,
      extra: true,
    })).toThrow();
  });

  it('strictly parses withdrawal filters with an inclusive Shanghai date_to', () => {
    expect(parseAgentWithdrawalListQuery({
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      max_amount: '999.00',
      min_amount: '100.00',
      page: '2',
      page_size: '50',
      status: 'APPROVED',
      withdrawal_no: '  WD-20260903-1  ',
    })).toEqual({
      createdAtFrom: new Date('2026-08-31T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-03T16:00:00.000Z'),
      maxAmount: '999.00',
      minAmount: '100.00',
      page: 2,
      pageSize: 50,
      status: 'APPROVED',
      withdrawalNo: 'WD-20260903-1',
    });
    expect(() => parseAgentWithdrawalListQuery({ date_from: '2026-09-04', date_to: '2026-09-03' })).toThrow();
    expect(() => parseAgentWithdrawalListQuery({ min_amount: '10.01', max_amount: '10.00' })).toThrow();
    expect(() => parseAgentWithdrawalListQuery({ status: 'CANCELLED' })).toThrow();
    expect(() => parseAgentWithdrawalListQuery({ withdrawal_no: 'x'.repeat(33) })).toThrow();
    expect(() => parseAgentWithdrawalListQuery({ agent_id: generateUlid() })).toThrow();

    const withdrawalId = generateUlid();
    expect(parseAgentOperationsResourceId(withdrawalId, 'withdrawal_id')).toBe(withdrawalId);
    expect(() => parseAgentOperationsResourceId('withdrawal-1', 'withdrawal_id')).toThrow();
  });
});
