import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApplicationError } from '@qingxu/platform-core';

import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from './no-store.decorator';
import { parseSecurityResetConfirmBody, parseSecurityResetPreviewBody } from './admin-auth.dto';
import { AdminAuthService } from './admin-auth.service';
import { AuthRequest, requestIp, requireRequestId } from './admin-auth.request';

@Controller('admin/admin-accounts')
@RequireRoles('SUPER_ADMIN')
export class AdminAccountSecurityController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Post(':account_id/security-reset-preview') @HttpCode(HttpStatus.OK) @NoStore()
  preview(@Param('account_id') accountId: string, @Body() body: unknown, @IdempotencyKey() key: string,
    @AuthRequest() request: PrincipalRequest) {
    if (!request.accessSession || request.accessSession.accountId !== accountId) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Account not found');
    }
    return this.auth.previewSecurityReset(request.accessSession, parseSecurityResetPreviewBody(body), key);
  }

  @Post(':account_id/security-resets') @HttpCode(HttpStatus.OK) @NoStore()
  reset(@Param('account_id') accountId: string, @Body() body: unknown, @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string, @AuthRequest() request: PrincipalRequest) {
    if (!request.accessSession || request.accessSession.accountId !== accountId) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Account not found');
    }
    return this.auth.resetSecurity(request.accessSession, parseSecurityResetConfirmBody(body), expectedVersion, key,
      requireRequestId(request), requestIp(request));
  }
}
