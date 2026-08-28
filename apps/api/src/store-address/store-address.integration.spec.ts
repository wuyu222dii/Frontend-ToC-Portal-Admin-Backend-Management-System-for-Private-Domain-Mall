import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type AuditRepository,
  createDatabaseRuntime,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyRepository,
} from '@qingxu/database';
import {
  createStoreAddressSecurityMaterial,
  generateUlid,
  hmacStoreAddressPhone,
  maskStoreAddressDetail,
  maskStoreAddressPhone,
} from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { StoreAddressWriteRequest } from './store-address.dto';
import { StoreAddressService } from './store-address.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B8_STORE_ADDRESS_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B8_STORE_ADDRESS_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 180_000,
};
const rollbackSentinel = Object.freeze({ code: 'B8_STORE_ADDRESS_ROLLBACK_SENTINEL' });

const FIELD_CURRENT = { id: 'b83-field-v2', key: Buffer.alloc(32, 91) };
const FIELD_PREVIOUS = { id: 'b83-field-v1', key: Buffer.alloc(32, 92) };
const PHONE_HASH_CURRENT = { id: 'b83-phone-v2', key: Buffer.alloc(32, 93) };
const PHONE_HASH_PREVIOUS = { id: 'b83-phone-v1', key: Buffer.alloc(32, 94) };

interface FullCleanupConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  username: string;
}

interface AddressFixture {
  accountIds: [string, string];
  customerIds: [string, string];
  historicalAddressId: string;
  sessions: [CurrentStoreSession, CurrentStoreSession];
}

interface WorkflowKeys {
  auditFault: string;
  completeFault: string;
  createFirst: string;
  createSecond: string;
  crossDelete: string;
  crossUpdate: string;
  deleteSecond: string;
  historicalUpdate: string;
  secondDefault: string;
  secondDefaultRequired: string;
  staleUpdate: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B8 Store address integration tests`);
  return value;
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    encryption: {
      fieldKeys: { current: FIELD_CURRENT, previous: [FIELD_PREVIOUS] },
      idempotencyHashKeys: {
        current: { id: 'b83-idempotency-v1', key: Buffer.alloc(32, 95) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 96),
    },
    environment: 'test',
    store: {
      phoneHashKeys: { current: PHONE_HASH_CURRENT, previous: [PHONE_HASH_PREVIOUS] },
    },
  } as unknown as PlatformRuntimeConfig;
}

function assertSafeFullDatabaseName(databaseName: string): void {
  if (!/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
    throw new TypeError('Full B8 Store address tests require an explicit test/ephemeral/CI database');
  }
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B8 Store address tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B8 Store address DATABASE_URL contains invalid percent encoding');
    }
    assertSafeFullDatabaseName(databaseName);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '') {
      throw new TypeError('Full B8 Store address tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b83-store-address-full',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B8 Store address tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b83-store-address-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function cleanupConnectionForFull(): FullCleanupConnection {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let username: string;
  let databaseName: string;
  let password: string;
  try {
    username = decodeURIComponent(directUrl.username);
    databaseName = decodeURIComponent(directUrl.pathname.slice(1));
    password = decodeURIComponent(directUrl.password);
  } catch {
    throw new TypeError('B8 Store address DIRECT_URL contains invalid percent encoding');
  }
  assertSafeFullDatabaseName(databaseName);
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || username !== 'mall_migrator' || !directUrl.password ||
    directUrl.search !== '' || directUrl.hash !== '' ||
    directUrl.hostname !== runtimeUrl.hostname ||
    (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B8 Store address cleanup requires a query-free loopback mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function cleanupFullFixture(connection: FullCleanupConnection, fixture: AddressFixture): void {
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `account_a=${fixture.accountIds[0]}`,
    '-v', `account_b=${fixture.accountIds[1]}`,
    '-v', `customer_a=${fixture.customerIds[0]}`,
    '-v', `customer_b=${fixture.customerIds[1]}`,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGDATABASE: connection.database,
      PGHOST: connection.host,
      PGPASSWORD: connection.password,
      PGPORT: connection.port,
      PGSSLMODE: 'disable',
      PGUSER: connection.username,
    },
    input: `
BEGIN;
DELETE FROM public.audit_log WHERE actor_account_id IN (:'account_a', :'account_b');
DELETE FROM public.idempotency_record WHERE actor_id IN (:'account_a', :'account_b');
DELETE FROM public.customer_address WHERE customer_id IN (:'customer_a', :'customer_b');
DELETE FROM public.customer_profile WHERE id IN (:'customer_a', :'customer_b');
DELETE FROM public.account WHERE id IN (:'account_a', :'account_b');
COMMIT;
`,
  });
  if (result.error || result.status !== 0) {
    const detail = [...fixture.accountIds, ...fixture.customerIds].reduce(
      (value, fixtureValue) => value.replaceAll(fixtureValue, '[redacted]'),
      (result.stderr || result.error?.message || '').replaceAll(connection.password, '[redacted]'),
    ).trim().split('\n').slice(-3).join(' ');
    throw new TypeError(`Full B8 Store address fixture cleanup failed${detail ? `: ${detail}` : ''}`);
  }
}

function transactionBoundRuntime(
  runtime: DatabaseRuntime,
  transaction: DatabaseTransaction,
): DatabaseRuntime {
  let savepoint = 0;
  const prisma = new Proxy(transaction as unknown as DatabaseRuntime['prisma'], {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => {
          savepoint += 1;
          const name = `b83_nested_${savepoint}`;
          await transaction.$executeRawUnsafe(`SAVEPOINT "${name}"`);
          try {
            const value = await work(transaction);
            await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
            return value;
          } catch (error) {
            await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${name}"`);
            await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`);
            throw error;
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...runtime, prisma };
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function workflowKeys(): WorkflowKeys {
  return {
    auditFault: randomUUID(),
    completeFault: randomUUID(),
    createFirst: randomUUID(),
    createSecond: randomUUID(),
    crossDelete: randomUUID(),
    crossUpdate: randomUUID(),
    deleteSecond: randomUUID(),
    historicalUpdate: randomUUID(),
    secondDefault: randomUUID(),
    secondDefaultRequired: randomUUID(),
    staleUpdate: randomUUID(),
  };
}

function storeSession(accountId: string, customerId: string, now: Date): CurrentStoreSession {
  return {
    accessJti: `b83-access-${randomUUID()}`,
    accountId,
    accountVersion: 1,
    customerId,
    customerVersion: 1,
    expiresAt: new Date(now.getTime() + 3_600_000),
    sessionFamily: generateUlid(),
    sessionId: generateUlid(),
  };
}

function createFixture(): AddressFixture {
  const now = Date.now();
  const accountIds: [string, string] = [generateUlid(now), generateUlid(now + 1)];
  const customerIds: [string, string] = [generateUlid(now + 2), generateUlid(now + 3)];
  return {
    accountIds,
    customerIds,
    historicalAddressId: generateUlid(now + 4),
    sessions: [
      storeSession(accountIds[0], customerIds[0], new Date(now)),
      storeSession(accountIds[1], customerIds[1], new Date(now)),
    ],
  };
}

async function seedFixture(transaction: DatabaseTransaction, fixture: AddressFixture): Promise<void> {
  const now = new Date();
  await transaction.account.createMany({
    data: fixture.accountIds.map((id, index) => ({
      created_at: now,
      deleted_at: null,
      id,
      last_login_at: now,
      login_name: null,
      must_change_password: false,
      password_hash: null,
      role: 'CUSTOMER' as const,
      status: 'ACTIVE' as const,
      updated_at: now,
      version: 1,
      wechat_open_id: `b83-address-${index}-${randomUUID()}`,
      wechat_union_id: null,
    })),
  });
  await transaction.customerProfile.createMany({
    data: fixture.customerIds.map((id, index) => ({
      account_id: fixture.accountIds[index]!,
      created_at: now,
      id,
      registered_at: now,
      updated_at: now,
      version: 1,
    })),
  });
}

function input(label: string, isDefault: boolean): StoreAddressWriteRequest {
  return {
    city: `B83 City ${label}`,
    detail: `B83 private detail ${label} ${randomUUID()}`,
    district: `B83 District ${label}`,
    isDefault,
    phone: `138${String(Math.abs([...label].reduce((total, value) => total + value.charCodeAt(0), 0)))
      .padStart(8, '0').slice(-8)}`,
    province: `B83 Province ${label}`,
    recipientName: `B83 Recipient ${label}`,
  };
}

function wireInput(value: StoreAddressWriteRequest) {
  return {
    address_id: expect.any(String),
    city: value.city,
    detail: value.detail,
    district: value.district,
    is_default: value.isDefault,
    phone: value.phone,
    province: value.province,
    recipient_name: value.recipientName,
  };
}

function tamperEnvelope(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const envelope = JSON.parse(Buffer.from(value).toString('utf8')) as { ciphertext: string };
  envelope.ciphertext = `${envelope.ciphertext.startsWith('A') ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`;
  return new Uint8Array(Buffer.from(JSON.stringify(envelope)));
}

async function seedHistoricalAddress(
  transaction: DatabaseTransaction,
  fixture: AddressFixture,
  value: StoreAddressWriteRequest,
): Promise<void> {
  const material = createStoreAddressSecurityMaterial({
    addressId: fixture.historicalAddressId,
    detail: value.detail,
    phone: value.phone,
  }, FIELD_PREVIOUS, PHONE_HASH_PREVIOUS);
  const now = new Date(Date.now() + 1_000);
  await transaction.customerAddress.create({
    data: {
      city: value.city,
      created_at: now,
      customer_id: fixture.customerIds[0],
      deleted_at: null,
      detail_ciphertext: new Uint8Array(material.detailCiphertext),
      district: value.district,
      encryption_key_id: material.encryptionKeyId,
      id: fixture.historicalAddressId,
      is_default: false,
      phone_ciphertext: new Uint8Array(material.phoneCiphertext),
      phone_hash: material.phoneHash,
      phone_last4: material.phoneLast4,
      province: value.province,
      recipient_name: value.recipientName,
      updated_at: now,
      version: 1,
    },
  });
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, fixture: AddressFixture): Promise<void> {
  await expect(Promise.all([
    runtime.prisma.account.count({ where: { id: { in: fixture.accountIds } } }),
    runtime.prisma.customerProfile.count({ where: { id: { in: fixture.customerIds } } }),
    runtime.prisma.customerAddress.count({ where: { customer_id: { in: fixture.customerIds } } }),
    runtime.prisma.idempotencyRecord.count({ where: { actor_id: { in: fixture.accountIds } } }),
    runtime.prisma.auditLog.count({ where: { actor_account_id: { in: fixture.accountIds } } }),
  ])).resolves.toEqual([0, 0, 0, 0, 0]);
}

async function expectNoCommandFacts(
  database: DatabaseTransaction,
  fixture: AddressFixture,
  key: string,
  addressCount: number,
): Promise<void> {
  await expect(Promise.all([
    database.customerAddress.count({ where: { customer_id: fixture.customerIds[0] } }),
    database.idempotencyRecord.count({ where: { idempotency_key: key } }),
    database.auditLog.count({ where: { idempotency_key: key } }),
  ])).resolves.toEqual([addressCount, 0, 0]);
}

async function exerciseFaultRollback(
  serviceRuntime: DatabaseRuntime,
  config: PlatformRuntimeConfig,
  database: DatabaseTransaction,
  fixture: AddressFixture,
  keys: WorkflowKeys,
): Promise<void> {
  const addressCount = await database.customerAddress.count({ where: { customer_id: fixture.customerIds[0] } });
  const auditFailureService = new StoreAddressService(config, serviceRuntime);
  const auditInternals = auditFailureService as unknown as { audit: AuditRepository };
  const auditFailure = vi.spyOn(auditInternals.audit, 'append')
    .mockRejectedValueOnce(new Error('b83 audit failure'));
  try {
    await expect(auditFailureService.createAddress(
      fixture.sessions[0], input('audit-fault', false), keys.auditFault, requestId(), '127.0.0.1',
    )).rejects.toThrow('b83 audit failure');
  } finally {
    auditFailure.mockRestore();
  }
  await expectNoCommandFacts(database, fixture, keys.auditFault, addressCount);

  const completeFailureService = new StoreAddressService(config, serviceRuntime);
  const completeInternals = completeFailureService as unknown as { idempotency: IdempotencyRepository };
  const completeFailure = vi.spyOn(completeInternals.idempotency, 'complete')
    .mockRejectedValueOnce(new Error('b83 idempotency completion failure'));
  try {
    await expect(completeFailureService.createAddress(
      fixture.sessions[0], input('complete-fault', false), keys.completeFault, requestId(), '127.0.0.1',
    )).rejects.toThrow('b83 idempotency completion failure');
  } finally {
    completeFailure.mockRestore();
  }
  await expectNoCommandFacts(database, fixture, keys.completeFault, addressCount);
}

async function exerciseAddressWorkflow(
  config: PlatformRuntimeConfig,
  serviceRuntime: DatabaseRuntime,
  database: DatabaseTransaction,
  fixture: AddressFixture,
  keys: WorkflowKeys,
): Promise<void> {
  const service = new StoreAddressService(config, serviceRuntime);
  const session = fixture.sessions[0];
  const otherSession = fixture.sessions[1];
  const firstInput = input('first', false);
  const secondInput = input('second', false);
  const historicalInput = input('historical', false);

  await expect(service.listAddresses(session)).resolves.toEqual([]);
  const first = await service.createAddress(
    session, firstInput, keys.createFirst, requestId(), '127.0.0.1',
  );
  expect(first).toEqual({ ...wireInput(firstInput), address_id: first.address_id, is_default: true, version: 1 });
  await expect(service.createAddress(
    session, firstInput, keys.createFirst, requestId(), '127.0.0.1',
  )).resolves.toEqual(first);
  await expect(service.createAddress(
    session, { ...firstInput, city: 'Changed replay body' }, keys.createFirst, requestId(), '127.0.0.1',
  )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });

  const second = await service.createAddress(
    session, secondInput, keys.createSecond, requestId(), '127.0.0.1',
  );
  expect(second).toEqual({ ...wireInput(secondInput), address_id: second.address_id, is_default: false, version: 1 });

  const firstRow = await database.customerAddress.findUniqueOrThrow({ where: { id: first.address_id } });
  expect(Buffer.from(firstRow.phone_ciphertext).toString('utf8')).not.toContain(firstInput.phone);
  expect(Buffer.from(firstRow.detail_ciphertext).toString('utf8')).not.toContain(firstInput.detail);
  expect(firstRow.phone_hash).toBe(hmacStoreAddressPhone(firstInput.phone, PHONE_HASH_CURRENT.key));
  const accountPhoneDomain = createHmac('sha256', PHONE_HASH_CURRENT.key)
    .update('qingxu:store-account-phone:v1\0').update(firstInput.phone).digest('hex');
  expect(firstRow.phone_hash).not.toBe(accountPhoneDomain);

  const listed = await service.listAddresses(session);
  expect(listed.map(({ address_id }) => address_id)).toEqual([first.address_id, second.address_id]);
  expect(listed[0]).toMatchObject({
    address_id: first.address_id,
    detail_masked: maskStoreAddressDetail(firstInput.detail),
    is_default: true,
    phone_masked: maskStoreAddressPhone(firstInput.phone),
    version: 1,
  });
  const serializedList = JSON.stringify(listed);
  for (const pii of [firstInput.recipientName, firstInput.phone, firstInput.detail]) {
    expect(serializedList).not.toContain(pii);
  }
  await expect(service.getAddress(session, first.address_id)).resolves.toEqual(first);

  await expect(service.getAddress(otherSession, first.address_id))
    .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', httpStatus: 404 });
  await expect(service.updateAddress(
    otherSession, first.address_id, firstInput, 1, keys.crossUpdate, requestId(), '127.0.0.2',
  )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', httpStatus: 404 });
  await expect(service.deleteAddress(
    otherSession, first.address_id, 1, keys.crossDelete, requestId(), '127.0.0.2',
  )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', httpStatus: 404 });
  await expect(Promise.all([
    database.idempotencyRecord.count({ where: { actor_id: fixture.accountIds[1] } }),
    database.auditLog.count({ where: { actor_account_id: fixture.accountIds[1] } }),
  ])).resolves.toEqual([0, 0]);

  await expect(service.updateAddress(
    session, first.address_id, firstInput, 99, keys.staleUpdate, requestId(), '127.0.0.1',
  )).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT', httpStatus: 409 });
  await expectNoCommandFacts(database, fixture, keys.staleUpdate, 2);

  await seedHistoricalAddress(database, fixture, historicalInput);
  await expect(service.getAddress(session, fixture.historicalAddressId)).resolves.toEqual({
    ...wireInput(historicalInput),
    address_id: fixture.historicalAddressId,
    is_default: false,
    version: 1,
  });
  const historicalRow = await database.customerAddress.findUniqueOrThrow({
    where: { id: fixture.historicalAddressId },
  });
  expect(historicalRow.encryption_key_id).toBe(FIELD_PREVIOUS.id);
  expect(historicalRow.phone_hash).toBe(hmacStoreAddressPhone(historicalInput.phone, PHONE_HASH_PREVIOUS.key));

  await database.customerAddress.update({
    data: { phone_ciphertext: historicalRow.detail_ciphertext },
    where: { id: fixture.historicalAddressId },
  });
  await expect(service.getAddress(session, fixture.historicalAddressId))
    .rejects.toMatchObject({ code: 'INTERNAL_ERROR', httpStatus: 500 });
  await database.customerAddress.update({
    data: { phone_ciphertext: historicalRow.phone_ciphertext },
    where: { id: fixture.historicalAddressId },
  });
  await database.customerAddress.update({
    data: { detail_ciphertext: tamperEnvelope(historicalRow.detail_ciphertext) },
    where: { id: fixture.historicalAddressId },
  });
  await expect(service.getAddress(session, fixture.historicalAddressId))
    .rejects.toMatchObject({ code: 'INTERNAL_ERROR', httpStatus: 500 });
  await database.customerAddress.update({
    data: { detail_ciphertext: historicalRow.detail_ciphertext },
    where: { id: fixture.historicalAddressId },
  });

  const upgraded = await service.updateAddress(
    session,
    fixture.historicalAddressId,
    historicalInput,
    1,
    keys.historicalUpdate,
    requestId(),
    '127.0.0.1',
  );
  expect(upgraded).toMatchObject({ address_id: fixture.historicalAddressId, version: 2 });
  await expect(service.updateAddress(
    session,
    fixture.historicalAddressId,
    historicalInput,
    1,
    keys.historicalUpdate,
    requestId(),
    '127.0.0.1',
  )).resolves.toEqual(upgraded);
  const upgradedRow = await database.customerAddress.findUniqueOrThrow({
    where: { id: fixture.historicalAddressId },
  });
  expect(upgradedRow.encryption_key_id).toBe(FIELD_CURRENT.id);
  expect(upgradedRow.phone_hash).toBe(hmacStoreAddressPhone(historicalInput.phone, PHONE_HASH_CURRENT.key));

  const secondDefault = await service.updateAddress(
    session,
    second.address_id,
    { ...secondInput, isDefault: true },
    1,
    keys.secondDefault,
    requestId(),
    '127.0.0.1',
  );
  expect(secondDefault).toMatchObject({ address_id: second.address_id, is_default: true, version: 2 });
  await expect(database.customerAddress.findUnique({
    select: { is_default: true, version: true }, where: { id: first.address_id },
  })).resolves.toEqual({ is_default: false, version: 2 });

  await expect(service.updateAddress(
    session,
    second.address_id,
    { ...secondInput, isDefault: false },
    2,
    keys.secondDefaultRequired,
    requestId(),
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'DEFAULT_ADDRESS_REQUIRED', httpStatus: 422 });
  await expectNoCommandFacts(database, fixture, keys.secondDefaultRequired, 3);

  const deleted = await service.deleteAddress(
    session, second.address_id, 2, keys.deleteSecond, requestId(), '127.0.0.1',
  );
  expect(deleted).toMatchObject({
    resource_id: second.address_id,
    resource_type: 'customer_address',
    status: 'DELETED',
    version: 3,
  });
  await expect(service.deleteAddress(
    session, second.address_id, 2, keys.deleteSecond, requestId(), '127.0.0.1',
  )).resolves.toEqual(deleted);
  await expect(Promise.all([
    database.customerAddress.findUnique({
      select: { deleted_at: true, is_default: true, version: true }, where: { id: second.address_id },
    }),
    database.customerAddress.findUnique({
      select: { deleted_at: true, is_default: true, version: true }, where: { id: first.address_id },
    }),
  ])).resolves.toEqual([
    { deleted_at: expect.any(Date), is_default: false, version: 3 },
    { deleted_at: null, is_default: true, version: 3 },
  ]);

  await exerciseFaultRollback(serviceRuntime, config, database, fixture, keys);

  const idempotency = await database.idempotencyRecord.findMany({
    orderBy: { created_at: 'asc' },
    where: { actor_id: fixture.accountIds[0] },
  });
  expect(idempotency).toHaveLength(5);
  for (const record of idempotency) {
    expect(record.response_body).toBeNull();
    expect(record.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.response_body_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.resource_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(record.response_status).toBe(200);
  }
  const audits = await database.auditLog.findMany({
    orderBy: { occurred_at: 'asc' },
    where: { actor_account_id: fixture.accountIds[0] },
  });
  expect(audits).toHaveLength(7);
  for (const audit of audits) {
    expect(audit).toMatchObject({
      actor_role: 'CUSTOMER',
      module: 'customer',
      object_type: 'address',
      result: 'SUCCESS',
      result_code: 'OK',
    });
    expect(audit.object_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(audit.ip_hash).toMatch(/^[a-f0-9]{64}$/);
    for (const value of [audit.before_json, audit.after_json]) {
      if (value === null) continue;
      expect(Object.keys(value as Record<string, unknown>).sort())
        .toEqual(['is_default', 'status', 'version']);
    }
  }
  const persistedSafeFacts = JSON.stringify({ audits, idempotency });
  for (const value of [firstInput, secondInput, historicalInput]) {
    for (const pii of [value.recipientName, value.phone, value.detail, value.province, value.city, value.district]) {
      expect(persistedSafeFacts).not.toContain(pii);
    }
  }
}

async function exerciseConcurrentDefaults(
  config: PlatformRuntimeConfig,
  runtime: DatabaseRuntime,
  fixture: AddressFixture,
): Promise<void> {
  const service = new StoreAddressService(config, runtime);
  const session = fixture.sessions[0];
  const firstInput = input('concurrent-first', false);
  const secondInput = input('concurrent-second', false);
  const [first, second] = await Promise.all([
    service.createAddress(session, firstInput, randomUUID(), requestId(), '127.0.0.1'),
    service.createAddress(session, secondInput, randomUUID(), requestId(), '127.0.0.1'),
  ]);
  let rows = await runtime.prisma.customerAddress.findMany({
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    where: { customer_id: fixture.customerIds[0], deleted_at: null },
  });
  expect(rows).toHaveLength(2);
  expect(rows.filter(({ is_default }) => is_default)).toHaveLength(1);
  expect(rows.every(({ version }) => version === 1)).toBe(true);

  const thirdInput = input('concurrent-third', false);
  const third = await service.createAddress(
    session, thirdInput, randomUUID(), requestId(), '127.0.0.1',
  );
  const byId = new Map([
    [first.address_id, firstInput],
    [second.address_id, secondInput],
    [third.address_id, thirdInput],
  ]);
  const initialDefault = rows.find(({ is_default }) => is_default)!;
  const candidates = [first.address_id, second.address_id, third.address_id]
    .filter((addressId) => addressId !== initialDefault.id);
  const settled = await Promise.allSettled(candidates.map((addressId) => service.updateAddress(
    session,
    addressId,
    { ...byId.get(addressId)!, isDefault: true },
    1,
    randomUUID(),
    requestId(),
    '127.0.0.1',
  )));
  expect(settled.every(({ status }) => status === 'fulfilled')).toBe(true);
  rows = await runtime.prisma.customerAddress.findMany({
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    where: { customer_id: fixture.customerIds[0], deleted_at: null },
  });
  expect(rows.filter(({ is_default }) => is_default)).toHaveLength(1);
  expect(rows.map(({ version }) => version).sort()).toEqual([2, 2, 3]);

  const currentDefault = rows.find(({ is_default }) => is_default)!;
  const nonDefault = rows.find(({ is_default }) => !is_default)!;
  const race = await Promise.allSettled([
    service.deleteAddress(
      session, currentDefault.id, currentDefault.version, randomUUID(), requestId(), '127.0.0.1',
    ),
    service.updateAddress(
      session,
      nonDefault.id,
      { ...byId.get(nonDefault.id)!, isDefault: true },
      nonDefault.version,
      randomUUID(),
      requestId(),
      '127.0.0.1',
    ),
  ]);
  expect(race.some(({ status }) => status === 'fulfilled')).toBe(true);
  for (const result of race) {
    if (result.status === 'rejected') {
      expect(result.reason).toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT', httpStatus: 409 });
    }
  }
  rows = await runtime.prisma.customerAddress.findMany({
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    where: { customer_id: fixture.customerIds[0], deleted_at: null },
  });
  expect(rows.filter(({ is_default }) => is_default)).toHaveLength(1);
  expect(rows.every(({ version }) => version >= 2)).toBe(true);
}

integrationDescribe('B8.3 Store address service and PostgreSQL integration', () => {
  let cleanupConnection: FullCleanupConnection | undefined;
  let config: PlatformRuntimeConfig;
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    config = integrationConfig();
    runtime = runtimeForMode();
    await runtime.connect();
    if (mode === 'full') cleanupConnection = cleanupConnectionForFull();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  rollbackIt('keeps encrypted CRUD, ownership, defaults, audit and HASH_ONLY facts atomic', async () => {
    const fixture = createFixture();
    const keys = workflowKeys();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedFixture(transaction, fixture);
      const boundRuntime = transactionBoundRuntime(runtime, transaction);
      await exerciseAddressWorkflow(config, boundRuntime, transaction, fixture, keys);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, fixture);
  }, 210_000);

  fullIt('serializes competing defaults across real connections and leaves no fixture facts', async () => {
    const fixture = createFixture();
    try {
      await runtime.withPrismaTransaction((transaction) => seedFixture(transaction, fixture), transactionOptions);
      await exerciseConcurrentDefaults(config, runtime, fixture);
    } finally {
      if (cleanupConnection) cleanupFullFixture(cleanupConnection, fixture);
    }
    await assertNoFixtureFacts(runtime, fixture);
  }, 210_000);
});
