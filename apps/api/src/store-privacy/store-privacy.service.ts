import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  IdempotencyRepository,
  OutboxRepository,
  runSerializableTransaction,
  StorePrivacyRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyClaim,
} from '@qingxu/database';
import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import { randomBytes } from 'node:crypto';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type {
  StoreDeletionConfirmInput,
  StoreDeletionPreviewInput,
} from './store-privacy.dto';

const ROUTES = {
  confirm: '/store/privacy/deletion-requests',
  preview: '/store/privacy/deletion-requests/preview',
} as const;

const DELETION_IMPACTS = [
  'REVOKE_ALL_SESSIONS',
  'END_SERVICE_AGENT_BINDING',
  'INVALIDATE_ATTRIBUTION_CANDIDATES',
  'ANONYMIZE_ACCOUNT_PROFILE',
  'DELETE_NON_TRANSACTIONAL_PII',
  'ANONYMIZE_AGENT_HISTORY',
  'RETAIN_REQUIRED_TRANSACTION_FACTS',
] as const;

function sensitiveReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'A sensitive Store privacy response cannot be replayed');
}

@Injectable()
export class StorePrivacyService {
  private readonly config: PlatformRuntimeConfig;
  private readonly database: DatabaseRuntime;
  private readonly privacy: StorePrivacyRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRepository;
  private readonly outbox: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
  ) {
    this.config = config as PlatformRuntimeConfig;
    this.database = database as DatabaseRuntime;
    this.privacy = database && config
      ? new StorePrivacyRepository(database.prisma, config.encryption.idempotencyHashKeys)
      : undefined as never;
    this.audit = config ? new AuditRepository(config.encryption.ipHashKey) : undefined as never;
    this.idempotency = config
      ? new IdempotencyRepository(config.encryption.idempotencyHashKeys)
      : undefined as never;
    this.outbox = database ? new OutboxRepository(database) : undefined as never;
  }

  async previewDeletion(
    session: CurrentStoreSession,
    input: StoreDeletionPreviewInput,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, ROUTES.preview, input);
    const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const result = await this.privacyRepository().previewDeletionInTransaction(transaction, {
        accountId: session.accountId,
        customerId: session.customerId,
        previewToken,
        request: { acknowledged: true },
        sessionId: session.sessionId,
      });
      const response = result.preview === null
        ? {
            account_version: result.accountVersion,
            blockers: result.blockers.map(({ count, resourceType }) => ({ count, resource_type: resourceType })),
            confirmation_hash: null,
            eligible: false as const,
            expires_at: null,
            impacts: [...DELETION_IMPACTS],
            preview_token: null,
          }
        : {
            account_version: result.accountVersion,
            blockers: [],
            confirmation_hash: result.preview.confirmationHash,
            eligible: true as const,
            expires_at: result.preview.expiresAt.toISOString(),
            impacts: [...DELETION_IMPACTS],
            preview_token: previewToken,
          };
      await this.appendPreviewAudit(transaction, session, result.accountVersion, requestId, key, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: session.accountId,
        responseForHash: {
          account_version: result.accountVersion,
          blockers: response.blockers,
          eligible: response.eligible,
          impacts: response.impacts,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  async confirmDeletion(
    session: CurrentStoreSession,
    input: StoreDeletionConfirmInput,
    expectedVersion: number,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, ROUTES.confirm, {
      acknowledged: true,
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    const deletionRequestId = generateUlid();
    const bindingChangeLogId = generateUlid();
    const anonymousAlias = `deleted_${generateUlid().toLowerCase()}`;
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const completed = await this.privacyRepository().confirmDeletionInTransaction(transaction, {
        accountId: session.accountId,
        anonymousAlias,
        bindingChangeLogId,
        confirmationHash: input.confirmationHash,
        customerId: session.customerId,
        deletionRequestId,
        expectedAccountVersion: expectedVersion,
        previewToken: input.previewToken,
        request: { acknowledged: true },
        sessionId: session.sessionId,
      });
      await this.appendConfirmAudit(transaction, session, expectedVersion, completed.accountVersion,
        requestId, key, ipAddress);
      await this.outbox.append(transaction, {
        aggregateId: session.accountId,
        aggregateType: 'account',
        eventType: 'account.anonymized',
        payload: {
          event_version: 1,
          resource_id: session.accountId,
          resource_type: 'account',
          resource_version: completed.accountVersion,
        },
      });
      const response = {
        completed_at: completed.completedAt.toISOString(),
        request_id: completed.requestId,
        status: completed.status,
        submitted_at: completed.submittedAt.toISOString(),
      };
      await this.idempotency.complete(transaction, claim, {
        resourceId: completed.requestId,
        responseForHash: {
          account_version: completed.accountVersion,
          request_id: completed.requestId,
          status: completed.status,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  private claim(actorId: string, idempotencyKey: string, route: string, body: unknown): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters: {}, route },
    };
  }

  private appendPreviewAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    version: number,
    requestId: string,
    idempotencyKey: string,
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action: 'READ_SENSITIVE',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { version },
      before: { version },
      idempotencyKey,
      module: 'privacy',
      objectId: session.accountId,
      objectType: 'account',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private appendConfirmAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    beforeVersion: number,
    afterVersion: number,
    requestId: string,
    idempotencyKey: string,
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action: 'ANONYMIZE',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { status: 'ANONYMIZED', version: afterVersion },
      before: { status: 'ACTIVE', version: beforeVersion },
      idempotencyKey,
      module: 'privacy',
      objectId: session.accountId,
      objectType: 'account',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.config || !this.database) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store privacy runtime is unavailable');
    }
    return this.database;
  }

  private privacyRepository(): StorePrivacyRepository {
    if (!this.privacy) throw new ApplicationError('INTERNAL_ERROR', 'Store privacy repository is unavailable');
    return this.privacy;
  }
}
