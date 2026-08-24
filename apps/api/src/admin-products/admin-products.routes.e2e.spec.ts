import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { type RbacPrincipal } from '@qingxu/platform-core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../app.module';
import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';

const productId = '01J00000000000000000000000';
const skuId = '01J00000000000000000000001';
const brandId = '01J00000000000000000000002';
const categoryId = '01J00000000000000000000003';
const key = '00000000-0000-4000-8000-000000000000';
const deniedListProducts = vi.fn();
const authenticatedCustomer: RbacPrincipal = {
  accountId: 'customer_1',
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId: 'session_customer_1',
};

@Injectable()
class AuthenticatedCustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<PrincipalRequest>().principal = authenticatedCustomer;
    return true;
  }
}

@Module({
  controllers: [AdminProductsController],
  providers: [
    { provide: AdminProductsService, useValue: { listProducts: deniedListProducts } },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticatedCustomerGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class WrongRoleProductsTestModule {}

describe('B4.2 admin products protected HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it.each([
    '/api/v1/admin/products',
    `/api/v1/admin/products/${productId}`,
  ])('protects GET %s with the SUPER_ADMIN bearer boundary', async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('protects product creation', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/products')
      .set('Idempotency-Key', key)
      .send({
        brand_id: brandId,
        category_id: categoryId,
        images: [],
        initial_status: 'DRAFT',
        name: 'Daily wash',
        spu_code: 'SPU-001',
      })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('protects versioned product updates', async () => {
    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/products/${productId}`)
      .set('Idempotency-Key', key)
      .set('If-Match', '"1"')
      .send({ name: 'Updated daily wash' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('protects SKU creation', async () => {
    const response = await request(app.getHttpServer()).post(`/api/v1/admin/products/${productId}/skus`)
      .set('Idempotency-Key', key)
      .send({
        code: 'SKU-001',
        initial_status: 'INACTIVE',
        name: '500 ml',
        retail_price: '19.90',
      })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('protects versioned SKU updates', async () => {
    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/skus/${skuId}`)
      .set('Idempotency-Key', key)
      .set('If-Match', '"1"')
      .send({ name: 'Updated 500 ml' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    [`/api/v1/admin/products/${productId}/lifecycle-preview`, 'ACTIVATE'],
    [`/api/v1/admin/skus/${skuId}/lifecycle-preview`, 'ACTIVATE'],
  ])('protects and disables caching for lifecycle preview POST %s', async (path, action) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key)
      .send({ action, reason: 'Approved catalog transition' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it.each([
    [`/api/v1/admin/products/${productId}/lifecycle-changes`, 'ACTIVATE'],
    [`/api/v1/admin/skus/${skuId}/lifecycle-changes`, 'ACTIVATE'],
  ])('protects versioned lifecycle confirmation POST %s', async (path, action) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key)
      .set('If-Match', '"1"')
      .send({
        action,
        confirmation_hash: 'a'.repeat(64),
        preview_token: `pvw_${'b'.repeat(43)}`,
        reason: 'Approved catalog transition',
      })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    `/api/v1/admin/products/${productId}/restore`,
    `/api/v1/admin/skus/${skuId}/restore`,
  ])('protects versioned restore POST %s', async (path) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key)
      .set('If-Match', '"4"')
      .send({ reason: 'Resume catalog preparation' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });
});

describe('B4.4 admin products wrong-role HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WrongRoleProductsTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => deniedListProducts.mockClear());

  afterAll(async () => app.close());

  it('returns the frozen 403 envelope before Product service dispatch for an authenticated CUSTOMER', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/products').expect(403);

    expect(response.body).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Permission denied',
      request_id: response.headers['x-request-id'],
    });
    expect(response.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
    expect(JSON.stringify(response.body)).not.toMatch(/customer_1|SUPER_ADMIN|stack|role/i);
    expect(deniedListProducts).not.toHaveBeenCalled();
  });
});
