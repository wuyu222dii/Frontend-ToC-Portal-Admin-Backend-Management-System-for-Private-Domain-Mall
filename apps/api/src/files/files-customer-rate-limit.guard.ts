import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../platform/access/principal';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';

@Injectable()
export class FilesCustomerRateLimitGuard implements CanActivate {
  constructor(
    @Inject(StoreCustomerRateLimitGuard)
    private readonly customerRateLimit: StoreCustomerRateLimitGuard,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    if (request.principal?.role === 'SUPER_ADMIN' || request.principal?.role === 'AGENT_ADMIN') return true;
    if (request.principal?.role === 'CUSTOMER') return this.customerRateLimit.canActivate(context);
    throw new ApplicationError('PERMISSION_DENIED', 'File access role is unavailable');
  }
}
