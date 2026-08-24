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
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import {
  parseProductCreateBody,
  parseProductId,
  parseProductListQuery,
  parseProductUpdateBody,
  parseSkuCreateBody,
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
}
