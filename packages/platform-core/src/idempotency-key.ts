import { ApplicationError } from './errors';

const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Idempotency-Key must be a UUID', [
      {
        field: 'Idempotency-Key',
        reason: 'A single RFC 4122 UUID value is required',
        rejected_value: value ?? null,
      },
    ]);
  }

  return value.toLowerCase();
}
