import { isIP } from 'node:net';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  buildFinalObjectKey,
  buildStagingObjectKey,
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  FileAssetRepository,
  IdempotencyRepository,
  OutboxRepository,
  runSerializableTransaction,
  type CacheableFileUploadCompleteResponse,
  type DatabaseRuntime,
  type IdempotencyClaim,
} from '@qingxu/database';
import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import {
  ObjectStorageError,
  type ObjectStoragePort,
} from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import { FileObjectLeaseManager } from './file-object-lease';
import type { UploadCompleteInput, UploadIntentInput } from './files.dto';
import type { FilesRequestContext } from './files.request';

const ROUTES = {
  complete: '/files/{file_id}/complete',
  intent: '/files/upload-intents',
} as const;

function requestIp(request: FilesRequestContext): string | undefined {
  const value = request.socket?.remoteAddress;
  return typeof value === 'string' && isIP(value) !== 0 ? value : undefined;
}

function mapStorageError(error: unknown): never {
  if (error instanceof ObjectStorageError) {
    if (error.code === 'OBJECT_CONTENT_MISMATCH' || error.code === 'OBJECT_CONFLICT' ||
      error.code === 'OBJECT_NOT_FOUND' || error.code === 'OBJECT_TOO_LARGE') {
      throw new ApplicationError('FILE_CONTENT_MISMATCH', 'Uploaded object failed content verification');
    }
    throw new ApplicationError('INTERNAL_ERROR', 'Object storage operation failed');
  }
  throw error;
}

@Injectable()
export class FileAssetsService {
  private readonly logger = new Logger('FileAssetsService');
  private readonly assets!: FileAssetRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
    @Optional() @Inject(FileObjectLeaseManager) private readonly leases?: FileObjectLeaseManager,
  ) {
    if (config && database) {
      this.assets = new FileAssetRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
    }
  }

  async createUploadIntent(
    request: FilesRequestContext,
    input: UploadIntentInput,
    idempotencyKey: string,
  ) {
    this.authorizePurpose(request, input.purpose);
    const { config, database, storage } = this.runtime();
    const fileId = generateUlid();
    const objectKey = buildStagingObjectKey(fileId);
    let signed;
    try {
      signed = await storage.presignPut({
        byteSize: input.size,
        expiresInSeconds: config.storage.uploadTtlSeconds,
        key: objectKey,
        mimeType: input.mimeType,
        sha256Hex: input.sha256,
      });
    } catch (error) {
      mapStorageError(error);
    }
    const claim = this.claim(request.principal.accountId, idempotencyKey, ROUTES.intent, {
      filename: input.filename,
      mime_type: input.mimeType,
      purpose: input.purpose,
      sha256: input.sha256,
      size: input.size,
    });
    await runSerializableTransaction(database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Upload intent signing response cannot be replayed');
      }
      const asset = await this.assets.createPendingInTransaction(transaction, {
        actorId: request.principal.accountId,
        byteSize: BigInt(input.size),
        id: fileId,
        mimeType: input.mimeType,
        originalName: input.filename,
        purpose: input.purpose,
        sha256: input.sha256,
      });
      if (asset.objectKey !== objectKey) {
        throw new ApplicationError('INTERNAL_ERROR', 'File object key derivation is inconsistent');
      }
      const ipAddress = requestIp(request);
      await this.audit.append(transaction, {
        action: 'CREATE',
        actorAccountId: request.principal.accountId,
        actorRole: request.principal.role,
        idempotencyKey,
        ...(ipAddress === undefined ? {} : { ipAddress }),
        module: 'file',
        objectId: fileId,
        objectType: 'file',
        requestId: request.requestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'NONE',
      });
      await this.idempotency.complete(transaction, claim, {
        resourceId: fileId,
        responseForHash: { file_id: fileId, purpose: input.purpose, status: 'PENDING' },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
    });
    return {
      expires_at: signed.expiresAt.toISOString(),
      file_id: fileId,
      purpose: input.purpose,
      status: 'PENDING' as const,
      upload_headers: signed.headers,
      upload_url: signed.url,
    };
  }

  async completeUpload(
    request: FilesRequestContext,
    fileId: string,
    input: UploadCompleteInput,
    idempotencyKey: string,
  ) {
    const { config, database, storage } = this.runtime();
    const claim = this.claim(request.principal.accountId, idempotencyKey, ROUTES.complete, {
      sha256: input.sha256,
      size: input.size,
    }, { file_id: fileId });
    const replay = await runSerializableTransaction(database.prisma, async (transaction) => {
      const result = await this.idempotency.claim(transaction, claim);
      return result.kind === 'replay' ? this.idempotency.fileUploadCompleteReplay(result.record) : null;
    });
    if (replay) {
      this.authorizePurpose(request, replay.data.purpose);
      return preEnvelopedResponse(replay);
    }

    const initialAsset = await this.assets.getOwned({ actorId: request.principal.accountId, fileId });
    this.authorizePurpose(request, initialAsset.purpose);
    if (initialAsset.status !== 'PENDING') {
      throw new ApplicationError('STATE_CONFLICT', 'File asset has already left the pending state');
    }
    if (initialAsset.sha256 !== input.sha256 || initialAsset.byteSize !== BigInt(input.size)) {
      throw new ApplicationError('FILE_CONTENT_MISMATCH', 'Completion declaration does not match upload intent');
    }
    const lease = await this.leaseManager().acquire(fileId);
    let stagingKey: string | undefined;
    try {
      const asset = await this.assets.getOwned({ actorId: request.principal.accountId, fileId });
      this.authorizePurpose(request, asset.purpose);
      if (asset.status !== 'PENDING') {
        throw new ApplicationError('STATE_CONFLICT', 'File asset has already left the pending state');
      }
      if (asset.sha256 !== input.sha256 || asset.byteSize !== BigInt(input.size)) {
        throw new ApplicationError('FILE_CONTENT_MISMATCH', 'Completion declaration does not match upload intent');
      }
      stagingKey = asset.objectKey;
      let measured;
      try {
        measured = await storage.inspectAndHash({
          key: stagingKey,
          maxBytes: config.storage.maxUploadBytes,
        });
      } catch (error) {
        mapStorageError(error);
      }
      if (measured.byteSize !== input.size || measured.sha256Hex !== input.sha256 ||
        measured.mimeType !== asset.mimeType) {
        throw new ApplicationError('FILE_CONTENT_MISMATCH', 'Uploaded object does not match its declaration');
      }
      await lease.assertOwned();
      const finalObjectKey = buildFinalObjectKey(fileId, asset.purpose);
      let copied;
      try {
        copied = await storage.copyIfAbsent({
          byteSize: measured.byteSize,
          destinationKey: finalObjectKey,
          etag: measured.etag,
          mimeType: measured.mimeType,
          sha256Hex: measured.sha256Hex,
          sourceKey: stagingKey,
        });
      } catch (error) {
        mapStorageError(error);
      }
      if (copied.verified.byteSize !== input.size || copied.verified.sha256Hex !== input.sha256 ||
        copied.verified.mimeType !== asset.mimeType) {
        throw new ApplicationError('FILE_CONTENT_MISMATCH', 'Copied object does not match its declaration');
      }
      await lease.assertOwned();
      const response = await runSerializableTransaction(database.prisma, async (transaction) => {
        const result = await this.idempotency.claim(transaction, claim);
        if (result.kind === 'replay') return this.idempotency.fileUploadCompleteReplay(result.record);
        const completed = await this.assets.markReadyInTransaction(transaction, {
          actorId: request.principal.accountId,
          expectedByteSize: BigInt(input.size),
          expectedSha256: input.sha256,
          fileId,
          measuredByteSize: BigInt(copied.verified.byteSize),
          measuredMimeType: copied.verified.mimeType,
          measuredSha256: copied.verified.sha256Hex,
        });
        const envelope: CacheableFileUploadCompleteResponse = {
          code: 'OK',
          data: {
            completed_at: completed.completedAt.toISOString(),
            file_id: completed.asset.id,
            public_url: completed.asset.visibility === 'PUBLIC'
              ? storage.publicUrl(completed.asset.objectKey)
              : null,
            purpose: completed.asset.purpose,
            status: 'READY',
          },
          message: 'success',
          request_id: request.requestId,
        };
        const ipAddress = requestIp(request);
        await this.audit.append(transaction, {
          action: 'COMPLETE',
          actorAccountId: request.principal.accountId,
          actorRole: request.principal.role,
          idempotencyKey,
          ...(ipAddress === undefined ? {} : { ipAddress }),
          module: 'file',
          objectId: fileId,
          objectType: 'file',
          requestId: request.requestId,
          result: 'SUCCESS',
          resultCode: 'OK',
          summaryPolicy: 'NONE',
        });
        await this.idempotency.complete(transaction, claim, {
          policy: 'FILE_UPLOAD_COMPLETE',
          responseBody: envelope,
          responseStatus: 200,
          storage: 'CACHEABLE',
        });
        const stagingCleanupAt = new Date(
          asset.createdAt.getTime() +
          (config.storage.uploadTtlSeconds + config.storage.pendingCleanupAgeSeconds) * 1_000 +
          60_000,
        );
        const delayed = stagingCleanupAt.getTime() - Date.now() > 60_000;
        await this.outbox.append(transaction, {
          aggregateId: fileId,
          aggregateType: 'file',
          ...(delayed ? { availableAt: stagingCleanupAt } : {}),
          eventType: FILE_STAGING_CLEANUP_EVENT_TYPE,
          payload: {
            event_version: 1,
            resource_id: fileId,
            resource_type: 'file',
            resource_version: 1,
          },
        });
        return envelope;
      });
      try {
        await storage.deleteIfExists(stagingKey);
      } catch {
        this.logger.error({ error_code: 'FILE_STAGING_DELETE_FAILED', file_id: fileId, service: 'api' });
      }
      return preEnvelopedResponse(response);
    } finally {
      await lease.release();
    }
  }

  async downloadUrl(request: FilesRequestContext, fileId: string) {
    const { config, database, storage } = this.runtime();
    const asset = request.principal.role === 'SUPER_ADMIN'
      ? await this.assets.getAdminDownloadable({ actorId: request.principal.accountId, fileId })
      : await this.assets.getOwned({ actorId: request.principal.accountId, fileId });
    this.authorizePurpose(request, asset.purpose);
    if (asset.status !== 'READY') {
      throw new ApplicationError('STATE_CONFLICT', 'Only ready file assets can be downloaded');
    }
    if (asset.visibility !== 'PRIVATE') {
      throw new ApplicationError('STATE_CONFLICT', 'Public file assets use their stable public URL');
    }
    let signed;
    try {
      signed = await storage.presignGet(asset.objectKey, config.storage.privateDownloadTtlSeconds);
    } catch (error) {
      mapStorageError(error);
    }
    await runSerializableTransaction(database.prisma, async (transaction) => {
      const ipAddress = requestIp(request);
      await this.audit.append(transaction, {
        action: 'READ_SENSITIVE',
        actorAccountId: request.principal.accountId,
        actorRole: request.principal.role,
        ...(ipAddress === undefined ? {} : { ipAddress }),
        module: 'file',
        objectId: fileId,
        objectType: 'file',
        requestId: request.requestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'NONE',
      });
    });
    return {
      download_url: signed.url,
      expires_at: signed.expiresAt.toISOString(),
      file_id: fileId,
    };
  }

  private claim(
    actorId: string,
    idempotencyKey: string,
    route: string,
    body: unknown,
    pathParameters: Record<string, string> = {},
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters, route },
    };
  }

  private authorizePurpose(request: FilesRequestContext, purpose: string): void {
    if (request.principal.role === 'SUPER_ADMIN' ||
      (request.principal.role === 'CUSTOMER' && purpose === 'AFTERSALE_EVIDENCE')) return;
    throw new ApplicationError('PERMISSION_DENIED', 'File purpose is not available to this role');
  }

  private leaseManager(): FileObjectLeaseManager {
    if (!this.leases) throw new ApplicationError('INTERNAL_ERROR', 'File completion lease is unavailable');
    return this.leases;
  }

  private runtime(): {
    config: PlatformRuntimeConfig;
    database: DatabaseRuntime;
    storage: ObjectStoragePort;
  } {
    if (!this.config || !this.database || !this.storage || !this.assets || !this.audit || !this.idempotency ||
      !this.outbox) {
      throw new ApplicationError('INTERNAL_ERROR', 'File runtime is unavailable');
    }
    return { config: this.config, database: this.database, storage: this.storage };
  }
}
