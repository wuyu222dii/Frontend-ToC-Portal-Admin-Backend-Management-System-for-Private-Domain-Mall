import { randomUUID } from 'node:crypto';

import { generateUlid, hmacCanonicalJson } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import {
  IdempotencyRepository,
  type CacheableAdminCustomerResponse,
  type CacheableAgentInviteRotateReplay,
  type CacheableAgentProductAuthorizationResponse,
  type CacheableAgentResourceResponse,
  type CacheableBannerResourceResponse,
  type CacheableCatalogResourceResponse,
  type CacheableFileUploadCompleteResponse,
  type CacheableCommandResponse,
  type CacheableProductCatalogResponse,
  type DatabaseTransaction,
  deriveIdempotencyScope,
  type IdempotencyHashKey,
} from './idempotency.repository';

const hashKey = Buffer.alloc(32, 0x35);
const currentHashKey: IdempotencyHashKey = { id: 'test-current-v2', key: hashKey };
const previousHashKey: IdempotencyHashKey = { id: 'test-previous-v1', key: Buffer.alloc(32, 0x36) };
const phoneFixture = ['138', '0013', '8000'].join('');
const cardFixture = ['6222', '0202', '0202', '0202'].join('');
const baseClaim = {
  actorId: generateUlid(),
  idempotencyKey: '9ece497e-0847-4c3b-b4c2-2d777784c3fe',
  request: {
    body: { operation: 'create' },
    method: 'POST' as const,
    pathParameters: {},
    route: '/test/resources',
  },
};

function repository(): IdempotencyRepository {
  return new IdempotencyRepository({ current: currentHashKey, previous: [] });
}

function requestHash(key: IdempotencyHashKey, claim = baseClaim): string {
  return hmacCanonicalJson(
    { key_id: key.id, request: claim.request },
    key.key,
    'idempotency-request',
  );
}

function responseHash(key: IdempotencyHashKey, response: unknown, claim = baseClaim): string {
  return hmacCanonicalJson(
    {
      actor_id: claim.actorId,
      idempotency_key: claim.idempotencyKey,
      key_id: key.id,
      request_hash: requestHash(key, claim),
      response,
      scope: deriveIdempotencyScope(claim.request),
    },
    key.key,
    'idempotency-response',
  );
}

function recordContext(key = currentHashKey, claim = baseClaim) {
  return {
    actor_id: claim.actorId,
    idempotency_key: claim.idempotencyKey,
    request_hash: requestHash(key, claim),
    scope: deriveIdempotencyScope(claim.request),
  };
}

function commandResponse(override: Partial<CacheableCommandResponse> = {}): CacheableCommandResponse {
  return {
    code: 'OK',
    data: {
      occurred_at: '2026-08-13T00:00:00.000Z',
      resource_id: generateUlid(),
      resource_type: 'product',
      status: 'ACTIVE',
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  };
}

function fileCompleteResponse(
  override: Partial<CacheableFileUploadCompleteResponse> = {},
): CacheableFileUploadCompleteResponse {
  return {
    code: 'OK',
    data: {
      completed_at: '2026-08-13T00:00:00.000Z',
      file_id: generateUlid(),
      public_url: 'https://assets.example.test/public/file-id',
      purpose: 'BRAND_LOGO',
      status: 'READY',
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  };
}

function catalogBrandResponse(
  override: Partial<CacheableCatalogResourceResponse> = {},
): CacheableCatalogResourceResponse {
  const fileId = generateUlid();
  return {
    code: 'OK',
    data: {
      brand_id: generateUlid(),
      description: 'Daily care',
      logo_file_id: fileId,
      logo_url: `https://assets.example.test/public/${fileId}`,
      name: 'Qingxu',
      sort_order: 1,
      status: 'DRAFT',
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  } as CacheableCatalogResourceResponse;
}

function catalogCategoryResponse(
  override: Partial<CacheableCatalogResourceResponse> = {},
): CacheableCatalogResourceResponse {
  return {
    code: 'OK',
    data: {
      category_id: generateUlid(),
      icon_file_id: null,
      icon_url: null,
      name: 'Body care',
      sort_order: 2,
      status: 'INACTIVE',
      version: 3,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  } as CacheableCatalogResourceResponse;
}

function productDetailResponse(): CacheableProductCatalogResponse {
  const imageFileId = generateUlid();
  return {
    code: 'OK',
    data: {
      brand: catalogBrandResponse().data as never,
      category: catalogCategoryResponse().data as never,
      images: [{
        file_id: imageFileId,
        is_primary: true,
        sort_order: 0,
        url: `https://assets.example.test/public/${imageFileId}`,
      }],
      ingredients: null,
      introduction: 'Daily wash',
      is_hot: false,
      is_new: true,
      name: 'Daily wash',
      net_sales_count: 0,
      product_id: generateUlid(),
      skus: [],
      spu_code: 'SPU-001',
      status: 'DRAFT',
      subtitle: null,
      usage_method: null,
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
  };
}

function skuResponse(): CacheableProductCatalogResponse {
  return {
    code: 'OK',
    data: {
      available_stock: 0,
      code: 'SKU-001',
      is_recommended: false,
      name: '500 ml',
      retail_price: '19.90',
      sku_id: generateUlid(),
      spec_json: { attributes: [{ name: 'Volume', value: '500 ml' }] },
      status: 'INACTIVE',
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
  };
}

function bannerResponse(
  override: Partial<CacheableBannerResourceResponse> = {},
): CacheableBannerResourceResponse {
  const fileId = generateUlid();
  return {
    code: 'OK',
    data: {
      banner_id: generateUlid(),
      ends_at: null,
      file_id: fileId,
      image_url: `https://assets.example.test/public/${fileId}`,
      sort_order: 0,
      starts_at: null,
      status: 'DRAFT',
      target_id: null,
      target_type: 'NONE',
      target_url: null,
      title: 'Home banner',
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  };
}

function agentResponse(
  override: Partial<CacheableAgentResourceResponse> = {},
): CacheableAgentResourceResponse {
  return {
    code: 'OK',
    data: {
      agent_id: generateUlid(),
      agent_no: `AGT-${generateUlid()}`,
      contact_name: 'Agent operator',
      contact_phone_tail: '8000',
      name: 'North region agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      version: 1,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    ...override,
  };
}

function agentAuthorizationResponse(): CacheableAgentProductAuthorizationResponse {
  return {
    code: 'OK',
    data: {
      agent_id: generateUlid(),
      mode: 'CUSTOM_WHITELIST',
      product_ids: [generateUlid(), generateUlid()],
      version: 2,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
  };
}

function agentInviteRotateReplay(): CacheableAgentInviteRotateReplay {
  return {
    code: 'OK',
    data: {
      agent_id: generateUlid(),
      disclosure_state: 'REPLAY_REDACTED',
      new_invite_code: null,
      old_code_invalidated: {
        code_masked: '****CODE',
        existing_bindings_unchanged: true,
        invalidated_at: '2026-09-03T00:00:00.000Z',
        invite_code_id: generateUlid(),
      },
      reissue_required: true,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
  };
}

function adminCustomerResponse(): CacheableAdminCustomerResponse {
  const customerId = generateUlid();
  return {
    code: 'OK',
    data: {
      account_status: 'ACTIVE',
      binding: {
        agent_id: generateUlid(),
        agent_name: 'North region agent',
        binding_id: generateUlid(),
        customer_id: customerId,
        customer_version: 2,
        started_at: '2026-09-03T00:00:00.000Z',
      },
      city: 'Hangzhou',
      consumption_amount: '128.00',
      consumption_count: 2,
      customer_alias: 'customer_0123456789abcdef0123456789',
      customer_id: customerId,
      deletion_request_status: null,
      last_order_id: generateUlid(),
      last_product_name: 'Daily wash',
      last_purchase_at: '2026-09-03T01:00:00.000Z',
      management_note_present: false,
      nickname_masked: 'Q**',
      phone_masked: '*** **** 8000',
      registered_at: '2026-09-01T00:00:00.000Z',
      version: 2,
    },
    message: 'success',
    request_id: 'req_0123456789abcdef0123456789abcdef',
  };
}

function transactionStub(): DatabaseTransaction {
  return {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    idempotencyRecord: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: { create: object }) => create),
    },
  } as unknown as DatabaseTransaction;
}

describe('IdempotencyRepository', () => {
  it('rejects malformed actor and key identifiers before accessing the database', async () => {
    const subject = repository();
    const transaction = transactionStub();

    await expect(subject.claim(transaction, { ...baseClaim, actorId: 'not-an-ulid' }))
      .rejects.toThrow('actor ID must be a ULID');
    await expect(subject.claim(transaction, { ...baseClaim, idempotencyKey: 'not-a-uuid' }))
      .rejects.toThrow('Idempotency key must be a UUID');
    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('stores an approved CommandResponse and computes its canonical hash', async () => {
    const transaction = transactionStub();
    const responseBody = commandResponse();

    await repository().complete(transaction, baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 201,
      storage: 'CACHEABLE',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        resource_id: responseBody.data.resource_id,
        response_body: responseBody,
        response_body_hash: responseHash(currentHashKey, responseBody),
      }),
    }));
  });

  it.each(['product', 'sku'] as const)('exactly replays an integrity-checked %s CommandResponse', (resourceType) => {
    const responseBody = commandResponse({
      data: {
        ...commandResponse().data,
        resource_id: generateUlid(),
        resource_type: resourceType,
        status: resourceType === 'product' ? 'ACTIVE' : 'INACTIVE',
      },
    });
    const record = {
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.resource_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    };

    expect(repository().commandReplay(record as never)).toEqual(responseBody);
  });

  it('rejects a CommandResponse replay with a mismatched identity, HMAC or status', () => {
    const responseBody = commandResponse();
    const record = {
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.resource_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    };
    for (const override of [
      { resource_id: generateUlid() },
      { response_body_hash: '0'.repeat(64) },
      { response_status: 500 },
    ]) {
      expect(() => repository().commandReplay({ ...record, ...override } as never))
        .toThrow('unexpected error');
    }
  });

  it('rejects transplanting a valid CommandResponse into another idempotency record', () => {
    const responseBody = commandResponse();
    const sourceClaim = { ...baseClaim, idempotencyKey: randomUUID() };
    expect(() => repository().commandReplay({
      ...recordContext(currentHashKey, baseClaim),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.resource_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody, sourceClaim),
      response_status: 200,
    } as never)).toThrow('unexpected error');
  });

  it('stores and extracts the closed FILE_UPLOAD_COMPLETE response for exact replay', async () => {
    const transaction = transactionStub();
    const responseBody = fileCompleteResponse();
    await repository().complete(transaction, baseClaim, {
      policy: 'FILE_UPLOAD_COMPLETE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        resource_id: responseBody.data.file_id,
        response_body: responseBody,
        response_body_hash: responseHash(currentHashKey, responseBody),
      }),
    }));

    const record = {
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.file_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    };
    expect(repository().fileUploadCompleteReplay(record as never)).toEqual(responseBody);
  });

  it.each([
    { responseBody: catalogBrandResponse(), responseStatus: 201 },
    { responseBody: catalogCategoryResponse(), responseStatus: 200 },
  ])('stores and exactly replays a closed catalog response', async ({ responseBody, responseStatus }) => {
    const transaction = transactionStub();
    await repository().complete(transaction, baseClaim, {
      policy: 'CATALOG_RESOURCE_RESPONSE',
      responseBody,
      responseStatus,
      storage: 'CACHEABLE',
    });
    const resourceId = 'brand_id' in responseBody.data
      ? responseBody.data.brand_id
      : responseBody.data.category_id;
    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ resource_id: resourceId, response_body: responseBody }),
    }));
    expect(repository().catalogResourceReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: resourceId,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: responseStatus,
    } as never)).toEqual(responseBody);
  });

  it.each([
    { responseBody: productDetailResponse(), responseStatus: 201 },
    { responseBody: skuResponse(), responseStatus: 200 },
  ])('stores and exactly replays a closed product catalog response', async ({ responseBody, responseStatus }) => {
    const transaction = transactionStub();
    await repository().complete(transaction, baseClaim, {
      policy: 'PRODUCT_CATALOG_RESPONSE',
      responseBody,
      responseStatus,
      storage: 'CACHEABLE',
    });
    const resourceId = 'product_id' in responseBody.data
      ? responseBody.data.product_id
      : responseBody.data.sku_id;
    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ resource_id: resourceId, response_body: responseBody }),
    }));
    expect(repository().productCatalogReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: resourceId,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: responseStatus,
    } as never)).toEqual(responseBody);
  });

  it('stores and exactly replays a closed banner response', async () => {
    const transaction = transactionStub();
    const responseBody = bannerResponse();
    await repository().complete(transaction, baseClaim, {
      policy: 'BANNER_RESOURCE_RESPONSE',
      responseBody,
      responseStatus: 201,
      storage: 'CACHEABLE',
    });
    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        resource_id: responseBody.data.banner_id,
        response_body: responseBody,
      }),
    }));
    expect(repository().bannerResourceReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.banner_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 201,
    } as never)).toEqual(responseBody);
  });

  it('stores and exactly replays a closed Agent resource response with a legacy agent number', async () => {
    const transaction = transactionStub();
    const responseBody = agentResponse();
    responseBody.data.agent_no = 'AGT-000001';

    await repository().complete(transaction, baseClaim, {
      policy: 'AGENT_RESOURCE_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        resource_id: responseBody.data.agent_id,
        response_body: responseBody,
        response_body_hash: responseHash(currentHashKey, responseBody),
      }),
    }));
    expect(repository().agentResourceReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.agent_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    } as never)).toEqual(responseBody);
  });

  it('rejects a tampered Agent replay identity, body HMAC or response status', () => {
    const responseBody = agentResponse();
    const record = {
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.agent_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    };

    for (const override of [
      { resource_id: generateUlid() },
      { response_body_hash: '0'.repeat(64) },
      { response_status: 201 },
      { response_body: { ...responseBody, data: { ...responseBody.data, name: 'Tampered agent' } } },
    ]) {
      expect(() => repository().agentResourceReplay({ ...record, ...override } as never))
        .toThrow('unexpected error');
    }
  });

  it('stores and exactly replays a closed Agent product-authorization response', async () => {
    const transaction = transactionStub();
    const responseBody = agentAuthorizationResponse();
    await repository().complete(transaction, baseClaim, {
      policy: 'AGENT_PRODUCT_AUTHORIZATION_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ resource_id: responseBody.data.agent_id, response_body: responseBody }),
    }));
    expect(repository().agentProductAuthorizationReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.agent_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    } as never)).toEqual(responseBody);
  });

  it('stores only the redacted Agent invite rotation replay and rejects a plaintext code', async () => {
    const transaction = transactionStub();
    const responseBody = agentInviteRotateReplay();
    await repository().complete(transaction, baseClaim, {
      policy: 'AGENT_INVITE_ROTATE_REPLAY',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
    expect(JSON.stringify(vi.mocked(transaction.idempotencyRecord.upsert).mock.calls[0]?.[0]))
      .not.toContain('AGT-private');
    expect(repository().agentInviteRotateReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.agent_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    } as never)).toEqual(responseBody);
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'AGENT_INVITE_ROTATE_REPLAY',
      responseBody: {
        ...responseBody,
        data: { ...responseBody.data, new_invite_code: { code: 'AGT-private' } },
      },
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('redacted invite rotation');
  });

  it('stores and exactly replays a closed Admin customer response', async () => {
    const transaction = transactionStub();
    const responseBody = adminCustomerResponse();
    await repository().complete(transaction, baseClaim, {
      policy: 'ADMIN_CUSTOMER_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        resource_id: responseBody.data.customer_id,
        response_body: responseBody,
      }),
    }));
    expect(repository().adminCustomerReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.customer_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    } as never)).toEqual(responseBody);
  });

  it('rejects sensitive or cross-customer fields in an Admin customer cache entry', async () => {
    const responseBody = adminCustomerResponse();
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'ADMIN_CUSTOMER_RESPONSE',
      responseBody: {
        ...responseBody,
        data: { ...responseBody.data, phone_ciphertext: cardFixture },
      },
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid Admin customer response');
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'ADMIN_CUSTOMER_RESPONSE',
      responseBody: {
        ...responseBody,
        data: {
          ...responseBody.data,
          binding: { ...responseBody.data.binding, customer_id: generateUlid() },
        },
      },
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid Admin customer response');
  });

  it.each([
    (() => {
      const response = agentResponse();
      return { ...response, data: { ...response.data, temporary_password: 'Tmp!private-value' } };
    })(),
    (() => {
      const response = agentResponse();
      return { ...response, data: { ...response.data, invite_code: 'AGT-private-invite-code' } };
    })(),
    (() => {
      const response = agentResponse();
      return { ...response, data: { ...response.data, contact_phone: phoneFixture } };
    })(),
    { ...agentResponse(), access_token: 'private-access-token' },
  ])('rejects Agent cache content that leaks a secret or non-contract field', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'AGENT_RESOURCE_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid Agent response');
  });

  it.each([
    (() => {
      const response = bannerResponse();
      return { ...response, data: { ...response.data, private_url: 'https://private.example.test/file' } };
    })(),
    (() => {
      const response = bannerResponse();
      return { ...response, data: { ...response.data, target_id: generateUlid() } };
    })(),
    (() => {
      const response = bannerResponse();
      return {
        ...response,
        data: { ...response.data, target_type: 'URL', target_url: 'http://example.test/banner' },
      };
    })(),
  ])('rejects malformed or sensitive banner cache content', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'BANNER_RESOURCE_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid banner response');
  });

  it('rejects a non-contract status for BANNER_RESOURCE_RESPONSE', async () => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'BANNER_RESOURCE_RESPONSE',
      responseBody: bannerResponse(),
      responseStatus: 202,
      storage: 'CACHEABLE',
    })).rejects.toThrow('must use HTTP status 200 or 201');
  });

  it.each([
    { ...productDetailResponse(), refresh_token: 'secret' },
    (() => {
      const response = productDetailResponse();
      return {
        ...response,
        data: {
          ...response.data,
          images: [{
            ...(response.data as Extract<typeof response.data, { product_id: string }>).images[0],
            url: 'https://assets.example.test/private/file-id',
          }],
        },
      };
    })(),
    (() => {
      const response = skuResponse();
      return { ...response, data: { ...response.data, retail_price: '12345678901234567.00' } };
    })(),
  ])('rejects malformed or sensitive product catalog cache content', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'PRODUCT_CATALOG_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid product catalog response');
  });

  it('rejects a product catalog replay with mismatched identity', () => {
    const responseBody = productDetailResponse();
    expect(() => repository().productCatalogReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: generateUlid(),
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 201,
    } as never)).toThrow('unexpected error');
  });

  it.each([
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, access_token: 'secret' } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, brand_id: 'not-an-ulid' } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, name: ' '.repeat(3) } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, status: 'DELETED' } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, sort_order: -1 } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, version: 0 } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, logo_url: 'https://assets.example.test/private/file' } } as never),
    catalogBrandResponse({ data: { ...catalogBrandResponse().data, logo_url: 'https://assets.example.test/public/file?sig=secret' } } as never),
    catalogCategoryResponse({ data: { ...catalogCategoryResponse().data, icon_file_id: generateUlid() } } as never),
    { ...catalogCategoryResponse(), refresh_token: 'secret' },
  ])('rejects malformed or sensitive catalog cache content: %j', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'CATALOG_RESOURCE_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid catalog response');
  });

  it('rejects catalog replay with a mismatched resource identity or response HMAC', () => {
    const responseBody = catalogBrandResponse();
    for (const override of [
      { resource_id: generateUlid() },
      { response_body_hash: '0'.repeat(64) },
      { response_status: 202 },
    ]) {
      expect(() => repository().catalogResourceReplay({
        ...recordContext(),
        expires_at: new Date('2099-08-14T00:00:00.000Z'),
        resource_id: responseBody.data.brand_id,
        response_body: responseBody,
        response_body_hash: responseHash(currentHashKey, responseBody),
        response_status: 200,
        ...override,
      } as never)).toThrow('unexpected error');
    }
  });

  it('rejects transplanting a valid catalog response and HMAC into another idempotency record', () => {
    const transplanted = catalogBrandResponse();
    const sourceClaim = { ...baseClaim, idempotencyKey: randomUUID() };
    expect(() => repository().catalogResourceReplay({
      ...recordContext(currentHashKey, baseClaim),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: transplanted.data.brand_id,
      response_body: transplanted,
      response_body_hash: responseHash(currentHashKey, transplanted, sourceClaim),
      response_status: 201,
    } as never)).toThrow('unexpected error');
  });

  it('accepts null public_url only for a private file purpose', async () => {
    const transaction = transactionStub();
    const responseBody = fileCompleteResponse({
      data: {
        ...fileCompleteResponse().data,
        public_url: null,
        purpose: 'AFTERSALE_EVIDENCE',
      },
    });
    await expect(repository().complete(transaction, baseClaim, {
      policy: 'FILE_UPLOAD_COMPLETE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    })).resolves.toBeDefined();
  });

  it.each([
    fileCompleteResponse({ data: { ...fileCompleteResponse().data, public_url: null } }),
    fileCompleteResponse({ data: {
      ...fileCompleteResponse().data,
      public_url: 'https://assets.example.test/private/file-id',
      purpose: 'WITHDRAWAL_PROOF',
    } }),
    fileCompleteResponse({ data: {
      ...fileCompleteResponse().data,
      public_url: 'https://assets.example.test/public/file-id?signature=secret',
    } }),
    fileCompleteResponse({ data: { ...fileCompleteResponse().data, completed_at: 'not-a-date' } }),
    fileCompleteResponse({ data: { ...fileCompleteResponse().data, status: 'PENDING' as 'READY' } }),
    fileCompleteResponse({ data: { ...fileCompleteResponse().data, purpose: 'UNKNOWN' as 'BRAND_LOGO' } }),
    { ...fileCompleteResponse(), extra: 'not-allowed' },
  ])('rejects malformed FILE_UPLOAD_COMPLETE cache content: %j', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'FILE_UPLOAD_COMPLETE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid file completion response');
  });

  it('fails closed for unknown cache policies and non-200 file completions', async () => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'UNREGISTERED',
      responseBody: fileCompleteResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('policy is not registered');
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'FILE_UPLOAD_COMPLETE',
      responseBody: fileCompleteResponse(),
      responseStatus: 201,
      storage: 'CACHEABLE',
    })).rejects.toThrow('must use HTTP status 200');
  });

  it('does not extract a command response through the file replay helper', () => {
    const responseBody = commandResponse();
    expect(() => repository().fileUploadCompleteReplay({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: responseBody.data.resource_id,
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
    } as never)).toThrow('unexpected error');
  });

  it('derives CACHEABLE resource identity from the closed response body', async () => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'COMMAND_RESPONSE',
      resourceId: generateUlid(),
      responseBody: commandResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('unsupported fields');
  });

  it('stores no response body in fail-closed HASH_ONLY mode', async () => {
    const transaction = transactionStub();
    const responseForHash = { full_card_number: 'sensitive-value' };

    await repository().complete(transaction, baseClaim, {
      responseForHash,
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        response_body: Prisma.DbNull,
        response_body_hash: responseHash(currentHashKey, responseForHash),
      }),
    }));
  });

  it('authenticates HASH_ONLY replay status, resource identity and stable response facts', () => {
    const resourceId = generateUlid();
    const responseForHash = { order_created: { order_id: resourceId, order_no: `QX${resourceId}` } };
    const record = {
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      resource_id: resourceId,
      response_body: null,
      response_body_hash: responseHash(currentHashKey, responseForHash),
      response_status: 201,
    } as never;
    const result = {
      resourceId,
      responseForHash,
      responseStatus: 201,
      storage: 'HASH_ONLY' as const,
    };

    expect(() => repository().assertHashOnlyReplay(record, result)).not.toThrow();
    expect(() => repository().assertHashOnlyReplay(
      { ...record, resource_id: generateUlid() },
      { ...result, resourceId: generateUlid() },
    )).toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(() => repository().assertHashOnlyReplay(record, {
      ...result,
      responseForHash: { order_created: { order_id: resourceId, order_no: 'tampered' } },
    })).toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(() => repository().assertHashOnlyReplay(record, { ...result, responseStatus: 200 }))
      .toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });

  it('requires a strong repository-owned HMAC key and a normalized mutation descriptor', async () => {
    expect(() => new IdempotencyRepository({
      current: { id: 'test-short', key: Buffer.alloc(31) },
      previous: [],
    })).toThrow('at least 32 bytes');
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      request: { ...baseClaim.request, method: 'GET' as 'POST' },
    })).rejects.toThrow('request descriptor is invalid');
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      request: { ...baseClaim.request, route: '/test/resources?token=private' },
    })).rejects.toThrow('request descriptor is invalid');
  });

  it('derives an opaque persisted scope instead of accepting caller metadata', async () => {
    const transaction = transactionStub();
    const request = { ...baseClaim.request, route: '/api/v1/customers/{customer_id}' };
    await repository().complete(transaction, { ...baseClaim, request }, {
      responseForHash: { code: 'OK' },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });

    const scope = vi.mocked(transaction.idempotencyRecord.upsert).mock.calls[0]?.[0].create.scope;
    expect(scope).toMatch(/^idempotency:v1:[a-f0-9]{64}$/);
    expect(scope).not.toContain('customers');
    expect(scope).not.toContain('customer_id');
  });

  it('rejects a caller-controlled scope field', async () => {
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      scope: `phone:${phoneFixture}`,
    } as never)).rejects.toThrow('claim contains unsupported fields');
  });

  it.each([
    { access_token: 'opaque-value' },
    { invite_code: 'ABCDEF123456' },
    { recovery_codes: ['ABCDEF123456'] },
    { refresh: 'ABCDEF123456' },
    { pre_auth: 'ABCDEF123456' },
    { reauth_grant: 'ABCDEF123456' },
    { amount: phoneFixture },
    { amount: cardFixture },
    { status: 'RECOVERY-CODE-ABC123' },
    { code: 'PRE-AUTH-TOKEN-ABC123' },
  ])('rejects non-CommandResponse CACHEABLE content: %j', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid COMMAND_RESPONSE');
  });

  it.each([
    commandResponse({ code: 'PRIVATE' as 'OK' }),
    commandResponse({ message: 'ABCDEF123456' as 'success' }),
    commandResponse({ request_id: phoneFixture }),
    commandResponse({ data: { ...commandResponse().data, resource_id: 'ABCDEF123456' } }),
    commandResponse({ data: { ...commandResponse().data, resource_type: 'access_token' } }),
    commandResponse({ data: { ...commandResponse().data, status: 'RECOVERY-CODE-ABC123' } }),
    commandResponse({ data: { ...commandResponse().data, version: 0 } }),
    commandResponse({ data: { ...commandResponse().data, occurred_at: 'not-a-timestamp' } }),
    { ...commandResponse(), extra: 'ACTIVE' },
    { ...commandResponse(), data: { ...commandResponse().data, extra: 'ACTIVE' } },
  ])('rejects malformed closed CommandResponse content: %j', async (responseBody) => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('valid COMMAND_RESPONSE');
  });

  it('always uses the fixed 24-hour retention period', async () => {
    const transaction = transactionStub();
    const now = new Date('2026-08-13T00:00:00.000Z');
    await new IdempotencyRepository({ current: currentHashKey, previous: [] }, () => now)
      .complete(transaction, baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody: commandResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    });

    expect(transaction.idempotencyRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ expires_at: new Date('2026-08-14T00:00:00.000Z') }),
    }));
  });

  it('rejects caller-controlled digest and expiry fields', async () => {
    await expect(repository().complete(transactionStub(), baseClaim, {
      responseForHash: { code: 'OK' },
      responseHash: 'a'.repeat(64),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    } as never)).rejects.toThrow('unsupported fields');
    await expect(repository().complete(transactionStub(), baseClaim, {
      expiresAt: new Date(),
      policy: 'COMMAND_RESPONSE',
      responseBody: commandResponse(),
      responseStatus: 200,
      storage: 'CACHEABLE',
    } as never)).rejects.toThrow('unsupported fields');
  });

  it('rejects a confirm key already used by the same actor in the supplied preview request scope', async () => {
    const transaction = transactionStub();
    const confirmClaim = {
      ...baseClaim,
      request: {
        body: { confirmation_hash: 'a'.repeat(64), reason: 'Request rejected after review' },
        method: 'POST' as const,
        pathParameters: { aftersale_id: generateUlid() },
        route: '/api/v1/admin/aftersales/{aftersale_id}/reject',
      },
    };
    const previewRequest = {
      method: 'POST' as const,
      route: '/api/v1/admin/aftersales/{aftersale_id}/reject/preview',
    };
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue({
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
    } as never);

    await expect(repository().assertKeyNotUsedForRequest(transaction, confirmClaim, previewRequest))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    const previewScope = deriveIdempotencyScope(previewRequest);
    expect(transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      'idempotency',
      JSON.stringify([confirmClaim.actorId, previewScope, confirmClaim.idempotencyKey]),
    );
    expect(transaction.idempotencyRecord.findUnique).toHaveBeenCalledWith({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: confirmClaim.actorId,
          idempotency_key: confirmClaim.idempotencyKey,
          scope: previewScope,
        },
      },
    });
  });

  it('allows a confirm key when the supplied preview scope has no live record', async () => {
    const transaction = transactionStub();
    const previewRequest = { method: 'POST' as const, route: '/test/resources/preview' };
    vi.mocked(transaction.idempotencyRecord.findUnique)
      .mockResolvedValueOnce({ expires_at: new Date('2000-01-01T00:00:00.000Z') } as never)
      .mockResolvedValueOnce(null);

    await expect(repository().assertKeyNotUsedForRequest(transaction, baseClaim, previewRequest))
      .resolves.toBeUndefined();
    await expect(repository().assertKeyNotUsedForRequest(transaction, baseClaim, previewRequest))
      .resolves.toBeUndefined();
  });

  it('rejects an invalid or identical supplied request scope before database access', async () => {
    const transaction = transactionStub();
    await expect(repository().assertKeyNotUsedForRequest(transaction, baseClaim, {
      method: 'GET' as 'POST',
      route: '/test/resources/preview',
    })).rejects.toThrow('request scope descriptor is invalid');
    await expect(repository().assertKeyNotUsedForRequest(transaction, baseClaim, {
      method: baseClaim.request.method,
      route: baseClaim.request.route,
    })).rejects.toThrow('request scopes must differ');
    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(transaction.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it('rejects caller-controlled time and an invalid internal clock', async () => {
    await expect(repository().claim(transactionStub(), {
      ...baseClaim,
      now: new Date('2100-01-01T00:00:00.000Z'),
    } as never)).rejects.toThrow('claim contains unsupported fields');
    expect(() => new IdempotencyRepository(
      { current: currentHashKey, previous: [] },
      () => new Date(Number.NaN),
    ))
      .toThrow('clock must return a valid Date');
  });

  it('replays an unexpired record signed by a retained previous key after rotation', async () => {
    const responseBody = commandResponse();
    const record = {
      ...recordContext(previousHashKey),
      created_at: new Date('2026-08-12T00:00:00.000Z'),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      id: generateUlid(),
      resource_id: responseBody.data.resource_id,
      response_body: responseBody,
      response_body_hash: responseHash(previousHashKey, responseBody),
      response_status: 201,
    };
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue(record as never);
    const rotated = new IdempotencyRepository({
      current: currentHashKey,
      previous: [previousHashKey],
    });

    await expect(rotated.claim(transaction, baseClaim)).resolves.toEqual({ kind: 'replay', record });
  });

  it('fails closed instead of re-executing when a still-required previous key was removed', async () => {
    const responseBody = commandResponse();
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue({
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      request_hash: requestHash(previousHashKey),
      response_body: responseBody,
      response_body_hash: responseHash(previousHashKey, responseBody),
      response_status: 200,
      resource_id: responseBody.data.resource_id,
    } as never);

    await expect(repository().claim(transaction, baseClaim)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it.each([
    (record: Record<string, unknown>) => ({ ...record, response_body: commandResponse() }),
    (record: Record<string, unknown>) => ({ ...record, response_body_hash: '0'.repeat(64) }),
    (record: Record<string, unknown>) => ({ ...record, resource_id: generateUlid() }),
    (record: Record<string, unknown>) => ({ ...record, response_status: 500 }),
  ])('rejects a corrupted cache record before replay', async (corrupt) => {
    const responseBody = commandResponse();
    const baseRecord = {
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      response_body: responseBody,
      response_body_hash: responseHash(currentHashKey, responseBody),
      response_status: 200,
      resource_id: responseBody.data.resource_id,
    };
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue(corrupt(baseRecord) as never);

    await expect(repository().claim(transaction, baseClaim)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('rejects a corrupted existing record reached through complete', async () => {
    const responseBody = commandResponse();
    const transaction = transactionStub();
    vi.mocked(transaction.idempotencyRecord.findUnique).mockResolvedValue({
      ...recordContext(),
      expires_at: new Date('2099-08-14T00:00:00.000Z'),
      response_body: responseBody,
      response_body_hash: '0'.repeat(64),
      response_status: 200,
      resource_id: responseBody.data.resource_id,
    } as never);

    await expect(repository().complete(transaction, baseClaim, {
      policy: 'COMMAND_RESPONSE',
      responseBody,
      responseStatus: 200,
      storage: 'CACHEABLE',
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(transaction.idempotencyRecord.upsert).not.toHaveBeenCalled();
  });
});
