import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  IdempotencyRepository,
  runSerializableTransaction,
  StoreAttributionRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyClaim,
  type StoreAttributionCreateResult,
  type StoreAttributionCandidateSnapshot,
  type StoreServiceAgentSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  generateStoreCandidateToken,
  generateUlid,
  hmacStoreCandidateToken,
  hmacStoreInviteCode,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { StoreAttributionCandidateInput } from './store-attribution.dto';

const ANONYMOUS_IDEMPOTENCY_ACTOR = '00000000000000000000000000';
const ROUTES = {
  candidates: '/store/attribution/candidates',
  confirm: '/store/attribution/candidate/confirm',
  reject: '/store/attribution/candidate/reject',
} as const;

export type StoreAttributionCredential =
  | { kind: 'ANONYMOUS' }
  | { kind: 'CANDIDATE_TOKEN'; tokenHashCandidates: readonly string[] }
  | { kind: 'CUSTOMER'; session: CurrentStoreSession };

function sensitiveReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'A sensitive Store attribution response cannot be replayed');
}

@Injectable()
export class StoreAttributionService {
  private readonly config: PlatformRuntimeConfig;
  private readonly database: DatabaseRuntime;
  private readonly attribution: StoreAttributionRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
  ) {
    this.config = config as PlatformRuntimeConfig;
    this.database = database as DatabaseRuntime;
    this.attribution = database ? new StoreAttributionRepository(database.prisma) : undefined as never;
    this.audit = config ? new AuditRepository(config.encryption.ipHashKey) : undefined as never;
    this.idempotency = config
      ? new IdempotencyRepository(config.encryption.idempotencyHashKeys)
      : undefined as never;
  }

  async createCandidate(
    credential: StoreAttributionCredential,
    input: StoreAttributionCandidateInput,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    if (credential.kind === 'CANDIDATE_TOKEN' &&
      await this.repository().getAnonymousCandidate(credential.tokenHashCandidates) === null) {
      throw new ApplicationError('AUTH_REQUIRED', 'Store attribution credential is invalid or expired');
    }
    const actorId = credential.kind === 'CUSTOMER'
      ? credential.session.accountId
      : ANONYMOUS_IDEMPOTENCY_ACTOR;
    const claim = this.claim(actorId, key, ROUTES.candidates, {
      credential_kind: credential.kind,
      invite_code: input.inviteCode,
      promotion_asset_id: input.promotionAssetId,
      ...(credential.kind === 'CANDIDATE_TOKEN'
        ? { candidate_credential_hash: credential.tokenHashCandidates[0] }
        : {}),
    });
    await this.rejectReplay(claim);

    const candidateId = generateUlid();
    const candidateToken = generateStoreCandidateToken();
    const candidateTokenHash = hmacStoreCandidateToken(
      candidateToken,
      this.runtime().authentication.secretHashKeys.current.key,
    );
    const inviteCodeHashCandidates = this.inviteCodeHashCandidates(input.inviteCode);

    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const result = credential.kind === 'CUSTOMER'
        ? await this.repository().createCustomerCandidateInTransaction(transaction, {
          accountId: credential.session.accountId,
          candidateId,
          customerId: credential.session.customerId,
          inviteCodeHashCandidates,
          promotionAssetId: input.promotionAssetId,
        })
        : await this.repository().createAnonymousCandidateInTransaction(transaction, {
          candidateId,
          candidateTokenHash,
          inviteCodeHashCandidates,
          promotionAssetId: input.promotionAssetId,
          ...(credential.kind === 'CANDIDATE_TOKEN'
            ? { replacementTokenHashCandidates: credential.tokenHashCandidates }
            : {}),
        });
      const response = this.createResponse(result,
        credential.kind === 'CUSTOMER' ? null : candidateToken);
      await this.auditMutation(transaction, {
        action: 'CREATE',
        credential,
        idempotencyKey: key,
        ...(ipAddress ? { ipAddress } : {}),
        objectId: input.promotionAssetId,
        objectType: 'promotion',
        requestId,
      });
      await this.idempotency.complete(transaction, claim, {
        resourceId: this.createResourceId(result, input.promotionAssetId),
        responseForHash: this.createResponseHash(result),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  async getCurrentCandidate(credential: StoreAttributionCredential) {
    let candidate: StoreAttributionCandidateSnapshot | null;
    if (credential.kind === 'CUSTOMER') {
      candidate = await this.repository().getCurrentCustomerCandidate(this.identity(credential.session));
    } else if (credential.kind === 'CANDIDATE_TOKEN') {
      candidate = await this.repository().getAnonymousCandidate(credential.tokenHashCandidates);
      if (candidate === null) {
        throw new ApplicationError('AUTH_REQUIRED', 'Store attribution credential is invalid or expired');
      }
    } else {
      throw new ApplicationError('AUTH_REQUIRED', 'Attribution candidate credentials are required');
    }
    return candidate === null ? null : this.candidateView(candidate);
  }

  async confirmCandidate(
    session: CurrentStoreSession,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, ROUTES.confirm, {});
    await this.rejectReplay(claim);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const result = await this.repository().confirmCurrentCandidateInTransaction(transaction, {
        ...this.identity(session),
        bindingChangeLogId: generateUlid(),
        bindingId: generateUlid(),
      });
      const response = this.serviceAgentView(result);
      await this.auditMutation(transaction, {
        action: 'CONFIRM',
        credential: { kind: 'CUSTOMER', session },
        idempotencyKey: key,
        ...(ipAddress ? { ipAddress } : {}),
        objectId: session.customerId,
        objectType: 'customer',
        requestId,
      });
      await this.idempotency.complete(transaction, claim, {
        resourceId: result.agentId,
        responseForHash: { agent_id: result.agentId, bound_at: result.boundAt.toISOString() },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  async rejectCandidate(
    session: CurrentStoreSession,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, ROUTES.reject, {});
    await this.rejectReplay(claim);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const result = await this.repository().rejectCurrentCandidateInTransaction(
        transaction,
        this.identity(session),
      );
      const response = {
        candidate_id: result.candidateId,
        rejected_at: result.rejectedAt.toISOString(),
        status: 'REJECTED' as const,
      };
      await this.auditMutation(transaction, {
        action: 'REJECT',
        credential: { kind: 'CUSTOMER', session },
        idempotencyKey: key,
        ...(ipAddress ? { ipAddress } : {}),
        objectId: session.customerId,
        objectType: 'customer',
        requestId,
      });
      await this.idempotency.complete(transaction, claim, {
        resourceId: result.candidateId,
        responseForHash: { candidate_id: result.candidateId, status: 'REJECTED' },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  async getServiceAgent(session: CurrentStoreSession) {
    const current = await this.repository().getCurrentServiceAgent(this.identity(session));
    return current === null ? null : this.serviceAgentView(current);
  }

  private createResponse(result: StoreAttributionCreateResult, candidateToken: string | null) {
    if (result.kind === 'candidate') {
      return {
        candidate: this.candidateView(result.candidate),
        candidate_token: candidateToken,
        public_fallback: null,
        service_agent: null,
      };
    }
    if (result.kind === 'service_agent') {
      return {
        candidate: null,
        candidate_token: null,
        public_fallback: null,
        service_agent: this.serviceAgentView(result.serviceAgent),
      };
    }
    return {
      candidate: null,
      candidate_token: null,
      public_fallback: {
        attribution_eligible: false as const,
        public_target_url: result.publicTargetUrl,
      },
      service_agent: null,
    };
  }

  private candidateView(candidate: StoreAttributionCandidateSnapshot) {
    return {
      agent_id: candidate.agentId,
      attribution_eligible: true as const,
      candidate_id: candidate.id,
      confirmation_required: true as const,
      display_name: candidate.displayName,
      expires_at: candidate.expiresAt.toISOString(),
      public_target_url: candidate.publicTargetUrl,
      remaining_seconds: Math.min(1_800,
        Math.max(0, Math.ceil((candidate.expiresAt.getTime() - Date.now()) / 1_000))),
    };
  }

  private serviceAgentView(snapshot: StoreServiceAgentSnapshot) {
    return {
      agent_id: snapshot.agentId,
      bound_at: snapshot.boundAt.toISOString(),
      display_name: snapshot.displayName,
    };
  }

  private createResourceId(result: StoreAttributionCreateResult, promotionAssetId: string): string {
    if (result.kind === 'candidate') return result.candidate.id;
    if (result.kind === 'service_agent') return result.serviceAgent.agentId;
    return promotionAssetId;
  }

  private createResponseHash(result: StoreAttributionCreateResult) {
    if (result.kind === 'candidate') return { candidate_id: result.candidate.id, kind: result.kind };
    if (result.kind === 'service_agent') return { agent_id: result.serviceAgent.agentId, kind: result.kind };
    return { kind: result.kind, public_target_url: result.publicTargetUrl };
  }

  private auditMutation(
    transaction: DatabaseTransaction,
    input: {
      action: 'CONFIRM' | 'CREATE' | 'REJECT';
      credential: StoreAttributionCredential;
      idempotencyKey: string;
      ipAddress?: string;
      objectId: string;
      objectType: 'customer' | 'promotion';
      requestId: string;
    },
  ) {
    const session = input.credential.kind === 'CUSTOMER' ? input.credential.session : undefined;
    return this.audit.append(transaction, {
      action: input.action,
      ...(session ? { actorAccountId: session.accountId, actorRole: 'CUSTOMER' as const } : {}),
      idempotencyKey: input.idempotencyKey,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      module: 'attribution',
      objectId: input.objectId,
      objectType: input.objectType,
      requestId: input.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'NONE',
    });
  }

  private inviteCodeHashCandidates(value: string): readonly string[] {
    const keys = [this.runtime().authentication.secretHashKeys.current,
      ...this.runtime().authentication.secretHashKeys.previous];
    return [...new Set(keys.map(({ key }) => hmacStoreInviteCode(value, key)))];
  }

  private identity(session: CurrentStoreSession) {
    return { accountId: session.accountId, customerId: session.customerId };
  }

  private claim(actorId: string, idempotencyKey: string, route: string, body: unknown): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters: {}, route },
    };
  }

  private async rejectReplay(claim: IdempotencyClaim): Promise<void> {
    const replay = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      return (await this.idempotency.claim(transaction, claim)).kind === 'replay';
    });
    if (replay) throw sensitiveReplay();
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store attribution runtime is unavailable');
    return this.config;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Store attribution database is unavailable');
    return this.database;
  }

  private repository(): StoreAttributionRepository {
    if (!this.attribution) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store attribution repository is unavailable');
    }
    return this.attribution;
  }
}
