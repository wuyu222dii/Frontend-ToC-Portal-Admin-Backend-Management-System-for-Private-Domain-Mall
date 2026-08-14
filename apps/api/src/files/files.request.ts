import { ApplicationError } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../platform/access/principal';

export interface FilesRequestContext extends PrincipalRequest {
  accessSession: NonNullable<PrincipalRequest['accessSession']>;
  principal: NonNullable<PrincipalRequest['principal']>;
  requestId: string;
  socket?: { remoteAddress?: string };
}

export function requireFilesRequest(request: PrincipalRequest): FilesRequestContext {
  if (!request.requestId || !request.principal || !request.accessSession) {
    throw new ApplicationError('INTERNAL_ERROR', 'Authenticated file request context is unavailable');
  }
  return request as FilesRequestContext;
}
