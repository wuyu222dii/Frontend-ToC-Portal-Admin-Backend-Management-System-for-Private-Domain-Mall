import { describe, expect, it } from 'vitest';

import {
  assertNoAgentAuthBody,
  assertNoAgentAuthQuery,
  parseAgentChangePasswordBody,
  parseAgentLoginBody,
  parseAgentRefreshBody,
} from './agent-auth.dto';

describe('Agent auth request decoding', () => {
  it('strictly decodes bounded login, refresh and password-change bodies', () => {
    expect(parseAgentLoginBody({ login_name: 'Agent.Operator', password: 'temporary-password' }))
      .toEqual({ loginName: 'agent.operator', password: 'temporary-password' });
    expect(parseAgentLoginBody({ login_name: '代理.Operator', password: 'temporary-password' }))
      .toEqual({ loginName: '代理.operator', password: 'temporary-password' });
    expect(parseAgentLoginBody({ login_name: '\u{1F642}'.repeat(80), password: 'temporary-password' }))
      .toEqual({ loginName: '\u{1F642}'.repeat(80), password: 'temporary-password' });
    expect(parseAgentRefreshBody({ refresh_token: 'r'.repeat(32) }))
      .toEqual({ refreshToken: 'r'.repeat(32) });
    expect(parseAgentChangePasswordBody({
      current_password: 'temporary-password',
      new_password: 'new-secure-password',
    })).toEqual({ currentPassword: 'temporary-password', newPassword: 'new-secure-password' });
  });

  it.each([
    null,
    [],
    { login_name: 'agent.operator', password: 'password', extra: true },
    { login_name: 'a'.repeat(81), password: 'password' },
    { login_name: 'agent.operator', password: 'p'.repeat(129) },
  ])('rejects malformed or oversized login input without echoing secrets', (body) => {
    expect(() => parseAgentLoginBody(body)).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('bounds both current and new passwords before Argon2 work', () => {
    expect(() => parseAgentChangePasswordBody({
      current_password: 'c'.repeat(129),
      new_password: 'new-secure-password',
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => parseAgentChangePasswordBody({
      current_password: 'current-password',
      new_password: 'short',
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('rejects unknown query parameters and bodies on bodyless operations', () => {
    expect(() => assertNoAgentAuthQuery({})).not.toThrow();
    expect(() => assertNoAgentAuthQuery({ debug: '1' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => assertNoAgentAuthBody(undefined)).not.toThrow();
    expect(() => assertNoAgentAuthBody({})).not.toThrow();
    expect(() => assertNoAgentAuthBody({ reason: 'retry' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
