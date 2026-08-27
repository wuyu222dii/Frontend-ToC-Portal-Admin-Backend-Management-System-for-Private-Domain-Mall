import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerSession } from '../types/store-identity';
import { clearCandidateToken, peekCandidateToken } from '../utils/attribution-candidate';
import {
  clearCustomerSession,
  loadCustomerSession,
  saveCustomerSession,
} from '../utils/customer-session';
import {
  createIdempotencyKey,
  createAttributionCandidate,
  getAttributionCandidate,
  getCustomerProfile,
  loginWithWechat,
  updateCustomerProfile,
} from './store-identity';

const initialSession: CustomerSession = {
  access_token: 'initial-access-token-1234',
  refresh_token: 'initial-refresh-token-123',
  role: 'CUSTOMER',
  assurance: 'WECHAT',
  access_expires_at: '2030-01-01T00:00:00.000Z',
  refresh_expires_at: '2030-02-01T00:00:00.000Z',
};

const rotatedSession: CustomerSession = {
  ...initialSession,
  access_token: 'rotated-access-token-1234',
  refresh_token: 'rotated-refresh-token-123',
};

const newLoginSession: CustomerSession = {
  ...initialSession,
  access_token: 'new-login-access-token-123',
  refresh_token: 'new-login-refresh-token-12',
};

const candidate = {
  candidate_id: '01JTESTCANDIDATE0000000000',
  agent_id: '01JTESTAGENT00000000000000',
  display_name: '青序服务代理',
  confirmation_required: true as const,
  attribution_eligible: true as const,
  public_target_url: 'https://mall.example.test/products/one',
  expires_at: '2030-01-01T00:30:00.000Z',
  remaining_seconds: 1_800,
};

function response(data: unknown, requestId: string) {
  return {
    data: { code: 'OK', message: 'success', data, request_id: requestId },
    statusCode: 200,
    header: { 'Cache-Control': 'no-store, private' },
    cookies: [],
  };
}

function error(statusCode: number, code: string, requestId: string) {
  return {
    data: { code, message: code, request_id: requestId },
    statusCode,
    header: {},
    cookies: [],
  };
}

function environment() {
  const storage = new Map<string, unknown>();
  const requests: UniNamespace.RequestOptions[] = [];
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key),
    removeStorageSync: (key: string) => storage.delete(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    request(options: UniNamespace.RequestOptions) {
      requests.push(options);
      return { abort() {} } as UniNamespace.RequestTask;
    },
  });
  return { requests, storage };
}

describe('Store CUSTOMER API coordinator', () => {
  afterEach(() => {
    clearCandidateToken();
    clearCustomerSession();
    vi.unstubAllGlobals();
  });

  it('generates UUID v4 idempotency keys', () => {
    expect(createIdempotencyKey()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('submits the exact legal consent tuple without persisting it', async () => {
    const current = environment();
    const pending = loginWithWechat({
      code: 'mock:customer_0001',
      consents: [
        { type: 'USER_AGREEMENT', document_version: 'v1', accepted: true },
        { type: 'PRIVACY_POLICY', document_version: 'v1', accepted: true },
      ],
    }, '00000000-0000-4000-8000-000000000001');
    expect(current.requests[0]).toMatchObject({
      data: {
        code: 'mock:customer_0001',
        consents: [
          { type: 'USER_AGREEMENT', document_version: 'v1', accepted: true },
          { type: 'PRIVACY_POLICY', document_version: 'v1', accepted: true },
        ],
      },
      header: expect.objectContaining({
        'Idempotency-Key': '00000000-0000-4000-8000-000000000001',
      }),
      method: 'POST',
      url: '/api/v1/store/auth/wechat/login',
    });
    current.requests[0]?.success?.(response({
      session: initialSession,
      confirmation_required: false,
      candidate: null,
    }, 'req_login'));
    await expect(pending).resolves.toMatchObject({ confirmation_required: false });
    expect(loadCustomerSession()).toEqual(initialSession);
    expect(current.storage.size).toBe(0);
  });

  it('refreshes once after 401, rotates storage, and retries with the new bearer', async () => {
    const current = environment();
    saveCustomerSession(initialSession);
    const pending = getCustomerProfile();

    current.requests[0]?.success?.(error(401, 'SESSION_EXPIRED', 'req_expired'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(2));
    expect(current.requests[1]).toMatchObject({
      data: { refresh_token: initialSession.refresh_token },
      method: 'POST',
      url: '/api/v1/store/auth/refresh',
    });
    current.requests[1]?.success?.(response(rotatedSession, 'req_refresh'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(3));
    expect(current.requests[2]?.header).toMatchObject({
      Authorization: `Bearer ${rotatedSession.access_token}`,
    });
    current.requests[2]?.success?.(response({
      customer_id: '01JTESTCUSTOMER00000000000',
      nickname: '青序用户',
      avatar_url: null,
      city: null,
      phone_tail: null,
      phone_masked: null,
      phone_source: null,
      phone_verified_at: null,
      version: 2,
    }, 'req_profile'));
    await expect(pending).resolves.toMatchObject({ nickname: '青序用户', version: 2 });
    expect(loadCustomerSession()).toEqual(rotatedSession);
    expect(current.storage.size).toBe(0);
  });

  it('does not retry a non-authentication mutation failure', async () => {
    const current = environment();
    saveCustomerSession(initialSession);
    const pending = updateCustomerProfile({ nickname: '新昵称' }, 4);
    expect(current.requests[0]).toMatchObject({
      data: { nickname: '新昵称' },
      method: 'PATCH',
    });
    expect(current.requests[0]?.header).toMatchObject({
      Authorization: `Bearer ${initialSession.access_token}`,
      'If-Match': '"4"',
    });
    current.requests[0]?.success?.(error(409, 'VERSION_CONFLICT', 'req_conflict'));
    await expect(pending).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    expect(current.requests).toHaveLength(1);
  });

  it('reuses the original mutation idempotency key after an explicit 401 refresh', async () => {
    const current = environment();
    saveCustomerSession(initialSession);
    const pending = updateCustomerProfile({ nickname: '新昵称' }, 4);
    const originalKey = current.requests[0]?.header?.['Idempotency-Key'];
    current.requests[0]?.success?.(error(401, 'SESSION_EXPIRED', 'req_expired'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(2));
    current.requests[1]?.success?.(response(rotatedSession, 'req_refresh'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(3));
    expect(current.requests[2]?.header?.['Idempotency-Key']).toBe(originalKey);
    expect(current.requests[2]?.header).toMatchObject({
      Authorization: `Bearer ${rotatedSession.access_token}`,
      'If-Match': '"4"',
    });
    current.requests[2]?.success?.(response({
      customer_id: '01JTESTCUSTOMER00000000000',
      nickname: '新昵称',
      avatar_url: null,
      city: null,
      phone_tail: null,
      phone_masked: null,
      phone_source: null,
      phone_verified_at: null,
      version: 5,
    }, 'req_profile'));
    await expect(pending).resolves.toMatchObject({ nickname: '新昵称', version: 5 });
  });

  it('does not let a late refresh success overwrite a newer login session', async () => {
    const current = environment();
    saveCustomerSession(initialSession);
    const profilePending = getCustomerProfile();
    current.requests[0]?.success?.(error(401, 'SESSION_EXPIRED', 'req_expired'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(2));

    const loginPending = loginWithWechat({
      code: 'mock:customer_new_login',
      consents: [
        { type: 'USER_AGREEMENT', document_version: 'v1', accepted: true },
        { type: 'PRIVACY_POLICY', document_version: 'v1', accepted: true },
      ],
    });
    expect(current.requests).toHaveLength(3);
    current.requests[2]?.success?.(response({
      session: newLoginSession,
      confirmation_required: false,
      candidate: null,
    }, 'req_login'));
    await loginPending;

    current.requests[1]?.success?.(response(rotatedSession, 'req_late_refresh'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(4));
    expect(current.requests[3]?.header).toMatchObject({
      Authorization: `Bearer ${newLoginSession.access_token}`,
    });
    current.requests[3]?.success?.(response({
      customer_id: '01JTESTCUSTOMER00000000000',
      nickname: null,
      avatar_url: null,
      city: null,
      phone_tail: null,
      phone_masked: null,
      phone_source: null,
      phone_verified_at: null,
      version: 1,
    }, 'req_profile'));
    await profilePending;
    expect(loadCustomerSession()).toEqual(newLoginSession);
  });

  it('keeps candidate credentials memory-only and never sends bearer and candidate together', async () => {
    const current = environment();
    const createdPending = createAttributionCandidate({
      invite_code: 'invite-one',
      promotion_asset_id: '01JTESTPROMOTION0000000000',
    });
    expect(current.requests[0]?.header).not.toHaveProperty('Authorization');
    expect(current.requests[0]?.header).not.toHaveProperty('X-Candidate-Token');
    current.requests[0]?.success?.(response({
      candidate,
      candidate_token: 't'.repeat(32),
      service_agent: null,
      public_fallback: null,
    }, 'req_create'));
    await createdPending;
    expect(peekCandidateToken()).toBe('t'.repeat(32));
    expect(current.storage.size).toBe(0);

    const queryPending = getAttributionCandidate();
    expect(current.requests[1]?.header).toMatchObject({ 'X-Candidate-Token': 't'.repeat(32) });
    expect(current.requests[1]?.header).not.toHaveProperty('Authorization');
    current.requests[1]?.success?.(response(candidate, 'req_query'));
    await expect(queryPending).resolves.toMatchObject({ candidate_id: candidate.candidate_id });

    const fallbackPending = createAttributionCandidate({
      invite_code: 'invite-expired',
      promotion_asset_id: '01JTESTPROMOTION0000000001',
    });
    expect(current.requests[2]?.header).toMatchObject({ 'X-Candidate-Token': 't'.repeat(32) });
    current.requests[2]?.success?.(response({
      candidate: null,
      candidate_token: null,
      service_agent: null,
      public_fallback: {
        attribution_eligible: false,
        public_target_url: 'https://mall.example.test/products/two',
      },
    }, 'req_fallback'));
    await fallbackPending;
    expect(peekCandidateToken()).toBe('t'.repeat(32));

    saveCustomerSession(initialSession);
    const bearerPending = createAttributionCandidate({
      invite_code: 'invite-two',
      promotion_asset_id: '01JTESTPROMOTION0000000002',
    });
    expect(current.requests[3]?.header).toMatchObject({
      Authorization: `Bearer ${initialSession.access_token}`,
    });
    expect(current.requests[3]?.header).not.toHaveProperty('X-Candidate-Token');
    current.requests[3]?.success?.(response({
      candidate,
      candidate_token: null,
      service_agent: null,
      public_fallback: null,
    }, 'req_bearer'));
    await bearerPending;
  });

  it('clears local credentials when refresh fails', async () => {
    const current = environment();
    saveCustomerSession(initialSession);
    const pending = getCustomerProfile();
    current.requests[0]?.success?.(error(401, 'SESSION_EXPIRED', 'req_expired'));
    await vi.waitFor(() => expect(current.requests).toHaveLength(2));
    current.requests[1]?.success?.(error(401, 'SESSION_EXPIRED', 'req_refresh_failed'));
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(loadCustomerSession()).toBeNull();
    expect(current.storage.size).toBe(0);
    expect(current.requests).toHaveLength(2);
  });
});
