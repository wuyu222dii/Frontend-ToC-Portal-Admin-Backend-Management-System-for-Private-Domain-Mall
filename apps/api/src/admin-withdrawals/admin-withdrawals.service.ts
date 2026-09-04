import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAuthRepository,
  type AdminWithdrawalAction,
  type AdminWithdrawalActionImpact,
  type AdminWithdrawalMutationResult,
  AdminWithdrawalRepository,
  type AdminWithdrawalSnapshot,
  type AdminWithdrawalPreviewHooks,
  AuditRepository,
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
  hmacAuthenticationSecret,
} from '@qingxu/platform-core';

import {
  adminCustomerRequestIp,
  type AdminCustomerRequestContext,
} from '../admin-customers/admin-customers.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import {
  decryptAgentBankAccountNumber,
  maskAgentBankAccountHolder,
} from '../platform/security/bank-account-security';
import type {
  AdminWithdrawalListInput,
  WithdrawalConfirmationInput,
  WithdrawalMarkPaidConfirmationInput,
  WithdrawalMarkPaidInput,
  WithdrawalPayoutRevealInput,
  WithdrawalProofsInput,
  WithdrawalRejectConfirmationInput,
  WithdrawalRejectInput,
} from './admin-withdrawals.dto';

const ROUTES = {
  approve: '/admin/withdrawals/{withdrawal_id}/approve',
  approvePreview: '/admin/withdrawals/{withdrawal_id}/approve-preview',
  markPaid: '/admin/withdrawals/{withdrawal_id}/mark-paid',
  markPaidPreview: '/admin/withdrawals/{withdrawal_id}/mark-paid-preview',
  proofs: '/admin/withdrawals/{withdrawal_id}/proofs',
  reject: '/admin/withdrawals/{withdrawal_id}/reject',
  rejectPreview: '/admin/withdrawals/{withdrawal_id}/reject-preview',
  reveal: '/admin/withdrawals/{withdrawal_id}/payout-account-reveal',
} as const;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function canonicalFileIds(fileIds: readonly string[]): string[] {
  return [...fileIds].sort();
}

function payoutSnapshotView(withdrawal: AdminWithdrawalSnapshot) {
  return {
    account_holder_masked: maskAgentBankAccountHolder(withdrawal.payoutAccountSnapshot.accountHolder),
    account_no_last4: withdrawal.payoutAccountSnapshot.last4,
    account_number_masked: `**** ${withdrawal.payoutAccountSnapshot.last4}`,
    bank_name: withdrawal.payoutAccountSnapshot.bankName,
    snapshot_at: withdrawal.payoutAccountSnapshot.snapshotAt.toISOString(),
  };
}

function withdrawalView(withdrawal: AdminWithdrawalSnapshot) {
  return {
    agent_id: withdrawal.agentId,
    agent_name: withdrawal.agentName,
    agent_no: withdrawal.agentNo,
    amount: withdrawal.amount,
    created_at: withdrawal.createdAt.toISOString(),
    paid_at: withdrawal.paidAt?.toISOString() ?? null,
    payout_account_snapshot: payoutSnapshotView(withdrawal),
    proof_file_ids: withdrawal.proofFileIds,
    request_balance_snapshot: {
      available_after: withdrawal.balanceSnapshot.availableAfter,
      available_before: withdrawal.balanceSnapshot.availableBefore,
      captured_at: withdrawal.balanceSnapshot.capturedAt.toISOString(),
      frozen_after: withdrawal.balanceSnapshot.frozenAfter,
      frozen_before: withdrawal.balanceSnapshot.frozenBefore,
    },
    review_reason: withdrawal.reviewReason,
    reviewed_at: withdrawal.reviewedAt?.toISOString() ?? null,
    status: withdrawal.status,
    version: withdrawal.version,
    withdrawal_id: withdrawal.withdrawalId,
    withdrawal_no: withdrawal.withdrawalNo,
  };
}

function impactView(impact: AdminWithdrawalActionImpact) {
  return {
    affected_count: 1,
    metrics: [
      { after: impact.resultingStatus, before: impact.withdrawal.status, key: 'status', label: 'Status' },
      {
        after: impact.walletAvailableAfter,
        before: impact.walletAvailableBefore,
        key: 'available_balance',
        label: 'Available balance',
      },
      {
        after: impact.walletFrozenAfter,
        before: impact.walletFrozenBefore,
        key: 'frozen_balance',
        label: 'Frozen balance',
      },
      {
        after: String(impact.proofFileIds.length),
        before: String(impact.withdrawal.proofFileIds.length),
        key: 'proof_file_count',
        label: 'Payment proof count',
      },
    ],
    warnings: impact.action === 'REJECT'
      ? ['Rejecting releases the exact frozen amount to the Agent available balance.']
      : impact.action === 'MARK_PAID'
        ? ['Marking paid deducts the exact amount from the Agent frozen balance and cannot be reversed here.']
        : ['Approving enables the one-time payout-account reveal and payment-proof workflow.'],
  };
}

function previewRequest(
  action: AdminWithdrawalAction,
  body: Record<string, unknown>,
  impact: AdminWithdrawalActionImpact,
) {
  return {
    ...body,
    action,
    proof_file_ids: impact.proofFileIds,
    resulting_status: impact.resultingStatus,
    wallet_available_after: impact.walletAvailableAfter,
    wallet_available_before: impact.walletAvailableBefore,
    wallet_frozen_after: impact.walletFrozenAfter,
    wallet_frozen_before: impact.walletFrozenBefore,
    withdrawal_id: impact.withdrawal.withdrawalId,
  };
}

@Injectable()
export class AdminWithdrawalsService {
  private readonly adminAuth!: AdminAuthRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;
  private readonly withdrawals!: AdminWithdrawalRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.adminAuth = new AdminAuthRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
      this.withdrawals = new AdminWithdrawalRepository(database.prisma);
    }
  }

  async list(input: AdminWithdrawalListInput) {
    const result = await this.repositories().withdrawals.listWithdrawals(input);
    return {
      items: result.items.map(withdrawalView),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async detail(withdrawalId: string) {
    return withdrawalView(await this.repositories().withdrawals.getWithdrawal({ withdrawalId }));
  }

  previewApprove(request: AdminCustomerRequestContext, withdrawalId: string, idempotencyKey: string) {
    return this.preview(request, withdrawalId, 'APPROVE', {}, idempotencyKey, ROUTES.approvePreview);
  }

  approve(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.confirmedCommand(
      request,
      withdrawalId,
      'APPROVE',
      {},
      input,
      expectedVersion,
      idempotencyKey,
      ROUTES.approve,
      ROUTES.approvePreview,
      (transaction, hooks) => this.repositories().withdrawals.approveInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        expectedVersion,
        withdrawalId,
      }, hooks),
    );
  }

  previewReject(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalRejectInput,
    idempotencyKey: string,
  ) {
    return this.preview(
      request,
      withdrawalId,
      'REJECT',
      { reason: input.reason },
      idempotencyKey,
      ROUTES.rejectPreview,
    );
  }

  reject(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalRejectConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.confirmedCommand(
      request,
      withdrawalId,
      'REJECT',
      { reason: input.reason },
      input,
      expectedVersion,
      idempotencyKey,
      ROUTES.reject,
      ROUTES.rejectPreview,
      (transaction, hooks) => this.repositories().withdrawals.rejectInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        expectedVersion,
        reason: input.reason,
        withdrawalId,
      }, hooks),
      input.reason,
    );
  }

  async revealPayoutAccount(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalPayoutRevealInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { config, database } = this.runtime();
    const claim = this.claim(request, withdrawalId, idempotencyKey, ROUTES.reveal, {
      expected_version: expectedVersion,
      reauth_grant: input.reauthGrant,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'A payout-account reveal response cannot be replayed');
      }
      const material = await this.repositories().withdrawals.consumePayoutAccountRevealInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        expectedVersion,
        withdrawalId,
      }, {
        consumeGrant: () => this.repositories().adminAuth.consumePayoutReauthGrantInTransaction(transaction, {
          accountId: request.principal.accountId,
          currentSessionId: request.accessSession.sessionId,
          factorId: request.accessSession.factorId,
          targetId: withdrawalId,
          tokenHashCandidates: [
            config.authentication.secretHashKeys.current,
            ...config.authentication.secretHashKeys.previous,
          ].map(({ key }) => hmacAuthenticationSecret(input.reauthGrant, key, 'reauth-grant')),
        }),
      });
      const accountNumber = decryptAgentBankAccountNumber({
        bankAccountId: material.sourceBankAccountId,
        ciphertext: Buffer.from(material.ciphertext),
        encryptionKeyId: material.encryptionKeyId,
        last4: material.last4,
      }, config.encryption.fieldKeys);
      await this.appendRevealAudit(transaction, request, idempotencyKey, withdrawalId);
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: withdrawalId,
        responseForHash: { payout_account_revealed: { withdrawal_id: withdrawalId } },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return {
        account_holder: material.accountHolder,
        account_number: accountNumber,
        bank_name: material.bankName,
        expires_at: material.grantExpiresAt.toISOString(),
      };
    });
  }

  async attachProofs(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalProofsInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const fileIds = canonicalFileIds(input.fileIds);
    const claim = this.claim(request, withdrawalId, idempotencyKey, ROUTES.proofs, { file_ids: fileIds });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        this.repositories().idempotency.assertHashOnlyReplay(claimed.record, this.hashOnlyResult('PROOFS', withdrawalId));
        return withdrawalView(await this.repositories().withdrawals.getWithdrawalInTransaction(
          transaction,
          { withdrawalId },
        ));
      }
      const result = await this.repositories().withdrawals.bindProofsInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        fileIds,
        withdrawalId,
      });
      if (result.changed) {
        await this.appendMutationAudit(transaction, request, idempotencyKey, 'PROOFS', result.before, result.after);
        await this.appendOutbox(transaction, result.after, 'withdrawal.proofs_attached');
      }
      await this.repositories().idempotency.complete(transaction, claim, this.hashOnlyResult('PROOFS', withdrawalId));
      return withdrawalView(result.after);
    });
  }

  previewMarkPaid(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalMarkPaidInput,
    idempotencyKey: string,
  ) {
    return this.preview(
      request,
      withdrawalId,
      'MARK_PAID',
      { proof_file_ids: canonicalFileIds(input.proofFileIds) },
      idempotencyKey,
      ROUTES.markPaidPreview,
    );
  }

  markPaid(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    input: WithdrawalMarkPaidConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const proofFileIds = canonicalFileIds(input.proofFileIds);
    return this.confirmedCommand(
      request,
      withdrawalId,
      'MARK_PAID',
      { proof_file_ids: proofFileIds },
      input,
      expectedVersion,
      idempotencyKey,
      ROUTES.markPaid,
      ROUTES.markPaidPreview,
      (transaction, hooks) => this.repositories().withdrawals.markPaidInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        expectedVersion,
        proofFileIds,
        withdrawalId,
      }, hooks),
    );
  }

  private preview(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    action: AdminWithdrawalAction,
    body: Record<string, unknown>,
    idempotencyKey: string,
    route: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(request, withdrawalId, idempotencyKey, route, body);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Withdrawal preview must use a new idempotency key');
      }
      const actorAccountId = request.principal.accountId;
      const impact = action === 'MARK_PAID'
        ? await this.repositories().withdrawals.getActionImpactInTransaction(transaction, {
            action,
            actorAccountId,
            proofFileIds: body.proof_file_ids as string[],
            withdrawalId,
          })
        : action === 'REJECT'
          ? await this.repositories().withdrawals.getActionImpactInTransaction(transaction, {
              action,
              actorAccountId,
              reason: body.reason as string,
              withdrawalId,
            })
          : await this.repositories().withdrawals.getActionImpactInTransaction(transaction, {
              action,
              actorAccountId,
              withdrawalId,
            });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: `WITHDRAWAL.${action}`,
        actorId: request.principal.accountId,
        previewToken,
        request: previewRequest(action, body, impact),
        resourceVersion: impact.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: withdrawalId,
        targetType: 'WITHDRAWAL',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: impactView(impact),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(impact.resourceVersion),
      };
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: withdrawalId,
        responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  private confirmedCommand(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    action: AdminWithdrawalAction,
    body: Record<string, unknown>,
    confirmation: WithdrawalConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
    route: string,
    previewRoute: string,
    mutate: (transaction: DatabaseTransaction, hooks: AdminWithdrawalPreviewHooks) => Promise<AdminWithdrawalMutationResult>,
    reason?: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(request, withdrawalId, idempotencyKey, route, {
      ...body,
      confirmation_hash: confirmation.confirmationHash,
      expected_version: expectedVersion,
      preview_token: confirmation.previewToken,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        this.repositories().idempotency.assertHashOnlyReplay(claimed.record, this.hashOnlyResult(action, withdrawalId));
        return withdrawalView(await this.repositories().withdrawals.getWithdrawalInTransaction(
          transaction,
          { withdrawalId },
        ));
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: previewRoute,
      });
      const result = await mutate(transaction, {
        verifyPreview: (impact) => this.repositories().previews.consumeInTransaction(transaction, {
          action: `WITHDRAWAL.${action}`,
          actorId: request.principal.accountId,
          confirmationHash: confirmation.confirmationHash,
          previewToken: confirmation.previewToken,
          request: previewRequest(action, body, impact),
          resourceVersion: expectedVersion,
          sessionId: request.accessSession.sessionId,
          targetId: withdrawalId,
          targetType: 'WITHDRAWAL',
        }),
      });
      if (result.action !== action) throw internal('Withdrawal command result action is inconsistent');
      await this.appendMutationAudit(transaction, request, idempotencyKey, action, result.before, result.after, reason);
      await this.appendOutbox(
        transaction,
        result.after,
        action === 'APPROVE' ? 'withdrawal.approved' :
          action === 'REJECT' ? 'withdrawal.rejected' : 'withdrawal.paid',
      );
      await this.repositories().idempotency.complete(transaction, claim, this.hashOnlyResult(action, withdrawalId));
      return withdrawalView(result.after);
    });
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) throw internal('Admin withdrawal runtime is unavailable');
    return { config: this.config, database: this.database };
  }

  private repositories() {
    if (!this.adminAuth || !this.audit || !this.idempotency || !this.outbox || !this.previews || !this.withdrawals) {
      throw internal('Admin withdrawal repositories are unavailable');
    }
    return {
      adminAuth: this.adminAuth,
      audit: this.audit,
      idempotency: this.idempotency,
      outbox: this.outbox,
      previews: this.previews,
      withdrawals: this.withdrawals,
    };
  }

  private claim(
    request: AdminCustomerRequestContext,
    withdrawalId: string,
    idempotencyKey: string,
    route: string,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters: { withdrawal_id: withdrawalId }, route },
    };
  }

  private hashOnlyResult(action: AdminWithdrawalAction | 'PROOFS', withdrawalId: string) {
    return {
      resourceId: withdrawalId,
      responseForHash: { withdrawal_action: { action, withdrawal_id: withdrawalId } },
      responseStatus: 200,
      storage: 'HASH_ONLY' as const,
    };
  }

  private appendMutationAudit(
    transaction: DatabaseTransaction,
    request: AdminCustomerRequestContext,
    idempotencyKey: string,
    action: AdminWithdrawalAction | 'PROOFS',
    before: AdminWithdrawalSnapshot,
    after: AdminWithdrawalSnapshot,
    reason?: string,
  ) {
    const ipAddress = adminCustomerRequestIp(request);
    return this.repositories().audit.append(transaction, {
      action: action === 'MARK_PAID' ? 'PAY' : action === 'PROOFS' ? 'UPDATE' : action,
      actorAccountId: request.principal.accountId,
      actorRole: 'SUPER_ADMIN',
      after: { status: after.status, version: after.version },
      before: { status: before.status, version: before.version },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'withdrawal',
      objectId: after.withdrawalId,
      objectType: 'withdrawal',
      ...(reason === undefined ? {} : { reason }),
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendRevealAudit(
    transaction: DatabaseTransaction,
    request: AdminCustomerRequestContext,
    idempotencyKey: string,
    withdrawalId: string,
  ) {
    const ipAddress = adminCustomerRequestIp(request);
    return this.repositories().audit.append(transaction, {
      action: 'READ_SENSITIVE',
      actorAccountId: request.principal.accountId,
      actorRole: 'SUPER_ADMIN',
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'withdrawal',
      objectId: withdrawalId,
      objectType: 'withdrawal',
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'NONE',
    });
  }

  private appendOutbox(
    transaction: DatabaseTransaction,
    withdrawal: AdminWithdrawalSnapshot,
    eventType: string,
  ) {
    return this.repositories().outbox.append(transaction, {
      aggregateId: withdrawal.withdrawalId,
      aggregateType: 'withdrawal',
      eventType,
      payload: {
        event_version: 1,
        resource_id: withdrawal.withdrawalId,
        resource_type: 'withdrawal',
        resource_version: withdrawal.version,
      },
    });
  }
}
