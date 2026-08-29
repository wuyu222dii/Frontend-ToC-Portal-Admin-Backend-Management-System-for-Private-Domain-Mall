import { describe, expect, it, vi } from 'vitest';

import {
  mockPaymentIntentStateKey,
  mockPaymentRefundStateKey,
  RedisMockPaymentProvider,
  verifyMockPaymentCallback,
} from './mock-payment-provider';
import { MOCK_PAYMENT_STATE_TTL_SECONDS, type PaymentRedisEvalPort } from './types';

const SIGNING_KEY = Buffer.alloc(32, 37);
const INTENT_NO = 'PI01K00000000000000000000000';
const REFUND_NO = 'RF01K00000000000000000000000';
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

    if (script.includes('refund:v1')) {
      if (current) {
        const state = JSON.parse(current) as { request_digest: string };
        return [state.request_digest === options.arguments[0] ? 'EXISTING' : 'CONFLICT', current];
      }
      const state = JSON.parse(options.arguments[1]!) as { occurred_at_ms: number | null };
      state.occurred_at_ms = NOW_MS;
      const encoded = JSON.stringify(state);
      this.values.set(key, encoded);
      this.ttls.set(key, Number(options.arguments[2]));
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
    });

    const intentKey = mockPaymentIntentStateKey(SIGNING_KEY, INTENT_NO);
    const refundKey = mockPaymentRefundStateKey(SIGNING_KEY, REFUND_NO);
    expect(intentKey).toMatch(/^qingxu:payment-mock:v1:intent:[a-f0-9]{64}$/);
    expect(refundKey).toMatch(/^qingxu:payment-mock:v1:refund:[a-f0-9]{64}$/);
    expect(intentKey).not.toContain(INTENT_NO);
    expect(refundKey).not.toContain(REFUND_NO);
    expect(redis.values.get(intentKey)).not.toContain(INTENT_NO);
    expect(redis.values.get(refundKey)).not.toContain(REFUND_NO);
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
