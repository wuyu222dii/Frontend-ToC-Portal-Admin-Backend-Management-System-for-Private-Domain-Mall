import type { Pool, PoolClient } from 'pg';

const LOCK_HASH_SEED = '781930482013421';

export interface TransactionLockInput {
  namespace: string;
  parts: readonly string[];
}

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

export async function acquireTransactionLocks(
  transaction: { $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T> },
  locks: readonly TransactionLockInput[],
): Promise<void> {
  if (locks.length === 0) return;
  const encoded = locks.map(({ namespace, parts }) => ({
    namespace,
    parts: JSON.stringify(parts),
  }));
  await transaction.$queryRawUnsafe(
    `WITH RECURSIVE requested_locks AS MATERIALIZED (
       SELECT
         entry.value ->> 'namespace' AS namespace,
         entry.value ->> 'parts' AS parts,
         entry.position
       FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS entry(value, position)
     ), acquired(position, lock_result) AS (
       SELECT
         requested.position,
         pg_advisory_xact_lock(
           hashtextextended(
             jsonb_build_array(requested.namespace, requested.parts)::text,
             ${LOCK_HASH_SEED}::bigint
           )
         )
       FROM requested_locks AS requested
       WHERE requested.position = 1

       UNION ALL

       SELECT
         requested.position,
         pg_advisory_xact_lock(
           hashtextextended(
             jsonb_build_array(requested.namespace, requested.parts)::text,
             ${LOCK_HASH_SEED}::bigint
           )
         )
       FROM acquired AS previous
       INNER JOIN requested_locks AS requested ON requested.position = previous.position + 1
     )
     SELECT COUNT(*)::integer AS acquired
     FROM acquired`,
    JSON.stringify(encoded),
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
