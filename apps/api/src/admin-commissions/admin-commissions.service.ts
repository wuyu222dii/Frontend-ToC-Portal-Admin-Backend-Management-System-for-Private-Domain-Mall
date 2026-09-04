import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type AdminAgentCommissionItem,
  type AdminAgentWalletLedgerItem,
  AuditRepository,
  type CommissionExplanationItem,
  type CommissionRuleImpact,
  type CommissionRulePublishPreviewSnapshot,
  type CommissionRuleSkuSnapshot,
  type CommissionRuleVersionSnapshot,
  CommissionRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';

import {
  catalogRequestIp,
  type AdminCatalogRequestContext,
} from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type {
  AdminCommissionListQuery,
  AdminWalletLedgerListQuery,
  CommissionRuleActionInput,
  CommissionRuleConfirmationInput,
  CommissionSkuListQuery,
  CommissionVersionListQuery,
} from './admin-commissions.dto';

const COMMISSION_RULE_SINGLETON_ID = '00000000000000000000000000';
const ROUTES = {
  preview: '/admin/commission-rule-versions/preview',
  publish: '/admin/commission-rule-versions',
} as const;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function actionRequest(input: CommissionRuleActionInput) {
  return {
    base_version_id: input.baseVersionId,
    changes: input.changes.map((change) => ({
      configured_rate: change.configuredRate,
      target_id: change.targetId,
      target_type: change.targetType,
    })),
    reason: input.reason,
  };
}

function impactView(impact: CommissionRuleImpact) {
  return {
    affected_count: impact.affectedSkuCount,
    metrics: [
      {
        after: String(impact.changedTargetCount),
        before: null,
        key: 'changed_target_count',
        label: 'Changed targets',
      },
      {
        after: String(impact.affectedSkuCount),
        before: null,
        key: 'affected_sku_count',
        label: 'Affected SKUs',
      },
      ...impact.changedTargets.map((target) => ({
        after: target.configuredRate,
        before: target.beforeConfiguredRate,
        key: `target:${target.targetType}:${target.targetId ?? 'PLATFORM'}:configured_rate`,
        label: target.targetType === 'PLATFORM'
          ? 'Platform configured rate'
          : `${target.targetType} ${target.targetId} configured rate`,
      })),
      ...impact.affectedSkus.map((sku) => ({
        after: sku.effectiveRate,
        before: sku.beforeEffectiveRate,
        key: `sku:${sku.skuId}:effective_rate`,
        label: `${sku.productName} / ${sku.skuCode}`,
      })),
    ],
    warnings: impact.warnings,
  };
}

function previewRequest(
  input: CommissionRuleActionInput,
  snapshot: CommissionRulePublishPreviewSnapshot,
) {
  return {
    ...actionRequest(input),
    current_published_id: snapshot.currentPublishedId,
    impact: impactView(snapshot.impact),
    max_version_no: snapshot.maxVersionNo,
  };
}

function ruleEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 0 || version > 2_147_483_647) {
    throw internal('Commission rule version is invalid');
  }
  return `"${version}"`;
}

function skuView(item: CommissionRuleSkuSnapshot) {
  return {
    category_id: item.categoryId,
    configured_rate: item.configuredRate,
    effective_rate: item.effectiveRate,
    product_name: item.productName,
    sku_code: item.skuCode,
    sku_id: item.skuId,
    source: item.source,
  };
}

function versionView(version: CommissionRuleVersionSnapshot) {
  return {
    base_version_id: version.baseVersionId,
    changes: version.changes.map((change) => ({
      configured_rate: change.configuredRate,
      target_id: change.targetId,
      target_type: change.targetType,
    })),
    created_at: version.createdAt.toISOString(),
    created_by_account_id: version.createdById,
    effective_at: version.effectiveAt?.toISOString() ?? null,
    reason: version.reason,
    status: version.status,
    version_id: version.versionId,
    version_no: version.versionNo,
  };
}

function explanationItemView(item: CommissionExplanationItem) {
  return {
    category_id: item.categoryId,
    category_name: item.categoryName,
    commission_base: item.commissionBase,
    commission_snapshot_id: item.commissionSnapshotId,
    effective_rate: item.effectiveRate,
    expected_remaining: item.expectedRemaining,
    hit_path: item.hitPath,
    ledger: item.ledger.map((ledger) => ({
      available_change: ledger.availableChange,
      expected_change: ledger.expectedChange,
      frozen_change: ledger.frozenChange,
      ledger_id: ledger.ledgerId,
      ledger_type: ledger.ledgerType,
      occurred_at: ledger.occurredAt.toISOString(),
      reason: ledger.reason,
      refund_id: ledger.refundId,
    })),
    order_item_id: item.orderItemId,
    original_commission: item.originalCommission,
    position_state: item.positionState,
    product_id: item.productId,
    product_name: item.productName,
    reversal_total: item.reversalTotal,
    rounding_mode: item.roundingMode,
    rounding_scale: item.roundingScale,
    rule_source: item.ruleSource,
    rule_version_id: item.ruleVersionId,
    rule_version_no: item.ruleVersionNo,
    sku_id: item.skuId,
    sku_name: item.skuName,
  };
}

@Injectable()
export class AdminCommissionsService {
  private readonly audit!: AuditRepository;
  private readonly commissions!: CommissionRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.commissions = new CommissionRepository(database.prisma);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async getCurrentRules() {
    const current = await this.repositories().commissions.getCurrentRules();
    return {
      categories: current.categories.map((category) => ({
        category_id: category.categoryId,
        category_name: category.categoryName,
        configured_rate: category.configuredRate,
        effective_rate: category.effectiveRate,
        source: category.source,
      })),
      items: current.items.map(skuView),
      platform_rate: current.platformRate,
      version: current.version,
      version_id: current.versionId,
      version_no: current.versionNo,
    };
  }

  async listRuleSkus(input: CommissionSkuListQuery) {
    const result = await this.repositories().commissions.listRuleSkus(input);
    return {
      items: result.items.map(skuView),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
      version_id: result.versionId,
      version_no: result.versionNo,
    };
  }

  async listRuleVersions(input: CommissionVersionListQuery) {
    const result = await this.repositories().commissions.listRuleVersions(input);
    return {
      items: result.items.map(versionView),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getRuleVersion(versionId: string) {
    return versionView(await this.repositories().commissions.getRuleVersion(versionId));
  }

  async listAgentCommissions(agentId: string, input: AdminCommissionListQuery) {
    const result = await this.repositories().commissions.listAdminAgentCommissions({ agentId, ...input });
    return {
      items: result.items.map((item) => this.agentCommissionView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async listAgentWalletLedger(agentId: string, input: AdminWalletLedgerListQuery) {
    const result = await this.repositories().commissions.listAdminAgentWalletLedger({ agentId, ...input });
    return {
      items: result.items.map((item) => this.walletLedgerView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getOrderExplanation(orderId: string) {
    const explanation = await this.repositories().commissions.getOrderExplanation(orderId);
    return {
      items: explanation.items.map(explanationItemView),
      order_id: explanation.orderId,
      order_no: explanation.orderNo,
    };
  }

  previewRulePublish(
    request: AdminCatalogRequestContext,
    input: CommissionRuleActionInput,
    idempotencyKey: string,
  ) {
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.preview, {}, actionRequest(input));
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Commission rule preview must use a new idempotency key');
      }
      const snapshot = await this.repositories().commissions.previewRulePublishInTransaction(transaction, input);
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'COMMISSION_RULE.PUBLISH',
        actorId: request.principal.accountId,
        previewToken,
        request: previewRequest(input, snapshot),
        resourceVersion: snapshot.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: COMMISSION_RULE_SINGLETON_ID,
        targetType: 'COMMISSION_RULE',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: impactView(snapshot.impact),
        preview_token: previewToken,
        resource_etag: ruleEtag(snapshot.resourceVersion),
      };
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: COMMISSION_RULE_SINGLETON_ID,
        responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  publishRuleVersion(
    request: AdminCatalogRequestContext,
    input: CommissionRuleConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.publish, {}, {
      ...actionRequest(input),
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Commission rule replay resource is missing');
        const version = await this.repositories().commissions.getRuleVersionForReplayInTransaction(
          transaction,
          request.principal.accountId,
          resourceId,
        );
        this.repositories().idempotency.assertHashOnlyReplay(
          claimed.record,
          this.publishHashOnlyResult(resourceId),
        );
        return versionView(version);
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: ROUTES.preview,
      });
      const expectedFacts = await this.repositories().commissions.previewRulePublishInTransaction(
        transaction,
        {
          baseVersionId: input.baseVersionId,
          changes: input.changes,
          reason: input.reason,
        },
      );
      const result = await this.repositories().commissions.publishRuleVersionInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        baseVersionId: input.baseVersionId,
        changes: input.changes,
        expectedCurrentPublishedId: expectedFacts.currentPublishedId,
        expectedMaxVersionNo: expectedFacts.maxVersionNo,
        expectedVersion,
        reason: input.reason,
      }, {
        verifyPreview: (snapshot) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'COMMISSION_RULE.PUBLISH',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: previewRequest(input, snapshot),
          resourceVersion: snapshot.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: COMMISSION_RULE_SINGLETON_ID,
          targetType: 'COMMISSION_RULE',
        }),
      });
      await this.appendPublishAudit(transaction, request, idempotencyKey, result, input.reason);
      await this.repositories().outbox.append(transaction, {
        aggregateId: result.version.versionId,
        aggregateType: 'commission_rule',
        eventType: 'commission_rule.published',
        payload: {
          event_version: 1,
          resource_id: result.version.versionId,
          resource_type: 'commission_rule',
          resource_version: result.version.versionNo,
        },
      });
      await this.repositories().idempotency.complete(
        transaction,
        claim,
        this.publishHashOnlyResult(result.version.versionId),
      );
      return versionView(result.version);
    });
  }

  private repositories() {
    if (!this.audit || !this.commissions || !this.idempotency || !this.outbox || !this.previews) {
      throw internal('Admin commission repositories are unavailable');
    }
    return {
      audit: this.audit,
      commissions: this.commissions,
      idempotency: this.idempotency,
      outbox: this.outbox,
      previews: this.previews,
    };
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) throw internal('Admin commission runtime is unavailable');
    return { config: this.config, database: this.database };
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    method: 'POST',
    route: string,
    pathParameters: Record<string, string>,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: { body, method, pathParameters, route },
    };
  }

  private publishHashOnlyResult(versionId: string) {
    return {
      resourceId: versionId,
      responseForHash: { commission_rule_published: { version_id: versionId } },
      responseStatus: 200,
      storage: 'HASH_ONLY' as const,
    };
  }

  private agentCommissionView(item: AdminAgentCommissionItem) {
    return {
      agent_id: item.agentId,
      available_change: item.availableChange,
      category_id: item.categoryId,
      category_name: item.categoryName,
      commission_base: item.commissionBase,
      commission_snapshot_id: item.commissionSnapshotId,
      effective_rate: item.effectiveRate,
      expected_change: item.expectedChange,
      expected_remaining: item.expectedRemaining,
      ledger_id: item.ledgerId,
      ledger_type: item.ledgerType,
      occurred_at: item.occurredAt.toISOString(),
      order_id: item.orderId,
      order_item_id: item.orderItemId,
      order_no: item.orderNo,
      original_commission: item.originalCommission,
      position_state: item.positionState,
      product_id: item.productId,
      product_name: item.productName,
      refund_id: item.refundId,
      reversal_total: item.reversalTotal,
      rule_source: item.ruleSource,
      rule_version_id: item.ruleVersionId,
      rule_version_no: item.ruleVersionNo,
      sku_id: item.skuId,
      sku_name: item.skuName,
    };
  }

  private walletLedgerView(item: AdminAgentWalletLedgerItem) {
    return {
      agent_id: item.agentId,
      available_balance_after: item.availableBalanceAfter,
      available_change: item.availableChange,
      expected_balance_after: item.expectedBalanceAfter,
      expected_change: item.expectedChange,
      frozen_balance_after: item.frozenBalanceAfter,
      frozen_change: item.frozenChange,
      ledger_type: item.ledgerType,
      occurred_at: item.occurredAt.toISOString(),
      reference_id: item.referenceId,
      reference_type: item.referenceType,
      refund_id: item.refundId,
      wallet_ledger_id: item.walletLedgerId,
    };
  }

  private appendPublishAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    result: {
      after: { status: 'PUBLISHED'; version: number };
      before: { status: 'PUBLISHED'; version: number } | null;
      version: CommissionRuleVersionSnapshot;
    },
    reason: string,
  ) {
    const ipAddress = catalogRequestIp(request);
    return this.repositories().audit.append(transaction, {
      action: 'PUBLISH',
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: { status: result.after.status, version: result.after.version },
      ...(result.before === null ? {} : {
        before: { status: result.before.status, version: result.before.version },
      }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'commission',
      objectId: result.version.versionId,
      objectType: 'commission_rule',
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }
}
