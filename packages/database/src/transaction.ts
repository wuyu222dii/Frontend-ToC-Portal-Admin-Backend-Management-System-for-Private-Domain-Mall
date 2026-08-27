import type { PrismaClient } from '../.generated/prisma/client';
import type { Prisma } from '../.generated/prisma/client';

const RETRYABLE_POSTGRES_CODES = new Set(['40001', '40P01']);
const PRISMA_TRANSACTION_CONFLICT_CODE = 'P2034';

export interface TransactionRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
}

function findPostgresCode(error: unknown, seen = new Set<object>()): string | undefined {
  if (typeof error !== 'object' || error === null || seen.has(error)) return undefined;
  seen.add(error);
  const record = error as Record<string, unknown>;
  for (const key of ['originalCode', 'sqlState', 'code']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && RETRYABLE_POSTGRES_CODES.has(candidate)) return candidate;
  }
  for (const key of ['cause', 'meta', 'driverAdapterError', 'originalError']) {
    const nested = findPostgresCode(record[key], seen);
    if (nested) return nested;
  }
  return undefined;
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null &&
    (error as Record<string, unknown>).code === PRISMA_TRANSACTION_CONFLICT_CODE) {
    return true;
  }
  const code = findPostgresCode(error);
  return code !== undefined && RETRYABLE_POSTGRES_CODES.has(code);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runSerializableTransaction<T>(
  prisma: PrismaClient,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
  options: TransactionRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 10;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new TypeError('Transaction retry attempts must be between 1 and 5');
  }
  if (!Number.isInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 1_000) {
    throw new TypeError('Transaction retry delay must be between 0 and 1000 ms');
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableTransactionError(error)) throw error;
      await wait(initialDelayMs * 2 ** (attempt - 1));
    }
  }
}
