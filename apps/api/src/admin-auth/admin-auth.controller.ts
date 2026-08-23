import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';

import { RequireRoles, Public } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { RequirePreAuth } from '../platform/auth/pre-auth.metadata';
import {
  parseChallengeId,
  parseChangePasswordBody,
  parseEnrollBody,
  parseLoginBody,
  parseRecoveryBody,
  parseRefreshBody,
  parseTotpBody,
  parseTotpVerifyBody,
} from './admin-auth.dto';
import { AuthRequest, requestIp, requireRequestId, type AdminAuthRequestContext } from './admin-auth.request';
import { AdminAuthService } from './admin-auth.service';
import { NoStore } from './no-store.decorator';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Post('login') @HttpCode(HttpStatus.OK) @Public() @NoStore()
  login(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.login(parseLoginBody(body), key, requireRequestId(request), requestIp(request));
  }

  @Post('refresh') @HttpCode(HttpStatus.OK) @Public() @NoStore()
  refresh(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.refresh(parseRefreshBody(body), key, requireRequestId(request), requestIp(request));
  }

  @Post('logout') @HttpCode(HttpStatus.OK) @RequireRoles('SUPER_ADMIN')
  logout(@IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.logout(request.accessSession, key, requireRequestId(request), requestIp(request));
  }

  @Post('logout-all') @HttpCode(HttpStatus.OK) @RequireRoles('SUPER_ADMIN')
  logoutAll(@IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.logoutAll(request.accessSession, key, requireRequestId(request), requestIp(request));
  }

  @Get('current') @RequireRoles('SUPER_ADMIN')
  current(@AuthRequest() request: AdminAuthRequestContext) { return this.auth.current(request.accessSession); }

  @Post('change-password') @HttpCode(HttpStatus.OK) @RequireRoles('SUPER_ADMIN') @NoStore()
  changePassword(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.changePassword(request.accessSession, parseChangePasswordBody(body), key,
      requireRequestId(request), requestIp(request));
  }

  @Post('mfa/totp/enroll') @HttpCode(HttpStatus.OK) @Public() @RequirePreAuth('ENROLL_TOTP') @NoStore()
  enroll(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.enroll(request.preAuth, request.authorizationToken, parseEnrollBody(body), key,
      requireRequestId(request), requestIp(request));
  }

  @Post('mfa/totp/enroll/verify') @HttpCode(HttpStatus.OK) @Public() @RequirePreAuth('ENROLL_TOTP') @NoStore()
  verifyEnrollment(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.verifyEnrollment(request.preAuth, request.authorizationToken, parseTotpVerifyBody(body), key,
      requireRequestId(request), requestIp(request));
  }

  @Post('mfa/challenges/:challenge_id/verify') @HttpCode(HttpStatus.OK) @Public() @RequirePreAuth('VERIFY_TOTP') @NoStore()
  verifyLogin(@Param('challenge_id') challengeIdValue: string, @Body() body: unknown,
    @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    const challengeId = parseChallengeId(challengeIdValue);
    const input = parseTotpVerifyBody(body);
    return this.auth.verifyLogin(request.preAuth, request.authorizationToken, challengeId, input, key,
      requireRequestId(request), requestIp(request));
  }

  @Post('mfa/recovery') @HttpCode(HttpStatus.OK) @Public() @RequirePreAuth('VERIFY_TOTP') @NoStore()
  recover(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.recover(request.preAuth, request.authorizationToken, parseRecoveryBody(body), key,
      requireRequestId(request), requestIp(request));
  }

  @Post('mfa/recovery-codes/rotate') @HttpCode(HttpStatus.OK) @RequireRoles('SUPER_ADMIN') @NoStore()
  rotateRecoveryCodes(@Body() body: unknown, @IdempotencyKey() key: string, @AuthRequest() request: AdminAuthRequestContext) {
    return this.auth.rotateRecoveryCodes(request.accessSession, parseTotpBody(body), key,
      requireRequestId(request), requestIp(request));
  }
}
