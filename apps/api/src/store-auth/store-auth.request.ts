import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApplicationError } from '@qingxu/platform-core';
import { isIP } from 'node:net';

import type { PrincipalRequest } from '../platform/access/principal';

export interface StoreAuthRequestContext extends PrincipalRequest {
  ip?: string;
}

export const StoreAuthRequest = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<StoreAuthRequestContext>();
});

export function requireStoreRequestId(request: PrincipalRequest): string {
  if (!request.requestId) throw new ApplicationError('INTERNAL_ERROR', 'Request ID is unavailable');
  return request.requestId;
}

export function storeRequestIp(request: StoreAuthRequestContext): string | undefined {
  const value = request.ip?.trim().toLowerCase();
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}

export function requireStoreSession(request: StoreAuthRequestContext) {
  if (!request.storeSession) throw new ApplicationError('AUTH_REQUIRED', 'Store session is required');
  return request.storeSession;
}
