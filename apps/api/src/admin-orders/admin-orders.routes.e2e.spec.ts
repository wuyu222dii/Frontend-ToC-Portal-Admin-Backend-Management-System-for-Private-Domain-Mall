import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import {
  ApplicationError,
  type RbacPrincipal,
  signAccessToken,
  signStoreAccessToken,
} from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { AuthenticationGuard } from '../platform/auth/authentication.guard';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { RequestIdMiddleware } from '../platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { AdminOrdersController, AdminShipmentsController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

const accountId = '01J00000000000000000000000';
const orderId = '01J00000000000000000000001';
const customerId = '01J00000000000000000000002';
const agentId = '01J00000000000000000000003';
const factorId = '01J00000000000000000000004';
const sessionId = '01J00000000000000000000005';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const adminAccessJti = 'access:01J00000000000000000000008';
const customerAccessJti = 'access:01J00000000000000000000009';
const orderItemId = '01J0000000000000000000000A';
const shipmentId = '01J0000000000000000000000B';
const idempotencyKey = '00000000-0000-4000-8000-000000000001';

const listResult = {
  items: [],
  pagination: { page: 2, page_size: 50, total: 0 },
};
const detailResult = { order_id: orderId, order_no: `QX${orderId}` };
const addressResult = {
  access_expires_at: '2026-08-31T05:05:00.000Z',
  city: 'Example City',
  detail: 'Example development address',
  district: 'Example District',
  order_id: orderId,
  order_no: `QX${orderId}`,
  phone: '[redacted-fixture]',
  province: 'Example Province',
  purpose: 'ORDER_FULFILLMENT',
  recipient_name: 'Development Recipient',
  snapshot_at: '2026-08-31T04:00:00.000Z',
  snapshot_id: '01J00000000000000000000006',
};
const shipmentResult = {
  carrier_code: 'DEV',
  carrier_name: 'Development Carrier',
  delivered_at: null,
  items: [{ order_item_id: orderItemId, quantity: 1 }],
  order_id: orderId,
  shipment_id: shipmentId,
  shipped_at: '2026-08-31T04:00:00.000Z',
  status: 'SHIPPED',
  tracking_no: 'DEV-TRACK-001',
  version: 1,
};
const logisticsResult = {
  events: [{
    carrier_code: null,
    carrier_name: null,
    description: 'Accepted by carrier',
    event_id: '01J0000000000000000000000C',
    event_key: 'evt_fixture',
    event_type: 'STATUS',
    location: 'Auckland',
    occurred_at: '2026-08-31T04:05:00.000Z',
    reason: null,
    status_code: 'IN_TRANSIT',
    tracking_no: null,
  }],
  shipment: { ...shipmentResult, status: 'IN_TRANSIT', version: 2 },
};

const listOrders = vi.fn().mockResolvedValue(listResult);
const getOrder = vi.fn().mockResolvedValue(detailResult);
const getFulfillmentAddress = vi.fn().mockResolvedValue(addressResult);
const completeOrder = vi.fn().mockResolvedValue(detailResult);
const createShipment = vi.fn().mockResolvedValue(shipmentResult);
const appendLogisticsEvent = vi.fn().mockResolvedValue(logisticsResult);
const service = {
  appendLogisticsEvent,
  completeOrder,
  createShipment,
  getFulfillmentAddress,
  getOrder,
  listOrders,
};

const superAdmin: RbacPrincipal = {
  accountId,
  assurance: 'MFA',
  permissions: ['ORDER_FULFILLMENT_PII_READ'],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId,
};

const agentAdmin: RbacPrincipal = {
  accountId,
  assurance: 'MFA',
  permissions: ['ORDER_FULFILLMENT_PII_READ'],
  restriction: 'NONE',
  role: 'AGENT_ADMIN',
  sessionId,
};

const authenticationSigningKeys = {
  current: { id: 'admin-orders-route-v1', key: Buffer.alloc(32, 91) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-admin-orders-route-test',
    signingKeys: authenticationSigningKeys,
  },
  store: { authTokenAudience: 'qingxu-store' },
} as unknown as PlatformRuntimeConfig;
const adminToken = signAccessToken({
  audience: runtimeConfig.authentication.audience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId,
  assurance: 'MFA',
  permissions: ['ORDER_FULFILLMENT_PII_READ'],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId,
  tokenId: adminAccessJti,
}, 3_600).token;
const customerToken = signStoreAccessToken({
  audience: runtimeConfig.store.authTokenAudience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId,
  tokenId: customerAccessJti,
}, 3_600).token;
const findAuthSession = vi.fn();
const authenticationDatabase = {
  prisma: { authSession: { findUnique: findAuthSession } },
} as unknown as DatabaseRuntime;

function adminSessionRow() {
  return {
    access_jti: adminAccessJti,
    account: {
      deleted_at: null,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      version: 1,
    },
    account_id: accountId,
    assurance: 'MFA',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: sessionId,
    mfa_factor: {
      account_id: accountId,
      encryption_key_id: 'field-current',
      id: factorId,
      last_used_timestep: null,
      secret_ciphertext: Buffer.from('encrypted-factor-fixture'),
      status: 'ACTIVE',
    },
    mfa_factor_id: factorId,
    mfa_verified_at: new Date('2026-08-31T04:00:00.000Z'),
    restriction: 'NONE',
    revoked_at: null,
    session_family: '01J00000000000000000000007',
  };
}

function setAuthenticatedRequest(requestValue: PrincipalRequest, principal: RbacPrincipal): void {
  requestValue.principal = principal;
  requestValue.requestId = requestId;
  requestValue.accessSession = {
    accountId,
    accountVersion: 1,
    accessJti: 'access-jti',
    expiresAt: new Date('2026-08-31T06:00:00.000Z'),
    factorEncryptionKeyId: 'key',
    factorId,
    factorLastUsedTimestep: null,
    factorSecretCiphertext: new Uint8Array(),
    mfaVerifiedAt: new Date('2026-08-31T04:00:00.000Z'),
    sessionFamily: '01J00000000000000000000007',
    sessionId,
  };
}

@Injectable()
class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setAuthenticatedRequest(context.switchToHttp().getRequest<PrincipalRequest>(), superAdmin);
    return true;
  }
}

@Injectable()
class AgentAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setAuthenticatedRequest(context.switchToHttp().getRequest<PrincipalRequest>(), agentAdmin);
    return true;
  }
}

@Module({
  controllers: [AdminOrdersController, AdminShipmentsController],
  providers: [
    { provide: AdminOrdersService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class UnauthenticatedOrdersTestModule {}

@Module({
  controllers: [AdminOrdersController, AdminShipmentsController],
  providers: [
    { provide: AdminOrdersService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class SuperAdminOrdersTestModule {}

@Module({
  controllers: [AdminOrdersController, AdminShipmentsController],
  providers: [
    { provide: AdminOrdersService, useValue: service },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: authenticationDatabase },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class RealAuthenticationOrdersTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

@Module({
  controllers: [AdminOrdersController, AdminShipmentsController],
  providers: [
    { provide: AdminOrdersService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AgentAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class WrongRoleOrdersTestModule {}

function expectNoStore(headers: Record<string, string | string[] | undefined>): void {
  expect(headers['cache-control']).toBe('no-store, private');
  expect(headers.pragma).toBe('no-cache');
}

describe('B11.1 Admin orders protected HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UnauthenticatedOrdersTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => app.close());

  it.each([
    ['list', () => request(app.getHttpServer()).get('/api/v1/admin/orders?page=0')],
    ['detail', () => request(app.getHttpServer()).get('/api/v1/admin/orders/not-an-order')],
    ['fulfillment address', () => request(app.getHttpServer())
      .get('/api/v1/admin/orders/not-an-order/fulfillment-address')],
    ['order completion', () => request(app.getHttpServer())
      .post('/api/v1/admin/orders/not-an-order/complete')],
    ['shipment creation', () => request(app.getHttpServer())
      .post('/api/v1/admin/orders/not-an-order/shipments')],
    ['logistics event', () => request(app.getHttpServer())
      .post('/api/v1/admin/shipments/not-a-shipment/events')],
  ] as const)(
    'returns 401 with no-store before %s parsing or service dispatch',
    async (_operation, build) => {
      const response = await build().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response.headers);
      expect(listOrders).not.toHaveBeenCalled();
      expect(getOrder).not.toHaveBeenCalled();
      expect(getFulfillmentAddress).not.toHaveBeenCalled();
      expect(completeOrder).not.toHaveBeenCalled();
      expect(createShipment).not.toHaveBeenCalled();
      expect(appendLogisticsEvent).not.toHaveBeenCalled();
    },
  );

});

describe('B11.1 Admin orders SUPER_ADMIN HTTP mapping', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SuperAdminOrdersTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listOrders.mockResolvedValue(listResult);
    getOrder.mockResolvedValue(detailResult);
    getFulfillmentAddress.mockResolvedValue(addressResult);
    completeOrder.mockResolvedValue(detailResult);
    createShipment.mockResolvedValue(shipmentResult);
    appendLogisticsEvent.mockResolvedValue(logisticsResult);
  });

  afterAll(async () => app.close());

  it('maps the closed list query and returns the success envelope with no-store', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/orders')
      .query({
        agent_id: agentId,
        customer_id: customerId,
        date_from: '2026-08-25',
        date_to: '2026-08-26',
        fulfillment_status: 'IN_TRANSIT',
        max_amount: '999.99',
        min_amount: '19.90',
        order_no: `  QX${orderId}  `,
        order_status: 'SHIPPING',
        page: '2',
        page_size: '50',
        payment_status: 'PAID',
        refund_processing_status: 'REFUNDING',
        refund_progress_status: 'PARTIAL',
        sort: 'AMOUNT_DESC',
      })
      .expect(200);

    expect(listOrders).toHaveBeenCalledWith({
      agentId,
      createdAtFrom: new Date('2026-08-24T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
      customerId,
      fulfillmentStatus: 'IN_TRANSIT',
      maxAmount: '999.99',
      minAmount: '19.90',
      orderNo: `QX${orderId}`,
      orderStatus: 'SHIPPING',
      page: 2,
      pageSize: 50,
      paymentStatus: 'PAID',
      refundProcessingStatus: 'REFUNDING',
      refundProgressStatus: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    });
    expect(response.body).toEqual({
      code: 'OK',
      data: listResult,
      message: 'success',
      request_id: requestId,
    });
    expectNoStore(response.headers);
  });

  it('maps a ULID detail route and returns no-store', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}`)
      .expect(200);

    expect(getOrder).toHaveBeenCalledWith(orderId);
    expect(response.body.data).toEqual(detailResult);
    expectNoStore(response.headers);
  });

  it('forwards the authenticated context and raw controlled-address headers with no-store', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}/fulfillment-address`)
      .set('X-Access-Purpose', 'ORDER_FULFILLMENT')
      .set('X-Access-Reason', 'Prepare the development parcel')
      .expect(200);

    expect(getFulfillmentAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        accessSession: expect.objectContaining({ accountId, sessionId }),
        principal: superAdmin,
        requestId,
      }),
      orderId,
      'ORDER_FULFILLMENT',
      'Prepare the development parcel',
    );
    expect(response.body.data).toEqual(addressResult);
    expectNoStore(response.headers);
  });

  it('maps the closed shipment command to 201 with SUPER_ADMIN context and no-store', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/shipments`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({
        carrier_code: ' DEV ',
        carrier_name: ' Development Carrier ',
        items: [{ order_item_id: orderItemId, quantity: 1 }],
        tracking_no: ' DEV-TRACK-001 ',
      })
      .expect(201);

    expect(createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      orderId,
      {
        carrierCode: 'DEV',
        carrierName: 'Development Carrier',
        items: [{ orderItemId, quantity: 1 }],
        trackingNo: 'DEV-TRACK-001',
      },
      3,
      idempotencyKey,
    );
    expect(response.body).toEqual({
      code: 'OK',
      data: shipmentResult,
      message: 'success',
      request_id: requestId,
    });
    expectNoStore(response.headers);
  });

  it('maps the closed forced-completion command to 200 with SUPER_ADMIN context and no-store', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/complete`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({ completion_reason: 'ADMIN_FORCED', reason: ' Development delivery confirmed ' })
      .expect(200);

    expect(completeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      orderId,
      { completionReason: 'ADMIN_FORCED', reason: 'Development delivery confirmed' },
      3,
      idempotencyKey,
    );
    expect(response.body).toEqual({
      code: 'OK',
      data: detailResult,
      message: 'success',
      request_id: requestId,
    });
    expectNoStore(response.headers);
  });

  it('maps the closed logistics command to 200 with SUPER_ADMIN context and no-store', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/shipments/${shipmentId}/events`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"1"')
      .send({
        description: ' Accepted by carrier ',
        event_type: 'STATUS',
        location: ' Auckland ',
        occurred_at: '2026-08-31T16:05:00+12:00',
        status_code: 'IN_TRANSIT',
      })
      .expect(200);

    expect(appendLogisticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      shipmentId,
      {
        description: 'Accepted by carrier',
        eventType: 'STATUS',
        location: 'Auckland',
        occurredAt: '2026-08-31T04:05:00.000Z',
        statusCode: 'IN_TRANSIT',
      },
      1,
      idempotencyKey,
    );
    expect(response.body).toEqual({
      code: 'OK',
      data: logisticsResult,
      message: 'success',
      request_id: requestId,
    });
    expectNoStore(response.headers);
  });

  it.each([
    ['unknown list query field', () => request(app.getHttpServer())
      .get('/api/v1/admin/orders?include_address=true'), listOrders],
    ['invalid detail order ULID', () => request(app.getHttpServer())
      .get('/api/v1/admin/orders/not-an-order'), getOrder],
    ['invalid address order ULID', () => request(app.getHttpServer())
      .get('/api/v1/admin/orders/not-an-order/fulfillment-address')
      .set('X-Access-Purpose', 'ORDER_FULFILLMENT')
      .set('X-Access-Reason', 'Prepare shipment'), getFulfillmentAddress],
    ['unknown shipment query field', () => request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/shipments?force=true`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({
        carrier_code: 'DEV', carrier_name: 'Carrier', tracking_no: 'TRACK',
        items: [{ order_item_id: orderItemId, quantity: 1 }],
      }), createShipment],
    ['invalid shipment body', () => request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/shipments`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({ carrier_code: 'DEV', carrier_name: 'Carrier', items: [], tracking_no: 'TRACK' }),
    createShipment],
    ['open completion body', () => request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/complete`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({ completion_reason: 'ADMIN_FORCED', extra: true, reason: 'Delivered' }),
    completeOrder],
    ['invalid completion order ULID', () => request(app.getHttpServer())
      .post('/api/v1/admin/orders/not-an-order/complete')
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({ completion_reason: 'ADMIN_FORCED', reason: 'Delivered by administrator' }),
    completeOrder],
    ['unknown completion query field', () => request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/complete?force=true`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({ completion_reason: 'ADMIN_FORCED', reason: 'Delivered by administrator' }),
    completeOrder],
    ['unknown logistics query field', () => request(app.getHttpServer())
      .post(`/api/v1/admin/shipments/${shipmentId}/events?force=true`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"1"')
      .send({
        description: 'Accepted', event_type: 'STATUS', occurred_at: '2026-08-31T04:05:00Z',
        status_code: 'IN_TRANSIT',
      }), appendLogisticsEvent],
    ['invalid logistics If-Match', () => request(app.getHttpServer())
      .post(`/api/v1/admin/shipments/${shipmentId}/events`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '1')
      .send({
        description: 'Accepted', event_type: 'STATUS', occurred_at: '2026-08-31T04:05:00Z',
        status_code: 'IN_TRANSIT',
      }), appendLogisticsEvent],
  ] as const)(
    'returns frozen 400 with no-store before service dispatch for %s',
    async (_label, build, serviceMethod) => {
      const response = await build().expect(400);
      expect(response.body).toMatchObject({ code: 'INVALID_ARGUMENT', request_id: requestId });
      expectNoStore(response.headers);
      expect(serviceMethod).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['order completion', `/api/v1/admin/orders/${orderId}/complete`, {
      completion_reason: 'ADMIN_FORCED',
      reason: 'Delivered by administrator',
    }, completeOrder],
    ['shipment creation', `/api/v1/admin/orders/${orderId}/shipments`, {
      carrier_code: 'DEV',
      carrier_name: 'Carrier',
      items: [{ order_item_id: orderItemId, quantity: 1 }],
      tracking_no: 'TRACK',
    }, createShipment],
    ['logistics event', `/api/v1/admin/shipments/${shipmentId}/events`, {
      description: 'Accepted',
      event_type: 'STATUS',
      occurred_at: '2026-08-31T04:05:00Z',
      status_code: 'IN_TRANSIT',
    }, appendLogisticsEvent],
  ] as const)(
    'closes the %s Idempotency-Key and If-Match header contract',
    async (_label, path, body, serviceMethod) => {
      const cases = [
        { idempotency: undefined, ifMatch: '"3"' },
        { idempotency: 'not-a-valid-key', ifMatch: '"3"' },
        { idempotency: idempotencyKey, ifMatch: undefined },
        { idempotency: idempotencyKey, ifMatch: 'W/"3"' },
      ] as const;
      for (const headers of cases) {
        let pending = request(app.getHttpServer()).post(path);
        if (headers.idempotency !== undefined) {
          pending = pending.set('Idempotency-Key', headers.idempotency);
        }
        if (headers.ifMatch !== undefined) pending = pending.set('If-Match', headers.ifMatch);
        const response = await pending.send(body).expect(400);
        expect(response.body).toMatchObject({ code: 'INVALID_ARGUMENT', request_id: requestId });
        expectNoStore(response.headers);
      }
      expect(serviceMethod).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['list', () => request(app.getHttpServer()).get('/api/v1/admin/orders'), listOrders,
      'INVALID_ARGUMENT', 400],
    ['detail', () => request(app.getHttpServer()).get(`/api/v1/admin/orders/${orderId}`), getOrder,
      'RESOURCE_NOT_FOUND', 404],
    ['fulfillment address', () => request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}/fulfillment-address`)
      .set('X-Access-Purpose', 'ORDER_FULFILLMENT')
      .set('X-Access-Reason', 'Prepare shipment'), getFulfillmentAddress,
      'STATE_CONFLICT', 409],
    ['order completion', () => request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/complete`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({ completion_reason: 'ADMIN_FORCED', reason: 'Delivered by administrator' }),
    completeOrder, 'ORDER_NOT_RECEIVABLE', 409],
    ['shipment creation', () => request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${orderId}/shipments`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"3"')
      .send({
        carrier_code: 'DEV', carrier_name: 'Carrier', tracking_no: 'TRACK',
        items: [{ order_item_id: orderItemId, quantity: 1 }],
      }), createShipment, 'SHIPMENT_ITEMS_MISMATCH', 422],
    ['logistics event', () => request(app.getHttpServer())
      .post(`/api/v1/admin/shipments/${shipmentId}/events`)
      .set('Idempotency-Key', idempotencyKey)
      .set('If-Match', '"1"')
      .send({
        description: 'Delivered', event_type: 'STATUS', occurred_at: '2026-08-31T04:05:00Z',
        status_code: 'DELIVERED',
      }), appendLogisticsEvent, 'SHIPMENT_STATE_CONFLICT', 409],
  ] as const)(
    'maps %s service %s to HTTP %s and preserves no-store',
    async (_operation, build, serviceMethod, code, status) => {
      serviceMethod.mockRejectedValueOnce(new ApplicationError(code, 'Admin order request rejected'));
      const response = await build().expect(status);
      expect(response.body).toMatchObject({ code, request_id: requestId });
      expectNoStore(response.headers);
    },
  );
});

describe('B11.1 Admin orders real authentication boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RealAuthenticationOrdersTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findAuthSession.mockResolvedValue(adminSessionRow());
    getFulfillmentAddress.mockResolvedValue(addressResult);
  });

  afterAll(async () => app.close());

  it('authenticates a real SUPER_ADMIN token and dispatches the controlled read to service', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}/fulfillment-address`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Access-Purpose', 'ORDER_FULFILLMENT')
      .set('X-Access-Reason', 'Prepare the development parcel')
      .expect(200);

    expect(findAuthSession).toHaveBeenCalledTimes(1);
    expect(getFulfillmentAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        accessSession: expect.objectContaining({ accountId, sessionId }),
        principal: expect.objectContaining({
          accountId,
          permissions: ['ORDER_FULFILLMENT_PII_READ'],
          role: 'SUPER_ADMIN',
          sessionId,
        }),
        requestId: expect.stringMatching(/^req_[a-f0-9]{32}$/),
      }),
      orderId,
      'ORDER_FULFILLMENT',
      'Prepare the development parcel',
    );
    expect(response.body.data).toEqual(addressResult);
    expectNoStore(response.headers);
  });

  it('rejects a real CUSTOMER token at the Admin authentication boundary without service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}/fulfillment-address`)
      .set('Authorization', `Bearer ${customerToken}`)
      .set('X-Access-Purpose', 'ORDER_FULFILLMENT')
      .set('X-Access-Reason', 'Prepare shipment')
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findAuthSession).not.toHaveBeenCalled();
    expect(getFulfillmentAddress).not.toHaveBeenCalled();
    expectNoStore(response.headers);
  });
});

describe('B11.1 Admin orders wrong-role HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WrongRoleOrdersTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => app.close());

  it.each([
    ['list', () => request(app.getHttpServer()).get('/api/v1/admin/orders?page=0')],
    ['detail', () => request(app.getHttpServer()).get('/api/v1/admin/orders/not-an-order')],
    ['order completion', () => request(app.getHttpServer())
      .post('/api/v1/admin/orders/not-an-order/complete')],
    ['shipment creation', () => request(app.getHttpServer())
      .post('/api/v1/admin/orders/not-an-order/shipments')],
    ['logistics event', () => request(app.getHttpServer())
      .post('/api/v1/admin/shipments/not-a-shipment/events')],
  ] as const)(
    'returns 403 with no-store before %s parsing or service dispatch for an AGENT_ADMIN',
    async (_operation, build) => {
      const response = await build().expect(403);
      expect(response.body).toEqual({
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
        request_id: requestId,
      });
      expectNoStore(response.headers);
      expect(listOrders).not.toHaveBeenCalled();
      expect(getOrder).not.toHaveBeenCalled();
      expect(getFulfillmentAddress).not.toHaveBeenCalled();
      expect(completeOrder).not.toHaveBeenCalled();
      expect(createShipment).not.toHaveBeenCalled();
      expect(appendLogisticsEvent).not.toHaveBeenCalled();
    },
  );

  it('dispatches an authenticated AGENT_ADMIN address read so its rejection can be audited', async () => {
    getFulfillmentAddress.mockRejectedValueOnce(
      new ApplicationError('PERMISSION_DENIED', 'Fulfillment address permission is required'),
    );

    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/orders/${orderId}/fulfillment-address`)
      .set('X-Access-Purpose', 'ORDER_FULFILLMENT')
      .set('X-Access-Reason', 'Prepare shipment')
      .expect(403);

    expect(response.body).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'Permission denied',
      request_id: requestId,
    });
    expectNoStore(response.headers);
    expect(getFulfillmentAddress).toHaveBeenCalledWith(
      expect.objectContaining({ principal: agentAdmin, requestId }),
      orderId,
      'ORDER_FULFILLMENT',
      'Prepare shipment',
    );
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
  });
});
