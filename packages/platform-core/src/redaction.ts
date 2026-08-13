export const REDACTED_VALUE = '[REDACTED]' as const;
export const AUDIT_SENSITIVE_CHANGE = '发生变化' as const;

export const DEFAULT_LOG_FIELD_ALLOWLIST = [
  'account_id',
  'action',
  'actor_account_id',
  'actor_role',
  'aftersale_id',
  'agent_id',
  'aggregate_id',
  'aggregate_type',
  'code',
  'created_at',
  'customer_id',
  'duration_ms',
  'environment',
  'error_code',
  'event_id',
  'event_type',
  'expires_at',
  'file_id',
  'http_status',
  'idempotency_key',
  'method',
  'module',
  'next_retry_at',
  'object_id',
  'object_type',
  'occurred_at',
  'order_id',
  'request_id',
  'resource_id',
  'result',
  'result_code',
  'retry_count',
  'route',
  'service',
  'session_id',
  'shipment_id',
  'status',
  'status_code',
  'version',
  'withdrawal_id',
] as const;

export interface AllowlistRedactionOptions {
  allowedFields: Iterable<string>;
  redactedValue?: string;
}

const ALWAYS_SENSITIVE_FIELD =
  /(?:password|passphrase|secret|token|credential|authorization|cookie|phone|address|account_number|bank_card|card_number|ciphertext|raw_body|private_key)/i;

const AUTHORIZATION_VALUE_PATTERN = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/;
const POSTGRES_URL_PATTERN = /\bpostgres(?:ql)?:\/\//i;
const URL_USERINFO_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+(?::[^\s/@]*)?@[^\s/]+/i;
const MAINLAND_CHINA_PHONE_PATTERN = /(^|\D)1[3-9]\d{9}(\D|$)/;
const OTP_PATTERN = /^\d{6}$/;
const PAYMENT_CARD_PATTERN = /(?:^|\D)(?:\d[ -]?){12,18}\d(?!\d)/;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(?:password|passphrase|secret|token|credential|totp|otp|recovery_code|database_url|authorization|cookie)\s*[:=]\s*\S+/i;
const STRUCTURED_ADDRESS_PATTERN =
  /(?:省|自治区|特别行政区).{0,30}(?:市|区|县)|(?:路|街|巷|弄)\s*\d+\s*号|\d+\s*号(?:楼|室|单元)/;

export function isSensitiveFieldName(value: string): boolean {
  return ALWAYS_SENSITIVE_FIELD.test(value);
}

export function isSensitiveText(value: string): boolean {
  const trimmed = value.trim();
  return (
    AUTHORIZATION_VALUE_PATTERN.test(value) ||
    JWT_PATTERN.test(value) ||
    POSTGRES_URL_PATTERN.test(value) ||
    URL_USERINFO_PATTERN.test(value) ||
    MAINLAND_CHINA_PHONE_PATTERN.test(value) ||
    OTP_PATTERN.test(trimmed) ||
    PAYMENT_CARD_PATTERN.test(value) ||
    SENSITIVE_ASSIGNMENT_PATTERN.test(value) ||
    STRUCTURED_ADDRESS_PATTERN.test(value)
  );
}

function redactAllowedValue(
  value: unknown,
  allowedFields: ReadonlySet<string>,
  redactedValue: string,
  ancestors: Set<object>,
): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return isSensitiveText(value) ? redactedValue : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : redactedValue;
  }
  if (typeof value !== 'object') {
    return redactedValue;
  }
  if (ancestors.has(value)) {
    return redactedValue;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactAllowedValue(item, allowedFields, redactedValue, ancestors));
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? redactedValue : value.toISOString();
    }

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (!allowedFields.has(key) || isSensitiveFieldName(key)) {
        output[key] = redactedValue;
        continue;
      }
      output[key] = redactAllowedValue(nestedValue, allowedFields, redactedValue, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function redactValueByAllowlist(value: unknown, options: AllowlistRedactionOptions): unknown {
  return redactAllowedValue(
    value,
    new Set(options.allowedFields),
    options.redactedValue ?? REDACTED_VALUE,
    new Set<object>(),
  );
}

export function redactLogValue(value: unknown): unknown {
  return redactValueByAllowlist(value, { allowedFields: DEFAULT_LOG_FIELD_ALLOWLIST });
}

export function redactAuditValue(value: unknown, allowedFields: Iterable<string>): unknown {
  return redactValueByAllowlist(value, {
    allowedFields,
    redactedValue: AUDIT_SENSITIVE_CHANGE,
  });
}
