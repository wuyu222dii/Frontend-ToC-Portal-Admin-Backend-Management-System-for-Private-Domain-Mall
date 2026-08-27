import type { PlatformRuntimeConfig } from '@qingxu/config';
import { verifyStoredStorePhoneMaterial } from '@qingxu/platform-core';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export interface StorePhoneHashMaintenanceResult {
  rehashed: number;
  verified: number;
}

export interface StorePhoneHashVerificationResult {
  verified: number;
}

interface RetainedPhoneRow extends QueryResultRow {
  encryption_key_id: string;
  id: string;
  phone_ciphertext: Buffer;
  phone_hash: string;
  phone_last4: string;
  revoked_at: Date | null;
}

interface VerifiedPhoneRow {
  currentPhoneHash: string;
  id: string;
  previousPhoneHash: string;
  requiresHashUpgrade: boolean;
}

type StorePhoneHashConfig = Pick<PlatformRuntimeConfig, 'encryption' | 'store'>;
type MaintenancePool = Pick<Pool, 'connect'>;

const SELECT_RETAINED_PHONE_ROWS = `SELECT
  id,
  phone_ciphertext,
  phone_hash,
  phone_last4,
  encryption_key_id,
  revoked_at
FROM public.customer_phone_verification
ORDER BY id ASC`;

function verifyRows(
  rows: readonly RetainedPhoneRow[],
  config: StorePhoneHashConfig,
  currentPhoneHashOnly: boolean,
): VerifiedPhoneRow[] {
  const phoneHashKeys = currentPhoneHashOnly
    ? { current: config.store.phoneHashKeys.current, previous: [] }
    : config.store.phoneHashKeys;
  return rows.map((row) => {
    const verified = verifyStoredStorePhoneMaterial({
      encryptionKeyId: row.encryption_key_id,
      id: row.id,
      phoneCiphertext: row.phone_ciphertext,
      phoneHash: row.phone_hash,
      phoneLast4: row.phone_last4,
    }, config.encryption.fieldKeys, phoneHashKeys);
    return {
      currentPhoneHash: verified.currentPhoneHash,
      id: row.id,
      previousPhoneHash: row.phone_hash,
      requiresHashUpgrade: verified.requiresHashUpgrade,
    };
  });
}

export class StorePhoneHashMaintenance {
  constructor(
    private readonly config: StorePhoneHashConfig,
    private readonly pool: MaintenancePool,
  ) {}

  async verifyCurrentOnly(): Promise<StorePhoneHashVerificationResult> {
    return this.inLockedTransaction(async (client) => {
      const rows = await this.readAllRows(client);
      const verified = verifyRows(rows, this.config, true);
      return { verified: verified.length };
    });
  }

  async rehashAndVerify(): Promise<StorePhoneHashMaintenanceResult> {
    return this.inLockedTransaction(async (client) => {
      const rows = await this.readAllRows(client);
      const verified = verifyRows(rows, this.config, false);
      const upgrades = verified.filter(({ requiresHashUpgrade }) => requiresHashUpgrade);
      for (const row of upgrades) {
        const updated = await client.query(
          `UPDATE public.customer_phone_verification
             SET phone_hash = $1
           WHERE id = $2
             AND phone_hash = $3`,
          [row.currentPhoneHash, row.id, row.previousPhoneHash],
        );
        if (updated.rowCount !== 1) throw new TypeError('Retained account phone changed during maintenance');
      }
      const convergedRows = await this.readAllRows(client);
      if (convergedRows.length !== rows.length) {
        throw new TypeError('Retained account phone row count changed during maintenance');
      }
      const converged = verifyRows(convergedRows, this.config, true);
      if (converged.some(({ requiresHashUpgrade }) => requiresHashUpgrade)) {
        throw new TypeError('Retained account phone HMAC did not converge');
      }
      return { rehashed: upgrades.length, verified: converged.length };
    });
  }

  private async readAllRows(client: PoolClient): Promise<RetainedPhoneRow[]> {
    const result = await client.query<RetainedPhoneRow>(SELECT_RETAINED_PHONE_ROWS);
    return result.rows;
  }

  private async inLockedTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let destroyConnection = false;
    try {
      await client.query('BEGIN');
      try {
        const role = await client.query<{ current_user: string } & QueryResultRow>(
          'SELECT current_user AS current_user',
        );
        if (role.rows.length !== 1 || role.rows[0]?.current_user !== 'mall_migrator') {
          throw new TypeError('Store phone HMAC maintenance requires mall_migrator');
        }
        await client.query("SET LOCAL lock_timeout = '15s'");
        await client.query(
          'LOCK TABLE public.customer_phone_verification IN ACCESS EXCLUSIVE MODE',
        );
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          destroyConnection = true;
        }
        throw error;
      }
    } finally {
      client.release(destroyConnection);
    }
  }
}
