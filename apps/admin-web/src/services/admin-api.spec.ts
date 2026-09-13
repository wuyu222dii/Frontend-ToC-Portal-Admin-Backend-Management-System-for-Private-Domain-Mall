import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authSession } from '../stores/auth-session';
import type { AdminAuthSession } from '../types/auth';
import { AdminApiError, adminSessionRequest } from './admin-api';

const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const SESSION_A = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const SESSION_B = '01ARZ3NDEKTSV4RRFFQ69G5FAB';

function session(overrides: Partial<AdminAuthSession> = {}): AdminAuthSession {
  return {
    access_token: 'access-1',
    account_id: ACCOUNT,
    assurance: 'MFA',
    expires_at: '2026-09-13T06:00:00.000Z',
    mfa_required: false,
    refresh_token: 'refresh-1',
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: SESSION_A,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function ok(data: unknown): Response {
  return jsonResponse(200, {
    code: 'OK',
    data,
    message: 'success',
    request_id: '01ARZ3NDEKTSV4RRFFQ69G5FAR',
  });
}

function unauthorized(): Response {
  return jsonResponse(401, {
    code: 'AUTH_REQUIRED',
    message: 'access expired',
    request_id: '01ARZ3NDEKTSV4RRFFQ69G5FAQ',
  });
}

describe('admin session refresh', () => {
  beforeEach(() => {
    authSession.clearSession();
    authSession.acceptSession(session());
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    authSession.clearSession();
  });

  it('accepts a rotated session_id after access token expiry', async () => {
    const rotated = session({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      session_id: SESSION_B,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok(rotated))
      .mockResolvedValueOnce(ok({ product_id: 'p1' }));

    await expect(adminSessionRequest('/admin/products/p1')).resolves.toMatchObject({
      data: { product_id: 'p1' },
    });
    expect(authSession.state.session?.session_id).toBe(SESSION_B);
    expect(authSession.state.session?.access_token).toBe('access-2');
    expect(fetchMock.mock.calls.map((call) => {
      const input = call[0];
      return typeof input === 'string' ? input : input instanceof URL ? input.pathname : String(input);
    })).toEqual([
      '/api/v1/admin/products/p1',
      '/api/v1/admin/auth/refresh',
      '/api/v1/admin/products/p1',
    ]);
  });

  it('does not sign out when refresh returns the same session row', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok(session()));

    await expect(adminSessionRequest('/admin/products/p1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
    expect(authSession.state.session?.session_id).toBe(SESSION_A);
    expect(authSession.state.session?.access_token).toBe('access-1');
  });

  it('deduplicates concurrent refreshes and retries with the new access token', async () => {
    const rotated = session({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      session_id: SESSION_B,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok(rotated))
      .mockResolvedValueOnce(ok({ first: true }))
      .mockResolvedValueOnce(ok({ second: true }));

    const [first, second] = await Promise.all([
      adminSessionRequest('/admin/products/a'),
      adminSessionRequest('/admin/products/b'),
    ]);
    expect(first).toMatchObject({ data: { first: true } });
    expect(second).toMatchObject({ data: { second: true } });
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/admin/auth/refresh'))).toHaveLength(1);
    expect(authSession.state.session?.session_id).toBe(SESSION_B);
  });

  it('clears the session only when refresh itself is unauthorized', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized());

    await expect(adminSessionRequest('/admin/products/p1')).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      status: 401,
    });
    expect(authSession.state.session).toBeNull();
  });
});
