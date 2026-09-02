import { applyDecorators, SetMetadata } from '@nestjs/common';

import { RequireRoles } from '../access/rbac.metadata';

export const AGENT_AUTHENTICATION_REALM = Symbol('agent-authentication-realm');
export const ALLOW_RESTRICTED_AGENT_SESSION = Symbol('allow-restricted-agent-session');

export const AgentRealm = () => applyDecorators(
  SetMetadata(AGENT_AUTHENTICATION_REALM, true),
  RequireRoles('AGENT_ADMIN'),
);

export const AllowRestrictedAgentSession = () => SetMetadata(ALLOW_RESTRICTED_AGENT_SESSION, true);
