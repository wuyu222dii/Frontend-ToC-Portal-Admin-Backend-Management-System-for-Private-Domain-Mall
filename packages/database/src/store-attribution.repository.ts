import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const HEX_64 = /^[a-f0-9]{64}$/;
const CANDIDATE_TTL_MS = 30 * 60 * 1_000;
const MAX_HASH_CANDIDATES = 4;
const MAX_POSTGRES_INCREMENTABLE_INTEGER = 2_147_483_646;

export interface StoreAttributionIdentity {
  accountId: string;
  customerId: string;
}

export interface StoreAttributionTargetInput {
  inviteCodeHashCandidates: readonly string[];
  promotionAssetId: string;
}

export interface StoreAttributionCandidateSnapshot {
  id: string;
  agentId: string;
  displayName: string;
  expiresAt: Date;
  publicTargetUrl: string;
}

export interface StoreServiceAgentSnapshot {
  agentId: string;
  displayName: string;
  boundAt: Date;
}

export type StoreAttributionCreateResult =
  | { kind: 'candidate'; candidate: StoreAttributionCandidateSnapshot }
  | { kind: 'service_agent'; serviceAgent: StoreServiceAgentSnapshot }
  | { kind: 'public_fallback'; publicTargetUrl: string };

export type StoreAttributionMigrationResult =
  | { kind: 'candidate'; candidate: StoreAttributionCandidateSnapshot }
  | { kind: 'service_agent'; serviceAgent: StoreServiceAgentSnapshot }
  | { kind: 'none' };

export interface StoreAttributionRejectSnapshot {
  candidateId: string;
  rejectedAt: Date;
}

export interface StoreAnonymousAttributionCandidateInput extends StoreAttributionTargetInput {
  candidateId: string;
  candidateTokenHash: string;
  replacementTokenHashCandidates?: readonly string[];
}

export interface StoreCustomerAttributionCandidateInput extends StoreAttributionIdentity, StoreAttributionTargetInput {
  candidateId: string;
}

export interface StoreAttributionCandidateMigrationInput extends StoreAttributionIdentity {
  tokenHashCandidates: readonly string[];
}

export interface StoreAttributionCandidateConfirmationInput extends StoreAttributionIdentity {
  bindingChangeLogId: string;
  bindingId: string;
}

interface PromotionResolution {
  agentId: string;
  attributionEligible: boolean;
  displayName: string;
  inviteCodeId: string;
  promotionAssetId: string;
  publicTargetUrl: string;
}

interface CandidateSubject {
  agent_id: string;
  candidate_token_hash: string | null;
  customer_id: string | null;
  expires_at: Date;
  id: string;
  invite_code_id: string;
  promotion_asset_id: string;
  status: string;
}

function currentDate(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Store attribution clock must return a valid Date');
  }
  return new Date(value);
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireHash(value: string, label: string): void {
  if (!HEX_64.test(value)) throw new TypeError(`${label} must be a lowercase HMAC-SHA-256 digest`);
}

function requireHashCandidates(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_HASH_CANDIDATES) {
    throw new TypeError(`${label} must contain between one and four digests`);
  }
  for (const value of values) requireHash(value, label);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicate digests`);
}

function validateIdentity(input: StoreAttributionIdentity): void {
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
}

function validateTarget(input: StoreAttributionTargetInput): void {
  requireUlid(input.promotionAssetId, 'Promotion asset ID');
  requireHashCandidates(input.inviteCodeHashCandidates, 'Invite code hash candidates');
}

function parsePublicTargetUrl(value: string): string | null {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function candidateMismatch(): ApplicationError {
  return new ApplicationError('ATTRIBUTION_CANDIDATE_MISMATCH', 'Attribution candidate is no longer current');
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function unavailablePromotion(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Promotion target is unavailable');
}

function isActiveCustomerAccount(account: {
  deleted_at: Date | null;
  login_name: string | null;
  password_hash: string | null;
  role: string;
  status: string;
  wechat_open_id: string | null;
}): boolean {
  return account.role === 'CUSTOMER' && account.status === 'ACTIVE' && account.deleted_at === null &&
    account.login_name === null && account.password_hash === null && account.wechat_open_id !== null;
}

function candidateSnapshot(
  candidate: Pick<CandidateSubject, 'id' | 'expires_at'>,
  resolution: PromotionResolution,
): StoreAttributionCandidateSnapshot {
  return {
    agentId: resolution.agentId,
    displayName: resolution.displayName,
    expiresAt: new Date(candidate.expires_at),
    id: candidate.id,
    publicTargetUrl: resolution.publicTargetUrl,
  };
}

export class StoreAttributionRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    currentDate(this.now);
  }

  private async lockAndReadCustomer(
    transaction: DatabaseTransaction,
    identity: StoreAttributionIdentity,
  ) {
    validateIdentity(identity);
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [identity.customerId]);
    const account = await transaction.account.findUnique({
      where: { id: identity.accountId },
      select: {
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
        customer_profile: {
          select: {
            account_id: true,
            anonymized_at: true,
            id: true,
            version: true,
          },
        },
      },
    });
    const customer = account?.customer_profile;
    if (!account || !isActiveCustomerAccount(account) || !customer ||
      customer.id !== identity.customerId || customer.account_id !== identity.accountId ||
      customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
    return customer;
  }

  private async readCustomer(
    client: Pick<PrismaClient, 'account'>,
    identity: StoreAttributionIdentity,
  ) {
    validateIdentity(identity);
    const account = await client.account.findUnique({
      where: { id: identity.accountId },
      select: {
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
        customer_profile: {
          select: { account_id: true, anonymized_at: true, id: true },
        },
      },
    });
    const customer = account?.customer_profile;
    if (!account || !isActiveCustomerAccount(account) || !customer ||
      customer.id !== identity.customerId || customer.account_id !== identity.accountId ||
      customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async incrementCustomerVersion(
    transaction: DatabaseTransaction,
    identity: StoreAttributionIdentity,
    version: number,
    now: Date,
  ): Promise<void> {
    if (!Number.isInteger(version) || version < 1 || version > MAX_POSTGRES_INCREMENTABLE_INTEGER) {
      throw new ApplicationError('INTERNAL_ERROR', 'Customer profile version is invalid');
    }
    const changed = await transaction.customerProfile.updateMany({
      data: { updated_at: now, version: { increment: 1 } },
      where: {
        account_id: identity.accountId,
        anonymized_at: null,
        id: identity.customerId,
        version,
      },
    });
    if (changed.count !== 1) {
      throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Customer profile version changed');
    }
  }

  private async readPromotionResolution(
    transaction: DatabaseTransaction,
    input: StoreAttributionTargetInput,
  ): Promise<PromotionResolution> {
    validateTarget(input);
    const initial = await transaction.promotionAsset.findUnique({
      where: { id: input.promotionAssetId },
      select: { agent_id: true, invite_code_id: true, target_product_id: true },
    });
    if (!initial) throw unavailablePromotion();
    await acquireTransactionLock(transaction, 'store-attribution-agent', [initial.agent_id]);
    await acquireTransactionLock(transaction, 'store-attribution-invite', [initial.invite_code_id]);
    await acquireTransactionLock(transaction, 'store-attribution-promotion', [input.promotionAssetId]);
    if (initial.target_product_id) {
      await acquireTransactionLock(transaction, 'store-attribution-product', [initial.target_product_id]);
    }
    const asset = await transaction.promotionAsset.findUnique({
      where: { id: input.promotionAssetId },
      select: {
        agent_id: true,
        authorization_version: true,
        expires_at: true,
        id: true,
        invite_code_id: true,
        public_url: true,
        revoked_at: true,
        status: true,
        target_product_id: true,
        target_type: true,
        agent: {
          select: {
            account: { select: { deleted_at: true, role: true, status: true } },
            deleted_at: true,
            id: true,
            name: true,
            product_authorization_mode: true,
            status: true,
            version: true,
          },
        },
        invite_code: {
          select: {
            agent_id: true,
            code_hash: true,
            effective_at: true,
            ended_at: true,
            expires_at: true,
            id: true,
            status: true,
          },
        },
        target_product: {
          select: {
            brand: { select: { deleted_at: true, status: true } },
            category: { select: { deleted_at: true, status: true } },
            deleted_at: true,
            id: true,
            skus: {
              select: { id: true },
              take: 1,
              where: { deleted_at: null, status: 'ACTIVE' },
            },
            status: true,
            whitelist_entries: {
              select: { id: true },
              take: 1,
              where: { agent_id: initial.agent_id, deleted_at: null },
            },
          },
        },
      },
    });
    if (!asset || asset.agent_id !== initial.agent_id || asset.invite_code_id !== initial.invite_code_id ||
      asset.invite_code.agent_id !== asset.agent_id ||
      !input.inviteCodeHashCandidates.includes(asset.invite_code.code_hash)) {
      throw unavailablePromotion();
    }
    const publicTargetUrl = parsePublicTargetUrl(asset.public_url);
    if (!publicTargetUrl) throw unavailablePromotion();

    const product = asset.target_product;
    const publicTarget = asset.target_type === 'STOREFRONT'
      ? asset.target_product_id === null && product === null
      : asset.target_type === 'PRODUCT' && asset.target_product_id !== null && product !== null &&
        product.id === asset.target_product_id;
    if (!publicTarget) throw unavailablePromotion();

    const now = currentDate(this.now);
    const agentActive = asset.agent.status === 'ACTIVE' && asset.agent.deleted_at === null &&
      asset.agent.account.role === 'AGENT_ADMIN' && asset.agent.account.status === 'ACTIVE' &&
      asset.agent.account.deleted_at === null;
    const inviteActive = asset.invite_code.status === 'ACTIVE' && asset.invite_code.ended_at === null &&
      asset.invite_code.effective_at.getTime() <= now.getTime() &&
      (asset.invite_code.expires_at === null || asset.invite_code.expires_at.getTime() > now.getTime());
    const assetActive = asset.status === 'ACTIVE' && asset.revoked_at === null &&
      (asset.expires_at === null || asset.expires_at.getTime() > now.getTime());
    const productActive = asset.target_type === 'STOREFRONT' || (product !== null &&
      product.status === 'ACTIVE' && product.deleted_at === null &&
      product.brand.status === 'ACTIVE' && product.brand.deleted_at === null &&
      product.category.status === 'ACTIVE' && product.category.deleted_at === null && product.skus.length === 1);
    const productAuthorized = asset.target_type === 'STOREFRONT' || (product !== null &&
      (asset.agent.product_authorization_mode === 'ALL_ACTIVE_PRODUCTS' ||
        (asset.agent.product_authorization_mode === 'CUSTOM_WHITELIST' && product.whitelist_entries.length === 1)));
    return {
      agentId: asset.agent.id,
      attributionEligible: agentActive && inviteActive && assetActive && productActive && productAuthorized,
      displayName: asset.agent.name,
      inviteCodeId: asset.invite_code.id,
      promotionAssetId: asset.id,
      publicTargetUrl,
    };
  }

  private async readCandidateResolution(
    transaction: DatabaseTransaction,
    candidate: CandidateSubject,
  ): Promise<PromotionResolution | null> {
    const asset = await transaction.promotionAsset.findUnique({
      where: { id: candidate.promotion_asset_id },
      select: { invite_code: { select: { code_hash: true } } },
    });
    if (!asset) return null;
    try {
      const resolution = await this.readPromotionResolution(transaction, {
        inviteCodeHashCandidates: [asset.invite_code.code_hash],
        promotionAssetId: candidate.promotion_asset_id,
      });
      return resolution.agentId === candidate.agent_id && resolution.inviteCodeId === candidate.invite_code_id &&
        resolution.attributionEligible ? resolution : null;
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'RESOURCE_NOT_FOUND') return null;
      throw error;
    }
  }

  private async findAnonymousCandidate(
    transaction: DatabaseTransaction,
    tokenHashCandidates: readonly string[],
  ): Promise<CandidateSubject | null> {
    requireHashCandidates(tokenHashCandidates, 'Candidate token hash candidates');
    const candidates = await transaction.attributionCandidate.findMany({
      where: {
        candidate_token_hash: { in: [...tokenHashCandidates] },
        customer_id: null,
        status: 'ACTIVE',
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 2,
      select: {
        agent_id: true,
        candidate_token_hash: true,
        customer_id: true,
        expires_at: true,
        id: true,
        invite_code_id: true,
        promotion_asset_id: true,
        status: true,
      },
    });
    if (candidates.length > 1) {
      throw new ApplicationError('INTERNAL_ERROR', 'Candidate token resolves to multiple active facts');
    }
    return candidates[0] ?? null;
  }

  private async lockAndReadAnonymousCandidate(
    transaction: DatabaseTransaction,
    tokenHashCandidates: readonly string[],
  ): Promise<CandidateSubject> {
    const initial = await this.findAnonymousCandidate(transaction, tokenHashCandidates);
    if (!initial) throw new ApplicationError('AUTH_REQUIRED', 'Candidate token is invalid or expired');
    await acquireTransactionLock(transaction, 'store-attribution-candidate', [initial.id]);
    const candidate = await transaction.attributionCandidate.findUnique({
      where: { id: initial.id },
      select: {
        agent_id: true,
        candidate_token_hash: true,
        customer_id: true,
        expires_at: true,
        id: true,
        invite_code_id: true,
        promotion_asset_id: true,
        status: true,
      },
    });
    if (!candidate || candidate.status !== 'ACTIVE' || candidate.customer_id !== null ||
      candidate.candidate_token_hash === null || !tokenHashCandidates.includes(candidate.candidate_token_hash)) {
      throw new ApplicationError('AUTH_REQUIRED', 'Candidate token is invalid or expired');
    }
    return candidate;
  }

  private async findCurrentCustomerCandidate(
    transaction: DatabaseTransaction,
    customerId: string,
  ): Promise<CandidateSubject | null> {
    const candidates = await transaction.attributionCandidate.findMany({
      where: { customer_id: customerId, status: 'ACTIVE' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 2,
      select: {
        agent_id: true,
        candidate_token_hash: true,
        customer_id: true,
        expires_at: true,
        id: true,
        invite_code_id: true,
        promotion_asset_id: true,
        status: true,
      },
    });
    if (candidates.length > 1) {
      throw new ApplicationError('INTERNAL_ERROR', 'Customer has multiple active attribution candidates');
    }
    return candidates[0] ?? null;
  }

  private async currentBinding(
    transaction: DatabaseTransaction,
    customerId: string,
  ): Promise<StoreServiceAgentSnapshot | null> {
    const bindings = await transaction.customerAgentBinding.findMany({
      where: { customer_id: customerId, ended_at: null },
      orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      take: 2,
      select: {
        agent: { select: { id: true, name: true } },
        started_at: true,
      },
    });
    if (bindings.length > 1) {
      throw new ApplicationError('INTERNAL_ERROR', 'Customer has multiple current service-agent bindings');
    }
    const binding = bindings[0];
    return binding ? {
      agentId: binding.agent.id,
      boundAt: new Date(binding.started_at),
      displayName: binding.agent.name,
    } : null;
  }

  async createAnonymousCandidateInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAnonymousAttributionCandidateInput,
  ): Promise<StoreAttributionCreateResult> {
    validateTarget(input);
    requireUlid(input.candidateId, 'Candidate ID');
    requireHash(input.candidateTokenHash, 'Candidate token hash');
    const replacementHashes = input.replacementTokenHashCandidates;
    let replaced: CandidateSubject | null = null;
    if (replacementHashes !== undefined) {
      requireHashCandidates(replacementHashes, 'Replacement token hash candidates');
      if (replacementHashes.includes(input.candidateTokenHash)) {
        throw new TypeError('Replacement candidate must use a new token hash');
      }
      replaced = await this.lockAndReadAnonymousCandidate(transaction, replacementHashes);
      const now = currentDate(this.now);
      if (replaced.expires_at.getTime() <= now.getTime() ||
        await this.readCandidateResolution(transaction, replaced) === null) {
        throw new ApplicationError('AUTH_REQUIRED', 'Candidate token is invalid or expired');
      }
    }

    const resolution = await this.readPromotionResolution(transaction, input);
    if (!resolution.attributionEligible) {
      return { kind: 'public_fallback', publicTargetUrl: resolution.publicTargetUrl };
    }
    const now = currentDate(this.now);
    if (replaced) {
      await transaction.attributionCandidate.update({
        where: { id: replaced.id },
        data: { invalid_reason: 'REPLACED', status: 'INVALIDATED', updated_at: now },
      });
    }
    const created = await transaction.attributionCandidate.create({
      data: {
        agent_id: resolution.agentId,
        candidate_token_hash: input.candidateTokenHash,
        confirmed_at: null,
        created_at: now,
        customer_id: null,
        expires_at: new Date(now.getTime() + CANDIDATE_TTL_MS),
        id: input.candidateId,
        invalid_reason: null,
        invite_code_id: resolution.inviteCodeId,
        promotion_asset_id: resolution.promotionAssetId,
        status: 'ACTIVE',
        updated_at: now,
      },
      select: { expires_at: true, id: true },
    });
    return { kind: 'candidate', candidate: candidateSnapshot(created, resolution) };
  }

  async createCustomerCandidateInTransaction(
    transaction: DatabaseTransaction,
    input: StoreCustomerAttributionCandidateInput,
  ): Promise<StoreAttributionCreateResult> {
    validateTarget(input);
    requireUlid(input.candidateId, 'Candidate ID');
    await this.lockAndReadCustomer(transaction, input);
    const currentCandidate = await this.findCurrentCustomerCandidate(transaction, input.customerId);
    if (currentCandidate) {
      await acquireTransactionLock(transaction, 'store-attribution-candidate', [currentCandidate.id]);
    }
    await acquireTransactionLock(transaction, 'store-attribution-binding', [input.customerId]);
    const binding = await this.currentBinding(transaction, input.customerId);
    if (binding) return { kind: 'service_agent', serviceAgent: binding };
    const resolution = await this.readPromotionResolution(transaction, input);
    if (!resolution.attributionEligible) {
      return { kind: 'public_fallback', publicTargetUrl: resolution.publicTargetUrl };
    }
    const now = currentDate(this.now);
    if (currentCandidate) {
      await transaction.attributionCandidate.update({
        where: { id: currentCandidate.id },
        data: {
          invalid_reason: currentCandidate.expires_at.getTime() <= now.getTime() ? 'TTL_EXPIRED' : 'REPLACED',
          status: currentCandidate.expires_at.getTime() <= now.getTime() ? 'EXPIRED' : 'INVALIDATED',
          updated_at: now,
        },
      });
    }
    const created = await transaction.attributionCandidate.create({
      data: {
        agent_id: resolution.agentId,
        candidate_token_hash: null,
        confirmed_at: null,
        created_at: now,
        customer_id: input.customerId,
        expires_at: new Date(now.getTime() + CANDIDATE_TTL_MS),
        id: input.candidateId,
        invalid_reason: null,
        invite_code_id: resolution.inviteCodeId,
        promotion_asset_id: resolution.promotionAssetId,
        status: 'ACTIVE',
        updated_at: now,
      },
      select: { expires_at: true, id: true },
    });
    return { kind: 'candidate', candidate: candidateSnapshot(created, resolution) };
  }

  async getAnonymousCandidate(
    tokenHashCandidates: readonly string[],
  ): Promise<StoreAttributionCandidateSnapshot | null> {
    requireHashCandidates(tokenHashCandidates, 'Candidate token hash candidates');
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await this.findAnonymousCandidate(transaction, tokenHashCandidates);
      const now = currentDate(this.now);
      if (!candidate || candidate.expires_at.getTime() <= now.getTime()) return null;
      const resolution = await this.readCandidateResolution(transaction, candidate);
      return resolution ? candidateSnapshot(candidate, resolution) : null;
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getCurrentCustomerCandidate(
    identity: StoreAttributionIdentity,
  ): Promise<StoreAttributionCandidateSnapshot | null> {
    validateIdentity(identity);
    return this.prisma.$transaction(async (transaction) => {
      await this.readCustomer(transaction as unknown as Pick<PrismaClient, 'account'>, identity);
      const candidate = await this.findCurrentCustomerCandidate(transaction, identity.customerId);
      const now = currentDate(this.now);
      if (!candidate || candidate.expires_at.getTime() <= now.getTime()) return null;
      const resolution = await this.readCandidateResolution(transaction, candidate);
      return resolution ? candidateSnapshot(candidate, resolution) : null;
    }, { isolationLevel: 'RepeatableRead' });
  }

  async migrateAnonymousCandidateInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAttributionCandidateMigrationInput,
  ): Promise<StoreAttributionMigrationResult> {
    requireHashCandidates(input.tokenHashCandidates, 'Candidate token hash candidates');
    const initial = await this.findAnonymousCandidate(transaction, input.tokenHashCandidates);
    if (!initial) throw candidateMismatch();
    await this.lockAndReadCustomer(transaction, input);
    await acquireTransactionLock(transaction, 'store-attribution-candidate', [initial.id]);
    const incoming = await transaction.attributionCandidate.findUnique({
      where: { id: initial.id },
      select: {
        agent_id: true,
        candidate_token_hash: true,
        customer_id: true,
        expires_at: true,
        id: true,
        invite_code_id: true,
        promotion_asset_id: true,
        status: true,
      },
    });
    if (!incoming || incoming.status !== 'ACTIVE' || incoming.customer_id !== null ||
      incoming.candidate_token_hash === null ||
      !input.tokenHashCandidates.includes(incoming.candidate_token_hash)) {
      throw candidateMismatch();
    }
    await acquireTransactionLock(transaction, 'store-attribution-binding', [input.customerId]);
    const binding = await this.currentBinding(transaction, input.customerId);
    const now = currentDate(this.now);
    if (binding) {
      await transaction.attributionCandidate.update({
        where: { id: incoming.id },
        data: { invalid_reason: 'CUSTOMER_ALREADY_BOUND', status: 'INVALIDATED', updated_at: now },
      });
      return { kind: 'service_agent', serviceAgent: binding };
    }

    const currentCandidate = await this.findCurrentCustomerCandidate(transaction, input.customerId);
    if (currentCandidate) {
      await acquireTransactionLock(transaction, 'store-attribution-candidate', [currentCandidate.id]);
      const existingResolution = currentCandidate.expires_at.getTime() > now.getTime()
        ? await this.readCandidateResolution(transaction, currentCandidate)
        : null;
      if (existingResolution) {
        await transaction.attributionCandidate.update({
          where: { id: incoming.id },
          data: { invalid_reason: 'CUSTOMER_CANDIDATE_EXISTS', status: 'INVALIDATED', updated_at: now },
        });
        return { kind: 'candidate', candidate: candidateSnapshot(currentCandidate, existingResolution) };
      }
      await transaction.attributionCandidate.update({
        where: { id: currentCandidate.id },
        data: {
          invalid_reason: currentCandidate.expires_at.getTime() <= now.getTime()
            ? 'TTL_EXPIRED'
            : 'ATTRIBUTION_INELIGIBLE',
          status: currentCandidate.expires_at.getTime() <= now.getTime() ? 'EXPIRED' : 'INVALIDATED',
          updated_at: now,
        },
      });
    }

    if (incoming.expires_at.getTime() <= now.getTime()) {
      await transaction.attributionCandidate.update({
        where: { id: incoming.id },
        data: { invalid_reason: 'TTL_EXPIRED', status: 'EXPIRED', updated_at: now },
      });
      return { kind: 'none' };
    }
    const incomingResolution = await this.readCandidateResolution(transaction, incoming);
    if (!incomingResolution) {
      await transaction.attributionCandidate.update({
        where: { id: incoming.id },
        data: { invalid_reason: 'ATTRIBUTION_INELIGIBLE', status: 'INVALIDATED', updated_at: now },
      });
      return { kind: 'none' };
    }
    const migrated = await transaction.attributionCandidate.update({
      where: { id: incoming.id },
      data: {
        candidate_token_hash: null,
        customer_id: input.customerId,
        updated_at: now,
      },
      select: { expires_at: true, id: true },
    });
    return { kind: 'candidate', candidate: candidateSnapshot(migrated, incomingResolution) };
  }

  async confirmCurrentCandidateInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAttributionCandidateConfirmationInput,
  ): Promise<StoreServiceAgentSnapshot> {
    validateIdentity(input);
    requireUlid(input.bindingId, 'Binding ID');
    requireUlid(input.bindingChangeLogId, 'Binding change log ID');
    if (input.bindingId === input.bindingChangeLogId) {
      throw new TypeError('Binding and binding change log IDs must differ');
    }
    const customer = await this.lockAndReadCustomer(transaction, input);
    const candidate = await this.findCurrentCustomerCandidate(transaction, input.customerId);
    if (candidate) await acquireTransactionLock(transaction, 'store-attribution-candidate', [candidate.id]);
    await acquireTransactionLock(transaction, 'store-attribution-binding', [input.customerId]);
    const winner = await this.currentBinding(transaction, input.customerId);
    if (winner) return winner;
    const now = currentDate(this.now);
    if (!candidate || candidate.expires_at.getTime() <= now.getTime()) throw candidateMismatch();
    const resolution = await this.readCandidateResolution(transaction, candidate);
    if (!resolution) throw candidateMismatch();

    const inserted = await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "customer_agent_binding"
        ("id", "customer_id", "agent_id", "started_at", "ended_at", "end_reason", "created_at")
      VALUES
        (${input.bindingId}, ${input.customerId}, ${candidate.agent_id}, ${now}, NULL, NULL, ${now})
      ON CONFLICT DO NOTHING
    `);
    if (inserted !== 1) {
      const concurrentWinner = await this.currentBinding(transaction, input.customerId);
      if (concurrentWinner) return concurrentWinner;
      throw new ApplicationError('INTERNAL_ERROR', 'Attribution binding could not be created');
    }
    await transaction.attributionCandidate.update({
      where: { id: candidate.id },
      data: { confirmed_at: now, invalid_reason: null, status: 'CONFIRMED', updated_at: now },
    });
    await transaction.bindingChangeLog.create({
      data: {
        actor_account_id: input.accountId,
        created_at: now,
        customer_id: input.customerId,
        id: input.bindingChangeLogId,
        new_agent_id: candidate.agent_id,
        new_binding_id: input.bindingId,
        old_agent_id: null,
        old_binding_id: null,
        reason: 'CUSTOMER_CONFIRMED_ATTRIBUTION',
      },
    });
    await this.incrementCustomerVersion(transaction, input, customer.version, now);
    return {
      agentId: resolution.agentId,
      boundAt: now,
      displayName: resolution.displayName,
    };
  }

  async rejectCurrentCandidateInTransaction(
    transaction: DatabaseTransaction,
    identity: StoreAttributionIdentity,
  ): Promise<StoreAttributionRejectSnapshot> {
    await this.lockAndReadCustomer(transaction, identity);
    const candidate = await this.findCurrentCustomerCandidate(transaction, identity.customerId);
    if (!candidate) throw candidateMismatch();
    await acquireTransactionLock(transaction, 'store-attribution-candidate', [candidate.id]);
    const now = currentDate(this.now);
    if (candidate.expires_at.getTime() <= now.getTime()) throw candidateMismatch();
    const resolution = await this.readCandidateResolution(transaction, candidate);
    if (!resolution) throw candidateMismatch();
    await transaction.attributionCandidate.update({
      where: { id: candidate.id },
      data: { invalid_reason: 'CUSTOMER_REJECTED', status: 'REJECTED', updated_at: now },
    });
    return { candidateId: candidate.id, rejectedAt: now };
  }

  async getCurrentServiceAgent(
    identity: StoreAttributionIdentity,
  ): Promise<StoreServiceAgentSnapshot | null> {
    validateIdentity(identity);
    return this.prisma.$transaction(async (transaction) => {
      await this.readCustomer(transaction as unknown as Pick<PrismaClient, 'account'>, identity);
      return this.currentBinding(transaction, identity.customerId);
    }, { isolationLevel: 'RepeatableRead' });
  }
}
