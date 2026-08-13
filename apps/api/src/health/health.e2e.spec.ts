import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApi } from '../platform/http/configure-api';

describe('API health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the internal readiness contract over HTTP', async () => {
    const response = await request(app.getHttpServer()).get('/internal/health').expect(200);
    expect(response.body).toEqual({ service: 'api', status: 'ok' });
  });
});
