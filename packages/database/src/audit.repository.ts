import { isIP } from 'node:net';

import {
  APPLICATION_ERROR_HTTP_STATUS,
  generateUlid,
  hashIpAddress,
  isValidUlid,
} from '@qingxu/platform-core';

import { Prisma } from '../.generated/prisma/client';
import type { AccountRole, AuditResult } from '../.generated/prisma/enums';
import type { AuditLogModel as AuditLog } from '../.generated/prisma/models/AuditLog';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AppendAuditLogInput {
  actorAccountId?: string;
  actorRole?: AccountRole;
  module: string;
  objectType: string;
  objectId: string;
  action: string;
  reasonCode?: string;
  before?: unknown;
  after?: unknown;
  summaryPolicy: 'NONE' | 'STATUS_VERSION';
  result: AuditResult;
  requestId: string;
  idempotencyKey?: string;
  resultCode?: string;
  ipAddress?: string;
}

const AUDIT_STATUS = new Set([
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
const AUDIT_MODULE = new Set([
  'access',
  'account',
  'admin_auth',
  'agent',
  'aftersale',
  'attribution',
  'auth',
  'b1_test',
  'banner',
  'cart',
  'catalog',
  'commission',
  'config',
  'customer',
  'file',
  'fulfillment',
  'inventory',
  'order',
  'payment',
  'privacy',
  'promotion',
  'refund',
  'reporting',
  'system',
  'withdrawal',
]);
const AUDIT_OBJECT_TYPE = new Set([
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
const AUDIT_ACTION = new Set([
  'ADJUST',
  'ANONYMIZE',
  'APPROVE',
  'ARCHIVE',
  'CANCEL',
  'COMPLETE',
  'CONFIRM',
  'CREATE',
  'DELETE',
  'DISABLE',
  'ENABLE',
  'ENROLL',
  'LOGIN',
  'LOGOUT',
  'MERGE',
  'PAY',
  'PUBLISH',
  'READ_SENSITIVE',
  'RECOVER',
  'REFRESH',
  'REFUND',
  'REJECT',
  'RESET',
  'RESTORE',
  'RETRY',
  'REVOKE',
  'ROTATE',
  'TRANSFER',
  'UPDATE',
  'VERIFY',
]);
const AUDIT_REASON_CODE = new Set([
  'B1.ROLLBACK_TEST',
  'CATALOG.BRAND_ACTIVATE',
  'CATALOG.BRAND_DEACTIVATE',
  'CATALOG.BRAND_RESTORE',
  'CATALOG.BRAND_SOFT_DELETE',
  'CATALOG.CATEGORY_ACTIVATE',
  'CATALOG.CATEGORY_DEACTIVATE',
  'CATALOG.CATEGORY_RESTORE',
  'CATALOG.CATEGORY_SOFT_DELETE',
  'CATALOG.STATUS_CORRECTION',
]);
const AUDIT_RESULT_CODE = new Set(['OK', ...Object.keys(APPLICATION_ERROR_HTTP_STATUS)]);

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  return value as Record<string, unknown>;
}

function auditJson(
  value: unknown,
  policy: AppendAuditLogInput['summaryPolicy'],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined) return Prisma.DbNull;
  const record = plainRecord(value);
  if (!record) throw new TypeError('Audit summaries must be plain objects');
  const keys = Object.keys(record);
  if (policy === 'NONE') {
    if (keys.length > 0) throw new TypeError('NONE audit summaries must not contain fields');
    return Prisma.DbNull;
  }
  if (keys.some((key) => key !== 'status' && key !== 'version')) {
    throw new TypeError('STATUS_VERSION audit summaries accept only status and version');
  }
  const output: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'status') {
      if (typeof nested !== 'string' || !AUDIT_STATUS.has(nested)) {
        throw new TypeError('Audit status summary must use an approved status');
      }
      output[key] = nested;
    } else if (key === 'version') {
      if (!Number.isSafeInteger(nested) || Number(nested) < 1) {
        throw new TypeError('Audit version summary must be a positive integer');
      }
      output[key] = nested as number;
    }
  }
  return output;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^(?:req|trace)_[0-9a-f]{32}$/;
const AUDIT_ROLE = new Set<AccountRole>(['AGENT_ADMIN', 'CUSTOMER', 'SUPER_ADMIN']);
const AUDIT_RESULT = new Set<AuditResult>(['FAILURE', 'SUCCESS']);
const AUDIT_INPUT_FIELDS = new Set([
  'action',
  'actorAccountId',
  'actorRole',
  'after',
  'before',
  'idempotencyKey',
  'ipAddress',
  'module',
  'objectId',
  'objectType',
  'reasonCode',
  'requestId',
  'result',
  'resultCode',
  'summaryPolicy',
]);

function assertStructuredMetadata(input: AppendAuditLogInput): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((key) => !AUDIT_INPUT_FIELDS.has(key))) {
    throw new TypeError('Audit input contains unsupported fields');
  }
  if (input.actorAccountId !== undefined && !isValidUlid(input.actorAccountId)) {
    throw new TypeError('Audit actor account ID must be a ULID');
  }
  if ((input.actorAccountId === undefined) !== (input.actorRole === undefined)) {
    throw new TypeError('Audit actor account ID and role must be provided together');
  }
  if (input.actorRole !== undefined && !AUDIT_ROLE.has(input.actorRole)) {
    throw new TypeError('Audit actor role is invalid');
  }
  if (!AUDIT_MODULE.has(input.module)) {
    throw new TypeError('Audit module is not registered');
  }
  if (!AUDIT_OBJECT_TYPE.has(input.objectType)) {
    throw new TypeError('Audit object type is not registered');
  }
  if (!(isValidUlid(input.objectId) || UUID.test(input.objectId))) {
    throw new TypeError('Audit object ID must be a ULID or UUID');
  }
  if (!AUDIT_ACTION.has(input.action)) throw new TypeError('Audit action is not registered');
  if (input.reasonCode !== undefined && !AUDIT_REASON_CODE.has(input.reasonCode)) {
    throw new TypeError('Audit reason code is not registered');
  }
  if (!AUDIT_RESULT.has(input.result)) throw new TypeError('Audit result is invalid');
  if (!REQUEST_ID.test(input.requestId)) {
    throw new TypeError('Audit request ID must use the approved safe format');
  }
  if (input.idempotencyKey !== undefined && !UUID.test(input.idempotencyKey)) {
    throw new TypeError('Audit idempotency key must be a UUID');
  }
  if (input.resultCode !== undefined && !AUDIT_RESULT_CODE.has(input.resultCode)) {
    throw new TypeError('Audit result code is not registered');
  }
  if (input.ipAddress !== undefined && isIP(input.ipAddress) === 0) {
    throw new TypeError('Audit IP address must be an IPv4 or IPv6 literal');
  }
  if (input.summaryPolicy !== 'NONE' && input.summaryPolicy !== 'STATUS_VERSION') {
    throw new TypeError('Audit summary policy is invalid');
  }
}

export class AuditRepository {
  constructor(
    private readonly ipHashKey: Uint8Array,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (ipHashKey.byteLength < 32) throw new TypeError('Audit IP HMAC key must contain at least 32 bytes');
    this.currentTime();
  }

  private currentTime(): Date {
    const currentTime = this.now();
    if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
      throw new TypeError('Audit clock must return a valid Date');
    }
    return currentTime;
  }

  async append(transaction: DatabaseTransaction, input: AppendAuditLogInput): Promise<AuditLog> {
    assertStructuredMetadata(input);
    const occurredAt = this.currentTime();
    return transaction.auditLog.create({
      data: {
        id: generateUlid(occurredAt.getTime()),
        actor_account_id: input.actorAccountId ?? null,
        actor_role: input.actorRole ?? null,
        module: input.module,
        object_type: input.objectType,
        object_id: input.objectId,
        action: input.action,
        reason: input.reasonCode ?? null,
        before_json: auditJson(input.before, input.summaryPolicy),
        after_json: auditJson(input.after, input.summaryPolicy),
        result: input.result,
        request_id: input.requestId,
        idempotency_key: input.idempotencyKey ?? null,
        result_code: input.resultCode ?? null,
        ip_hash: input.ipAddress === undefined ? null : hashIpAddress(input.ipAddress, this.ipHashKey),
        occurred_at: occurredAt,
      },
    });
  }
}
