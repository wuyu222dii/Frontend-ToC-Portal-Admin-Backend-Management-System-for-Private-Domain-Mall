import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { requireAdminCustomerRequest } from '../admin-customers/admin-customers.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminWithdrawalEmptyQuery,
  parseAdminWithdrawalId,
  parseAdminWithdrawalListQuery,
  parseWithdrawalApprovePreviewBody,
  parseWithdrawalConfirmationBody,
  parseWithdrawalMarkPaidBody,
  parseWithdrawalMarkPaidConfirmationBody,
  parseWithdrawalPayoutRevealBody,
  parseWithdrawalProofsBody,
  parseWithdrawalRejectBody,
  parseWithdrawalRejectConfirmationBody,
} from './admin-withdrawals.dto';
import { AdminWithdrawalsService } from './admin-withdrawals.service';

@Controller('admin/withdrawals')
@RequireRoles('SUPER_ADMIN')
export class AdminWithdrawalsController {
  constructor(@Inject(AdminWithdrawalsService) private readonly withdrawals: AdminWithdrawalsService) {}

  @Get() @NoStore()
  list(@Query() query: unknown) {
    return this.withdrawals.list(parseAdminWithdrawalListQuery(query));
  }

  @Get(':withdrawal_id') @NoStore()
  detail(@Param('withdrawal_id') withdrawalId: string, @Query() query: unknown) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.detail(parseAdminWithdrawalId(withdrawalId));
  }

  @Post(':withdrawal_id/approve-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewApprove(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    parseWithdrawalApprovePreviewBody(body);
    return this.withdrawals.previewApprove(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/approve') @HttpCode(HttpStatus.OK) @NoStore()
  approve(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.approve(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/reject-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewReject(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.previewReject(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalRejectBody(body),
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/reject') @HttpCode(HttpStatus.OK) @NoStore()
  reject(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.reject(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalRejectConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/payout-account-reveal') @HttpCode(HttpStatus.OK) @NoStore()
  revealPayoutAccount(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.revealPayoutAccount(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalPayoutRevealBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/proofs') @HttpCode(HttpStatus.OK) @NoStore()
  attachProofs(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.attachProofs(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalProofsBody(body),
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/mark-paid-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewMarkPaid(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.previewMarkPaid(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalMarkPaidBody(body),
      idempotencyKey,
    );
  }

  @Post(':withdrawal_id/mark-paid') @HttpCode(HttpStatus.OK) @NoStore()
  markPaid(
    @Param('withdrawal_id') withdrawalId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminWithdrawalEmptyQuery(query);
    return this.withdrawals.markPaid(
      requireAdminCustomerRequest(request),
      parseAdminWithdrawalId(withdrawalId),
      parseWithdrawalMarkPaidConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
