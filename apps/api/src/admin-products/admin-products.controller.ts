import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { NoStore } from '../admin-auth/no-store.decorator';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import {
  parseProductCreateBody,
  parseProductId,
  parseProductLifecycleConfirmationBody,
  parseProductLifecyclePreviewBody,
  parseProductListQuery,
  parseProductRestoreBody,
  parseProductUpdateBody,
  parseSkuCreateBody,
  parseSkuLifecycleConfirmationBody,
  parseSkuLifecyclePreviewBody,
  parseSkuRestoreBody,
  parseSkuUpdateBody,
} from './admin-products.dto';
import { AdminProductsService } from './admin-products.service';

@Controller('admin')
@RequireRoles('SUPER_ADMIN')
export class AdminProductsController {
  constructor(@Inject(AdminProductsService) private readonly products: AdminProductsService) {}

  @Get('products')
  listProducts(@Query() query: unknown) {
    return this.products.listProducts(parseProductListQuery(query));
  }

  @Post('products') @HttpCode(HttpStatus.CREATED)
  createProduct(
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.createProduct(
      requireAdminCatalogRequest(rawRequest),
      parseProductCreateBody(body),
      idempotencyKey,
    );
  }

  @Get('products/:product_id')
  getProduct(@Param('product_id') productIdValue: string) {
    return this.products.getProduct(parseProductId(productIdValue, 'product_id'));
  }

  @Patch('products/:product_id')
  updateProduct(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.updateProduct(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(productIdValue, 'product_id'),
      parseProductUpdateBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('products/:product_id/lifecycle-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewProductLifecycle(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.previewProductLifecycle(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(productIdValue, 'product_id'),
      parseProductLifecyclePreviewBody(body),
      idempotencyKey,
    );
  }

  @Post('products/:product_id/lifecycle-changes') @HttpCode(HttpStatus.OK)
  confirmProductLifecycle(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.confirmProductLifecycle(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(productIdValue, 'product_id'),
      parseProductLifecycleConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('products/:product_id/restore') @HttpCode(HttpStatus.OK)
  restoreProduct(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.restoreProduct(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(productIdValue, 'product_id'),
      parseProductRestoreBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('products/:product_id/skus') @HttpCode(HttpStatus.CREATED)
  createSku(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.createSku(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(productIdValue, 'product_id'),
      parseSkuCreateBody(body),
      idempotencyKey,
    );
  }

  @Patch('skus/:sku_id')
  updateSku(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.updateSku(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(skuIdValue, 'sku_id'),
      parseSkuUpdateBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('skus/:sku_id/lifecycle-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewSkuLifecycle(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.previewSkuLifecycle(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(skuIdValue, 'sku_id'),
      parseSkuLifecyclePreviewBody(body),
      idempotencyKey,
    );
  }

  @Post('skus/:sku_id/lifecycle-changes') @HttpCode(HttpStatus.OK)
  confirmSkuLifecycle(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.confirmSkuLifecycle(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(skuIdValue, 'sku_id'),
      parseSkuLifecycleConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('skus/:sku_id/restore') @HttpCode(HttpStatus.OK)
  restoreSku(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.products.restoreSku(
      requireAdminCatalogRequest(rawRequest),
      parseProductId(skuIdValue, 'sku_id'),
      parseSkuRestoreBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
