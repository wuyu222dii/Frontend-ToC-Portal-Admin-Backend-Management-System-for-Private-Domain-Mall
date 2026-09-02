import { describe, expect, it, vi } from 'vitest';

import { PUBLIC_ROUTE } from '../platform/access/rbac.metadata';
import {
  AGENT_AUTHENTICATION_REALM,
  ALLOW_RESTRICTED_AGENT_SESSION,
} from '../platform/auth/agent-realm.metadata';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { AgentAuthController } from './agent-auth.controller';
import type { AgentAuthRequestContext } from './agent-auth.request';
import type { AgentAuthService } from './agent-auth.service';

const KEY = '018f47a2-9f61-7c4f-8b6e-9a61b3470f2e';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

function request(restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE' = 'NONE'): AgentAuthRequestContext {
  return {
    agentSession: {
      accountId: '01J00000000000000000000000',
      accountVersion: 3,
      accessJti: 'access:01J00000000000000000000003',
      agentId: '01J00000000000000000000001',
      agentName: 'Development Agent',
      agentNo: 'AGT-000001',
      agentStatus: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
      profileVersion: 2,
      restriction,
      rotationCounter: 0,
      sessionFamily: '01J00000000000000000000004',
      sessionId: '01J00000000000000000000002',
    },
    ip: '127.0.0.1',
    requestId: REQUEST_ID,
  };
}

function harness() {
  const service = {
    changePassword: vi.fn().mockReturnValue({}),
    changeTemporaryPassword: vi.fn().mockReturnValue({}),
    current: vi.fn().mockReturnValue({}),
    login: vi.fn().mockReturnValue({}),
    logout: vi.fn().mockReturnValue({}),
    logoutAll: vi.fn().mockReturnValue({}),
    refresh: vi.fn().mockReturnValue({}),
  };
  return {
    controller: new AgentAuthController(service as unknown as AgentAuthService),
    service,
  };
}

describe('AgentAuthController contract closure', () => {
  it('marks all seven successful responses no-store and only the two public endpoints public', () => {
    const prototype = AgentAuthController.prototype;
    for (const method of [
      prototype.login,
      prototype.refresh,
      prototype.logout,
      prototype.changeTemporaryPassword,
      prototype.changePassword,
      prototype.logoutAll,
      prototype.current,
    ]) {
      expect(Reflect.getMetadata(NO_STORE_RESPONSE, method)).toBe(true);
    }
    expect(Reflect.getMetadata(PUBLIC_ROUTE, prototype.login)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_ROUTE, prototype.refresh)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_ROUTE, prototype.logout)).toBeUndefined();
  });

  it('selects the Agent realm and allows restricted sessions only for logout and temporary password change', () => {
    const prototype = AgentAuthController.prototype;
    for (const method of [
      prototype.logout,
      prototype.changeTemporaryPassword,
      prototype.changePassword,
      prototype.logoutAll,
      prototype.current,
    ]) {
      expect(Reflect.getMetadata(AGENT_AUTHENTICATION_REALM, method)).toBe(true);
    }
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_AGENT_SESSION, prototype.logout)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_AGENT_SESSION, prototype.changeTemporaryPassword)).toBe(true);
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_AGENT_SESSION, prototype.changePassword)).toBeUndefined();
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_AGENT_SESSION, prototype.logoutAll)).toBeUndefined();
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_AGENT_SESSION, prototype.current)).toBeUndefined();
  });

  it('rejects unknown query parameters before service dispatch', () => {
    const { controller, service } = harness();
    expect(() => controller.login(
      { login_name: 'agent.operator', password: 'temporary-password' },
      { debug: '1' },
      KEY,
      request(),
    )).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(service.login).not.toHaveBeenCalled();
    expect(() => controller.current(undefined, { debug: '1' }, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(service.current).not.toHaveBeenCalled();
  });

  it('rejects non-empty bodies on logout, logout-all and current', () => {
    const { controller, service } = harness();
    expect(() => controller.logout({ extra: true }, {}, KEY, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => controller.logoutAll({ extra: true }, {}, KEY, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => controller.current({ extra: true }, {}, request()))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(service.logout).not.toHaveBeenCalled();
    expect(service.logoutAll).not.toHaveBeenCalled();
    expect(service.current).not.toHaveBeenCalled();
  });

  it('dispatches a restricted session only to logout and temporary password change', () => {
    const { controller, service } = harness();
    const restricted = request('CHANGE_PASSWORD_ONLY');
    controller.logout(undefined, {}, KEY, restricted);
    controller.changeTemporaryPassword({
      current_password: 'temporary-password',
      new_password: 'new-secure-password',
    }, KEY, {}, restricted);
    expect(service.logout).toHaveBeenCalledOnce();
    expect(service.changeTemporaryPassword).toHaveBeenCalledOnce();
    expect(() => controller.current(undefined, {}, restricted))
      .toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
  });
});
