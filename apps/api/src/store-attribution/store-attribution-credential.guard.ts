import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, storeCandidateTokenHashCandidates } from '@qingxu/platform-core';

import { Public } from '../platform/access/rbac.metadata';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { OptionalStoreAuthentication } from '../platform/auth/optional-store-authentication.metadata';
import type { StoreAttributionRequestContext } from './store-attribution.request';

const STORE_ATTRIBUTION_CREDENTIAL_POLICY = Symbol('store-attribution-credential-policy');
export type StoreAttributionCredentialPolicy = 'CREATE' | 'QUERY';

export const StoreAttributionCredentialRoute = (policy: StoreAttributionCredentialPolicy) => applyDecorators(
  Public(),
  OptionalStoreAuthentication(),
  SetMetadata(STORE_ATTRIBUTION_CREDENTIAL_POLICY, policy),
  UseGuards(StoreAttributionCredentialGuard),
);

function headerPresent(request: StoreAttributionRequestContext, name: string): boolean {
  return request.headers[name] !== undefined;
}

function candidateToken(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || Array.from(value).length < 32 || Array.from(value).length > 512 ||
    value.includes(',')) {
    throw new ApplicationError('AUTH_REQUIRED', 'Store attribution credential is invalid');
  }
  return value;
}

@Injectable()
export class StoreAttributionCredentialGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<StoreAttributionCredentialPolicy | undefined>(
      STORE_ATTRIBUTION_CREDENTIAL_POLICY,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) throw new ApplicationError('INTERNAL_ERROR', 'Store attribution credential policy is missing');

    const request = context.switchToHttp().getRequest<StoreAttributionRequestContext>();
    const authorizationPresent = headerPresent(request, 'authorization');
    const candidatePresent = headerPresent(request, 'x-candidate-token');
    if (authorizationPresent && candidatePresent) {
      throw new ApplicationError('INVALID_ARGUMENT', 'Authorization and X-Candidate-Token cannot be combined');
    }
    if (authorizationPresent) {
      if (!request.storeSession) {
        throw new ApplicationError('AUTH_REQUIRED', 'Store authentication credentials are invalid');
      }
      delete request.attributionCredential;
      return true;
    }
    if (request.storeSession) {
      throw new ApplicationError('AUTH_REQUIRED', 'Store authentication credentials are invalid');
    }
    if (candidatePresent) {
      if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store attribution runtime is unavailable');
      request.attributionCredential = {
        kind: 'candidate',
        tokenHashCandidates: storeCandidateTokenHashCandidates(
          candidateToken(request.headers['x-candidate-token']),
          this.config.authentication.secretHashKeys,
        ),
      };
      return true;
    }
    if (policy === 'QUERY') {
      throw new ApplicationError('AUTH_REQUIRED', 'Store attribution credential is required');
    }
    request.attributionCredential = { kind: 'anonymous' };
    return true;
  }
}
