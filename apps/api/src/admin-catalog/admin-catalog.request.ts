import { isIP } from 'node:net';

import { ApplicationError } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../platform/access/principal';

export interface AdminCatalogRequestContext extends PrincipalRequest {
  accessSession: NonNullable<PrincipalRequest['accessSession']>;
  principal: NonNullable<PrincipalRequest['principal']>;
  requestId: string;
  socket?: { remoteAddress?: string };
}

export function requireAdminCatalogRequest(request: PrincipalRequest): AdminCatalogRequestContext {
  if (!request.requestId || !request.principal || !request.accessSession) {
    throw new ApplicationError('INTERNAL_ERROR', 'Authenticated catalog request context is unavailable');
  }
  return request as AdminCatalogRequestContext;
}

export function catalogRequestIp(request: AdminCatalogRequestContext): string | undefined {
  const value = request.socket?.remoteAddress;
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}
