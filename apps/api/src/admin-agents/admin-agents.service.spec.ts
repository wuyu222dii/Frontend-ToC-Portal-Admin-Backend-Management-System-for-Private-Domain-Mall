import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { AdminAgentSnapshot, DatabaseRuntime } from '@qingxu/database';
import { describe, expect, it, vi } from 'vitest';

import type { AdminAgentRequestContext } from './admin-agents.request';
import { AdminAgentsService } from './admin-agents.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const agentId = '01J00000000000000000000002';
const factorId = '01J00000000000000000000004';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const occurredAt = new Date('2026-09-02T00:01:00.000Z');

function config(): PlatformRuntimeConfig {
  return {
    agent: {} as PlatformRuntimeConfig['agent'],
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-api-test',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: {
        current: { id: 'auth-secret-v1', key: Buffer.alloc(32, 4) },
        previous: [],
      },
      sessionTtlSeconds: 604_800,
      signingKeys: {
        current: { id: 'auth-signing-v1', key: Buffer.alloc(32, 7) },
        previous: [],
      },
    },
    banner: { targetOrigins: [] },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank-v1', key: Buffer.alloc(32, 5) }, previous: [] },
      fieldKeys: { current: { id: 'field-v1', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { provider: 'MOCK', mockSigningKey: Buffer.alloc(32, 6), providerTimeoutMs: 5_000 },
    port: 3000,
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    store: {} as PlatformRuntimeConfig['store'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function requestContext(): AdminAgentRequestContext {
  return {
    accessSession: {
      accountId,
      accountVersion: 1,
      accessJti: 'access:01J00000000000000000000005',
      expiresAt: new Date('2026-09-02T01:00:00.000Z'),
      factorEncryptionKeyId: 'field-v1',
      factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-09-02T00:00:00.000Z'),
      sessionFamily: '01J00000000000000000000006',
      sessionId,
    },
    principal: {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
    },
    requestId,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function agent(overrides: Partial<AdminAgentSnapshot> = {}): AdminAgentSnapshot {
  return {
    accountAlias: `AGT-${agentId}`,
    accountId: '01J00000000000000000000007',
    accountStatus: 'ACTIVE',
    accountVersion: 1,
    agentNo: `AGT-${agentId}`,
    contactName: 'Agent operator',
    contactPhoneTail: null,
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    id: agentId,
    loginName: 'agent.operator',
    name: 'North region agent',
    productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
    status: 'ACTIVE',
    updatedAt: new Date('2026-09-02T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

interface ServiceInternals {
  agents: {
    createAgentInTransaction: ReturnType<typeof vi.fn>;
    disableAgentInTransaction: ReturnType<typeof vi.fn>;
    getAgentDetail: ReturnType<typeof vi.fn>;
    getDisableImpactInTransaction: ReturnType<typeof vi.fn>;
    getPasswordResetImpactInTransaction: ReturnType<typeof vi.fn>;
    reactivateAgentInTransaction: ReturnType<typeof vi.fn>;
    resetAgentPasswordInTransaction: ReturnType<typeof vi.fn>;
  };
  audit: { append: ReturnType<typeof vi.fn> };
  config: PlatformRuntimeConfig;
  database: DatabaseRuntime;
  idempotency: {
    assertHashOnlyReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    commandReplay: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  previews: {
    consumeInTransaction: ReturnType<typeof vi.fn>;
    issueInTransaction: ReturnType<typeof vi.fn>;
  };
}

function fixture(claims: unknown[] = [{ kind: 'execute' }]) {
  const transaction = { marker: 'admin-agent-transaction' };
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  } as unknown as DatabaseRuntime;
  const service = new AdminAgentsService();
  const internals = service as unknown as ServiceInternals;
  internals.config = config();
  internals.database = database;
  const claim = vi.fn();
  for (const result of claims) claim.mockResolvedValueOnce(result);
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.idempotency = {
    assertHashOnlyReplay: vi.fn(),
    claim,
    commandReplay: vi.fn(),
    complete: vi.fn().mockResolvedValue({}),
  };
  internals.outbox = { append: vi.fn().mockResolvedValue({}) };
  internals.previews = {
    consumeInTransaction: vi.fn().mockResolvedValue(undefined),
    issueInTransaction: vi.fn().mockResolvedValue({
      confirmationHash: 'a'.repeat(64),
      expiresAt: new Date('2026-09-02T00:02:00.000Z'),
    }),
  };
  internals.agents = {
    createAgentInTransaction: vi.fn().mockImplementation(
      async (_transaction: unknown, input: { agentId: string; agentNo: string; inviteCodeId: string }) => ({
        agent: agent({ accountAlias: input.agentNo, agentNo: input.agentNo, id: input.agentId }),
        initialInviteCode: {
          codeMasked: '****CODE',
          expiresAt: null,
          id: input.inviteCodeId,
          status: 'ACTIVE',
          version: 1,
        },
      }),
    ),
    disableAgentInTransaction: vi.fn().mockResolvedValue({
      accountVersion: 2,
      agent: agent({ accountStatus: 'DISABLED', accountVersion: 2, status: 'DISABLED', version: 2 }),
      occurredAt,
      revokedSessionCount: 2,
    }),
    getAgentDetail: vi.fn().mockResolvedValue({ agent: agent() }),
    getDisableImpactInTransaction: vi.fn().mockResolvedValue({
      activeCandidateCount: 3,
      activeInviteCount: 1,
      activeSessionCount: 2,
      agent: agent(),
      pendingPaymentOrderCount: 4,
    }),
    getPasswordResetImpactInTransaction: vi.fn().mockResolvedValue({
      activeSessionCount: 2,
      agent: agent(),
    }),
    reactivateAgentInTransaction: vi.fn().mockResolvedValue({
      accountVersion: 3,
      agent: agent({ accountStatus: 'ACTIVE', accountVersion: 3, status: 'ACTIVE', version: 3 }),
      occurredAt: new Date('2026-09-02T00:03:00.000Z'),
      revokedSessionCount: 0,
    }),
    resetAgentPasswordInTransaction: vi.fn().mockResolvedValue({
      accountVersion: 2,
      agent: agent({ accountVersion: 2, version: 2 }),
      occurredAt,
      revokedSessionCount: 2,
    }),
  };
  return { internals, service, transaction };
}

const createInput = {
  contactName: 'Agent operator',
  contactPhone: null,
  loginName: 'agent.operator',
  name: 'North region agent',
  productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS' as const,
};

const confirmationInput = {
  confirmationHash: 'b'.repeat(64),
  previewToken: `pvw_${'c'.repeat(43)}`,
  reason: 'Approved lifecycle action',
};

describe('AdminAgentsService B13.1 orchestration', () => {
  it('creates an Agent with first-issue secrets while persisting only hashes and a HASH_ONLY fact', async () => {
    const f = fixture();
    const result = await f.service.create(requestContext(), createInput, idempotencyKey);

    expect(result).toMatchObject({
      agent: { status: 'ACTIVE', version: 1 },
      disclosure_state: 'FIRST_ISSUE',
      must_change_password: true,
      reissue_required: false,
    });
    expect(result.temporary_password).toMatch(/^Tmp!9[A-Za-z0-9_-]+$/);
    expect(result.initial_invite_code?.code).toMatch(/^AGT-[A-Za-z0-9_-]+$/);
    expect(result.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const createCall = f.internals.agents.createAgentInTransaction.mock.calls[0];
    const persisted = createCall?.[1] as {
      inviteCode: { ciphertext: Uint8Array; codeHash: string };
      passwordHash: string;
    };
    expect(createCall?.[0]).toBe(f.transaction);
    expect(persisted.passwordHash).toMatch(/^\$argon2id\$/);
    expect(persisted.passwordHash).not.toBe(result.temporary_password);
    expect(persisted.inviteCode.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.inviteCode.codeHash).not.toBe(result.initial_invite_code?.code);
    expect(Buffer.from(persisted.inviteCode.ciphertext).toString('utf8'))
      .not.toContain(result.initial_invite_code?.code ?? 'missing');

    const completion = f.internals.idempotency.complete.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(completion).toMatchObject({ responseStatus: 201, storage: 'HASH_ONLY' });
    expect(completion).not.toHaveProperty('responseBody');
    expect(JSON.stringify(completion)).not.toContain(result.temporary_password ?? 'missing');
    expect(JSON.stringify(completion)).not.toContain(result.initial_invite_code?.code ?? 'missing');
    expect(f.internals.idempotency.claim).toHaveBeenCalledBefore(f.internals.agents.createAgentInTransaction);
    expect(f.internals.agents.createAgentInTransaction).toHaveBeenCalledBefore(f.internals.audit.append);
    expect(f.internals.audit.append).toHaveBeenCalledBefore(f.internals.outbox.append);
    expect(f.internals.outbox.append).toHaveBeenCalledBefore(f.internals.idempotency.complete);
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'CREATE', module: 'agent', objectType: 'agent', result: 'SUCCESS',
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      aggregateType: 'agent', eventType: 'agent.created',
    }));
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(), completion);
  });

  it('starts the create disclosure handoff window only after the transaction completes', async () => {
    const startedAt = new Date('2026-09-02T00:00:00.000Z');
    const committedAt = new Date('2026-09-02T00:02:00.000Z');
    vi.useFakeTimers({ now: startedAt, toFake: ['Date'] });
    try {
      const f = fixture();
      f.internals.idempotency.complete.mockImplementationOnce(async () => {
        vi.setSystemTime(committedAt);
        return {};
      });

      const result = await f.service.create(requestContext(), createInput, idempotencyKey);

      expect(result.expires_at).toBe('2026-09-02T00:12:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns only a redacted Agent resource on HASH_ONLY create replay', async () => {
    const f = fixture([{ kind: 'replay', record: { resource_id: agentId } }]);

    const result = await f.service.create(requestContext(), createInput, idempotencyKey);

    expect(result).toMatchObject({
      agent: { agent_id: agentId },
      disclosure_state: 'REPLAY_REDACTED',
      expires_at: null,
      initial_invite_code: null,
      reissue_required: true,
      temporary_password: null,
    });
    expect(f.internals.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(
      expect.objectContaining({ resource_id: agentId }),
      {
        resourceId: agentId,
        responseForHash: { agent_id: agentId, disclosure_state: 'FIRST_ISSUE' },
        responseStatus: 201,
        storage: 'HASH_ONLY',
      },
    );
    expect(f.internals.agents.getAgentDetail).toHaveBeenCalledWith(agentId);
    expect(f.internals.agents.createAgentInTransaction).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.outbox.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('binds disable preview and confirmation, then commits disable, audit, Outbox and idempotency together', async () => {
    const f = fixture([{ kind: 'execute' }, { kind: 'execute' }]);
    const request = requestContext();
    const preview = await f.service.previewDisable(request, agentId, {
      reason: confirmationInput.reason,
      targetStatus: 'DISABLED',
    }, idempotencyKey);
    const disabled = await f.service.disable(request, agentId, {
      confirmationHash: preview.confirmation_hash,
      previewToken: preview.preview_token,
      reason: confirmationInput.reason,
      targetStatus: 'DISABLED',
    }, 1, '00000000-0000-4000-8000-000000000001');

    expect(f.internals.previews.issueInTransaction).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'AGENT.DISABLE',
      actorId: accountId,
      request: { reason: confirmationInput.reason, target_status: 'DISABLED' },
      resourceVersion: 1,
      sessionId,
      targetId: agentId,
      targetType: 'AGENT',
    }));
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledWith(f.transaction, {
      action: 'AGENT.DISABLE',
      actorId: accountId,
      confirmationHash: preview.confirmation_hash,
      previewToken: preview.preview_token,
      request: { reason: confirmationInput.reason, target_status: 'DISABLED' },
      resourceVersion: 1,
      sessionId,
      targetId: agentId,
      targetType: 'AGENT',
    });
    expect(disabled.envelope.data).toMatchObject({
      resource_id: agentId, resource_type: 'agent', status: 'DISABLED', version: 2,
    });
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledBefore(
      f.internals.agents.disableAgentInTransaction,
    );
    expect(f.internals.agents.disableAgentInTransaction).toHaveBeenCalledBefore(f.internals.audit.append);
    expect(f.internals.audit.append).toHaveBeenCalledBefore(f.internals.outbox.append);
    expect(f.internals.outbox.append.mock.invocationCallOrder[0])
      .toBeLessThan(f.internals.idempotency.complete.mock.invocationCallOrder[1] as number);
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'DISABLE',
      after: { status: 'DISABLED', version: 2 },
      before: { status: 'ACTIVE', version: 1 },
      reason: confirmationInput.reason,
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'agent.disabled', payload: expect.objectContaining({ resource_version: 2 }),
    }));
    const previewCompletion = f.internals.idempotency.complete.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(previewCompletion).toMatchObject({ resourceId: agentId, responseStatus: 200, storage: 'HASH_ONLY' });
    expect(JSON.stringify(previewCompletion)).not.toContain(preview.preview_token);
    expect(f.internals.idempotency.complete).toHaveBeenNthCalledWith(2, f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'COMMAND_RESPONSE', responseStatus: 200, storage: 'CACHEABLE' }));
  });

  it('reactivates a disabled Agent and records the ACTIVE state transition in one transaction', async () => {
    const f = fixture();
    const result = await f.service.reactivate(requestContext(), agentId, 2, idempotencyKey);

    expect(result.envelope.data).toMatchObject({ status: 'ACTIVE', version: 3 });
    expect(f.internals.agents.reactivateAgentInTransaction)
      .toHaveBeenCalledWith(f.transaction, { agentId, expectedVersion: 2 });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'ENABLE',
      after: { status: 'ACTIVE', version: 3 },
      before: { status: 'DISABLED', version: 2 },
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'agent.reactivated', payload: expect.objectContaining({ resource_version: 3 }),
    }));
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'COMMAND_RESPONSE', responseStatus: 200, storage: 'CACHEABLE' }));
  });

  it('resets a password once, discloses the temporary password once and stores only a HASH_ONLY fact', async () => {
    const f = fixture();
    const result = await f.service.resetPassword(requestContext(), agentId, confirmationInput, 1, idempotencyKey);

    expect(result).toMatchObject({
      agent: { agent_id: agentId, version: 2 },
      disclosure_state: 'FIRST_ISSUE',
      must_change_password: true,
      reissue_required: false,
    });
    expect(result.temporary_password).toMatch(/^Tmp!9[A-Za-z0-9_-]+$/);
    expect(result.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledWith(f.transaction, {
      action: 'AGENT.PASSWORD_RESET',
      actorId: accountId,
      confirmationHash: confirmationInput.confirmationHash,
      previewToken: confirmationInput.previewToken,
      request: { reason: confirmationInput.reason },
      resourceVersion: 1,
      sessionId,
      targetId: agentId,
      targetType: 'AGENT',
    });
    const resetCall = f.internals.agents.resetAgentPasswordInTransaction.mock.calls[0];
    const persisted = resetCall?.[1] as { passwordHash: string };
    expect(resetCall?.[0]).toBe(f.transaction);
    expect(persisted.passwordHash).toMatch(/^\$argon2id\$/);
    expect(persisted.passwordHash).not.toBe(result.temporary_password);
    const completion = f.internals.idempotency.complete.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(completion).toEqual({
      resourceId: agentId,
      responseForHash: { agent_id: agentId, disclosure_state: 'FIRST_ISSUE', operation: 'PASSWORD_RESET' },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(JSON.stringify(completion)).not.toContain(result.temporary_password ?? 'missing');
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledBefore(
      f.internals.agents.resetAgentPasswordInTransaction,
    );
    expect(f.internals.agents.resetAgentPasswordInTransaction).toHaveBeenCalledBefore(f.internals.audit.append);
    expect(f.internals.audit.append).toHaveBeenCalledBefore(f.internals.outbox.append);
    expect(f.internals.outbox.append).toHaveBeenCalledBefore(f.internals.idempotency.complete);
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'RESET', reason: confirmationInput.reason,
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'agent.password_reset',
    }));
  });

  it('starts the password-reset disclosure handoff window only after the transaction completes', async () => {
    const startedAt = new Date('2026-09-02T00:00:00.000Z');
    const committedAt = new Date('2026-09-02T00:03:00.000Z');
    vi.useFakeTimers({ now: startedAt, toFake: ['Date'] });
    try {
      const f = fixture();
      f.internals.idempotency.complete.mockImplementationOnce(async () => {
        vi.setSystemTime(committedAt);
        return {};
      });

      const result = await f.service.resetPassword(
        requestContext(), agentId, confirmationInput, 1, idempotencyKey,
      );

      expect(result.expires_at).toBe('2026-09-02T00:13:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a redacted resource and performs no reset side effect on HASH_ONLY password-reset replay', async () => {
    const f = fixture([{ kind: 'replay', record: { resource_id: agentId } }]);

    const result = await f.service.resetPassword(requestContext(), agentId, confirmationInput, 1, idempotencyKey);

    expect(result).toMatchObject({
      agent: { agent_id: agentId },
      disclosure_state: 'REPLAY_REDACTED',
      expires_at: null,
      reissue_required: true,
      temporary_password: null,
    });
    expect(f.internals.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(
      expect.objectContaining({ resource_id: agentId }),
      {
        resourceId: agentId,
        responseForHash: { agent_id: agentId, disclosure_state: 'FIRST_ISSUE', operation: 'PASSWORD_RESET' },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      },
    );
    expect(f.internals.agents.getAgentDetail).toHaveBeenCalledWith(agentId);
    expect(f.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(f.internals.agents.resetAgentPasswordInTransaction).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.outbox.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('binds password-reset preview to the Agent action, target, session and current version', async () => {
    const f = fixture();
    const result = await f.service.previewPasswordReset(
      requestContext(), agentId, { reason: confirmationInput.reason }, idempotencyKey,
    );

    expect(result).toMatchObject({ confirmation_hash: 'a'.repeat(64), resource_etag: '"1"' });
    expect(f.internals.previews.issueInTransaction).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'AGENT.PASSWORD_RESET',
      actorId: accountId,
      request: { reason: confirmationInput.reason },
      resourceVersion: 1,
      sessionId,
      targetId: agentId,
      targetType: 'AGENT',
    }));
    const completion = f.internals.idempotency.complete.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(completion).toMatchObject({ resourceId: agentId, responseStatus: 200, storage: 'HASH_ONLY' });
    expect(completion).not.toHaveProperty('responseBody');
    expect(JSON.stringify(completion)).not.toContain(result.preview_token);
  });
});
