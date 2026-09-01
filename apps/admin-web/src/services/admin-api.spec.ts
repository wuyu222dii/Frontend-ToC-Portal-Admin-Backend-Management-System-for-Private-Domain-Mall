import { afterEach, describe, expect, it, vi } from 'vitest';

import { authSession } from '../stores/auth-session';
import type { AdminAuthSession } from '../types/auth';
import { adminApiRequest, adminSessionRequest } from './admin-api';

const sessionA: AdminAuthSession = {
  access_token: 'admin-a-access-token',
  refresh_token: 'admin-a-refresh-token',
  account_id: '01JADMINACCOUNT0000000000001',
  session_id: '01JADMINSESSION0000000000001',
  role: 'SUPER_ADMIN',
  mfa_required: false,
  assurance: 'MFA',
  restriction: 'NONE',
  expires_at: '2030-01-01T00:00:00.000Z',
};

const sessionB: AdminAuthSession = {
  ...sessionA,
  access_token: 'admin-b-access-token',
  refresh_token: 'admin-b-refresh-token',
  account_id: '01JADMINACCOUNT0000000000002',
  session_id: '01JADMINSESSION0000000000002',
};

const rotatedSessionA: AdminAuthSession = {
  ...sessionA,
  access_token: 'admin-a-rotated-access-token',
  refresh_token: 'admin-a-rotated-refresh-token',
};

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

afterEach(() => {
  authSession.clearSession();
  vi.unstubAllGlobals();
});

describe('Admin API exact success status', () => {
  it('fails closed when shipment creation returns 200 instead of the required 201', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 'OK',
      data: {},
      message: 'success',
      request_id: 'req_unexpected_success_status',
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })));

    const request = adminApiRequest('/admin/orders/01ARZ3NDEKTSV4RRFFQ69G5FAV/shipments', {
      expectedStatus: 201,
      method: 'POST',
    });

    await expect(request).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });

  it('does not replay an administrator request under a replacement login', async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      void input;
      void init;
      resolveRequest = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);
    authSession.acceptSession(sessionA);

    const request = adminSessionRequest('/admin/orders', {
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      method: 'POST',
    });
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(firstInit?.headers).get('Authorization')).toBe(`Bearer ${sessionA.access_token}`);

    authSession.clearSession();
    authSession.acceptSession(sessionB);
    if (!resolveRequest) throw new Error('The administrator request did not start');
    resolveRequest(jsonResponse(401, {
      code: 'AUTH_REQUIRED',
      message: 'expired',
      request_id: 'req_admin_a_expired',
    }));

    await expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED', status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authSession.state.session).toEqual(sessionB);
  });

  it('does not let a late A refresh failure affect a replacement B session', async () => {
    const pendingResponses: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Promise<Response>((resolve) => pendingResponses.push(resolve));
    });
    vi.stubGlobal('fetch', fetchMock);
    authSession.acceptSession(sessionA);

    const request = adminSessionRequest('/admin/orders');
    pendingResponses[0]?.(jsonResponse(401, {
      code: 'AUTH_REQUIRED',
      message: 'expired',
      request_id: 'req_admin_a_expired',
    }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const refreshInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(refreshInit?.body).toBe(JSON.stringify({ refresh_token: sessionA.refresh_token }));

    authSession.clearSession();
    authSession.acceptSession(sessionB);
    pendingResponses[1]?.(jsonResponse(401, {
      code: 'AUTH_REQUIRED',
      message: 'refresh expired',
      request_id: 'req_admin_a_refresh_expired',
    }));

    await expect(request).rejects.toMatchObject({ code: 'SESSION_CHANGED', status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authSession.state.session).toEqual(sessionB);
    expect(authSession.state.session).not.toEqual(rotatedSessionA);
  });
});
