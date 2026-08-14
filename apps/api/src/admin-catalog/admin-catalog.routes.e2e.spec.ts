import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApi } from '../platform/http/configure-api';

const id = '01J00000000000000000000000';
const key = '00000000-0000-4000-8000-000000000000';

describe('B3.2 admin catalog protected HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it.each([
    '/api/v1/admin/brands',
    `/api/v1/admin/brands/${id}`,
    '/api/v1/admin/categories',
    `/api/v1/admin/categories/${id}`,
  ])('protects GET %s with the SUPER_ADMIN bearer boundary', async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    ['/api/v1/admin/brands', { initial_status: 'DRAFT', name: 'Brand', sort_order: 0 }],
    ['/api/v1/admin/categories', { initial_status: 'DRAFT', name: 'Category', sort_order: 0 }],
  ])('protects create POST %s', async (path, body) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key).send(body).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    [`/api/v1/admin/brands/${id}`, { name: 'Updated brand' }],
    [`/api/v1/admin/categories/${id}`, { name: 'Updated category' }],
  ])('protects versioned PATCH %s', async (path, body) => {
    const response = await request(app.getHttpServer()).patch(path)
      .set('Idempotency-Key', key).set('If-Match', '"1"').send(body).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    `/api/v1/admin/brands/${id}/lifecycle-preview`,
    `/api/v1/admin/categories/${id}/lifecycle-preview`,
  ])('protects and disables caching for lifecycle preview POST %s', async (path) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key)
      .send({ action: 'DEACTIVATE', reason: 'Portfolio change' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it.each([
    `/api/v1/admin/brands/${id}/lifecycle-changes`,
    `/api/v1/admin/categories/${id}/lifecycle-changes`,
  ])('protects versioned lifecycle confirmation POST %s', async (path) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key)
      .set('If-Match', '"1"')
      .send({
        action: 'DEACTIVATE',
        confirmation_hash: 'a'.repeat(64),
        preview_token: `pvw_${'b'.repeat(43)}`,
        reason: 'Portfolio change',
      })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    `/api/v1/admin/brands/${id}/restore`,
    `/api/v1/admin/categories/${id}/restore`,
  ])('protects versioned restore POST %s', async (path) => {
    const response = await request(app.getHttpServer()).post(path)
      .set('Idempotency-Key', key).set('If-Match', '"1"').send({ reason: 'Resume' }).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });
});
