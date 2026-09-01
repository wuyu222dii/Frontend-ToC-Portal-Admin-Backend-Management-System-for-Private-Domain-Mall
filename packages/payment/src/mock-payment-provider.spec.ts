import { describe, expect, it, vi } from 'vitest';

import {
  createSignedMockRefundCallback,
  createSignedMockPaymentSuccessCallback,
  decodeMockRefundCallback,
  mockPaymentIntentStateKey,
  mockPaymentRefundStateKey,
  RedisMockPaymentProvider,
  verifyMockPaymentCallback,
  verifyMockRefundCallback,
} from './mock-payment-provider';
import { MOCK_PAYMENT_STATE_TTL_SECONDS, type PaymentRedisEvalPort } from './types';

const SIGNING_KEY = Buffer.alloc(32, 37);
const INTENT_NO = 'PI01K00000000000000000000000';
const REFUND_NO = 'RF01K00000000000000000000000';
const REFUND_ATTEMPT_ID = '01K00000000000000000000000';
const REFUND_RETRY_ATTEMPT_ID = '01K00000000000000000000001';
const REFUND_OTHER_ATTEMPT_ID = '01K00000000000000000000002';
const EXPIRES_AT = new Date('2026-08-29T12:30:00.000Z');
const NOW_MS = Date.parse('2026-08-29T12:00:00.000Z');

class FakeRedis implements PaymentRedisEvalPort {
  isReady = true;
  readonly calls: Array<{ script: string; options: { arguments: string[]; keys: string[] } }> = [];
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  error: Error | undefined;
  malformed = false;
  pending = false;

  async eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown> {
    this.calls.push({ script, options });
    if (this.error) throw this.error;
    if (this.malformed) return { unsafe: true };
    if (this.pending) return new Promise(() => undefined);
    const key = options.keys[0]!;
    const current = this.values.get(key);

    if (script.includes('create-intent:v1')) {
      if (current) {
        const state = JSON.parse(current) as { request_digest: string };
        return [state.request_digest === options.arguments[0] ? 'EXISTING' : 'CONFLICT', current];
      }
      const proposed = options.arguments[1]!;
      this.values.set(key, proposed);
      this.ttls.set(key, Number(options.arguments[2]));
      return ['CREATED', proposed];
    }

    if (script.includes('query-intent:v1')) {
      if (!current) return ['NOT_FOUND', ''];
      const state = JSON.parse(current) as { provider_intent_id: string };
      if (options.arguments[0] && state.provider_intent_id !== options.arguments[0]) {
        return ['CONFLICT', current];
      }
      this.ttls.set(key, Number(options.arguments[1]));
      return ['FOUND', current];
    }

    if (script.includes('close-intent:v1')) {
      if (!current) return ['NOT_FOUND', ''];
      const state = JSON.parse(current) as { provider_intent_id: string; state: string; occurred_at_ms: number | null };
      if (options.arguments[0] && state.provider_intent_id !== options.arguments[0]) {
        return ['CONFLICT', current];
      }
      if (state.state === 'OPEN') {
        state.state = 'CLOSED';
        state.occurred_at_ms = NOW_MS;
      }
      const encoded = JSON.stringify(state);
      this.values.set(key, encoded);
      this.ttls.set(key, Number(options.arguments[1]));
      return ['CLOSED_OR_TERMINAL', encoded];
    }

    if (script.includes('submit-result:v1')) {
      if (!current) return ['NOT_FOUND', ''];
      const state = JSON.parse(current) as {
        provider_intent_id: string;
        state: string;
        provider_transaction_id: string | null;
        provider_event_id: string | null;
        occurred_at_ms: number | null;
      };
      if (options.arguments[0] && state.provider_intent_id !== options.arguments[0]) {
        return ['CONFLICT', current];
      }
      const target = options.arguments[1]!;
      if (state.state === target) return ['EXISTING', current];
      if (state.state !== 'OPEN' && !(state.state === 'CLOSED' && target === 'SUCCEEDED')) {
        return ['CONFLICT', current];
      }
      state.state = target;
      state.provider_transaction_id = target === 'SUCCEEDED' ? options.arguments[2]! : null;
      state.provider_event_id = options.arguments[3]!;
      state.occurred_at_ms = NOW_MS;
      const encoded = JSON.stringify(state);
      this.values.set(key, encoded);
      this.ttls.set(key, Number(options.arguments[4]));
      return ['UPDATED', encoded];
    }

    if (script.includes('query-refund:v1')) {
      if (!current) return ['NOT_FOUND', ''];
      const state = JSON.parse(current) as { provider_refund_id: string };
      if (options.arguments[0] && state.provider_refund_id !== options.arguments[0]) {
        return ['CONFLICT', current];
      }
      this.ttls.set(key, Number(options.arguments[1]));
      return ['FOUND', current];
    }

    if (script.includes('refund:v2')) {
      if (current) {
        const state = JSON.parse(current) as {
          amount: string;
          attempt_digest?: string;
          provider_refund_id: string;
          request_digest: string;
          state: string;
          version: number;
        };
        if (state.request_digest !== options.arguments[0]) return ['CONFLICT', current];
        if (state.version === 1) {
          return [options.arguments[3] === '1' ? 'EXISTING' : 'CONFLICT', current];
        }
        if (state.version !== 2 || state.attempt_digest === undefined) return ['INVALID', current];
        if (state.attempt_digest === options.arguments[1]) return ['EXISTING', current];
        if (state.state !== 'FAILED') return ['CONFLICT', current];
        const replacement = JSON.parse(options.arguments[2]!) as typeof state & { occurred_at_ms: number | null };
        if (replacement.version !== 2 || replacement.state !== 'SUCCEEDED' ||
          replacement.attempt_digest !== options.arguments[1] || replacement.request_digest !== state.request_digest ||
          replacement.provider_refund_id !== state.provider_refund_id || replacement.amount !== state.amount) {
          return ['CONFLICT', current];
        }
        replacement.occurred_at_ms = NOW_MS;
        const encoded = JSON.stringify(replacement);
        this.values.set(key, encoded);
        this.ttls.set(key, Number(options.arguments[4]));
        return ['UPDATED', encoded];
      }
      const state = JSON.parse(options.arguments[2]!) as { occurred_at_ms: number | null };
      state.occurred_at_ms = NOW_MS;
      const encoded = JSON.stringify(state);
      this.values.set(key, encoded);
      this.ttls.set(key, Number(options.arguments[4]));
      return ['CREATED', encoded];
    }

    throw new Error('Unexpected script');
  }
}

function provider(redis = new FakeRedis(), timeoutMs = 500): RedisMockPaymentProvider {
  return new RedisMockPaymentProvider({ environment: 'test', signingKey: SIGNING_KEY, timeoutMs }, redis);
}

describe('RedisMockPaymentProvider', () => {
  it('uses opaque domain-separated keys and values with a fixed seven-day TTL', async () => {
    const redis = new FakeRedis();
    const payments = provider(redis);
    await payments.create({ intentNo: INTENT_NO, amount: '39.80', expiresAt: EXPIRES_AT });
    await payments.refund({
      refundNo: REFUND_NO,
      providerIntentId: 'mock_pi_provider_reference',
      providerTransactionId: 'mock_tx_provider_reference',
      amount: '39.80',
      providerRequestId: REFUND_ATTEMPT_ID,
    });

    const intentKey = mockPaymentIntentStateKey(SIGNING_KEY, INTENT_NO);
    const refundKey = mockPaymentRefundStateKey(SIGNING_KEY, REFUND_NO);
    expect(intentKey).toMatch(/^qingxu:payment-mock:v1:intent:[a-f0-9]{64}$/);
    expect(refundKey).toMatch(/^qingxu:payment-mock:v1:refund:[a-f0-9]{64}$/);
    expect(intentKey).not.toContain(INTENT_NO);
    expect(refundKey).not.toContain(REFUND_NO);
    expect(redis.values.get(intentKey)).not.toContain(INTENT_NO);
    expect(redis.values.get(refundKey)).not.toContain(REFUND_NO);
    expect(redis.values.get(refundKey)).not.toContain(REFUND_ATTEMPT_ID);
    expect([...redis.values.values()].join('\n')).not.toMatch(/customer|order_id|capability|pay_sign/i);
    expect([...redis.ttls.values()]).toEqual([
      MOCK_PAYMENT_STATE_TTL_SECONDS,
      MOCK_PAYMENT_STATE_TTL_SECONDS,
    ]);
    expect(MOCK_PAYMENT_STATE_TTL_SECONDS).toBe(604_800);
  });

  it('creates and recovers the same external intent after a lost response', async () => {
    const redis = new FakeRedis();
    const payments = provider(redis);
    const input = { intentNo: INTENT_NO, amount: '39.80', expiresAt: EXPIRES_AT };

    const first = await payments.create(input);
    const replay = await payments.create(input);
    const queried = await payments.query({ intentNo: INTENT_NO });

    expect(first).toEqual(replay);
    expect(queried).toEqual(first);
    expect(first).toMatchObject({
      outcome: 'OPEN', capability: null, failureCode: null, providerTransactionId: null,
    });
    expect(first.providerIntentId).toMatch(/^mock_pi_[a-f0-9]{64}$/);
    expect(redis.values).toHaveLength(1);
  });

  it('fails closed when the stable intent number is reused with different immutable facts', async () => {
    const payments = provider();
    await payments.create({ intentNo: INTENT_NO, amount: '39.80', expiresAt: EXPIRES_AT });
    await expect(payments.create({ intentNo: INTENT_NO, amount: '39.81', expiresAt: EXPIRES_AT }))
      .resolves.toMatchObject({ outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH' });
  });

  it('returns NOT_FOUND for an absent state and rejects a mismatched provider identity', async () => {
    const payments = provider();
    await expect(payments.query({ intentNo: INTENT_NO })).resolves.toMatchObject({
      outcome: 'NOT_FOUND', failureCode: null,
    });
    const created = await payments.create({ intentNo: INTENT_NO, amount: '39.80', expiresAt: EXPIRES_AT });
    expect(created.providerIntentId).not.toBeNull();
    await expect(payments.query({ intentNo: INTENT_NO, providerIntentId: 'mock_pi_wrong_reference' }))
      .resolves.toMatchObject({ outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH' });
  });

  it('closes idempotently and permits only a late success after closure', async () => {
    const payments = provider();
    const created = await payments.create({ intentNo: INTENT_NO, amount: '39.80', expiresAt: EXPIRES_AT });
    const input = { intentNo: INTENT_NO, providerIntentId: created.providerIntentId };
    const closed = await payments.close(input);
    const replay = await payments.close(input);
    expect(closed).toEqual(replay);
    expect(closed.outcome).toBe('CLOSED');

    const late = await payments.submitResult({ ...input, result: 'SUCCEEDED' });
    expect(late.submission).toBe('ACCEPTED');
    expect(late.payment).toMatchObject({ outcome: 'SUCCEEDED', failureCode: null });
    expect(late.payment.providerTransactionId).toMatch(/^mock_tx_[a-f0-9]{64}$/);
  });

  it('replays one signed result and rejects a conflicting terminal result', async () => {
    const payments = provider();
    const created = await payments.create({ intentNo: INTENT_NO, amount: '39.80', expiresAt: EXPIRES_AT });
    const input = { intentNo: INTENT_NO, providerIntentId: created.providerIntentId, result: 'FAILED' as const };
    const first = await payments.submitResult(input);
    const replay = await payments.submitResult(input);

    expect(first).toEqual(replay);
    expect(first.submission).toBe('ACCEPTED');
    if (first.submission !== 'ACCEPTED') throw new Error('Expected accepted Mock result');
    expect(first.callback.providerEventId).toMatch(/^mock_ev_[a-f0-9]{64}$/);
    expect(first.callback.payload).toMatchObject({
      outcome: 'FAILED', provider_transaction_id: null, amount: '39.80',
    });
    expect(verifyMockPaymentCallback(first.callback, SIGNING_KEY)).toBe(true);

    const tampered = {
      ...first.callback,
      rawBody: Buffer.from(`${Buffer.from(first.callback.rawBody).toString('utf8')} `, 'utf8'),
    };
    expect(verifyMockPaymentCallback(tampered, SIGNING_KEY)).toBe(false);
    await expect(payments.submitResult({ ...input, result: 'SUCCEEDED' })).resolves.toMatchObject({
      submission: 'CONFLICT', callback: null,
    });
  });

  it('creates a verifiable success callback from a trusted Provider query result', () => {
    const callback = createSignedMockPaymentSuccessCallback(SIGNING_KEY, '39.80', {
      capability: null,
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'SUCCEEDED',
      providerEventId: 'mock_ev_recovered_success',
      providerIntentId: 'mock_pi_recovered_success',
      providerTransactionId: 'mock_tx_recovered_success',
    });

    expect(callback).toMatchObject({
      eventType: 'payment.succeeded',
      payload: {
        amount: '39.80',
        outcome: 'SUCCEEDED',
        provider_event_id: 'mock_ev_recovered_success',
        provider_intent_id: 'mock_pi_recovered_success',
        provider_transaction_id: 'mock_tx_recovered_success',
      },
    });
    expect(verifyMockPaymentCallback(callback, SIGNING_KEY)).toBe(true);
    expect(() => createSignedMockPaymentSuccessCallback(SIGNING_KEY, '39.80', {
      capability: null,
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'SUCCEEDED',
      providerEventId: null,
      providerIntentId: 'mock_pi_recovered_success',
      providerTransactionId: 'mock_tx_recovered_success',
    })).toThrow('success facts are incomplete');
  });

  it('creates exactly one stable successful refund projection', async () => {
    const redis = new FakeRedis();
    const payments = provider(redis);
    const input = {
      refundNo: REFUND_NO,
      providerIntentId: 'mock_pi_provider_reference',
      providerTransactionId: 'mock_tx_provider_reference',
      amount: '39.80',
    };
    const first = await payments.refund(input);
    const replay = await payments.refund(input);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({ outcome: 'SUCCEEDED', failureCode: null });
    expect(first.providerRefundId).toMatch(/^mock_rf_[a-f0-9]{64}$/);
    expect(redis.values).toHaveLength(1);

    await expect(payments.refund({ ...input, amount: '39.79' })).resolves.toMatchObject({
      outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH',
    });
  });

  it('replays a failed attempt exactly and permits only a new attempt to retry it', async () => {
    const redis = new FakeRedis();
    const payments = provider(redis);
    const immutable = {
      amount: '39.80',
      providerIntentId: 'mock_pi_provider_reference',
      providerTransactionId: 'mock_tx_provider_reference',
      refundNo: REFUND_NO,
    };
    const firstInput = { ...immutable, providerRequestId: REFUND_ATTEMPT_ID };
    const first = await payments.refund(firstInput);
    const key = mockPaymentRefundStateKey(SIGNING_KEY, REFUND_NO);
    const failedState = JSON.parse(redis.values.get(key)!) as { state: string };
    failedState.state = 'FAILED';
    redis.values.set(key, JSON.stringify(failedState));

    const sameAttempt = await payments.refund(firstInput);
    expect(sameAttempt).toMatchObject({
      outcome: 'FAILED',
      providerEventId: first.providerEventId,
      providerRefundId: first.providerRefundId,
    });
    await expect(payments.queryRefund({ refundNo: REFUND_NO })).resolves.toEqual(sameAttempt);
    await expect(payments.refund({
      ...immutable,
      amount: '39.79',
      providerRequestId: REFUND_OTHER_ATTEMPT_ID,
    })).resolves.toMatchObject({ outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH' });

    const retry = await payments.refund({ ...immutable, providerRequestId: REFUND_RETRY_ATTEMPT_ID });
    expect(retry).toMatchObject({
      outcome: 'SUCCEEDED',
      providerRefundId: first.providerRefundId,
    });
    expect(retry.providerEventId).not.toBe(first.providerEventId);
    await expect(payments.refund({
      ...immutable,
      providerRequestId: REFUND_OTHER_ATTEMPT_ID,
    })).resolves.toMatchObject({ outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH' });

    const persisted = redis.values.get(key)!;
    expect(persisted).not.toContain(REFUND_NO);
    expect(persisted).not.toContain(REFUND_ATTEMPT_ID);
    expect(persisted).not.toContain(REFUND_RETRY_ATTEMPT_ID);
  });

  it('replays a legacy successful refund only for the B10-compatible request shape', async () => {
    const redis = new FakeRedis();
    const payments = provider(redis);
    const input = {
      amount: '39.80',
      providerIntentId: 'mock_pi_provider_reference',
      providerTransactionId: 'mock_tx_provider_reference',
      refundNo: REFUND_NO,
    };
    const created = await payments.refund(input);
    const key = mockPaymentRefundStateKey(SIGNING_KEY, REFUND_NO);
    const legacy = JSON.parse(redis.values.get(key)!) as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.attempt_digest;
    redis.values.set(key, JSON.stringify(legacy));

    await expect(payments.refund(input)).resolves.toEqual(created);
    await expect(payments.refund({ ...input, providerRequestId: REFUND_ATTEMPT_ID }))
      .resolves.toMatchObject({ outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH' });
  });

  it('queries the same opaque refund state after a lost response and refreshes its TTL', async () => {
    const redis = new FakeRedis();
    const payments = provider(redis);
    await expect(payments.queryRefund({ refundNo: REFUND_NO })).resolves.toMatchObject({
      outcome: 'NOT_FOUND', failureCode: null,
    });
    const created = await payments.refund({
      refundNo: REFUND_NO,
      providerIntentId: 'mock_pi_provider_reference',
      providerTransactionId: 'mock_tx_provider_reference',
      amount: '39.80',
    });
    expect(created.providerRefundId).not.toBeNull();
    const key = mockPaymentRefundStateKey(SIGNING_KEY, REFUND_NO);
    redis.ttls.set(key, 1);

    const recovered = await payments.queryRefund({
      refundNo: REFUND_NO,
      providerRefundId: created.providerRefundId,
    });
    expect(recovered).toEqual(created);
    expect(redis.ttls.get(key)).toBe(MOCK_PAYMENT_STATE_TTL_SECONDS);
    await expect(payments.queryRefund({
      refundNo: REFUND_NO,
      providerRefundId: 'mock_rf_wrong_reference',
    })).resolves.toMatchObject({ outcome: 'UNKNOWN', failureCode: 'REQUEST_MISMATCH' });
    expect(JSON.stringify(redis.calls)).not.toContain(REFUND_NO);
  });

  it('creates and strictly decodes a minimal attempt-bound signed refund callback', () => {
    const callback = createSignedMockRefundCallback(SIGNING_KEY, {
      refundNo: REFUND_NO,
      refundAttemptId: REFUND_ATTEMPT_ID,
      attemptNo: 2,
      amount: '39.80',
    }, {
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'SUCCEEDED',
      providerEventId: 'mock_re_refund_success',
      providerRefundId: 'mock_rf_refund_success',
    });

    expect(decodeMockRefundCallback(callback, SIGNING_KEY)).toEqual(callback.payload);
    expect(verifyMockRefundCallback(callback, SIGNING_KEY)).toBe(true);
    expect(callback).toMatchObject({
      eventType: 'refund.succeeded',
      payload: {
        refund_no: REFUND_NO,
        refund_attempt_id: REFUND_ATTEMPT_ID,
        attempt_no: 2,
        amount: '39.80',
        outcome: 'SUCCEEDED',
      },
    });
    expect(Object.keys(callback.payload).sort()).toEqual([
      'amount', 'attempt_no', 'occurred_at', 'outcome', 'provider_event_id', 'provider_refund_id',
      'refund_attempt_id', 'refund_no', 'version',
    ]);
    expect(Buffer.from(callback.rawBody).toString('utf8')).not.toMatch(
      /customer|order_id|aftersale_id|provider_payload|provider_response/i,
    );
  });

  it('supports a closed failed refund callback and rejects incomplete routing facts', () => {
    const callback = createSignedMockRefundCallback(SIGNING_KEY, {
      refundNo: REFUND_NO,
      refundAttemptId: REFUND_ATTEMPT_ID,
      attemptNo: 1,
      amount: '39.80',
    }, {
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'FAILED',
      providerEventId: 'mock_re_refund_failure',
      providerRefundId: 'mock_rf_refund_failure',
    });
    expect(callback.eventType).toBe('refund.failed');
    expect(verifyMockRefundCallback(callback, SIGNING_KEY)).toBe(true);

    expect(() => createSignedMockRefundCallback(SIGNING_KEY, {
      refundNo: REFUND_NO,
      refundAttemptId: 'not-an-ulid',
      attemptNo: 1,
      amount: '39.80',
    }, {
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'FAILED',
      providerEventId: 'mock_re_refund_failure',
      providerRefundId: 'mock_rf_refund_failure',
    })).toThrow('Refund attempt ID must be a ULID');
    expect(() => createSignedMockRefundCallback(SIGNING_KEY, {
      refundNo: REFUND_NO,
      refundAttemptId: REFUND_ATTEMPT_ID,
      attemptNo: 0,
      amount: '39.80',
    }, {
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'FAILED',
      providerEventId: 'mock_re_refund_failure',
      providerRefundId: 'mock_rf_refund_failure',
    })).toThrow('positive safe integer');
  });

  it('rejects refund callback signature, body, projection and envelope tampering', () => {
    const callback = createSignedMockRefundCallback(SIGNING_KEY, {
      refundNo: REFUND_NO,
      refundAttemptId: REFUND_ATTEMPT_ID,
      attemptNo: 1,
      amount: '39.80',
    }, {
      failureCode: null,
      occurredAt: new Date(NOW_MS),
      outcome: 'SUCCEEDED',
      providerEventId: 'mock_re_refund_success',
      providerRefundId: 'mock_rf_refund_success',
    });

    const wrongSignature = {
      ...callback,
      headers: { ...callback.headers, mock_signature: Buffer.alloc(32, 1).toString('base64') },
    };
    expect(() => decodeMockRefundCallback(wrongSignature, SIGNING_KEY)).toThrow('signature is invalid');
    const bodyWithUnknownFact = {
      ...callback,
      rawBody: Buffer.from(`${Buffer.from(callback.rawBody).toString('utf8').slice(0, -1)},"order_id":"hidden"}`),
    };
    expect(verifyMockRefundCallback(bodyWithUnknownFact, SIGNING_KEY)).toBe(false);
    const mismatchedProjection = {
      ...callback,
      payload: { ...callback.payload, attempt_no: 2 },
    };
    expect(() => decodeMockRefundCallback(mismatchedProjection, SIGNING_KEY)).toThrow('facts do not match');
    expect(verifyMockRefundCallback({ ...callback, eventType: 'refund.failed' }, SIGNING_KEY)).toBe(false);
    expect(verifyMockRefundCallback({ ...callback, extra: true }, SIGNING_KEY)).toBe(false);
  });

  it('maps Redis unavailability, exceptions, malformed data and timeouts to UNKNOWN', async () => {
    const notReady = new FakeRedis();
    notReady.isReady = false;
    await expect(provider(notReady).query({ intentNo: INTENT_NO })).resolves.toMatchObject({
      outcome: 'UNKNOWN', failureCode: 'PROVIDER_UNAVAILABLE',
    });

    const failed = new FakeRedis();
    failed.error = new Error('private Redis failure');
    await expect(provider(failed).query({ intentNo: INTENT_NO })).resolves.toMatchObject({
      outcome: 'UNKNOWN', failureCode: 'PROVIDER_UNAVAILABLE',
    });

    const malformed = new FakeRedis();
    malformed.malformed = true;
    await expect(provider(malformed).query({ intentNo: INTENT_NO })).resolves.toMatchObject({
      outcome: 'UNKNOWN', failureCode: 'INVALID_PROVIDER_STATE',
    });

    vi.useFakeTimers();
    try {
      const pending = new FakeRedis();
      pending.pending = true;
      const result = provider(pending, 100).query({ intentNo: INTENT_NO });
      await vi.advanceTimersByTimeAsync(100);
      await expect(result).resolves.toMatchObject({
        outcome: 'UNKNOWN', failureCode: 'PROVIDER_UNAVAILABLE',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates its environment, key, timeout and command inputs before Redis access', async () => {
    const redis = new FakeRedis();
    expect(() => new RedisMockPaymentProvider({
      environment: 'production' as never, signingKey: SIGNING_KEY, timeoutMs: 500,
    }, redis)).toThrow('restricted to development and test');
    expect(() => new RedisMockPaymentProvider({
      environment: 'test', signingKey: Buffer.alloc(16), timeoutMs: 500,
    }, redis)).toThrow('exactly 32 bytes');
    expect(() => provider(redis, 99)).toThrow('between 100 and 30000');
    await expect(provider(redis).create({ intentNo: 'bad id', amount: '0.00', expiresAt: EXPIRES_AT }))
      .rejects.toThrow('Intent number has an invalid format');
    expect(redis.calls).toHaveLength(0);
  });
});
