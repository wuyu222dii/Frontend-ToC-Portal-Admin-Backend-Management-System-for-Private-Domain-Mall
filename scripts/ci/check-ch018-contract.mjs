import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const specificationPath = join(repositoryRoot, 'product-materials/docs/03-技术设计/openapi.yaml');
const generatedContractPath = join(repositoryRoot, 'packages/contracts/src/generated/openapi.ts');
const redoclyCli = join(repositoryRoot, 'node_modules/@redocly/cli/bin/cli.js');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-ch018-contract-'));
const bundledPath = join(temporaryDirectory, 'openapi.json');

const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const MASTER_DATA_PATHS = [
  '/admin/brands/{brand_id}/lifecycle-preview',
  '/admin/brands/{brand_id}/lifecycle-changes',
  '/admin/categories/{category_id}/lifecycle-preview',
  '/admin/categories/{category_id}/lifecycle-changes',
];
const PRODUCT_LIFECYCLE_PATHS = [
  '/admin/products/{product_id}/lifecycle-preview',
  '/admin/products/{product_id}/lifecycle-changes',
];
const SKU_LIFECYCLE_PATHS = [
  '/admin/skus/{sku_id}/lifecycle-preview',
  '/admin/skus/{sku_id}/lifecycle-changes',
];
const LIFECYCLE_PATHS = [
  ...MASTER_DATA_PATHS,
  ...PRODUCT_LIFECYCLE_PATHS,
  ...SKU_LIFECYCLE_PATHS,
];
const LIFECYCLE_CONFIRM_PATHS = LIFECYCLE_PATHS.filter((path) => path.endsWith('/lifecycle-changes'));
const PRODUCT_SKU_RESTORE_PATHS = [
  '/admin/products/{product_id}/restore',
  '/admin/skus/{sku_id}/restore',
];
const PUBLIC_STORE_CATALOG_PATHS = [
  '/store/home',
  '/store/categories',
  '/store/brands',
  '/store/products',
  '/store/products/{product_id}',
];
const ULID_PATTERN = '^[0-9A-HJKMNP-TV-Z]{26}$';

function collectReferences(value, references = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
    return references;
  }
  if (!value || typeof value !== 'object') return references;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string') references.push(child);
    else collectReferences(child, references);
  }
  return references;
}

function resolveLocalReference(document, reference) {
  assert.match(reference, /^#\//, `external reference is not allowed: ${reference}`);
  return reference.slice(2).split('/').reduce((current, encodedPart) => {
    const part = encodedPart.replaceAll('~1', '/').replaceAll('~0', '~');
    assert.ok(current && Object.hasOwn(current, part), `dangling reference: ${reference}`);
    return current[part];
  }, document);
}

function generatedTypeBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `generated contract is missing ${startMarker.trim()}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `generated contract is missing ${endMarker.trim()}`);
  return source.slice(start, end);
}

function requestSchema(document, path) {
  const schema = document.paths[path]?.post?.requestBody?.content?.['application/json']?.schema;
  assert.ok(schema, `missing JSON request schema for POST ${path}`);
  return schema;
}

function firstSchemaReference(document, path) {
  const schema = requestSchema(document, path);
  return schema.$ref ?? schema.allOf?.[0]?.$ref;
}

function operationParameterReferences(document, path) {
  return (document.paths[path]?.post?.parameters ?? [])
    .map((parameter) => parameter.$ref)
    .filter((reference) => typeof reference === 'string');
}

function parameterReferences(operation) {
  return (operation?.parameters ?? [])
    .map((parameter) => parameter.$ref)
    .filter((reference) => typeof reference === 'string');
}

function assertStoreNoStore(successResponse, label) {
  assert.equal(successResponse?.headers?.['Cache-Control']?.$ref,
    '#/components/headers/StoreCacheControlNoStoreRequired',
    `${label} must return required Store Cache-Control: no-store`);
  assert.equal(successResponse?.headers?.Pragma?.$ref,
    '#/components/headers/StorePragmaNoCacheRequired',
    `${label} must return required Store Pragma: no-cache`);
}

function assertInlineStoreNoStore(response, label) {
  assert.equal(response?.headers?.['Cache-Control']?.required, true,
    `${label} must require Cache-Control`);
  assert.equal(response?.headers?.['Cache-Control']?.schema?.const, 'no-store, private',
    `${label} must return Cache-Control: no-store, private`);
  assert.equal(response?.headers?.Pragma?.required, true,
    `${label} must require Pragma`);
  assert.equal(response?.headers?.Pragma?.schema?.const, 'no-cache',
    `${label} must return Pragma: no-cache`);
}

function assertClosedStoreErrorResponse(response, expectedCodeSchema, label) {
  assertInlineStoreNoStore(response, label);
  const schema = response?.content?.['application/json']?.schema;
  assert.equal(schema?.type, 'object', `${label} must use an inline object schema`);
  assert.equal(schema?.additionalProperties, false, `${label} must be closed`);
  assert.deepEqual(schema?.required, ['code', 'message', 'request_id'],
    `${label} required fields drifted`);
  assert.deepEqual(schema?.properties?.code, expectedCodeSchema,
    `${label} code contract drifted`);
  assert.deepEqual(schema?.properties?.message, { type: 'string' });
  assert.deepEqual(schema?.properties?.request_id, { type: 'string' });
  const detail = schema?.properties?.details?.items;
  assert.equal(detail?.additionalProperties, false, `${label} details must be closed`);
  assert.deepEqual(detail?.required, ['field', 'reason']);
  assert.deepEqual(detail?.properties?.field?.type, ['string', 'null']);
  assert.deepEqual(detail?.properties?.reason, { type: 'string' });
  assert.deepEqual(detail?.properties?.rejected_value, { type: 'null' },
    `${label} must not echo rejected values`);
}

function assertLifecycleActionSchema(schema, schemaName) {
  assert.deepEqual(schema.required, ['action', 'reason'], `${schemaName} required fields drifted`);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['action', 'reason'],
    `${schemaName} must declare only action and reason`);
  assert.deepEqual(schema.properties.action.enum, ['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
  assert.equal(schema.properties.reason.minLength, 2);
  assert.equal(schema.properties.reason.maxLength, 500);
}

const BANNER_TARGET_FIELDS = ['target_type', 'target_id', 'target_url'];
const BANNER_TARGET_VARIANTS = [
  {
    target_type: { const: 'NONE' },
    target_id: { type: 'null' },
    target_url: { type: 'null' },
  },
  {
    target_type: { const: 'PRODUCT' },
    target_id: { type: 'string' },
    target_url: { type: 'null' },
  },
  {
    target_type: { const: 'CATEGORY' },
    target_id: { type: 'string' },
    target_url: { type: 'null' },
  },
  {
    target_type: { const: 'URL' },
    target_id: { type: 'null' },
    target_url: { type: 'string', format: 'uri', pattern: '^https://', maxLength: 500 },
  },
];

function bannerTargetVariantMatches(variant, candidate) {
  return variant.required.every((field) => Object.hasOwn(candidate, field)) &&
    Object.entries(variant.properties).every(([field, property]) => {
      const value = candidate[field];
      if (Object.hasOwn(property, 'const') && value !== property.const) return false;
      if (property.type === 'null') return value === null;
      if (property.type === 'string' && typeof value !== 'string') return false;
      if (property.pattern && !new RegExp(property.pattern).test(value)) return false;
      if (property.maxLength && value.length > property.maxLength) return false;
      return true;
    });
}

function assertClosedBannerViewSchema(schema, baseFields, schemaName) {
  assert.equal(schema.type, 'object');
  assert.equal(schema.unevaluatedProperties, false,
    `${schemaName} must reject fields not evaluated by its base or target branch`);
  assert.equal(schema.allOf?.length, 2, `${schemaName} must combine base fields and one target union`);
  const [base, targetUnion] = schema.allOf;
  assert.deepEqual(base.required, baseFields, `${schemaName} base required fields drifted`);
  assert.deepEqual(Object.keys(base.properties), baseFields, `${schemaName} base fields drifted`);
  assert.equal(targetUnion.oneOf?.length, 4, `${schemaName} must close all four target variants`);
  for (const [index, variant] of targetUnion.oneOf.entries()) {
    assert.deepEqual(variant.required, BANNER_TARGET_FIELDS,
      `${schemaName} target branch ${index} required fields drifted`);
    assert.deepEqual(Object.keys(variant.properties), BANNER_TARGET_FIELDS,
      `${schemaName} target branch ${index} fields drifted`);
    assert.deepEqual(variant.properties, BANNER_TARGET_VARIANTS[index],
      `${schemaName} target branch ${index} constraints drifted`);
  }

  const legalTargets = [
    { target_type: 'NONE', target_id: null, target_url: null },
    { target_type: 'PRODUCT', target_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', target_url: null },
    { target_type: 'CATEGORY', target_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', target_url: null },
    { target_type: 'URL', target_id: null, target_url: 'https://mall.example.test/catalog' },
  ];
  const invalidTargets = [
    { target_type: 'NONE', target_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', target_url: null },
    { target_type: 'PRODUCT', target_id: null, target_url: null },
    { target_type: 'CATEGORY', target_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', target_url: 'https://mall.example.test' },
    { target_type: 'URL', target_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', target_url: 'https://mall.example.test' },
    { target_type: 'URL', target_id: null, target_url: 'http://mall.example.test' },
  ];
  for (const target of legalTargets) {
    assert.equal(targetUnion.oneOf.filter((variant) => bannerTargetVariantMatches(variant, target)).length, 1,
      `${schemaName} must accept exactly one branch for ${JSON.stringify(target)}`);
  }
  for (const target of invalidTargets) {
    assert.equal(targetUnion.oneOf.filter((variant) => bannerTargetVariantMatches(variant, target)).length, 0,
      `${schemaName} must reject ${JSON.stringify(target)}`);
  }
}

try {
  const bundle = spawnSync(
    process.execPath,
    [redoclyCli, 'bundle', specificationPath, '--ext', 'json', '--output', bundledPath],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  if (bundle.status !== 0) {
    process.stderr.write(bundle.stdout);
    process.stderr.write(bundle.stderr);
    process.exit(bundle.status ?? 1);
  }

  const document = JSON.parse(readFileSync(bundledPath, 'utf8'));
  const generatedContract = readFileSync(generatedContractPath, 'utf8');
  assert.equal(document.info.version, '2.4.6-ch018');

  const pathCount = Object.keys(document.paths).length;
  const operations = Object.values(document.paths).flatMap((pathItem) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([, operation]) => operation),
  );
  const operationIds = operations.map((operation) => operation.operationId);
  assert.equal(pathCount, 173, 'OpenAPI path count drifted');
  assert.equal(operations.length, 198, 'OpenAPI operation count drifted');
  assert.equal(new Set(operationIds).size, 198, 'operationId values must be unique');
  assert.ok(operationIds.every((operationId) => typeof operationId === 'string' && operationId.length > 0));

  const ulidPathParameterNames = new Set(['product_id', 'sku_id', 'address_id']);
  for (const [path, pathItem] of Object.entries(document.paths)) {
    const pathParameterNames = [...path.matchAll(/\{([^}]+)\}/g)]
      .map((match) => match[1])
      .filter((name) => ulidPathParameterNames.has(name));
    if (pathParameterNames.length === 0) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
        .map((parameter) => parameter.$ref
          ? resolveLocalReference(document, parameter.$ref)
          : parameter);
      for (const name of pathParameterNames) {
        const parameter = parameters.find((candidate) =>
          candidate.in === 'path' && candidate.name === name);
        assert.ok(parameter,
          `${method.toUpperCase()} ${path} must declare path parameter ${name}`);
        const schema = parameter.schema?.$ref
          ? resolveLocalReference(document, parameter.schema.$ref)
          : parameter.schema;
        assert.equal(schema?.pattern, ULID_PATTERN,
          `${method.toUpperCase()} ${path} ${name} must use the ULID pattern`);
      }
    }
  }

  const adminProductKeyword = document.paths['/admin/products'].get.parameters
    .find((parameter) => parameter.name === 'keyword');
  assert.deepEqual(
    adminProductKeyword?.schema,
    { type: 'string', minLength: 1, maxLength: 200 },
    'Admin product keyword must remain bounded to the implemented query limit',
  );

  const schemas = document.components.schemas;
  assert.equal(Object.keys(schemas).length, 323, 'OpenAPI schema count drifted');
  assert.equal(document.components.headers.CacheControlNoStore.required, undefined,
    'legacy non-Store no-store wire must remain optional');
  assert.equal(document.components.headers.PragmaNoCache.required, undefined,
    'legacy non-Store no-cache wire must remain optional');
  assert.equal(document.components.headers.StoreCacheControlNoStoreRequired.required, true);
  assert.equal(document.components.headers.StorePragmaNoCacheRequired.required, true);
  const sensitiveFieldPolicy = schemas.ErrorDetail['x-sensitive-field-policy'];
  assert.deepEqual(sensitiveFieldPolicy['forbidden-rejected-value-fields'], [
    'password', 'new_password', 'totp_code', 'recovery_code', 'code',
    'candidate_token', 'provider_credential', 'invite_code', 'preview_token',
    'confirmation_hash', 'refresh_token', 'access_token', 'reauth_grant',
  ]);
  assert.match(schemas.ErrorDetail.properties.rejected_value.description,
    /必须省略 rejected_value 或返回 null/);

  const legalOperation = document.paths['/store/legal-documents']?.get;
  assert.ok(legalOperation, 'public legal document operation is missing');
  assert.deepEqual(legalOperation.security, []);
  assert.deepEqual(legalOperation.parameters, []);
  assert.equal(legalOperation.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/LegalDocumentsResponse');
  assert.equal(legalOperation.responses['429'].$ref,
    '#/components/responses/StoreLegalRateLimited');
  assertStoreNoStore(legalOperation.responses['200'], 'GET /store/legal-documents');
  assert.match(legalOperation.description, /三份文档|用户协议、隐私政策和手机号授权文档/);
  assert.match(legalOperation.description, /独立于匿名目录/);
  assert.match(legalOperation.description, /来源 IP 的 HMAC/);
  assert.match(legalOperation.description, /每 60 秒最多 120 次/);
  assert.match(legalOperation.description, /fail closed/);

  const legalResponse = schemas.LegalDocumentsResponse;
  assert.equal(legalResponse.additionalProperties, false);
  const legalData = legalResponse.properties.data;
  assert.equal(legalData.additionalProperties, false);
  assert.deepEqual(legalData.required,
    ['user_agreement', 'privacy_policy', 'phone_authorization']);
  assert.deepEqual(Object.keys(legalData.properties),
    ['user_agreement', 'privacy_policy', 'phone_authorization']);
  for (const [field, type] of [
    ['user_agreement', 'USER_AGREEMENT'],
    ['privacy_policy', 'PRIVACY_POLICY'],
    ['phone_authorization', 'PHONE_AUTHORIZATION'],
  ]) {
    const snapshot = legalData.properties[field];
    assert.equal(snapshot.additionalProperties, false);
    assert.deepEqual(snapshot.required,
      ['type', 'document_version', 'title', 'content_url', 'required']);
    assert.deepEqual(Object.keys(snapshot.properties),
      ['type', 'document_version', 'title', 'content_url', 'required']);
    assert.deepEqual(snapshot.properties.type, { const: type });
    assert.equal(snapshot.properties.document_version.minLength, 1);
    assert.equal(snapshot.properties.document_version.maxLength, 80);
    assert.equal(snapshot.properties.title.minLength, 1);
    assert.equal(snapshot.properties.title.maxLength, 120);
    assert.equal(snapshot.properties.content_url.format, 'uri');
    assert.equal(snapshot.properties.content_url.pattern, '^https://');
    assert.equal(snapshot.properties.content_url.maxLength, 500);
    assert.deepEqual(snapshot.properties.required, { const: true });
  }
  const legalRateLimit = document.components.responses.StoreLegalRateLimited;
  assert.equal(legalRateLimit.headers['Retry-After'].required, true);
  assert.equal(legalRateLimit.headers['Retry-After'].schema.minimum, 1);
  assert.equal(legalRateLimit.headers['Retry-After'].schema.maximum, 60);
  assert.match(legalRateLimit.description, /独立 key namespace/);
  assert.match(legalRateLimit.description, /来源 IP 的 HMAC/);
  assert.match(legalRateLimit.description, /fail closed/);

  const loginOperation = document.paths['/store/auth/wechat/login'].post;
  assert.deepEqual(loginOperation.security, []);
  assert.ok(parameterReferences(loginOperation)
    .includes('#/components/parameters/IdempotencyKey'));
  assert.equal(loginOperation.responses['429'].$ref,
    '#/components/responses/StoreLoginRateLimited');
  assert.equal(loginOperation.responses['409'].$ref,
    '#/components/responses/StoreLoginConflict');
  assertStoreNoStore(loginOperation.responses['200'], 'POST /store/auth/wechat/login');
  for (const phrase of [
    /服务端按环境配置选择微信或 Mock 身份 Provider/,
    /Mock 仅允许 test\/development/,
    /固定一个消费者微信 AppID/,
    /\(AppID, openid\) 语义/,
    /wechat_open_id 仅在单 AppID 基线内唯一/,
    /wechat_union_id 仅为可空元数据/,
    /不得作为登录键或触发账号自动合并/,
    /多 AppID 必须另立变更并执行数据库迁移/,
    /HASH_ONLY/,
    /不回放 access_token、refresh_token 或候选 token/,
    /每 15 分钟最多 10 次/,
    /来源 IP HMAC/,
    /fail closed/,
    /aud=qingxu-store/,
    /role=CUSTOMER/,
    /assurance=WECHAT/,
    /Provider 不是 token claim/,
    /SUPER_ADMIN\/MFA/,
    /CONSENT_VERSION_MISMATCH/,
    /仅可迁移一次/,
  ]) assert.match(loginOperation.description, phrase);
  const loginRateLimit = document.components.responses.StoreLoginRateLimited;
  assert.equal(loginRateLimit.headers['Retry-After'].required, true);
  assert.equal(loginRateLimit.headers['Retry-After'].schema.minimum, 1);
  assert.equal(loginRateLimit.headers['Retry-After'].schema.maximum, 900);
  assert.match(loginRateLimit.description, /独立 key namespace/);
  assert.match(loginRateLimit.description, /来源 IP 的 HMAC/);
  assert.match(loginRateLimit.description, /fail closed/);

  const loginRequest = schemas.WechatLoginRequest;
  assert.equal(loginRequest.additionalProperties, false);
  assert.deepEqual(loginRequest.required, ['code', 'consents']);
  assert.deepEqual(loginRequest.properties.code,
    { type: 'string', minLength: 1, maxLength: 512, writeOnly: true });
  assert.deepEqual(loginRequest.properties.candidate_token.type, ['string', 'null']);
  assert.equal(loginRequest.properties.candidate_token.minLength, 32);
  assert.equal(loginRequest.properties.candidate_token.maxLength, 512);
  assert.equal(loginRequest.properties.candidate_token.writeOnly, true);
  const loginConsents = loginRequest.properties.consents;
  assert.equal(loginConsents.minItems, 2);
  assert.equal(loginConsents.maxItems, 2);
  assert.equal(loginConsents.items, false);
  assert.equal(loginConsents.prefixItems.length, 2);
  assert.deepEqual(loginConsents.prefixItems.map((item) => item.allOf[0].$ref), [
    '#/components/schemas/ConsentInput',
    '#/components/schemas/ConsentInput',
  ]);
  assert.deepEqual(loginConsents.prefixItems.map((item) =>
    item.allOf[1].properties.type.const), ['USER_AGREEMENT', 'PRIVACY_POLICY']);
  assert.equal(schemas.ConsentInput.additionalProperties, false);
  assert.deepEqual(schemas.ConsentInput.required, ['type', 'document_version', 'accepted']);
  assert.deepEqual(schemas.ConsentInput.properties.type.enum,
    ['USER_AGREEMENT', 'PRIVACY_POLICY', 'PHONE_AUTHORIZATION']);
  assert.equal(schemas.ConsentInput.properties.document_version.minLength, 1);
  assert.equal(schemas.ConsentInput.properties.document_version.maxLength, 80);
  assert.deepEqual(schemas.ConsentInput.properties.accepted, { const: true });

  const storeSession = schemas.StoreSessionView;
  assert.equal(storeSession.additionalProperties, false);
  assert.deepEqual(storeSession.required, [
    'access_token', 'refresh_token', 'role', 'assurance',
    'access_expires_at', 'refresh_expires_at',
  ]);
  assert.deepEqual(Object.keys(storeSession.properties), storeSession.required);
  assert.deepEqual(storeSession.properties.role, { const: 'CUSTOMER' });
  assert.deepEqual(storeSession.properties.assurance, { const: 'WECHAT' });
  assert.equal(storeSession.properties.access_expires_at.format, 'date-time');
  assert.equal(storeSession.properties.refresh_expires_at.format, 'date-time');
  assert.equal(schemas.StoreSessionResponse.properties.data.$ref,
    '#/components/schemas/StoreSessionView');
  const refreshOperation = document.paths['/store/auth/refresh'].post;
  assert.equal(refreshOperation.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/StoreRefreshTokenRequest');
  assert.deepEqual(schemas.StoreRefreshTokenRequest, {
    type: 'object',
    additionalProperties: false,
    required: ['refresh_token'],
    properties: {
      refresh_token: { type: 'string', minLength: 20, maxLength: 512, writeOnly: true },
    },
  });
  assert.deepEqual(schemas.RefreshTokenRequest, {
    type: 'object',
    additionalProperties: false,
    required: ['refresh_token'],
    properties: { refresh_token: { type: 'string', minLength: 20 } },
  }, 'shared admin/agent refresh request must retain the CH-014 wire shape');
  for (const path of ['/agent/auth/refresh', '/admin/auth/refresh']) {
    assert.equal(document.paths[path].post.requestBody.content['application/json'].schema.$ref,
      '#/components/schemas/RefreshTokenRequest', `${path} must not use the Store DTO`);
  }
  assert.equal(refreshOperation.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/StoreSessionResponse');
  assertStoreNoStore(refreshOperation.responses['200'], 'POST /store/auth/refresh');
  assert.match(refreshOperation.description, /aud=qingxu-store/);
  assert.match(refreshOperation.description, /role=CUSTOMER/);
  assert.match(refreshOperation.description, /assurance=WECHAT/);
  assert.match(refreshOperation.description, /HASH_ONLY/);
  assert.match(refreshOperation['x-ch016-lost-response-retry'],
    /同一 Idempotency-Key.+409.+不回放 token.+不将其误判.+新幂等键.+撤销 family/s);
  const logoutOperation = document.paths['/store/auth/logout'].post;
  assert.ok(parameterReferences(logoutOperation)
    .includes('#/components/parameters/IdempotencyKey'));
  assert.match(logoutOperation.description, /HASH_ONLY/);
  assert.match(logoutOperation.description, /不缓存响应或回放 bearer\/session 凭据/);
  assertStoreNoStore(logoutOperation.responses['200'], 'POST /store/auth/logout');
  const bearerDescription = document.components.securitySchemes.bearerAuth.description;
  assert.match(bearerDescription, /aud=qingxu-store.+role=CUSTOMER.+assurance=WECHAT/);
  assert.match(bearerDescription, /aud=qingxu-admin-web.+role=SUPER_ADMIN.+assurance=MFA/);
  assert.match(bearerDescription, /B7 不修改 \/agent 现有 operation/);
  assert.match(bearerDescription, /不得跨端复用/);

  const profilePatch = document.paths['/store/profile'].patch;
  assertStoreNoStore(document.paths['/store/profile'].get.responses['200'], 'GET /store/profile');
  assert.deepEqual(parameterReferences(profilePatch), [
    '#/components/parameters/IdempotencyKey',
    '#/components/parameters/IfMatch',
  ]);
  assert.match(profilePatch.description, /HASH_ONLY/);
  assert.match(profilePatch.description, /profile\.version/);
  assertStoreNoStore(profilePatch.responses['200'], 'PATCH /store/profile');
  assert.ok(schemas.ProfileView.required.includes('phone_source'));
  assert.ok(schemas.ProfileView.required.includes('phone_verified_at'));
  assert.equal(schemas.ProfileView.properties.phone_masked.maxLength, 32);
  assert.equal(schemas.ProfileView.properties.phone_masked.pattern,
    '^[0-9]{3} \\*{4} [0-9]{4}$');
  assert.equal(schemas.ProfileView.oneOf.length, 2);
  const emptyPhoneProjection = schemas.ProfileView.oneOf.find((branch) =>
    branch.properties.phone_tail.type === 'null');
  const verifiedPhoneProjection = schemas.ProfileView.oneOf.find((branch) =>
    branch.properties.phone_tail.type === 'string');
  assert.ok(emptyPhoneProjection && verifiedPhoneProjection);
  for (const branch of schemas.ProfileView.oneOf) {
    assert.deepEqual(branch.required,
      ['phone_tail', 'phone_masked', 'phone_source', 'phone_verified_at']);
  }
  assert.deepEqual(Object.values(emptyPhoneProjection.properties), [
    { type: 'null' }, { type: 'null' }, { type: 'null' }, { type: 'null' },
  ]);
  assert.deepEqual(verifiedPhoneProjection.properties.phone_source.enum, ['WECHAT', 'MOCK']);
  assert.equal(verifiedPhoneProjection.properties.phone_verified_at.format, 'date-time');
  assert.deepEqual(schemas.ProfileView.properties.phone_source.enum, ['WECHAT', 'MOCK', null]);
  assert.deepEqual(schemas.ProfileUpdateRequest.properties.nickname.type, ['string', 'null']);
  assert.equal(schemas.ProfileUpdateRequest.properties.nickname.minLength, 1);
  assert.equal(schemas.ProfileUpdateRequest.properties.nickname.maxLength, 80);
  assert.equal(schemas.ProfileUpdateRequest.properties.nickname.pattern, '\\S');
  assert.deepEqual(schemas.ProfileUpdateRequest.properties.city.type, ['string', 'null']);
  assert.equal(schemas.ProfileUpdateRequest.properties.city.minLength, 1);
  assert.equal(schemas.ProfileUpdateRequest.properties.city.maxLength, 120);
  assert.equal(schemas.ProfileUpdateRequest.properties.city.pattern, '\\S');
  assert.deepEqual(schemas.ProfileUpdateRequest.properties.avatar_url.type, ['string', 'null']);
  assert.equal(schemas.ProfileUpdateRequest.properties.avatar_url.pattern, '^https://');
  assert.equal(schemas.ProfileUpdateRequest.properties.avatar_url.maxLength, 500);
  const phoneRequest = schemas.PhoneAuthorizationRequest;
  assert.equal(phoneRequest.additionalProperties, false);
  assert.deepEqual(phoneRequest.required, ['provider_credential', 'consent']);
  assert.deepEqual(Object.keys(phoneRequest.properties), ['provider_credential', 'consent']);
  assert.equal(Object.hasOwn(phoneRequest.properties, 'provider'), false,
    'client must not select the phone provider');
  assert.equal(phoneRequest.properties.provider_credential.minLength, 1);
  assert.equal(phoneRequest.properties.provider_credential.maxLength, 512);
  assert.equal(phoneRequest.properties.provider_credential.writeOnly, true);
  assert.equal(phoneRequest.properties.consent.allOf[0].$ref,
    '#/components/schemas/ConsentInput');
  assert.equal(phoneRequest.properties.consent.allOf[1].properties.type.const,
    'PHONE_AUTHORIZATION');
  for (const [method, path] of [
    ['post', '/store/profile/phone-authorizations'],
    ['delete', '/store/profile/phone'],
  ]) {
    const operation = document.paths[path][method];
    assert.deepEqual(parameterReferences(operation), [
      '#/components/parameters/IdempotencyKey',
      '#/components/parameters/IfMatch',
    ]);
    assert.match(operation.description, /HASH_ONLY/);
    assert.match(operation.description, /If-Match 必须对应 profile\.version/);
    assert.match(operation.description, /版本冲突返回 409/);
    assertStoreNoStore(operation.responses['200'], `${method.toUpperCase()} ${path}`);
  }
  const phoneDescription = document.paths['/store/profile/phone-authorizations'].post.description;
  assert.match(phoneDescription, /客户端.+不能选择 Provider/);
  assert.match(phoneDescription, /Mock 仅允许 test\/development/);
  assert.match(phoneDescription, /CONSENT_VERSION_MISMATCH/);
  assert.match(phoneDescription, /手机号授权文档/);
  assert.equal(document.paths['/store/profile/phone-authorizations'].post.responses['409'].$ref,
    '#/components/responses/StorePhoneAuthorizationConflict');

  const attributionRequest = schemas.AttributionCandidateRequest;
  assert.equal(attributionRequest.additionalProperties, false);
  assert.deepEqual(attributionRequest.required, ['invite_code', 'promotion_asset_id']);
  assert.deepEqual(Object.keys(attributionRequest.properties), ['invite_code', 'promotion_asset_id']);
  assert.equal(attributionRequest.properties.invite_code.minLength, 1);
  assert.equal(attributionRequest.properties.invite_code.maxLength, 128);
  assert.equal(attributionRequest.properties.invite_code.writeOnly, true);
  assert.equal(attributionRequest.properties.promotion_asset_id.pattern, ULID_PATTERN);
  assert.equal(Object.hasOwn(attributionRequest.properties, 'target_type'), false);
  assert.equal(Object.hasOwn(attributionRequest.properties, 'target_id'), false);
  const attributionCreate = document.paths['/store/attribution/candidates'].post;
  assert.deepEqual(attributionCreate.security,
    [{ bearerAuth: [] }, { candidateToken: [] }, {}]);
  assert.match(attributionCreate['x-ch016-anonymous-replacement'],
    /X-Candidate-Token.+未提交旧 token.+TTL 自然过期/);
  assert.match(attributionCreate['x-ch016-credential-precedence'],
    /同时携带 Authorization 与 X-Candidate-Token 返回 400 INVALID_ARGUMENT/);
  assert.match(attributionCreate['x-ch016-credential-precedence'],
    /Authorization.+失败返回 401.+不得尝试 candidate token 或匿名分支/);
  assert.match(attributionCreate['x-ch016-credential-precedence'],
    /X-Candidate-Token.+失效或过期返回 401.+不得降级匿名/);
  assert.match(attributionCreate['x-ch016-credential-precedence'],
    /两种凭据均未携带时使用匿名分支/);
  assert.match(attributionCreate['x-ch016-candidate-token-result'],
    /匿名请求和 candidateToken 请求必须签发新的非空 32\.\.512 字符 candidate_token/);
  assert.match(attributionCreate['x-ch016-candidate-token-result'],
    /bearer 请求必须返回 candidate_token=null/);
  assert.match(attributionCreate['x-ch016-candidate-token-result'],
    /已有绑定与 public fallback 分支始终返回 null/);
  assert.match(attributionCreate.description, /只提交 invite_code 与 promotion_asset_id/);
  assert.match(attributionCreate.description, /不接受客户端 target_type\/target_id/);
  assert.match(attributionCreate.description, /固定 30 分钟/);
  assert.match(attributionCreate.description, /domain-separated HMAC/);
  assert.match(attributionCreate.description, /互不相同的 scope\/domain/);
  assert.match(attributionCreate.description,
    /仅在携带有效旧 X-Candidate-Token 时替换.+未携带旧 token 时旧候选按 TTL 自然过期/);
  assert.match(attributionCreate.description, /HASH_ONLY/);
  assert.equal(attributionCreate.responses['200'].headers['Cache-Control'].schema.const,
    'no-store, private');
  assert.equal(attributionCreate.responses['200'].headers['Cache-Control'].required, true);
  assert.equal(attributionCreate.responses['200'].headers.Pragma.schema.const, 'no-cache');
  assert.equal(attributionCreate.responses['200'].headers.Pragma.required, true);
  assert.match(attributionCreate['x-ch016-result-invariant'], /三个互斥分支/);
  const candidateCreateData = schemas.AttributionCandidateCreateResponse.properties.data;
  assert.equal(candidateCreateData.oneOf.length, 3);
  const candidateBranch = candidateCreateData.oneOf.find((branch) =>
    branch.properties.candidate.$ref === '#/components/schemas/AttributionCandidateView');
  const boundBranch = candidateCreateData.oneOf.find((branch) =>
    branch.properties.service_agent?.type === 'object');
  const fallbackBranch = candidateCreateData.oneOf.find((branch) =>
    branch.properties.public_fallback?.type === 'object');
  assert.ok(candidateBranch && boundBranch && fallbackBranch);
  const createFields = ['candidate', 'candidate_token', 'service_agent', 'public_fallback'];
  for (const branch of candidateCreateData.oneOf) {
    assert.equal(branch.type, 'object');
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual(branch.required, createFields);
    assert.deepEqual(Object.keys(branch.properties), createFields);
  }
  assert.deepEqual(candidateBranch.properties.service_agent, { type: 'null' });
  assert.deepEqual(candidateBranch.properties.public_fallback, { type: 'null' });
  assert.deepEqual(boundBranch.properties.candidate, { type: 'null' });
  assert.deepEqual(boundBranch.properties.candidate_token, { type: 'null' });
  assert.deepEqual(boundBranch.properties.public_fallback, { type: 'null' });
  assert.equal(boundBranch.properties.service_agent.additionalProperties, false);
  assert.deepEqual(boundBranch.properties.service_agent.required,
    ['agent_id', 'display_name', 'bound_at']);
  assert.equal(boundBranch.properties.service_agent.properties.bound_at.format, 'date-time');
  assert.deepEqual(fallbackBranch.properties.candidate, { type: 'null' });
  assert.deepEqual(fallbackBranch.properties.candidate_token, { type: 'null' });
  assert.deepEqual(fallbackBranch.properties.service_agent, { type: 'null' });
  assert.deepEqual(fallbackBranch.properties.public_fallback.required,
    ['attribution_eligible', 'public_target_url']);
  assert.deepEqual(fallbackBranch.properties.public_fallback.properties.attribution_eligible,
    { const: false });
  assert.equal(fallbackBranch.properties.public_fallback.properties.public_target_url.format, 'uri');
  assert.equal(fallbackBranch.properties.public_fallback.properties.public_target_url.pattern,
    '^https://');
  assert.equal(fallbackBranch.properties.public_fallback.properties.public_target_url.maxLength, 500);
  const candidateToken = candidateBranch.properties.candidate_token;
  assert.deepEqual(candidateToken.type, ['string', 'null']);
  assert.equal(candidateToken.minLength, 32);
  assert.equal(candidateToken.maxLength, 512);
  assert.equal(candidateToken.readOnly, true);
  assert.match(document.components.securitySchemes.candidateToken.description, /32\.\.512/);
  assert.match(document.components.securitySchemes.candidateToken.description, /固定 30 分钟/);
  assert.match(document.components.securitySchemes.candidateToken.description,
    /domain-separated HMAC/);
  assert.match(document.components.securitySchemes.candidateToken.description,
    /互不相同的 scope\/domain/);
  assert.match(document.components.securitySchemes.candidateToken.description,
    /GET 查询不消费 token/);
  assert.match(document.components.securitySchemes.candidateToken.description,
    /候选替换或登录迁移会原子失效 token hash/);
  assert.equal(document.paths['/store/attribution/candidate'].get.responses['409'].$ref,
    '#/components/responses/StoreAttributionCandidateConflict');
  const attributionQuery = document.paths['/store/attribution/candidate'].get;
  assert.deepEqual(attributionQuery.security, [{ bearerAuth: [] }, { candidateToken: [] }]);
  assert.match(attributionQuery.description, /不回传或消费 candidate_token/);
  assert.match(attributionQuery['x-ch016-credential-precedence'],
    /同时携带 Authorization 与 X-Candidate-Token 返回 400 INVALID_ARGUMENT/);
  assert.match(attributionQuery['x-ch016-credential-precedence'],
    /Authorization.+失败返回 401.+不得尝试 candidate token/);
  assert.match(attributionQuery['x-ch016-credential-precedence'],
    /X-Candidate-Token.+失效、过期或未携带均返回 401/);
  assertStoreNoStore(attributionQuery.responses['200'], 'GET /store/attribution/candidate');
  for (const path of [
    '/store/attribution/candidate/confirm',
    '/store/attribution/candidate/reject',
  ]) {
    const operation = document.paths[path].post;
    assert.ok(parameterReferences(operation)
      .includes('#/components/parameters/IdempotencyKey'));
    assert.match(operation.description, /HASH_ONLY/);
    assert.equal(operation.responses['409'].$ref,
      '#/components/responses/StoreAttributionCandidateConflict');
    assertStoreNoStore(operation.responses['200'], `POST ${path}`);
  }

  const serviceAgent = schemas.StoreServiceAgentView;
  assert.equal(serviceAgent.additionalProperties, false);
  assert.deepEqual(serviceAgent.required, ['agent_id', 'display_name', 'bound_at']);
  assert.deepEqual(Object.keys(serviceAgent.properties), serviceAgent.required);
  assert.equal(schemas.ServiceAgentResponse.properties.data.oneOf[0].$ref,
    '#/components/schemas/StoreServiceAgentView');
  const confirmResponseReference = document.paths['/store/attribution/candidate/confirm']
    .post.responses['200'].content['application/json'].schema.$ref;
  assert.equal(confirmResponseReference,
    '#/components/schemas/StoreAttributionBindingResponse');
  assert.equal(schemas.StoreAttributionBindingResponse.properties.data.$ref,
    '#/components/schemas/StoreServiceAgentView');
  assert.equal(schemas.AttributionBindingResponse, undefined,
    'legacy Store response exposing internal binding fields must be removed');
  assert.ok(schemas.AttributionCandidateSummary.required.includes('display_name'));
  assert.ok(schemas.AttributionCandidateSummary.required.includes('public_target_url'));
  assert.deepEqual(schemas.AttributionCandidateSummary.properties.attribution_eligible,
    { const: true });
  assert.equal(schemas.AttributionCandidateSummary.properties.public_target_url.pattern,
    '^https://');
  assert.equal(schemas.AttributionCandidateSummary.properties.public_target_url.maxLength, 500);
  assert.equal(Object.hasOwn(schemas.AttributionCandidateSummary.properties, 'agent_name'), false);
  assert.ok(schemas.AttributionCandidateView.required.includes('display_name'));
  assert.ok(schemas.AttributionCandidateView.required.includes('public_target_url'));
  assert.equal(schemas.AttributionCandidateView.properties.public_target_url.type, 'string');
  assert.equal(schemas.AttributionCandidateView.properties.public_target_url.format, 'uri');
  assert.equal(schemas.AttributionCandidateView.properties.public_target_url.pattern, '^https://');
  assert.equal(schemas.AttributionCandidateView.properties.public_target_url.maxLength, 500);
  assert.deepEqual(schemas.AttributionCandidateView.properties.confirmation_required,
    { const: true });
  assert.deepEqual(schemas.AttributionCandidateView.properties.attribution_eligible,
    { const: true });
  const wechatAuthData = schemas.WechatAuthResponse.properties.data;
  assert.equal(wechatAuthData.oneOf.length, 2);
  const confirmationBranch = wechatAuthData.oneOf.find((branch) =>
    branch.properties.confirmation_required.const === true);
  const noConfirmationBranch = wechatAuthData.oneOf.find((branch) =>
    branch.properties.confirmation_required.const === false);
  assert.ok(confirmationBranch && noConfirmationBranch);
  for (const branch of wechatAuthData.oneOf) {
    assert.equal(branch.type, 'object');
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual(branch.required, ['session', 'confirmation_required', 'candidate']);
    assert.deepEqual(Object.keys(branch.properties),
      ['session', 'confirmation_required', 'candidate']);
  }
  assert.equal(confirmationBranch.properties.session.$ref,
    '#/components/schemas/StoreSessionView');
  assert.equal(confirmationBranch.properties.candidate.$ref,
    '#/components/schemas/AttributionCandidateSummary');
  assert.deepEqual(noConfirmationBranch.properties.session, storeSession);
  assert.deepEqual(noConfirmationBranch.properties.candidate, { type: 'null' });
  const generatedWechatAuth = generatedTypeBlock(
    generatedContract,
    '        WechatAuthResponse: {',
    '        TotpEnrollRequest: {',
  );
  assert.match(generatedWechatAuth,
    /confirmation_required: true;\s+candidate: components\["schemas"\]\["AttributionCandidateSummary"\];/);
  assert.match(generatedWechatAuth, /confirmation_required: false;\s+candidate: null;/);
  assert.doesNotMatch(generatedWechatAuth, /candidate\?: unknown/,
    'generated login contract must not weaken the required candidate to unknown');
  assert.equal(Object.hasOwn(schemas.AttributionCandidateView.properties, 'agent_name'), false);
  const storeAttributionProjection = JSON.stringify({
    login: schemas.WechatAuthResponse,
    candidateSummary: schemas.AttributionCandidateSummary,
    candidateView: schemas.AttributionCandidateView,
    candidateCreate: schemas.AttributionCandidateCreateResponse,
    candidateQuery: schemas.AttributionCandidateQueryResponse,
    candidateReject: schemas.AttributionCandidateRejectResponse,
    binding: schemas.StoreAttributionBindingResponse,
    serviceAgent: schemas.ServiceAgentResponse,
  });
  for (const forbiddenValue of [
    'AttributionBindingView', 'AttributionBindingResponse',
    'binding_id', 'customer_id', 'customer_version', 'agent_name',
  ]) assert.ok(!storeAttributionProjection.includes(forbiddenValue),
    `Store attribution projection must not contain ${forbiddenValue}`);
  const serviceOperation = document.paths['/store/service-agent'].get;
  assertStoreNoStore(serviceOperation.responses['200'], 'GET /store/service-agent');
  assert.match(serviceOperation.description, /绑定仍为 BOUND.+代理已停用也继续返回/s);
  assert.match(serviceOperation.description, /停用只阻止新候选、新绑定和未来订单归因/);
  assert.match(serviceOperation.description, /仅没有 BOUND 绑定或绑定已结束时 data=null/);
  for (const forbiddenField of [
    /binding_id/, /customer_id/, /customer_version/, /佣金/, /完整手机号/,
  ]) assert.match(serviceOperation.description, forbiddenField);

  assert.equal(document.paths['/store/privacy/deletion-requests/current'], undefined,
    'legacy asynchronous deletion status path must be removed');
  const deletionPreviewPath = '/store/privacy/deletion-requests/preview';
  const deletionPreview = document.paths[deletionPreviewPath]?.post;
  assert.ok(deletionPreview, 'account deletion preview operation is missing');
  assert.deepEqual(parameterReferences(deletionPreview),
    ['#/components/parameters/IdempotencyKey']);
  assert.equal(deletionPreview.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/DeletionPreviewRequest');
  assert.match(deletionPreview.description, /eligible=false.+200/);
  assert.match(deletionPreview.description, /固定 5 分钟/);
  assert.match(deletionPreview.description, /actor、session.+account\.version/);
  assert.match(deletionPreview.description, /preview_token 数据库仅保存用途隔离的 HMAC/);
  assert.match(deletionPreview.description, /HASH_ONLY/);
  assertStoreNoStore(deletionPreview.responses['200'], 'POST account deletion preview');
  assert.deepEqual(schemas.DeletionPreviewRequest, {
    type: 'object',
    additionalProperties: false,
    required: ['acknowledged'],
    properties: { acknowledged: { const: true } },
  });
  const deletionPreviewData = schemas.DeletionPreviewResponse.properties.data;
  assert.equal(deletionPreviewData.oneOf.length, 2);
  const eligibleDeletion = deletionPreviewData.oneOf.find((branch) =>
    branch.properties.eligible.const === true);
  const blockedDeletion = deletionPreviewData.oneOf.find((branch) =>
    branch.properties.eligible.const === false);
  const deletionPreviewFields = [
    'eligible', 'blockers', 'impacts', 'preview_token',
    'confirmation_hash', 'expires_at', 'account_version',
  ];
  for (const branch of [eligibleDeletion, blockedDeletion]) {
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual(branch.required, deletionPreviewFields);
    assert.deepEqual(Object.keys(branch.properties), deletionPreviewFields);
  }
  assert.equal(eligibleDeletion.properties.blockers.maxItems, 0);
  assert.equal(eligibleDeletion.properties.preview_token.minLength, 32);
  assert.equal(eligibleDeletion.properties.preview_token.maxLength, 512);
  assert.equal(eligibleDeletion.properties.confirmation_hash.pattern, '^[a-f0-9]{64}$');
  assert.equal(eligibleDeletion.properties.expires_at.format, 'date-time');
  assert.equal(eligibleDeletion.properties.account_version.minimum, 1);
  assert.equal(blockedDeletion.properties.blockers.minItems, 1);
  assert.deepEqual(blockedDeletion.properties.blockers.items.properties.resource_type.enum,
    ['ORDER', 'AFTERSALE', 'PAYMENT', 'REFUND', 'FINANCIAL_ANOMALY']);
  assert.deepEqual(blockedDeletion.properties.preview_token, { type: 'null' });
  assert.deepEqual(blockedDeletion.properties.confirmation_hash, { type: 'null' });
  assert.deepEqual(blockedDeletion.properties.expires_at, { type: 'null' });

  const deletionConfirmPath = '/store/privacy/deletion-requests';
  const deletionConfirm = document.paths[deletionConfirmPath].post;
  assert.deepEqual(parameterReferences(deletionConfirm), [
    '#/components/parameters/IdempotencyKey',
    '#/components/parameters/IfMatch',
  ]);
  assert.equal(deletionConfirm.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/DeletionConfirmRequest');
  assert.match(deletionConfirm.description, /5 分钟内未消费/);
  assert.match(deletionConfirm.description, /If-Match.+account_version/);
  assert.match(deletionConfirm.description, /HASH_ONLY/);
  assert.match(deletionConfirm.description, /事务内重新检查阻断项/);
  assert.match(deletionConfirm.description, /ACCOUNT_DELETION_BLOCKED/);
  assert.match(deletionConfirm.description, /撤销全部会话/);
  assert.match(deletionConfirm.description, /固定返回 COMPLETED/);
  assert.equal(deletionConfirm.responses['422'].$ref,
    '#/components/responses/StoreAccountDeletionBlocked');
  assertStoreNoStore(deletionConfirm.responses['200'], 'POST account deletion confirm');
  assert.deepEqual(schemas.DeletionConfirmRequest.required,
    ['acknowledged', 'preview_token', 'confirmation_hash']);
  assert.equal(schemas.DeletionConfirmRequest.additionalProperties, false);
  assert.deepEqual(schemas.DeletionConfirmRequest.properties.acknowledged, { const: true });
  assert.equal(schemas.DeletionConfirmRequest.properties.preview_token.writeOnly, true);
  assert.equal(schemas.DeletionConfirmRequest.properties.confirmation_hash.writeOnly, true);
  assert.deepEqual(schemas.DeletionRequestView.required,
    ['request_id', 'status', 'submitted_at', 'completed_at']);
  assert.deepEqual(schemas.DeletionRequestView.properties.status, { const: 'COMPLETED' });
  assert.equal(schemas.DeletionRequestView.properties.completed_at.type, 'string');

  for (const [method, path] of [
    ['get', '/store/legal-documents'],
    ['post', '/store/auth/wechat/login'],
    ['post', '/store/auth/refresh'],
    ['post', '/store/auth/logout'],
    ['get', '/store/profile'],
    ['patch', '/store/profile'],
    ['post', '/store/profile/phone-authorizations'],
    ['delete', '/store/profile/phone'],
    ['post', '/store/privacy/deletion-requests/preview'],
    ['post', '/store/privacy/deletion-requests'],
    ['get', '/store/attribution/candidate'],
    ['post', '/store/attribution/candidate/confirm'],
    ['post', '/store/attribution/candidate/reject'],
    ['get', '/store/service-agent'],
  ]) {
    assertStoreNoStore(document.paths[path][method].responses['200'],
      `${method.toUpperCase()} ${path}`);
  }

  assertClosedStoreErrorResponse(document.components.responses.StoreLoginConflict, {
    type: 'string',
    enum: ['CONSENT_VERSION_MISMATCH', 'ATTRIBUTION_CANDIDATE_MISMATCH', 'STATE_CONFLICT'],
  }, 'StoreLoginConflict');
  assertClosedStoreErrorResponse(document.components.responses.StorePhoneAuthorizationConflict, {
    type: 'string',
    enum: ['CONSENT_VERSION_MISMATCH', 'RESOURCE_VERSION_CONFLICT', 'STATE_CONFLICT'],
  }, 'StorePhoneAuthorizationConflict');
  assertClosedStoreErrorResponse(document.components.responses.StoreAttributionCandidateConflict, {
    type: 'string',
    enum: ['ATTRIBUTION_CANDIDATE_MISMATCH', 'STATE_CONFLICT'],
  }, 'StoreAttributionCandidateConflict');
  assertClosedStoreErrorResponse(document.components.responses.StoreAccountDeletionBlocked,
    { const: 'ACCOUNT_DELETION_BLOCKED' }, 'StoreAccountDeletionBlocked');
  assertClosedStoreErrorResponse(document.components.responses.StoreSensitiveError,
    { type: 'string' }, 'StoreSensitiveError');
  const generatedStoreSensitiveError = generatedTypeBlock(
    generatedContract,
    '        StoreSensitiveError: {',
    '        StoreLoginConflict: {',
  );
  assert.match(generatedStoreSensitiveError, /"Cache-Control": "no-store, private";/);
  assert.match(generatedStoreSensitiveError, /Pragma: "no-cache";/);
  assert.match(generatedStoreSensitiveError, /rejected_value\?: null;/);
  assert.doesNotMatch(generatedStoreSensitiveError, /rejected_value\?: string/,
    'generated sensitive errors must not accept rejected secret values');

  const storeLoginRateLimited = document.components.responses.StoreLoginRateLimited;
  assertInlineStoreNoStore(storeLoginRateLimited, 'StoreLoginRateLimited');
  assert.equal(storeLoginRateLimited.content['application/json'].schema.allOf[0].$ref,
    '#/components/schemas/ErrorResponse');
  const loginRateLimitOverlay = storeLoginRateLimited.content['application/json'].schema.allOf[1];
  assert.deepEqual(loginRateLimitOverlay.properties.code, { const: 'RATE_LIMITED' });
  assert.deepEqual(loginRateLimitOverlay.properties.details.items.properties.rejected_value,
    { type: 'null' });

  const sensitiveStoreOperations = [
    ['post', '/store/auth/wechat/login'],
    ['post', '/store/auth/refresh'],
    ['post', '/store/auth/logout'],
    ['get', '/store/profile'],
    ['patch', '/store/profile'],
    ['post', '/store/profile/phone-authorizations'],
    ['delete', '/store/profile/phone'],
    ['post', '/store/privacy/deletion-requests'],
    ['post', '/store/privacy/deletion-requests/preview'],
    ['post', '/store/attribution/candidates'],
    ['get', '/store/attribution/candidate'],
    ['post', '/store/attribution/candidate/confirm'],
    ['post', '/store/attribution/candidate/reject'],
    ['get', '/store/service-agent'],
  ];
  const sensitiveResponseOverrides = new Map([
    ['post /store/auth/wechat/login 409', '#/components/responses/StoreLoginConflict'],
    ['post /store/auth/wechat/login 429', '#/components/responses/StoreLoginRateLimited'],
    ['post /store/profile/phone-authorizations 409',
      '#/components/responses/StorePhoneAuthorizationConflict'],
    ['post /store/privacy/deletion-requests 422',
      '#/components/responses/StoreAccountDeletionBlocked'],
    ['get /store/attribution/candidate 409',
      '#/components/responses/StoreAttributionCandidateConflict'],
    ['post /store/attribution/candidate/confirm 409',
      '#/components/responses/StoreAttributionCandidateConflict'],
    ['post /store/attribution/candidate/reject 409',
      '#/components/responses/StoreAttributionCandidateConflict'],
  ]);
  for (const [method, path] of sensitiveStoreOperations) {
    const operation = document.paths[path][method];
    for (const [status, response] of Object.entries(operation.responses)) {
      if (status === '200') continue;
      const key = `${method} ${path} ${status}`;
      const expectedReference = sensitiveResponseOverrides.get(key)
        ?? '#/components/responses/StoreSensitiveError';
      assert.equal(response.$ref, expectedReference,
        `${key} must use a required no-store response with null-only rejected_value`);
    }
  }

  for (const path of PUBLIC_STORE_CATALOG_PATHS) {
    const pathItem = document.paths[path];
    assert.ok(pathItem, `public Store catalog path is missing: ${path}`);
    assert.deepEqual(
      Object.keys(pathItem).filter((key) => HTTP_METHODS.has(key)),
      ['get'],
      `public Store catalog path must remain read-only: ${path}`,
    );
    assert.deepEqual(pathItem.get.security, [], `public Store catalog GET must remain anonymous: ${path}`);
    assert.equal(pathItem.get.responses['429']?.$ref, '#/components/responses/StoreRateLimited',
      `public Store catalog GET must expose the shared 429 response: ${path}`);
  }
  for (const protectedPath of ['/store/favorites', '/store/cart']) {
    assert.deepEqual(document.paths[protectedPath].get.security, [{ bearerAuth: [] }],
      `${protectedPath} must remain outside the anonymous B6 catalog scope`);
  }

  const sharedRateLimited = document.components.responses.RateLimited;
  assert.equal(sharedRateLimited.description, '\u8bbf\u95ee\u3001\u767b\u5f55\u6216 MFA \u5931\u8d25\u6b21\u6570\u53d7\u9650');
  assert.equal(sharedRateLimited.headers, undefined,
    'CH-014 Store Retry-After bounds must not narrow the shared login/MFA response');
  const rateLimited = document.components.responses.StoreRateLimited;
  assert.match(rateLimited.description, /\u4e94\u4e2a\u533f\u540d\u76ee\u5f55 GET/);
  assert.match(rateLimited.description, /Redis \u56fa\u5b9a\u7a97\u53e3/);
  assert.match(rateLimited.description, /HMAC \u540e\u7684\u6765\u6e90 IP/);
  assert.match(rateLimited.description, /\u6bcf 60 \u79d2\u6700\u591a 120 \u6b21/);
  assert.match(rateLimited.description, /\u4e0d\u5f97\u7ed5\u8fc7\u9650\u6d41/);
  assert.deepEqual(rateLimited.headers?.['Retry-After'], {
    description: rateLimited.headers['Retry-After'].description,
    required: true,
    schema: { type: 'integer', minimum: 1, maximum: 60 },
  });
  assert.match(rateLimited.headers['Retry-After'].description, /\u51c6\u786e\u5269\u4f59\u6574\u6570\u79d2/);

  const storeProductParameters = document.paths['/store/products'].get.parameters;
  const storeProductParameter = (name) => storeProductParameters.find((parameter) => parameter.name === name);
  const storeKeyword = storeProductParameter('keyword');
  assert.deepEqual(storeKeyword.schema, { type: 'string', minLength: 1, maxLength: 200 });
  assert.match(storeKeyword.description, /trim/);
  assert.match(storeKeyword.description, /\u4ec5\u5bf9\u5546\u54c1\u540d/);
  assert.match(storeKeyword.description, /\u5927\u5c0f\u5199\u4e0d\u654f\u611f/);
  assert.doesNotMatch(storeKeyword.description, /SPU|SKU code/);
  for (const parameterName of ['brand_id', 'category_id']) {
    assert.deepEqual(storeProductParameter(parameterName).schema, {
      type: 'string', pattern: ULID_PATTERN,
    });
  }
  const storeProductId = document.paths['/store/products/{product_id}'].get.parameters
    .find((parameter) => parameter.name === 'product_id');
  assert.deepEqual(storeProductId.schema, { type: 'string', pattern: ULID_PATTERN });

  const storeSort = storeProductParameter('sort');
  assert.deepEqual(storeSort.schema, {
    type: 'string',
    enum: ['COMPREHENSIVE', 'HOT', 'NEWEST', 'PRICE_ASC', 'PRICE_DESC'],
    default: 'COMPREHENSIVE',
  });
  assert.match(storeSort.description,
    /is_hot DESC,is_new DESC,sales_count DESC,published_at DESC NULLS LAST,product_id ASC/);
  assert.match(storeSort.description, /HOT.+sales_count DESC,product_id ASC/);
  assert.match(storeSort.description, /NEWEST.+published_at DESC NULLS LAST,product_id ASC/);
  assert.match(storeSort.description, /PRICE_ASC\/PRICE_DESC.+ACTIVE SKU \u6700\u4f4e\u4ef7/);

  for (const [path, responseName, entity] of [
    ['/store/categories', 'StoreCategoryListResponse', '\u5206\u7c7b'],
    ['/store/brands', 'StoreBrandListResponse', '\u54c1\u724c'],
  ]) {
    assert.deepEqual(document.paths[path].get.parameters, [], `${path} must not accept pagination`);
    assert.match(document.paths[path].get.description, new RegExp(`\u5168\u90e8 ACTIVE ${entity}`));
    assert.match(document.paths[path].get.description, /\u4e0d\u5206\u9875/);
    assert.match(document.paths[path].get.description, /sort_order ASC,id ASC/);
    const data = schemas[responseName].properties.data;
    assert.equal(data.additionalProperties, false);
    assert.deepEqual(data.required, ['items']);
    assert.deepEqual(Object.keys(data.properties), ['items']);
  }

  const storeSku = schemas.StoreSkuView;
  assert.ok(storeSku.required.includes('is_salable'));
  assert.deepEqual(storeSku.properties.is_salable, { type: 'boolean' });
  assert.match(storeSku.description, /\u5168\u90e8 ACTIVE SKU/);
  assert.match(storeSku.description, /available_stock > 0.+true/);
  assert.match(storeSku.description, /\u96f6\u5e93\u5b58.+false/);
  const storeProductSummary = schemas.StoreProductListItem;
  assert.ok(storeProductSummary.required.includes('is_salable'));
  assert.deepEqual(storeProductSummary.properties.is_salable, { type: 'boolean' });
  assert.match(storeProductSummary.description, /\u81f3\u5c11\u5b58\u5728\u4e00\u4e2a ACTIVE SKU/);
  assert.match(storeProductSummary.description, /\u5168\u90e8 SKU \u552e\u7f44\u65f6\u5546\u54c1\u4ecd\u53ef\u6d4f\u89c8/);
  assert.match(storeProductSummary.description, /minimum_active_price.+ACTIVE SKU \u6700\u4f4e\u4ef7/);
  assert.match(document.paths['/store/products'].get.description, /is_salable=false/);
  assert.match(document.paths['/store/products/{product_id}'].get.description,
    /\u56fa\u5b9a\u8fd4\u56de\u5168\u90e8 ACTIVE SKU/);

  const homeData = schemas.HomeResponse.properties.data;
  assert.equal(homeData.additionalProperties, false);
  assert.deepEqual(homeData.required,
    ['banners', 'categories', 'hot_products', 'new_products', 'section_status']);
  assert.equal(homeData.properties.banners.maxItems, 10);
  assert.equal(homeData.properties.categories.maxItems, 8);
  assert.equal(homeData.properties.hot_products.maxItems, 4);
  assert.equal(homeData.properties.new_products.maxItems, 4);
  const sectionStatus = homeData.properties.section_status;
  const sectionNames = ['banners', 'categories', 'hot_products', 'new_products'];
  assert.equal(sectionStatus.type, 'object');
  assert.equal(sectionStatus.additionalProperties, false);
  assert.deepEqual(sectionStatus.required, sectionNames);
  assert.deepEqual(Object.keys(sectionStatus.properties), sectionNames);
  for (const sectionName of sectionNames) {
    assert.deepEqual(sectionStatus.properties[sectionName], {
      type: 'string', enum: ['READY', 'UNAVAILABLE'],
    });
  }
  assert.match(sectionStatus.description, /UNAVAILABLE.+\u5bf9\u5e94\u6570\u7ec4\u5fc5\u987b\u4e3a\u7a7a/);
  assert.match(sectionStatus.description, /\u90e8\u5206\u5206\u533a\u5931\u8d25\u4ecd\u8fd4\u56de 200/);
  assert.match(sectionStatus.description, /\u56db\u5206\u533a\u5168\u90e8\u5931\u8d25\u8fd4\u56de 500/);
  const ch014StoreHomeDescription = document.paths['/store/home'].get.description ?? '';
  assert.match(ch014StoreHomeDescription, /sort_order ASC,id ASC \u53d6\u524d 10 \u6761/);
  assert.match(ch014StoreHomeDescription, /sort_order ASC,id ASC \u53d6\u524d 8 \u6761/);
  assert.match(ch014StoreHomeDescription, /sales_count DESC,product_id ASC \u53d6\u524d 4 \u6761/);
  assert.match(ch014StoreHomeDescription, /published_at DESC NULLS LAST,product_id ASC \u53d6\u524d 4 \u6761/);
  assert.match(ch014StoreHomeDescription, /PRODUCT \u76ee\u6807.+\u516c\u5f00\u5546\u54c1/);
  assert.match(ch014StoreHomeDescription, /\u4efb\u4e00\u5206\u533a\u5931\u8d25\u65f6\u8fd4\u56de 200/);
  assert.match(ch014StoreHomeDescription, /\u56db\u5206\u533a\u5168\u90e8\u5931\u8d25\u624d\u8fd4\u56de 500/);

  assert.equal(
    schemas.PositiveMoney.pattern,
    '^(?:0\\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\\.[0-9]{2})$',
    'PositiveMoney must remain within DECIMAL(18,2) and be greater than zero',
  );
  const positiveMoneyPattern = new RegExp(schemas.PositiveMoney.pattern);
  for (const value of ['0.01', '0.99', '1.00', '9999999999999999.99']) {
    assert.match(value, positiveMoneyPattern, `PositiveMoney must accept ${value}`);
  }
  for (const value of ['0.00', '-0.01', '1', '1.0', '10000000000000000.00']) {
    assert.doesNotMatch(value, positiveMoneyPattern, `PositiveMoney must reject ${value}`);
  }

  const brandCreate = schemas.BrandCreateRequest;
  assert.equal(brandCreate.additionalProperties, false);
  assert.ok(brandCreate.required.includes('sort_order'));
  assert.deepEqual(brandCreate.properties.sort_order, { type: 'integer', minimum: 0 });
  assert.deepEqual(brandCreate.properties.initial_status, { const: 'DRAFT' });

  const brandUpdate = schemas.BrandUpdateRequest;
  assert.equal(brandUpdate.additionalProperties, false);
  assert.ok(!brandUpdate.required?.includes('sort_order'));
  assert.deepEqual(brandUpdate.properties.sort_order, { type: 'integer', minimum: 0 });

  for (const schemaName of ['CategoryCreateRequest', 'CategoryUpdateRequest']) {
    assert.equal(schemas[schemaName].properties.sort_order.minimum, 0);
  }
  assert.deepEqual(schemas.CategoryCreateRequest.properties.initial_status, { const: 'DRAFT' });

  const masterLifecycle = schemas.MasterDataLifecycleAction;
  assertLifecycleActionSchema(masterLifecycle, 'MasterDataLifecycleAction');
  assertLifecycleActionSchema(schemas.ProductLifecycleAction, 'ProductLifecycleAction');
  assertLifecycleActionSchema(schemas.SkuLifecycleAction, 'SkuLifecycleAction');
  assert.equal(schemas.LifecycleAction, undefined, 'legacy LifecycleAction must be removed');

  for (const path of MASTER_DATA_PATHS) {
    assert.equal(firstSchemaReference(document, path), '#/components/schemas/MasterDataLifecycleAction');
  }
  for (const path of PRODUCT_LIFECYCLE_PATHS) {
    assert.equal(firstSchemaReference(document, path), '#/components/schemas/ProductLifecycleAction');
  }
  for (const path of SKU_LIFECYCLE_PATHS) {
    assert.equal(firstSchemaReference(document, path), '#/components/schemas/SkuLifecycleAction');
  }
  for (const path of LIFECYCLE_PATHS) {
    assert.equal(requestSchema(document, path).unevaluatedProperties, false,
      `lifecycle request must reject undeclared properties: ${path}`);
    assert.ok(operationParameterReferences(document, path).includes('#/components/parameters/IdempotencyKey'),
      `lifecycle request must require Idempotency-Key: ${path}`);
    if (path.endsWith('/lifecycle-preview')) {
      const successResponse = document.paths[path]?.post?.responses?.['200'];
      assert.equal(successResponse?.headers?.['Cache-Control']?.$ref,
        '#/components/headers/CacheControlNoStore', `preview must be no-store: ${path}`);
      assert.equal(successResponse?.headers?.Pragma?.$ref,
        '#/components/headers/PragmaNoCache', `preview must be no-cache: ${path}`);
    }
  }
  for (const path of LIFECYCLE_CONFIRM_PATHS) {
    const schema = requestSchema(document, path);
    assert.equal(schema.allOf?.[1]?.$ref, '#/components/schemas/HighRiskConfirmationFields',
      `lifecycle confirmation must include high-risk confirmation fields: ${path}`);
    assert.ok(operationParameterReferences(document, path).includes('#/components/parameters/IfMatch'),
      `lifecycle confirmation must require If-Match: ${path}`);
  }
  for (const path of PRODUCT_SKU_RESTORE_PATHS) {
    assert.equal(firstSchemaReference(document, path), '#/components/schemas/ClosedReasonRequest',
      `restore must use ClosedReasonRequest: ${path}`);
    const parameterReferences = operationParameterReferences(document, path);
    assert.ok(parameterReferences.includes('#/components/parameters/IdempotencyKey'),
      `restore must require Idempotency-Key: ${path}`);
    assert.ok(parameterReferences.includes('#/components/parameters/IfMatch'),
      `restore must require If-Match: ${path}`);
    assert.equal(document.paths[path.replace(/\/restore$/, '/restore-preview')], undefined,
      `restore-preview must not be introduced: ${path}`);
  }

  const productCreate = schemas.ProductCreateRequest;
  assert.equal(productCreate.additionalProperties, false);
  assert.deepEqual(productCreate.properties.initial_status, { const: 'DRAFT' });
  assert.equal(productCreate.properties.images.maxItems, 8);
  assert.equal(schemas.ProductUpdateRequest.properties.images.maxItems, 8);
  assert.equal(schemas.ProductDetailView.properties.images.maxItems, 8);

  const skuCreate = schemas.SkuCreateRequest;
  assert.equal(skuCreate.additionalProperties, false);
  assert.deepEqual(skuCreate.properties.initial_status, { const: 'INACTIVE' });
  const skuCreateResponses = document.paths['/admin/products/{product_id}/skus']?.post?.responses;
  assert.ok(skuCreateResponses?.['201'], 'SKU create must return 201');
  assert.equal(skuCreateResponses?.['200'], undefined, 'SKU create must not return 200');

  assert.deepEqual(schemas.ProductSummaryView.properties.minimum_active_price.oneOf, [
    { $ref: '#/components/schemas/PositiveMoney' },
    { type: 'null' },
  ]);
  assert.deepEqual(schemas.StoreProductListItem.properties.minimum_active_price,
    { $ref: '#/components/schemas/PositiveMoney' },
    'public product minimum price must remain non-null');

  const productListDescription = document.paths['/admin/products']?.get?.description ?? '';
  assert.match(productListDescription, /默认排除 ARCHIVED/);
  assert.match(productListDescription, /published_at DESC NULLS LAST,id DESC/);
  const productDetailDescription = document.paths['/admin/products/{product_id}']?.get?.description ?? '';
  assert.match(productDetailDescription, /包括 ARCHIVED/);
  assert.match(productDetailDescription, /created_at ASC,id ASC/);
  const productPreviewDescription = document.paths[PRODUCT_LIFECYCLE_PATHS[0]]?.post?.description ?? '';
  assert.match(productPreviewDescription, /DRAFT\/INACTIVE.+ACTIVATE.+ACTIVE/);
  assert.match(productPreviewDescription, /ACTIVE.+DEACTIVATE.+INACTIVE/);
  assert.match(productPreviewDescription, /DRAFT\/INACTIVE.+SOFT_DELETE.+ARCHIVED/);
  assert.match(productPreviewDescription, /preview.+200.+impact\.warnings/);
  const productConfirmDescription = document.paths[PRODUCT_LIFECYCLE_PATHS[1]]?.post?.description ?? '';
  assert.match(productConfirmDescription, /品牌或分类不是 ACTIVE.+409 STATE_CONFLICT/);
  assert.match(productConfirmDescription, /ACTIVE_SKU_DEPENDENCY/);
  assert.match(productConfirmDescription, /ACTIVE_INVENTORY_RESERVATION/);
  assert.match(productConfirmDescription, /published_at 仅首次 ACTIVATE 时写入/);
  assert.match(productConfirmDescription, /audit_log\.reason/);
  const productRestoreDescription = document.paths['/admin/products/{product_id}/restore']?.post?.description ?? '';
  assert.match(productRestoreDescription, /ARCHIVED 恢复为 DRAFT/);
  assert.match(productRestoreDescription, /audit_log\.reason/);

  const skuCreateDescription = document.paths['/admin/products/{product_id}/skus']?.post?.description ?? '';
  assert.match(skuCreateDescription, /physical_stock=0/);
  assert.match(skuCreateDescription, /locked_stock=0/);
  const skuPreviewDescription = document.paths[SKU_LIFECYCLE_PATHS[0]]?.post?.description ?? '';
  assert.match(skuPreviewDescription, /INACTIVE.+ACTIVATE.+ACTIVE/);
  assert.match(skuPreviewDescription, /ACTIVE.+DEACTIVATE.+INACTIVE/);
  assert.match(skuPreviewDescription, /INACTIVE.+SOFT_DELETE.+ARCHIVED/);
  assert.match(skuPreviewDescription, /preview.+200.+impact\.warnings/);
  assert.match(skuPreviewDescription, /非 ARCHIVED Product 下 ACTIVATE/);
  assert.match(skuPreviewDescription, /Product 与 SKU 同时 ACTIVE 时才公开可售/);
  const skuConfirmDescription = document.paths[SKU_LIFECYCLE_PATHS[1]]?.post?.description ?? '';
  assert.match(skuConfirmDescription, /ARCHIVED Product 下的 SKU 不得 ACTIVATE/);
  assert.match(skuConfirmDescription, /SKU 状态变化不级联修改 Product/);
  const skuRestoreDescription = document.paths['/admin/skus/{sku_id}/restore']?.post?.description ?? '';
  assert.match(skuRestoreDescription, /ARCHIVED 恢复为 INACTIVE/);
  assert.match(skuRestoreDescription, /audit_log\.reason/);

  const bannerCreate = schemas.BannerCreateRequest;
  assert.equal(schemas.BannerWriteRequest, undefined, 'legacy BannerWriteRequest must be removed');
  assert.equal(Object.hasOwn(schemas.BannerBaseFields.properties, 'status'), false,
    'Banner shared fields must not expose status');
  assert.equal(bannerCreate.oneOf.length, 4, 'Banner create must close all four target variants');
  for (const variant of bannerCreate.oneOf) {
    assert.equal(variant.allOf?.[0]?.$ref, '#/components/schemas/BannerBaseFields');
    assert.equal(variant.unevaluatedProperties, false);
    assert.ok(variant.allOf[1].required.includes('initial_status'));
    assert.deepEqual(variant.allOf[1].properties.initial_status, { const: 'DRAFT' });
    for (const requiredField of ['title', 'file_id', 'sort_order', 'target_type']) {
      assert.ok(variant.allOf[1].required.includes(requiredField),
        `Banner create variant must require ${requiredField}`);
      assert.ok(Object.hasOwn(variant.allOf[1].properties, requiredField),
        `Banner create variant must declare required property ${requiredField} for generated types`);
    }
  }
  const bannerCreateUrlVariant = bannerCreate.oneOf.find((variant) =>
    variant.allOf[1].properties.target_type.const === 'URL');
  assert.equal(bannerCreateUrlVariant.allOf[1].properties.target_url.maxLength, 500,
    'Banner create URL must fit the frozen VARCHAR(500) column');
  assert.match(bannerCreate.description, /ends_at 必须晚于 starts_at/);

  const bannerUpdate = schemas.BannerUpdateRequest;
  assert.equal(bannerUpdate.oneOf.length, 5, 'Banner update must support fields-only and four target variants');
  assert.equal(bannerUpdate.oneOf[0].additionalProperties, false);
  assert.ok(bannerUpdate.oneOf.slice(1)
    .every((variant) => variant.unevaluatedProperties === false),
    'Banner update target variants must reject undeclared fields');
  assert.ok(!JSON.stringify(bannerUpdate).includes('"status"'),
    'Banner ordinary update must not expose status');
  assert.equal(bannerUpdate.oneOf[0].minProperties, 1,
    'Banner fields-only update must reject an empty request');
  const bannerUpdateUrlVariant = bannerUpdate.oneOf.find((variant) =>
    variant.allOf?.[1]?.properties?.target_type?.const === 'URL');
  assert.equal(bannerUpdateUrlVariant.allOf[1].properties.target_url.maxLength, 500,
    'Banner update URL must fit the frozen VARCHAR(500) column');
  assert.match(bannerUpdate.description, /ends_at 必须晚于 starts_at/);

  assert.deepEqual(schemas.BannerStatusAction, {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['ACTIVATE', 'DEACTIVATE'] },
    },
    description: schemas.BannerStatusAction.description,
  });
  assert.equal(
    document.paths['/admin/banners'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/BannerCreateRequest',
  );
  assert.match(document.paths['/admin/banners'].post.description, /ends_at 必须晚于 starts_at/);
  assert.deepEqual(
    document.paths['/admin/banners/{banner_id}'].patch.requestBody.content['application/json'].schema.oneOf,
    [
      { $ref: '#/components/schemas/BannerUpdateRequest' },
      { $ref: '#/components/schemas/BannerStatusAction' },
    ],
  );
  assert.match(document.paths['/admin/banners/{banner_id}'].patch.description,
    /ends_at 必须晚于 starts_at/);
  assert.match(document.paths['/admin/banners/{banner_id}'].patch.description,
    /ACTIVE.+资料更新.+重查 READY\/PUBLIC\/BANNER 文件和有效 target/);
  for (const [path, method, successStatus] of [
    ['/admin/banners', 'post', '201'],
    ['/admin/banners/{banner_id}', 'patch', '200'],
    ['/admin/banners/{banner_id}', 'delete', '200'],
    ['/admin/banners/{banner_id}/restore', 'post', '200'],
  ]) {
    const operation = document.paths[path][method];
    const parameterReferences = (operation.parameters ?? [])
      .map((parameter) => parameter.$ref)
      .filter((reference) => typeof reference === 'string');
    assert.ok(parameterReferences.includes('#/components/parameters/IdempotencyKey'),
      `Banner mutation must require Idempotency-Key: ${method.toUpperCase()} ${path}`);
    if (method !== 'post' || path.endsWith('/restore')) {
      assert.ok(parameterReferences.includes('#/components/parameters/IfMatch'),
        `Banner existing-resource mutation must require If-Match: ${method.toUpperCase()} ${path}`);
    }
    const success = operation.responses[successStatus];
    assert.equal(success.headers?.['Cache-Control']?.$ref, '#/components/headers/CacheControlNoStore');
    assert.equal(success.headers?.Pragma?.$ref, '#/components/headers/PragmaNoCache');
    assert.equal(success.content?.['application/json']?.schema?.$ref,
      '#/components/schemas/BannerResponse');
    assert.match(operation.description, /BANNER_RESOURCE_RESPONSE/,
      `Banner mutation must name its closed replay policy: ${method.toUpperCase()} ${path}`);
  }
  assert.equal(
    document.paths['/admin/banners/{banner_id}'].delete.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/ClosedReasonRequest',
  );
  assert.equal(
    document.paths['/admin/banners/{banner_id}/restore'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/ClosedReasonRequest',
  );
  const bannerListDescription = document.paths['/admin/banners'].get.description ?? '';
  assert.match(bannerListDescription, /默认排除 ARCHIVED/);
  assert.match(bannerListDescription, /sort_order ASC,id ASC/);
  const storeHomeDescription = document.paths['/store/home'].get.description ?? '';
  assert.match(storeHomeDescription, /ACTIVE.+未归档/);
  assert.match(storeHomeDescription, /文件仍为 READY\/PUBLIC\/BANNER/);
  assert.match(storeHomeDescription, /starts_at 为空或 starts_at <= now/);
  assert.match(storeHomeDescription, /ends_at 为空或 now < ends_at/);
  assert.match(storeHomeDescription, /sort_order ASC,id ASC/);
  assert.match(storeHomeDescription, /URL origin.+allowlist/);
  const storeBannerBaseFields = ['banner_id', 'title', 'image_url', 'sort_order'];
  assertClosedBannerViewSchema(schemas.StoreBannerView, storeBannerBaseFields, 'StoreBannerView');
  const storeBannerFields = new Set([...storeBannerBaseFields, ...BANNER_TARGET_FIELDS]);
  assert.equal(storeBannerFields.size, 7, 'StoreBannerView must expose exactly seven fields');
  for (const managementField of ['file_id', 'status', 'version']) {
    assert.equal(storeBannerFields.has(managementField), false,
      `StoreBannerView must not expose ${managementField}`);
  }
  assert.match(document.paths['/admin/banners/{banner_id}'].delete.description ?? '',
    /ACTIVE 不得直接归档/);
  assert.match(document.paths['/admin/banners/{banner_id}/restore'].post.description ?? '',
    /ARCHIVED 恢复为 DRAFT/);
  const bannerViewBaseFields = [
    'banner_id', 'title', 'file_id', 'image_url', 'sort_order', 'starts_at', 'ends_at', 'status', 'version',
  ];
  assertClosedBannerViewSchema(schemas.BannerView, bannerViewBaseFields, 'BannerView');
  assert.deepEqual(schemas.BannerView.allOf[0].properties.starts_at.type, ['string', 'null']);
  assert.deepEqual(schemas.BannerView.allOf[0].properties.ends_at.type, ['string', 'null']);
  assert.equal(new Set([...bannerViewBaseFields, ...BANNER_TARGET_FIELDS]).size, 12,
    'BannerView must expose exactly twelve fields');

  const inventoryListParameters = document.paths['/admin/inventory'].get.parameters ?? [];
  assert.ok(!inventoryListParameters.some((parameter) => parameter.name === 'low_stock'),
    'inventory list must not expose a threshold without a frozen data source');
  const inventoryListDescription = document.paths['/admin/inventory'].get.description ?? '';
  assert.match(inventoryListDescription, /available_qty.+physical_qty-locked_qty/);
  assert.match(inventoryListDescription, /product_name ASC,sku_id ASC/);
  assert.match(inventoryListDescription, /ARCHIVED SKU.+只读/);
  assert.ok(schemas.InventoryView.required.includes('sku_name'));
  assert.ok(schemas.InventoryView.required.includes('sku_status'));
  assert.deepEqual(schemas.InventoryView.properties.sku_status.enum,
    ['ACTIVE', 'INACTIVE', 'ARCHIVED']);

  const inventoryAdjustment = schemas.InventoryAdjustmentAction;
  assert.deepEqual(inventoryAdjustment.required, ['physical_delta', 'reason']);
  assert.deepEqual(inventoryAdjustment.properties.physical_delta, {
    type: 'integer',
    format: 'int32',
    minimum: -2_147_483_648,
    maximum: 2_147_483_647,
    not: { const: 0 },
    description: inventoryAdjustment.properties.physical_delta.description,
  });
  assert.equal(inventoryAdjustment.properties.reason.minLength, 2);
  assert.equal(inventoryAdjustment.properties.reason.maxLength, 500);

  const inventoryPreviewPath = '/admin/inventory/{sku_id}/adjustment-preview';
  const inventoryConfirmPath = '/admin/inventory/{sku_id}/adjustments';
  const inventoryPreview = document.paths[inventoryPreviewPath].post;
  const inventoryConfirm = document.paths[inventoryConfirmPath].post;
  assert.ok(operationParameterReferences(document, inventoryPreviewPath)
    .includes('#/components/parameters/IdempotencyKey'));
  assert.equal(requestSchema(document, inventoryPreviewPath).allOf?.[0]?.$ref,
    '#/components/schemas/InventoryAdjustmentAction');
  assert.equal(requestSchema(document, inventoryPreviewPath).unevaluatedProperties, false);
  assert.equal(inventoryPreview.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/InventoryAdjustmentPreviewResponse');
  assert.equal(inventoryPreview.responses['200'].headers['Cache-Control'].$ref,
    '#/components/headers/CacheControlNoStore');
  assert.equal(inventoryPreview.responses['200'].headers.Pragma.$ref,
    '#/components/headers/PragmaNoCache');
  assert.match(inventoryPreview.description, /HASH_ONLY/);
  assert.match(inventoryPreview.description, /INVENTORY\.ADJUST/);
  assert.match(inventoryPreview.description, /TTL 固定 60 秒/);
  assert.match(inventoryPreview.description, /ARCHIVED SKU.+409 STATE_CONFLICT.+不签发 preview/);
  assert.match(inventoryPreview.description, /physical_after < locked_qty.+200 warning/);

  assert.deepEqual(requestSchema(document, inventoryConfirmPath).allOf.map((schema) => schema.$ref), [
    '#/components/schemas/InventoryAdjustmentAction',
    '#/components/schemas/HighRiskConfirmationFields',
  ]);
  assert.equal(requestSchema(document, inventoryConfirmPath).unevaluatedProperties, false);
  assert.ok(operationParameterReferences(document, inventoryConfirmPath)
    .includes('#/components/parameters/IdempotencyKey'));
  assert.ok(operationParameterReferences(document, inventoryConfirmPath)
    .includes('#/components/parameters/IfMatch'));
  assert.equal(inventoryPreview.responses['422'].$ref, '#/components/responses/BusinessError');
  assert.equal(inventoryConfirm.responses['422'].$ref, '#/components/responses/BusinessError');
  assert.equal(inventoryConfirm.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/InventoryAdjustmentCommandResponse');
  assert.equal(inventoryConfirm.responses['200'].headers['Cache-Control'].$ref,
    '#/components/headers/CacheControlNoStore');
  assert.equal(inventoryConfirm.responses['200'].headers.Pragma.$ref,
    '#/components/headers/PragmaNoCache');
  assert.match(inventoryConfirm.description, /STOCK_INSUFFICIENT.+422/);
  assert.match(inventoryConfirm.description, /422 INVENTORY_QUANTITY_OUT_OF_RANGE/);
  assert.match(inventoryConfirm.description, /ARCHIVED SKU.+409 STATE_CONFLICT.+不消费 preview/);
  assert.match(inventoryConfirm.description, /失败不消费 preview/);

  const previewImpact = schemas.InventoryAdjustmentPreviewResponse.properties.data.properties.impact;
  assert.equal(previewImpact.additionalProperties, false);
  assert.deepEqual(previewImpact.required, [
    'affected_count', 'physical_before', 'physical_after', 'locked_before', 'locked_after',
    'available_before', 'available_after', 'warnings',
  ]);
  assert.deepEqual(previewImpact.properties.affected_count, { const: 1 });
  const inventoryCommandData = schemas.InventoryAdjustmentCommandResponse.properties.data;
  assert.equal(inventoryCommandData.additionalProperties, false);
  assert.deepEqual(inventoryCommandData.properties.resource_type, { const: 'inventory' });
  assert.deepEqual(inventoryCommandData.properties.status, { const: 'SUCCEEDED' });
  assert.equal(inventoryCommandData.properties.version.minimum, 1);

  const inventoryLedgerValues = [
    'INITIAL', 'MANUAL_INCREASE', 'MANUAL_DECREASE', 'ORDER_PAID_DEDUCT', 'ORDER_RESERVE',
    'ORDER_RELEASE', 'REFUND_RESTOCK', 'RETURN_RESTOCK', 'RETURN_DAMAGED', 'COMPENSATION',
  ];
  assert.deepEqual(schemas.InventoryLedgerType.enum, inventoryLedgerValues);
  const ledgerTypeParameter = document.paths['/admin/inventory/{sku_id}/ledger'].get.parameters
    .find((parameter) => parameter.name === 'ledger_type');
  assert.equal(ledgerTypeParameter.schema.$ref, '#/components/schemas/InventoryLedgerType');
  assert.equal(schemas.InventoryLedgerView.properties.ledger_type.$ref,
    '#/components/schemas/InventoryLedgerType');
  assert.match(document.paths['/admin/inventory/{sku_id}/ledger'].get.description ?? '',
    /occurred_at DESC,id DESC/);

  const uploadIntent = schemas.UploadIntentRequest;
  assert.equal(uploadIntent.additionalProperties, false);
  assert.ok(uploadIntent.required.includes('sha256'));
  assert.deepEqual(uploadIntent.properties.mime_type.enum, ['image/jpeg', 'image/png']);
  assert.equal(uploadIntent.properties.size.maximum, 5_242_880);
  assert.equal(uploadIntent.properties.sha256.pattern, '^[a-f0-9]{64}$');
  const uploadComplete = schemas.UploadCompleteRequest;
  assert.equal(uploadComplete.additionalProperties, false);
  assert.deepEqual(uploadComplete.required, ['sha256', 'size']);
  assert.equal(uploadComplete.properties.sha256.type, 'string');
  assert.equal(uploadComplete.properties.sha256.pattern, '^[a-f0-9]{64}$');
  assert.equal(uploadComplete.properties.size.maximum, 5_242_880);

  const downloadOperation = document.paths['/files/{file_id}/download-url']?.get;
  assert.ok(downloadOperation, 'file download URL GET operation is missing');
  const downloadParameterReferences = (downloadOperation.parameters ?? [])
    .map((parameter) => parameter.$ref)
    .filter((reference) => typeof reference === 'string');
  assert.ok(!downloadParameterReferences.includes('#/components/parameters/IdempotencyKey'),
    'file download URL GET must not accept Idempotency-Key');
  assert.match(downloadOperation.description, /不创建幂等记录/,
    'file download URL description must state that no idempotency record is created');
  assert.equal(downloadOperation.responses?.['200']?.headers?.['Cache-Control']?.$ref,
    '#/components/headers/CacheControlNoStore');
  assert.equal(downloadOperation.responses?.['200']?.headers?.Pragma?.$ref,
    '#/components/headers/PragmaNoCache');

  const storeShoppingOperations = [
    ['get', '/store/favorites'],
    ['get', '/store/favorites/{product_id}'],
    ['put', '/store/favorites/{product_id}'],
    ['delete', '/store/favorites/{product_id}'],
    ['get', '/store/cart'],
    ['put', '/store/cart/items/{sku_id}'],
    ['delete', '/store/cart/items/{sku_id}'],
    ['post', '/store/cart/merge'],
    ['get', '/store/addresses'],
    ['post', '/store/addresses'],
    ['get', '/store/addresses/{address_id}'],
    ['patch', '/store/addresses/{address_id}'],
    ['delete', '/store/addresses/{address_id}'],
  ];
  const storeShoppingWrites = storeShoppingOperations.filter(([method]) =>
    method !== 'get');
  assert.equal(storeShoppingOperations.length, 13);
  assert.equal(storeShoppingWrites.length, 8);
  for (const [method, path] of storeShoppingOperations) {
    const operation = document.paths[path]?.[method];
    const label = `${method.toUpperCase()} ${path}`;
    assert.ok(operation, `missing B8 operation: ${label}`);
    assert.deepEqual(operation.security, [{ bearerAuth: [] }],
      `${label} must require CUSTOMER bearer authentication`);
    const references = parameterReferences(operation);
    assert.equal(references.includes('#/components/parameters/IdempotencyKey'), method !== 'get',
      `${label} Idempotency-Key requirement drifted`);
    assertStoreNoStore(operation.responses['200'], label);
    for (const status of ['400', '401', '403', '404', '500']) {
      assert.equal(operation.responses[status]?.$ref, '#/components/responses/StoreCustomerError',
        `${label} ${status} must use the B8 no-store error wire`);
    }
    assert.equal(operation.responses['409']?.$ref,
      '#/components/responses/StoreCustomerConflict');
    assert.equal(operation.responses['422']?.$ref,
      '#/components/responses/StoreCustomerBusinessError');
    assert.equal(operation.responses['429']?.$ref,
      '#/components/responses/StoreCustomerRateLimited');
  }
  for (const [method, path] of storeShoppingWrites) {
    const operation = document.paths[path][method];
    const label = `${method.toUpperCase()} ${path}`;
    assert.match(operation.description, /HASH_ONLY 幂等策略/,
      `${label} must use HASH_ONLY idempotency`);
    assert.match(operation.description, /不缓存响应正文/,
      `${label} must not persist response bodies`);
    assert.match(operation.description, /同一 Idempotency-Key 不得重复应用命令/,
      `${label} must not reapply a replayed command`);
    assert.match(operation.description, /重放时必须重新鉴权并返回当前投影/,
      `${label} must reauthorize and return the current projection`);
    assert.match(operation.description, /无法安全重放时返回 409 并要求客户端刷新/,
      `${label} must fail unsafe replay with 409 and require refresh`);
  }
  for (const [method, path] of storeShoppingOperations) {
    const references = parameterReferences(document.paths[path][method]);
    const mustMatchVersion = path === '/store/addresses/{address_id}' &&
      (method === 'patch' || method === 'delete');
    assert.equal(references.includes('#/components/parameters/IfMatch'), mustMatchVersion,
      `${method.toUpperCase()} ${path} If-Match requirement drifted`);
  }
  for (const [path, parameterName] of [
    ['/store/favorites/{product_id}', 'product_id'],
    ['/store/cart/items/{sku_id}', 'sku_id'],
    ['/store/addresses/{address_id}', 'address_id'],
  ]) {
    for (const operation of Object.entries(document.paths[path])
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([, value]) => value)) {
      const parameter = operation.parameters.find((candidate) =>
        candidate.name === parameterName && candidate.in === 'path');
      assert.equal(parameter?.schema?.pattern, ULID_PATTERN,
        `${path} ${parameterName} must be a ULID`);
    }
  }

  const favoriteListKeyword = document.paths['/store/favorites'].get.parameters
    .find((parameter) => parameter.name === 'keyword');
  assert.deepEqual(favoriteListKeyword.schema, {
    type: 'string', minLength: 1, maxLength: 200,
  });
  assert.match(document.paths['/store/favorites'].get.description,
    /created_at DESC,id DESC/);
  assert.match(document.paths['/store/favorites'].get.description,
    /trim.+商品名称.+大小写不敏感/);
  assert.equal(document.paths['/store/favorites/{product_id}'].get.operationId,
    'getStoreFavoritesByProductId');
  assert.equal(document.paths['/store/favorites/{product_id}'].get.responses['200']
    .content['application/json'].schema.$ref,
  '#/components/schemas/FavoriteStateResponse');
  for (const method of ['put', 'delete']) {
    const operation = document.paths['/store/favorites/{product_id}'][method];
    assert.match(operation.description, /HASH_ONLY/);
    assert.equal(operation.responses['200'].content['application/json'].schema.$ref,
      '#/components/schemas/FavoriteStateResponse');
  }
  assert.deepEqual(schemas.FavoriteProductView.required, [
    'product_id', 'name', 'primary_image_url', 'minimum_active_price', 'is_salable', 'availability',
  ]);
  assert.deepEqual(Object.keys(schemas.FavoriteProductView.properties),
    schemas.FavoriteProductView.required);
  assert.deepEqual(schemas.FavoriteProductView.properties.availability.enum,
    ['SALEABLE', 'OUT_OF_STOCK', 'UNAVAILABLE']);
  assert.equal(schemas.FavoriteView.properties.product.$ref,
    '#/components/schemas/FavoriteProductView');
  assert.deepEqual(schemas.FavoriteStateResponse.properties.data.required,
    ['product_id', 'is_favorite']);

  const closedB8Schemas = [
    'FavoriteProductView', 'FavoriteView', 'FavoriteListResponse', 'FavoriteStateResponse',
    'CartItemWriteRequest', 'CartMergeItemInput', 'CartMergeRequest', 'CartItemView', 'CartResponse',
    'AddressWriteRequest', 'StoreAddressSummaryView', 'StoreAddressSummaryResponse',
    'StoreAddressDetailView', 'StoreAddressDetailResponse',
  ];
  for (const schemaName of closedB8Schemas) {
    assert.equal(schemas[schemaName].type, 'object', `${schemaName} must remain an object schema`);
    assert.equal(schemas[schemaName].additionalProperties, false,
      `${schemaName} must reject undeclared properties`);
  }
  assert.equal(schemas.FavoriteListResponse.properties.data.additionalProperties, false);
  assert.equal(schemas.FavoriteListResponse.properties.data.properties.pagination.additionalProperties, false);
  assert.equal(schemas.FavoriteStateResponse.properties.data.additionalProperties, false);
  assert.equal(schemas.CartResponse.properties.data.additionalProperties, false);

  assert.equal(Object.hasOwn(schemas, 'CartQuantityRequest'), false,
    'legacy CartQuantityRequest must be removed');
  assert.deepEqual(schemas.CartItemWriteRequest, {
    type: 'object',
    additionalProperties: false,
    required: ['quantity', 'selected'],
    properties: {
      quantity: { type: 'integer', minimum: 1, maximum: 99 },
      selected: { type: 'boolean' },
    },
  });
  assert.deepEqual(schemas.CartMergeItemInput.required, ['sku_id', 'quantity', 'selected']);
  assert.equal(schemas.CartMergeItemInput.properties.sku_id.pattern, ULID_PATTERN);
  const mergeItems = schemas.CartMergeRequest.properties.items;
  assert.equal(mergeItems.minItems, 1);
  assert.equal(mergeItems.maxItems, 100);
  assert.equal(mergeItems.uniqueItems, true);
  assert.equal(mergeItems['x-unique-by'], 'sku_id');
  assert.equal(mergeItems.items.$ref, '#/components/schemas/CartMergeItemInput');
  assert.match(mergeItems.description, /sku_id 必须两两不同/);
  assert.match(document.paths['/store/cart/merge'].post.description,
    /全成全败.+封顶 99.+existing OR incoming.+新键表示新的合并命令/s);
  assert.equal(document.paths['/store/cart/items/{sku_id}'].put.requestBody
    .content['application/json'].schema.$ref, '#/components/schemas/CartItemWriteRequest');
  for (const [method, path] of [
    ['put', '/store/cart/items/{sku_id}'],
    ['delete', '/store/cart/items/{sku_id}'],
    ['post', '/store/cart/merge'],
  ]) {
    const operation = document.paths[path][method];
    assert.match(operation.description, /HASH_ONLY/);
    assert.equal(operation.responses['200'].content['application/json'].schema.$ref,
      '#/components/schemas/CartResponse');
  }
  assert.deepEqual(schemas.CartItemView.required, [
    'sku_id', 'product_id', 'product_name', 'sku_name', 'spec_json', 'primary_image_url',
    'quantity', 'selected', 'retail_price', 'available_stock', 'sale_status',
  ]);
  assert.equal(Object.hasOwn(schemas.CartItemView.properties, 'change_flags'), false);
  assert.deepEqual(schemas.CartItemView.properties.sale_status.enum,
    ['SALEABLE', 'INSUFFICIENT_STOCK', 'OUT_OF_STOCK', 'INACTIVE', 'DELETED']);
  const cartData = schemas.CartResponse.properties.data;
  assert.deepEqual(cartData.required, ['cart_id', 'items', 'total_amount']);
  assert.equal(Object.hasOwn(cartData.properties, 'version'), false);
  assert.deepEqual(cartData.properties.cart_id.type, ['string', 'null']);
  assert.match(document.paths['/store/cart'].get.description,
    /不得写数据库.+cart_id=null.+items=\[\]/s);
  assert.match(cartData.description, /selected=true.+SALEABLE/);

  const addressRequest = schemas.AddressWriteRequest;
  assert.deepEqual(addressRequest.required,
    ['recipient_name', 'phone', 'province', 'city', 'district', 'detail', 'is_default']);
  assert.deepEqual(addressRequest.properties.phone, {
    type: 'string', pattern: '^[0-9]{11}$', writeOnly: true,
  });
  for (const field of ['recipient_name', 'province', 'city', 'district', 'detail']) {
    assert.equal(addressRequest.properties[field].minLength, 1,
      `${field} must be non-empty`);
    assert.match(addressRequest.properties[field].pattern, /\\u0000/,
      `${field} must reject control characters`);
  }
  for (const method of ['get', 'patch', 'delete']) {
    const operation = document.paths['/store/addresses/{address_id}'][method];
    assert.match(operation.description, /跨客户访问统一返回 404/);
  }
  assert.match(document.paths['/store/addresses'].post.description,
    /AES-256-GCM.+customer_address:<address_id>:phone_ciphertext.+qingxu:store-address-phone:v1/s);
  assert.match(document.paths['/store/addresses/{address_id}'].patch.description,
    /DEFAULT_ADDRESS_REQUIRED/);
  assert.match(document.paths['/store/addresses/{address_id}'].delete.description,
    /created_at ASC,id ASC/);

  for (const responseName of [
    'StoreCustomerError', 'StoreCustomerConflict',
    'StoreCustomerBusinessError', 'StoreCustomerRateLimited',
  ]) assertStoreNoStore(document.components.responses[responseName], responseName);
  assert.deepEqual(document.components.responses.StoreCustomerConflict.content
    ['application/json'].schema.properties.code.enum,
  ['RESOURCE_VERSION_CONFLICT', 'STATE_CONFLICT']);
  assert.deepEqual(document.components.responses.StoreCustomerBusinessError.content
    ['application/json'].schema.properties.code.enum,
  ['CART_ITEM_LIMIT_EXCEEDED', 'DEFAULT_ADDRESS_REQUIRED']);
  const customerRateLimit = document.components.responses.StoreCustomerRateLimited;
  assert.equal(customerRateLimit.headers['Retry-After'].required, true);
  assert.equal(customerRateLimit.headers['Retry-After'].schema.minimum, 1);
  assert.equal(customerRateLimit.headers['Retry-After'].schema.maximum, 60);
  assert.match(customerRateLimit.description, /13 个.+CUSTOMER.+HMAC.+每 60 秒最多 120 次/s);
  assert.match(customerRateLimit.description, /fail closed/);
  for (const typeName of [
    'FavoriteProductView', 'FavoriteStateResponse', 'CartMergeItemInput', 'CartItemWriteRequest',
  ]) assert.match(generatedContract, new RegExp(`\\b${typeName}\\b`),
    `generated contract is missing ${typeName}`);

  const stateConflictDescription = document.components.responses.StateConflict.description;
  const businessErrorDescription = document.components.responses.BusinessError.description;
  assert.match(stateConflictDescription, /\bSOFT_DELETED_KEY_RESERVED\b/);
  assert.match(businessErrorDescription, /\bACTIVE_PRODUCT_DEPENDENCY\b/);
  assert.match(businessErrorDescription, /\bFILE_CONTENT_MISMATCH\b/);
  for (const errorCode of [
    'PRODUCT_PRIMARY_IMAGE_REQUIRED',
    'PRODUCT_ACTIVE_SKU_REQUIRED',
    'ACTIVE_SKU_DEPENDENCY',
    'ACTIVE_INVENTORY_RESERVATION',
    'INVENTORY_QUANTITY_OUT_OF_RANGE',
    'STOCK_INSUFFICIENT',
  ]) {
    assert.match(businessErrorDescription, new RegExp(`\\b${errorCode}\\b`));
  }

  const references = collectReferences(document);
  assert.ok(!references.includes('#/components/schemas/LifecycleAction'),
    'legacy LifecycleAction reference must be removed');
  for (const reference of references) resolveLocalReference(document, reference);
  const schemaReferences = references.filter((reference) =>
    reference.startsWith('#/components/schemas/')).length;
  assert.equal(schemaReferences, 701, 'OpenAPI schema reference count drifted');
  assert.equal(references.length, 2_653, 'OpenAPI local reference count drifted');

  process.stdout.write(JSON.stringify({
    status: 'passed',
    paths: pathCount,
    operations: operations.length,
    operation_ids: new Set(operationIds).size,
    schemas: Object.keys(schemas).length,
    schema_references: schemaReferences,
    local_references: references.length,
    dangling_references: 0,
  }) + '\n');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
