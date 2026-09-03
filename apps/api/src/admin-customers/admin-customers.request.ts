import { isIP } from 'node:net';

import { ApplicationError } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../platform/access/principal';

export interface AdminCustomerRequestContext extends PrincipalRequest {
  accessSession: NonNullable<PrincipalRequest['accessSession']>;
  principal: NonNullable<PrincipalRequest['principal']>;
  requestId: string;
  socket?: { remoteAddress?: string };
}

export function requireAdminCustomerRequest(request: PrincipalRequest): AdminCustomerRequestContext {
  if (!request.requestId || !request.principal || !request.accessSession ||
    request.principal.role !== 'SUPER_ADMIN') {
    throw new ApplicationError('INTERNAL_ERROR', 'Authenticated Admin customer request context is unavailable');
  }
  return request as AdminCustomerRequestContext;
}

export function adminCustomerRequestIp(request: AdminCustomerRequestContext): string | undefined {
  const value = request.socket?.remoteAddress;
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}
