import {
  Body,
  Controller,
  Delete,
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
import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import {
  parseBannerCreateBody,
  parseBannerId,
  parseBannerListQuery,
  parseBannerPatchBody,
  parseBannerReasonBody,
} from './admin-banners.dto';
import { AdminBannersService } from './admin-banners.service';

@Controller('admin/banners')
@RequireRoles('SUPER_ADMIN')
export class AdminBannersController {
  constructor(@Inject(AdminBannersService) private readonly banners: AdminBannersService) {}

  @Get()
  listBanners(@Query() query: unknown) {
    return this.banners.listBanners(parseBannerListQuery(query));
  }

  @Post() @HttpCode(HttpStatus.CREATED) @NoStore()
  createBanner(
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.banners.createBanner(
      requireAdminCatalogRequest(rawRequest),
      parseBannerCreateBody(body),
      idempotencyKey,
    );
  }

  @Patch(':banner_id') @HttpCode(HttpStatus.OK) @NoStore()
  patchBanner(
    @Param('banner_id') bannerIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.banners.patchBanner(
      requireAdminCatalogRequest(rawRequest),
      parseBannerId(bannerIdValue),
      parseBannerPatchBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Delete(':banner_id') @HttpCode(HttpStatus.OK) @NoStore()
  archiveBanner(
    @Param('banner_id') bannerIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.banners.archiveBanner(
      requireAdminCatalogRequest(rawRequest),
      parseBannerId(bannerIdValue),
      parseBannerReasonBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post(':banner_id/restore') @HttpCode(HttpStatus.OK) @NoStore()
  restoreBanner(
    @Param('banner_id') bannerIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.banners.restoreBanner(
      requireAdminCatalogRequest(rawRequest),
      parseBannerId(bannerIdValue),
      parseBannerReasonBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
