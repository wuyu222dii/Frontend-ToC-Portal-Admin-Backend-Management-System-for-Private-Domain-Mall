import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const specificationPath = join(repositoryRoot, 'product-materials/docs/03-技术设计/openapi.yaml');
const redoclyCli = join(repositoryRoot, 'node_modules/@redocly/cli/bin/cli.js');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-ch010-contract-'));
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

function assertLifecycleActionSchema(schema, schemaName) {
  assert.deepEqual(schema.required, ['action', 'reason'], `${schemaName} required fields drifted`);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['action', 'reason'],
    `${schemaName} must declare only action and reason`);
  assert.deepEqual(schema.properties.action.enum, ['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
  assert.equal(schema.properties.reason.minLength, 2);
  assert.equal(schema.properties.reason.maxLength, 500);
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
  assert.equal(document.info.version, '2.4.2-ch010');

  const pathCount = Object.keys(document.paths).length;
  const operations = Object.values(document.paths).flatMap((pathItem) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([, operation]) => operation),
  );
  const operationIds = operations.map((operation) => operation.operationId);
  assert.equal(pathCount, 172, 'OpenAPI path count drifted');
  assert.equal(operations.length, 196, 'OpenAPI operation count drifted');
  assert.equal(new Set(operationIds).size, 196, 'operationId values must be unique');
  assert.ok(operationIds.every((operationId) => typeof operationId === 'string' && operationId.length > 0));
  const adminProductKeyword = document.paths['/admin/products'].get.parameters
    .find((parameter) => parameter.name === 'keyword');
  assert.deepEqual(
    adminProductKeyword?.schema,
    { type: 'string', minLength: 1, maxLength: 200 },
    'Admin product keyword must remain bounded to the implemented query limit',
  );

  const schemas = document.components.schemas;
  assert.equal(Object.keys(schemas).length, 307, 'OpenAPI schema count drifted');
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
  ]) {
    assert.match(businessErrorDescription, new RegExp(`\\b${errorCode}\\b`));
  }

  const references = collectReferences(document);
  assert.ok(!references.includes('#/components/schemas/LifecycleAction'),
    'legacy LifecycleAction reference must be removed');
  for (const reference of references) resolveLocalReference(document, reference);
  const schemaReferences = references.filter((reference) =>
    reference.startsWith('#/components/schemas/')).length;
  assert.equal(schemaReferences, 685, 'OpenAPI schema reference count drifted');

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
