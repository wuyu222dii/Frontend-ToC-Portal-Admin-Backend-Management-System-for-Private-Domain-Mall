import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminApiError } from './admin-api';

const mocks = vi.hoisted(() => ({
  adminSessionRequest: vi.fn(),
  newIdempotencyKey: vi.fn(),
}));

vi.mock('./admin-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./admin-api')>(),
  adminSessionRequest: mocks.adminSessionRequest,
  newIdempotencyKey: mocks.newIdempotencyKey,
}));

import { uploadAdminImage } from './admin-files';

const FILE_ID = '01J00000000000000000000000';
const OTHER_FILE_ID = '01J00000000000000000000001';
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_SHA256 = '4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6';
const TIME = '2026-09-01T01:02:03.000Z';

function envelope<T>(data: T) {
  return { code: 'OK', data, message: 'success', request_id: 'req_admin_file_upload' };
}

function intent(purpose = 'AFTERSALE_EVIDENCE') {
  return envelope({
    expires_at: TIME,
    file_id: FILE_ID,
    purpose,
    status: 'PENDING',
    upload_headers: [
      { name: 'content-type', value: 'image/png' },
      { name: 'x-amz-meta-sha256', value: PNG_SHA256 },
    ],
    upload_url: 'http://127.0.0.1:9002/mall-development/staging/signed?X-Amz-Signature=test',
  });
}

function complete(purpose = 'AFTERSALE_EVIDENCE', publicUrl: string | null = null) {
  return envelope({
    completed_at: TIME,
    file_id: FILE_ID,
    public_url: publicUrl,
    purpose,
    status: 'READY',
  });
}

function imageFile(): File {
  return {
    arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength) as ArrayBuffer,
    name: 'evidence.png',
    size: PNG.byteLength,
    type: 'image/png',
  } as File;
}

function installSuccessfulResponses(
  intentResponse: unknown = intent(),
  completeResponse: unknown = complete(),
): ReturnType<typeof vi.fn> {
  mocks.adminSessionRequest.mockImplementation((path: string) => Promise.resolve(
    path === '/files/upload-intents' ? intentResponse : completeResponse,
  ));
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  mocks.adminSessionRequest.mockReset();
  mocks.newIdempotencyKey.mockReset()
    .mockReturnValueOnce('intent-idempotency-key')
    .mockReturnValue('complete-idempotency-key');
});

afterEach(() => vi.unstubAllGlobals());

describe('Admin file upload runtime contract', () => {
  it('validates a private evidence upload and completes it with exact request facts', async () => {
    const fetchMock = installSuccessfulResponses();

    await expect(uploadAdminImage('AFTERSALE_EVIDENCE', imageFile())).resolves.toEqual(complete().data);

    expect(mocks.adminSessionRequest).toHaveBeenNthCalledWith(1, '/files/upload-intents', {
      body: {
        filename: 'evidence.png',
        mime_type: 'image/png',
        purpose: 'AFTERSALE_EVIDENCE',
        sha256: PNG_SHA256,
        size: PNG.byteLength,
      },
      expectedStatus: 200,
      idempotencyKey: 'intent-idempotency-key',
      method: 'POST',
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(intent().data.upload_url, expect.objectContaining({
      body: expect.objectContaining({ name: 'evidence.png', type: 'image/png' }),
      cache: 'no-store',
      credentials: 'omit',
      method: 'PUT',
      referrerPolicy: 'no-referrer',
    }));
    const uploadInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(uploadInit?.headers)).toEqual(new Headers({
      'content-type': 'image/png',
      'x-amz-meta-sha256': PNG_SHA256,
    }));
    expect(mocks.adminSessionRequest).toHaveBeenNthCalledWith(2, `/files/${FILE_ID}/complete`, {
      body: { sha256: PNG_SHA256, size: PNG.byteLength },
      expectedStatus: 200,
      idempotencyKey: 'complete-idempotency-key',
      method: 'POST',
      signal: undefined,
    });
  });

  it('accepts a safe public URL only for a public image purpose', async () => {
    installSuccessfulResponses(
      intent('PRODUCT_IMAGE'),
      complete('PRODUCT_IMAGE', 'https://assets.example.test/public/image.png'),
    );

    await expect(uploadAdminImage('PRODUCT_IMAGE', imageFile())).resolves.toMatchObject({
      file_id: FILE_ID,
      public_url: 'https://assets.example.test/public/image.png',
      purpose: 'PRODUCT_IMAGE',
      status: 'READY',
    });
  });

  it.each([
    ['extra envelope field', { ...intent(), leaked: true }],
    ['wrong purpose', envelope({ ...intent().data, purpose: 'PRODUCT_IMAGE' })],
    ['wrong status', envelope({ ...intent().data, status: 'READY' })],
    ['invalid file id', envelope({ ...intent().data, file_id: 'not-a-ulid' })],
    ['invalid expiry', envelope({ ...intent().data, expires_at: '2026-02-30T01:02:03Z' })],
    ['unsafe upload URL', envelope({ ...intent().data, upload_url: 'http://storage.example.test/upload' })],
    ['missing signed header', envelope({
      ...intent().data,
      upload_headers: [{ name: 'content-type', value: 'image/png' }],
    })],
    ['mismatched MIME header', envelope({
      ...intent().data,
      upload_headers: [
        { name: 'content-type', value: 'image/jpeg' },
        { name: 'x-amz-meta-sha256', value: PNG_SHA256 },
      ],
    })],
    ['mismatched digest header', envelope({
      ...intent().data,
      upload_headers: [
        { name: 'content-type', value: 'image/png' },
        { name: 'x-amz-meta-sha256', value: 'a'.repeat(64) },
      ],
    })],
    ['duplicate signed header', envelope({
      ...intent().data,
      upload_headers: [
        { name: 'content-type', value: 'image/png' },
        { name: 'Content-Type', value: 'image/png' },
      ],
    })],
    ['extra data field', envelope({ ...intent().data, leaked: true })],
  ])('rejects malformed intent responses: %s', async (_label, response) => {
    const fetchMock = installSuccessfulResponses(response);

    await expect(uploadAdminImage('AFTERSALE_EVIDENCE', imageFile())).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.adminSessionRequest).toHaveBeenCalledOnce();
  });

  it.each([
    ['wrong file', envelope({ ...complete().data, file_id: OTHER_FILE_ID })],
    ['wrong purpose', envelope({ ...complete().data, purpose: 'PRODUCT_IMAGE' })],
    ['wrong status', envelope({ ...complete().data, status: 'PENDING' })],
    ['public URL on private evidence', complete('AFTERSALE_EVIDENCE', 'https://assets.example.test/leak.png')],
    ['invalid completion timestamp', envelope({ ...complete().data, completed_at: '2026-02-30T01:02:03Z' })],
    ['extra data field', envelope({ ...complete().data, leaked: true })],
  ])('rejects malformed complete responses without retrying them: %s', async (_label, response) => {
    const fetchMock = installSuccessfulResponses(intent(), response);

    await expect(uploadAdminImage('AFTERSALE_EVIDENCE', imageFile())).rejects.toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.adminSessionRequest).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing public URL for public image completion', async () => {
    installSuccessfulResponses(intent('PRODUCT_IMAGE'), complete('PRODUCT_IMAGE'));

    await expect(uploadAdminImage('PRODUCT_IMAGE', imageFile())).rejects.toBeInstanceOf(TypeError);
    expect(mocks.adminSessionRequest).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['network failure', new TypeError('connection reset'), { code: 'UPLOAD_NETWORK_ERROR', status: 0 }],
    ['object rejection', new Response(null, { status: 403 }), { code: 'UPLOAD_REJECTED', status: 403 }],
  ])('stops before complete after PUT %s', async (_label, outcome, expected) => {
    mocks.adminSessionRequest.mockResolvedValue(intent());
    const fetchMock = outcome instanceof Response
      ? vi.fn().mockResolvedValue(outcome)
      : vi.fn().mockRejectedValue(outcome);
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadAdminImage('AFTERSALE_EVIDENCE', imageFile())).rejects.toMatchObject(expected);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.adminSessionRequest).toHaveBeenCalledOnce();
  });

  it('retries an ambiguous complete failure once with the exact same key and body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    mocks.adminSessionRequest
      .mockResolvedValueOnce(intent())
      .mockRejectedValueOnce(new AdminApiError('lost response', { status: 503, code: 'INTERNAL_ERROR' }))
      .mockResolvedValueOnce(complete());

    await expect(uploadAdminImage('AFTERSALE_EVIDENCE', imageFile())).resolves.toEqual(complete().data);

    const completeCalls = mocks.adminSessionRequest.mock.calls.slice(1);
    expect(completeCalls).toHaveLength(2);
    expect(completeCalls[0]).toEqual(completeCalls[1]);
    expect(completeCalls[0]?.[1]).toMatchObject({
      body: { sha256: PNG_SHA256, size: PNG.byteLength },
      idempotencyKey: 'complete-idempotency-key',
    });
  });

  it('does not retry a definite complete rejection', async () => {
    const failure = new AdminApiError('content mismatch', { status: 422, code: 'FILE_CONTENT_MISMATCH' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    mocks.adminSessionRequest
      .mockResolvedValueOnce(intent())
      .mockRejectedValueOnce(failure);

    await expect(uploadAdminImage('AFTERSALE_EVIDENCE', imageFile())).rejects.toBe(failure);
    expect(mocks.adminSessionRequest).toHaveBeenCalledTimes(2);
  });
});
