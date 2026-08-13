import type { INestApplication, NestMiddleware } from '@nestjs/common';
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApplicationError, type RbacPrincipal } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import type { PrincipalRequest } from '../access/principal';
import { Public, RequirePermissions, RequireRoles } from '../access/rbac.metadata';
import { configureApi } from './configure-api';
import { IdempotencyKey } from './idempotency-key.decorator';
import { IfMatchVersion } from './if-match.decorator';

let testPrincipal: RbacPrincipal | undefined;
const SENSITIVE_PHONE = ['138', '1234', '5678'].join('');

@Injectable()
class TestPrincipalMiddleware implements NestMiddleware {
  use(requestValue: PrincipalRequest, _response: unknown, next: () => void): void {
    if (testPrincipal !== undefined) {
      requestValue.principal = testPrincipal;
    }
    next();
  }
}

@Controller('platform-probe')
class PlatformProbeController {
  @Get('success')
  @Public()
  success(): { value: string } {
    return { value: 'ready' };
  }

  @Post('payload')
  @Public()
  payload(): { accepted: true } {
    return { accepted: true };
  }

  @Get('no-content')
  @Public()
  @HttpCode(204)
  noContent(): void {}

  @Get('bad-request')
  @Public()
  badRequest(): never {
    throw new BadRequestException('never expose controller exception text');
  }

  @Get('application-error')
  @Public()
  applicationError(): never {
    throw new ApplicationError('STATE_CONFLICT', 'The requested transition is not allowed', [
      { field: 'status', reason: 'The resource is already closed', rejected_value: 'CLOSED' },
    ]);
  }

  @Get('crash')
  @Public()
  crash(): never {
    throw new Error('postgresql://user:secret@example.test/db provider raw payload');
  }

  @Get('trusted-internal-error')
  @Public()
  trustedInternalError(): never {
    throw new ApplicationError('INTERNAL_ERROR', 'provider-sensitive-marker', [
      { field: 'credential', reason: 'private detail', rejected_value: 'private value' },
    ]);
  }

  @Get('role')
  @RequireRoles('SUPER_ADMIN')
  role(): { allowed: true } {
    return { allowed: true };
  }

  @Get('permission')
  @RequirePermissions('ORDER_FULFILLMENT_PII_READ')
  permission(): { allowed: true } {
    return { allowed: true };
  }

  @Get('if-match')
  @Public()
  ifMatch(@IfMatchVersion() version: number): { version: number } {
    return { version };
  }

  @Get('idempotency-key')
  @Public()
  idempotencyKey(@IdempotencyKey() key: string): { key: string } {
    return { key };
  }

  @Get('sensitive-client-error')
  @Public()
  sensitiveClientError(): never {
    throw new ApplicationError('INVALID_ARGUMENT', `contact ${SENSITIVE_PHONE}`, [
      {
        field: 'If-Match',
        reason: 'Expected a strong ETag',
        rejected_value: 'postgresql://mall_runtime:server-secret@example.test/postgres',
      },
    ]);
  }

  @Get('rate-limited')
  @Public()
  rateLimited(): never {
    throw new ApplicationError('RATE_LIMITED', 'Internal rate-limit detail');
  }
}

@Module({
  imports: [AppModule],
  controllers: [PlatformProbeController],
  providers: [TestPrincipalMiddleware],
})
class PlatformHttpTestModule {}

describe('API platform HTTP pipeline (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PlatformHttpTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.use((requestValue: PrincipalRequest, _response: unknown, next: () => void) => {
      new TestPrincipalMiddleware().use(requestValue, _response, next);
    });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    testPrincipal = undefined;
  });

  afterAll(async () => {
    await app.close();
  });

  it('wraps a business success and preserves a safe client request ID', async () => {
    const requestId = 'trace_0123456789abcdef0123456789abcdef';
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/success')
      .set('X-Request-Id', requestId)
      .expect(200);

    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body).toEqual({
      code: 'OK',
      data: { value: 'ready' },
      message: 'success',
      request_id: requestId,
    });
  });

  it('generates a request ID and does not write a body for HTTP 204', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/no-content')
      .expect(204);

    expect(response.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
    expect(response.text).toBe('');
  });

  it('keeps the internal health probe unprefixed and unwrapped', async () => {
    const response = await request(app.getHttpServer()).get('/internal/health').expect(200);

    expect(response.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
    expect(response.body).toEqual({ service: 'api', status: 'ok' });
    await request(app.getHttpServer()).get('/api/v1/internal/health').expect(404);
  });

  it('maps framework exceptions to the frozen error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/bad-request')
      .expect(400);

    expect(response.body).toEqual({
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
      request_id: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toContain('controller exception');
  });

  it('preserves an unmapped client-error status without turning it into a 5xx', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/platform-probe/payload')
      .set('Content-Type', 'application/json')
      .send({ value: 'x'.repeat(150 * 1_024) })
      .expect(413);

    expect(response.body).toEqual({
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
      request_id: response.headers['x-request-id'],
    });
  });

  it('preserves trusted business error details as an array', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/application-error')
      .expect(409);

    expect(response.body).toEqual({
      code: 'STATE_CONFLICT',
      details: [
        { field: 'status', reason: 'The value was rejected', rejected_value: null },
      ],
      message: 'The resource state conflicts with this request',
      request_id: response.headers['x-request-id'],
    });
  });

  it('never exposes an unknown exception or its stack', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/crash')
      .expect(500);

    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/postgresql|secret|provider|stack/i);
  });

  it('sanitizes even a trusted application error with a 5xx code', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/trusted-internal-error')
      .expect(500);

    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      request_id: response.headers['x-request-id'],
    });
    expect(JSON.stringify(response.body)).not.toMatch(/provider|credential|private/i);
  });

  it('fails closed on protected routes when the authentication runtime is absent', async () => {
    const missing = await request(app.getHttpServer()).get('/api/v1/platform-probe/role').expect(401);
    expect(missing.body.code).toBe('AUTH_REQUIRED');

    testPrincipal = {
      accountId: 'customer_1',
      assurance: 'WECHAT',
      permissions: [],
      restriction: 'NONE',
      role: 'CUSTOMER',
      sessionId: 'session_customer',
    };
    const denied = await request(app.getHttpServer()).get('/api/v1/platform-probe/role').expect(401);
    expect(denied.body.code).toBe('AUTH_REQUIRED');

    testPrincipal = { ...testPrincipal, role: 'SUPER_ADMIN' };
    const stillDenied = await request(app.getHttpServer()).get('/api/v1/platform-probe/role').expect(401);
    expect(stillDenied.body.code).toBe('AUTH_REQUIRED');
  });

  it('does not treat a middleware-injected permission as authentication', async () => {
    testPrincipal = {
      accountId: 'admin_1',
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: 'session_admin',
    };
    await request(app.getHttpServer()).get('/api/v1/platform-probe/permission').expect(401);

    testPrincipal = { ...testPrincipal, permissions: ['ORDER_FULFILLMENT_PII_READ'] };
    await request(app.getHttpServer()).get('/api/v1/platform-probe/permission').expect(401);
  });

  it('parses only the frozen strong quoted If-Match form', async () => {
    const valid = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/if-match')
      .set('If-Match', '"12"')
      .expect(200);
    expect(valid.body.data).toEqual({ version: 12 });

    for (const value of ['1', 'W/"1"', '*', '"0"', '"01"', '"2147483648"']) {
      const invalid = await request(app.getHttpServer())
        .get('/api/v1/platform-probe/if-match')
        .set('If-Match', value)
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_ARGUMENT');
      expect(invalid.body.details).toEqual([expect.objectContaining({ field: 'If-Match' })]);
    }

    const missing = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/if-match')
      .expect(400);
    expect(missing.body.code).toBe('INVALID_ARGUMENT');
  });

  it('parses one UUID Idempotency-Key and rejects missing or malformed values', async () => {
    const valid = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/idempotency-key')
      .set('Idempotency-Key', '9B2C3D4E-5F60-4781-9234-56789ABCDEF0')
      .expect(200);
    expect(valid.body.data).toEqual({ key: '9b2c3d4e-5f60-4781-9234-56789abcdef0' });

    for (const value of ['not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
      const invalid = await request(app.getHttpServer())
        .get('/api/v1/platform-probe/idempotency-key')
        .set('Idempotency-Key', value)
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_ARGUMENT');
      expect(invalid.body.details).toEqual([
        expect.objectContaining({ field: 'Idempotency-Key' }),
      ]);
    }

    const missing = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/idempotency-key')
      .expect(400);
    expect(missing.body.code).toBe('INVALID_ARGUMENT');
  });

  it('does not reflect sensitive client input through a 4xx envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/sensitive-client-error')
      .expect(400);

    expect(response.body).toEqual({
      code: 'INVALID_ARGUMENT',
      message: 'The request is invalid',
      request_id: response.headers['x-request-id'],
      details: [
        { field: 'If-Match', reason: 'The value was rejected', rejected_value: null },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain(SENSITIVE_PHONE);
    expect(JSON.stringify(response.body)).not.toMatch(/server-secret|postgresql/i);
  });

  it('returns the frozen fifteen-minute retry interval for authentication locks', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/platform-probe/rate-limited')
      .expect(429);

    expect(response.headers['retry-after']).toBe('900');
    expect(response.body.code).toBe('RATE_LIMITED');
  });
});
