import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  BusinessRuleRepository,
  type BusinessRulePublishResult,
  type BusinessRulePublishPreviewSnapshot,
  type BusinessRuleVersionSnapshot,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, formatVersionEtag } from '@qingxu/platform-core';

import { catalogRequestIp, type AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { AdminBusinessRuleAction, AdminBusinessRuleConfirmation } from './admin-settings.dto';

const BUSINESS_RULE_SINGLETON_ID = '00000000000000000000000000';
const ROUTES = {
  preview: '/admin/settings/business-rules/preview',
  publish: '/admin/settings/business-rules',
} as const;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function actionRequest(input: AdminBusinessRuleAction) {
  return {
    changes: {
      ...(input.changes.aftersaleWindowDays === undefined
        ? {}
        : { aftersale_window_days: input.changes.aftersaleWindowDays }),
      ...(input.changes.minimumWithdrawalAmount === undefined
        ? {}
        : { minimum_withdrawal_amount: input.changes.minimumWithdrawalAmount }),
    },
    reason: input.reason,
  };
}

function previewRequest(input: AdminBusinessRuleAction, snapshot: BusinessRulePublishPreviewSnapshot) {
  return {
    ...actionRequest(input),
    current_published_id: snapshot.currentPublishedId,
    max_version_no: snapshot.maxVersionNo,
  };
}

function ruleView(rule: BusinessRuleVersionSnapshot) {
  return {
    aftersale_window_days: rule.aftersaleWindowDays,
    effective_at: rule.effectiveAt.toISOString(),
    legal_record_retention_years: rule.legalRecordRetentionYears,
    minimum_withdrawal_amount: rule.minimumWithdrawalAmount,
    order_payment_timeout_minutes: rule.orderPaymentTimeoutMinutes,
    version: rule.version,
    version_id: rule.versionId,
    version_no: rule.versionNo,
  };
}

function impactView(snapshot: BusinessRulePublishPreviewSnapshot) {
  const metrics = snapshot.changedFields.map((field) => field === 'minimum_withdrawal_amount'
    ? {
        after: snapshot.next.minimumWithdrawalAmount,
        before: snapshot.current.minimumWithdrawalAmount,
        key: field,
        label: 'Minimum withdrawal amount',
      }
    : {
        after: String(snapshot.next.aftersaleWindowDays),
        before: String(snapshot.current.aftersaleWindowDays),
        key: field,
        label: 'Aftersale window days',
      });
  return {
    affected_count: metrics.length,
    metrics,
    warnings: ['The new version applies only to future facts; historical orders and withdrawals remain unchanged'],
  };
}

@Injectable()
export class AdminSettingsService {
  private readonly audit!: AuditRepository;
  private readonly businessRules!: BusinessRuleRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.businessRules = new BusinessRuleRepository(database.prisma);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async getBusinessRules() {
    return ruleView(await this.repositories().businessRules.readCurrent());
  }

  previewBusinessRules(
    request: AdminCatalogRequestContext,
    input: AdminBusinessRuleAction,
    idempotencyKey: string,
  ) {
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.preview, actionRequest(input));
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Business rule preview must use a new idempotency key');
      }
      const snapshot = await this.repositories().businessRules.previewPublishInTransaction(
        transaction,
        input.changes,
      );
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'BUSINESS_RULE.PUBLISH',
        actorId: request.principal.accountId,
        previewToken,
        request: previewRequest(input, snapshot),
        resourceVersion: snapshot.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: BUSINESS_RULE_SINGLETON_ID,
        targetType: 'BUSINESS_RULE',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: impactView(snapshot),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(snapshot.resourceVersion),
      };
      await this.repositories().idempotency.complete(transaction, claim, {
        responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  publishBusinessRules(
    request: AdminCatalogRequestContext,
    input: AdminBusinessRuleConfirmation,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(request, idempotencyKey, 'PATCH', ROUTES.publish, {
      ...actionRequest(input),
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Business rule replay resource is missing');
        const rule = await this.repositories().businessRules.getForReplayInTransaction(
          transaction,
          request.principal.accountId,
          resourceId,
        );
        this.repositories().idempotency.assertHashOnlyReplay(
          claimed.record,
          this.publishResult(resourceId),
        );
        return ruleView(rule);
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: ROUTES.preview,
      });
      const expected = await this.repositories().businessRules.previewPublishInTransaction(
        transaction,
        input.changes,
      );
      const result = await this.repositories().businessRules.publishInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        changes: input.changes,
        expectedCurrentPublishedId: expected.currentPublishedId,
        expectedMaxVersionNo: expected.maxVersionNo,
        expectedVersion,
        reason: input.reason,
      }, {
        verifyPreview: (snapshot) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'BUSINESS_RULE.PUBLISH',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: previewRequest(input, snapshot),
          resourceVersion: snapshot.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: BUSINESS_RULE_SINGLETON_ID,
          targetType: 'BUSINESS_RULE',
        }),
      });
      await this.appendAudit(transaction, request, idempotencyKey, result, input.reason);
      await this.repositories().outbox.append(transaction, {
        aggregateId: result.rule.versionId,
        aggregateType: 'business_rule',
        eventType: 'business_rule.published',
        payload: {
          event_version: 1,
          resource_id: result.rule.versionId,
          resource_type: 'business_rule',
          resource_version: result.rule.version,
        },
      });
      await this.repositories().idempotency.complete(
        transaction,
        claim,
        this.publishResult(result.rule.versionId),
      );
      return ruleView(result.rule);
    });
  }

  private repositories() {
    if (!this.audit || !this.businessRules || !this.idempotency || !this.outbox || !this.previews) {
      throw internal('Admin settings repositories are unavailable');
    }
    return {
      audit: this.audit,
      businessRules: this.businessRules,
      idempotency: this.idempotency,
      outbox: this.outbox,
      previews: this.previews,
    };
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) throw internal('Admin settings runtime is unavailable');
    return { config: this.config, database: this.database };
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    method: 'PATCH' | 'POST',
    route: string,
    body: unknown,
  ): IdempotencyClaim {
    return { actorId: request.principal.accountId, idempotencyKey, request: { body, method, pathParameters: {}, route } };
  }

  private publishResult(versionId: string) {
    return {
      resourceId: versionId,
      responseForHash: { business_rule_published: { version_id: versionId } },
      responseStatus: 200,
      storage: 'HASH_ONLY' as const,
    };
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    result: BusinessRulePublishResult,
    reason: string,
  ) {
    const ipAddress = catalogRequestIp(request);
    return this.repositories().audit.append(transaction, {
      action: 'PUBLISH',
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: result.audit.after,
      before: result.audit.before,
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'config',
      objectId: result.rule.versionId,
      objectType: 'business_rule',
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'BUSINESS_RULE_CHANGE',
    });
  }
}
