import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { ApplicationError } from '@qingxu/platform-core';
import { isIP } from 'node:net';

import type { PrincipalRequest } from '../platform/access/principal';

export interface AdminAuthRequestContext {
  accessSession: NonNullable<PrincipalRequest['accessSession']>;
  authorizationToken: string;
  preAuth: NonNullable<PrincipalRequest['preAuth']>;
  principal: NonNullable<PrincipalRequest['principal']>;
  requestId: string;
}

interface HttpRequest extends PrincipalRequest {
  socket?: { remoteAddress?: string };
}

export const AuthRequest = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<HttpRequest>();
});

export function requireRequestId(request: PrincipalRequest): string {
  if (!request.requestId) throw new ApplicationError('INTERNAL_ERROR', 'Request ID is unavailable');
  return request.requestId;
}

export function requestIp(request: HttpRequest): string | undefined {
  const value = request.socket?.remoteAddress;
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}
