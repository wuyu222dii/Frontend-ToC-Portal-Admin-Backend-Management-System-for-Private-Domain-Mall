import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StoreApiConfigurationError,
  StoreApiError,
  StoreEnvelopeFormatError,
  encodeStoreQuery,
  parseRetryAfterSeconds,
  parseStoreErrorEnvelope,
  parseStoreSuccessEnvelope,
  resolveStoreApiBaseUrl,
  storeApiGet,
  storeApiRequest,
} from './store-client';

describe('Store API pure helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('always uses the relative H5 proxy base', () => {
    expect(resolveStoreApiBaseUrl('h5', 'http://public.example/api/v1')).toBe('/api/v1');
  });

  it('uses the relative fallback or a normalized configured MP-Weixin base', () => {
    expect(resolveStoreApiBaseUrl('mp-weixin', undefined)).toBe('/api/v1');
    expect(resolveStoreApiBaseUrl('mp-weixin', '  ')).toBe('/api/v1');
    expect(resolveStoreApiBaseUrl('mp-weixin', 'https://api.example.test/api/v1///'))
      .toBe('https://api.example.test/api/v1');
  });

  it.each([
    'http://localhost:3000/api/v1',
    'http://127.0.0.1:3000/api/v1',
    'http://192.168.1.20:3000/api/v1',
    'http://[::1]:3000/api/v1',
    'http://[fc00::1]:3000/api/v1',
    'http://[fe80::1]:3000/api/v1',
  ])('allows an HTTP local development base: %s', (baseUrl) => {
    expect(resolveStoreApiBaseUrl('mp-weixin', baseUrl)).toBe(baseUrl);
  });

  it('does not depend on the browser URL global in MP-Weixin', () => {
    vi.stubGlobal('URL', undefined);
    expect(resolveStoreApiBaseUrl('mp-weixin', 'https://api.example.test/api/v1'))
      .toBe('https://api.example.test/api/v1');
  });

  it.each([
    'http://api.example.test/api/v1',
    'http://fcdeadbeef/api/v1',
    'http://fea0/api/v1',
    'http://010.0.0.1/api/v1',
    'http://192.168.001.2/api/v1',
    'ftp://api.example.test/api/v1',
    '/api/v1/custom',
    'https://user:secret@api.example.test/api/v1',
    'https://api.example.test/api/v1?tenant=one',
    'https://api.example.test/api/v1#fragment',
    'https://api.example.test:0/api/v1',
    'https://api.example.test:65536/api/v1',
  ])('rejects an unsafe configured MP-Weixin base: %s', (baseUrl) => {
    expect(() => resolveStoreApiBaseUrl('mp-weixin', baseUrl))
      .toThrow(StoreApiConfigurationError);
  });

  it('encodes defined query parameters without changing values', () => {
    expect(encodeStoreQuery({
      page: 2,
      page_size: 20,
      keyword: '  洗&护  ',
      brand_id: undefined,
      sort: 'PRICE_ASC',
    })).toBe('?page=2&page_size=20&keyword=%20%20%E6%B4%97%26%E6%8A%A4%20%20&sort=PRICE_ASC');
    expect(encodeStoreQuery({})).toBe('');
  });

  it('strictly parses success envelopes from objects or JSON text', () => {
    expect(parseStoreSuccessEnvelope<{ items: unknown[] }>({
      code: 'OK',
      message: 'success',
      data: { items: [] },
      request_id: 'req_1',
    })).toEqual({ items: [] });
    expect(parseStoreSuccessEnvelope<{ value: number }>(JSON.stringify({
      code: 'OK',
      message: 'success',
      data: { value: 3 },
      request_id: 'req_2',
    }))).toEqual({ value: 3 });
  });

  it.each([
    null,
    '{',
    { code: 'OK', message: 'success', request_id: 'req_1' },
    { code: 'NO', message: 'success', data: {}, request_id: 'req_1' },
    { code: 'OK', message: 'wrong', data: {}, request_id: 'req_1' },
    { code: 'OK', message: 'success', data: {}, request_id: '' },
    { code: 'OK', message: 'success', data: {}, request_id: 'req_1', extra: true },
  ])('rejects a malformed success envelope', (payload) => {
    expect(() => parseStoreSuccessEnvelope(payload)).toThrow(StoreEnvelopeFormatError);
  });

  it('strictly parses a public error envelope and details', () => {
    expect(parseStoreErrorEnvelope({
      code: 'INVALID_ARGUMENT',
      message: '参数无效',
      request_id: 'req_error',
      details: [{ field: 'keyword', reason: 'too long', rejected_value: null }],
    })).toEqual({
      code: 'INVALID_ARGUMENT',
      message: '参数无效',
      request_id: 'req_error',
      details: [{ field: 'keyword', reason: 'too long', rejected_value: null }],
    });
  });

  it.each([
    { code: '', message: 'bad', request_id: 'req_1' },
    { code: 'BAD', message: '', request_id: 'req_1' },
    { code: 'BAD', message: 'bad', request_id: '' },
    { code: 'BAD', message: 'bad', request_id: 'req_1', details: {} },
    { code: 'BAD', message: 'bad', request_id: 'req_1', details: [{ field: 1, reason: 'bad' }] },
    { code: 'BAD', message: 'bad', request_id: 'req_1', unexpected: true },
  ])('rejects a malformed error envelope', (payload) => {
    expect(() => parseStoreErrorEnvelope(payload)).toThrow(StoreEnvelopeFormatError);
  });

  it('reads an integer Retry-After header case-insensitively', () => {
    expect(parseRetryAfterSeconds({ 'retry-after': '17' })).toBe(17);
    expect(parseRetryAfterSeconds({ 'Retry-After': 8 })).toBe(8);
    expect(parseRetryAfterSeconds({ 'RETRY-AFTER': ['5'] })).toBe(5);
    expect(parseRetryAfterSeconds({ 'Retry-After': '0' })).toBeNull();
    expect(parseRetryAfterSeconds({ 'Retry-After': '1.5' })).toBeNull();
  });
});

describe('Store API uni.request adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubRequest() {
    let options: UniNamespace.RequestOptions | undefined;
    const abort = vi.fn(() => options?.fail?.({ errMsg: 'request:fail abort' }));
    const request = vi.fn((current: UniNamespace.RequestOptions) => {
      options = current;
      return { abort } as unknown as UniNamespace.RequestTask;
    });
    vi.stubGlobal('uni', { request });
    return {
      abort,
      request,
      options: () => {
        if (!options) throw new Error('request was not started');
        return options;
      },
    };
  }

  it('issues an anonymous GET and resolves only the response data', async () => {
    const current = stubRequest();
    const pending = storeApiGet<{ items: unknown[] }>('/store/products', {
      page: 2,
      keyword: '洗 护',
    });
    expect(current.options().url).toBe('/api/v1/store/products?page=2&keyword=%E6%B4%97%20%E6%8A%A4');
    expect(current.options().method).toBe('GET');
    expect(current.options().header).toEqual({ Accept: 'application/json' });
    expect(current.options().withCredentials).toBe(false);

    current.options().success?.({
      data: { code: 'OK', message: 'success', data: { items: [] }, request_id: 'req_ok' },
      statusCode: 200,
      header: {},
      cookies: [],
    });
    await expect(pending.promise).resolves.toEqual({ items: [] });
  });

  it('sends a JSON mutation with caller-controlled security headers', async () => {
    const current = stubRequest();
    const pending = storeApiRequest<{ saved: true }>('/store/profile', {
      data: { nickname: '青序用户' },
      headers: {
        Authorization: 'Bearer customer-access',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000001',
        'If-Match': '"3"',
      },
      method: 'PATCH',
    });
    expect(current.options()).toMatchObject({
      data: { nickname: '青序用户' },
      header: {
        Accept: 'application/json',
        Authorization: 'Bearer customer-access',
        'Content-Type': 'application/json',
        'Idempotency-Key': '00000000-0000-4000-8000-000000000001',
        'If-Match': '"3"',
      },
      method: 'PATCH',
      url: '/api/v1/store/profile',
    });
    current.options().success?.({
      data: { code: 'OK', message: 'success', data: { saved: true }, request_id: 'req_patch' },
      statusCode: 200,
      header: { 'Cache-Control': 'no-store, private' },
      cookies: [],
    });
    await expect(pending.promise).resolves.toEqual({ saved: true });
  });

  it('accepts only the exact caller-selected 201 status', async () => {
    const createdRequest = stubRequest();
    const created = storeApiRequest<{ order_id: string }>('/store/orders', {
      data: { quote_id: 'quote' },
      expectedStatus: 201,
      method: 'POST',
    });
    createdRequest.options().success?.({
      data: {
        code: 'OK', message: 'success', data: { order_id: 'order' }, request_id: 'req_created',
      },
      statusCode: 201,
      header: {},
      cookies: [],
    });
    await expect(created.promise).resolves.toEqual({ order_id: 'order' });

    const wrongStatusRequest = stubRequest();
    const wrongStatus = storeApiRequest('/store/orders', {
      data: { quote_id: 'quote' },
      expectedStatus: 201,
      method: 'POST',
    });
    wrongStatusRequest.options().success?.({
      data: {
        code: 'OK', message: 'success', data: { order_id: 'order' }, request_id: 'req_wrong',
      },
      statusCode: 200,
      header: {},
      cookies: [],
    });
    await expect(wrongStatus.promise).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });

  it('accepts only statuses from a caller-selected closed success set', async () => {
    const acceptedRequest = stubRequest();
    const accepted = storeApiRequest<{ state: string }>('/store/orders/order/cancel', {
      expectedStatus: [200, 202],
      method: 'POST',
    });
    acceptedRequest.options().success?.({
      data: {
        code: 'OK', message: 'success', data: { state: 'pending' }, request_id: 'req_pending',
      },
      statusCode: 202,
      header: {},
      cookies: [],
    });
    await expect(accepted.promise).resolves.toEqual({ state: 'pending' });

    const rejectedRequest = stubRequest();
    const rejected = storeApiRequest('/store/orders/order/cancel', {
      expectedStatus: [200, 202],
      method: 'POST',
    });
    rejectedRequest.options().success?.({
      data: {
        code: 'OK', message: 'success', data: { state: 'created' }, request_id: 'req_created',
      },
      statusCode: 201,
      header: {},
      cookies: [],
    });
    await expect(rejected.promise).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });

  it('exposes a valid Retry-After value on a 429 error', async () => {
    const current = stubRequest();
    const pending = storeApiGet('/store/home');
    current.options().success?.({
      data: {
        code: 'RATE_LIMITED',
        message: '请稍后重试',
        request_id: 'req_limited',
      },
      statusCode: 429,
      header: { 'Retry-After': '23' },
      cookies: [],
    });

    const error = await pending.promise.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(StoreApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      requestId: 'req_limited',
      retryAfterSeconds: 23,
      aborted: false,
    });
  });

  it('rejects a malformed HTTP response instead of trusting its body', async () => {
    const current = stubRequest();
    const pending = storeApiGet('/store/home');
    current.options().success?.({
      data: { data: {} },
      statusCode: 200,
      header: {},
      cookies: [],
    });
    await expect(pending.promise).rejects.toMatchObject({
      status: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps transport failures without exposing platform error text', async () => {
    const current = stubRequest();
    const pending = storeApiGet('/store/home');
    current.options().fail?.({ errMsg: 'request:fail DNS lookup secret detail' });
    await expect(pending.promise).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      requestId: null,
      aborted: false,
    });
  });

  it('uses the uni request task as its cancellation handle', async () => {
    const current = stubRequest();
    const pending = storeApiGet('/store/home');
    pending.abort();
    expect(current.abort).toHaveBeenCalledOnce();
    await expect(pending.promise).rejects.toMatchObject({
      status: 0,
      code: 'REQUEST_ABORTED',
      aborted: true,
    });
  });
});
