import { ApplicationError } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../platform/access/principal';

export interface FilesRequestContext extends PrincipalRequest {
  principal: NonNullable<PrincipalRequest['principal']>;
  requestId: string;
  socket?: { remoteAddress?: string };
}

export function requireFilesRequest(request: PrincipalRequest): FilesRequestContext {
  if (!request.requestId || !request.principal ||
    (request.principal.role === 'SUPER_ADMIN' && !request.accessSession) ||
    (request.principal.role === 'CUSTOMER' && !request.storeSession) ||
    (request.principal.role === 'AGENT_ADMIN' && !request.agentSession)) {
    throw new ApplicationError('INTERNAL_ERROR', 'Authenticated file request context is unavailable');
  }
  return request as FilesRequestContext;
}
