import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  MOCK_PAYMENT_STATE_TTL_SECONDS,
  type CreatePaymentIntentInput,
  type LocatePaymentIntentInput,
  type MockPaymentCallback,
  type MockPaymentCallbackPayload,
  type MockPaymentProviderConfig,
  type MockPaymentResultPort,
  type PaymentProviderFailureCode,
  type PaymentProviderIntentResult,
  type PaymentProviderOutcome,
  type PaymentProviderPort,
  type PaymentProviderRefundResult,
  type PaymentRedisEvalPort,
  type RefundPaymentInput,
  type SubmitMockPaymentResult,
  type SubmitMockPaymentResultInput,
} from './types';

const CREATE_INTENT_SCRIPT = `-- qingxu:payment-mock:create-intent:v1
local current = redis.call('GET', KEYS[1])
if current then
  local ok, state = pcall(cjson.decode, current)
  if not ok then return {'INVALID', current} end
  if state.kind ~= 'PAYMENT' or state.request_digest ~= ARGV[1] then
    return {'CONFLICT', current}
  end
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return {'EXISTING', current}
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return {'CREATED', ARGV[2]}
`;

const QUERY_INTENT_SCRIPT = `-- qingxu:payment-mock:query-intent:v1
local current = redis.call('GET', KEYS[1])
if not current then return {'NOT_FOUND', ''} end
local ok, state = pcall(cjson.decode, current)
if not ok or state.kind ~= 'PAYMENT' then return {'INVALID', current} end
if ARGV[1] ~= '' and state.provider_intent_id ~= ARGV[1] then
  return {'CONFLICT', current}
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return {'FOUND', current}
`;

const CLOSE_INTENT_SCRIPT = `-- qingxu:payment-mock:close-intent:v1
local current = redis.call('GET', KEYS[1])
if not current then return {'NOT_FOUND', ''} end
local ok, state = pcall(cjson.decode, current)
if not ok or state.kind ~= 'PAYMENT' then return {'INVALID', current} end
if ARGV[1] ~= '' and state.provider_intent_id ~= ARGV[1] then
  return {'CONFLICT', current}
end
if state.state == 'OPEN' then
  local redis_time = redis.call('TIME')
  state.state = 'CLOSED'
  state.occurred_at_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
  current = cjson.encode(state)
  redis.call('SET', KEYS[1], current, 'EX', ARGV[2])
else
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return {'CLOSED_OR_TERMINAL', current}
`;

const SUBMIT_RESULT_SCRIPT = `-- qingxu:payment-mock:submit-result:v1
local current = redis.call('GET', KEYS[1])
if not current then return {'NOT_FOUND', ''} end
local ok, state = pcall(cjson.decode, current)
if not ok or state.kind ~= 'PAYMENT' then return {'INVALID', current} end
if ARGV[1] ~= '' and state.provider_intent_id ~= ARGV[1] then
  return {'CONFLICT', current}
end
local target = ARGV[2]
if state.state == target then
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  return {'EXISTING', current}
end
if state.state ~= 'OPEN' and not (state.state == 'CLOSED' and target == 'SUCCEEDED') then
  return {'CONFLICT', current}
end
local redis_time = redis.call('TIME')
state.state = target
state.provider_transaction_id = cjson.null
if target == 'SUCCEEDED' then state.provider_transaction_id = ARGV[3] end
state.provider_event_id = ARGV[4]
state.occurred_at_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
current = cjson.encode(state)
redis.call('SET', KEYS[1], current, 'EX', ARGV[5])
return {'UPDATED', current}
`;

const REFUND_SCRIPT = `-- qingxu:payment-mock:refund:v1
local current = redis.call('GET', KEYS[1])
if current then
  local ok, state = pcall(cjson.decode, current)
  if not ok then return {'INVALID', current} end
  if state.kind ~= 'REFUND' or state.request_digest ~= ARGV[1] then
    return {'CONFLICT', current}
  end
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return {'EXISTING', current}
end
local state = cjson.decode(ARGV[2])
local redis_time = redis.call('TIME')
state.occurred_at_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
current = cjson.encode(state)
redis.call('SET', KEYS[1], current, 'EX', ARGV[3])
return {'CREATED', current}
`;

const EVAL_FAILURE = Symbol('payment-provider-eval-failure');
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SAFE_MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const PAYMENT_STATES = new Set<PaymentProviderOutcome>([
  'OPEN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'CLOSED',
]);

interface StoredPaymentState {
  kind: 'PAYMENT';
  version: 1;
  request_digest: string;
  provider_intent_id: string;
  state: 'OPEN' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'CLOSED';
  amount: string;
  expires_at_ms: number;
  provider_transaction_id: string | null;
  provider_event_id: string | null;
  occurred_at_ms: number | null;
}

interface StoredRefundState {
  kind: 'REFUND';
  version: 1;
  request_digest: string;
  provider_refund_id: string;
  state: 'SUCCEEDED';
  amount: string;
  provider_event_id: string;
  occurred_at_ms: number | null;
}

function exactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === fields.length && Object.keys(value).every((key) => fields.includes(key));
}

function redisText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return undefined;
}

function redisTuple(value: unknown): { tag: string; body: string } | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const tag = redisText(value[0]);
  const body = redisText(value[1]);
  return tag === undefined || body === undefined ? undefined : { tag, body };
}

function validMilliseconds(value: unknown, nullable: boolean): value is number | null {
  return (nullable && value === null) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function parsePaymentState(body: string): StoredPaymentState | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  const fields = [
    'kind', 'version', 'request_digest', 'provider_intent_id', 'state', 'amount', 'expires_at_ms',
    'provider_transaction_id', 'provider_event_id', 'occurred_at_ms',
  ];
  if (!exactRecord(value, fields) || value.kind !== 'PAYMENT' || value.version !== 1 ||
    typeof value.request_digest !== 'string' || !HEX_64.test(value.request_digest) ||
    typeof value.provider_intent_id !== 'string' || !SAFE_REFERENCE.test(value.provider_intent_id) ||
    typeof value.state !== 'string' || !PAYMENT_STATES.has(value.state as PaymentProviderOutcome) ||
    typeof value.amount !== 'string' || !SAFE_MONEY.test(value.amount) ||
    !validMilliseconds(value.expires_at_ms, false) ||
    (value.provider_transaction_id !== null &&
      (typeof value.provider_transaction_id !== 'string' || !SAFE_REFERENCE.test(value.provider_transaction_id))) ||
    (value.provider_event_id !== null &&
      (typeof value.provider_event_id !== 'string' || !SAFE_REFERENCE.test(value.provider_event_id))) ||
    !validMilliseconds(value.occurred_at_ms, true)) {
    return undefined;
  }
  return value as unknown as StoredPaymentState;
}

function parseRefundState(body: string): StoredRefundState | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  const fields = [
    'kind', 'version', 'request_digest', 'provider_refund_id', 'state', 'amount',
    'provider_event_id', 'occurred_at_ms',
  ];
  if (!exactRecord(value, fields) || value.kind !== 'REFUND' || value.version !== 1 ||
    typeof value.request_digest !== 'string' || !HEX_64.test(value.request_digest) ||
    typeof value.provider_refund_id !== 'string' || !SAFE_REFERENCE.test(value.provider_refund_id) ||
    value.state !== 'SUCCEEDED' || typeof value.amount !== 'string' || !SAFE_MONEY.test(value.amount) ||
    typeof value.provider_event_id !== 'string' || !SAFE_REFERENCE.test(value.provider_event_id) ||
    !validMilliseconds(value.occurred_at_ms, true)) {
    return undefined;
  }
  return value as unknown as StoredRefundState;
}

function keyBuffer(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    throw new TypeError('Mock payment signing key must contain exactly 32 bytes');
  }
  return Buffer.from(key);
}

function hmacHex(key: Uint8Array, domain: string, ...parts: readonly string[]): string {
  const hmac = createHmac('sha256', keyBuffer(key)).update(`qingxu:payment-mock:${domain}:v1\0`, 'utf8');
  for (const part of parts) hmac.update(part, 'utf8').update('\0', 'utf8');
  return hmac.digest('hex');
}

function reference(value: string, label: string): string {
  if (!SAFE_REFERENCE.test(value)) throw new TypeError(`${label} has an invalid format`);
  return value;
}

function money(value: string): string {
  if (!SAFE_MONEY.test(value) || BigInt(value.replace('.', '')) < 1n) {
    throw new TypeError('Payment amount must be a positive two-decimal value');
  }
  return value;
}

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} must be valid`);
  return value;
}

function providerReference(key: Uint8Array, prefix: string, domain: string, value: string): string {
  return `${prefix}${hmacHex(key, domain, value)}`;
}

export function mockPaymentIntentStateKey(signingKey: Uint8Array, intentNo: string): string {
  return `qingxu:payment-mock:v1:intent:${hmacHex(signingKey, 'intent-key', reference(intentNo, 'Intent number'))}`;
}

export function mockPaymentRefundStateKey(signingKey: Uint8Array, refundNo: string): string {
  return `qingxu:payment-mock:v1:refund:${hmacHex(signingKey, 'refund-key', reference(refundNo, 'Refund number'))}`;
}

function unknownPayment(failureCode: PaymentProviderFailureCode): PaymentProviderIntentResult {
  return {
    outcome: 'UNKNOWN', providerIntentId: null, providerTransactionId: null, providerEventId: null,
    occurredAt: null, failureCode, capability: null,
  };
}

function unknownRefund(failureCode: PaymentProviderFailureCode): PaymentProviderRefundResult {
  return { outcome: 'UNKNOWN', providerRefundId: null, providerEventId: null, occurredAt: null, failureCode };
}

function paymentResult(state: StoredPaymentState): PaymentProviderIntentResult {
  return {
    outcome: state.state,
    providerIntentId: state.provider_intent_id,
    providerTransactionId: state.provider_transaction_id,
    providerEventId: state.provider_event_id,
    occurredAt: state.occurred_at_ms === null ? null : new Date(state.occurred_at_ms),
    failureCode: null,
    capability: null,
  };
}

function refundResult(state: StoredRefundState): PaymentProviderRefundResult {
  return {
    outcome: state.state,
    providerRefundId: state.provider_refund_id,
    providerEventId: state.provider_event_id,
    occurredAt: state.occurred_at_ms === null ? null : new Date(state.occurred_at_ms),
    failureCode: null,
  };
}

function notFoundPayment(): PaymentProviderIntentResult {
  return {
    outcome: 'NOT_FOUND', providerIntentId: null, providerTransactionId: null, providerEventId: null,
    occurredAt: null, failureCode: null, capability: null,
  };
}

function callbackSignature(key: Uint8Array, timestamp: string, rawBody: Uint8Array): Buffer {
  return createHmac('sha256', keyBuffer(key))
    .update('qingxu:payment-mock:event-signature:v1\0', 'utf8')
    .update(timestamp, 'ascii')
    .update('\0', 'utf8')
    .update(rawBody)
    .digest();
}

function callbackFor(state: StoredPaymentState): MockPaymentCallback | undefined {
  if (state.state !== 'SUCCEEDED' && state.state !== 'FAILED' && state.state !== 'CANCELLED') return undefined;
  if (!state.provider_event_id || state.occurred_at_ms === null) return undefined;
  const payload: MockPaymentCallbackPayload = {
    version: 1,
    provider_event_id: state.provider_event_id,
    provider_intent_id: state.provider_intent_id,
    provider_transaction_id: state.provider_transaction_id,
    outcome: state.state,
    amount: state.amount,
    occurred_at: new Date(state.occurred_at_ms).toISOString(),
  };
  const eventType = state.state === 'SUCCEEDED'
    ? 'payment.succeeded'
    : state.state === 'FAILED' ? 'payment.failed' : 'payment.cancelled';
  return {
    eventType,
    providerEventId: state.provider_event_id,
    rawBody: Buffer.from(JSON.stringify(payload), 'utf8'),
    headers: { mock_signature: '', mock_timestamp: String(state.occurred_at_ms) },
    payload,
  };
}

export function verifyMockPaymentCallback(callback: MockPaymentCallback, signingKey: Uint8Array): boolean {
  try {
    if (!(callback.rawBody instanceof Uint8Array) || callback.providerEventId !== callback.payload.provider_event_id ||
      callback.headers.mock_timestamp !== String(Date.parse(callback.payload.occurred_at)) ||
      Buffer.from(callback.rawBody).toString('utf8') !== JSON.stringify(callback.payload)) return false;
    const expectedEventType = callback.payload.outcome === 'SUCCEEDED'
      ? 'payment.succeeded'
      : callback.payload.outcome === 'FAILED' ? 'payment.failed' : 'payment.cancelled';
    if (callback.eventType !== expectedEventType) return false;
    const actual = Buffer.from(callback.headers.mock_signature, 'base64');
    const expected = callbackSignature(signingKey, callback.headers.mock_timestamp, callback.rawBody);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export class RedisMockPaymentProvider implements PaymentProviderPort, MockPaymentResultPort {
  private readonly signingKey: Buffer;
  private readonly timeoutMs: number;

  constructor(config: MockPaymentProviderConfig, private readonly redis: PaymentRedisEvalPort) {
    if (config.environment !== 'development' && config.environment !== 'test') {
      throw new TypeError('Mock payment provider is restricted to development and test');
    }
    this.signingKey = keyBuffer(config.signingKey);
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000) {
      throw new TypeError('Payment provider timeout must be between 100 and 30000 milliseconds');
    }
    this.timeoutMs = config.timeoutMs;
  }

  async create(input: CreatePaymentIntentInput): Promise<PaymentProviderIntentResult> {
    const intentNo = reference(input.intentNo, 'Intent number');
    const amount = money(input.amount);
    const expiresAt = validDate(input.expiresAt, 'Payment expiry');
    const requestDigest = hmacHex(this.signingKey, 'intent-request', intentNo, amount, String(expiresAt.getTime()));
    const proposed: StoredPaymentState = {
      kind: 'PAYMENT',
      version: 1,
      request_digest: requestDigest,
      provider_intent_id: providerReference(this.signingKey, 'mock_pi_', 'provider-intent-id', intentNo),
      state: 'OPEN',
      amount,
      expires_at_ms: expiresAt.getTime(),
      provider_transaction_id: null,
      provider_event_id: null,
      occurred_at_ms: null,
    };
    const evaluated = await this.evaluate(CREATE_INTENT_SCRIPT, {
      keys: [mockPaymentIntentStateKey(this.signingKey, intentNo)],
      arguments: [requestDigest, JSON.stringify(proposed), String(MOCK_PAYMENT_STATE_TTL_SECONDS)],
    });
    if (evaluated === EVAL_FAILURE) return unknownPayment('PROVIDER_UNAVAILABLE');
    const tuple = redisTuple(evaluated);
    if (!tuple) return unknownPayment('INVALID_PROVIDER_STATE');
    if (tuple.tag === 'CONFLICT') return unknownPayment('REQUEST_MISMATCH');
    if (tuple.tag !== 'CREATED' && tuple.tag !== 'EXISTING') {
      return unknownPayment('INVALID_PROVIDER_STATE');
    }
    const state = parsePaymentState(tuple.body);
    return state ? paymentResult(state) : unknownPayment('INVALID_PROVIDER_STATE');
  }

  async query(input: LocatePaymentIntentInput): Promise<PaymentProviderIntentResult> {
    const normalized = this.locate(input);
    const evaluated = await this.evaluate(QUERY_INTENT_SCRIPT, {
      keys: [mockPaymentIntentStateKey(this.signingKey, normalized.intentNo)],
      arguments: [normalized.providerIntentId ?? '', String(MOCK_PAYMENT_STATE_TTL_SECONDS)],
    });
    return this.readIntentResult(evaluated, new Set(['FOUND']));
  }

  async close(input: LocatePaymentIntentInput): Promise<PaymentProviderIntentResult> {
    const normalized = this.locate(input);
    const evaluated = await this.evaluate(CLOSE_INTENT_SCRIPT, {
      keys: [mockPaymentIntentStateKey(this.signingKey, normalized.intentNo)],
      arguments: [normalized.providerIntentId ?? '', String(MOCK_PAYMENT_STATE_TTL_SECONDS)],
    });
    return this.readIntentResult(evaluated, new Set(['CLOSED_OR_TERMINAL']));
  }

  async refund(input: RefundPaymentInput): Promise<PaymentProviderRefundResult> {
    const refundNo = reference(input.refundNo, 'Refund number');
    const providerIntentId = reference(input.providerIntentId, 'Provider intent ID');
    const providerTransactionId = reference(input.providerTransactionId, 'Provider transaction ID');
    const amount = money(input.amount);
    const requestDigest = hmacHex(
      this.signingKey, 'refund-request', refundNo, providerIntentId, providerTransactionId, amount,
    );
    const proposed: StoredRefundState = {
      kind: 'REFUND',
      version: 1,
      request_digest: requestDigest,
      provider_refund_id: providerReference(this.signingKey, 'mock_rf_', 'provider-refund-id', refundNo),
      state: 'SUCCEEDED',
      amount,
      provider_event_id: providerReference(this.signingKey, 'mock_re_', 'refund-event-id', refundNo),
      occurred_at_ms: null,
    };
    const evaluated = await this.evaluate(REFUND_SCRIPT, {
      keys: [mockPaymentRefundStateKey(this.signingKey, refundNo)],
      arguments: [requestDigest, JSON.stringify(proposed), String(MOCK_PAYMENT_STATE_TTL_SECONDS)],
    });
    if (evaluated === EVAL_FAILURE) return unknownRefund('PROVIDER_UNAVAILABLE');
    const tuple = redisTuple(evaluated);
    if (!tuple) return unknownRefund('INVALID_PROVIDER_STATE');
    if (tuple.tag === 'CONFLICT') return unknownRefund('REQUEST_MISMATCH');
    if (tuple.tag !== 'CREATED' && tuple.tag !== 'EXISTING') return unknownRefund('INVALID_PROVIDER_STATE');
    const state = parseRefundState(tuple.body);
    return state ? refundResult(state) : unknownRefund('INVALID_PROVIDER_STATE');
  }

  async submitResult(input: SubmitMockPaymentResultInput): Promise<SubmitMockPaymentResult> {
    const normalized = this.locate(input);
    if (input.result !== 'SUCCEEDED' && input.result !== 'FAILED' && input.result !== 'CANCELLED') {
      throw new TypeError('Mock payment result is invalid');
    }
    const providerTransactionId = providerReference(
      this.signingKey, 'mock_tx_', 'provider-transaction-id', normalized.intentNo,
    );
    const providerEventId = providerReference(this.signingKey, 'mock_ev_', 'payment-event-id', normalized.intentNo);
    const evaluated = await this.evaluate(SUBMIT_RESULT_SCRIPT, {
      keys: [mockPaymentIntentStateKey(this.signingKey, normalized.intentNo)],
      arguments: [
        normalized.providerIntentId ?? '', input.result, providerTransactionId, providerEventId,
        String(MOCK_PAYMENT_STATE_TTL_SECONDS),
      ],
    });
    if (evaluated === EVAL_FAILURE) return this.unknownSubmission('PROVIDER_UNAVAILABLE');
    const tuple = redisTuple(evaluated);
    if (!tuple) return this.unknownSubmission('INVALID_PROVIDER_STATE');
    const state = parsePaymentState(tuple.body);
    if (tuple.tag === 'CONFLICT') {
      return {
        submission: 'CONFLICT',
        payment: state ? paymentResult(state) : unknownPayment('REQUEST_MISMATCH'),
        callback: null,
      };
    }
    if ((tuple.tag !== 'UPDATED' && tuple.tag !== 'EXISTING') || !state) {
      return this.unknownSubmission('INVALID_PROVIDER_STATE');
    }
    const unsigned = callbackFor(state);
    if (!unsigned) return this.unknownSubmission('INVALID_PROVIDER_STATE');
    const signature = callbackSignature(this.signingKey, unsigned.headers.mock_timestamp, unsigned.rawBody)
      .toString('base64');
    const callback: MockPaymentCallback = {
      ...unsigned,
      headers: { ...unsigned.headers, mock_signature: signature },
    };
    return { submission: 'ACCEPTED', payment: paymentResult(state), callback };
  }

  private locate(input: LocatePaymentIntentInput): { intentNo: string; providerIntentId: string | null } {
    const providerIntentId = input.providerIntentId ?? null;
    return {
      intentNo: reference(input.intentNo, 'Intent number'),
      providerIntentId: providerIntentId === null ? null : reference(providerIntentId, 'Provider intent ID'),
    };
  }

  private async evaluate(
    script: string,
    options: { arguments: string[]; keys: string[] },
  ): Promise<unknown | typeof EVAL_FAILURE> {
    try {
      if (!this.redis.isReady) return EVAL_FAILURE;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<typeof EVAL_FAILURE>((resolve) => {
        timeout = setTimeout(() => resolve(EVAL_FAILURE), this.timeoutMs);
      });
      try {
        return await Promise.race([this.redis.eval(script, options), deadline]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } catch {
      return EVAL_FAILURE;
    }
  }

  private readIntentResult(evaluated: unknown, acceptedTags: ReadonlySet<string>): PaymentProviderIntentResult {
    if (evaluated === EVAL_FAILURE) return unknownPayment('PROVIDER_UNAVAILABLE');
    const tuple = redisTuple(evaluated);
    if (!tuple) return unknownPayment('INVALID_PROVIDER_STATE');
    if (tuple.tag === 'NOT_FOUND') return notFoundPayment();
    if (tuple.tag === 'CONFLICT') return unknownPayment('REQUEST_MISMATCH');
    if (!acceptedTags.has(tuple.tag)) return unknownPayment('INVALID_PROVIDER_STATE');
    const state = parsePaymentState(tuple.body);
    return state ? paymentResult(state) : unknownPayment('INVALID_PROVIDER_STATE');
  }

  private unknownSubmission(failureCode: PaymentProviderFailureCode): SubmitMockPaymentResult {
    return { submission: 'UNKNOWN', payment: unknownPayment(failureCode), callback: null };
  }
}
