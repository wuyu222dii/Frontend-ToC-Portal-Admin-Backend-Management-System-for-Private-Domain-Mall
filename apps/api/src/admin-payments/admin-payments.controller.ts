import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { NoStore } from '../admin-auth/no-store.decorator';
import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { preEnvelopedAcceptedResponse } from '../platform/http/success-envelope.interceptor';
import {
  parsePaymentIntentId,
  parsePaymentReconciliationBody,
  parsePaymentReconciliationListQuery,
} from './admin-payments.dto';
import { AdminPaymentsService } from './admin-payments.service';

type HttpResponse = { status(code: number): HttpResponse };

@Controller('admin/payment-intents')
@RequireRoles('SUPER_ADMIN')
export class AdminPaymentsController {
  constructor(@Inject(AdminPaymentsService) private readonly payments: AdminPaymentsService) {}

  @Get('reconciliation-tasks')
  @NoStore()
  list(@Query() query: unknown) {
    return this.payments.listTasks(parsePaymentReconciliationListQuery(query));
  }

  @Post(':payment_intent_id/reconcile')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  async reconcile(
    @Param('payment_intent_id') paymentIntentIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const request = requireAdminCatalogRequest(rawRequest);
    const result = await this.payments.reconcile(
      request,
      parsePaymentIntentId(paymentIntentIdValue),
      parsePaymentReconciliationBody(body),
      idempotencyKey,
    );
    if (result.statusCode === HttpStatus.ACCEPTED) {
      response.status(HttpStatus.ACCEPTED);
      return preEnvelopedAcceptedResponse({
        code: 'ACCEPTED',
        data: result.data,
        message: 'accepted',
        request_id: request.requestId,
      });
    }
    return result.data;
  }
}
