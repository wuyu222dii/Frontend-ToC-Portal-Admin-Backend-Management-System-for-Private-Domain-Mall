import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApi } from '../platform/http/configure-api';

const key = '00000000-0000-4000-8000-000000000000';

describe('B2 admin authentication HTTP surface', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });
  afterAll(async () => app.close());

  it.each([
    ['/api/v1/admin/auth/login', { login_name: 'admin', password: 'password123' }],
    ['/api/v1/admin/auth/refresh', { refresh_token: 'rfr_00000000000000000000' }],
  ])('maps public POST %s and requires Idempotency-Key', async (path, body) => {
    const response = await request(app.getHttpServer()).post(path).send(body).expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
  });

  it.each([
    ['/api/v1/admin/auth/logout', undefined],
    ['/api/v1/admin/auth/logout-all', undefined],
    ['/api/v1/admin/auth/change-password', { current_password: 'old', new_password: 'new-password-123' }],
    ['/api/v1/admin/auth/mfa/totp/enroll', {}],
    ['/api/v1/admin/auth/mfa/totp/enroll/verify', { challenge_id: '01J00000000000000000000002', totp_code: '123456' }],
    ['/api/v1/admin/auth/mfa/challenges/01J00000000000000000000002/verify',
      { challenge_id: '01J00000000000000000000002', totp_code: '123456' }],
    ['/api/v1/admin/auth/mfa/recovery', { challenge_id: '01J00000000000000000000002', recovery_code: 'AAAA-BBBB' }],
    ['/api/v1/admin/auth/mfa/recovery-codes/rotate', { totp_code: '123456' }],
  ])('maps protected/pre-auth POST %s', async (path, body) => {
    let probe = request(app.getHttpServer()).post(path).set('Idempotency-Key', key);
    if (body !== undefined) probe = probe.send(body);
    const response = await probe.expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it('maps current and excludes deferred REAUTH routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/auth/current').expect(401);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/mfa/challenges').set('Idempotency-Key', key).send({ purpose: 'REAUTH' }).expect(404);
    await request(app.getHttpServer()).post('/api/v1/admin/auth/reauth').set('Idempotency-Key', key).send({}).expect(404);
  });

  it('sets no-store on every sensitive route even when authentication fails', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/auth/mfa/totp/enroll')
      .set('Idempotency-Key', key).send({}).expect(401);
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });
});
