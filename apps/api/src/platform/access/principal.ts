import type { RbacPrincipal } from '@qingxu/platform-core';

export interface PrincipalRequest {
  principal?: RbacPrincipal;
  requestId?: string;
  resultCode?: string;
}
