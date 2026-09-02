import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { CurrentAgentSession } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { isIP } from 'node:net';

import type { PrincipalRequest } from '../platform/access/principal';

export interface AgentAuthRequestContext extends PrincipalRequest {
  agentSession?: CurrentAgentSession;
  ip?: string;
}

export const AgentAuthRequest = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<AgentAuthRequestContext>();
});

export function requireAgentRequestId(request: PrincipalRequest): string {
  if (!request.requestId) throw new ApplicationError('INTERNAL_ERROR', 'Request ID is unavailable');
  return request.requestId;
}

export function agentRequestIp(request: AgentAuthRequestContext): string | undefined {
  const value = request.ip?.trim().toLowerCase();
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}

export function requireAgentSession(request: AgentAuthRequestContext): CurrentAgentSession {
  if (!request.agentSession) throw new ApplicationError('AUTH_REQUIRED', 'Agent session is required');
  return request.agentSession;
}

export function requireUnrestrictedAgentSession(request: AgentAuthRequestContext): CurrentAgentSession {
  const session = requireAgentSession(request);
  if (session.restriction !== 'NONE') {
    throw new ApplicationError('PASSWORD_CHANGE_REQUIRED', 'Agent password change is required');
  }
  return session;
}

export function requireTemporaryAgentSession(request: AgentAuthRequestContext): CurrentAgentSession {
  const session = requireAgentSession(request);
  if (session.restriction !== 'CHANGE_PASSWORD_ONLY') {
    throw new ApplicationError('STATE_CONFLICT', 'Agent session is not awaiting a password change');
  }
  return session;
}
