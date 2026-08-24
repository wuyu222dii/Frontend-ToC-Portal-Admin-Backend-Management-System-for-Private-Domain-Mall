import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApi } from '../platform/http/configure-api';

const productId = '01J00000000000000000000000';
const skuId = '01J00000000000000000000001';
const brandId = '01J00000000000000000000002';
const categoryId = '01J00000000000000000000003';
const key = '00000000-0000-4000-8000-000000000000';

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
