import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  MOCK_PAYMENT_STATE_TTL_SECONDS,
  type CreateMockRefundCallbackInput,
  type CreatePaymentIntentInput,
  type LocatePaymentIntentInput,
  type LocatePaymentRefundInput,
  type MockPaymentCallback,
  type MockPaymentCallbackPayload,
  type MockPaymentProviderConfig,
  type MockRefundCallback,
  type MockRefundCallbackOutcome,
  type MockRefundCallbackPayload,
  type MockPaymentResultPort,
  type PaymentProviderFailureCode,
  type PaymentProviderIntentResult,
  type PaymentProviderOutcome,
  type PaymentProviderPort,
  type PaymentProviderRefundQueryResult,
  type PaymentProviderRefundResult,
  type PaymentRefundQueryPort,
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

const REFUND_SCRIPT = `-- qingxu:payment-mock:refund:v2
local current = redis.call('GET', KEYS[1])
if current then
  local ok, state = pcall(cjson.decode, current)
  if not ok then return {'INVALID', current} end
  if state.kind ~= 'REFUND' or state.request_digest ~= ARGV[1] then
    return {'CONFLICT', current}
  end
  if state.version == 1 then
    if ARGV[4] ~= '1' then return {'CONFLICT', current} end
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return {'EXISTING', current}
  end
  if state.version ~= 2 or state.attempt_digest == nil then return {'INVALID', current} end
  if state.attempt_digest == ARGV[2] then
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return {'EXISTING', current}
  end
  if state.state ~= 'FAILED' then return {'CONFLICT', current} end
  local replacement = cjson.decode(ARGV[3])
  if replacement.kind ~= 'REFUND' or replacement.version ~= 2 or
     replacement.state ~= 'SUCCEEDED' or replacement.attempt_digest ~= ARGV[2] or
     replacement.request_digest ~= state.request_digest or
     replacement.provider_refund_id ~= state.provider_refund_id or
     replacement.amount ~= state.amount then
    return {'CONFLICT', current}
  end
  local redis_time = redis.call('TIME')
  replacement.occurred_at_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
  current = cjson.encode(replacement)
  redis.call('SET', KEYS[1], current, 'EX', ARGV[5])
  return {'UPDATED', current}
end
local state = cjson.decode(ARGV[3])
local redis_time = redis.call('TIME')
state.occurred_at_ms = tonumber(redis_time[1]) * 1000 + math.floor(tonumber(redis_time[2]) / 1000)
current = cjson.encode(state)
redis.call('SET', KEYS[1], current, 'EX', ARGV[5])
return {'CREATED', current}
`;

const QUERY_REFUND_SCRIPT = `-- qingxu:payment-mock:query-refund:v1
local current = redis.call('GET', KEYS[1])
if not current then return {'NOT_FOUND', ''} end
local ok, state = pcall(cjson.decode, current)
if not ok or state.kind ~= 'REFUND' then return {'INVALID', current} end
if ARGV[1] ~= '' and state.provider_refund_id ~= ARGV[1] then
  return {'CONFLICT', current}
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return {'FOUND', current}
`;

const EVAL_FAILURE = Symbol('payment-provider-eval-failure');
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const SAFE_MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const REFUND_NO = /^RF[0-9A-HJKMNP-TV-Z]{26}$/;
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;
const DECIMAL_MILLISECONDS = /^(?:0|[1-9][0-9]{0,15})$/;
const MAX_REFUND_CALLBACK_BYTES = 2_048;
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

interface StoredRefundStateV1 {
  kind: 'REFUND';
  version: 1;
  request_digest: string;
  provider_refund_id: string;
  state: 'SUCCEEDED';
  amount: string;
  provider_event_id: string;
  occurred_at_ms: number | null;
}

interface StoredRefundStateV2 {
  kind: 'REFUND';
  version: 2;
  request_digest: string;
  attempt_digest: string;
  provider_refund_id: string;
  state: 'FAILED' | 'SUCCEEDED';
  amount: string;
  provider_event_id: string;
  occurred_at_ms: number | null;
}

type StoredRefundState = StoredRefundStateV1 | StoredRefundStateV2;

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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const commonFields = [
    'kind', 'version', 'request_digest', 'provider_refund_id', 'state', 'amount',
    'provider_event_id', 'occurred_at_ms',
  ];
  const v1 = exactRecord(record, commonFields) && record.version === 1;
  const v2 = exactRecord(record, [...commonFields, 'attempt_digest']) && record.version === 2;
  if ((!v1 && !v2) || record.kind !== 'REFUND' ||
    typeof record.request_digest !== 'string' || !HEX_64.test(record.request_digest) ||
    (v2 && (typeof record.attempt_digest !== 'string' || !HEX_64.test(record.attempt_digest))) ||
    typeof record.provider_refund_id !== 'string' || !SAFE_REFERENCE.test(record.provider_refund_id) ||
    (record.state !== 'SUCCEEDED' && (!v2 || record.state !== 'FAILED')) ||
    typeof record.amount !== 'string' || !SAFE_MONEY.test(record.amount) ||
    typeof record.provider_event_id !== 'string' || !SAFE_REFERENCE.test(record.provider_event_id) ||
    !validMilliseconds(record.occurred_at_ms, true)) {
    return undefined;
  }
  return record as unknown as StoredRefundState;
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

function refundResult(state: StoredRefundState): PaymentProviderRefundQueryResult {
  return {
    outcome: state.state,
    providerRefundId: state.provider_refund_id,
    providerEventId: state.provider_event_id,
    occurredAt: state.occurred_at_ms === null ? null : new Date(state.occurred_at_ms),
    failureCode: null,
  };
}

function unknownRefundQuery(failureCode: PaymentProviderFailureCode): PaymentProviderRefundQueryResult {
  return { outcome: 'UNKNOWN', providerRefundId: null, providerEventId: null, occurredAt: null, failureCode };
}

function notFoundRefund(): PaymentProviderRefundQueryResult {
  return {
    outcome: 'NOT_FOUND', providerRefundId: null, providerEventId: null, occurredAt: null, failureCode: null,
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

function refundCallbackSignature(key: Uint8Array, timestamp: string, rawBody: Uint8Array): Buffer {
  return createHmac('sha256', keyBuffer(key))
    .update('qingxu:payment-mock:refund-event-signature:v1\0', 'utf8')
    .update(timestamp, 'ascii')
    .update('\0', 'utf8')
    .update(rawBody)
    .digest();
}

function refundCallbackEventType(outcome: MockRefundCallbackOutcome): MockRefundCallback['eventType'] {
  return outcome === 'SUCCEEDED' ? 'refund.succeeded' : 'refund.failed';
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

/**
 * Turn a trusted Mock Provider success query into the same signed callback
 * envelope emitted by submitResult. Persisting this envelope in CallbackInbox
 * lets the normal settlement worker recover when the original callback was
 * lost, without treating an unsigned query response as a local payment fact.
 */
export function createSignedMockPaymentSuccessCallback(
  signingKey: Uint8Array,
  amount: string,
  result: PaymentProviderIntentResult,
): MockPaymentCallback {
  if (result.outcome !== 'SUCCEEDED' || result.providerIntentId === null ||
    result.providerTransactionId === null || result.providerEventId === null || result.occurredAt === null) {
    throw new TypeError('Mock payment success facts are incomplete');
  }
  const occurredAt = validDate(result.occurredAt, 'Payment occurrence');
  const payload: MockPaymentCallbackPayload = {
    amount: money(amount),
    occurred_at: occurredAt.toISOString(),
    outcome: 'SUCCEEDED',
    provider_event_id: reference(result.providerEventId, 'Provider event ID'),
    provider_intent_id: reference(result.providerIntentId, 'Provider intent ID'),
    provider_transaction_id: reference(result.providerTransactionId, 'Provider transaction ID'),
    version: 1,
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = String(occurredAt.getTime());
  return {
    eventType: 'payment.succeeded',
    headers: {
      mock_signature: callbackSignature(signingKey, timestamp, rawBody).toString('base64'),
      mock_timestamp: timestamp,
    },
    payload,
    providerEventId: payload.provider_event_id,
    rawBody,
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

/**
 * Build the minimum signed refund fact needed for deterministic Inbox routing.
 * Raw Provider responses and unrelated business identifiers are absent.
 */
export function createSignedMockRefundCallback(
  signingKey: Uint8Array,
  input: CreateMockRefundCallbackInput,
  result: PaymentProviderRefundResult,
): MockRefundCallback {
  if ((result.outcome !== 'SUCCEEDED' && result.outcome !== 'FAILED') || result.providerRefundId === null ||
    result.providerEventId === null || result.occurredAt === null || result.failureCode !== null) {
    throw new TypeError('Mock refund terminal facts are incomplete');
  }
  const occurredAt = validDate(result.occurredAt, 'Refund occurrence');
  if (!REFUND_NO.test(input.refundNo)) throw new TypeError('Refund number must be RF followed by a ULID');
  if (!ULID.test(input.refundAttemptId)) throw new TypeError('Refund attempt ID must be a ULID');
  if (!Number.isSafeInteger(input.attemptNo) || input.attemptNo < 1) {
    throw new TypeError('Refund attempt number must be a positive safe integer');
  }
  const payload: MockRefundCallbackPayload = {
    version: 1,
    refund_no: input.refundNo,
    refund_attempt_id: input.refundAttemptId,
    attempt_no: input.attemptNo,
    provider_event_id: reference(result.providerEventId, 'Provider event ID'),
    provider_refund_id: reference(result.providerRefundId, 'Provider refund ID'),
    outcome: result.outcome,
    amount: money(input.amount),
    occurred_at: occurredAt.toISOString(),
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = String(occurredAt.getTime());
  return {
    eventType: refundCallbackEventType(payload.outcome),
    providerEventId: payload.provider_event_id,
    rawBody,
    headers: {
      mock_signature: refundCallbackSignature(signingKey, timestamp, rawBody).toString('base64'),
      mock_timestamp: timestamp,
    },
    payload,
  };
}

export function decodeMockRefundCallback(callback: unknown, signingKey: Uint8Array): MockRefundCallbackPayload {
  if (!exactRecord(callback, ['eventType', 'providerEventId', 'rawBody', 'headers', 'payload']) ||
    !(callback.rawBody instanceof Uint8Array) || callback.rawBody.byteLength === 0 ||
    callback.rawBody.byteLength > MAX_REFUND_CALLBACK_BYTES ||
    !exactRecord(callback.headers, ['mock_signature', 'mock_timestamp']) ||
    typeof callback.headers.mock_signature !== 'string' || !BASE64_SHA256.test(callback.headers.mock_signature) ||
    typeof callback.headers.mock_timestamp !== 'string' ||
    !DECIMAL_MILLISECONDS.test(callback.headers.mock_timestamp)) {
    throw new TypeError('Mock refund callback envelope is invalid');
  }

  let decoded: string;
  let value: unknown;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(callback.rawBody);
    value = JSON.parse(decoded);
  } catch {
    throw new TypeError('Mock refund callback body is invalid');
  }
  const fields = [
    'version', 'refund_no', 'refund_attempt_id', 'attempt_no', 'provider_event_id',
    'provider_refund_id', 'outcome', 'amount', 'occurred_at',
  ] as const;
  if (!exactRecord(value, fields) || value.version !== 1 ||
    typeof value.refund_no !== 'string' || !REFUND_NO.test(value.refund_no) ||
    typeof value.refund_attempt_id !== 'string' || !ULID.test(value.refund_attempt_id) ||
    typeof value.attempt_no !== 'number' || !Number.isSafeInteger(value.attempt_no) || value.attempt_no < 1 ||
    typeof value.provider_event_id !== 'string' || !SAFE_REFERENCE.test(value.provider_event_id) ||
    typeof value.provider_refund_id !== 'string' || !SAFE_REFERENCE.test(value.provider_refund_id) ||
    (value.outcome !== 'SUCCEEDED' && value.outcome !== 'FAILED') ||
    typeof value.amount !== 'string' || !SAFE_MONEY.test(value.amount) ||
    BigInt(value.amount.replace('.', '')) < 1n || typeof value.occurred_at !== 'string') {
    throw new TypeError('Mock refund callback payload is invalid');
  }
  const occurredAtMs = Date.parse(value.occurred_at);
  if (!Number.isSafeInteger(occurredAtMs) || new Date(occurredAtMs).toISOString() !== value.occurred_at ||
    callback.headers.mock_timestamp !== String(occurredAtMs)) {
    throw new TypeError('Mock refund callback timestamp is invalid');
  }

  const payload: MockRefundCallbackPayload = {
    version: 1,
    refund_no: value.refund_no,
    refund_attempt_id: value.refund_attempt_id,
    attempt_no: value.attempt_no,
    provider_event_id: value.provider_event_id,
    provider_refund_id: value.provider_refund_id,
    outcome: value.outcome,
    amount: value.amount,
    occurred_at: value.occurred_at,
  };
  if (decoded !== JSON.stringify(payload) || !exactRecord(callback.payload, fields) ||
    callback.payload.version !== payload.version ||
    callback.payload.refund_no !== payload.refund_no ||
    callback.payload.refund_attempt_id !== payload.refund_attempt_id ||
    callback.payload.attempt_no !== payload.attempt_no ||
    callback.payload.provider_event_id !== payload.provider_event_id ||
    callback.payload.provider_refund_id !== payload.provider_refund_id ||
    callback.payload.outcome !== payload.outcome || callback.payload.amount !== payload.amount ||
    callback.payload.occurred_at !== payload.occurred_at ||
    callback.providerEventId !== payload.provider_event_id ||
    callback.eventType !== refundCallbackEventType(payload.outcome)) {
    throw new TypeError('Mock refund callback facts do not match');
  }

  const actual = Buffer.from(callback.headers.mock_signature, 'base64');
  const expected = refundCallbackSignature(signingKey, callback.headers.mock_timestamp, callback.rawBody);
  if (actual.toString('base64') !== callback.headers.mock_signature || actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)) {
    throw new TypeError('Mock refund callback signature is invalid');
  }
  return payload;
}

export function verifyMockRefundCallback(callback: unknown, signingKey: Uint8Array): boolean {
  try {
    decodeMockRefundCallback(callback, signingKey);
    return true;
  } catch {
    return false;
  }
}

export class RedisMockPaymentProvider implements PaymentProviderPort, PaymentRefundQueryPort, MockPaymentResultPort {
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
    const providerRequestId = input.providerRequestId === undefined
      ? null
      : reference(input.providerRequestId, 'Provider request ID');
    const requestDigest = hmacHex(
      this.signingKey, 'refund-request', refundNo, providerIntentId, providerTransactionId, amount,
    );
    const attemptDigest = providerRequestId === null
      ? requestDigest
      : hmacHex(this.signingKey, 'refund-attempt-request', refundNo, providerRequestId);
    const providerEventId = providerRequestId === null
      ? providerReference(this.signingKey, 'mock_re_', 'refund-event-id', refundNo)
      : `mock_re_${hmacHex(this.signingKey, 'refund-event-id', refundNo, providerRequestId)}`;
    const proposed: StoredRefundStateV2 = {
      kind: 'REFUND',
      version: 2,
      request_digest: requestDigest,
      attempt_digest: attemptDigest,
      provider_refund_id: providerReference(this.signingKey, 'mock_rf_', 'provider-refund-id', refundNo),
      state: 'SUCCEEDED',
      amount,
      provider_event_id: providerEventId,
      occurred_at_ms: null,
    };
    const evaluated = await this.evaluate(REFUND_SCRIPT, {
      keys: [mockPaymentRefundStateKey(this.signingKey, refundNo)],
      arguments: [
        requestDigest,
        attemptDigest,
        JSON.stringify(proposed),
        providerRequestId === null ? '1' : '0',
        String(MOCK_PAYMENT_STATE_TTL_SECONDS),
      ],
    });
    if (evaluated === EVAL_FAILURE) return unknownRefund('PROVIDER_UNAVAILABLE');
    const tuple = redisTuple(evaluated);
    if (!tuple) return unknownRefund('INVALID_PROVIDER_STATE');
    if (tuple.tag === 'CONFLICT') return unknownRefund('REQUEST_MISMATCH');
    if (tuple.tag !== 'CREATED' && tuple.tag !== 'EXISTING' && tuple.tag !== 'UPDATED') {
      return unknownRefund('INVALID_PROVIDER_STATE');
    }
    const state = parseRefundState(tuple.body);
    return state ? refundResult(state) : unknownRefund('INVALID_PROVIDER_STATE');
  }

  async queryRefund(input: LocatePaymentRefundInput): Promise<PaymentProviderRefundQueryResult> {
    const refundNo = reference(input.refundNo, 'Refund number');
    const providerRefundId = input.providerRefundId === undefined || input.providerRefundId === null
      ? null
      : reference(input.providerRefundId, 'Provider refund ID');
    const evaluated = await this.evaluate(QUERY_REFUND_SCRIPT, {
      keys: [mockPaymentRefundStateKey(this.signingKey, refundNo)],
      arguments: [providerRefundId ?? '', String(MOCK_PAYMENT_STATE_TTL_SECONDS)],
    });
    if (evaluated === EVAL_FAILURE) return unknownRefundQuery('PROVIDER_UNAVAILABLE');
    const tuple = redisTuple(evaluated);
    if (!tuple) return unknownRefundQuery('INVALID_PROVIDER_STATE');
    if (tuple.tag === 'NOT_FOUND') return notFoundRefund();
    if (tuple.tag === 'CONFLICT') return unknownRefundQuery('REQUEST_MISMATCH');
    if (tuple.tag !== 'FOUND') return unknownRefundQuery('INVALID_PROVIDER_STATE');
    const state = parseRefundState(tuple.body);
    return state ? refundResult(state) : unknownRefundQuery('INVALID_PROVIDER_STATE');
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
