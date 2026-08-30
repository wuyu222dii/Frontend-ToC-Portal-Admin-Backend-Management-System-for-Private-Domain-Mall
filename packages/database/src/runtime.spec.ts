import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import { createDatabaseRuntime, runPgTransactionOnClient, type DatabaseRuntime } from './runtime';

const PROJECT_REF = 'abcdefghijklmnopqrst';
const POOLER_URL =
  `postgresql://mall_runtime.${PROJECT_REF}:runtime-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const TEST_CERTIFICATE = [
  '-----BEGIN CERTIFICATE-----',
  'bG9jYWwtdGVzdC1jZXJ0aWZpY2F0ZQ==',
  '-----END CERTIFICATE-----',
  '',
].join('\n');

const runtimes: DatabaseRuntime[] = [];
const temporaryDirectories: string[] = [];

function baseConfig(databaseUrl: string) {
  return {
    applicationName: 'qingxu-test',
    connectionTimeoutMs: 100,
    databaseUrl,
    poolMax: 1,
  };
}

function rootCertificate(): string {
  const directory = mkdtempSync(join(tmpdir(), 'qingxu-database-test-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'supabase-ca.crt');
  writeFileSync(path, TEST_CERTIFICATE);
  return path;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.disconnect()));
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('createDatabaseRuntime', () => {
  it('permits plaintext PostgreSQL only through the explicit local test capability', () => {
    const databaseUrl = 'postgresql://mall_runtime:runtime-password@127.0.0.1:5432/mall_ci';
    expect(() => createDatabaseRuntime(baseConfig(databaseUrl))).toThrow(
      'Local DATABASE_URL is restricted to the explicit ephemeral test runtime',
    );

    const runtime = createDatabaseRuntime({ ...baseConfig(databaseUrl), allowInsecureLocalhost: true });
    runtimes.push(runtime);
    const options = runtime.pool.options;
    expect(options.ssl).toBeUndefined();
    expect(runtime.coordinationPool).not.toBe(runtime.pool);
    expect(runtime.coordinationPool.options.max).toBe(1);
    expect(runtime.coordinationPool.options.connectionString).toBe(runtime.pool.options.connectionString);
    expect(runtime.coordinationPool.listenerCount('error')).toBeGreaterThan(0);
  });

  it('requires the approved Supabase endpoint, project scope and trusted CA', () => {
    const sslRootCertPath = rootCertificate();
    expect(() => createDatabaseRuntime({
      ...baseConfig(`${POOLER_URL}?sslmode=verify-full`),
      projectRef: 'zyxwvutsrqponmlkjihg',
      sslRootCertPath,
    })).toThrow('Supabase pooler role must be scoped to the approved project');

    expect(() => createDatabaseRuntime({
      ...baseConfig(`${POOLER_URL}?sslmode=verify-full`),
      projectRef: PROJECT_REF,
    })).toThrow('Supabase runtime requires an explicit TLS root certificate');
  });

  it('removes URL TLS controls and passes an explicit verified TLS object to pg', () => {
    const sslRootCertPath = rootCertificate();
    const databaseUrl = `${POOLER_URL}?sslmode=verify-full&sslrootcert=${encodeURIComponent(sslRootCertPath)}`;
    const runtime = createDatabaseRuntime({
      ...baseConfig(databaseUrl),
      projectRef: PROJECT_REF,
      sslRootCertPath,
    });
    runtimes.push(runtime);

    expect(runtime.pool.options.connectionString).not.toMatch(/sslmode|sslrootcert/);
    expect(runtime.pool.options.ssl).toEqual({ ca: TEST_CERTIFICATE, rejectUnauthorized: true });
    expect(runtime.coordinationPool.options.ssl).toEqual({ ca: TEST_CERTIFICATE, rejectUnauthorized: true });
  });

  it('rejects query options that could override explicit TLS verification', () => {
    const sslRootCertPath = rootCertificate();
    expect(() => createDatabaseRuntime({
      ...baseConfig(`${POOLER_URL}?sslmode=verify-full&sslnegotiation=direct`),
      projectRef: PROJECT_REF,
      sslRootCertPath,
    })).toThrow('DATABASE_URL contains an unsupported query parameter');
  });

  it('rejects query parameters that can override the approved target', () => {
    const sslRootCertPath = rootCertificate();
    for (const override of ['host=evil.example', 'user=postgres', 'options=-c%20search_path%3Devil']) {
      expect(() => createDatabaseRuntime({
        ...baseConfig(`${POOLER_URL}?sslmode=verify-full&${override}`),
        projectRef: PROJECT_REF,
        sslRootCertPath,
      })).toThrow('DATABASE_URL contains an unsupported query parameter');
    }
  });

  it('rejects duplicate TLS parameters', () => {
    const sslRootCertPath = rootCertificate();
    expect(() => createDatabaseRuntime({
      ...baseConfig(`${POOLER_URL}?sslmode=verify-full&sslmode=disable`),
      projectRef: PROJECT_REF,
      sslRootCertPath,
    })).toThrow('DATABASE_URL must contain exactly one sslmode parameter');

    expect(() => createDatabaseRuntime({
      ...baseConfig(`${POOLER_URL}?sslmode=verify-full&sslrootcert=${encodeURIComponent(sslRootCertPath)}&sslrootcert=%2Ftmp%2Fevil.crt`),
      projectRef: PROJECT_REF,
      sslRootCertPath,
    })).toThrow('DATABASE_URL must not repeat sslrootcert');
  });
});

function pgClient(query: (sql: string) => Promise<unknown>) {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  } as unknown as PoolClient;
}

describe('runPgTransactionOnClient', () => {
  it('commits successful work and returns the connection to the pool', async () => {
    const client = pgClient(async () => ({ rows: [] }));
    await expect(runPgTransactionOnClient(client, async () => 'done')).resolves.toBe('done');
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('destroys a connection when BEGIN fails', async () => {
    const beginError = new Error('begin failed');
    const client = pgClient(async () => { throw beginError; });
    await expect(runPgTransactionOnClient(client, async () => undefined)).rejects.toBe(beginError);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('rolls back a work failure and preserves the original error', async () => {
    const workError = new Error('work failed');
    const client = pgClient(async () => ({ rows: [] }));
    await expect(runPgTransactionOnClient(client, async () => { throw workError; })).rejects.toBe(workError);
    expect(client.query).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('destroys a connection when rollback fails without masking the work error', async () => {
    const workError = new Error('work failed');
    const client = pgClient(async (sql) => {
      if (sql === 'ROLLBACK') throw new Error('rollback failed');
      return { rows: [] };
    });
    await expect(runPgTransactionOnClient(client, async () => { throw workError; })).rejects.toBe(workError);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('attempts rollback but destroys the connection after an uncertain COMMIT', async () => {
    const commitError = new Error('commit result unknown');
    const client = pgClient(async (sql) => {
      if (sql === 'COMMIT') throw commitError;
      return { rows: [] };
    });
    await expect(runPgTransactionOnClient(client, async () => 'done')).rejects.toBe(commitError);
    expect(client.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
