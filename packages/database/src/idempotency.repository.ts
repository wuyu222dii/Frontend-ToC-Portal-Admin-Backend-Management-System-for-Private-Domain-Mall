import {
  ApplicationError,
  canonicalJson,
  generateUlid,
  hmacCanonicalJson,
  isValidUlid,
  sha256Hex,
} from '@qingxu/platform-core';
import { timingSafeEqual } from 'node:crypto';

import { Prisma } from '../.generated/prisma/client';
import type { IdempotencyRecordModel as IdempotencyRecord } from '../.generated/prisma/models/IdempotencyRecord';
import { acquireTransactionLock } from './advisory-lock';

export type DatabaseTransaction = Prisma.TransactionClient;

export interface IdempotencyHashKey {
  id: string;
  key: Uint8Array;
}

export interface IdempotencyHashKeyRing {
  current: IdempotencyHashKey;
  previous: readonly IdempotencyHashKey[];
}

export interface IdempotencyClaim {
  actorId: string;
  idempotencyKey: string;
  request: IdempotencyRequestDescriptor;
}

export interface IdempotencyRequestDescriptor {
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT';
  route: string;
  pathParameters: Record<string, string>;
  body: unknown;
}

export type IdempotencyClaimResult =
  | { kind: 'execute' }
  | { kind: 'replay'; record: IdempotencyRecord };

interface IdempotencyResultBase {
  responseStatus: number;
}

export type IdempotencyResult =
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'COMMAND_RESPONSE';
      responseBody: CacheableCommandResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'CACHEABLE';
      policy: 'FILE_UPLOAD_COMPLETE';
      responseBody: CacheableFileUploadCompleteResponse;
    })
  | (IdempotencyResultBase & {
      storage: 'HASH_ONLY';
      resourceId?: string;
      responseForHash: unknown;
    });

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
export interface CacheableCommandResponse {
  code: 'OK';
  message: 'success';
  data: {
    resource_type: string;
    resource_id: string;
    status: string;
    version: number;
    occurred_at: string;
  };
  request_id: string;
}

export type CacheableFilePurpose =
  | 'PRODUCT_IMAGE'
  | 'BRAND_LOGO'
  | 'CATEGORY_ICON'
  | 'BANNER'
  | 'AFTERSALE_EVIDENCE'
  | 'WITHDRAWAL_PROOF'
  | 'PROMOTION_QR';

export interface CacheableFileUploadCompleteResponse {
  code: 'OK';
  message: 'success';
  data: {
    file_id: string;
    purpose: CacheableFilePurpose;
    status: 'READY';
    public_url: string | null;
    completed_at: string;
  };
  request_id: string;
}

const COMMAND_RESPONSE_TOP_LEVEL_FIELDS = new Set(['code', 'data', 'message', 'request_id']);
const COMMAND_RESPONSE_DATA_FIELDS = new Set([
  'occurred_at',
  'resource_id',
  'resource_type',
  'status',
  'version',
]);
const FILE_UPLOAD_COMPLETE_TOP_LEVEL_FIELDS = new Set(['code', 'data', 'message', 'request_id']);
const FILE_UPLOAD_COMPLETE_DATA_FIELDS = new Set([
  'completed_at',
  'file_id',
  'public_url',
  'purpose',
  'status',
]);
const FILE_PURPOSE = new Set<CacheableFilePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
  'AFTERSALE_EVIDENCE',
  'WITHDRAWAL_PROOF',
  'PROMOTION_QR',
]);
const PUBLIC_FILE_PURPOSE = new Set<CacheableFilePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
]);
const COMMAND_RESPONSE_STATUS = new Set([
  'ACTIVE',
  'ANONYMIZED',
  'APPROVED',
  'ARCHIVED',
  'CANCELLED',
  'CLOSED',
  'COMPLETED',
  'DELETED',
  'DISABLED',
  'DRAFT',
  'EXPIRED',
  'FAILED',
  'INACTIVE',
  'PAID',
  'PENDING',
  'PROCESSED',
  'PUBLISHED',
  'READY',
  'RECEIVED',
  'REJECTED',
  'REVOKED',
  'ROTATED',
  'SUCCEEDED',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REQUEST_ID = /^(?:req|trace)_[0-9a-f]{32}$/;
const COMMAND_RESPONSE_RESOURCE_TYPE = new Set([
  'account',
  'agent',
  'aftersale',
  'banner',
  'binding',
  'brand',
  'business_rule',
  'cart',
  'category',
  'commission_rule',
  'customer',
  'file',
  'integration_fixture',
  'inventory',
  'order',
  'payment',
  'product',
  'promotion',
  'refund',
  'session',
  'shipment',
  'sku',
  'withdrawal',
]);
const MUTATION_METHOD = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);
const CLAIM_FIELDS = new Set(['actorId', 'idempotencyKey', 'request']);
const REQUEST_DESCRIPTOR_FIELDS = new Set(['body', 'method', 'pathParameters', 'route']);
const CACHEABLE_RESULT_FIELDS = new Set(['policy', 'responseBody', 'responseStatus', 'storage']);
const HASH_ONLY_RESULT_FIELDS = new Set(['resourceId', 'responseForHash', 'responseStatus', 'storage']);
const HASH_KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const MAX_PREVIOUS_HASH_KEYS = 3;

export function deriveIdempotencyScope(
  request: Pick<IdempotencyRequestDescriptor, 'method' | 'route'>,
): string {
  const digest = sha256Hex(canonicalJson({ method: request.method, route: request.route }));
  return `idempotency:v1:${digest}`;
}

function isExactPlainObject(value: unknown, fields: ReadonlySet<string>): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isCacheableCommandResponse(value: unknown): value is CacheableCommandResponse {
  if (!isExactPlainObject(value, COMMAND_RESPONSE_TOP_LEVEL_FIELDS)) return false;
  if (value.code !== 'OK' || value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  if (!isExactPlainObject(value.data, COMMAND_RESPONSE_DATA_FIELDS)) return false;
  return typeof value.data.resource_type === 'string' &&
    COMMAND_RESPONSE_RESOURCE_TYPE.has(value.data.resource_type) &&
    isValidUlid(value.data.resource_id) &&
    typeof value.data.status === 'string' && COMMAND_RESPONSE_STATUS.has(value.data.status) &&
    Number.isSafeInteger(value.data.version) && Number(value.data.version) >= 1 &&
    typeof value.data.occurred_at === 'string' && ISO_TIMESTAMP.test(value.data.occurred_at);
}

function isStablePublicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.username === '' && url.password === '' && url.search === '' && url.hash === '';
}

function isCacheableFileUploadCompleteResponse(
  value: unknown,
): value is CacheableFileUploadCompleteResponse {
  if (!isExactPlainObject(value, FILE_UPLOAD_COMPLETE_TOP_LEVEL_FIELDS)) return false;
  if (value.code !== 'OK' || value.message !== 'success' || !REQUEST_ID.test(String(value.request_id))) return false;
  if (!isExactPlainObject(value.data, FILE_UPLOAD_COMPLETE_DATA_FIELDS)) return false;
  if (!isValidUlid(value.data.file_id) || value.data.status !== 'READY' ||
    typeof value.data.purpose !== 'string' || !FILE_PURPOSE.has(value.data.purpose as CacheableFilePurpose) ||
    typeof value.data.completed_at !== 'string' || !ISO_TIMESTAMP.test(value.data.completed_at)) {
    return false;
  }
  const purpose = value.data.purpose as CacheableFilePurpose;
  return PUBLIC_FILE_PURPOSE.has(purpose)
    ? isStablePublicUrl(value.data.public_url)
    : value.data.public_url === null;
}

function cacheableResourceId(response: CacheableCommandResponse | CacheableFileUploadCompleteResponse): string {
  return isCacheableCommandResponse(response) ? response.data.resource_id : response.data.file_id;
}

function validateClaim(input: IdempotencyClaim): void {
  if (!isExactPlainObject(input, CLAIM_FIELDS)) {
    throw new TypeError('Idempotency claim contains unsupported fields');
  }
  if (!isValidUlid(input.actorId)) throw new TypeError('Idempotency actor ID must be a ULID');
  if (!UUID.test(input.idempotencyKey)) {
    throw new TypeError('Idempotency key must be a UUID');
  }
  if (!isExactPlainObject(input.request, REQUEST_DESCRIPTOR_FIELDS) ||
    !MUTATION_METHOD.has(input.request.method) ||
    !/^\/[^?#]{0,159}$/.test(input.request.route) ||
    typeof input.request.pathParameters !== 'object' || input.request.pathParameters === null ||
    Array.isArray(input.request.pathParameters) ||
    Object.values(input.request.pathParameters).some((value) => typeof value !== 'string')) {
    throw new TypeError('Idempotency request descriptor is invalid');
  }
}

function validateResult(result: IdempotencyResult): void {
  if (result.storage !== 'CACHEABLE' && result.storage !== 'HASH_ONLY') {
    throw new TypeError('Idempotency storage policy is invalid');
  }
  const fields = result.storage === 'CACHEABLE' ? CACHEABLE_RESULT_FIELDS : HASH_ONLY_RESULT_FIELDS;
  const expectedFields = new Set([...fields].filter((field) =>
    field !== 'resourceId' || (result.storage === 'HASH_ONLY' && result.resourceId !== undefined)));
  if (!isExactPlainObject(result, expectedFields)) {
    throw new TypeError('Idempotency result contains unsupported fields');
  }
  if (!Number.isInteger(result.responseStatus) || result.responseStatus < 100 || result.responseStatus > 599) {
    throw new TypeError('Idempotency response status is invalid');
  }
  if (result.storage === 'CACHEABLE' && (result.responseStatus < 200 || result.responseStatus > 299)) {
    throw new TypeError('CACHEABLE idempotency responses must use a successful HTTP status');
  }
  if (result.storage === 'CACHEABLE' && result.policy === 'FILE_UPLOAD_COMPLETE' &&
    result.responseStatus !== 200) {
    throw new TypeError('FILE_UPLOAD_COMPLETE responses must use HTTP status 200');
  }
  if (result.storage === 'CACHEABLE') {
    if (result.policy === 'COMMAND_RESPONSE') {
      if (!isCacheableCommandResponse(result.responseBody)) {
        throw new TypeError('Only a valid COMMAND_RESPONSE may use the COMMAND_RESPONSE cache policy');
      }
    } else if (result.policy === 'FILE_UPLOAD_COMPLETE') {
      if (!isCacheableFileUploadCompleteResponse(result.responseBody)) {
        throw new TypeError('Only a valid file completion response may use the FILE_UPLOAD_COMPLETE cache policy');
      }
    } else {
      throw new TypeError('CACHEABLE idempotency policy is not registered');
    }
  }
  if (result.storage === 'HASH_ONLY' && result.resourceId !== undefined && !isValidUlid(result.resourceId)) {
    throw new TypeError('Idempotency resource ID must be a ULID');
  }
}

export class IdempotencyRepository {
  private readonly currentHashKey: IdempotencyHashKey;
  private readonly activeHashKeys: readonly IdempotencyHashKey[];

  constructor(
    hashKeys: IdempotencyHashKeyRing,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!hashKeys || typeof hashKeys !== 'object' || !hashKeys.current || !Array.isArray(hashKeys.previous)) {
      throw new TypeError('Idempotency HMAC key ring is invalid');
    }
    if (hashKeys.previous.length > MAX_PREVIOUS_HASH_KEYS) {
      throw new TypeError(`Idempotency HMAC key ring supports at most ${MAX_PREVIOUS_HASH_KEYS} previous keys`);
    }
    const activeHashKeys = [hashKeys.current, ...hashKeys.previous].map(({ id, key }) => {
      if (!HASH_KEY_ID.test(id)) throw new TypeError('Idempotency HMAC key ID is invalid');
      if (!(key instanceof Uint8Array) || key.byteLength < 32) {
        throw new TypeError('Idempotency HMAC keys must contain at least 32 bytes');
      }
      return { id, key: Buffer.from(key) };
    });
    if (new Set(activeHashKeys.map(({ id }) => id)).size !== activeHashKeys.length) {
      throw new TypeError('Idempotency HMAC key IDs must be unique');
    }
    if (activeHashKeys.some((entry, index) =>
      activeHashKeys.some((candidate, candidateIndex) =>
        index !== candidateIndex && entry.key.equals(candidate.key)))) {
      throw new TypeError('Idempotency HMAC keys must be unique');
    }
    this.currentHashKey = activeHashKeys[0] as IdempotencyHashKey;
    this.activeHashKeys = activeHashKeys;
    const currentTime = this.now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
  }

  private requestHash(input: IdempotencyClaim, hashKey = this.currentHashKey): string {
    return hmacCanonicalJson(
      { key_id: hashKey.id, request: input.request },
      hashKey.key,
      'idempotency-request',
    );
  }

  private requestHashMatches(input: IdempotencyClaim, storedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;
    const stored = Buffer.from(storedHash, 'hex');
    let matched = false;
    for (const hashKey of this.activeHashKeys) {
      const candidate = Buffer.from(this.requestHash(input, hashKey), 'hex');
      matched = timingSafeEqual(stored, candidate) || matched;
    }
    return matched;
  }

  private responseHash(value: unknown, hashKey = this.currentHashKey): string {
    return hmacCanonicalJson(
      { key_id: hashKey.id, response: value },
      hashKey.key,
      'idempotency-response',
    );
  }

  private responseHashMatches(value: unknown, storedHash: string | null): boolean {
    if (!storedHash || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
    const stored = Buffer.from(storedHash, 'hex');
    let matched = false;
    for (const hashKey of this.activeHashKeys) {
      const candidate = Buffer.from(this.responseHash(value, hashKey), 'hex');
      matched = timingSafeEqual(stored, candidate) || matched;
    }
    return matched;
  }

  private assertReplayIntegrity(record: IdempotencyRecord): void {
    if (record.response_body === null) {
      if (!record.response_body_hash || !/^[a-f0-9]{64}$/.test(record.response_body_hash) ||
        (record.resource_id !== null && !isValidUlid(record.resource_id))) {
        throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record integrity check failed');
      }
      return;
    }
    const response = record.response_body;
    const commandResponse = isCacheableCommandResponse(response);
    const fileCompleteResponse = isCacheableFileUploadCompleteResponse(response);
    if (record.response_status < 200 || record.response_status > 299 ||
      (!commandResponse && !fileCompleteResponse) ||
      (fileCompleteResponse && record.response_status !== 200) ||
      record.resource_id !== cacheableResourceId(response) ||
      !this.responseHashMatches(record.response_body, record.response_body_hash)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record integrity check failed');
    }
  }

  fileUploadCompleteReplay(record: IdempotencyRecord): CacheableFileUploadCompleteResponse {
    this.assertReplayIntegrity(record);
    if (!isCacheableFileUploadCompleteResponse(record.response_body)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Idempotency record is not a file completion response');
    }
    return record.response_body;
  }

  async claim(transaction: DatabaseTransaction, input: IdempotencyClaim): Promise<IdempotencyClaimResult> {
    validateClaim(input);
    const scope = deriveIdempotencyScope(input.request);
    await acquireTransactionLock(transaction, 'idempotency', [input.actorId, scope, input.idempotencyKey]);
    const record = await transaction.idempotencyRecord.findUnique({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: input.actorId,
          scope,
          idempotency_key: input.idempotencyKey,
        },
      },
    });
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
    if (!record || record.expires_at.getTime() <= now.getTime()) return { kind: 'execute' };
    if (!this.requestHashMatches(input, record.request_hash)) {
      throw new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used for another request');
    }
    this.assertReplayIntegrity(record);
    return { kind: 'replay', record };
  }

  async complete(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    result: IdempotencyResult,
  ): Promise<IdempotencyRecord> {
    validateClaim(claim);
    const requestHash = this.requestHash(claim);
    validateResult(result);
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('Idempotency clock must return a valid Date');
    }
    const scope = deriveIdempotencyScope(claim.request);
    await acquireTransactionLock(transaction, 'idempotency', [claim.actorId, scope, claim.idempotencyKey]);
    const existing = await transaction.idempotencyRecord.findUnique({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: claim.actorId,
          scope,
          idempotency_key: claim.idempotencyKey,
        },
      },
    });
    if (existing && existing.expires_at.getTime() > now.getTime()) {
      if (!this.requestHashMatches(claim, existing.request_hash)) {
        throw new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used for another request');
      }
      this.assertReplayIntegrity(existing);
      return existing;
    }
    const responseBody = result.storage === 'CACHEABLE'
      ? result.responseBody as unknown as Prisma.InputJsonValue
      : undefined;
    const responseBodyHash = this.responseHash(
      result.storage === 'CACHEABLE' ? result.responseBody : result.responseForHash,
    );
    const data = {
      request_hash: requestHash,
      response_status: result.responseStatus,
      response_body: responseBody ?? Prisma.DbNull,
      response_body_hash: responseBodyHash,
      resource_id: result.storage === 'CACHEABLE'
        ? cacheableResourceId(result.responseBody)
        : result.resourceId ?? null,
      expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      created_at: now,
    };
    return transaction.idempotencyRecord.upsert({
      where: {
        actor_id_scope_idempotency_key: {
          actor_id: claim.actorId,
          scope,
          idempotency_key: claim.idempotencyKey,
        },
      },
      create: {
        id: generateUlid(now.getTime()),
        actor_id: claim.actorId,
        scope,
        idempotency_key: claim.idempotencyKey,
        ...data,
      },
      update: data,
    });
  }
}
