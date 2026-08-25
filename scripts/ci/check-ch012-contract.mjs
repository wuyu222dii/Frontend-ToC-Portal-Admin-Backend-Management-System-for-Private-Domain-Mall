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
const redoclyCli = join(repositoryRoot, 'node_modules/@redocly/cli/bin/cli.js');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-ch012-contract-'));
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
  assert.equal(document.info.version, '2.4.3-ch012');

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
  assert.equal(Object.keys(schemas).length, 312, 'OpenAPI schema count drifted');
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
  assert.equal(schemaReferences, 692, 'OpenAPI schema reference count drifted');

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
