import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  IdempotencyRepository,
  runSerializableTransaction,
  StoreProfileRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyClaim,
  type StoreProfileSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createEncryptionContext,
  encryptEnvelope,
  generateUlid,
  hmacStoreAccountPhone,
  normalizeStoreAccountPhone,
  verifyStoredStorePhoneMaterial,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { StorePhoneAuthorizationInput, StoreProfileUpdateInput } from './store-profile.dto';
import { StorePhoneProvider } from './store-phone-provider';

const ROUTES = {
  authorizePhone: '/store/profile/phone-authorizations',
  profile: '/store/profile',
  revokePhone: '/store/profile/phone',
} as const;

function sensitiveReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'A sensitive Store profile response cannot be replayed');
}

@Injectable()
export class StoreProfileService {
  private readonly config: PlatformRuntimeConfig;
  private readonly database: DatabaseRuntime;
  private readonly profiles: StoreProfileRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
    @Optional() @Inject(StorePhoneProvider) private readonly phoneProvider?: StorePhoneProvider,
  ) {
    this.config = config as PlatformRuntimeConfig;
    this.database = database as DatabaseRuntime;
    this.profiles = database ? new StoreProfileRepository(database.prisma) : undefined as never;
    this.audit = config ? new AuditRepository(config.encryption.ipHashKey) : undefined as never;
    this.idempotency = config
      ? new IdempotencyRepository(config.encryption.idempotencyHashKeys)
      : undefined as never;
  }

  async getProfile(session: CurrentStoreSession) {
    const snapshot = await this.profileRepository().getCurrentProfile(this.identity(session));
    return this.profileView(snapshot);
  }

  async updateProfile(
    session: CurrentStoreSession,
    input: StoreProfileUpdateInput,
    expectedVersion: number,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, 'PATCH', ROUTES.profile, {
      ...input,
      expected_version: expectedVersion,
    });
    await this.rejectReplay(claim);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const changed = await this.profileRepository().updateCurrentProfileInTransaction(transaction, {
        ...this.identity(session),
        expectedVersion,
        patch: input,
      });
      const response = this.profileView(changed);
      await this.appendAudit(transaction, session, 'UPDATE', expectedVersion, changed.version,
        requestId, key, ipAddress);
      await this.complete(transaction, claim, changed);
      return response;
    });
  }

  async authorizePhone(
    session: CurrentStoreSession,
    input: StorePhoneAuthorizationInput,
    expectedVersion: number,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    this.assertCurrentPhoneConsent(input);
    const claim = this.claim(session.accountId, key, 'POST', ROUTES.authorizePhone, {
      ...input,
      expected_version: expectedVersion,
    });
    await this.rejectReplay(claim);
    const verified = await this.provider().verify(input.providerCredential);
    const phone = normalizeStoreAccountPhone(verified.phone);
    const verificationId = generateUlid();
    const encryptionKey = this.runtime().encryption.fieldKeys.current;
    const envelope = encryptEnvelope(phone, {
      keyId: encryptionKey.id,
      key: encryptionKey.key,
    }, createEncryptionContext('customer_phone_verification', verificationId, 'phone_ciphertext'));
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const changed = await this.profileRepository().replaceCurrentPhoneInTransaction(transaction, {
        ...this.identity(session),
        consentId: generateUlid(),
        expectedVersion,
        verification: {
          consentVersion: input.consent.documentVersion,
          encryptionKeyId: encryptionKey.id,
          id: verificationId,
          phoneCiphertext: Buffer.from(JSON.stringify(envelope)),
          phoneHash: hmacStoreAccountPhone(phone, this.runtime().store.phoneHashKeys.current.key),
          phoneLast4: phone.slice(-4),
          source: verified.source,
          verifiedAt: new Date(),
        },
      });
      const response = this.profileView(changed);
      await this.appendAudit(transaction, session, 'VERIFY', expectedVersion, changed.version,
        requestId, key, ipAddress);
      await this.complete(transaction, claim, changed);
      return response;
    });
  }

  async revokePhone(
    session: CurrentStoreSession,
    expectedVersion: number,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, 'DELETE', ROUTES.revokePhone, {
      expected_version: expectedVersion,
    });
    await this.rejectReplay(claim);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const changed = await this.profileRepository().revokeCurrentPhoneInTransaction(transaction, {
        ...this.identity(session),
        expectedVersion,
      });
      const response = this.profileView(changed);
      await this.appendAudit(transaction, session, 'REVOKE', expectedVersion, changed.version,
        requestId, key, ipAddress);
      await this.complete(transaction, claim, changed);
      return response;
    });
  }

  private assertCurrentPhoneConsent(input: StorePhoneAuthorizationInput): void {
    if (input.consent.accepted !== true || input.consent.type !== 'PHONE_AUTHORIZATION' ||
      input.consent.documentVersion !== this.runtime().store.legalDocuments.phoneAuthorization.version) {
      throw new ApplicationError('CONSENT_VERSION_MISMATCH', 'Store phone consent is not current');
    }
  }

  private identity(session: CurrentStoreSession) {
    return { accountId: session.accountId, customerId: session.customerId };
  }

  private claim(
    actorId: string,
    idempotencyKey: string,
    method: 'DELETE' | 'PATCH' | 'POST',
    route: string,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: { body, method, pathParameters: {}, route },
    };
  }

  private async rejectReplay(claim: IdempotencyClaim): Promise<void> {
    const replay = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      return (await this.idempotency.claim(transaction, claim)).kind === 'replay';
    });
    if (replay) throw sensitiveReplay();
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    action: 'REVOKE' | 'UPDATE' | 'VERIFY',
    beforeVersion: number,
    afterVersion: number,
    requestId: string,
    idempotencyKey: string,
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action,
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { version: afterVersion },
      before: { version: beforeVersion },
      idempotencyKey,
      module: 'privacy',
      objectId: session.customerId,
      objectType: 'customer',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private complete(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    snapshot: StoreProfileSnapshot,
  ) {
    return this.idempotency.complete(transaction, claim, {
      resourceId: snapshot.customerId,
      responseForHash: { customer_id: snapshot.customerId, version: snapshot.version },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  }

  private profileView(snapshot: StoreProfileSnapshot) {
    const phone = snapshot.phone ? this.currentPhone(snapshot) : null;
    return {
      avatar_url: snapshot.avatarUrl,
      city: snapshot.city,
      customer_id: snapshot.customerId,
      nickname: snapshot.nickname,
      phone_masked: phone?.masked ?? null,
      phone_source: snapshot.phone?.source ?? null,
      phone_tail: snapshot.phone?.phoneLast4 ?? null,
      phone_verified_at: snapshot.phone?.verifiedAt.toISOString() ?? null,
      version: snapshot.version,
    };
  }

  private currentPhone(snapshot: StoreProfileSnapshot): { masked: string } {
    const phone = snapshot.phone;
    if (!phone) throw new ApplicationError('INTERNAL_ERROR', 'Current phone is unavailable');
    try {
      return {
        masked: verifyStoredStorePhoneMaterial(
          phone,
          this.runtime().encryption.fieldKeys,
          this.runtime().store.phoneHashKeys,
        ).masked,
      };
    } catch {
      throw new ApplicationError('INTERNAL_ERROR', 'Current account phone is unreadable');
    }
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store profile runtime is unavailable');
    return this.config;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Store profile database is unavailable');
    return this.database;
  }

  private profileRepository(): StoreProfileRepository {
    if (!this.profiles) throw new ApplicationError('INTERNAL_ERROR', 'Store profile repository is unavailable');
    return this.profiles;
  }

  private provider(): StorePhoneProvider {
    if (!this.phoneProvider) throw new ApplicationError('INTERNAL_ERROR', 'Store phone provider is unavailable');
    return this.phoneProvider;
  }
}
