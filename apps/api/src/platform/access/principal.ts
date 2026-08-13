import type { CurrentAdminSession } from '@qingxu/database';
import type { RbacPrincipal, VerifiedPreAuthClaims } from '@qingxu/platform-core';

export interface PrincipalRequest {
  accessSession?: CurrentAdminSession;
  authorizationToken?: string;
  preAuth?: VerifiedPreAuthClaims;
  principal?: RbacPrincipal;
  requestId?: string;
  resultCode?: string;
}
