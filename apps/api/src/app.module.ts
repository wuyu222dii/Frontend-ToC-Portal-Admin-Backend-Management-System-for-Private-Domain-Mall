import { MiddlewareConsumer, Module, RequestMethod, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { HealthModule } from './health/health.module';
import { RbacGuard } from './platform/access/rbac.guard';
import { AccessLogMiddleware } from './platform/http/access-log.middleware';
import { ErrorEnvelopeFilter } from './platform/http/error-envelope.filter';
import { RequestIdMiddleware } from './platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from './platform/http/success-envelope.interceptor';

@Module({
  imports: [HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
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
