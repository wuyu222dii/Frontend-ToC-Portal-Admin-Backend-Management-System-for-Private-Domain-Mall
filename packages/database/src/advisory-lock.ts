import type { Pool, PoolClient } from 'pg';

const LOCK_HASH_SEED = '781930482013421';

export async function acquireTransactionLock(
  transaction: { $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> },
  namespace: string,
  parts: readonly string[],
): Promise<void> {
  await transaction.$queryRawUnsafe(
    `SELECT 1::integer AS acquired
       FROM pg_advisory_xact_lock(
         hashtextextended(jsonb_build_array($1::text, $2::text)::text, ${LOCK_HASH_SEED}::bigint)
       )`,
    namespace,
    JSON.stringify(parts),
  );
}

export async function withSessionAdvisoryLock<T>(
  pool: Pool,
  namespace: string,
  key: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const client = await pool.connect();
  let destroyConnection = false;
  try {
    let result: { rows: { acquired: boolean }[] };
    try {
      result = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended(jsonb_build_array($1::text, $2::text)::text, ${LOCK_HASH_SEED}::bigint)) AS acquired`,
        [namespace, key],
      );
    } catch (error) {
      destroyConnection = true;
      throw error;
    }
    const acquired = result.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false };

    let workOutcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      workOutcome = { ok: true, value: await work(client) };
    } catch (error) {
      workOutcome = { ok: false, error };
    }

    let unlockError: unknown;
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended(jsonb_build_array($1::text, $2::text)::text, ${LOCK_HASH_SEED}::bigint))`,
        [namespace, key],
      );
    } catch (error) {
      destroyConnection = true;
      unlockError = error;
    }

    if (!workOutcome.ok) throw workOutcome.error;
    if (unlockError !== undefined) throw unlockError;
    return { acquired: true, value: workOutcome.value };
  } finally {
    client.release(destroyConnection);
  }
}
