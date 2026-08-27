import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentStoreSession } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';

import type { StoreAuthRequestContext } from '../store-auth/store-auth.request';

export type StoredAttributionCredential =
  | { kind: 'anonymous' }
  | { kind: 'candidate'; tokenHashCandidates: readonly string[] };

export interface StoreAttributionRequestContext extends StoreAuthRequestContext {
  attributionCredential?: StoredAttributionCredential;
  headers: Record<string, string | string[] | undefined>;
}

export type StoreAttributionCredentialContext =
  | { kind: 'ANONYMOUS' }
  | { kind: 'CANDIDATE_TOKEN'; tokenHashCandidates: readonly string[] }
  | { kind: 'CUSTOMER'; session: CurrentStoreSession };

export function requireStoreAttributionCredential(
  request: StoreAttributionRequestContext,
): StoreAttributionCredentialContext {
  if (request.storeSession) return { kind: 'CUSTOMER', session: request.storeSession };
  if (request.attributionCredential?.kind === 'candidate') {
    return {
      kind: 'CANDIDATE_TOKEN',
      tokenHashCandidates: request.attributionCredential.tokenHashCandidates,
    };
  }
  if (request.attributionCredential?.kind === 'anonymous') return { kind: 'ANONYMOUS' };
  throw new ApplicationError('AUTH_REQUIRED', 'Store attribution credential is required');
}

export const StoreAttributionCredential = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return requireStoreAttributionCredential(
    context.switchToHttp().getRequest<StoreAttributionRequestContext>(),
  );
});
