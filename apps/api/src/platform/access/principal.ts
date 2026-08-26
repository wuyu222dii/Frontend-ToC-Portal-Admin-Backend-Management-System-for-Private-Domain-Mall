import type { CurrentAdminSession, CurrentStoreSession } from '@qingxu/database';
import type { RbacPrincipal, VerifiedPreAuthClaims } from '@qingxu/platform-core';

export interface PrincipalRequest {
  accessSession?: CurrentAdminSession;
  storeSession?: CurrentStoreSession;
  authorizationToken?: string;
  preAuth?: VerifiedPreAuthClaims;
  principal?: RbacPrincipal;
  requestId?: string;
  resultCode?: string;
}
