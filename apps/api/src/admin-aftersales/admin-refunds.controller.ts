import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminAftersaleRefundBody,
  parseAdminAftersaleRefundConfirmationBody,
  parseAdminManualCompensationBody,
  parseAdminManualCompensationConfirmationBody,
  parseAdminRefundAftersaleId,
  parseAdminRefundEmptyQuery,
  parseAdminRefundId,
  parseAdminRefundOrderId,
  parseAdminRefundRetryBody,
  parseAdminRefundRetryConfirmationBody,
} from './admin-refunds.dto';
import { AdminRefundsService } from './admin-refunds.service';

@Controller('admin/aftersales')
@RequireRoles('SUPER_ADMIN')
export class AdminAftersaleRefundsController {
  constructor(@Inject(AdminRefundsService) private readonly refunds: AdminRefundsService) {}

  @Post(':aftersale_id/refund-preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  preview(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminRefundEmptyQuery(query);
    return this.refunds.previewAftersaleRefund(
      requireAdminCatalogRequest(rawRequest),
      parseAdminRefundAftersaleId(aftersaleIdValue),
      parseAdminAftersaleRefundBody(body),
      idempotencyKey,
    );
  }

  @Post(':aftersale_id/refunds')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  create(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminRefundEmptyQuery(query);
    return this.refunds.createAftersaleRefund(
      requireAdminCatalogRequest(rawRequest),
      parseAdminRefundAftersaleId(aftersaleIdValue),
      parseAdminAftersaleRefundConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}

@Controller('admin/refunds')
@RequireRoles('SUPER_ADMIN')
export class AdminRefundsController {
  constructor(@Inject(AdminRefundsService) private readonly refunds: AdminRefundsService) {}

  @Post(':refund_id/retry-preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  previewRetry(
    @Param('refund_id') refundIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminRefundEmptyQuery(query);
    return this.refunds.previewRefundRetry(
      requireAdminCatalogRequest(rawRequest),
      parseAdminRefundId(refundIdValue),
      parseAdminRefundRetryBody(body),
      idempotencyKey,
    );
  }

  @Post(':refund_id/retry')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  retry(
    @Param('refund_id') refundIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminRefundEmptyQuery(query);
    return this.refunds.retryRefund(
      requireAdminCatalogRequest(rawRequest),
      parseAdminRefundId(refundIdValue),
      parseAdminRefundRetryConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}

@Controller('admin/orders')
@RequireRoles('SUPER_ADMIN')
export class AdminManualCompensationsController {
  constructor(@Inject(AdminRefundsService) private readonly refunds: AdminRefundsService) {}

  @Post(':order_id/manual-compensations/preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  preview(
    @Param('order_id') orderIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminRefundEmptyQuery(query);
    return this.refunds.previewManualCompensation(
      requireAdminCatalogRequest(rawRequest),
      parseAdminRefundOrderId(orderIdValue),
      parseAdminManualCompensationBody(body),
      idempotencyKey,
    );
  }

  @Post(':order_id/manual-compensations')
  @HttpCode(HttpStatus.CREATED)
  @NoStore()
  create(
    @Param('order_id') orderIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminRefundEmptyQuery(query);
    return this.refunds.createManualCompensation(
      requireAdminCatalogRequest(rawRequest),
      parseAdminRefundOrderId(orderIdValue),
      parseAdminManualCompensationConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
