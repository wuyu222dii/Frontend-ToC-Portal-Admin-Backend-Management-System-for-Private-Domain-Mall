import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreApiError, StoreEnvelopeFormatError } from './store-client';
import {
  safeStoreUploadUrl,
  sha256HexBytes,
  uploadStoreAftersaleEvidence,
} from './store-files';

const mocks = vi.hoisted(() => ({
  authenticatedRequest: vi.fn(),
  createIdempotencyKey: vi.fn()
    .mockReturnValueOnce('intent-key')
    .mockReturnValue('generated-complete-key'),
  customerSessionGeneration: vi.fn(() => 1),
  loadCustomerRefreshCredential: vi.fn(() => ({
    refresh_token: 'customer-a-refresh-token',
    refresh_expires_at: '2030-01-01T00:00:00.000Z',
  })),
  request: vi.fn(),
}));

vi.mock('./store-identity', () => ({
  authenticatedRequest: mocks.authenticatedRequest,
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

vi.mock('../utils/customer-session', () => ({
  customerSessionGeneration: mocks.customerSessionGeneration,
  loadCustomerRefreshCredential: mocks.loadCustomerRefreshCredential,
}));

const FILE_ID = '01J00000000000000000000000';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_SHA256 = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';
const TIME = '2026-09-01T01:02:03.000Z';

function intent() {
  return {
    file_id: FILE_ID,
    purpose: 'AFTERSALE_EVIDENCE',
    status: 'PENDING',
    upload_url: 'http://127.0.0.1:9002/mall-development/staging/signed?X-Amz-Signature=test',
    upload_headers: [
      { name: 'content-type', value: 'image/png' },
      { name: 'x-amz-meta-sha256', value: PNG_SHA256 },
    ],
    expires_at: TIME,
  };
}

function complete() {
  return {
    file_id: FILE_ID,
    purpose: 'AFTERSALE_EVIDENCE',
    status: 'READY',
    public_url: null,
    completed_at: TIME,
  };
}

function installSuccessfulRawPut(): void {
  vi.stubGlobal('uni', { request: mocks.request });
  mocks.request.mockImplementation((options: { success(result: unknown): void }) => {
    options.success({ statusCode: 200, data: '', header: {} });
    return { abort: vi.fn() };
  });
}

describe('B12 aftersale evidence upload client', () => {
  afterEach(() => {
    mocks.authenticatedRequest.mockReset();
    mocks.createIdempotencyKey.mockReset()
      .mockReturnValueOnce('intent-key')
      .mockReturnValue('generated-complete-key');
    mocks.customerSessionGeneration.mockReset().mockReturnValue(1);
    mocks.loadCustomerRefreshCredential.mockReset().mockReturnValue({
      refresh_token: 'customer-a-refresh-token',
      refresh_expires_at: '2030-01-01T00:00:00.000Z',
    });
    mocks.request.mockReset();
    vi.unstubAllGlobals();
  });

  it('derives a standard SHA-256 digest and accepts only HTTPS or loopback upload URLs', () => {
    expect(sha256HexBytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(safeStoreUploadUrl('https://storage.example.test/upload?signature=ok'))
      .toBe('https://storage.example.test/upload?signature=ok');
    expect(safeStoreUploadUrl('http://localhost:9002/upload')).toBe('http://localhost:9002/upload');
    expect(() => safeStoreUploadUrl('http://storage.example.test/upload'))
      .toThrow(StoreEnvelopeFormatError);
    expect(() => safeStoreUploadUrl('https://user:secret@storage.example.test/upload'))
      .toThrow(StoreEnvelopeFormatError);
  });

  it('uses a fresh intent key, uploads raw bytes, and completes with the caller-stable key', async () => {
    installSuccessfulRawPut();
    mocks.authenticatedRequest.mockImplementation((path: string, options: {
      decode(value: unknown): unknown;
    }) => {
      if (path === '/files/upload-intents') return Promise.resolve(options.decode(intent()));
      return Promise.resolve(options.decode(complete()));
    });

    await expect(uploadStoreAftersaleEvidence({
      bytes: PNG,
      filename: ' evidence.png ',
      mime_type: 'image/png',
    }, 'stable-complete-key')).resolves.toEqual(complete());

    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(1, '/files/upload-intents', {
      data: {
        purpose: 'AFTERSALE_EVIDENCE',
        filename: 'evidence.png',
        mime_type: 'image/png',
        size: PNG.length,
        sha256: PNG_SHA256,
      },
      decode: expect.any(Function),
      expectedStatus: 200,
      headers: { 'Idempotency-Key': 'intent-key' },
      method: 'POST',
    });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      url: intent().upload_url,
      method: 'PUT',
      data: expect.any(ArrayBuffer),
      withCredentials: false,
      header: {
        'content-type': 'image/png',
        'x-amz-meta-sha256': PNG_SHA256,
      },
    }));
    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(
      2,
      `/files/${FILE_ID}/complete`,
      {
        data: { sha256: PNG_SHA256, size: PNG.length },
        decode: expect.any(Function),
        expectedStatus: 200,
        headers: { 'Idempotency-Key': 'stable-complete-key' },
        method: 'POST',
      },
    );
    expect(mocks.createIdempotencyKey).toHaveBeenCalledOnce();
  });

  it('retries a lost complete response with the exact same key and body', async () => {
    installSuccessfulRawPut();
    let completeCalls = 0;
    mocks.authenticatedRequest.mockImplementation((path: string, options: {
      decode(value: unknown): unknown;
    }) => {
      if (path === '/files/upload-intents') return Promise.resolve(options.decode(intent()));
      completeCalls += 1;
      if (completeCalls === 1) {
        return Promise.reject(new StoreApiError('lost', { status: 0, code: 'NETWORK_ERROR' }));
      }
      return Promise.resolve(options.decode(complete()));
    });

    await expect(uploadStoreAftersaleEvidence({
      bytes: PNG.buffer,
      filename: 'evidence.png',
      mime_type: 'image/png',
    }, 'stable-complete-key')).resolves.toEqual(complete());

    const completeRequests = mocks.authenticatedRequest.mock.calls.filter(
      ([path]) => path === `/files/${FILE_ID}/complete`,
    );
    expect(completeRequests).toHaveLength(2);
    expect(completeRequests[0]?.[1]).toMatchObject({
      data: { sha256: PNG_SHA256, size: PNG.length },
      expectedStatus: 200,
      headers: { 'Idempotency-Key': 'stable-complete-key' },
      method: 'POST',
    });
    expect(completeRequests[1]?.[1]).toMatchObject({
      data: { sha256: PNG_SHA256, size: PNG.length },
      expectedStatus: 200,
      headers: { 'Idempotency-Key': 'stable-complete-key' },
      method: 'POST',
    });
  });

  it('does not PUT an A upload intent after the customer session changes to B', async () => {
    installSuccessfulRawPut();
    mocks.authenticatedRequest.mockImplementation((_path: string, options: {
      decode(value: unknown): unknown;
    }) => {
      const result = options.decode(intent());
      mocks.customerSessionGeneration.mockReturnValue(3);
      mocks.loadCustomerRefreshCredential.mockReturnValue({
        refresh_token: 'customer-b-refresh-token',
        refresh_expires_at: '2030-01-01T00:00:00.000Z',
      });
      return Promise.resolve(result);
    });

    await expect(uploadStoreAftersaleEvidence({
      bytes: PNG,
      filename: 'evidence.png',
      mime_type: 'image/png',
    }, 'stable-complete-key')).rejects.toMatchObject({ code: 'SESSION_CHANGED', status: 409 });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.authenticatedRequest).toHaveBeenCalledOnce();
  });

  it('continues an upload when only the same customer credentials rotate', async () => {
    installSuccessfulRawPut();
    mocks.authenticatedRequest.mockImplementation((path: string, options: {
      decode(value: unknown): unknown;
    }) => {
      if (path === '/files/upload-intents') {
        mocks.loadCustomerRefreshCredential.mockReturnValue({
          refresh_token: 'customer-a-rotated-refresh-token',
          refresh_expires_at: '2030-02-01T00:00:00.000Z',
        });
        return Promise.resolve(options.decode(intent()));
      }
      return Promise.resolve(options.decode(complete()));
    });

    await expect(uploadStoreAftersaleEvidence({
      bytes: PNG,
      filename: 'evidence.png',
      mime_type: 'image/png',
    }, 'stable-complete-key')).resolves.toEqual(complete());
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.authenticatedRequest).toHaveBeenCalledTimes(2);
    expect(mocks.customerSessionGeneration).toHaveReturnedWith(1);
  });

  it('does not complete an A upload after logout and login as B during the raw PUT', async () => {
    let finishPut: (() => void) | undefined;
    vi.stubGlobal('uni', { request: mocks.request });
    mocks.request.mockImplementation((options: { success(result: unknown): void }) => {
      finishPut = () => options.success({ statusCode: 200, data: '', header: {} });
      return { abort: vi.fn() };
    });
    mocks.authenticatedRequest.mockImplementation((_path: string, options: {
      decode(value: unknown): unknown;
    }) => Promise.resolve(options.decode(intent())));

    const upload = uploadStoreAftersaleEvidence({
      bytes: PNG,
      filename: 'evidence.png',
      mime_type: 'image/png',
    }, 'stable-complete-key');
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    mocks.customerSessionGeneration.mockReturnValue(3);
    mocks.loadCustomerRefreshCredential.mockReturnValue({
      refresh_token: 'customer-b-refresh-token',
      refresh_expires_at: '2030-01-01T00:00:00.000Z',
    });
    if (!finishPut) throw new Error('The raw upload did not start');
    finishPut();

    await expect(upload).rejects.toMatchObject({ code: 'SESSION_CHANGED', status: 409 });
    expect(mocks.authenticatedRequest).toHaveBeenCalledOnce();
  });

  it.each([
    { bytes: PNG, filename: 'evidence.gif', mime_type: 'image/gif' },
    { bytes: new Uint8Array([1, 2, 3]), filename: 'evidence.png', mime_type: 'image/png' },
    { bytes: new Uint8Array(), filename: 'evidence.png', mime_type: 'image/png' },
    { bytes: PNG, filename: '  ', mime_type: 'image/png' },
  ])('rejects unsupported, mismatched, empty, or malformed images before requesting intent', async (input) => {
    await expect(uploadStoreAftersaleEvidence(input as never, 'complete-key')).rejects
      .toBeInstanceOf(StoreApiError);
    expect(mocks.authenticatedRequest).not.toHaveBeenCalled();
  });

  it.each([
    { ...intent(), purpose: 'PRODUCT_IMAGE' },
    { ...intent(), upload_url: 'http://storage.example.test/upload' },
    { ...intent(), upload_headers: [{ name: 'content-type', value: 'image/png' }] },
    {
      ...intent(),
      upload_headers: [
        { name: 'content-type', value: 'image/jpeg' },
        { name: 'x-amz-meta-sha256', value: PNG_SHA256 },
      ],
    },
  ])('fails closed on unsafe or mismatched upload capabilities', async (response) => {
    mocks.authenticatedRequest.mockImplementation((_path: string, options: {
      decode(value: unknown): unknown;
    }) => Promise.resolve(options.decode(response)));
    await expect(uploadStoreAftersaleEvidence({
      bytes: PNG,
      filename: 'evidence.png',
      mime_type: 'image/png',
    }, 'complete-key')).rejects.toBeInstanceOf(StoreEnvelopeFormatError);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
