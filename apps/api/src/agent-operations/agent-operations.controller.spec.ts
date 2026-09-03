import type { CurrentAgentSession } from '@qingxu/database';
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
    getCustomer: vi.fn(),
    getOrder: vi.fn(),
    listCustomers: vi.fn(),
    listOrders: vi.fn(),
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
    ]) expect(Reflect.getMetadata(NO_STORE_RESPONSE, handler)).toBe(true);
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
});
