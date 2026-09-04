import type { CurrentAgentSession } from '@qingxu/database';
import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentAuthRequestContext } from '../agent-auth/agent-auth.request';
import { AGENT_AUTHENTICATION_REALM } from '../platform/auth/agent-realm.metadata';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { AgentOperationsController } from './agent-operations.controller';
import type { AgentOperationsService } from './agent-operations.service';

function request(restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE' = 'NONE'): AgentAuthRequestContext {
  return {
    agentSession: {
      accountId: '01J00000000000000000000000',
      agentId: '01J00000000000000000000001',
      restriction,
    } as CurrentAgentSession,
  };
}

function harness() {
  const service = {
    createWithdrawal: vi.fn(),
    getCommission: vi.fn(),
    getCustomer: vi.fn(),
    getDashboard: vi.fn(),
    getOrder: vi.fn(),
    getWithdrawal: vi.fn(),
    getWallet: vi.fn(),
    listBankAccounts: vi.fn(),
    listCommissions: vi.fn(),
    listCustomers: vi.fn(),
    listOrders: vi.fn(),
    listWithdrawals: vi.fn(),
    replaceBankAccount: vi.fn(),
  };
  return {
    controller: new AgentOperationsController(service as unknown as AgentOperationsService),
    service,
  };
}

describe('AgentOperationsController', () => {
  it('uses the Agent realm and no-store policy for the whole read-only surface', () => {
    expect(Reflect.getMetadata(AGENT_AUTHENTICATION_REALM, AgentOperationsController)).toBe(true);
    for (const handler of [
      AgentOperationsController.prototype.listCustomers,
      AgentOperationsController.prototype.getCustomer,
      AgentOperationsController.prototype.listOrders,
      AgentOperationsController.prototype.getOrder,
      AgentOperationsController.prototype.getDashboard,
      AgentOperationsController.prototype.listCommissions,
      AgentOperationsController.prototype.getCommission,
      AgentOperationsController.prototype.getWallet,
      AgentOperationsController.prototype.listBankAccounts,
      AgentOperationsController.prototype.replaceBankAccount,
      AgentOperationsController.prototype.listWithdrawals,
      AgentOperationsController.prototype.createWithdrawal,
      AgentOperationsController.prototype.getWithdrawal,
    ]) expect(Reflect.getMetadata(NO_STORE_RESPONSE, handler)).toBe(true);
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      AgentOperationsController.prototype.replaceBankAccount,
    )).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      AgentOperationsController.prototype.createWithdrawal,
    )).toBe(HttpStatus.CREATED);
  });

  it('rejects restricted sessions and unknown detail query fields before dispatch', () => {
    const { controller, service } = harness();
    expect(() => controller.listCustomers({}, request('CHANGE_PASSWORD_ONLY')))
      .toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(() => controller.getOrder(
      '01J00000000000000000000002',
      { debug: '1' },
      request(),
    )).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(service.listCustomers).not.toHaveBeenCalled();
    expect(service.getOrder).not.toHaveBeenCalled();
  });

  it('requires unrestricted sessions and strictly decodes the new commission surface', () => {
    const { controller, service } = harness();
    expect(() => controller.getDashboard({}, request('CHANGE_PASSWORD_ONLY')))
      .toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(() => controller.getWallet({ agent_id: 'other-agent' }, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => controller.listCommissions({ ledger_type: 'WITHDRAWAL_PAID' }, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => controller.getCommission('other-agent-snapshot', {}, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(service.getDashboard).not.toHaveBeenCalled();
    expect(service.getWallet).not.toHaveBeenCalled();
    expect(service.listCommissions).not.toHaveBeenCalled();
    expect(service.getCommission).not.toHaveBeenCalled();
  });

  it('dispatches the selected dashboard period and defaults to seven days', () => {
    const { controller, service } = harness();
    const context = request();
    controller.getDashboard({}, context);
    controller.getDashboard({ days: '30' }, context);
    expect(service.getDashboard).toHaveBeenNthCalledWith(1, context.agentSession, { days: 7 });
    expect(service.getDashboard).toHaveBeenNthCalledWith(2, context.agentSession, { days: 30 });
    expect(() => controller.getDashboard({ days: '14' }, context))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('dispatches bank-account and withdrawal operations with strict decoded inputs', () => {
    const { controller, service } = harness();
    const bankAccountId = generateUlid();
    const withdrawalId = generateUlid();
    const key = '00000000-0000-4000-8000-000000000001';
    const context = request();

    controller.listBankAccounts({}, context);
    controller.replaceBankAccount({
      account_holder: '  Example Holder  ',
      account_number: '6222 0200-1234 5678',
      bank_name: '  Example Bank  ',
    }, {}, key, context);
    controller.listWithdrawals({ status: 'PENDING' }, context);
    controller.createWithdrawal({ amount: '100.00', bank_account_id: bankAccountId }, {}, key, context);
    controller.getWithdrawal(withdrawalId, {}, context);

    expect(service.listBankAccounts).toHaveBeenCalledWith(context.agentSession);
    expect(service.replaceBankAccount).toHaveBeenCalledWith(context, {
      accountHolder: 'Example Holder',
      accountNumber: '6222 0200-1234 5678',
      bankName: 'Example Bank',
    }, key);
    expect(service.listWithdrawals).toHaveBeenCalledWith(context.agentSession, {
      page: 1,
      pageSize: 20,
      status: 'PENDING',
    });
    expect(service.createWithdrawal).toHaveBeenCalledWith(context, {
      amount: '100.00',
      bankAccountId,
    }, key);
    expect(service.getWithdrawal).toHaveBeenCalledWith(context.agentSession, withdrawalId);
  });

  it('rejects restricted withdrawal access and malformed write requests before dispatch', () => {
    const { controller, service } = harness();
    const bankAccountId = generateUlid();
    expect(() => controller.listWithdrawals({}, request('CHANGE_PASSWORD_ONLY')))
      .toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(() => controller.createWithdrawal(
      { amount: '100.00', bank_account_id: bankAccountId },
      {},
      'key',
      request('CHANGE_PASSWORD_ONLY'),
    )).toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(() => controller.replaceBankAccount({
      account_holder: 'Example Holder',
      account_number: '62220200-secret',
      bank_name: 'Example Bank',
    }, {}, 'key', request())).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(service.listWithdrawals).not.toHaveBeenCalled();
    expect(service.createWithdrawal).not.toHaveBeenCalled();
    expect(service.replaceBankAccount).not.toHaveBeenCalled();
  });
});
