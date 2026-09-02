import type { CurrentAdminSession, CurrentAgentSession, CurrentStoreSession } from '@qingxu/database';
import type { RbacPrincipal, VerifiedPreAuthClaims } from '@qingxu/platform-core';

export interface PrincipalRequest {
  accessSession?: CurrentAdminSession;
  agentSession?: CurrentAgentSession;
  storeSession?: CurrentStoreSession;
  authorizationToken?: string;
  preAuth?: VerifiedPreAuthClaims;
  principal?: RbacPrincipal;
  requestId?: string;
  resultCode?: string;
}
