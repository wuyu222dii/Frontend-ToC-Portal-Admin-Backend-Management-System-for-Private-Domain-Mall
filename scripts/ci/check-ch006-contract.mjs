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
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-ch006-contract-'));
const bundledPath = join(temporaryDirectory, 'openapi.json');

const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const MASTER_DATA_PATHS = [
  '/admin/brands/{brand_id}/lifecycle-preview',
  '/admin/brands/{brand_id}/lifecycle-changes',
  '/admin/categories/{category_id}/lifecycle-preview',
  '/admin/categories/{category_id}/lifecycle-changes',
];
const PRODUCT_PATHS = [
  '/admin/products/{product_id}/lifecycle-preview',
  '/admin/products/{product_id}/lifecycle-changes',
  '/admin/skus/{sku_id}/lifecycle-preview',
  '/admin/skus/{sku_id}/lifecycle-changes',
];
const LIFECYCLE_PATHS = [...MASTER_DATA_PATHS, ...PRODUCT_PATHS];
const LIFECYCLE_CONFIRM_PATHS = LIFECYCLE_PATHS.filter((path) => path.endsWith('/lifecycle-changes'));

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
  assert.equal(document.info.version, '2.4.1-ch006');

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

  const schemas = document.components.schemas;
  assert.equal(Object.keys(schemas).length, 306, 'OpenAPI schema count drifted');

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
  assert.deepEqual(masterLifecycle.required, ['action', 'reason']);
  assert.deepEqual(masterLifecycle.properties.action.enum, ['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
  assert.deepEqual(schemas.LifecycleAction.properties.action.enum, ['DEACTIVATE', 'SOFT_DELETE']);

  for (const path of MASTER_DATA_PATHS) {
    assert.equal(firstSchemaReference(document, path), '#/components/schemas/MasterDataLifecycleAction');
  }
  for (const path of PRODUCT_PATHS) {
    assert.equal(firstSchemaReference(document, path), '#/components/schemas/LifecycleAction');
  }
  for (const path of LIFECYCLE_PATHS) {
    assert.equal(requestSchema(document, path).unevaluatedProperties, false,
      `lifecycle request must reject undeclared properties: ${path}`);
  }
  for (const path of LIFECYCLE_CONFIRM_PATHS) {
    const schema = requestSchema(document, path);
    assert.equal(schema.allOf?.[1]?.$ref, '#/components/schemas/HighRiskConfirmationFields',
      `lifecycle confirmation must include high-risk confirmation fields: ${path}`);
    assert.ok(operationParameterReferences(document, path).includes('#/components/parameters/IfMatch'),
      `lifecycle confirmation must require If-Match: ${path}`);
  }

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

  const references = collectReferences(document);
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
