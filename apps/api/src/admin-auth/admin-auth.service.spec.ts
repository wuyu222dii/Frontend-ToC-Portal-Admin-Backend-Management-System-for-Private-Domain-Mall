import { createHmac } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { CurrentAdminSession, DatabaseRuntime } from '@qingxu/database';
import {
  createEncryptionContext,
  encryptEnvelope,
  hmacAuthenticationSecret,
} from '@qingxu/platform-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthService } from './admin-auth.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const FACTOR_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const SESSION_FAMILY = '01J00000000000000000000003';
const WITHDRAWAL_ID = '01J00000000000000000000004';
const NOW = new Date('2026-09-04T01:00:00.000Z');
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value) {
    accumulator = (accumulator << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function currentTotp(secret: string, now: Date): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fff_ffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

function config(): PlatformRuntimeConfig {
  return {
    agent: {} as PlatformRuntimeConfig['agent'],
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-api-test',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: { current: { id: 'secret-v1', key: Buffer.alloc(32, 7) }, previous: [] },
      sessionTtlSeconds: 3_600,
      signingKeys: { current: { id: 'sign-v1', key: Buffer.alloc(32, 8) }, previous: [] },
    },
    banner: { targetOrigins: [] },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank-v1', key: Buffer.alloc(32, 4) }, previous: [] },
      fieldKeys: { current: { id: 'field-v1', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { mockSigningKey: Buffer.alloc(32, 4), provider: 'MOCK', providerTimeoutMs: 5_000 },
    port: 3000,
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    store: {} as PlatformRuntimeConfig['store'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function session(runtimeConfig: PlatformRuntimeConfig): CurrentAdminSession {
  const fieldKey = runtimeConfig.encryption.fieldKeys.current;
  const envelope = encryptEnvelope(TOTP_SECRET, { keyId: fieldKey.id, key: fieldKey.key },
    createEncryptionContext('totp_factor', FACTOR_ID, 'secret_ciphertext'));
  return {
    accountId: ACCOUNT_ID,
    accountVersion: 1,
    accessJti: `access:${'0'.repeat(26)}`,
    expiresAt: new Date(NOW.getTime() + 60 * 60_000),
    factorEncryptionKeyId: fieldKey.id,
    factorId: FACTOR_ID,
    factorLastUsedTimestep: null,
    factorSecretCiphertext: Buffer.from(JSON.stringify(envelope)),
    mfaVerifiedAt: NOW,
    sessionFamily: SESSION_FAMILY,
    sessionId: SESSION_ID,
  };
}

function invalidTotp(now: Date): string {
  const valid = currentTotp(TOTP_SECRET, now);
  return String((Number(valid) + 1) % 1_000_000).padStart(6, '0');
}

interface ServiceInternals {
  auth: {
    createPayoutReauthGrantInTransaction: ReturnType<typeof vi.fn>;
    recordPayoutReauthFailureInTransaction: ReturnType<typeof vi.fn>;
  };
  audit: { append: ReturnType<typeof vi.fn> };
  idempotency: { claim: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn> };
}

function harness() {
  const transaction = {};
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  } as unknown as DatabaseRuntime;
  const runtimeConfig = config();
  const service = new AdminAuthService(runtimeConfig, database);
  const mocks: ServiceInternals = {
    auth: {
      createPayoutReauthGrantInTransaction: vi.fn(async () => undefined),
      recordPayoutReauthFailureInTransaction: vi.fn(),
    },
    audit: { append: vi.fn(async () => undefined) },
    idempotency: {
      claim: vi.fn(async () => ({ kind: 'execute' as const })),
      complete: vi.fn(async () => undefined),
    },
  };
  Object.assign(service as unknown as ServiceInternals, mocks);
  return { mocks, runtimeConfig, service };
}

describe('B13.6 Admin direct REAUTH service boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a purpose-separated, sixty-second, single-use payout grant without persisting its secret', async () => {
    const { mocks, runtimeConfig, service } = harness();
    const response = await service.reauth(session(runtimeConfig), {
      action: 'PAYOUT_ACCOUNT_REVEAL',
      totpCode: currentTotp(TOTP_SECRET, NOW),
      withdrawalId: WITHDRAWAL_ID,
    }, '00000000-0000-4000-8000-000000000001', 'req_b136_success');

    expect(response).toEqual({
      expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
      reauth_grant: expect.stringMatching(/^rag_[A-Za-z0-9_-]{43}$/),
      single_use: true,
      withdrawal_id: WITHDRAWAL_ID,
    });
    const issued = mocks.auth.createPayoutReauthGrantInTransaction.mock.calls[0]?.[1];
    expect(issued).toMatchObject({
      accountId: ACCOUNT_ID,
      currentSessionId: SESSION_ID,
      expiresAt: new Date(NOW.getTime() + 60_000),
      factorId: FACTOR_ID,
      targetId: WITHDRAWAL_ID,
    });
    expect(issued.tokenHash).toBe(hmacAuthenticationSecret(
      response.reauth_grant,
      runtimeConfig.authentication.secretHashKeys.current.key,
      'reauth-grant',
    ));
    const completion = mocks.idempotency.complete.mock.calls[0]?.[2];
    expect(completion).toMatchObject({ responseStatus: 200, storage: 'HASH_ONLY' });
    expect(JSON.stringify(completion)).not.toContain(response.reauth_grant);
  });

  it('returns REAUTH_LOCKED on the fifth direct TOTP failure and records the 15-minute lock result', async () => {
    const { mocks, runtimeConfig, service } = harness();
    mocks.auth.recordPayoutReauthFailureInTransaction.mockImplementation(async () => {
      const attempt = mocks.auth.recordPayoutReauthFailureInTransaction.mock.calls.length;
      return attempt < 5
        ? { failedAttempts: attempt, kind: 'recorded' }
        : { failedAttempts: 5, kind: 'locked', lockedUntil: new Date(NOW.getTime() + 15 * 60_000) };
    });
    const invalidCode = invalidTotp(NOW);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const call = service.reauth(session(runtimeConfig), {
        action: 'PAYOUT_ACCOUNT_REVEAL',
        totpCode: invalidCode,
        withdrawalId: WITHDRAWAL_ID,
      }, `00000000-0000-4000-8000-${String(attempt).padStart(12, '0')}`, `req_b136_failure_${attempt}`);
      await expect(call).rejects.toMatchObject({
        code: attempt === 5 ? 'REAUTH_LOCKED' : 'REAUTH_REQUIRED',
        httpStatus: attempt === 5 ? 429 : 403,
      });
    }

    expect(mocks.auth.recordPayoutReauthFailureInTransaction).toHaveBeenCalledTimes(5);
    expect(mocks.idempotency.complete).toHaveBeenLastCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ responseStatus: 429, storage: 'HASH_ONLY' }));
    expect(mocks.audit.append).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      result: 'FAILURE',
      resultCode: 'REAUTH_LOCKED',
    }));
  });
});
