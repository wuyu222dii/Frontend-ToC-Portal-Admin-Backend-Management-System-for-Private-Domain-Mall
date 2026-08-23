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

import { NoStore } from '../admin-auth/no-store.decorator';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import {
  parseBrandCreateBody,
  parseBrandUpdateBody,
  parseCatalogId,
  parseCatalogListQuery,
  parseCategoryCreateBody,
  parseCategoryUpdateBody,
  parseLifecycleConfirmationBody,
  parseLifecyclePreviewBody,
  parseRestoreBody,
} from './admin-catalog.dto';
import { requireAdminCatalogRequest } from './admin-catalog.request';
import { AdminCatalogService } from './admin-catalog.service';

@Controller('admin')
@RequireRoles('SUPER_ADMIN')
export class AdminCatalogController {
  constructor(@Inject(AdminCatalogService) private readonly catalog: AdminCatalogService) {}

  @Get('brands')
  listBrands(@Query() query: unknown) {
    return this.catalog.listBrands(parseCatalogListQuery(query));
  }

  @Post('brands') @HttpCode(HttpStatus.CREATED)
  createBrand(
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.createBrand(
      requireAdminCatalogRequest(rawRequest),
      parseBrandCreateBody(body),
      idempotencyKey,
    );
  }

  @Get('brands/:brand_id')
  getBrand(@Param('brand_id') brandIdValue: string) {
    return this.catalog.getBrand(parseCatalogId(brandIdValue, 'brand_id'));
  }

  @Patch('brands/:brand_id')
  updateBrand(
    @Param('brand_id') brandIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.updateBrand(
      requireAdminCatalogRequest(rawRequest),
      parseCatalogId(brandIdValue, 'brand_id'),
      parseBrandUpdateBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('brands/:brand_id/lifecycle-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewBrandLifecycle(
    @Param('brand_id') brandIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.previewLifecycle(
      requireAdminCatalogRequest(rawRequest),
      'BRAND',
      parseCatalogId(brandIdValue, 'brand_id'),
      parseLifecyclePreviewBody(body),
      idempotencyKey,
    );
  }

  @Post('brands/:brand_id/lifecycle-changes') @HttpCode(HttpStatus.OK)
  confirmBrandLifecycle(
    @Param('brand_id') brandIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.confirmLifecycle(
      requireAdminCatalogRequest(rawRequest),
      'BRAND',
      parseCatalogId(brandIdValue, 'brand_id'),
      parseLifecycleConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('brands/:brand_id/restore') @HttpCode(HttpStatus.OK)
  restoreBrand(
    @Param('brand_id') brandIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.restore(
      requireAdminCatalogRequest(rawRequest),
      'BRAND',
      parseCatalogId(brandIdValue, 'brand_id'),
      parseRestoreBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Get('categories')
  listCategories(@Query() query: unknown) {
    return this.catalog.listCategories(parseCatalogListQuery(query));
  }

  @Post('categories') @HttpCode(HttpStatus.CREATED)
  createCategory(
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.createCategory(
      requireAdminCatalogRequest(rawRequest),
      parseCategoryCreateBody(body),
      idempotencyKey,
    );
  }

  @Get('categories/:category_id')
  getCategory(@Param('category_id') categoryIdValue: string) {
    return this.catalog.getCategory(parseCatalogId(categoryIdValue, 'category_id'));
  }

  @Patch('categories/:category_id')
  updateCategory(
    @Param('category_id') categoryIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.updateCategory(
      requireAdminCatalogRequest(rawRequest),
      parseCatalogId(categoryIdValue, 'category_id'),
      parseCategoryUpdateBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('categories/:category_id/lifecycle-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewCategoryLifecycle(
    @Param('category_id') categoryIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.previewLifecycle(
      requireAdminCatalogRequest(rawRequest),
      'CATEGORY',
      parseCatalogId(categoryIdValue, 'category_id'),
      parseLifecyclePreviewBody(body),
      idempotencyKey,
    );
  }

  @Post('categories/:category_id/lifecycle-changes') @HttpCode(HttpStatus.OK)
  confirmCategoryLifecycle(
    @Param('category_id') categoryIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.confirmLifecycle(
      requireAdminCatalogRequest(rawRequest),
      'CATEGORY',
      parseCatalogId(categoryIdValue, 'category_id'),
      parseLifecycleConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post('categories/:category_id/restore') @HttpCode(HttpStatus.OK)
  restoreCategory(
    @Param('category_id') categoryIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.catalog.restore(
      requireAdminCatalogRequest(rawRequest),
      'CATEGORY',
      parseCatalogId(categoryIdValue, 'category_id'),
      parseRestoreBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
