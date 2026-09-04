import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentCurrent, AgentSession, RestrictedAgentSession } from '../types/agent';
import {
  AgentApiError,
  agentAuthSession,
  createAgentPromotion,
  getAgentDashboard,
  listAgentProducts,
  loginAgent,
} from './agent';
import {
  AgentResponseFormatError,
  decodeAgentCurrent,
  decodeErrorResponse,
  decodeAgentLoginResult,
  decodeStoreBrandList,
  decodeStoreCategoryList,
} from './agent-decoders';

const expiresAt = '2026-09-04T12:00:00Z';
const loginPassword = ['Password', 'B13'].join('-');

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    access_token: 'access-old',
    refresh_token: 'refresh-old',
    account_id: 'account-1',
    session_id: 'session-old',
    role: 'AGENT_ADMIN',
    mfa_required: false,
    assurance: 'PASSWORD',
    restriction: 'NONE',
    expires_at: expiresAt,
    ...overrides,
  };
}

function restricted(): RestrictedAgentSession {
  return {
    access_token: 'restricted-access',
    account_id: 'account-1',
    session_id: 'restricted-session',
    role: 'AGENT_ADMIN',
    mfa_required: false,
    assurance: 'PASSWORD',
    restriction: 'CHANGE_PASSWORD_ONLY',
    must_change_password: true,
    next_action: 'CHANGE_PASSWORD',
    allowed_actions: ['CHANGE_TEMPORARY_PASSWORD', 'LOGOUT'],
    expires_at: expiresAt,
  };
}

function current(overrides: Partial<AgentCurrent> = {}): AgentCurrent {
  return {
    agent_id: 'agent-1',
    agent_no: 'AG0001',
    name: '测试代理',
    status: 'ACTIVE',
    product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
    ...overrides,
  };
}

function dashboard(agentId = 'agent-1') {
  return {
    timezone: 'Asia/Shanghai',
    as_of: '2026-09-04T08:00:00+08:00',
    agent_id: agentId,
    today_net_sales_amount: '100.00',
    month_net_sales_amount: '500.00',
    today_paid_order_count: 2,
    attributed_customer_count: 8,
    expected_commission: '12.00',
    available_balance: '40.00',
    frozen_balance: '10.00',
    negative_balance: '0.00',
    pending_withdrawal_count: 1,
    todo: { commission_exception_count: 0, withdrawal_action_count: 1 },
    trend: [],
  };
}

function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ code: 'OK', message: 'success', data, request_id: 'req-1' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ code: 'TOKEN_EXPIRED', message: '会话已过期', request_id: 'req-401' }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

function refreshReplayConflict(): Response {
  return new Response(
    JSON.stringify({ code: 'STATE_CONFLICT', message: 'refresh response cannot be replayed', request_id: 'req-409' }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

function installNormal(value = session(), principal = current()): void {
  agentAuthSession.acceptSession(value);
  agentAuthSession.acceptCurrent(principal);
}

afterEach(() => {
  agentAuthSession.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('strict Agent contract decoding', () => {
  it('persists only the remembered login name and keeps credentials in memory', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    agentAuthSession.rememberLogin('agent.test', true);
    agentAuthSession.acceptSession(session());

    expect(Object.fromEntries(values)).toEqual({
      'qingxu.agent.remembered_login': 'agent.test',
    });
    expect(JSON.stringify(Object.fromEntries(values))).not.toContain('access-old');
    expect(JSON.stringify(Object.fromEntries(values))).not.toContain('refresh-old');
    agentAuthSession.rememberLogin('agent.test', false);
    expect(values.size).toBe(0);
  });

  it('rejects extra keys, wrong scalar types, and foreign enum values', () => {
    expect(() => decodeAgentCurrent({ ...current(), leaked_secret: 'no' })).toThrow(
      AgentResponseFormatError,
    );
    expect(() => decodeAgentCurrent({ ...current(), name: 7 })).toThrow(
      AgentResponseFormatError,
    );
    expect(() => decodeAgentCurrent({ ...current(), status: 'PENDING' })).toThrow(
      AgentResponseFormatError,
    );
  });

  it('accepts only the exact restricted-session action set and never a refresh token', () => {
    expect(decodeAgentLoginResult(restricted()).restriction).toBe('CHANGE_PASSWORD_ONLY');
    expect(() =>
      decodeAgentLoginResult({ ...restricted(), refresh_token: 'must-not-exist' }),
    ).toThrow(AgentResponseFormatError);
    expect(() =>
      decodeAgentLoginResult({ ...restricted(), allowed_actions: ['LOGOUT'] }),
    ).toThrow(AgentResponseFormatError);
  });

  it.each([
    'current_password',
    'access_token',
    'reauth_grant',
    'account_number',
    'bank_account_number',
  ])(
    'rejects a non-null rejected_value for sensitive field %s',
    (field) => {
      expect(() => decodeErrorResponse({
        code: 'INVALID_ARGUMENT',
        message: 'invalid',
        request_id: 'req-sensitive',
        details: [{ field, reason: 'REJECTED', rejected_value: 'must-not-escape' }],
      })).toThrow(AgentResponseFormatError);
    },
  );

  it('strictly decodes the public brand and category filter options', () => {
    expect(decodeStoreBrandList({
      items: [{ brand_id: 'brand-1', name: '青序', description: null, logo_url: null, sort_order: 1 }],
    }).items[0]?.name).toBe('青序');
    expect(decodeStoreCategoryList({
      items: [{ category_id: 'category-1', name: '洗护', icon_url: null, sort_order: 1 }],
    }).items[0]?.name).toBe('洗护');
    expect(() => decodeStoreBrandList({ items: [], private_field: true })).toThrow(
      AgentResponseFormatError,
    );
  });
});

describe('Agent request session safety', () => {
  it('decodes the exact error envelope and numeric Retry-After', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'RATE_LIMITED',
            message: '请稍后重试',
            details: [{ field: null, reason: 'TOO_MANY_ATTEMPTS' }],
            request_id: 'req-rate-limit',
          }),
          { status: 429, headers: { 'Retry-After': '7' } },
        )),
    );

    const request = loginAgent(
      { login_name: 'agent.test', password: loginPassword },
      '018f47e7-5d34-7b8c-9012-3456789abcde',
    );
    await expect(request).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      requestId: 'req-rate-limit',
      retryAfterSeconds: 7,
      details: [{ field: null, reason: 'TOO_MANY_ATTEMPTS' }],
    });
  });

  it('fails closed on an error envelope with an undeclared key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'AUTH_FAILED',
            message: '登录失败',
            request_id: 'req-invalid-error',
            internal_reason: 'must not escape',
          }),
          { status: 401 },
        )),
    );

    await expect(
      loginAgent(
        { login_name: 'agent.test', password: loginPassword },
        '018f47e7-5d34-7b8c-9012-3456789abcde',
      ),
    ).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
  });

  it('blocks business reads under a restricted session without contacting the API', async () => {
    agentAuthSession.acceptRestricted(restricted());
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(listAgentProducts()).rejects.toMatchObject({
      status: 403,
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('coalesces concurrent 401s into one refresh and accepts the rotated session_id', async () => {
    installNormal();
    const refreshed = session({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      session_id: 'session-new',
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const authorization = new Headers(init?.headers).get('authorization');
      if (path.endsWith('/agent/auth/refresh')) {
        refreshCalls += 1;
        await refreshGate;
        return ok(refreshed);
      }
      if (path.endsWith('/agent/dashboard?days=7') && authorization === 'Bearer access-old') {
        return unauthorized();
      }
      if (path.endsWith('/agent/dashboard?days=7') && authorization === 'Bearer access-new') {
        return ok(dashboard());
      }
      throw new Error(`unexpected request ${path} ${authorization}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = getAgentDashboard();
    const second = getAgentDashboard();
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(refreshCalls).toBe(1);
    expect(agentAuthSession.state.session?.session_id).toBe('session-new');
  });

  it('routes a staggered old-token 401 through the already rotated session', async () => {
    installNormal();
    const refreshed = session({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      session_id: 'session-new',
    });
    let releaseLate401!: () => void;
    const late401Gate = new Promise<void>((resolve) => { releaseLate401 = resolve; });
    let oldAccessCalls = 0;
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const authorization = new Headers(init?.headers).get('authorization');
      if (path.endsWith('/agent/auth/refresh')) {
        refreshCalls += 1;
        return ok(refreshed);
      }
      if (authorization === 'Bearer access-old') {
        oldAccessCalls += 1;
        if (oldAccessCalls === 1) await late401Gate;
        return unauthorized();
      }
      if (authorization === 'Bearer access-new') return ok(dashboard());
      throw new Error(`unexpected request ${path} ${authorization}`);
    }));

    const late = getAgentDashboard();
    await vi.waitFor(() => expect(oldAccessCalls).toBe(1));
    await expect(getAgentDashboard()).resolves.toMatchObject({ agent_id: 'agent-1' });
    expect(agentAuthSession.state.session?.session_id).toBe('session-new');
    releaseLate401();
    await expect(late).resolves.toMatchObject({ agent_id: 'agent-1' });
    expect(refreshCalls).toBe(1);
  });

  it.each([
    ['network failure', async () => { throw new TypeError('refresh connection reset'); }],
    ['server failure', async () => new Response(JSON.stringify({
      code: 'INTERNAL_ERROR', message: 'temporary failure', request_id: 'req-refresh-500',
    }), { status: 500, headers: { 'content-type': 'application/json' } })],
    ['malformed unauthorized response', async () => new Response(JSON.stringify({
      code: 'TOKEN_EXPIRED', message: 'expired', request_id: 'req-refresh-invalid', leaked: true,
    }), { status: 401, headers: { 'content-type': 'application/json' } })],
  ] as const)('retains the session and refresh key after a %s', async (_label, failRefresh) => {
    installNormal();
    const refreshed = session({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      session_id: 'session-new',
    });
    const refreshKeys: string[] = [];
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const authorization = new Headers(init?.headers).get('authorization');
      if (path.endsWith('/agent/auth/refresh')) {
        refreshKeys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        refreshCalls += 1;
        return refreshCalls === 1 ? failRefresh() : ok(refreshed);
      }
      if (authorization === 'Bearer access-old') return unauthorized();
      if (authorization === 'Bearer access-new') return ok(dashboard());
      throw new Error(`unexpected request ${path} ${authorization}`);
    }));

    await expect(getAgentDashboard()).rejects.toBeInstanceOf(AgentApiError);
    expect(agentAuthSession.state.session?.session_id).toBe('session-old');
    await expect(getAgentDashboard()).resolves.toMatchObject({ agent_id: 'agent-1' });
    expect(refreshKeys).toHaveLength(2);
    expect(refreshKeys[1]).toBe(refreshKeys[0]);
  });

  it('ends the old session when a lost refresh commit replays as a redacted conflict', async () => {
    installNormal();
    const refreshKeys: string[] = [];
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/agent/auth/refresh')) {
        refreshKeys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        refreshCalls += 1;
        if (refreshCalls === 1) throw new TypeError('refresh response lost after commit');
        return refreshReplayConflict();
      }
      if (path.endsWith('/agent/dashboard?days=7')) return unauthorized();
      throw new Error(`unexpected request ${path}`);
    }));

    await expect(getAgentDashboard()).rejects.toMatchObject({ status: 0 });
    expect(agentAuthSession.state.session?.session_id).toBe('session-old');
    await expect(getAgentDashboard()).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    expect(agentAuthSession.state.session).toBeNull();
    expect(refreshKeys).toHaveLength(2);
    expect(refreshKeys[1]).toBe(refreshKeys[0]);
  });

  it('does not let a late refresh overwrite a newer login', async () => {
    installNormal();
    const refreshed = session({
      access_token: 'access-late',
      refresh_token: 'refresh-late',
      session_id: 'session-late',
    });
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/agent/dashboard?days=7')) return unauthorized();
        refreshStarted = true;
        await refreshGate;
        return ok(refreshed);
      }),
    );

    const pending = getAgentDashboard();
    await vi.waitFor(() => expect(refreshStarted).toBe(true));
    const newer = session({
      account_id: 'account-2',
      access_token: 'access-account-2',
      refresh_token: 'refresh-account-2',
      session_id: 'session-account-2',
    });
    agentAuthSession.acceptSession(newer);
    agentAuthSession.acceptCurrent(current({ agent_id: 'agent-2' }));
    releaseRefresh();

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(agentAuthSession.state.session?.account_id).toBe('account-2');
    expect(agentAuthSession.state.session?.session_id).toBe('session-account-2');
  });

  it('discards refresh lineage when a new login replaces the principal state', () => {
    const previous = session();
    const rotated = session({
      access_token: 'access-rotated',
      refresh_token: 'refresh-rotated',
      session_id: 'session-rotated',
    });
    agentAuthSession.acceptSession(previous);
    expect(agentAuthSession.replaceSession(previous, rotated)).toBe(true);
    expect(agentAuthSession.descendsFrom(previous)).toBe(true);

    agentAuthSession.acceptSession(rotated);
    expect(agentAuthSession.descendsFrom(previous)).toBe(false);
  });

  it('does not let a stale retry 401 clear a newer rotated session', async () => {
    installNormal();
    const firstRotation = session({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      session_id: 'session-1',
    });
    const secondRotation = session({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      session_id: 'session-2',
    });
    let releaseStaleRetry!: () => void;
    const staleRetryGate = new Promise<void>((resolve) => {
      releaseStaleRetry = resolve;
    });
    let accessOneCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const headers = new Headers(init?.headers);
      const authorization = headers.get('authorization');
      if (path.endsWith('/agent/auth/refresh')) {
        const body = JSON.parse(String(init?.body)) as { refresh_token: string };
        return ok(body.refresh_token === 'refresh-old' ? firstRotation : secondRotation);
      }
      if (authorization === 'Bearer access-old') return unauthorized();
      if (authorization === 'Bearer access-1') {
        accessOneCalls += 1;
        if (accessOneCalls === 1) {
          await staleRetryGate;
        }
        return unauthorized();
      }
      if (authorization === 'Bearer access-2') return ok(dashboard());
      throw new Error(`unexpected request ${path} ${authorization}`);
    }));

    const stale = getAgentDashboard();
    await vi.waitFor(() => expect(accessOneCalls).toBe(1));
    await expect(getAgentDashboard()).resolves.toMatchObject({ agent_id: 'agent-1' });
    expect(agentAuthSession.state.session?.session_id).toBe('session-2');
    releaseStaleRetry();

    await expect(stale).resolves.toMatchObject({ agent_id: 'agent-1' });
    expect(agentAuthSession.state.session?.session_id).toBe('session-2');
  });

  it.each([
    ['session_id', { session_id: 'session-old' }],
    ['refresh_token', { refresh_token: 'refresh-old' }],
    ['access_token', { access_token: 'access-old' }],
  ] as const)('rejects a refresh response that does not rotate %s', async (_field, override) => {
    installNormal();
    const invalid = session({
      access_token: 'access-new',
      refresh_token: 'refresh-new',
      session_id: 'session-new',
      ...override,
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/agent/auth/refresh') ? ok(invalid) : unauthorized()
    )));

    await expect(getAgentDashboard()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(agentAuthSession.state.session?.session_id).toBe('session-old');
  });

  it('fails closed when a response belongs to another Agent principal', async () => {
    installNormal();
    vi.stubGlobal('fetch', vi.fn(async () => ok(dashboard('agent-other'))));

    await expect(getAgentDashboard()).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('lets a caller retry a lost write response with the same idempotency key', async () => {
    installNormal();
    const keys: string[] = [];
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        keys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        call += 1;
        if (call === 1) throw new TypeError('connection reset after commit');
        return ok({
          promotion_asset_id: 'promotion-1',
          target_type: 'PRODUCT',
          target_id: 'product-1',
          public_url: 'https://store.example.test/p/product-1',
          qr_file: {
            file_id: 'qr-file-1',
            status: 'READY',
            visibility: 'PRIVATE',
            purpose: 'PROMOTION_QR',
          },
          attribution_eligible: true,
          expires_at: null,
        });
      }),
    );

    const key = '018f47e7-5d34-7b8c-9012-3456789abcde';
    const input = { target_type: 'PRODUCT' as const, target_id: 'product-1' };
    await expect(createAgentPromotion(input, key)).rejects.toBeInstanceOf(AgentApiError);
    await expect(createAgentPromotion(input, key)).resolves.toMatchObject({
      promotion_asset_id: 'promotion-1',
    });
    expect(keys).toEqual([key, key]);
  });
});
