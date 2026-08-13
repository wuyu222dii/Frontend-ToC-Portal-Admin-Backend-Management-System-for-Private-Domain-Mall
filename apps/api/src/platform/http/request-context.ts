import { AsyncLocalStorage } from 'node:async_hooks';

import type { RbacPrincipal } from '@qingxu/platform-core';

export interface RequestContext {
  requestId: string;
  principal?: RbacPrincipal;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function setRequestContextPrincipal(principal: RbacPrincipal): void {
  const context = getRequestContext();
  if (context !== undefined) {
    context.principal = principal;
  }
}
