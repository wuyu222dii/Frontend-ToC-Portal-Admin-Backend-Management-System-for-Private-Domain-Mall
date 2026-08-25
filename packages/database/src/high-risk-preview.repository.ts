import { createHmac, timingSafeEqual } from 'node:crypto';

import { ApplicationError, canonicalJson, generateUlid, isValidUlid } from '@qingxu/platform-core';

import type { PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type {
  DatabaseTransaction,
  IdempotencyHashKey,
  IdempotencyHashKeyRing,
} from './idempotency.repository';

export const HIGH_RISK_PREVIEW_TTL_MS = 60_000;

export type HighRiskPreviewTargetType = 'BRAND' | 'CATEGORY' | 'INVENTORY' | 'PRODUCT' | 'SKU';
export type HighRiskPreviewAction =
  | 'BRAND.ACTIVATE'
  | 'BRAND.DEACTIVATE'
  | 'BRAND.SOFT_DELETE'
  | 'CATEGORY.ACTIVATE'
  | 'CATEGORY.DEACTIVATE'
  | 'CATEGORY.SOFT_DELETE'
  | 'INVENTORY.ADJUST'
  | 'PRODUCT.ACTIVATE'
  | 'PRODUCT.DEACTIVATE'
  | 'PRODUCT.SOFT_DELETE'
  | 'SKU.ACTIVATE'
  | 'SKU.DEACTIVATE'
  | 'SKU.SOFT_DELETE';

export interface IssueHighRiskPreviewInput {
  actorId: string;
  sessionId: string;
  action: HighRiskPreviewAction;
  targetType: HighRiskPreviewTargetType;
  targetId: string;
  resourceVersion: number;
  request: unknown;
  previewToken: string;
}

export interface ConsumeHighRiskPreviewInput extends IssueHighRiskPreviewInput {
  confirmationHash: string;
}

export interface HighRiskPreviewSnapshot {
  id: string;
  actorId: string;
  sessionId: string;
  action: string;
  targetType: string;
  targetId: string;
  resourceVersion: number;
  requestHash: string;
  confirmationHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

const ISSUE_FIELDS = new Set([
  'action',
  'actorId',
  'previewToken',
  'request',
  'resourceVersion',
  'sessionId',
  'targetId',
  'targetType',
]);
const CONSUME_FIELDS = new Set([...ISSUE_FIELDS, 'confirmationHash']);
const SHA256 = /^[a-f0-9]{64}$/;
const HASH_KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const MAX_PREVIOUS_HASH_KEYS = 3;
const PREVIEW_ACTION = new Set<HighRiskPreviewAction>([
  'BRAND.ACTIVATE',
  'BRAND.DEACTIVATE',
  'BRAND.SOFT_DELETE',
  'CATEGORY.ACTIVATE',
  'CATEGORY.DEACTIVATE',
  'CATEGORY.SOFT_DELETE',
  'INVENTORY.ADJUST',
  'PRODUCT.ACTIVATE',
  'PRODUCT.DEACTIVATE',
  'PRODUCT.SOFT_DELETE',
  'SKU.ACTIVATE',
  'SKU.DEACTIVATE',
  'SKU.SOFT_DELETE',
]);
const PREVIEW_TARGET_TYPE = new Set<HighRiskPreviewTargetType>([
  'BRAND',
  'CATEGORY',
  'INVENTORY',
  'PRODUCT',
  'SKU',
]);

function isExactPlainObject(value: unknown, fields: ReadonlySet<string>): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError('Preview resource version must be a positive PostgreSQL INTEGER');
  }
}

function validateIssueInput(input: IssueHighRiskPreviewInput): void {
  if (!isExactPlainObject(input, ISSUE_FIELDS)) {
    throw new TypeError('High-risk preview issue input contains unsupported or missing fields');
  }
  requireUlid(input.actorId, 'Preview actor ID');
  requireUlid(input.sessionId, 'Preview session ID');
  if (!PREVIEW_ACTION.has(input.action)) throw new TypeError('Preview action is not registered');
  if (!PREVIEW_TARGET_TYPE.has(input.targetType)) throw new TypeError('Preview target type is not registered');
  if (!input.action.startsWith(`${input.targetType}.`)) {
    throw new TypeError('Preview action and target type do not match');
  }
  requireUlid(input.targetId, 'Preview target ID');
  requireVersion(input.resourceVersion);
  if (typeof input.previewToken !== 'string' || input.previewToken.length < 16 || input.previewToken.length > 512) {
    throw new TypeError('Preview token must contain 16 to 512 characters');
  }
  canonicalJson(input.request);
}

function validateConsumeInput(input: ConsumeHighRiskPreviewInput): void {
  if (!isExactPlainObject(input, CONSUME_FIELDS)) {
    throw new TypeError('High-risk preview consume input contains unsupported or missing fields');
  }
  validateIssueInput({
    action: input.action,
    actorId: input.actorId,
    previewToken: input.previewToken,
    request: input.request,
    resourceVersion: input.resourceVersion,
    sessionId: input.sessionId,
    targetId: input.targetId,
    targetType: input.targetType,
  });
  if (!SHA256.test(input.confirmationHash)) {
    throw new TypeError('Preview confirmation hash must be a lowercase SHA-256 digest');
  }
}

function hmacText(value: string, key: Uint8Array, domain: string): string {
  return createHmac('sha256', key)
    .update(`qingxu:${domain}:v1\0`, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

function hmacJson(value: unknown, key: Uint8Array, domain: string): string {
  return hmacText(canonicalJson(value), key, domain);
}

function tokenHash(token: string, key: Uint8Array): string {
  return hmacText(token, key, 'high-risk-preview-token');
}

function requestHash(request: unknown, key: Uint8Array): string {
  return hmacJson(request, key, 'high-risk-preview-request');
}

function confirmationHash(
  input: IssueHighRiskPreviewInput,
  previewTokenHash: string,
  previewRequestHash: string,
  expiresAt: Date,
  key: Uint8Array,
): string {
  return hmacJson({
    action: input.action,
    actorId: input.actorId,
    expiresAt: expiresAt.toISOString(),
    previewTokenHash,
    requestHash: previewRequestHash,
    resourceVersion: input.resourceVersion,
    sessionId: input.sessionId,
    targetId: input.targetId,
    targetType: input.targetType,
  }, key, 'high-risk-preview-confirmation');
}

function safeHexEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function normalizeKeys(hashKeys: IdempotencyHashKeyRing): readonly IdempotencyHashKey[] {
  if (!hashKeys || typeof hashKeys !== 'object' || !hashKeys.current || !Array.isArray(hashKeys.previous)) {
    throw new TypeError('Preview HMAC key ring is invalid');
  }
  if (hashKeys.previous.length > MAX_PREVIOUS_HASH_KEYS) {
    throw new TypeError(`Preview HMAC key ring supports at most ${MAX_PREVIOUS_HASH_KEYS} previous keys`);
  }
  const keys = [hashKeys.current, ...hashKeys.previous].map(({ id, key }) => {
    if (!HASH_KEY_ID.test(id)) throw new TypeError('Preview HMAC key ID is invalid');
    if (!(key instanceof Uint8Array) || key.byteLength < 32) {
      throw new TypeError('Preview HMAC keys must contain at least 32 bytes');
    }
    return { id, key: Buffer.from(key) };
  });
  if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
    throw new TypeError('Preview HMAC key IDs must be unique');
  }
  if (keys.some((entry, index) => keys.some((other, otherIndex) =>
    index !== otherIndex && Buffer.from(entry.key).equals(Buffer.from(other.key))))) {
    throw new TypeError('Preview HMAC keys must be unique');
  }
  return keys;
}

function mismatch(): ApplicationError {
  return new ApplicationError('CONFIRMATION_MISMATCH', 'Confirmation does not match its preview');
}

function expired(): ApplicationError {
  return new ApplicationError('PREVIEW_EXPIRED', 'Preview token is expired or already consumed');
}

export class HighRiskPreviewRepository {
  private readonly hashKeys: readonly IdempotencyHashKey[];

  constructor(
    private readonly prisma: PrismaClient,
    hashKeys: IdempotencyHashKeyRing,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.hashKeys = normalizeKeys(hashKeys);
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('High-risk preview clock must return a valid Date');
    }
    return value;
  }

  async issueInTransaction(
    transaction: DatabaseTransaction,
    input: IssueHighRiskPreviewInput,
  ): Promise<HighRiskPreviewSnapshot> {
    validateIssueInput(input);
    const currentKey = this.hashKeys[0] as IdempotencyHashKey;
    const createdAt = this.currentTime();
    const expiresAt = new Date(createdAt.getTime() + HIGH_RISK_PREVIEW_TTL_MS);
    const previewTokenHash = tokenHash(input.previewToken, currentKey.key);
    const previewRequestHash = requestHash(input.request, currentKey.key);
    const previewConfirmationHash = confirmationHash(
      input,
      previewTokenHash,
      previewRequestHash,
      expiresAt,
      currentKey.key,
    );
    const record = await transaction.highRiskOperationPreview.create({
      data: {
        action: input.action,
        actor_account_id: input.actorId,
        confirmation_hash: previewConfirmationHash,
        consumed_at: null,
        created_at: createdAt,
        expires_at: expiresAt,
        id: generateUlid(createdAt.getTime()),
        preview_token_hash: previewTokenHash,
        request_hash: previewRequestHash,
        resource_version: input.resourceVersion,
        session_id: input.sessionId,
        target_id: input.targetId,
        target_type: input.targetType,
      },
    });
    return {
      id: record.id,
      actorId: record.actor_account_id,
      sessionId: record.session_id,
      action: record.action,
      targetType: record.target_type,
      targetId: record.target_id,
      resourceVersion: record.resource_version,
      requestHash: record.request_hash,
      confirmationHash: record.confirmation_hash,
      expiresAt: record.expires_at,
      consumedAt: record.consumed_at,
      createdAt: record.created_at,
    };
  }

  async consumeInTransaction(
    transaction: DatabaseTransaction,
    input: ConsumeHighRiskPreviewInput,
  ): Promise<void> {
    validateConsumeInput(input);
    let matched: {
      key: IdempotencyHashKey;
      tokenHash: string;
      record: Awaited<ReturnType<DatabaseTransaction['highRiskOperationPreview']['findUnique']>>;
    } | undefined;
    for (const key of this.hashKeys) {
      const candidate = tokenHash(input.previewToken, key.key);
      const record = await transaction.highRiskOperationPreview.findUnique({
        where: { preview_token_hash: candidate },
      });
      if (record) {
        matched = { key, record, tokenHash: candidate };
        break;
      }
    }
    if (!matched || !matched.record) throw mismatch();
    await acquireTransactionLock(transaction, 'high-risk-preview', [matched.record.id]);
    const record = await transaction.highRiskOperationPreview.findUnique({ where: { id: matched.record.id } });
    if (!record) throw mismatch();
    const identityMatches = safeHexEqual(record.preview_token_hash, matched.tokenHash) &&
      record.actor_account_id === input.actorId && record.session_id === input.sessionId &&
      record.action === input.action && record.target_type === input.targetType && record.target_id === input.targetId;
    if (!identityMatches) throw mismatch();
    const now = this.currentTime();
    if (record.consumed_at !== null || record.expires_at.getTime() <= now.getTime()) throw expired();
    if (record.resource_version !== input.resourceVersion) {
      throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Preview resource version changed');
    }
    const candidateRequestHash = requestHash(input.request, matched.key.key);
    const candidateConfirmationHash = confirmationHash(
      input,
      matched.tokenHash,
      candidateRequestHash,
      record.expires_at,
      matched.key.key,
    );
    if (!safeHexEqual(record.request_hash, candidateRequestHash) ||
      !safeHexEqual(record.confirmation_hash, candidateConfirmationHash) ||
      !safeHexEqual(record.confirmation_hash, input.confirmationHash)) {
      throw mismatch();
    }
    const result = await transaction.highRiskOperationPreview.updateMany({
      data: { consumed_at: now },
      where: { consumed_at: null, expires_at: { gt: now }, id: record.id },
    });
    if (result.count !== 1) throw expired();
  }
}
