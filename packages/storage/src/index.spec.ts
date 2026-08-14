import { createHash } from 'node:crypto';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import {
  FILE_OBJECT_LEASE_TTL_MS,
  ObjectStorageError,
  S3ObjectStorage,
  type StorageCommand,
  STORAGE_CONNECTION_TIMEOUT_MS,
  STORAGE_MAX_ATTEMPTS,
  STORAGE_REQUEST_TIMEOUT_MS,
  fileObjectKey,
  fileObjectLeaseKey,
} from './index';

const fileId = '01K00000000000000000000000';
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('png-body'),
]);

const config = {
  endpoint: 'http://127.0.0.1:9000',
  bucket: 'mall-development',
  region: 'us-east-1',
  accessKey: 'test-access-key-1',
  secretKey: 'test-secret-key-1',
  forcePathStyle: true,
  publicBaseUrl: 'http://127.0.0.1:9000/mall-development',
};

function notFound(): Error & { $metadata: { httpStatusCode: number } } {
  return Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } });
}

describe('file object naming', () => {
  it('uses opaque partitioned keys and one shared lease namespace', () => {
    expect(fileObjectKey('staging', fileId)).toBe(`staging/${fileId}`);
    expect(fileObjectKey('public', fileId)).toBe(`public/${fileId}`);
    expect(fileObjectLeaseKey(fileId)).toBe(`file-object:v1:${fileId}`);
    expect(FILE_OBJECT_LEASE_TTL_MS).toBe(120_000);
    expect(STORAGE_CONNECTION_TIMEOUT_MS).toBe(5_000);
    expect(STORAGE_MAX_ATTEMPTS).toBe(1);
    expect(STORAGE_REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(STORAGE_REQUEST_TIMEOUT_MS).toBeLessThan(FILE_OBJECT_LEASE_TTL_MS);
  });

  it('rejects filenames and invalid IDs as key material', () => {
    expect(() => fileObjectKey('staging', 'logo.png')).toThrow('ULID');
    expect(() => fileObjectLeaseKey('../file')).toThrow('ULID');
  });
});

describe('S3ObjectStorage', () => {
  it('binds the stable public base URL to the configured bucket', () => {
    expect(() => new S3ObjectStorage({ ...config, publicBaseUrl: 'http://127.0.0.1:9000/other' }))
      .toThrow('configured bucket');
  });

  it('binds content type and expected hash into the signed PUT request', async () => {
    const sign = vi.fn(async (
      command: GetObjectCommand | PutObjectCommand,
      expiresInSeconds: number,
    ) => {
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(expiresInSeconds).toBe(900);
      return 'http://127.0.0.1:9000/signed';
    });
    const storage = new S3ObjectStorage(config, {
      now: () => new Date('2026-08-14T00:00:00.000Z'),
      send: vi.fn(),
      sign,
    });

    const result = await storage.presignPut({
      key: fileObjectKey('staging', fileId),
      byteSize: png.length,
      mimeType: 'image/png',
      sha256Hex: 'a'.repeat(64),
      expiresInSeconds: 900,
    });

    const command = sign.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'mall-development',
      ContentLength: png.length,
      ContentType: 'image/png',
      Key: `staging/${fileId}`,
      Metadata: { sha256: 'a'.repeat(64) },
    });
    expect(result).toEqual({
      url: 'http://127.0.0.1:9000/signed',
      headers: [
        { name: 'content-type', value: 'image/png' },
        { name: 'x-amz-meta-sha256', value: 'a'.repeat(64) },
      ],
      expiresAt: new Date('2026-08-14T00:15:00.000Z'),
    });
  });

  it('rejects an upload intent size outside the supported range before signing', async () => {
    const sign = vi.fn();
    const storage = new S3ObjectStorage(config, { send: vi.fn(), sign });

    await expect(storage.presignPut({
      key: fileObjectKey('staging', fileId),
      byteSize: 5_242_881,
      mimeType: 'image/png',
      sha256Hex: 'a'.repeat(64),
      expiresInSeconds: 900,
    })).rejects.toThrow('between 1 and 5242880');
    expect(sign).not.toHaveBeenCalled();
  });

  it('streams an object and derives size, SHA-256 and PNG magic independently of metadata', async () => {
    const send = vi.fn(async (command: StorageCommand) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      return {
        Body: (async function* () {
          yield png.subarray(0, 4);
          yield png.subarray(4);
        })(),
        ContentLength: png.length,
        ContentType: 'image/png',
        ETag: '"11111111111111111111111111111111"',
        Metadata: { sha256: 'client-controlled-value' },
      };
    });
    const storage = new S3ObjectStorage(config, { send, sign: vi.fn() });

    await expect(storage.inspectAndHash({
      key: fileObjectKey('staging', fileId),
      maxBytes: 5_242_880,
    })).resolves.toEqual({
      byteSize: png.length,
      etag: '"11111111111111111111111111111111"',
      mimeType: 'image/png',
      sha256Hex: createHash('sha256').update(png).digest('hex'),
    });
  });

  it.each([
    { bytes: Buffer.from('not-an-image'), contentType: 'image/png' },
    { bytes: png, contentType: 'image/jpeg' },
  ])('rejects a forged or mismatched MIME type', async ({ bytes, contentType }) => {
    const storage = new S3ObjectStorage(config, {
      send: vi.fn(async () => ({
        Body: (async function* () { yield bytes; })(),
        ContentLength: bytes.length,
        ContentType: contentType,
        ETag: '"11111111111111111111111111111111"',
      })),
      sign: vi.fn(),
    });

    await expect(storage.inspectAndHash({
      key: fileObjectKey('staging', fileId),
      maxBytes: 5_242_880,
    })).rejects.toMatchObject({ code: 'OBJECT_CONTENT_MISMATCH' });
  });

  it('rejects an object whose reported and streamed sizes differ', async () => {
    const storage = new S3ObjectStorage(config, {
      send: vi.fn(async () => ({
        Body: (async function* () { yield png; })(),
        ContentLength: png.length + 1,
        ContentType: 'image/png',
        ETag: '"11111111111111111111111111111111"',
      })),
      sign: vi.fn(),
    });

    await expect(storage.inspectAndHash({
      key: fileObjectKey('staging', fileId),
      maxBytes: 5_242_880,
    })).rejects.toMatchObject({ code: 'OBJECT_CONTENT_MISMATCH' });
  });

  it('stops streaming immediately when the limit is exceeded', async () => {
    const destroy = vi.fn();
    const body = Object.assign((async function* () {
      yield png;
      yield Buffer.alloc(2);
      throw new Error('must not reach a third chunk');
    })(), { destroy });
    const storage = new S3ObjectStorage(config, {
      send: vi.fn(async () => ({
        Body: body,
        ContentType: 'image/png',
        ETag: '"11111111111111111111111111111111"',
      })),
      sign: vi.fn(),
    });

    await expect(storage.inspectAndHash({
      key: fileObjectKey('staging', fileId),
      maxBytes: png.length,
    })).rejects.toMatchObject({ code: 'OBJECT_TOO_LARGE' });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not copy again when the destination has exact immutable facts', async () => {
    const sha256Hex = createHash('sha256').update(png).digest('hex');
    const send = vi.fn(async (command: StorageCommand) => {
      if (command instanceof HeadObjectCommand) return {};
      expect(command).toBeInstanceOf(GetObjectCommand);
      return {
        Body: (async function* () { yield png; })(),
        ContentLength: png.length,
        ContentType: 'image/png',
        ETag: '"22222222222222222222222222222222"',
        Metadata: { sha256: sha256Hex },
      };
    });
    const storage = new S3ObjectStorage(config, { send, sign: vi.fn() });

    await expect(storage.copyIfAbsent({
      sourceKey: fileObjectKey('staging', fileId),
      destinationKey: fileObjectKey('public', fileId),
      byteSize: png.length,
      etag: '"11111111111111111111111111111111"',
      mimeType: 'image/png',
      sha256Hex,
    })).resolves.toEqual({
      copied: false,
      verified: {
        byteSize: png.length,
        etag: '"22222222222222222222222222222222"',
        mimeType: 'image/png',
        sha256Hex,
      },
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('copies a missing destination and verifies it before returning', async () => {
    const sha256Hex = createHash('sha256').update(png).digest('hex');
    let headCount = 0;
    const send = vi.fn(async (command: StorageCommand) => {
      if (command instanceof HeadObjectCommand) {
        headCount += 1;
        if (headCount === 1) throw notFound();
        return {
          ContentLength: png.length,
          ContentType: 'image/png',
          ETag: '"22222222222222222222222222222222"',
          Metadata: { sha256: sha256Hex },
        };
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: (async function* () { yield png; })(),
          ContentLength: png.length,
          ContentType: 'image/png',
          ETag: '"22222222222222222222222222222222"',
        };
      }
      expect(command).toBeInstanceOf(CopyObjectCommand);
      expect((command as CopyObjectCommand).input.CopySourceIfMatch).toBe(
        '"11111111111111111111111111111111"',
      );
      return {};
    });
    const storage = new S3ObjectStorage(config, { send, sign: vi.fn() });

    await expect(storage.copyIfAbsent({
      sourceKey: fileObjectKey('staging', fileId),
      destinationKey: fileObjectKey('private', fileId),
      byteSize: png.length,
      etag: '"11111111111111111111111111111111"',
      mimeType: 'image/png',
      sha256Hex,
    })).resolves.toEqual({
      copied: true,
      verified: {
        byteSize: png.length,
        etag: '"22222222222222222222222222222222"',
        mimeType: 'image/png',
        sha256Hex,
      },
    });
    expect(send.mock.calls.map(([command]) => command.constructor)).toEqual([
      HeadObjectCommand,
      CopyObjectCommand,
      HeadObjectCommand,
      GetObjectCommand,
    ]);
  });

  it('rejects a pre-existing destination with different facts', async () => {
    const storage = new S3ObjectStorage(config, {
      send: vi.fn(async () => ({
        ContentLength: png.length + 1,
        ContentType: 'image/png',
        Metadata: { sha256: 'b'.repeat(64) },
      })),
      sign: vi.fn(),
    });

    await expect(storage.copyIfAbsent({
      sourceKey: fileObjectKey('staging', fileId),
      destinationKey: fileObjectKey('public', fileId),
      byteSize: png.length,
      etag: '"11111111111111111111111111111111"',
      mimeType: 'image/png',
      sha256Hex: 'a'.repeat(64),
    })).rejects.toEqual(new ObjectStorageError('OBJECT_CONFLICT'));
  });

  it('fails closed when the source ETag changes between inspection and copy', async () => {
    const send = vi.fn(async (command: StorageCommand) => {
      if (command instanceof HeadObjectCommand) throw notFound();
      expect(command).toBeInstanceOf(CopyObjectCommand);
      expect((command as CopyObjectCommand).input.CopySourceIfMatch).toBe(
        '"11111111111111111111111111111111"',
      );
      throw Object.assign(new Error('precondition failed'), { $metadata: { httpStatusCode: 412 } });
    });
    const storage = new S3ObjectStorage(config, { send, sign: vi.fn() });

    await expect(storage.copyIfAbsent({
      sourceKey: fileObjectKey('staging', fileId),
      destinationKey: fileObjectKey('public', fileId),
      byteSize: png.length,
      etag: '"11111111111111111111111111111111"',
      mimeType: 'image/png',
      sha256Hex: createHash('sha256').update(png).digest('hex'),
    })).rejects.toMatchObject({ code: 'OBJECT_CONTENT_MISMATCH' });
  });

  it('deletes only one validated object key and creates no prefix operation', async () => {
    const send = vi.fn(async (command: StorageCommand) => {
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      return {};
    });
    const storage = new S3ObjectStorage(config, { send, sign: vi.fn() });

    await storage.deleteIfExists(fileObjectKey('staging', fileId));

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: 'mall-development',
      Key: `staging/${fileId}`,
    });
    await expect(storage.deleteIfExists('staging/')).rejects.toThrow('approved file partition');
  });

  it('signs private reads and only creates stable URLs for public objects', async () => {
    const sign = vi.fn(async (
      command: GetObjectCommand | PutObjectCommand,
      expiresInSeconds: number,
    ) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(expiresInSeconds).toBe(300);
      return 'https://files.example.test/private-signed';
    });
    const storage = new S3ObjectStorage(config, {
      now: () => new Date('2026-08-14T00:00:00.000Z'),
      send: vi.fn(),
      sign,
    });

    await expect(storage.presignGet(fileObjectKey('private', fileId), 300)).resolves.toEqual({
      url: 'https://files.example.test/private-signed',
      headers: [],
      expiresAt: new Date('2026-08-14T00:05:00.000Z'),
    });
    expect(sign.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(storage.publicUrl(fileObjectKey('public', fileId))).toBe(
      `http://127.0.0.1:9000/mall-development/public/${fileId}`,
    );
    expect(() => storage.publicUrl(fileObjectKey('private', fileId))).toThrow('Only public');
    await expect(storage.presignGet(fileObjectKey('public', fileId), 300)).rejects.toThrow(
      'Only private',
    );
  });
});
