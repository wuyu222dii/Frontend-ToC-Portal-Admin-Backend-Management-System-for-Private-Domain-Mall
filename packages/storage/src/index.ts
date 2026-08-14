import { createHash } from 'node:crypto';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';

export const FILE_OBJECT_LEASE_TTL_MS = 120_000;
export const STORAGE_CONNECTION_TIMEOUT_MS = 5_000;
export const STORAGE_MAX_ATTEMPTS = 1;
export const STORAGE_REQUEST_TIMEOUT_MS = 60_000;

export type FileImageMimeType = 'image/jpeg' | 'image/png';
export type FileObjectPartition = 'staging' | 'public' | 'private';

export interface StorageRuntimeConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
}

export interface SignedRequestHeader {
  name: string;
  value: string;
}

export interface SignedObjectRequest {
  url: string;
  headers: readonly SignedRequestHeader[];
  expiresAt: Date;
}

export interface PresignPutInput {
  key: string;
  byteSize: number;
  mimeType: FileImageMimeType;
  sha256Hex: string;
  expiresInSeconds: number;
}

export interface InspectedObject {
  byteSize: number;
  etag: string;
  mimeType: FileImageMimeType;
  sha256Hex: string;
}

export interface CopyObjectInput extends InspectedObject {
  sourceKey: string;
  destinationKey: string;
}

export interface CopyObjectResult {
  copied: boolean;
  verified: InspectedObject;
}

export interface ObjectStoragePort {
  presignPut(input: PresignPutInput): Promise<SignedObjectRequest>;
  inspectAndHash(input: { key: string; maxBytes: number }): Promise<InspectedObject>;
  copyIfAbsent(input: CopyObjectInput): Promise<CopyObjectResult>;
  deleteIfExists(key: string): Promise<void>;
  presignGet(key: string, expiresInSeconds: number): Promise<SignedObjectRequest>;
  publicUrl(key: string): string;
}

export type ObjectStorageErrorCode =
  | 'OBJECT_CONTENT_MISMATCH'
  | 'OBJECT_CONFLICT'
  | 'OBJECT_NOT_FOUND'
  | 'OBJECT_STORAGE_FAILURE'
  | 'OBJECT_TOO_LARGE';

export class ObjectStorageError extends Error {
  override readonly name = 'ObjectStorageError';

  constructor(readonly code: ObjectStorageErrorCode) {
    super(code);
  }
}

export type StorageCommand =
  | CopyObjectCommand
  | DeleteObjectCommand
  | GetObjectCommand
  | HeadObjectCommand
  | PutObjectCommand;

interface StorageDependencies {
  now?: () => Date;
  send?: (command: StorageCommand) => Promise<unknown>;
  sign?: (
    command: GetObjectCommand | PutObjectCommand,
    expiresInSeconds: number,
  ) => Promise<string>;
}

interface HeadObjectFacts {
  ContentLength?: number;
  ContentType?: string;
  ETag?: string;
  Metadata?: Record<string, string>;
}

interface GetObjectFacts extends HeadObjectFacts {
  Body?: unknown;
}

const FILE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const OBJECT_KEY_PATTERN = /^(?:staging|public|private)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,490}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORAGE_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

export function fileObjectLeaseKey(fileId: string): string {
  if (!FILE_ID_PATTERN.test(fileId)) throw new TypeError('File ID must be a ULID');
  return `file-object:v1:${fileId}`;
}

export function fileObjectKey(partition: FileObjectPartition, fileId: string): string {
  if (!FILE_ID_PATTERN.test(fileId)) throw new TypeError('File ID must be a ULID');
  return `${partition}/${fileId}`;
}

function assertObjectKey(key: string): void {
  if (
    key.length > 500 ||
    !OBJECT_KEY_PATTERN.test(key) ||
    key.split('/').some((part) => part === '.' || part === '..' || part.length === 0)
  ) {
    throw new TypeError('Object key must use an approved file partition');
  }
}

function assertMimeType(mimeType: string): asserts mimeType is FileImageMimeType {
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    throw new TypeError('Object MIME type is not supported');
  }
}

function assertSha256(sha256Hex: string): void {
  if (!SHA256_PATTERN.test(sha256Hex)) {
    throw new TypeError('Object SHA-256 must be lowercase hexadecimal');
  }
}

function assertByteSize(byteSize: number): void {
  if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > 5_242_880) {
    throw new TypeError('Object byte size must be between 1 and 5242880');
  }
}

function assertEtag(etag: string): void {
  if (!/^"[a-fA-F0-9]{32}(?:-[1-9][0-9]*)?"$/.test(etag)) {
    throw new TypeError('Object ETag is invalid');
  }
}

function assertExpiresInSeconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 900) {
    throw new TypeError('Signed URL lifetime must be between 1 and 900 seconds');
  }
}

function validateConfig(config: StorageRuntimeConfig): { publicBaseUrl: string } {
  let endpoint: URL;
  let publicBaseUrl: URL;
  try {
    endpoint = new URL(config.endpoint);
    publicBaseUrl = new URL(config.publicBaseUrl);
  } catch {
    throw new TypeError('Storage endpoints must be valid URLs');
  }
  for (const url of [endpoint, publicBaseUrl]) {
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.hash) {
      throw new TypeError('Storage endpoints have an invalid format');
    }
  }
  if (endpoint.search || publicBaseUrl.search) {
    throw new TypeError('Storage endpoints must not contain query parameters');
  }
  if (!STORAGE_BUCKET_PATTERN.test(config.bucket)) throw new TypeError('Storage bucket is invalid');
  if (publicBaseUrl.pathname.replace(/\/$/, '') !== `/${config.bucket}`) {
    throw new TypeError('Storage public base URL must identify the configured bucket');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(config.region)) {
    throw new TypeError('Storage region is invalid');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(config.accessKey)) {
    throw new TypeError('Storage access key is invalid');
  }
  if (config.secretKey.length < 16 || config.secretKey.length > 256) {
    throw new TypeError('Storage secret key is invalid');
  }
  return { publicBaseUrl: publicBaseUrl.toString().replace(/\/$/, '') };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return record.name === 'NoSuchKey' || record.name === 'NotFound' || record.$metadata?.httpStatusCode === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return record.name === 'PreconditionFailed' || record.$metadata?.httpStatusCode === 412;
}

function toStorageError(error: unknown): ObjectStorageError {
  if (error instanceof ObjectStorageError) return error;
  if (isNotFound(error)) return new ObjectStorageError('OBJECT_NOT_FOUND');
  if (isPreconditionFailed(error)) return new ObjectStorageError('OBJECT_CONTENT_MISMATCH');
  return new ObjectStorageError('OBJECT_STORAGE_FAILURE');
}

function asyncBody(body: unknown): AsyncIterable<unknown> {
  if (
    typeof body !== 'object' ||
    body === null ||
    !(Symbol.asyncIterator in body) ||
    typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function'
  ) {
    throw new ObjectStorageError('OBJECT_STORAGE_FAILURE');
  }
  return body as AsyncIterable<unknown>;
}

function destroyBody(body: unknown): void {
  if (typeof body !== 'object' || body === null) return;
  const destroy = (body as { destroy?: unknown }).destroy;
  if (typeof destroy === 'function') destroy.call(body);
}

function bytesFromChunk(chunk: unknown): Buffer {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw new ObjectStorageError('OBJECT_STORAGE_FAILURE');
}

function detectImageMimeType(prefix: Buffer): FileImageMimeType | undefined {
  if (prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    return 'image/jpeg';
  }
  return undefined;
}

function encodeCopySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function sameObjectFacts(actual: InspectedObject, expected: InspectedObject): boolean {
  return actual.byteSize === expected.byteSize &&
    actual.mimeType === expected.mimeType &&
    actual.sha256Hex === expected.sha256Hex;
}

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly now: () => Date;
  private readonly publicBaseUrl: string;
  private readonly sendCommand: (command: StorageCommand) => Promise<unknown>;
  private readonly signCommand: (
    command: GetObjectCommand | PutObjectCommand,
    expiresInSeconds: number,
  ) => Promise<string>;

  constructor(
    private readonly config: StorageRuntimeConfig,
    dependencies: StorageDependencies = {},
  ) {
    const validated = validateConfig(config);
    this.publicBaseUrl = validated.publicBaseUrl;
    this.now = dependencies.now ?? (() => new Date());
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      forcePathStyle: config.forcePathStyle,
      maxAttempts: STORAGE_MAX_ATTEMPTS,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: STORAGE_CONNECTION_TIMEOUT_MS,
        requestTimeout: STORAGE_REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      }),
    });
    this.sendCommand = dependencies.send ?? ((command) => client.send(command as never));
    this.signCommand = dependencies.sign ?? ((command, expiresInSeconds) =>
      getSignedUrl(client, command, {
        expiresIn: expiresInSeconds,
        signableHeaders: new Set(['content-length', 'content-type']),
        unhoistableHeaders: new Set(['x-amz-meta-sha256']),
      }));
    this.currentTime();
  }

  async presignPut(input: PresignPutInput): Promise<SignedObjectRequest> {
    assertObjectKey(input.key);
    assertByteSize(input.byteSize);
    assertMimeType(input.mimeType);
    assertSha256(input.sha256Hex);
    assertExpiresInSeconds(input.expiresInSeconds);
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      ContentLength: input.byteSize,
      ContentType: input.mimeType,
      Metadata: { sha256: input.sha256Hex },
    });
    try {
      const url = await this.signCommand(command, input.expiresInSeconds);
      return {
        url,
        headers: [
          { name: 'content-type', value: input.mimeType },
          { name: 'x-amz-meta-sha256', value: input.sha256Hex },
        ],
        expiresAt: new Date(this.currentTime().getTime() + input.expiresInSeconds * 1_000),
      };
    } catch (error) {
      throw toStorageError(error);
    }
  }

  async inspectAndHash(input: { key: string; maxBytes: number }): Promise<InspectedObject> {
    assertObjectKey(input.key);
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > 5_242_880) {
      throw new TypeError('Object inspection limit must be between 1 and 5242880 bytes');
    }
    let output: GetObjectFacts;
    try {
      output = await this.sendCommand(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: input.key,
      })) as GetObjectFacts;
    } catch (error) {
      throw toStorageError(error);
    }
    if (typeof output.ContentLength === 'number' && output.ContentLength > input.maxBytes) {
      destroyBody(output.Body);
      throw new ObjectStorageError('OBJECT_TOO_LARGE');
    }
    const body = asyncBody(output.Body);
    const hash = createHash('sha256');
    let byteSize = 0;
    let prefix = Buffer.alloc(0);
    try {
      for await (const chunk of body) {
        const bytes = bytesFromChunk(chunk);
        byteSize += bytes.length;
        if (byteSize > input.maxBytes) {
          destroyBody(output.Body);
          throw new ObjectStorageError('OBJECT_TOO_LARGE');
        }
        hash.update(bytes);
        if (prefix.length < 8) prefix = Buffer.concat([prefix, bytes]).subarray(0, 8);
      }
    } catch (error) {
      throw toStorageError(error);
    }
    const detectedMimeType = detectImageMimeType(prefix);
    if (
      !detectedMimeType ||
      output.ContentType !== detectedMimeType ||
      byteSize < 1 ||
      (output.ContentLength !== undefined && output.ContentLength !== byteSize)
    ) {
      throw new ObjectStorageError('OBJECT_CONTENT_MISMATCH');
    }
    if (typeof output.ETag !== 'string') throw new ObjectStorageError('OBJECT_CONTENT_MISMATCH');
    try {
      assertEtag(output.ETag);
    } catch {
      throw new ObjectStorageError('OBJECT_CONTENT_MISMATCH');
    }
    return {
      byteSize,
      etag: output.ETag,
      mimeType: detectedMimeType,
      sha256Hex: hash.digest('hex'),
    };
  }

  async copyIfAbsent(input: CopyObjectInput): Promise<CopyObjectResult> {
    assertObjectKey(input.sourceKey);
    assertObjectKey(input.destinationKey);
    if (input.sourceKey === input.destinationKey) throw new TypeError('Copy destination must differ from source');
    assertMimeType(input.mimeType);
    assertSha256(input.sha256Hex);
    assertEtag(input.etag);
    assertByteSize(input.byteSize);
    const existing = await this.headIfPresent(input.destinationKey);
    if (existing) {
      let inspected: InspectedObject;
      try {
        inspected = await this.inspectAndHash({ key: input.destinationKey, maxBytes: input.byteSize });
      } catch (error) {
        if (error instanceof ObjectStorageError &&
          (error.code === 'OBJECT_TOO_LARGE' || error.code === 'OBJECT_CONTENT_MISMATCH')) {
          throw new ObjectStorageError('OBJECT_CONFLICT');
        }
        throw error;
      }
      if (!sameObjectFacts(inspected, input)) throw new ObjectStorageError('OBJECT_CONFLICT');
      return { copied: false, verified: inspected };
    }
    try {
      await this.sendCommand(new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: input.destinationKey,
        CopySource: encodeCopySource(this.config.bucket, input.sourceKey),
        CopySourceIfMatch: input.etag,
        ContentType: input.mimeType,
        Metadata: { sha256: input.sha256Hex },
        MetadataDirective: 'REPLACE',
      }));
    } catch (error) {
      throw toStorageError(error);
    }
    const copied = await this.headIfPresent(input.destinationKey);
    if (!copied) {
      throw new ObjectStorageError('OBJECT_CONFLICT');
    }
    let inspected: InspectedObject;
    try {
      inspected = await this.inspectAndHash({ key: input.destinationKey, maxBytes: input.byteSize });
    } catch (error) {
      if (error instanceof ObjectStorageError && error.code === 'OBJECT_TOO_LARGE') {
        throw new ObjectStorageError('OBJECT_CONFLICT');
      }
      throw error;
    }
    if (!sameObjectFacts(inspected, input)) throw new ObjectStorageError('OBJECT_CONFLICT');
    return { copied: true, verified: inspected };
  }

  async deleteIfExists(key: string): Promise<void> {
    assertObjectKey(key);
    try {
      await this.sendCommand(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
    } catch (error) {
      throw toStorageError(error);
    }
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<SignedObjectRequest> {
    assertObjectKey(key);
    if (!key.startsWith('private/')) throw new TypeError('Only private objects use signed downloads');
    assertExpiresInSeconds(expiresInSeconds);
    try {
      const url = await this.signCommand(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
        expiresInSeconds,
      );
      return {
        url,
        headers: [],
        expiresAt: new Date(this.currentTime().getTime() + expiresInSeconds * 1_000),
      };
    } catch (error) {
      throw toStorageError(error);
    }
  }

  publicUrl(key: string): string {
    assertObjectKey(key);
    if (!key.startsWith('public/')) throw new TypeError('Only public objects have a stable public URL');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    return `${this.publicBaseUrl}/${encodedKey}`;
  }

  private async headIfPresent(key: string): Promise<HeadObjectFacts | undefined> {
    try {
      return await this.sendCommand(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })) as HeadObjectFacts;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw toStorageError(error);
    }
  }

  private currentTime(): Date {
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('Storage clock must return a valid Date');
    }
    return now;
  }
}

export function createS3ObjectStorage(config: StorageRuntimeConfig): S3ObjectStorage {
  return new S3ObjectStorage(config);
}
