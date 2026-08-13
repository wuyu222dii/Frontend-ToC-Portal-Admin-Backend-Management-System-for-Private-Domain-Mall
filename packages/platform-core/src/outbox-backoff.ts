export const DEFAULT_OUTBOX_BACKOFF = {
  initialDelayMs: 1_000,
  maximumDelayMs: 15 * 60 * 1_000,
} as const;

export interface OutboxBackoffOptions {
  initialDelayMs?: number;
  maximumDelayMs?: number;
}

function positiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

export function calculateOutboxBackoffMs(
  retryCount: number,
  options: OutboxBackoffOptions = {},
): number {
  if (!Number.isSafeInteger(retryCount) || retryCount < 0) {
    throw new TypeError('Outbox retry count must be a non-negative safe integer');
  }

  const initialDelayMs = options.initialDelayMs ?? DEFAULT_OUTBOX_BACKOFF.initialDelayMs;
  const maximumDelayMs = options.maximumDelayMs ?? DEFAULT_OUTBOX_BACKOFF.maximumDelayMs;
  positiveSafeInteger(initialDelayMs, 'Initial delay');
  positiveSafeInteger(maximumDelayMs, 'Maximum delay');
  if (initialDelayMs > maximumDelayMs) {
    throw new TypeError('Initial delay cannot exceed maximum delay');
  }

  const delay = initialDelayMs * 2 ** Math.min(retryCount, 52);
  return Math.min(delay, maximumDelayMs);
}
