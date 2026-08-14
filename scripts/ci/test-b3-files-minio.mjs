import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000';
const bucket = process.env.S3_BUCKET ?? 'mall-development';
assertIsolatedTestTarget(endpoint, bucket);
const accessKey = required('S3_ACCESS_KEY');
const secretKey = required('S3_SECRET_KEY');
const rootAccessKey = required('MINIO_ROOT_USER');
const rootSecretKey = required('MINIO_ROOT_PASSWORD');
if (accessKey === rootAccessKey || secretKey === rootSecretKey) {
  throw new Error('MinIO root and S3 runtime credentials must be independent');
}
const region = process.env.S3_REGION ?? 'us-east-1';
const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true';

buildStoragePackage();
const {
  ObjectStorageError,
  S3ObjectStorage,
  fileObjectKey,
} = await import('../../packages/storage/dist/index.js');
const storageRequire = createRequire(new URL('../../packages/storage/package.json', import.meta.url));
const {
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  S3Client,
} = storageRequire('@aws-sdk/client-s3');

const storage = new S3ObjectStorage({
  endpoint,
  bucket,
  region,
  accessKey,
  secretKey,
  forcePathStyle,
  publicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? `${endpoint.replace(/\/$/, '')}/${bucket}`,
});
const adminClient = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId: rootAccessKey, secretAccessKey: rootSecretKey },
  forcePathStyle,
  maxAttempts: 1,
});
const runtimeProbeClient = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  forcePathStyle,
  maxAttempts: 1,
});

const ids = {
  public: '01K00000000000000000000001',
  private: '01K00000000000000000000002',
  forged: '01K00000000000000000000003',
  oversized: '01K00000000000000000000004',
  mismatch: '01K00000000000000000000005',
  expired: '01K00000000000000000000006',
};
const allKeys = Object.values(ids).flatMap((id) => [
  fileObjectKey('staging', id),
  fileObjectKey('public', id),
  fileObjectKey('private', id),
]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function buildStoragePackage() {
  const child = spawnSync('pnpm', ['--filter', '@qingxu/storage', 'build'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) {
    throw new Error('Failed to build @qingxu/storage for real MinIO checks');
  }
}

function assertIsolatedTestTarget(rawEndpoint, targetBucket) {
  if (process.env.CI !== 'true' || process.env.B3_MINIO_TEST_MODE !== 'full') {
    throw new Error('Real MinIO checks require CI=true and B3_MINIO_TEST_MODE=full');
  }
  let parsed;
  try {
    parsed = new URL(rawEndpoint);
  } catch {
    throw new Error('S3_ENDPOINT must be a valid URL');
  }
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Real MinIO checks are restricted to loopback HTTP');
  }
  if (!/^mall-b3-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(targetBucket)) {
    throw new Error('Real MinIO checks require an isolated mall-b3-{ci,local,test} bucket');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStorageError(work, code) {
  try {
    await work();
  } catch (error) {
    if (error instanceof ObjectStorageError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected storage error ${code}`);
}

async function put(
  key,
  bytes,
  mimeType,
  expectedSha256 = sha256(bytes),
  expiresInSeconds = 60,
  declaredByteSize = bytes.length,
) {
  const signed = await storage.presignPut({
    key,
    byteSize: declaredByteSize,
    mimeType,
    sha256Hex: expectedSha256,
    expiresInSeconds,
  });
  const headers = Object.fromEntries(signed.headers.map(({ name, value }) => [name, value]));
  return fetch(signed.url, { method: 'PUT', headers, body: bytes });
}

async function cleanup() {
  await Promise.all(allKeys.map(async (key) => {
    try {
      await storage.deleteIfExists(key);
    } catch {
      // The runner reports assertion failures; cleanup remains best effort.
    }
  }));
}

async function assertExactPublicReadPolicy() {
  const response = await adminClient.send(
    new GetBucketPolicyCommand({ Bucket: bucket }),
    { abortSignal: AbortSignal.timeout(10_000) },
  );
  const policy = JSON.parse(response.Policy ?? '{}');
  expect(policy.Version === '2012-10-17', 'anonymous bucket policy version differs');
  expect(Array.isArray(policy.Statement) && policy.Statement.length === 1,
    'anonymous bucket policy must contain exactly one statement');
  const [statement] = policy.Statement;
  expect(statement?.Effect === 'Allow', 'anonymous bucket policy effect differs');
  expect(JSON.stringify(statement?.Principal) === JSON.stringify({ AWS: ['*'] }),
    'anonymous bucket policy principal differs');
  expect(JSON.stringify(statement?.Action) === JSON.stringify(['s3:GetObject']),
    'anonymous bucket policy must grant only GetObject');
  expect(JSON.stringify(statement?.Resource) === JSON.stringify([
    `arn:aws:s3:::${bucket}/public/*`,
  ]), 'anonymous bucket policy must target only public/*');
}

async function assertNoBucketLifecycleRules() {
  try {
    const response = await adminClient.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
      { abortSignal: AbortSignal.timeout(10_000) },
    );
    expect(!response.Rules || response.Rules.length === 0,
      'bucket lifecycle rules must not bypass database-checked cleanup');
  } catch (error) {
    if (typeof error === 'object' && error !== null && (
      error.name === 'NoSuchLifecycleConfiguration' || error.$metadata?.httpStatusCode === 404
    )) return;
    throw error;
  }
}

function isAccessDenied(error) {
  return typeof error === 'object' && error !== null && (
    error.name === 'AccessDenied' || error.$metadata?.httpStatusCode === 403
  );
}

async function expectAccessDenied(work, label) {
  try {
    await work();
  } catch (error) {
    if (isAccessDenied(error)) return;
    throw error;
  }
  throw new Error(`S3 runtime identity unexpectedly allowed ${label}`);
}

async function assertRuntimeCannotAdministerBucket() {
  const options = { abortSignal: AbortSignal.timeout(10_000) };
  await expectAccessDenied(
    () => runtimeProbeClient.send(new GetBucketPolicyCommand({ Bucket: bucket }), options),
    'GetBucketPolicy',
  );
  await expectAccessDenied(
    () => runtimeProbeClient.send(new ListObjectsV2Command({ Bucket: bucket }), options),
    'ListBucket',
  );
  await expectAccessDenied(
    () => runtimeProbeClient.send(new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Statement: [{
          Action: ['s3:GetObject'],
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Resource: [`arn:aws:s3:::${bucket}/public/*`],
        }],
        Version: '2012-10-17',
      }),
    }), options),
    'PutBucketPolicy',
  );
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('b3-real-minio'),
]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('b3-real-minio')]);

await cleanup();
try {
  await assertExactPublicReadPolicy();
  await assertNoBucketLifecycleRules();
  await assertRuntimeCannotAdministerBucket();

  const publicStagingKey = fileObjectKey('staging', ids.public);
  const publicKey = fileObjectKey('public', ids.public);
  expect((await put(publicStagingKey, png, 'image/png')).ok, 'signed PNG upload failed');
  const inspectedPublic = await storage.inspectAndHash({ key: publicStagingKey, maxBytes: 5_242_880 });
  expect(inspectedPublic.byteSize === png.length, 'measured PNG size differs');
  expect(inspectedPublic.sha256Hex === sha256(png), 'measured PNG SHA-256 differs');
  const copiedPublic = await storage.copyIfAbsent({
    sourceKey: publicStagingKey,
    destinationKey: publicKey,
    ...inspectedPublic,
  });
  expect(copiedPublic.verified.sha256Hex === inspectedPublic.sha256Hex, 'final PNG verification differs');
  const secondCopy = await storage.copyIfAbsent({
    sourceKey: publicStagingKey,
    destinationKey: publicKey,
    ...inspectedPublic,
  });
  expect(secondCopy.copied === false, 'second exact copy must converge without replacing data');
  const publicResponse = await fetch(storage.publicUrl(publicKey));
  expect(publicResponse.ok, `public object anonymous GET returned ${publicResponse.status}`);
  expect(Buffer.from(await publicResponse.arrayBuffer()).equals(png), 'public object bytes differ');

  const privateStagingKey = fileObjectKey('staging', ids.private);
  const privateKey = fileObjectKey('private', ids.private);
  expect((await put(privateStagingKey, jpeg, 'image/jpeg')).ok, 'signed JPEG upload failed');
  const inspectedPrivate = await storage.inspectAndHash({ key: privateStagingKey, maxBytes: 5_242_880 });
  await storage.copyIfAbsent({
    sourceKey: privateStagingKey,
    destinationKey: privateKey,
    ...inspectedPrivate,
  });
  const anonymousPrivate = await fetch(`${endpoint.replace(/\/$/, '')}/${bucket}/${privateKey}`);
  expect(!anonymousPrivate.ok, 'private object unexpectedly allows anonymous GET');
  const anonymousStaging = await fetch(`${endpoint.replace(/\/$/, '')}/${bucket}/${privateStagingKey}`);
  expect(!anonymousStaging.ok, 'staging object unexpectedly allows anonymous GET');
  const anonymousBucketList = await fetch(
    `${endpoint.replace(/\/$/, '')}/${bucket}?list-type=2&prefix=public%2F`,
  );
  expect(!anonymousBucketList.ok, 'bucket unexpectedly allows anonymous ListBucket');
  const signedPrivate = await storage.presignGet(privateKey, 300);
  expect((await fetch(signedPrivate.url)).ok, 'private signed GET failed');

  const forgedKey = fileObjectKey('staging', ids.forged);
  const forged = Buffer.from('not-a-real-png');
  expect((await put(forgedKey, forged, 'image/png')).ok, 'forged MIME fixture upload failed');
  await expectStorageError(
    () => storage.inspectAndHash({ key: forgedKey, maxBytes: 5_242_880 }),
    'OBJECT_CONTENT_MISMATCH',
  );

  const oversizedKey = fileObjectKey('staging', ids.oversized);
  const oversized = Buffer.alloc(5_242_881, 0x61);
  oversized.set(png.subarray(0, 8));
  const oversizedResponse = await put(
    oversizedKey,
    oversized,
    'image/png',
    sha256(oversized),
    60,
    png.length,
  );
  expect(!oversizedResponse.ok, 'body larger than the signed intent size unexpectedly uploaded');
  await expectStorageError(
    () => storage.inspectAndHash({ key: oversizedKey, maxBytes: 5_242_880 }),
    'OBJECT_NOT_FOUND',
  );

  const mismatchKey = fileObjectKey('staging', ids.mismatch);
  expect((await put(mismatchKey, png, 'image/png', 'f'.repeat(64))).ok, 'hash mismatch fixture upload failed');
  const inspectedMismatch = await storage.inspectAndHash({ key: mismatchKey, maxBytes: 5_242_880 });
  expect(inspectedMismatch.sha256Hex !== 'f'.repeat(64), 'server measurement trusted declared SHA-256');

  const mutationKey = fileObjectKey('staging', ids.mismatch);
  const beforeMutation = await storage.inspectAndHash({ key: mutationKey, maxBytes: 5_242_880 });
  expect((await put(mutationKey, jpeg, 'image/jpeg')).ok, 'source mutation fixture upload failed');
  await expectStorageError(
    () => storage.copyIfAbsent({
      sourceKey: mutationKey,
      destinationKey: fileObjectKey('private', ids.mismatch),
      ...beforeMutation,
    }),
    'OBJECT_CONTENT_MISMATCH',
  );

  const expiredKey = fileObjectKey('staging', ids.expired);
  const expired = await storage.presignPut({
    key: expiredKey,
    byteSize: png.length,
    mimeType: 'image/png',
    sha256Hex: sha256(png),
    expiresInSeconds: 1,
  });
  await delay(2_100);
  const expiredHeaders = Object.fromEntries(expired.headers.map(({ name, value }) => [name, value]));
  const expiredResponse = await fetch(expired.url, { method: 'PUT', headers: expiredHeaders, body: png });
  expect(!expiredResponse.ok, 'expired upload signature unexpectedly succeeded');

  const corsPreflight = await fetch(`${endpoint.replace(/\/$/, '')}/${bucket}/${publicKey}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5175',
      'Access-Control-Request-Headers': 'content-type,x-amz-meta-sha256',
      'Access-Control-Request-Method': 'PUT',
    },
  });
  expect(corsPreflight.ok, `allowed CORS preflight returned ${corsPreflight.status}`);
  expect(corsPreflight.headers.get('access-control-allow-origin') === 'http://127.0.0.1:5175',
    'allowed admin-web origin was not echoed');
  const rejectedCors = await fetch(`${endpoint.replace(/\/$/, '')}/${bucket}/${publicKey}`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example.test',
      'Access-Control-Request-Method': 'PUT',
    },
  });
  expect(rejectedCors.headers.get('access-control-allow-origin') === null,
    'untrusted CORS origin unexpectedly received an allow-origin header');

  process.stdout.write('B3.1 real MinIO checks passed.\n');
} finally {
  await cleanup();
  adminClient.destroy();
  runtimeProbeClient.destroy();
}
