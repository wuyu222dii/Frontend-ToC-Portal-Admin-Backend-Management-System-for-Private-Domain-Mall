import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AdminCatalogModule } from './admin-catalog/admin-catalog.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import { AdminBannersModule } from './admin-banners/admin-banners.module';
import { AdminInventoryModule } from './admin-inventory/admin-inventory.module';
import { AdminProductsModule } from './admin-products/admin-products.module';
import { HealthModule } from './health/health.module';
import { FilesModule } from './files/files.module';
import { RbacGuard } from './platform/access/rbac.guard';
import { AuthenticationGuard } from './platform/auth/authentication.guard';
import { AccessLogMiddleware } from './platform/http/access-log.middleware';
import { ErrorEnvelopeFilter } from './platform/http/error-envelope.filter';
import { RequestIdMiddleware } from './platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from './platform/http/success-envelope.interceptor';
import { StoreCatalogModule } from './store-catalog/store-catalog.module';
import { StoreCartModule } from './store-cart/store-cart.module';
import { StoreFavoritesModule } from './store-favorites/store-favorites.module';
import { StoreAttributionModule } from './store-attribution/store-attribution.module';
import { StoreAuthModule } from './store-auth/store-auth.module';
import { StoreProfileModule } from './store-profile/store-profile.module';
import { StorePrivacyModule } from './store-privacy/store-privacy.module';

@Module({
  imports: [
    AdminAuthModule,
    AdminBannersModule,
    AdminCatalogModule,
    AdminInventoryModule,
    AdminProductsModule,
    FilesModule,
    HealthModule,
    StoreAttributionModule,
    StoreCatalogModule,
    StoreCartModule,
    StoreFavoritesModule,
    StoreAuthModule,
    StorePrivacyModule,
    StoreProfileModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, AccessLogMiddleware).forRoutes({
      method: RequestMethod.ALL,
      path: '{*path}',
    });
  }
}
