import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { CurrentStoreSession } from '@qingxu/database';
import { hmacStoreCandidateToken } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  StoreAttributionCredentialGuard,
  StoreAttributionCredentialRoute,
} from './store-attribution-credential.guard';
import {
  requireStoreAttributionCredential,
  type StoreAttributionRequestContext,
} from './store-attribution.request';

const CURRENT_KEY = Buffer.alloc(32, 11);
const PREVIOUS_KEY = Buffer.alloc(32, 12);
const TOKEN = `cnd_${'c'.repeat(43)}`;
const SESSION = {
  accountId: '01J00000000000000000000000',
  customerId: '01J00000000000000000000001',
  sessionId: '01J00000000000000000000002',
} as CurrentStoreSession;

const config = {
  authentication: {
    secretHashKeys: {
      current: { id: 'auth-v2', key: CURRENT_KEY },
      previous: [{ id: 'auth-v1', key: PREVIOUS_KEY }],
    },
  },
} as unknown as PlatformRuntimeConfig;

class CredentialFixture {
  @StoreAttributionCredentialRoute('CREATE')
  create(): void {}

  @StoreAttributionCredentialRoute('QUERY')
  query(): void {}

  missingPolicy(): void {}
}

function contextFor(
  handler: keyof CredentialFixture,
  headers: Record<string, string | string[] | undefined> = {},
  session?: CurrentStoreSession,
): { context: ExecutionContext; request: StoreAttributionRequestContext } {
  const request: StoreAttributionRequestContext = { headers, ...(session ? { storeSession: session } : {}) };
  return {
    context: {
      getClass: () => CredentialFixture,
      getHandler: () => CredentialFixture.prototype[handler],
      switchToHttp: () => ({
        getNext: () => undefined,
        getRequest: () => request,
        getResponse: () => ({ setHeader: () => undefined }),
      }),
    } as unknown as ExecutionContext,
    request,
  };
}

describe('B7.3 Store attribution optional credential guard', () => {
  it('maps a validated Store session to the CUSTOMER branch without retaining candidate state', () => {
    const { context, request } = contextFor('create', { authorization: 'Bearer token' }, SESSION);
    const guard = new StoreAttributionCredentialGuard(new Reflector(), config);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.attributionCredential).toBeUndefined();
    expect(requireStoreAttributionCredential(request)).toEqual({ kind: 'CUSTOMER', session: SESSION });
  });

  it('hashes a candidate token with current and previous keys and never retains the raw token', () => {
    const { context, request } = contextFor('query', { 'x-candidate-token': TOKEN });
    const guard = new StoreAttributionCredentialGuard(new Reflector(), config);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.attributionCredential).toEqual({
      kind: 'candidate',
      tokenHashCandidates: [
        hmacStoreCandidateToken(TOKEN, CURRENT_KEY),
        hmacStoreCandidateToken(TOKEN, PREVIOUS_KEY),
      ],
    });
    expect(JSON.stringify(request.attributionCredential)).not.toContain(TOKEN);
    expect(requireStoreAttributionCredential(request)).toEqual({
      kind: 'CANDIDATE_TOKEN',
      tokenHashCandidates: request.attributionCredential?.kind === 'candidate'
        ? request.attributionCredential.tokenHashCandidates
        : [],
    });
  });

  it('allows no credentials only on candidate creation', () => {
    const create = contextFor('create');
    const query = contextFor('query');
    const guard = new StoreAttributionCredentialGuard(new Reflector(), config);

    expect(guard.canActivate(create.context)).toBe(true);
    expect(create.request.attributionCredential).toEqual({ kind: 'anonymous' });
    expect(requireStoreAttributionCredential(create.request)).toEqual({ kind: 'ANONYMOUS' });
    expect(() => guard.canActivate(query.context)).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }));
  });

  it.each([
    [{ authorization: 'Bearer token', 'x-candidate-token': TOKEN }, 'INVALID_ARGUMENT'],
    [{ authorization: 'Bearer invalid' }, 'AUTH_REQUIRED'],
    [{ 'x-candidate-token': 'short' }, 'AUTH_REQUIRED'],
    [{ 'x-candidate-token': [TOKEN, TOKEN] }, 'AUTH_REQUIRED'],
    [{ 'x-candidate-token': `${TOKEN},${TOKEN}` }, 'AUTH_REQUIRED'],
  ] as const)('fails closed for malformed or ambiguous headers %#', (headers, code) => {
    const { context, request } = contextFor('create', headers as Record<string, string | string[] | undefined>);
    const guard = new StoreAttributionCredentialGuard(new Reflector(), config);

    expect(() => guard.canActivate(context)).toThrow(expect.objectContaining({ code }));
    expect(request.attributionCredential).toBeUndefined();
  });

  it('fails closed when route metadata or candidate hashing runtime is unavailable', () => {
    expect(() => new StoreAttributionCredentialGuard(new Reflector(), config)
      .canActivate(contextFor('missingPolicy').context))
      .toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(() => new StoreAttributionCredentialGuard(new Reflector())
      .canActivate(contextFor('create', { 'x-candidate-token': TOKEN }).context))
      .toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });
});
