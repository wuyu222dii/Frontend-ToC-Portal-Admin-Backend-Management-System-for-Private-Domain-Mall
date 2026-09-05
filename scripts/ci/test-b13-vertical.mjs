import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
const storageRequire = createRequire(new URL('../../packages/storage/package.json', import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');
let s3Client;
let diagnosticProtectedValues = [];

function refuse(message) {
  throw new Error(`B13 vertical test refused: ${message}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) refuse(`${name} is required`);
  return value;
}

function parseUrl(name) {
  try {
    return new URL(required(name));
  } catch {
    refuse(`${name} must be a valid URL`);
  }
}

function testPort(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[0-9]{4,5}$/.test(value) || Number(value) < 1_024 || Number(value) > 65_535) {
    refuse(`${name} must be an unprivileged TCP port`);
  }
  return value;
}

function formatError(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map((item) => formatError(item))].join('\n');
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function sanitizeDiagnostic(value, protectedValues) {
  let output = String(value);
  for (const secret of protectedValues) {
    if (secret) output = output.replaceAll(secret, '[REDACTED]');
  }
  return output
    .replace(/([?&]X-Amz-[A-Za-z-]+=)[^&\s"'<>]+/giu, '$1[REDACTED]')
    .split(/\r?\n/u).filter(Boolean).slice(-40).join('\n').slice(-8_000);
}

function secretRepresentations(base64Value) {
  const bytes = Buffer.from(base64Value, 'base64');
  const decimalBytes = [...bytes];
  const spacedHex = decimalBytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return [...new Set([
    base64Value,
    bytes.toString('hex'),
    spacedHex,
    `<Buffer ${spacedHex}>`,
    JSON.stringify(bytes),
    JSON.stringify(decimalBytes),
    decimalBytes.join(','),
  ])];
}

function environmentProtectedValues() {
  const secretName = /(?:ACCESS_KEY|AUTHORIZATION|CREDENTIAL|DATABASE_URL|DIRECT_URL|ENCRYPTION|HASH_KEY|PASSWORD|PRIVATE_KEY|REDIS_URL|SECRET|SIGNING|TOKEN)/u;
  const values = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!secretName.test(name) || typeof value !== 'string' || value.length < 6) continue;
    values.push(value);
    if (name.endsWith('_BASE64')) values.push(...secretRepresentations(value));
  }
  return values;
}

function validateTargets() {
  if (process.env.B13_VERTICAL_TEST_MODE !== 'full') {
    refuse('B13_VERTICAL_TEST_MODE must be explicitly set to full');
  }
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }
  if (process.env.STORE_IDENTITY_PROVIDER !== 'MOCK' || process.env.STORE_PHONE_PROVIDER !== 'MOCK' ||
    process.env.STORE_PAYMENT_PROVIDER !== 'MOCK') {
    refuse('Mock identity, phone and payment providers are required');
  }

  const database = parseUrl('DATABASE_URL');
  const direct = parseUrl('DIRECT_URL');
  let databaseName;
  let runtimeRole;
  let migratorRole;
  try {
    databaseName = decodeURIComponent(database.pathname.slice(1));
    runtimeRole = decodeURIComponent(database.username);
    migratorRole = decodeURIComponent(direct.username);
  } catch {
    refuse('PostgreSQL URLs contain invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !LOOPBACK_HOSTS.has(database.hostname) ||
    runtimeRole !== 'mall_runtime' || !database.password || database.search || database.hash ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/iu.test(databaseName)) {
    refuse('DATABASE_URL must be a query-free loopback mall_runtime test database');
  }
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) || !LOOPBACK_HOSTS.has(direct.hostname) ||
    migratorRole !== 'mall_migrator' || !direct.password || direct.search || direct.hash ||
    direct.hostname !== database.hostname || (direct.port || '5432') !== (database.port || '5432') ||
    direct.pathname !== database.pathname) {
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same database');
  }

  const redis = parseUrl('REDIS_URL');
  let redisPassword;
  try {
    redisPassword = decodeURIComponent(redis.password);
  } catch {
    refuse('REDIS_URL contains invalid percent encoding');
  }
  if (redis.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redis.hostname) || redis.username ||
    redisPassword.length < 12 || redis.search || redis.hash || !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)) {
    refuse('REDIS_URL must use a password-protected isolated loopback database 1 through 15');
  }

  const storage = parseUrl('S3_ENDPOINT');
  const publicBase = parseUrl('S3_PUBLIC_BASE_URL');
  const bucket = required('S3_BUCKET');
  if (storage.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storage.hostname) || storage.pathname !== '/' ||
    storage.username || storage.password || storage.search || storage.hash) {
    refuse('S3_ENDPOINT must be a credential-free loopback HTTP origin');
  }
  if (!/^mall-b(?:[3-9]|1[0-3])-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) ||
    publicBase.origin !== storage.origin || publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBase.username || publicBase.password || publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated B3 through B13 test bucket');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');

  const apiPort = testPort('B13_VERTICAL_API_PORT', '3000');
  const workerPort = testPort('B13_VERTICAL_WORKER_PORT', '3001');
  const miniappPort = '5173';
  const agentPort = '5174';
  const adminPort = '5175';
  if (apiPort !== '3000') refuse('B13_VERTICAL_API_PORT must be 3000 for the Admin and Agent Vite proxies');
  if (new Set([apiPort, workerPort, miniappPort, agentPort, adminPort]).size !== 5) {
    refuse('B13 vertical service ports must be distinct');
  }
  for (const name of [
    'AUDIT_IP_HASH_KEY_BASE64',
    'BANK_ACCOUNT_HASH_KEY_BASE64',
    'BANK_ACCOUNT_HASH_KEY_ID',
    'FIELD_ENCRYPTION_KEY_BASE64',
    'FIELD_ENCRYPTION_KEY_ID',
    'IDEMPOTENCY_HASH_KEY_BASE64',
    'PAYMENT_MOCK_SIGNING_KEY_BASE64',
    'S3_ACCESS_KEY',
    'S3_REGION',
    'S3_SECRET_KEY',
    'STORE_PHONE_HASH_KEY_BASE64',
    'STORE_PROMOTION_PUBLIC_BASE_URL',
    'STORE_WECHAT_APP_ID',
  ]) required(name);
  return { adminPort, agentPort, apiPort, miniappPort, workerPort };
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b13-vertical',
    connectionTimeoutMs: 5_000,
    databaseUrl: required('DATABASE_URL'),
    poolMax: 4,
  });
}

function storageClient() {
  const { S3Client } = storageRequire('@aws-sdk/client-s3');
  if (!s3Client) {
    s3Client = new S3Client({
      credentials: { accessKeyId: required('S3_ACCESS_KEY'), secretAccessKey: required('S3_SECRET_KEY') },
      endpoint: required('S3_ENDPOINT'),
      forcePathStyle: true,
      region: required('S3_REGION'),
    });
  }
  return s3Client;
}

function createFixture(generateUlid, sha256Hex) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const loginCode = `mock:b13_vertical_${marker.toLowerCase()}`;
  return {
    adminAccountId: generateUlid(),
    adminLogin: `b13-admin-${marker.toLowerCase()}`,
    adminPassword: `B13-Admin-${randomBytes(24).toString('base64url')}!`,
    agentLogin: `b13.agent.${marker.toLowerCase()}`,
    agentName: `B13 Vertical Agent ${marker}`,
    agentPassword: `B13-Agent-${randomBytes(24).toString('base64url')}!`,
    bankAccountHolder: `B13 Holder ${marker}`,
    bankName: `B13 Test Bank ${marker}`,
    bankAccountNumber: `622202${randomBytes(8).toString('hex').replace(/[a-f]/g, '7').slice(0, 12)}`,
    brandId: generateUlid(),
    brandName: `B13 Vertical Brand ${marker}`,
    businessRuleId: generateUlid(),
    categoryId: generateUlid(),
    categoryName: `B13 Vertical Category ${marker}`,
    commissionEntryId: generateUlid(),
    commissionRuleId: generateUlid(),
    inventoryId: generateUlid(),
    loginCode,
    marker,
    productId: generateUlid(),
    productName: `B13 Vertical Product ${marker}`,
    rawAddress: `Development address ${marker}`,
    rawPhone: `139${marker.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}`,
    rawRecipient: `Vertical Recipient ${marker}`,
    skuId: generateUlid(),
    skuName: `B13 Vertical SKU ${marker}`,
    startedAt: new Date(),
    wechatOpenId: `mock_${sha256Hex(`${required('STORE_WECHAT_APP_ID')}\0${loginCode}`)}`,
  };
}

async function seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const [businessRules, commissionRules] = await Promise.all([
      runtime.prisma.businessRuleVersion.count({ where: { status: 'PUBLISHED' } }),
      runtime.prisma.commissionRuleVersion.count({ where: { status: 'PUBLISHED' } }),
    ]);
    if (businessRules !== 0 || commissionRules !== 0) {
      refuse('the isolated database already contains a published business or commission rule');
    }
    const passwordHash = await hashPassword(fixture.adminPassword);
    const auth = new AdminAuthRepository(runtime.prisma);
    const effectiveAt = new Date(Date.now() - 60_000);
    await runtime.withPrismaTransaction(async (transaction) => {
      await auth.bootstrapSuperAdminInTransaction(transaction, {
        accountId: fixture.adminAccountId,
        loginName: fixture.adminLogin,
        passwordHash,
      });
      const [businessVersion, commissionVersion] = await Promise.all([
        transaction.businessRuleVersion.aggregate({ _max: { version_no: true } }),
        transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } }),
      ]);
      await transaction.businessRuleVersion.create({
        data: {
          aftersale_window_days: 7,
          created_by_id: fixture.adminAccountId,
          effective_at: effectiveAt,
          id: fixture.businessRuleId,
          legal_record_retention_years: 10,
          minimum_withdrawal_amount: '100.00',
          order_payment_timeout_minutes: 30,
          reason: 'B13 vertical business rule',
          status: 'PUBLISHED',
          version_no: (businessVersion._max.version_no ?? 0) + 1,
        },
      });
      await transaction.commissionRuleVersion.create({
        data: {
          created_by_id: fixture.adminAccountId,
          id: fixture.commissionRuleId,
          reason: 'B13 vertical commission rule',
          status: 'DRAFT',
          version_no: (commissionVersion._max.version_no ?? 0) + 1,
        },
      });
      await transaction.commissionRuleEntry.create({
        data: {
          configured_rate: '20.0000',
          id: fixture.commissionEntryId,
          rule_version_id: fixture.commissionRuleId,
          target_id: null,
          target_key: 'PLATFORM',
          target_type: 'PLATFORM',
        },
      });
      await transaction.commissionRuleVersion.update({
        data: { effective_at: effectiveAt, status: 'PUBLISHED' },
        where: { id: fixture.commissionRuleId },
      });
      await transaction.brand.create({
        data: { id: fixture.brandId, name: fixture.brandName, sort_order: 0, status: 'ACTIVE' },
      });
      await transaction.category.create({
        data: { id: fixture.categoryId, name: fixture.categoryName, sort_order: 0, status: 'ACTIVE' },
      });
      await transaction.product.create({
        data: {
          brand_id: fixture.brandId,
          category_id: fixture.categoryId,
          id: fixture.productId,
          is_new: true,
          name: fixture.productName,
          published_at: effectiveAt,
          spu_code: `B13V-SPU-${fixture.marker}`,
          status: 'ACTIVE',
        },
      });
      await transaction.sku.create({
        data: {
          code: `B13V-SKU-${fixture.marker}`,
          id: fixture.skuId,
          is_recommended: true,
          name: fixture.skuName,
          product_id: fixture.productId,
          retail_price: '1000.00',
          status: 'ACTIVE',
        },
      });
      await transaction.inventoryBalance.create({
        data: { id: fixture.inventoryId, locked_qty: 0, physical_qty: 10, sku_id: fixture.skuId },
      });
    });
  } finally {
    await runtime.disconnect();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(Number(port), '127.0.0.1');
  });
}

function startProcess(label, args, env, protectedValues) {
  const child = spawn('pnpm', args, {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => {
    output += chunk.toString('utf8');
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  child.once('error', capture);
  return {
    assertSafe: () => {
      if ([...protectedValues].some((value) => value && output.includes(value))) {
        throw new Error(`Protected B13 data leaked into ${label} output`);
      }
    },
    child,
    diagnostic: () => `${label}:\n${sanitizeDiagnostic(output, protectedValues)}`,
  };
}

async function waitForHealth(origin, service, processHandle) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
      throw new Error(`${service} exited before readiness\n${processHandle.diagnostic()}`);
    }
    const response = await globalThis.fetch(`${origin}/internal/health`, {
      signal: globalThis.AbortSignal.timeout(2_000),
    }).catch(() => null);
    if (response?.ok) {
      const body = await response.json().catch(() => null);
      if (body?.service === service && body?.status === 'ok') return;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }
  throw new Error(`${service} did not become ready\n${processHandle.diagnostic()}`);
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) return;
  const child = processHandle.child;
  try {
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    // The process may exit between the status check and signal delivery.
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => globalThis.setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {
      // The process may exit between the status check and signal delivery.
    }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => globalThis.setTimeout(resolve, 5_000)),
    ]);
  }
}

function runCaptured(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk) => {
      output += chunk.toString('utf8');
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      failed: code !== 0,
      output,
      signal,
    }));
  });
}

async function artifactFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function assertNoProtectedArtifacts(directory, protectedValues) {
  for (const path of await artifactFiles(directory)) {
    const content = await readFile(path);
    if ([...protectedValues].some((value) => value && content.includes(Buffer.from(value)))) {
      throw new Error('Protected B13 data leaked into an isolated Playwright artifact');
    }
  }
}

async function runBrowserJourney(fixture, protectedValues, ports) {
  const workspace = await mkdtemp(join(tmpdir(), 'qingxu-b13-playwright-'));
  const fixturePath = join(workspace, 'fixture.json');
  const resultPath = join(workspace, 'result.json');
  const secretPath = join(workspace, 'ephemeral-secrets.json');
  const outputDirectory = join(workspace, 'output');
  try {
    await mkdir(outputDirectory, { mode: 0o700 });
    await writeFile(resultPath, '{}', { mode: 0o600 });
    await writeFile(secretPath, '[]', { mode: 0o600 });
    await writeFile(fixturePath, JSON.stringify({
      adminLogin: fixture.adminLogin,
      adminPassword: fixture.adminPassword,
      agentLogin: fixture.agentLogin,
      agentName: fixture.agentName,
      agentPassword: fixture.agentPassword,
      bankAccountHolder: fixture.bankAccountHolder,
      bankName: fixture.bankName,
      bankAccountNumber: fixture.bankAccountNumber,
      customerLoginCode: fixture.loginCode,
      marker: fixture.marker,
      productId: fixture.productId,
      productName: fixture.productName,
      rawAddress: fixture.rawAddress,
      rawPhone: fixture.rawPhone,
      rawRecipient: fixture.rawRecipient,
    }), { mode: 0o600 });
    const result = await runCaptured('pnpm', [
      'exec', 'playwright', 'test', '--config', 'playwright.b13-vertical.config.ts',
    ], {
      ...process.env,
      B13_VERTICAL_ADMIN_ORIGIN: `http://127.0.0.1:${ports.adminPort}`,
      B13_VERTICAL_AGENT_ORIGIN: `http://127.0.0.1:${ports.agentPort}`,
      B13_VERTICAL_API_ORIGIN: `http://127.0.0.1:${ports.apiPort}`,
      B13_VERTICAL_EPHEMERAL_SECRET_PATH: secretPath,
      B13_VERTICAL_FIXTURE_PATH: fixturePath,
      B13_VERTICAL_MINIAPP_ORIGIN: `http://127.0.0.1:${ports.miniappPort}`,
      B13_VERTICAL_OUTPUT_DIR: outputDirectory,
      B13_VERTICAL_RESULT_PATH: resultPath,
    });
    const ephemeralSecrets = JSON.parse(await readFile(secretPath, 'utf8'));
    assert(Array.isArray(ephemeralSecrets) && ephemeralSecrets.length <= 128 && ephemeralSecrets.every((value) =>
      typeof value === 'string' && value.length >= 6 && value.length <= 4_096),
    'B13 Playwright ephemeral-secret manifest is invalid');
    for (const secret of ephemeralSecrets) protectedValues.add(secret);
    if ([...protectedValues].some((value) => value && result.output.includes(value))) {
      throw new Error('Protected B13 data leaked into captured Playwright diagnostics');
    }
    await assertNoProtectedArtifacts(outputDirectory, protectedValues);
    if (result.failed) {
      throw new Error(`B13 three-client browser journey failed${result.signal ? ` (${result.signal})` : ''}:\n${
        sanitizeDiagnostic(result.output, protectedValues)}`);
    }
    const browserResult = JSON.parse(await readFile(resultPath, 'utf8'));
    const resultFields = [
      'agentId', 'candidateId', 'promotionAssetId', 'qrFileId', 'addressId', 'orderId',
      'paymentIntentId', 'shipmentId', 'bankAccountId', 'withdrawalId', 'withdrawalNo', 'proofFileId',
    ];
    assert(browserResult && typeof browserResult === 'object' && !Array.isArray(browserResult) &&
      resultFields.every((field) => typeof browserResult[field] === 'string' && browserResult[field].length > 0) &&
      Object.keys(browserResult).every((field) => resultFields.includes(field)),
    'B13 Playwright result manifest is invalid');
    for (const field of resultFields) fixture[field] = browserResult[field];
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function redisKeys(redis) {
  const keys = [];
  for await (const batch of redis.scanIterator({ MATCH: '*', COUNT: 100 })) {
    if (Array.isArray(batch)) keys.push(...batch);
    else keys.push(batch);
  }
  return keys.sort();
}

async function connectRedis() {
  const { createClient } = apiRequire('redis');
  const redis = createClient({ url: required('REDIS_URL') });
  await redis.connect();
  return redis;
}

async function assertFacts(pool, fixture, protectedValues) {
  const result = await pool.query(
    `SELECT so.order_status::text, so.payment_status::text, so.fulfillment_status::text,
            so.final_agent_id::text, so.final_channel::text, so.paid_amount::text,
            ib.physical_qty, ib.locked_qty,
            cs.effective_rate::text, cs.original_commission::text,
            cp.state::text AS commission_state, cp.expected_remaining::text,
            aw.available_balance::text, aw.frozen_balance::text,
            w.status::text AS withdrawal_status, w.amount::text AS withdrawal_amount,
            wbs.account_no_last4,
            (SELECT COUNT(*)::int FROM public.withdrawal_proof WHERE withdrawal_id = w.id) AS proofs,
            (SELECT jsonb_agg(jsonb_build_object('type', cl.ledger_type::text,
              'available', cl.available_change::text, 'frozen', cl.frozen_change::text,
              'expected', cl.expected_change::text) ORDER BY cl.occurred_at, cl.id)
             FROM public.commission_ledger AS cl WHERE cl.agent_id = so.final_agent_id) AS ledgers
     FROM public.sales_order AS so
     JOIN public.order_item AS oi ON oi.order_id = so.id
     JOIN public.order_item_commission_snapshot AS cs ON cs.order_item_id = oi.id
     JOIN public.order_item_commission_position AS cp ON cp.snapshot_id = cs.id
     JOIN public.inventory_balance AS ib ON ib.sku_id = oi.sku_id
     JOIN public.agent_wallet AS aw ON aw.agent_id = so.final_agent_id
     JOIN public.withdrawal AS w ON w.agent_id = so.final_agent_id
     JOIN public.withdrawal_bank_snapshot AS wbs ON wbs.withdrawal_id = w.id
     WHERE so.id = $1 AND w.id = $2`,
    [fixture.orderId, fixture.withdrawalId],
  );
  const fact = result.rows[0];
  assert(fact?.order_status === 'COMPLETED' && fact.payment_status === 'PAID' &&
    fact.fulfillment_status === 'DELIVERED' &&
    fact.final_agent_id === fixture.agentId && fact.final_channel === 'AGENT' &&
    fact.paid_amount === '1000.00' && fact.physical_qty === 9 && fact.locked_qty === 0,
  'Order, attribution or inventory facts are inconsistent');
  assert(fact.effective_rate === '20.0000' && fact.original_commission === '200.00' &&
    fact.commission_state === 'AVAILABLE' && fact.expected_remaining === '0.00',
  'Commission snapshot or position is inconsistent');
  assert(fact.available_balance === '100.00' && fact.frozen_balance === '0.00' &&
    fact.withdrawal_status === 'PAID' && fact.withdrawal_amount === '100.00' && fact.proofs === 1 &&
    fact.account_no_last4 === fixture.bankAccountNumber.slice(-4), 'Withdrawal facts are inconsistent');
  const expectedLedgers = {
    AVAILABLE_CREDIT: { available: '200.00', expected: '-200.00', frozen: '0.00' },
    EXPECTED_CREATED: { available: '0.00', expected: '200.00', frozen: '0.00' },
    WITHDRAWAL_FREEZE: { available: '-100.00', expected: '0.00', frozen: '100.00' },
    WITHDRAWAL_PAID: { available: '0.00', expected: '0.00', frozen: '-100.00' },
  };
  const ledgers = fact.ledgers ?? [];
  assert(ledgers.length === Object.keys(expectedLedgers).length, 'Commission ledger row count is inconsistent');
  for (const [type, expected] of Object.entries(expectedLedgers)) {
    const matching = ledgers.filter((item) => item.type === type);
    assert(matching.length === 1 && matching[0].available === expected.available &&
      matching[0].expected === expected.expected && matching[0].frozen === expected.frozen,
    `Commission ledger ${type} is not exact-once`);
  }

  const files = await pool.query(
    `SELECT id::text, object_key, purpose::text, status::text, visibility::text, byte_size::text, sha256
     FROM public.file_asset WHERE id::text = ANY($1::text[]) ORDER BY id`,
    [[fixture.qrFileId, fixture.proofFileId]],
  );
  assert(files.rowCount === 2 && files.rows.every(({ status }) => status === 'READY') &&
    files.rows.some(({ id, purpose, visibility }) => id === fixture.qrFileId &&
      purpose === 'PROMOTION_QR' && visibility === 'PRIVATE') &&
    files.rows.some(({ id, purpose, visibility, byte_size: size, sha256 }) => id === fixture.proofFileId &&
      purpose === 'WITHDRAWAL_PROOF' && visibility === 'PRIVATE' && Number(size) === PNG_BYTES.length &&
      sha256 === PNG_SHA256), 'MinIO file metadata facts are inconsistent');
  const { HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  for (const file of files.rows) {
    const object = await storageClient().send(new HeadObjectCommand({
      Bucket: required('S3_BUCKET'), Key: file.object_key,
    }));
    assert((object.ContentLength ?? 0) > 0 && object.ContentType === 'image/png',
      'A B13 object does not match its ready file fact');
  }

  const accountIds = [fixture.adminAccountId, fixture.agentAccountId, fixture.customerAccountId].filter(Boolean);
  const authResources = await pool.query(
    `SELECT ARRAY(
       SELECT id::text FROM public.auth_session WHERE account_id::text = ANY($1::text[])
       UNION SELECT id::text FROM public.mfa_challenge WHERE account_id::text = ANY($1::text[])
       UNION SELECT id::text FROM public.totp_factor WHERE account_id::text = ANY($1::text[])
     ) AS ids`,
    [accountIds],
  );
  const resourceIds = [
    ...accountIds, fixture.agentId, fixture.customerId, fixture.candidateId,
    fixture.promotionAssetId, fixture.addressId,
    fixture.orderId, fixture.paymentIntentId, fixture.shipmentId, fixture.bankAccountId,
    fixture.withdrawalId, fixture.qrFileId, fixture.proofFileId, ...(authResources.rows[0]?.ids ?? []),
  ].filter(Boolean);
  const diagnostics = await pool.query(
    `SELECT COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.audit_log AS a
                     WHERE a.actor_account_id::text = ANY($1::text[]) OR a.object_id = ANY($2::text[])), '[]') AS audit,
            COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM public.idempotency_record AS i
                     WHERE i.actor_id::text = ANY($1::text[]) OR i.resource_id::text = ANY($2::text[])), '[]') AS idempotency,
            COALESCE((SELECT jsonb_agg(to_jsonb(o)) FROM public.outbox_event AS o
                     WHERE o.aggregate_id::text = ANY($2::text[])), '[]') AS outbox`,
    [accountIds, resourceIds],
  );
  assert((diagnostics.rows[0]?.audit?.length ?? 0) > 0 &&
    (diagnostics.rows[0]?.idempotency?.length ?? 0) > 0 &&
    (diagnostics.rows[0]?.outbox?.length ?? 0) > 0,
  'Audit, idempotency or Outbox evidence is missing');
  const outbox = diagnostics.rows[0]?.outbox ?? [];
  for (const [eventType, aggregateId] of [
    ['agent.created', fixture.agentId],
    ['promotion.asset.created', fixture.promotionAssetId],
    ['order.created', fixture.orderId],
    ['payment.succeeded', fixture.paymentIntentId],
    ['order.completed', fixture.orderId],
    ['withdrawal.submitted', fixture.withdrawalId],
    ['withdrawal.approved', fixture.withdrawalId],
    ['withdrawal.paid', fixture.withdrawalId],
  ]) {
    const matching = outbox.filter(({ aggregate_id: id, event_type: type }) =>
      id === aggregateId && type === eventType);
    assert(matching.length === 1, `Required Outbox event ${eventType} is not exact-once`);
  }
  const serialized = JSON.stringify(diagnostics.rows[0]);
  for (const secret of protectedValues) {
    if (secret && serialized.includes(secret)) throw new Error('Protected B13 data leaked into durable diagnostics');
  }
}

async function discoverFixture(pool, fixture) {
  const agent = await pool.query(
    `SELECT ap.id::text AS agent_id, ap.account_id::text FROM public.agent_profile AS ap
     JOIN public.account AS a ON a.id = ap.account_id WHERE a.login_name = $1`, [fixture.agentLogin],
  );
  fixture.agentId ??= agent.rows[0]?.agent_id;
  fixture.agentAccountId = agent.rows[0]?.account_id;
  const customer = await pool.query(
    `SELECT cp.id::text AS customer_id, cp.account_id::text FROM public.customer_profile AS cp
     JOIN public.account AS a ON a.id = cp.account_id WHERE a.wechat_open_id = $1`, [fixture.wechatOpenId],
  );
  fixture.customerId = customer.rows[0]?.customer_id;
  fixture.customerAccountId = customer.rows[0]?.account_id;
  if (fixture.agentId) {
    const candidate = await pool.query(
      `SELECT id::text FROM public.attribution_candidate
       WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.agentId],
    );
    fixture.candidateId ??= candidate.rows[0]?.id;
    const promotion = await pool.query(
      `SELECT id::text, qr_file_id::text FROM public.promotion_asset
       WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.agentId],
    );
    fixture.promotionAssetId ??= promotion.rows[0]?.id;
    fixture.qrFileId ??= promotion.rows[0]?.qr_file_id;
    const bank = await pool.query(
      `SELECT id::text FROM public.agent_bank_account
       WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.agentId],
    );
    fixture.bankAccountId ??= bank.rows[0]?.id;
    const withdrawal = await pool.query(
      `SELECT id::text, withdrawal_no FROM public.withdrawal
       WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.agentId],
    );
    fixture.withdrawalId ??= withdrawal.rows[0]?.id;
    fixture.withdrawalNo ??= withdrawal.rows[0]?.withdrawal_no;
  }
  if (fixture.customerId) {
    const address = await pool.query(
      `SELECT id::text FROM public.customer_address
       WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.customerId],
    );
    fixture.addressId ??= address.rows[0]?.id;
    const order = await pool.query(
      `SELECT id::text FROM public.sales_order
       WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.customerId],
    );
    fixture.orderId ??= order.rows[0]?.id;
  }
  if (fixture.orderId) {
    const [payment, shipment] = await Promise.all([
      pool.query(
        `SELECT id::text FROM public.payment_intent
         WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.orderId],
      ),
      pool.query(
        `SELECT id::text FROM public.shipment
         WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.orderId],
      ),
    ]);
    fixture.paymentIntentId ??= payment.rows[0]?.id;
    fixture.shipmentId ??= shipment.rows[0]?.id;
  }
  if (fixture.withdrawalId) {
    const proof = await pool.query(
      `SELECT file_id::text FROM public.withdrawal_proof
       WHERE withdrawal_id = $1 ORDER BY created_at DESC LIMIT 1`, [fixture.withdrawalId],
    );
    fixture.proofFileId ??= proof.rows[0]?.file_id;
  }
  const files = await pool.query(
    `SELECT id::text, object_key FROM public.file_asset
     WHERE id::text = ANY($1::text[])
        OR (created_by_id::text = ANY($2::text[]) AND created_at >= $3
            AND purpose IN ('PROMOTION_QR', 'WITHDRAWAL_PROOF'))`,
    [[fixture.qrFileId, fixture.proofFileId].filter(Boolean),
      [fixture.adminAccountId, fixture.agentAccountId, fixture.customerAccountId].filter(Boolean),
      fixture.startedAt],
  );
  fixture.fileIds = files.rows.map(({ id }) => id);
  fixture.objectKeys = files.rows.map(({ object_key: objectKey }) => objectKey);
}

async function cleanupDatabase(pool, fixture) {
  await discoverFixture(pool, fixture);
  const client = await pool.connect();
  let residualAccountIds = [fixture.adminAccountId, fixture.agentAccountId, fixture.customerAccountId].filter(Boolean);
  let residualResourceIds = [];
  let residualCallbackIds = [];
  let residualFactorIds = [];
  let residualFileIds = [fixture.qrFileId, fixture.proofFileId].filter(Boolean);
  let residualItemIds = [];
  let residualPaymentIds = [];
  let residualShipmentIds = [];
  let residualSnapshotIds = [];
  try {
    await client.query('BEGIN');
    const accountIds = [fixture.adminAccountId, fixture.agentAccountId, fixture.customerAccountId].filter(Boolean);
    const dynamic = await client.query(
      `SELECT ARRAY(SELECT id::text FROM public.auth_session WHERE account_id::text = ANY($1::text[])) AS sessions,
              ARRAY(SELECT id::text FROM public.totp_factor WHERE account_id::text = ANY($1::text[])) AS factors,
              ARRAY(SELECT id::text FROM public.mfa_challenge WHERE account_id::text = ANY($1::text[])) AS challenges,
              ARRAY(SELECT id::text FROM public.attribution_candidate WHERE agent_id = $2) AS candidates,
              ARRAY(SELECT id::text FROM public.customer_agent_binding WHERE agent_id = $2) AS bindings,
              ARRAY(SELECT oi.id::text FROM public.order_item AS oi WHERE oi.order_id = $3) AS items,
              ARRAY(SELECT id::text FROM public.payment_intent WHERE order_id = $3) AS payments,
              ARRAY(SELECT id::text FROM public.shipment WHERE order_id = $3) AS shipments,
              ARRAY(SELECT id::text FROM public.commission_ledger WHERE agent_id = $2) AS ledgers,
              ARRAY(SELECT cs.id::text FROM public.order_item_commission_snapshot AS cs
                    JOIN public.order_item AS oi ON oi.id = cs.order_item_id WHERE oi.order_id = $3) AS snapshots,
              ARRAY(SELECT id::text FROM public.file_asset
                    WHERE id::text = ANY($4::text[])
                       OR (created_by_id::text = ANY($1::text[]) AND created_at >= $5
                           AND purpose IN ('PROMOTION_QR', 'WITHDRAWAL_PROOF'))) AS files`,
      [accountIds, fixture.agentId, fixture.orderId, [fixture.qrFileId, fixture.proofFileId].filter(Boolean),
        fixture.startedAt],
    );
    const ids = dynamic.rows[0] ?? {};
    const resourceIds = [...new Set([
      ...accountIds,
      fixture.agentId, fixture.customerId, fixture.candidateId, fixture.promotionAssetId, fixture.addressId,
      fixture.orderId, fixture.paymentIntentId, fixture.shipmentId, fixture.bankAccountId,
      fixture.withdrawalId, fixture.qrFileId, fixture.proofFileId,
      fixture.brandId, fixture.categoryId, fixture.productId, fixture.skuId,
      fixture.businessRuleId, fixture.commissionRuleId,
      ...(ids.sessions ?? []), ...(ids.factors ?? []), ...(ids.challenges ?? []),
      ...(ids.candidates ?? []), ...(ids.bindings ?? []),
      ...(ids.items ?? []), ...(ids.payments ?? []), ...(ids.shipments ?? []), ...(ids.ledgers ?? []),
      ...(ids.snapshots ?? []), ...(ids.files ?? []),
    ].filter(Boolean))];
    const callbackRows = await client.query(
      `SELECT ci.id::text FROM public.callback_inbox AS ci
       JOIN public.payment_intent AS pi
         ON pi.provider = ci.provider AND pi.provider_intent_id = ci.payload->>'provider_intent_id'
       WHERE ci.received_at >= $1 AND pi.order_id = $2`, [fixture.startedAt, fixture.orderId],
    );
    const callbackIds = callbackRows.rows.map(({ id }) => id);
    residualAccountIds = accountIds;
    residualResourceIds = resourceIds;
    residualCallbackIds = callbackIds;
    residualFactorIds = ids.factors ?? [];
    residualFileIds = ids.files ?? [];
    residualItemIds = ids.items ?? [];
    residualPaymentIds = ids.payments ?? [];
    residualShipmentIds = ids.shipments ?? [];
    residualSnapshotIds = ids.snapshots ?? [];

    await client.query('DELETE FROM public.outbox_event WHERE aggregate_id::text = ANY($1::text[])', [resourceIds]);
    await client.query(
      `DELETE FROM public.idempotency_record WHERE actor_id::text = ANY($1::text[])
       OR resource_id::text = ANY($2::text[])`,
      [accountIds, resourceIds],
    );
    await client.query('DELETE FROM public.callback_inbox WHERE id::text = ANY($1::text[])', [callbackIds]);
    await client.query(
      'DELETE FROM public.audit_log WHERE actor_account_id::text = ANY($1::text[]) OR object_id = ANY($2::text[])',
      [accountIds, resourceIds],
    );
    await client.query('DELETE FROM public.high_risk_operation_preview WHERE actor_account_id = $1',
      [fixture.adminAccountId]);
    await client.query('DELETE FROM public.admin_reauth_grant WHERE account_id = $1', [fixture.adminAccountId]);
    await client.query('DELETE FROM public.admin_reauth_attempt WHERE account_id = $1', [fixture.adminAccountId]);
    await client.query('DELETE FROM public.mfa_challenge WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.totp_recovery_code WHERE factor_id::text = ANY($1::text[])', [ids.factors ?? []]);
    await client.query('DELETE FROM public.auth_session WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.totp_factor WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.mfa_rate_limit WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.consent_record WHERE account_id::text = ANY($1::text[])', [accountIds]);

    await client.query('DELETE FROM public.withdrawal_proof WHERE withdrawal_id = $1', [fixture.withdrawalId]);
    await client.query('DELETE FROM public.commission_ledger WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.withdrawal_bank_snapshot WHERE withdrawal_id = $1', [fixture.withdrawalId]);
    await client.query('DELETE FROM public.withdrawal WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.agent_bank_account WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.logistics_event WHERE shipment_id::text = ANY($1::text[])', [ids.shipments ?? []]);
    await client.query('DELETE FROM public.shipment_item WHERE shipment_id::text = ANY($1::text[])', [ids.shipments ?? []]);
    await client.query('DELETE FROM public.shipment WHERE order_id = $1', [fixture.orderId]);
    await client.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id::text = ANY($1::text[])', [ids.payments ?? []]);
    await client.query('DELETE FROM public.payment_intent WHERE order_id = $1', [fixture.orderId]);
    await client.query(
      `DELETE FROM public.order_item_commission_position WHERE snapshot_id IN
       (SELECT cs.id FROM public.order_item_commission_snapshot AS cs
        JOIN public.order_item AS oi ON oi.id = cs.order_item_id WHERE oi.order_id = $1)`, [fixture.orderId]);
    await client.query(
      `DELETE FROM public.order_item_commission_snapshot WHERE order_item_id IN
       (SELECT id FROM public.order_item WHERE order_id = $1)`, [fixture.orderId]);
    await client.query(
      `DELETE FROM public.agent_customer_privacy_projection WHERE attribution_snapshot_id IN
       (SELECT id FROM public.order_attribution_snapshot WHERE order_id = $1)`, [fixture.orderId]);
    await client.query(
      `DELETE FROM public.inventory_reservation_item WHERE reservation_id IN
       (SELECT id FROM public.inventory_reservation WHERE order_id = $1)`, [fixture.orderId]);
    await client.query('DELETE FROM public.inventory_reservation WHERE order_id = $1', [fixture.orderId]);
    await client.query('DELETE FROM public.order_attribution_snapshot WHERE order_id = $1', [fixture.orderId]);
    await client.query('DELETE FROM public.order_attribution_candidate WHERE order_id = $1', [fixture.orderId]);
    await client.query('DELETE FROM public.order_address_snapshot WHERE order_id = $1', [fixture.orderId]);
    await client.query('DELETE FROM public.order_item WHERE order_id = $1', [fixture.orderId]);
    await client.query('DELETE FROM public.sales_order WHERE id = $1', [fixture.orderId]);
    await client.query('DELETE FROM public.binding_change_log WHERE customer_id = $1', [fixture.customerId]);
    await client.query('DELETE FROM public.customer_agent_binding WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.attribution_candidate WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.promotion_asset WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.agent_invite_code WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.agent_product_whitelist WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.customer_address WHERE customer_id = $1', [fixture.customerId]);
    await client.query('DELETE FROM public.inventory_ledger WHERE sku_id = $1', [fixture.skuId]);
    await client.query('DELETE FROM public.inventory_balance WHERE sku_id = $1', [fixture.skuId]);
    await client.query('DELETE FROM public.sku WHERE id = $1', [fixture.skuId]);
    await client.query('DELETE FROM public.product WHERE id = $1', [fixture.productId]);
    await client.query('DELETE FROM public.file_asset WHERE id::text = ANY($1::text[])', [ids.files ?? []]);
    await client.query('DELETE FROM public.brand WHERE id = $1', [fixture.brandId]);
    await client.query('DELETE FROM public.category WHERE id = $1', [fixture.categoryId]);
    await client.query('ALTER TABLE public.commission_rule_entry DISABLE TRIGGER trg_commission_rule_entry_append_only');
    await client.query('DELETE FROM public.commission_rule_entry WHERE rule_version_id = $1', [fixture.commissionRuleId]);
    await client.query('ALTER TABLE public.commission_rule_entry ENABLE TRIGGER trg_commission_rule_entry_append_only');
    await client.query('DELETE FROM public.commission_rule_version WHERE id = $1', [fixture.commissionRuleId]);
    await client.query('DELETE FROM public.business_rule_version WHERE id = $1', [fixture.businessRuleId]);
    await client.query('DELETE FROM public.sales_daily_aggregate WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.agent_wallet WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.agent_profile WHERE id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.customer_profile WHERE id = $1', [fixture.customerId]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [accountIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const residual = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM public.account WHERE id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.auth_session WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.totp_factor WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.totp_recovery_code WHERE factor_id::text = ANY($3::text[])) +
       (SELECT COUNT(*) FROM public.mfa_challenge WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.mfa_rate_limit WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.admin_reauth_attempt WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.admin_reauth_grant WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.high_risk_operation_preview WHERE actor_account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.consent_record WHERE account_id::text = ANY($1::text[])) +
       (SELECT COUNT(*) FROM public.audit_log
        WHERE actor_account_id::text = ANY($1::text[]) OR object_id = ANY($2::text[])) +
       (SELECT COUNT(*) FROM public.idempotency_record
        WHERE actor_id::text = ANY($1::text[]) OR resource_id::text = ANY($2::text[])) +
       (SELECT COUNT(*) FROM public.outbox_event WHERE aggregate_id::text = ANY($2::text[])) +
       (SELECT COUNT(*) FROM public.callback_inbox WHERE id::text = ANY($4::text[])) +
       (SELECT COUNT(*) FROM public.withdrawal_proof WHERE withdrawal_id = $9) +
       (SELECT COUNT(*) FROM public.commission_ledger WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.withdrawal_bank_snapshot WHERE withdrawal_id = $9) +
       (SELECT COUNT(*) FROM public.withdrawal WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.agent_bank_account WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.logistics_event WHERE shipment_id::text = ANY($7::text[])) +
       (SELECT COUNT(*) FROM public.shipment_item WHERE shipment_id::text = ANY($7::text[])) +
       (SELECT COUNT(*) FROM public.shipment WHERE id::text = ANY($7::text[])) +
       (SELECT COUNT(*) FROM public.payment_attempt WHERE payment_intent_id::text = ANY($6::text[])) +
       (SELECT COUNT(*) FROM public.payment_intent WHERE id::text = ANY($6::text[])) +
       (SELECT COUNT(*) FROM public.order_item_commission_position WHERE snapshot_id::text = ANY($8::text[])) +
       (SELECT COUNT(*) FROM public.order_item_commission_snapshot WHERE id::text = ANY($8::text[])) +
       (SELECT COUNT(*) FROM public.order_item WHERE id::text = ANY($5::text[])) +
       (SELECT COUNT(*) FROM public.inventory_reservation WHERE order_id = $11) +
       (SELECT COUNT(*) FROM public.order_attribution_snapshot WHERE order_id = $11) +
       (SELECT COUNT(*) FROM public.order_attribution_candidate WHERE order_id = $11) +
       (SELECT COUNT(*) FROM public.order_address_snapshot WHERE order_id = $11) +
       (SELECT COUNT(*) FROM public.sales_order WHERE id = $11) +
       (SELECT COUNT(*) FROM public.binding_change_log WHERE customer_id = $12) +
       (SELECT COUNT(*) FROM public.customer_agent_binding WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.attribution_candidate WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.promotion_asset WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.agent_invite_code WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.agent_product_whitelist WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.customer_address WHERE customer_id = $12) +
       (SELECT COUNT(*) FROM public.file_asset WHERE id::text = ANY($13::text[])) +
       (SELECT COUNT(*) FROM public.inventory_ledger WHERE sku_id = $14) +
       (SELECT COUNT(*) FROM public.inventory_balance WHERE sku_id = $14) +
       (SELECT COUNT(*) FROM public.sku WHERE id = $14) +
       (SELECT COUNT(*) FROM public.product WHERE id = $15) +
       (SELECT COUNT(*) FROM public.brand WHERE id = $16) +
       (SELECT COUNT(*) FROM public.category WHERE id = $17) +
       (SELECT COUNT(*) FROM public.commission_rule_entry WHERE rule_version_id = $18) +
       (SELECT COUNT(*) FROM public.commission_rule_version WHERE id = $18) +
       (SELECT COUNT(*) FROM public.business_rule_version WHERE id = $19) +
       (SELECT COUNT(*) FROM public.sales_daily_aggregate WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.agent_wallet WHERE agent_id = $10) +
       (SELECT COUNT(*) FROM public.agent_profile WHERE id = $10) +
       (SELECT COUNT(*) FROM public.customer_profile WHERE id = $12) AS count`,
    [residualAccountIds, residualResourceIds, residualFactorIds, residualCallbackIds,
      residualItemIds, residualPaymentIds, residualShipmentIds, residualSnapshotIds,
      fixture.withdrawalId, fixture.agentId, fixture.orderId, fixture.customerId, residualFileIds,
      fixture.skuId, fixture.productId, fixture.brandId, fixture.categoryId,
      fixture.commissionRuleId, fixture.businessRuleId],
  );
  assert(Number(residual.rows[0]?.count) === 0, 'B13 PostgreSQL fixture or diagnostic residue remains after cleanup');
}

async function cleanupObjects(pool, fixture) {
  const { DeleteObjectCommand, HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  await discoverFixture(pool, fixture);
  const fileIds = [...new Set([
    ...(fixture.fileIds ?? []), fixture.qrFileId, fixture.proofFileId,
  ].filter(Boolean))];
  const objectKeys = [...new Set([
    ...(fixture.objectKeys ?? []),
    ...fileIds.flatMap((id) => [`staging/${id}`, `private/${id}`]),
  ])];
  for (const key of objectKeys) {
    await storageClient().send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: key }));
    try {
      await storageClient().send(new HeadObjectCommand({ Bucket: required('S3_BUCKET'), Key: key }));
      throw new Error('B13 MinIO fixture object remains after cleanup');
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') {
        throw error;
      }
    }
  }
}

async function main() {
  const ports = validateTargets();
  const { apiPort, workerPort } = ports;
  for (const [label, port] of [
    ['API', apiPort], ['Worker', workerPort], ['Admin Web', ports.adminPort],
    ['Agent Web', ports.agentPort], ['Miniapp', ports.miniappPort],
  ]) {
    if (!await portAvailable(port)) refuse(`${label} port ${port} is already in use`);
  }
  const minioReady = await globalThis.fetch(new URL('/minio/health/ready', required('S3_ENDPOINT')), {
    signal: globalThis.AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!minioReady?.ok) refuse('MinIO readiness endpoint is unavailable');

  let databaseExports;
  let platformExports;
  try {
    databaseExports = require('../../packages/database/dist/src/index.js');
    platformExports = require('../../packages/platform-core/dist/index.js');
  } catch {
    refuse('workspace package dist is missing; run the existing package build stage before B13 vertical');
  }
  const { AdminAuthRepository, createDatabaseRuntime } = databaseExports;
  const { generateUlid, hashPassword, sha256Hex } = platformExports;
  const fixture = createFixture(generateUlid, sha256Hex);
  const protectedValues = new Set([
    ...environmentProtectedValues(),
    fixture.adminLogin, fixture.adminPassword, fixture.agentLogin, fixture.agentPassword,
    fixture.bankAccountHolder, fixture.bankName, fixture.bankAccountNumber, fixture.loginCode,
    fixture.rawAddress, fixture.rawPhone,
    fixture.rawRecipient, fixture.wechatOpenId,
  ]);
  diagnosticProtectedValues = protectedValues;
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b13-vertical-runner',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 2,
  });
  let redis;
  let api;
  let worker;
  let cleanupRequired = false;
  let redisCleanupRequired = false;
  let primaryError;
  const cleanupErrors = [];
  try {
    redis = await connectRedis();
    const initialRedis = await redisKeys(redis);
    if (initialRedis.length !== 0) refuse('the isolated Redis database is not empty before the test');
    redisCleanupRequired = true;
    cleanupRequired = true;
    await seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture);
    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const workerOrigin = `http://127.0.0.1:${workerPort}`;
    api = startProcess('API', ['--filter', '@qingxu/api', 'exec', 'tsx', 'src/main.ts'],
      { API_PORT: apiPort }, protectedValues);
    worker = startProcess('Worker', ['--filter', '@qingxu/worker', 'exec', 'tsx', 'src/main.ts'],
      { WORKER_POLL_INTERVAL_MS: '100', WORKER_PORT: workerPort }, protectedValues);
    await Promise.all([
      waitForHealth(apiOrigin, 'api', api),
      waitForHealth(workerOrigin, 'worker', worker),
    ]);
    await runBrowserJourney(fixture, protectedValues, ports);
    await discoverFixture(pool, fixture);
    await assertFacts(pool, fixture, protectedValues);
  } catch (error) {
    primaryError = error;
  } finally {
    await Promise.all([stopProcess(api), stopProcess(worker)]);
    for (const service of [api, worker]) {
      try { service?.assertSafe(); } catch (error) { cleanupErrors.push(error); }
    }
    if (redis && redisCleanupRequired) {
      try {
        const keys = await redisKeys(redis);
        if (keys.length > 0) await redis.del(keys);
        if ((await redisKeys(redis)).length !== 0) {
          cleanupErrors.push(new Error('B13 Redis residue remains after cleanup'));
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupRequired) {
      try { await cleanupObjects(pool, fixture); } catch (error) { cleanupErrors.push(error); }
      try { await cleanupDatabase(pool, fixture); } catch (error) { cleanupErrors.push(error); }
    }
    if (redis?.isOpen) await redis.quit().catch((error) => cleanupErrors.push(error));
    await pool.end().catch((error) => cleanupErrors.push(error));
    s3Client?.destroy();
    s3Client = undefined;
  }
  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'B13 vertical journey and cleanup failed');
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'B13 vertical cleanup failed');
  process.stdout.write('B13 Admin/Agent/Store to PostgreSQL/Redis/MinIO/Worker journey passed and cleaned.\n');
}

main().catch((error) => {
  process.stderr.write(`${sanitizeDiagnostic(formatError(error), diagnosticProtectedValues)}\n`);
  process.exit(1);
});
