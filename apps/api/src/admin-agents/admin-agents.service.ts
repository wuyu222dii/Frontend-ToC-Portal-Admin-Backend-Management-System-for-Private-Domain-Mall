import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAgentRepository,
  type AdminAgentDetail,
  type AdminAgentDisableImpact,
  type AdminAgentListItem,
  type AdminAgentPasswordResetImpact,
  type AdminAgentSnapshot,
  AuditRepository,
  type CacheableAgentResourceResponse,
  type CacheableCommandResponse,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import {
  ApplicationError,
  formatVersionEtag,
  generateUlid,
  hashPassword,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import {
  createAgentContactPhoneMaterial,
  createAgentInviteCodeMaterial,
  generateAgentInviteCode,
  generateAgentTemporaryPassword,
} from '../platform/security/agent-security';
import type {
  AdminAgentCreateInput,
  AdminAgentListInput,
  AdminAgentUpdateInput,
  AgentStatusActionInput,
  HighRiskConfirmationInput,
  ReasonActionInput,
} from './admin-agents.dto';
import { adminAgentRequestIp, type AdminAgentRequestContext } from './admin-agents.request';

const DISCLOSURE_HANDOFF_TTL_MS = 10 * 60 * 1_000;
const ROUTES = {
  create: '/admin/agents',
  disable: '/admin/agents/{agent_id}/status-changes',
  disablePreview: '/admin/agents/{agent_id}/status-change-preview',
  passwordReset: '/admin/agents/{agent_id}/password-resets',
  passwordResetPreview: '/admin/agents/{agent_id}/password-reset-preview',
  reactivate: '/admin/agents/{agent_id}/reactivate',
  update: '/admin/agents/{agent_id}',
} as const;

type AgentLifecycleEvent = 'created' | 'disabled' | 'password_reset' | 'reactivated' | 'updated';

@Injectable()
export class AdminAgentsService {
  private readonly agents!: AdminAgentRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.agents = new AdminAgentRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async list(input: AdminAgentListInput) {
    this.runtime();
    const result = await this.agents.listAgents(input);
    return {
      items: result.items.map((item) => this.listItemView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async detail(agentId: string) {
    this.runtime();
    return this.detailView(await this.agents.getAgentDetail(agentId));
  }

  async create(
    request: AdminAgentRequestContext,
    input: AdminAgentCreateInput,
    idempotencyKey: string,
  ) {
    const { config, database } = this.runtime();
    const accountId = generateUlid();
    const agentId = generateUlid();
    const inviteCodeId = generateUlid();
    const walletId = generateUlid();
    const temporaryPassword = generateAgentTemporaryPassword();
    const inviteCode = generateAgentInviteCode();
    const [passwordHash, contactPhone] = await Promise.all([
      hashPassword(temporaryPassword),
      Promise.resolve(input.contactPhone === null ? null : createAgentContactPhoneMaterial(
        agentId,
        input.contactPhone,
        config.encryption.fieldKeys.current,
      )),
    ]);
    const inviteCodeMaterial = createAgentInviteCodeMaterial(
      inviteCodeId,
      inviteCode,
      config.encryption.fieldKeys.current,
      config.authentication.secretHashKeys.current,
    );
    const requestBody = this.createRequestBody(input);
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.create, {}, requestBody);
    const result = await runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw new ApplicationError('INTERNAL_ERROR', 'Agent create replay is invalid');
        this.idempotency.assertHashOnlyReplay(claimed.record, this.createHashOnlyResult(resourceId));
        return { kind: 'replay' as const, agentId: resourceId };
      }
      const created = await this.agents.createAgentInTransaction(transaction, {
        accountId,
        agentId,
        agentNo: `AGT-${agentId}`,
        contactName: input.contactName,
        contactPhone,
        inviteCode: {
          ciphertext: inviteCodeMaterial.ciphertext,
          codeHash: inviteCodeMaterial.codeHash,
          encryptionKeyId: inviteCodeMaterial.encryptionKeyId,
          expiresAt: null,
          last4: inviteCodeMaterial.last4,
        },
        inviteCodeId,
        loginName: input.loginName,
        name: input.name,
        passwordHash,
        productAuthorizationMode: input.productAuthorizationMode,
        walletId,
      });
      await this.appendAudit(transaction, request, idempotencyKey, 'CREATE', created.agent, undefined);
      await this.appendOutbox(transaction, created.agent, 'created');
      await this.idempotency.complete(transaction, claim, this.createHashOnlyResult(created.agent.id));
      return { kind: 'created' as const, created };
    });

    if (result.kind === 'replay') {
      const current = await this.agents.getAgentDetail(result.agentId);
      return {
        agent: this.agentView(current.agent),
        disclosure_state: 'REPLAY_REDACTED' as const,
        expires_at: null,
        initial_invite_code: null,
        must_change_password: true as const,
        reissue_required: true as const,
        temporary_password: null,
      };
    }
    return {
      agent: this.agentView(result.created.agent),
      disclosure_state: 'FIRST_ISSUE' as const,
      expires_at: new Date(Date.now() + DISCLOSURE_HANDOFF_TTL_MS).toISOString(),
      initial_invite_code: {
        code: inviteCode,
        expires_at: result.created.initialInviteCode.expiresAt?.toISOString() ?? null,
        invite_code_id: result.created.initialInviteCode.id,
        status: 'ACTIVE' as const,
        version: result.created.initialInviteCode.version,
      },
      must_change_password: true as const,
      reissue_required: false as const,
      temporary_password: temporaryPassword,
    };
  }

  async update(
    request: AdminAgentRequestContext,
    agentId: string,
    input: AdminAgentUpdateInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { config, database } = this.runtime();
    const contactPhone = input.contactPhone === undefined
      ? undefined
      : input.contactPhone === null
        ? null
        : createAgentContactPhoneMaterial(agentId, input.contactPhone, config.encryption.fieldKeys.current);
    const requestBody = this.updateRequestBody(input);
    const claim = this.claim(request, idempotencyKey, 'PATCH', ROUTES.update, { agent_id: agentId }, {
      ...requestBody,
      expected_version: expectedVersion,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return preEnvelopedResponse(this.idempotency.agentResourceReplay(claimed.record));
      }
      const updated = await this.agents.updateAgentInTransaction(transaction, {
        agentId,
        expectedVersion,
        patch: {
          ...(input.contactName === undefined ? {} : { contactName: input.contactName }),
          ...(contactPhone === undefined ? {} : { contactPhone }),
          ...(input.name === undefined ? {} : { name: input.name }),
        },
      });
      const response = this.agentResponse(request.requestId, updated);
      await this.appendAudit(transaction, request, idempotencyKey, 'UPDATE', updated, expectedVersion);
      await this.appendOutbox(transaction, updated, 'updated');
      await this.idempotency.complete(transaction, claim, {
        policy: 'AGENT_RESOURCE_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  async previewDisable(
    request: AdminAgentRequestContext,
    agentId: string,
    input: AgentStatusActionInput,
    idempotencyKey: string,
  ) {
    const requestBody = this.disableRequestBody(input);
    return this.issuePreview(request, agentId, idempotencyKey, ROUTES.disablePreview, requestBody,
      'AGENT.DISABLE', async (transaction) => {
        const impact = await this.agents.getDisableImpactInTransaction(transaction, agentId);
        return { agent: impact.agent, view: this.disableImpactView(impact) };
      });
  }

  async disable(
    request: AdminAgentRequestContext,
    agentId: string,
    input: AgentStatusActionInput & HighRiskConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const requestBody = this.disableRequestBody(input);
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.disable, { agent_id: agentId }, {
      ...requestBody,
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.commandReplay(await this.idempotency.claim(transaction, claim), agentId);
      if (replay !== null) return preEnvelopedResponse(replay);
      await this.previews.consumeInTransaction(transaction, {
        action: 'AGENT.DISABLE',
        actorId: request.principal.accountId,
        confirmationHash: input.confirmationHash,
        previewToken: input.previewToken,
        request: requestBody,
        resourceVersion: expectedVersion,
        sessionId: request.accessSession.sessionId,
        targetId: agentId,
        targetType: 'AGENT',
      });
      const changed = await this.agents.disableAgentInTransaction(transaction, { agentId, expectedVersion });
      const response = this.commandResponse(request.requestId, changed.agent, changed.occurredAt);
      await this.appendAudit(transaction, request, idempotencyKey, 'DISABLE', changed.agent,
        expectedVersion, input.reason);
      await this.appendOutbox(transaction, changed.agent, 'disabled');
      await this.completeCommand(transaction, claim, response);
      return preEnvelopedResponse(response);
    });
  }

  async reactivate(
    request: AdminAgentRequestContext,
    agentId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.reactivate, { agent_id: agentId }, {
      expected_version: expectedVersion,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.commandReplay(await this.idempotency.claim(transaction, claim), agentId);
      if (replay !== null) return preEnvelopedResponse(replay);
      const changed = await this.agents.reactivateAgentInTransaction(transaction, { agentId, expectedVersion });
      const response = this.commandResponse(request.requestId, changed.agent, changed.occurredAt);
      await this.appendAudit(transaction, request, idempotencyKey, 'ENABLE', changed.agent, expectedVersion);
      await this.appendOutbox(transaction, changed.agent, 'reactivated');
      await this.completeCommand(transaction, claim, response);
      return preEnvelopedResponse(response);
    });
  }

  async previewPasswordReset(
    request: AdminAgentRequestContext,
    agentId: string,
    input: ReasonActionInput,
    idempotencyKey: string,
  ) {
    const requestBody = this.reasonRequestBody(input);
    return this.issuePreview(request, agentId, idempotencyKey, ROUTES.passwordResetPreview, requestBody,
      'AGENT.PASSWORD_RESET', async (transaction) => {
        const impact = await this.agents.getPasswordResetImpactInTransaction(transaction, agentId);
        return { agent: impact.agent, view: this.passwordResetImpactView(impact) };
      });
  }

  async resetPassword(
    request: AdminAgentRequestContext,
    agentId: string,
    input: ReasonActionInput & HighRiskConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const temporaryPassword = generateAgentTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const requestBody = this.reasonRequestBody(input);
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.passwordReset, { agent_id: agentId }, {
      ...requestBody,
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    const result = await runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        this.idempotency.assertHashOnlyReplay(claimed.record, this.resetHashOnlyResult(agentId));
        return { kind: 'replay' as const };
      }
      await this.previews.consumeInTransaction(transaction, {
        action: 'AGENT.PASSWORD_RESET',
        actorId: request.principal.accountId,
        confirmationHash: input.confirmationHash,
        previewToken: input.previewToken,
        request: requestBody,
        resourceVersion: expectedVersion,
        sessionId: request.accessSession.sessionId,
        targetId: agentId,
        targetType: 'AGENT',
      });
      const changed = await this.agents.resetAgentPasswordInTransaction(transaction, {
        agentId,
        expectedVersion,
        passwordHash,
      });
      await this.appendAudit(transaction, request, idempotencyKey, 'RESET', changed.agent,
        expectedVersion, input.reason);
      await this.appendOutbox(transaction, changed.agent, 'password_reset');
      await this.idempotency.complete(transaction, claim, this.resetHashOnlyResult(agentId));
      return { kind: 'reset' as const, agent: changed.agent };
    });
    const agent = result.kind === 'reset'
      ? result.agent
      : (await this.agents.getAgentDetail(agentId)).agent;
    if (result.kind === 'replay') {
      return {
        agent: this.agentView(agent),
        disclosure_state: 'REPLAY_REDACTED' as const,
        expires_at: null,
        must_change_password: true as const,
        reissue_required: true as const,
        temporary_password: null,
      };
    }
    return {
      agent: this.agentView(agent),
      disclosure_state: 'FIRST_ISSUE' as const,
      expires_at: new Date(Date.now() + DISCLOSURE_HANDOFF_TTL_MS).toISOString(),
      must_change_password: true as const,
      reissue_required: false as const,
      temporary_password: temporaryPassword,
    };
  }

  private async issuePreview(
    request: AdminAgentRequestContext,
    agentId: string,
    idempotencyKey: string,
    route: string,
    requestBody: unknown,
    action: 'AGENT.DISABLE' | 'AGENT.PASSWORD_RESET',
    impact: (transaction: DatabaseTransaction) => Promise<{
      agent: AdminAgentSnapshot;
      view: { affected_count: number; metrics: Array<{ key: string; label: string; before: string; after: string }>;
        warnings: string[] };
    }>,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(request, idempotencyKey, 'POST', route, { agent_id: agentId }, requestBody);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Agent preview must use a new idempotency key');
      }
      const calculated = await impact(transaction);
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.previews.issueInTransaction(transaction, {
        action,
        actorId: request.principal.accountId,
        previewToken,
        request: requestBody,
        resourceVersion: calculated.agent.version,
        sessionId: request.accessSession.sessionId,
        targetId: agentId,
        targetType: 'AGENT',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: calculated.view,
        preview_token: previewToken,
        resource_etag: formatVersionEtag(calculated.agent.version),
      };
      await this.idempotency.complete(transaction, claim, {
        resourceId: agentId,
        responseForHash: {
          confirmation_hash: response.confirmation_hash,
          expires_at: response.expires_at,
          impact: response.impact,
          resource_etag: response.resource_etag,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  private disableImpactView(impact: AdminAgentDisableImpact) {
    return {
      affected_count: 1 + impact.activeSessionCount + impact.activeInviteCount +
        impact.activeCandidateCount + impact.pendingPaymentOrderCount,
      metrics: [
        this.metric('active_sessions', '活跃会话', impact.activeSessionCount, 0),
        this.metric('available_invite_codes', '可用邀请码', impact.activeInviteCount, 0),
        this.metric('eligible_candidates', '可归因候选', impact.activeCandidateCount, 0),
        this.metric('pending_payment_orders', '待付款订单', impact.pendingPaymentOrderCount,
          impact.pendingPaymentOrderCount),
      ],
      warnings: [
        '邀请码记录与历史绑定保持不变，但停用期间不得建立新绑定。',
        '支付先提交则保留代理快照；停用先提交则后续支付安全降级为直营。',
      ],
    };
  }

  private passwordResetImpactView(impact: AdminAgentPasswordResetImpact) {
    return {
      affected_count: 1 + impact.activeSessionCount,
      metrics: [
        this.metric('active_sessions', '活跃会话', impact.activeSessionCount, 0),
        { after: 'true', before: 'false', key: 'must_change_password', label: '下次登录强制改密' },
      ],
      warnings: ['临时密码仅首次 no-store 响应披露，幂等重放不再返回明文。'],
    };
  }

  private metric(key: string, label: string, before: number, after: number) {
    return { after: String(after), before: String(before), key, label };
  }

  private agentView(agent: AdminAgentSnapshot) {
    return {
      agent_id: agent.id,
      agent_no: agent.agentNo,
      contact_name: agent.contactName,
      contact_phone_tail: agent.contactPhoneTail,
      name: agent.name,
      product_authorization_mode: agent.productAuthorizationMode,
      status: agent.status,
      version: agent.version,
    };
  }

  private listItemView(item: AdminAgentListItem) {
    return {
      account_alias: item.accountAlias,
      account_id: item.accountId,
      active_customer_count: item.activeCustomerCount,
      agent_id: item.id,
      agent_no: item.agentNo,
      available_balance: item.availableBalance,
      created_at: item.createdAt.toISOString(),
      login_name: item.loginName,
      name: item.name,
      net_sales_amount: item.netSalesAmount,
      product_authorization_mode: item.productAuthorizationMode,
      status: item.status,
      version: item.version,
    };
  }

  private detailView(detail: AdminAgentDetail) {
    return {
      agent: this.agentView(detail.agent),
      invite_code: detail.inviteCode === null ? null : {
        code_masked: detail.inviteCode.codeMasked,
        expires_at: detail.inviteCode.expiresAt?.toISOString() ?? null,
        invite_code_id: detail.inviteCode.id,
        status: detail.inviteCode.status,
        version: detail.inviteCode.version,
      },
      operating_summary: {
        active_customer_count: detail.operatingSummary.activeCustomerCount,
        net_sales_amount: detail.operatingSummary.netSalesAmount,
        new_binding_count: detail.operatingSummary.newBindingCount,
        paid_order_count: detail.operatingSummary.paidOrderCount,
      },
      wallet_summary: {
        available_balance: detail.walletSummary.availableBalance,
        expected_commission: detail.walletSummary.expectedCommission,
        frozen_balance: detail.walletSummary.frozenBalance,
        negative_balance: detail.walletSummary.negativeBalance,
        version: detail.walletSummary.version,
      },
      withdrawal_summary: {
        approved_count: detail.withdrawalSummary.approvedCount,
        latest_withdrawal_at: detail.withdrawalSummary.latestWithdrawalAt?.toISOString() ?? null,
        paid_count: detail.withdrawalSummary.paidCount,
        pending_count: detail.withdrawalSummary.pendingCount,
        total_paid_amount: detail.withdrawalSummary.totalPaidAmount,
      },
    };
  }

  private agentResponse(requestId: string, agent: AdminAgentSnapshot): CacheableAgentResourceResponse {
    return { code: 'OK', data: this.agentView(agent), message: 'success', request_id: requestId };
  }

  private commandResponse(
    requestId: string,
    agent: AdminAgentSnapshot,
    occurredAt: Date,
  ): CacheableCommandResponse {
    return {
      code: 'OK',
      data: {
        occurred_at: occurredAt.toISOString(),
        resource_id: agent.id,
        resource_type: 'agent',
        status: agent.status,
        version: agent.version,
      },
      message: 'success',
      request_id: requestId,
    };
  }

  private commandReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    agentId: string,
  ): CacheableCommandResponse | null {
    if (claimed.kind !== 'replay') return null;
    const response = this.idempotency.commandReplay(claimed.record);
    if (response.data.resource_type !== 'agent' || response.data.resource_id !== agentId) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent command replay target is invalid');
    }
    return response;
  }

  private completeCommand(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    response: CacheableCommandResponse,
  ) {
    return this.idempotency.complete(transaction, claim, {
      policy: 'COMMAND_RESPONSE',
      responseBody: response,
      responseStatus: 200,
      storage: 'CACHEABLE',
    });
  }

  private createHashOnlyResult(agentId: string) {
    return {
      resourceId: agentId,
      responseForHash: { agent_id: agentId, disclosure_state: 'FIRST_ISSUE' },
      responseStatus: 201,
      storage: 'HASH_ONLY' as const,
    };
  }

  private resetHashOnlyResult(agentId: string) {
    return {
      resourceId: agentId,
      responseForHash: { agent_id: agentId, disclosure_state: 'FIRST_ISSUE', operation: 'PASSWORD_RESET' },
      responseStatus: 200,
      storage: 'HASH_ONLY' as const,
    };
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    request: AdminAgentRequestContext,
    idempotencyKey: string,
    action: 'CREATE' | 'DISABLE' | 'ENABLE' | 'RESET' | 'UPDATE',
    agent: AdminAgentSnapshot,
    beforeVersion?: number,
    reason?: string,
  ) {
    const ipAddress = adminAgentRequestIp(request);
    return this.audit.append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: 'SUPER_ADMIN',
      after: { status: agent.status, version: agent.version },
      ...(beforeVersion === undefined ? {} : { before: { status: action === 'ENABLE' ? 'DISABLED' :
        action === 'DISABLE' ? 'ACTIVE' : agent.status, version: beforeVersion } }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'agent',
      objectId: agent.id,
      objectType: 'agent',
      ...(reason === undefined ? {} : { reason }),
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOutbox(
    transaction: DatabaseTransaction,
    agent: AdminAgentSnapshot,
    event: AgentLifecycleEvent,
  ) {
    return this.outbox.append(transaction, {
      aggregateId: agent.id,
      aggregateType: 'agent',
      eventType: `agent.${event}`,
      payload: {
        event_version: 1,
        resource_id: agent.id,
        resource_type: 'agent',
        resource_version: agent.version,
      },
    });
  }

  private claim(
    request: AdminAgentRequestContext,
    idempotencyKey: string,
    method: 'PATCH' | 'POST',
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

  private createRequestBody(input: AdminAgentCreateInput) {
    return {
      contact_name: input.contactName,
      contact_phone: input.contactPhone,
      login_name: input.loginName,
      name: input.name,
      product_authorization_mode: input.productAuthorizationMode,
    };
  }

  private updateRequestBody(input: AdminAgentUpdateInput) {
    return {
      ...(input.contactName === undefined ? {} : { contact_name: input.contactName }),
      ...(input.contactPhone === undefined ? {} : { contact_phone: input.contactPhone }),
      ...(input.name === undefined ? {} : { name: input.name }),
    };
  }

  private disableRequestBody(input: AgentStatusActionInput) {
    return { reason: input.reason, target_status: input.targetStatus };
  }

  private reasonRequestBody(input: ReasonActionInput) {
    return { reason: input.reason };
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database || !this.agents) {
      throw new ApplicationError('INTERNAL_ERROR', 'Admin Agent runtime is unavailable');
    }
    return { config: this.config, database: this.database };
  }
}
