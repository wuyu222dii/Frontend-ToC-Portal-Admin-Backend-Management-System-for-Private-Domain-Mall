import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type {
  DatabaseTransaction,
  IdempotencyHashKeyRing,
} from './idempotency.repository';
import {
  ACCOUNT_ANONYMIZE_PREVIEW_TTL_MS,
  HighRiskPreviewRepository,
} from './high-risk-preview.repository';

export const STORE_DELETION_PREVIEW_TTL_MS = ACCOUNT_ANONYMIZE_PREVIEW_TTL_MS;

export type StoreAccountDeletionBlockerType =
  | 'ORDER'
  | 'AFTERSALE'
  | 'PAYMENT'
  | 'REFUND'
  | 'FINANCIAL_ANOMALY';

export interface StoreAccountDeletionBlocker {
  resourceType: StoreAccountDeletionBlockerType;
  count: number;
}

export interface StorePrivacyIdentity {
  accountId: string;
  customerId: string;
}

export interface StorePrivacySessionIdentity extends StorePrivacyIdentity {
  sessionId: string;
}

export interface StoreDeletionPreviewRequest {
  acknowledged: true;
}

export interface PreviewStoreDeletionInput extends StorePrivacySessionIdentity {
  previewToken: string;
  request: StoreDeletionPreviewRequest;
}

export interface ConfirmStoreDeletionInput extends PreviewStoreDeletionInput {
  anonymousAlias: string;
  bindingChangeLogId: string;
  confirmationHash: string;
  deletionRequestId: string;
  expectedAccountVersion: number;
}

export interface StoreDeletionEligibilitySnapshot {
  accountVersion: number;
  blockers: StoreAccountDeletionBlocker[];
}

export interface StoreDeletionPreviewCapability {
  confirmationHash: string;
  expiresAt: Date;
  id: string;
}

export interface StoreDeletionPreviewSnapshot extends StoreDeletionEligibilitySnapshot {
  preview: StoreDeletionPreviewCapability | null;
}

export interface CompletedStoreDeletionSnapshot {
  accountVersion: number;
  completedAt: Date;
  requestId: string;
  status: 'COMPLETED';
  submittedAt: Date;
}

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_POSTGRES_INCREMENTABLE_INTEGER = 2_147_483_646;
const BLOCKER_ORDER: readonly StoreAccountDeletionBlockerType[] = [
  'ORDER',
  'AFTERSALE',
  'PAYMENT',
  'REFUND',
  'FINANCIAL_ANOMALY',
];

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 ||
    Number(value) > MAX_POSTGRES_INCREMENTABLE_INTEGER) {
    throw new TypeError('Expected account version is invalid');
  }
}

function requirePreviewToken(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Array.from(value).length < 32 || Array.from(value).length > 512) {
    throw new TypeError('Deletion preview token must contain between 32 and 512 characters');
  }
}

function requireConfirmationHash(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError('Deletion confirmation hash must be a lowercase SHA-256 digest');
  }
}

function requireAnonymousAlias(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim() !== value ||
    Array.from(value).length < 1 || Array.from(value).length > 80 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })) {
    throw new TypeError('Deletion anonymous alias is invalid');
  }
}

function validateIdentity(input: StorePrivacyIdentity): void {
  requirePlainObject(input, 'Store privacy identity');
  requireExactKeys(input, ['accountId', 'customerId'], ['accountId', 'customerId'], 'Store privacy identity');
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
}

function validateRequest(value: unknown): asserts value is StoreDeletionPreviewRequest {
  requirePlainObject(value, 'Deletion preview request');
  requireExactKeys(value, ['acknowledged'], ['acknowledged'], 'Deletion preview request');
  if (value.acknowledged !== true) throw new TypeError('Deletion preview must be acknowledged');
}

function validatePreviewInput(input: PreviewStoreDeletionInput): void {
  requirePlainObject(input, 'Deletion preview input');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'previewToken', 'request', 'sessionId'],
    ['accountId', 'customerId', 'previewToken', 'request', 'sessionId'],
    'Deletion preview input',
  );
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  requireUlid(input.sessionId, 'Session ID');
  requirePreviewToken(input.previewToken);
  validateRequest(input.request);
}

function validateConfirmInput(input: ConfirmStoreDeletionInput): void {
  requirePlainObject(input, 'Deletion confirm input');
  requireExactKeys(
    input,
    [
      'accountId',
      'anonymousAlias',
      'bindingChangeLogId',
      'confirmationHash',
      'customerId',
      'deletionRequestId',
      'expectedAccountVersion',
      'previewToken',
      'request',
      'sessionId',
    ],
    [
      'accountId',
      'anonymousAlias',
      'bindingChangeLogId',
      'confirmationHash',
      'customerId',
      'deletionRequestId',
      'expectedAccountVersion',
      'previewToken',
      'request',
      'sessionId',
    ],
    'Deletion confirm input',
  );
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  requireUlid(input.sessionId, 'Session ID');
  requireUlid(input.deletionRequestId, 'Deletion request ID');
  requireUlid(input.bindingChangeLogId, 'Binding change log ID');
  if (input.deletionRequestId === input.bindingChangeLogId) {
    throw new TypeError('Deletion request and binding change log IDs must differ');
  }
  requireVersion(input.expectedAccountVersion);
  requirePreviewToken(input.previewToken);
  requireConfirmationHash(input.confirmationHash);
  requireAnonymousAlias(input.anonymousAlias);
  validateRequest(input.request);
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer account is required');
}

function deletionBlocked(): ApplicationError {
  return new ApplicationError('ACCOUNT_DELETION_BLOCKED', 'Account deletion is blocked by unsettled activity');
}

export class StorePrivacyRepository {
  private readonly previews: HighRiskPreviewRepository;

  constructor(
    private readonly prisma: PrismaClient,
    hashKeys: IdempotencyHashKeyRing,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.previews = new HighRiskPreviewRepository(prisma, hashKeys, now);
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Store privacy clock must return a valid Date');
    }
    return value;
  }

  private async lockAndReadCustomer(
    transaction: DatabaseTransaction,
    identity: StorePrivacyIdentity,
    sessionId?: string,
  ) {
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [identity.customerId]);
    const now = this.currentTime();
    const account = await transaction.account.findUnique({
      where: { id: identity.accountId },
      select: {
        deleted_at: true,
        id: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        version: true,
        wechat_open_id: true,
        customer_profile: {
          select: { account_id: true, anonymized_at: true, id: true, version: true },
        },
      },
    });
    const customer = account?.customer_profile;
    if (!account || account.role !== 'CUSTOMER' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.login_name !== null || account.password_hash !== null ||
      account.wechat_open_id === null || !customer || customer.id !== identity.customerId ||
      customer.account_id !== identity.accountId || customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
    if (sessionId !== undefined) {
      await acquireTransactionLock(transaction, 'store-auth-account-sessions', [identity.accountId]);
      const session = await transaction.authSession.findUnique({
        where: { id: sessionId },
        select: { account_id: true, assurance: true, expires_at: true, revoked_at: true },
      });
      if (!session || session.account_id !== identity.accountId || session.assurance !== 'WECHAT' ||
        session.revoked_at !== null || session.expires_at.getTime() <= now.getTime()) {
        throw authenticationRequired();
      }
    }
    return { account, customer };
  }

  private async readBlockers(
    transaction: DatabaseTransaction,
    customerId: string,
  ): Promise<StoreAccountDeletionBlocker[]> {
    const [orders, aftersales, payments, refunds, manualFinancialAnomalies, orderFinancialAnomalies] =
      await Promise.all([
        transaction.salesOrder.count({
          where: {
            customer_id: customerId,
            order_status: { in: ['PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING'] },
          },
        }),
        transaction.aftersale.count({
          where: {
            customer_id: customerId,
            status: {
              in: [
                'PENDING_REVIEW',
                'REFUNDING',
                'WAITING_RETURN',
                'WAITING_RECEIPT',
                'RETURN_EXCEPTION',
                'REFUNDING_AFTER_RETURN',
                'REFUND_FAILED',
              ],
            },
          },
        }),
        transaction.paymentIntent.count({
          where: {
            order: { customer_id: customerId },
            status: { in: ['CREATING', 'OPEN', 'CLOSE_PENDING'] },
          },
        }),
        transaction.refund.count({
          where: {
            order: { customer_id: customerId },
            status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
          },
        }),
        transaction.manualCompensation.count({
          where: {
            customer_id: customerId,
            status: { in: ['PENDING', 'PROCESSING', 'FAILED'] },
          },
        }),
        transaction.salesOrder.count({
          where: {
            customer_id: customerId,
            OR: [
              { payment_resolution: 'MANUAL_REQUIRED' },
              { payment_resolution: 'LATE_SUCCESS_REFUND_PENDING' },
              {
                payment_status: 'PROCESSING',
                payment_intents: {
                  none: { status: { in: ['CREATING', 'OPEN', 'CLOSE_PENDING'] } },
                },
              },
              {
                refund_processing_status: { in: ['REFUNDING', 'FAILED'] },
                refunds: { none: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } } },
              },
            ],
          },
        }),
      ]);
    const counts: Record<StoreAccountDeletionBlockerType, number> = {
      AFTERSALE: aftersales,
      FINANCIAL_ANOMALY: manualFinancialAnomalies + orderFinancialAnomalies,
      ORDER: orders,
      PAYMENT: payments,
      REFUND: refunds,
    };
    return BLOCKER_ORDER.flatMap((resourceType) => counts[resourceType] > 0
      ? [{ count: counts[resourceType], resourceType }]
      : []);
  }

  async getDeletionEligibilityInTransaction(
    transaction: DatabaseTransaction,
    identity: StorePrivacyIdentity,
  ): Promise<StoreDeletionEligibilitySnapshot> {
    validateIdentity(identity);
    const { account } = await this.lockAndReadCustomer(transaction, identity);
    return {
      accountVersion: account.version,
      blockers: await this.readBlockers(transaction, identity.customerId),
    };
  }

  async previewDeletionInTransaction(
    transaction: DatabaseTransaction,
    input: PreviewStoreDeletionInput,
  ): Promise<StoreDeletionPreviewSnapshot> {
    validatePreviewInput(input);
    const { account } = await this.lockAndReadCustomer(transaction, input, input.sessionId);
    const blockers = await this.readBlockers(transaction, input.customerId);
    if (blockers.length > 0) return { accountVersion: account.version, blockers, preview: null };

    const record = await this.previews.issueInTransaction(transaction, {
      action: 'ACCOUNT.ANONYMIZE',
      actorId: input.accountId,
      previewToken: input.previewToken,
      request: input.request,
      resourceVersion: account.version,
      sessionId: input.sessionId,
      targetId: input.accountId,
      targetType: 'ACCOUNT',
    });
    return {
      accountVersion: account.version,
      blockers,
      preview: {
        confirmationHash: record.confirmationHash,
        expiresAt: new Date(record.expiresAt),
        id: record.id,
      },
    };
  }

  async confirmDeletionInTransaction(
    transaction: DatabaseTransaction,
    input: ConfirmStoreDeletionInput,
  ): Promise<CompletedStoreDeletionSnapshot> {
    validateConfirmInput(input);
    const now = this.currentTime();
    const capability = {
      action: 'ACCOUNT.ANONYMIZE' as const,
      actorId: input.accountId,
      confirmationHash: input.confirmationHash,
      previewToken: input.previewToken,
      request: input.request,
      resourceVersion: input.expectedAccountVersion,
      sessionId: input.sessionId,
      targetId: input.accountId,
      targetType: 'ACCOUNT' as const,
    };
    // The caller runs this command in one serializable transaction. Any later
    // version, blocker, or mutation failure rolls this consumption back.
    await this.previews.consumeInTransaction(transaction, capability);
    const { account, customer } = await this.lockAndReadCustomer(transaction, input, input.sessionId);
    if (account.version !== input.expectedAccountVersion) {
      throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Account version changed');
    }
    const blockers = await this.readBlockers(transaction, input.customerId);
    if (blockers.length > 0) throw deletionBlocked();
    await acquireTransactionLock(transaction, 'store-attribution-binding', [input.customerId]);
    const currentBindings = await transaction.customerAgentBinding.findMany({
      where: { customer_id: input.customerId, ended_at: null },
      orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      take: 2,
      select: { agent_id: true, id: true },
    });
    if (currentBindings.length > 1) {
      throw new ApplicationError('INTERNAL_ERROR', 'Customer has multiple current service-agent bindings');
    }
    const currentBinding = currentBindings[0];

    await transaction.accountDeletionRequest.create({
      data: {
        account_id: input.accountId,
        block_summary: [],
        completed_at: null,
        created_at: now,
        id: input.deletionRequestId,
        processing_at: null,
        rejection_reason: null,
        status: 'SUBMITTED',
        submitted_at: now,
        updated_at: now,
      },
    });
    await transaction.accountDeletionRequest.update({
      where: { id: input.deletionRequestId },
      data: { processing_at: now, status: 'PROCESSING', updated_at: now },
    });

    await transaction.$executeRaw`
      UPDATE "auth_session"
      SET "revoked_at" = COALESCE("revoked_at", ${now}),
          "refresh_token_hash" = NULL,
          "restriction" = 'CHANGE_PASSWORD_ONLY',
          "assurance" = 'PASSWORD',
          "mfa_factor_id" = NULL,
          "mfa_verified_at" = NULL
      WHERE "account_id" = ${input.accountId}
    `;
    await transaction.customerPhoneVerification.deleteMany({ where: { customer_id: input.customerId } });
    await transaction.customerAddress.deleteMany({ where: { customer_id: input.customerId } });
    await transaction.favorite.deleteMany({ where: { customer_id: input.customerId } });
    await transaction.cartItem.deleteMany({ where: { cart: { customer_id: input.customerId } } });
    await transaction.attributionCandidate.updateMany({
      where: { customer_id: input.customerId, status: 'ACTIVE' },
      data: {
        candidate_token_hash: null,
        invalid_reason: 'ACCOUNT_DELETED',
        status: 'INVALIDATED',
        updated_at: now,
      },
    });
    if (currentBinding) {
      await transaction.customerAgentBinding.update({
        where: { id: currentBinding.id },
        data: { ended_at: now, end_reason: 'ACCOUNT_DELETED' },
      });
      await transaction.bindingChangeLog.create({
        data: {
          actor_account_id: input.accountId,
          created_at: now,
          customer_id: input.customerId,
          id: input.bindingChangeLogId,
          new_agent_id: null,
          new_binding_id: null,
          old_agent_id: currentBinding.agent_id,
          old_binding_id: currentBinding.id,
          reason: 'ACCOUNT_DELETED',
        },
      });
    }
    await transaction.agentCustomerPrivacyProjection.updateMany({
      where: { customer_id: input.customerId },
      data: {
        anonymized_at: now,
        city: null,
        customer_alias: input.anonymousAlias,
        nickname_masked: null,
        phone_tail: null,
        updated_at: now,
      },
    });
    await transaction.customerProfile.update({
      where: { id: customer.id },
      data: {
        anonymized_at: now,
        avatar_url: null,
        city: null,
        nickname: null,
        updated_at: now,
        version: { increment: 1 },
      },
    });
    const updatedAccount = await transaction.account.update({
      where: { id: account.id },
      data: {
        deleted_at: now,
        login_name: null,
        must_change_password: false,
        password_hash: null,
        status: 'ANONYMIZED',
        updated_at: now,
        version: { increment: 1 },
        wechat_open_id: null,
        wechat_union_id: null,
      },
      select: { version: true },
    });
    const completed = await transaction.accountDeletionRequest.update({
      where: { id: input.deletionRequestId },
      data: { completed_at: now, status: 'COMPLETED', updated_at: now },
      select: { completed_at: true, id: true, status: true, submitted_at: true },
    });
    if (completed.status !== 'COMPLETED' || completed.completed_at === null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Account deletion did not reach the completed state');
    }
    return {
      accountVersion: updatedAccount.version,
      completedAt: new Date(completed.completed_at),
      requestId: completed.id,
      status: 'COMPLETED',
      submittedAt: new Date(completed.submitted_at),
    };
  }
}
