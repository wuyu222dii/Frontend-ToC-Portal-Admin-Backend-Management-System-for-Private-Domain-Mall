import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

process.env.QINGXU_CONTRACT_EXPECTED_VERSION ??= '2.4.10-ch026';
process.env.QINGXU_CONTRACT_EXPECTED_SCHEMA_REFERENCES ??= '706';
process.env.QINGXU_CONTRACT_EXPECTED_LOCAL_REFERENCES ??= '2726';
process.env.QINGXU_CONTRACT_ORDINARY_AFTERSALES_ENABLED = '1';
process.env.QINGXU_CONTRACT_RETURN_ADDRESS_IN_STORE_ERRORS = '0';

await import('./check-ch024-contract.mjs');

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const specificationPath = join(repositoryRoot, 'product-materials/docs/03-技术设计/openapi.yaml');
const generatedContractPath = join(repositoryRoot, 'packages/contracts/src/generated/openapi.ts');
const redoclyCli = join(repositoryRoot, 'node_modules/@redocly/cli/bin/cli.js');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-ch026-contract-'));
const bundledPath = join(temporaryDirectory, 'openapi.json');
const ULID_PATTERN = '^[0-9A-HJKMNP-TV-Z]{26}$';
const AFTERSALE_STATUSES = [
  'PENDING_REVIEW',
  'REJECTED',
  'REFUNDING',
  'WAITING_RETURN',
  'WAITING_RECEIPT',
  'RETURN_EXCEPTION',
  'REFUNDING_AFTER_RETURN',
  'REJECTED_AFTER_RETURN',
  'REFUND_FAILED',
  'COMPLETED',
  'CANCELLED',
];

const B12_OPERATIONS = [
  ['post', '/store/aftersales', 'postStoreAftersales'],
  ['get', '/store/aftersales', 'getStoreAftersales'],
  ['get', '/store/aftersales/{aftersale_id}', 'getStoreAftersalesByAftersaleId'],
  ['post', '/store/aftersales/{aftersale_id}/cancel', 'postStoreAftersalesByAftersaleIdCancel'],
  ['post', '/store/aftersales/{aftersale_id}/return-shipment', 'postStoreAftersalesByAftersaleIdReturnShipment'],
  ['get', '/admin/aftersales', 'getAdminAftersales'],
  ['get', '/admin/aftersales/{aftersale_id}', 'getAdminAftersalesByAftersaleId'],
  ['post', '/admin/aftersales/{aftersale_id}/approve', 'postAdminAftersalesByAftersaleIdApprove'],
  ['post', '/admin/aftersales/{aftersale_id}/reject-preview', 'postAdminAftersalesByAftersaleIdRejectPreview'],
  ['post', '/admin/aftersales/{aftersale_id}/reject', 'postAdminAftersalesByAftersaleIdReject'],
  ['post', '/admin/aftersales/{aftersale_id}/return-inspections', 'postAdminAftersalesByAftersaleIdReturnInspections'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/continue-refund',
    'postAdminAftersalesByAftersaleIdReturnResolutionContinueRefund'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/reject-preview',
    'postAdminAftersalesByAftersaleIdReturnResolutionRejectPreview'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/reject',
    'postAdminAftersalesByAftersaleIdReturnResolutionReject'],
  ['post', '/admin/aftersales/{aftersale_id}/refund-preview',
    'postAdminAftersalesByAftersaleIdRefundPreview'],
  ['post', '/admin/aftersales/{aftersale_id}/refunds', 'postAdminAftersalesByAftersaleIdRefunds'],
  ['post', '/admin/refunds/{refund_id}/retry-preview', 'postAdminRefundsByRefundIdRetryPreview'],
  ['post', '/admin/refunds/{refund_id}/retry', 'postAdminRefundsByRefundIdRetry'],
];

const COMPENSATION_OPERATIONS = [
  ['post', '/admin/orders/{order_id}/manual-compensations/preview',
    'postAdminOrdersByOrderIdManualCompensationsPreview'],
  ['post', '/admin/orders/{order_id}/manual-compensations',
    'postAdminOrdersByOrderIdManualCompensations'],
];

const STORE_OPERATIONS = B12_OPERATIONS.filter(([, path]) => path.startsWith('/store/'));
const HASH_ONLY_OPERATIONS = [
  ...B12_OPERATIONS.filter(([method]) => method === 'post'),
  ...COMPENSATION_OPERATIONS,
  ['post', '/admin/settings/return-address/preview'],
  ['patch', '/admin/settings/return-address'],
];
const RESOURCE_MUTATIONS = [
  ['post', '/store/aftersales/{aftersale_id}/cancel'],
  ['post', '/store/aftersales/{aftersale_id}/return-shipment'],
  ['post', '/admin/aftersales/{aftersale_id}/approve'],
  ['post', '/admin/aftersales/{aftersale_id}/reject'],
  ['post', '/admin/aftersales/{aftersale_id}/return-inspections'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/continue-refund'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/reject'],
  ['post', '/admin/aftersales/{aftersale_id}/refunds'],
  ['post', '/admin/refunds/{refund_id}/retry'],
  ['post', '/admin/orders/{order_id}/manual-compensations'],
  ['patch', '/admin/settings/return-address'],
];
const ADMIN_PREVIEW_PATHS = [
  '/admin/aftersales/{aftersale_id}/reject-preview',
  '/admin/aftersales/{aftersale_id}/return-resolution/reject-preview',
  '/admin/aftersales/{aftersale_id}/refund-preview',
  '/admin/refunds/{refund_id}/retry-preview',
  '/admin/orders/{order_id}/manual-compensations/preview',
];
const ADMIN_FINANCIAL_SUCCESS_RESPONSES = [
  ['/admin/aftersales/{aftersale_id}/refunds', '200'],
  ['/admin/refunds/{refund_id}/retry', '200'],
  ['/admin/orders/{order_id}/manual-compensations', '201'],
];
const B12_2_ADMIN_NO_STORE_SUCCESS_RESPONSES = [
  ['get', '/admin/settings/return-address', '200'],
  ['patch', '/admin/settings/return-address', '200'],
  ['post', '/admin/settings/return-address/preview', '200'],
  ['get', '/admin/aftersales', '200'],
  ['get', '/admin/aftersales/{aftersale_id}', '200'],
  ['post', '/admin/aftersales/{aftersale_id}/approve', '200'],
  ['post', '/admin/aftersales/{aftersale_id}/reject-preview', '200'],
  ['post', '/admin/aftersales/{aftersale_id}/reject', '200'],
];
const B12_3_ADMIN_NO_STORE_SUCCESS_RESPONSES = [
  ['post', '/admin/aftersales/{aftersale_id}/return-inspections', '200'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/continue-refund', '200'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/reject-preview', '200'],
  ['post', '/admin/aftersales/{aftersale_id}/return-resolution/reject', '200'],
];
const ADMIN_QUOTA_PATHS = [
  '/admin/aftersales/{aftersale_id}/refund-preview',
  '/admin/aftersales/{aftersale_id}/refunds',
  '/admin/refunds/{refund_id}/retry-preview',
  '/admin/refunds/{refund_id}/retry',
  '/admin/orders/{order_id}/manual-compensations/preview',
  '/admin/orders/{order_id}/manual-compensations',
];

function resolveReference(document, value) {
  if (!value?.$ref) return value;
  assert.match(value.$ref, /^#\//);
  return value.$ref.slice(2).split('/').reduce((current, encodedPart) => {
    const part = encodedPart.replaceAll('~1', '/').replaceAll('~0', '~');
    return current[part];
  }, document);
}

function parameters(document, operation) {
  return (operation.parameters ?? []).map((parameter) => resolveReference(document, parameter));
}

function assertParameter(document, operation, name, expectedReference) {
  const parameter = (operation.parameters ?? []).find((candidate) =>
    candidate.$ref === expectedReference || candidate.name === name);
  assert.ok(parameter, `${operation.operationId} must require ${name}`);
  if (expectedReference) assert.equal(parameter.$ref, expectedReference);
  return resolveReference(document, parameter);
}

function assertUlid(property, label) {
  assert.equal(property?.pattern, ULID_PATTERN, `${label} must use the ULID pattern`);
}

function assertUniqueObjectArray(property, key, maximum, label) {
  assert.equal(property.minItems, 1, `${label} must not be empty`);
  assert.equal(property.maxItems, maximum, `${label} maximum drifted`);
  assert.equal(property.uniqueItems, true, `${label} must reject identical duplicates`);
  assert.equal(property['x-unique-by'], key,
    `${label} must reject different objects carrying the same ${key}`);
}

try {
  const bundle = spawnSync(process.execPath, [
    redoclyCli,
    'bundle',
    specificationPath,
    '--ext',
    'json',
    '--output',
    bundledPath,
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  if (bundle.status !== 0) {
    process.stderr.write(bundle.stdout);
    process.stderr.write(bundle.stderr);
    process.exit(bundle.status ?? 1);
  }

  const document = JSON.parse(readFileSync(bundledPath, 'utf8'));
  const generatedContract = readFileSync(generatedContractPath, 'utf8');
  const schemas = document.components.schemas;

  const fileDownload = document.paths['/files/{file_id}/download-url'].get;
  assert.match(fileDownload.description, /CUSTOMER.+本账户创建.+AFTERSALE_EVIDENCE/s);
  assert.match(fileDownload.description,
    /SUPER_ADMIN.+本人创建.+跨创建者.+aftersale_evidence.+READY\/PRIVATE\/AFTERSALE_EVIDENCE.+private\/\{file_id\}/s);
  assert.match(fileDownload.description, /不得因 SUPER_ADMIN 角色放宽其他跨账户私有文件/);

  assert.equal(B12_OPERATIONS.length, 18);
  assert.equal(COMPENSATION_OPERATIONS.length, 2);
  for (const [method, path, operationId] of [
    ...B12_OPERATIONS,
    ...COMPENSATION_OPERATIONS,
  ]) {
    const operation = document.paths[path]?.[method];
    assert.ok(operation, `missing ${method.toUpperCase()} ${path}`);
    assert.equal(operation.operationId, operationId,
      `${method.toUpperCase()} ${path} operationId drifted`);
  }

  const callback = document.paths['/callbacks/wechat-refund'].post;
  assert.equal(callback.operationId, 'postCallbacksWechatRefund');
  assert.match(callback.description, /B12 development.+Mock Provider.+不注册/);

  for (const [method, path] of STORE_OPERATIONS) {
    const operation = document.paths[path][method];
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    assert.match(operation.description, /CUSTOMER/);
    assert.match(operation.description, /120\/60|60 秒 120 次/);
    assert.match(operation.description, /fail closed/);
    const successCodes = path === '/store/aftersales' && method === 'post'
      ? ['200', '201'] : ['200'];
    for (const successCode of successCodes) {
      const success = operation.responses[successCode];
      assert.equal(success.headers?.['Cache-Control']?.$ref,
        '#/components/headers/StoreCacheControlNoStoreRequired');
      assert.equal(success.headers?.Pragma?.$ref,
        '#/components/headers/StorePragmaNoCacheRequired');
    }
    const expectedErrors = {
      400: '#/components/responses/StoreCustomerError',
      401: '#/components/responses/StoreCustomerError',
      403: '#/components/responses/StoreCustomerError',
      404: '#/components/responses/StoreCustomerError',
      409: path === '/store/aftersales' && method === 'post'
        ? '#/components/responses/B12StoreAftersaleConflict'
        : '#/components/responses/StoreCustomerConflict',
      422: '#/components/responses/StoreCustomerBusinessError',
      429: '#/components/responses/StoreCustomerRateLimited',
      500: '#/components/responses/StoreCustomerError',
    };
    for (const [status, reference] of Object.entries(expectedErrors)) {
      assert.equal(operation.responses[status]?.$ref, reference,
        `${operation.operationId} ${status} response drifted`);
    }
  }

  for (const [method, path] of HASH_ONLY_OPERATIONS) {
    const operation = document.paths[path][method];
    assert.equal(operation['x-idempotency-storage'], 'HASH_ONLY');
    assertParameter(document, operation, 'Idempotency-Key',
      '#/components/parameters/IdempotencyKey');
  }
  for (const [method, path] of RESOURCE_MUTATIONS) {
    assertParameter(document, document.paths[path][method], 'If-Match',
      '#/components/parameters/IfMatch');
  }
  assert.equal(document.components.headers.CacheControlNoStore.required, undefined,
    'legacy non-Store no-store header must remain optional');
  assert.equal(document.components.headers.PragmaNoCache.required, undefined,
    'legacy non-Store pragma header must remain optional');
  assert.equal(document.components.headers.AdminCacheControlNoStoreRequired.required, true);
  assert.equal(document.components.headers.AdminPragmaNoCacheRequired.required, true);
  for (const path of ADMIN_PREVIEW_PATHS) {
    const headers = document.paths[path].post.responses['200'].headers;
    assert.equal(resolveReference(document, headers['Cache-Control']).required, true,
      `${path} must require Cache-Control`);
    assert.equal(resolveReference(document, headers.Pragma).required, true,
      `${path} must require Pragma`);
  }
  for (const [path, status] of ADMIN_FINANCIAL_SUCCESS_RESPONSES) {
    const headers = document.paths[path].post.responses[status].headers;
    assert.equal(headers?.['Cache-Control']?.$ref,
      '#/components/headers/AdminCacheControlNoStoreRequired',
      `${path} ${status} must require no-store`);
    assert.equal(headers?.Pragma?.$ref,
      '#/components/headers/AdminPragmaNoCacheRequired',
      `${path} ${status} must require no-cache`);
  }
  const adminAftersaleHeaders = document.paths['/admin/aftersales/{aftersale_id}']
    .get.responses['200'].headers;
  assert.equal(resolveReference(document, adminAftersaleHeaders['Cache-Control']).required, true);
  assert.equal(resolveReference(document, adminAftersaleHeaders.Pragma).required, true);
  for (const [method, path, status] of B12_2_ADMIN_NO_STORE_SUCCESS_RESPONSES) {
    const headers = document.paths[path][method].responses[status].headers;
    const cacheControl = resolveReference(document, headers?.['Cache-Control']);
    const pragma = resolveReference(document, headers?.Pragma);
    assert.equal(cacheControl?.required, true,
      `${method.toUpperCase()} ${path} ${status} must require Cache-Control`);
    assert.equal(cacheControl?.schema?.const, 'no-store, private',
      `${method.toUpperCase()} ${path} ${status} Cache-Control drifted`);
    assert.equal(pragma?.required, true,
      `${method.toUpperCase()} ${path} ${status} must require Pragma`);
    assert.equal(pragma?.schema?.const, 'no-cache',
      `${method.toUpperCase()} ${path} ${status} Pragma drifted`);
  }
  for (const [method, path, status] of B12_3_ADMIN_NO_STORE_SUCCESS_RESPONSES) {
    const headers = document.paths[path][method].responses[status].headers;
    assert.equal(headers?.['Cache-Control']?.$ref,
      '#/components/headers/AdminCacheControlNoStoreRequired',
      `${method.toUpperCase()} ${path} ${status} must require no-store`);
    assert.equal(headers?.Pragma?.$ref,
      '#/components/headers/AdminPragmaNoCacheRequired',
      `${method.toUpperCase()} ${path} ${status} must require no-cache`);
  }

  for (const [method, path] of B12_OPERATIONS) {
    const match = path.match(/\{(aftersale_id|refund_id)\}/);
    if (!match) continue;
    const parameter = parameters(document, document.paths[path][method])
      .find((candidate) => candidate.name === match[1] && candidate.in === 'path');
    assertUlid(parameter?.schema, `${method.toUpperCase()} ${path} ${match[1]}`);
  }
  for (const name of ['order_id', 'customer_id']) {
    const parameter = parameters(document, document.paths['/admin/aftersales'].get)
      .find((candidate) => candidate.name === name);
    assertUlid(parameter?.schema, `GET /admin/aftersales ${name}`);
  }
  assertUlid(parameters(document, document.paths['/store/aftersales'].get)
    .find((candidate) => candidate.name === 'order_id')?.schema,
  'GET /store/aftersales order_id');
  for (const [method, path] of COMPENSATION_OPERATIONS) {
    const orderId = parameters(document, document.paths[path][method])
      .find((candidate) => candidate.name === 'order_id' && candidate.in === 'path');
    assertUlid(orderId?.schema, `${method.toUpperCase()} ${path} order_id`);
  }

  const create = schemas.CreateAftersaleRequest;
  assert.equal(create.oneOf.length, 2);
  const previewCommand = create.oneOf.find((branch) =>
    branch.properties.action.const === 'PREVIEW');
  const confirmCommand = create.oneOf.find((branch) =>
    branch.properties.action.const === 'CONFIRM');
  assert.ok(previewCommand);
  assert.ok(confirmCommand);
  for (const [action, branch] of [['PREVIEW', previewCommand], ['CONFIRM', confirmCommand]]) {
    assert.equal(branch.additionalProperties, false);
    assert.ok(branch.required.includes('action'));
    assert.deepEqual(branch.properties.reason_code.enum, [
      'UNSHIPPED_NO_LONGER_NEEDED',
      'ITEM_DAMAGED',
      'ITEM_NOT_AS_DESCRIBED',
      'WRONG_ITEM',
      'MISSING_ITEM',
      'QUALITY_ISSUE',
      'OTHER',
    ]);
    assertUlid(branch.properties.order_id, `CreateAftersaleRequest ${action} order_id`);
    assertUniqueObjectArray(branch.properties.items, 'order_item_id', 100,
      `CreateAftersaleRequest ${action} items`);
    assert.equal(branch.properties.evidence_file_ids.maxItems, 9);
    assert.equal(branch.properties.evidence_file_ids.uniqueItems, true);
    assertUlid(branch.properties.evidence_file_ids.items,
      `CreateAftersaleRequest ${action} evidence_file_ids[]`);
    const otherReason = branch.oneOf.find((candidate) =>
      candidate.properties.reason_code.const === 'OTHER');
    assert.deepEqual(otherReason.required, ['reason_text']);
    assert.equal(otherReason.properties.reason_text.type, 'string');
  }
  assert.ok(!previewCommand.required.includes('preview_token'));
  assert.ok(!Object.hasOwn(previewCommand.properties, 'preview_token'));
  assert.ok(confirmCommand.required.includes('preview_token'));
  assert.ok(confirmCommand.required.includes('confirmation_hash'));
  assert.equal(confirmCommand.properties.confirmation_hash.pattern, '^[a-f0-9]{64}$');
  assertUlid(schemas.AftersaleLineInput.properties.order_item_id,
    'AftersaleLineInput.order_item_id');
  assert.equal(schemas.AftersaleLineInput.properties.quantity.maximum, 99);
  const createOperation = document.paths['/store/aftersales'].post;
  assert.match(createOperation.description, /PREVIEW.+CONFIRM.+不同 Idempotency-Key/s);
  const previewResponse = createOperation.responses['200'].content['application/json'].schema;
  assert.equal(previewResponse.additionalProperties, false);
  const previewData = previewResponse.properties.data;
  assert.equal(previewData.additionalProperties, false);
  assert.deepEqual(previewData.properties.blockers.items.enum, [
    'ORDER_NOT_ELIGIBLE', 'ITEM_UNAVAILABLE', 'AFTERSALE_QUOTA_EXCEEDED',
    'EVIDENCE_UNAVAILABLE',
  ]);
  assert.equal(previewData.oneOf.find((branch) =>
    branch.properties.can_submit.const === false).properties.preview_token.const, null);
  assert.equal(createOperation.responses['201'].content['application/json'].schema.$ref,
    '#/components/schemas/StoreAftersaleResponse');
  assert.deepEqual(document.components.responses.B12StoreAftersaleConflict
    .content['application/json'].schema.properties.code.enum,
  ['RESOURCE_VERSION_CONFLICT', 'STATE_CONFLICT', 'AFTERSALE_PREVIEW_EXPIRED',
    'AFTERSALE_PREVIEW_MISMATCH', 'AFTERSALE_REQUOTE_REQUIRED']);

  const shipment = schemas.ReturnShipmentRequest.properties;
  assert.equal(shipment.carrier_code.pattern, '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$');
  assert.equal(shipment.carrier_name.maxLength, 80);
  assert.equal(shipment.carrier_name.pattern,
    '^(?=.*\\S)[^\\u0000-\\u001F\\u007F]+$');
  assert.equal(shipment.tracking_no.pattern, '^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$');
  const shipmentView = schemas.ReturnShipmentDetailView;
  assert.ok(shipmentView.required.includes('carrier_code'));
  assert.equal(shipmentView.properties.carrier_code.pattern,
    shipment.carrier_code.pattern);
  assert.equal(shipmentView.properties.carrier_name.pattern,
    shipment.carrier_name.pattern);
  assert.equal(shipmentView.properties.tracking_no.pattern,
    shipment.tracking_no.pattern);

  const inspection = schemas.ReturnInspectionRequest;
  assert.equal(inspection.discriminator.propertyName, 'result');
  assert.equal(inspection.oneOf.length, 2);
  const passInspection = inspection.oneOf.find((branch) =>
    branch.properties.result.const === 'PASS');
  const abnormalInspection = inspection.oneOf.find((branch) =>
    branch.properties.result.const === 'ABNORMAL');
  assert.ok(passInspection, 'ReturnInspectionRequest PASS branch is missing');
  assert.ok(abnormalInspection, 'ReturnInspectionRequest ABNORMAL branch is missing');
  for (const [name, branch] of [
    ['PASS', passInspection],
    ['ABNORMAL', abnormalInspection],
  ]) {
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual(branch.required, name === 'PASS'
      ? ['result', 'items', 'evidence_file_ids']
      : ['result', 'abnormal_reason', 'items', 'evidence_file_ids']);
    assertUniqueObjectArray(branch.properties.items, 'order_item_id', 100,
      `ReturnInspectionRequest.${name}.items`);
    assert.equal(branch.properties.evidence_file_ids.maxItems, 9);
    assert.equal(branch.properties.evidence_file_ids.uniqueItems, true);
    assertUlid(branch.properties.evidence_file_ids.items,
      `ReturnInspectionRequest.${name}.evidence_file_ids[]`);
  }
  assert.ok(!Object.hasOwn(passInspection.properties, 'abnormal_reason'));
  assert.ok(abnormalInspection.required.includes('abnormal_reason'));
  assert.equal(abnormalInspection.properties.abnormal_reason.minLength, 2);
  assert.equal(abnormalInspection.properties.evidence_file_ids.minItems, 1);
  for (const quantity of [
    'received_qty',
    'approved_refund_qty',
    'restock_qty',
    'damaged_qty',
    'scrap_qty',
    'return_to_customer_qty',
  ]) assert.equal(schemas.ReturnInspectionLine.properties[quantity].maximum, 99);
  assert.equal(schemas.ReturnInspectionLine.additionalProperties, false);
  assert.deepEqual(schemas.ContinueRefundRequest.required, ['resolution', 'reason']);
  assert.equal(schemas.ContinueRefundRequest.additionalProperties, false);
  assert.equal(schemas.ContinueRefundRequest.properties.resolution.const, 'CONTINUE_REFUND');
  assert.equal(schemas.ContinueRefundRequest.properties.reason.minLength, 2);
  assert.equal(schemas.ContinueRefundRequest.properties.reason.maxLength, 500);
  assert.equal(schemas.ContinueRefundRequest.properties.reason.pattern,
    '^[^\\u0000-\\u001F\\u007F]*$');
  const rejectAfterReturnPreview = schemas.RejectAfterReturnPreviewRequest;
  assert.deepEqual(rejectAfterReturnPreview.required, ['resolution', 'reason']);
  assert.equal(rejectAfterReturnPreview.additionalProperties, false);
  assert.equal(rejectAfterReturnPreview.properties.resolution.const, 'REJECT_AFTER_RETURN');
  assert.ok(!Object.hasOwn(rejectAfterReturnPreview.properties, 'preview_token'));
  assert.ok(!Object.hasOwn(rejectAfterReturnPreview.properties, 'confirmation_hash'));
  const rejectAfterReturnConfirm = schemas.RejectAfterReturnConfirmRequest;
  assert.deepEqual(rejectAfterReturnConfirm.required,
    ['resolution', 'reason', 'preview_token', 'confirmation_hash']);
  assert.equal(rejectAfterReturnConfirm.additionalProperties, false);
  assert.equal(rejectAfterReturnConfirm.properties.resolution.const, 'REJECT_AFTER_RETURN');
  assert.equal(rejectAfterReturnConfirm.properties.confirmation_hash.pattern, '^[a-f0-9]{64}$');
  for (const field of ['items', 'evidence_file_ids', 'note', 'abnormal_reason']) {
    assert.ok(!Object.hasOwn(rejectAfterReturnPreview.properties, field));
    assert.ok(!Object.hasOwn(rejectAfterReturnConfirm.properties, field));
  }
  assertUniqueObjectArray(schemas.RefundItemsAction.properties.items,
    'aftersale_item_id', 100, 'RefundItemsAction.items');
  assertUlid(schemas.RefundItemQuantity.properties.aftersale_item_id,
    'RefundItemQuantity.aftersale_item_id');
  assert.equal(schemas.RefundItemQuantity.properties.quantity.maximum, 99);
  assertUlid(schemas.ManualCompensationAction.properties.order_item_id,
    'ManualCompensationAction.order_item_id');
  assert.equal(schemas.ManualCompensationAction.properties.reason.pattern,
    '^[^\\u0000-\\u001F\\u007F]*$');
  assert.match(schemas.ManualCompensationAction.properties.reason.description,
    /trim.+2-500.+控制字符/);
  for (const field of ['compensation_id', 'refund_id', 'order_id', 'order_item_id']) {
    assertUlid(schemas.ManualCompensationResponse.properties.data.properties[field],
      `ManualCompensationResponse.data.${field}`);
  }
  const compensationData = schemas.ManualCompensationResponse.properties.data;
  assert.ok(compensationData.required.includes('refund_no'));
  assert.equal(compensationData.properties.origin_type.const, 'MANUAL_COMPENSATION');

  const consumerActions = schemas.StoreAftersaleDetailResponse
    .properties.data.properties.available_actions.items.enum;
  assert.ok(!consumerActions.includes('RETRY_REFUND'),
    'consumer aftersale actions must not expose Admin-only refund retry');
  assert.ok(schemas.AdminAftersaleDetailResponse.properties.data.properties
    .available_actions.items.enum.includes('RETRY_REFUND'));
  const applicationEvidence = schemas.AdminAftersaleDetailResponse.properties.data
    .properties.application_evidence_file_ids;
  assert.ok(schemas.AdminAftersaleDetailResponse.properties.data.required
    .includes('application_evidence_file_ids'));
  assert.equal(applicationEvidence.maxItems, 9);
  assert.equal(applicationEvidence.uniqueItems, true);
  assertUlid(applicationEvidence.items,
    'AdminAftersaleDetailResponse.data.application_evidence_file_ids[]');
  assert.match(document.paths['/store/aftersales'].get.description,
    /created_at DESC,aftersale_id DESC/);
  const aftersaleList = schemas.AftersaleListItem;
  for (const field of [
    'refund_progress_status', 'refund_processing_status', 'available_actions',
  ]) assert.ok(aftersaleList.required.includes(field));
  assert.deepEqual(aftersaleList.properties.refund_progress_status.enum,
    ['NONE', 'PARTIAL', 'FULL']);
  assert.deepEqual(aftersaleList.properties.refund_processing_status.enum,
    ['IDLE', 'REFUNDING', 'FAILED']);
  assert.deepEqual(aftersaleList.properties.available_actions.items.enum,
    ['CANCEL', 'SUBMIT_RETURN_SHIPMENT', 'VIEW_ORDER']);

  const orderAftersales = schemas.StoreOrderDetailResponse.properties.data.properties.aftersales;
  assert.equal(orderAftersales.maxItems, undefined,
    'B12 must not keep Store order aftersales fixed empty');
  assert.equal(orderAftersales.items.$ref, '#/components/schemas/OrderAftersaleSummaryView');
  assert.deepEqual(Object.keys(schemas.OrderAftersaleSummaryView.properties), [
    'aftersale_id',
    'aftersale_no',
    'type',
    'status',
    'requested_amount',
    'created_at',
  ], 'Store order aftersale summaries must not leak Admin, inventory or commission fields');
  assert.deepEqual(schemas.OrderAftersaleSummaryView.properties.status.enum,
    AFTERSALE_STATUSES, 'Store order aftersale status must be closed');
  assertUlid(schemas.StoreOrderListItem.properties.order_id,
    'StoreOrderListItem.order_id');
  for (const field of ['order_item_id', 'product_id', 'sku_id']) {
    assertUlid(schemas.StoreOrderCompactItem.properties[field],
      `StoreOrderCompactItem.${field}`);
  }
  assertUlid(schemas.StoreOrderDetailResponse.properties.data.properties.order_id,
    'StoreOrderDetailResponse.data.order_id');
  for (const field of ['order_item_id', 'product_id', 'sku_id']) {
    assertUlid(schemas.OrderItemView.properties[field], `OrderItemView.${field}`);
  }
  for (const schemaName of ['StoreOrderListItem', 'StoreOrderDetailResponse']) {
    const actions = schemaName === 'StoreOrderListItem'
      ? schemas[schemaName].properties.available_actions
      : schemas[schemaName].properties.data.properties.available_actions;
    assert.ok(actions.items.enum.includes('APPLY_AFTERSALE'));
    assert.match(actions.description, /payment_status=PAID.+payment_resolution=NORMAL/s);
    assert.match(actions.description,
      /order_status=PENDING_SHIPMENT\/SHIPPING.+aftersale_expires_at=null/s);
    assert.match(actions.description,
      /order_status=COMPLETED.+当前时间 <= aftersale_expires_at/s);
    assert.match(actions.description, /order_status=CLOSED.+绝不返回/s);
    assert.match(actions.description, /其他订单项.+不得全局阻止/s);
    assert.match(actions.description, /remaining quota > 0/);
    assert.match(actions.description, /客户端不得自行推导/);
  }
  const refundAttempts = schemas.StoreOrderDetailResponse.properties.data
    .properties.refund_attempts;
  assert.match(refundAttempts.description, /B12 稳定普通退款尝试/);
  assert.match(refundAttempts.description, /总部金额补偿/);
  assert.match(refundAttempts.description, /不返回 Provider 原文/);
  assert.equal(refundAttempts.items.$ref,
    '#/components/schemas/RefundAttemptDetailView');
  for (const schemaName of ['StoreAftersaleDetailResponse', 'AdminAftersaleDetailResponse']) {
    const items = schemas[schemaName].properties.data.properties.refund_attempts.items;
    assert.equal(items.allOf?.[0]?.$ref,
      '#/components/schemas/RefundAttemptDetailView');
    assert.equal(items.allOf?.[1]?.properties?.origin_type?.const, 'AFTERSALE',
      `${schemaName} refund attempts must be scoped to AFTERSALE`);
  }

  const refundResponse = schemas.RefundResponse.properties.data;
  assert.ok(refundResponse.required.includes('items'));
  assert.equal(refundResponse.properties.origin_type.const, 'AFTERSALE');
  const refundResponseItem = refundResponse.properties.items.items;
  assert.equal(refundResponse.properties.items.minItems, 1);
  assert.equal(refundResponse.properties.items.maxItems, 100);
  assert.ok(refundResponseItem.required.includes('aftersale_item_id'));
  assertUlid(refundResponseItem.properties.aftersale_item_id,
    'RefundResponse.data.items[].aftersale_item_id');
  assert.equal(refundResponseItem.properties.aftersale_item_id.type, 'string');
  assert.equal(refundResponseItem.properties.quantity.minimum, 1);
  assert.equal(refundResponseItem.properties.quantity.maximum, 99);
  assert.deepEqual(document.paths['/admin/refunds/{refund_id}/retry'].post.responses['200']
    .content['application/json'].schema.oneOf,
  [
    { $ref: '#/components/schemas/RefundResponse' },
    { $ref: '#/components/schemas/ManualCompensationResponse' },
  ]);
  assert.equal(document.paths['/admin/aftersales/{aftersale_id}/refunds'].post
    .responses['200'].content['application/json'].schema.$ref,
  '#/components/schemas/RefundResponse');

  const approve = document.paths['/admin/aftersales/{aftersale_id}/approve'].post;
  assert.match(approve.description, /只推进售后状态/);
  assert.match(approve.description, /不得创建退款/);
  assert.match(approve.description, /refund-preview.+refunds confirm/);
  const returnAddressPublish = document.paths['/admin/settings/return-address'].patch;
  assert.match(returnAddressPublish.description, /首次配置时为"1"/);
  assert.match(returnAddressPublish.description, /当前版本 ID.+最大版本号.+preview 事实/);
  assert.match(schemas.ReturnAddressResponse.properties.data.properties.version.description,
    /version_no.+乐观锁版本/);
  for (const path of [
    '/admin/aftersales/{aftersale_id}/refunds',
    '/admin/refunds/{refund_id}/retry',
    '/admin/orders/{order_id}/manual-compensations',
  ]) {
    assert.equal(document.paths[path].post['x-development-payment-provider'], 'MOCK_ONLY');
  }

  const businessCodes = document.components.responses.StoreCustomerBusinessError
    .content['application/json'].schema.properties.code.enum;
  assert.ok(businessCodes.includes('AFTERSALE_QUOTA_EXCEEDED'));
  assert.ok(!businessCodes.includes('RETURN_ADDRESS_NOT_CONFIGURED'));
  assert.equal(document.paths['/admin/aftersales/{aftersale_id}/approve']
    .post.responses['422'].$ref,
  '#/components/responses/B12AdminReturnAddressNotConfigured');
  assert.equal(document.components.responses.B12AdminReturnAddressNotConfigured
    .content['application/json'].schema.properties.code.const,
  'RETURN_ADDRESS_NOT_CONFIGURED');
  assert.equal(document.components.responses.B12AdminAftersaleQuotaExceeded
    .content['application/json'].schema.properties.code.const,
  'AFTERSALE_QUOTA_EXCEEDED');
  for (const path of ADMIN_QUOTA_PATHS) {
    assert.equal(document.paths[path].post.responses['422'].$ref,
      '#/components/responses/B12AdminAftersaleQuotaExceeded',
      `${path} must use the closed B12 quota error`);
  }
  assert.match(document.components.responses.StoreCustomerRateLimited.description,
    /B12 的 5 个售后 operation/);

  for (const [schemaName, fieldPath] of [
    ['StoreAftersaleResponse', ['data', 'aftersale_id']],
    ['AdminAftersaleResponse', ['data', 'aftersale_id']],
    ['RefundResponse', ['data', 'refund_id']],
    ['AftersaleListItem', ['aftersale_id']],
    ['AdminAftersaleListItem', ['aftersale_id']],
    ['CustomerOrderSummaryView', ['order_id']],
    ['RefundAttemptDetailView', ['refund_id']],
  ]) {
    const property = fieldPath.reduce((current, field) =>
      field === 'data' ? current.properties.data : current.properties[field], schemas[schemaName]);
    assertUlid(property, `${schemaName}.${fieldPath.join('.')}`);
  }

  for (const generatedType of [
    'CreateAftersaleRequest',
    'ReturnShipmentRequest',
    'ReturnInspectionRequest',
    'RefundItemsAction',
    'StoreAftersaleDetailResponse',
  ]) {
    assert.match(generatedContract, new RegExp(`\\b${generatedType}\\b`),
      `generated contract is missing ${generatedType}`);
  }
  assert.match(generatedContract,
    /UNSHIPPED_NO_LONGER_NEEDED[\s\S]+ITEM_DAMAGED[\s\S]+QUALITY_ISSUE[\s\S]+OTHER/,
    'generated contract is missing the closed aftersale reason union');
  const generatedCreateStart = generatedContract.indexOf('        CreateAftersaleRequest:');
  const generatedCreateEnd = generatedContract.indexOf('\n        ReturnShipmentRequest:',
    generatedCreateStart);
  assert.notEqual(generatedCreateStart, -1);
  assert.notEqual(generatedCreateEnd, -1);
  const generatedCreate = generatedContract.slice(generatedCreateStart, generatedCreateEnd);
  assert.match(generatedCreate, /action: "PREVIEW"/);
  assert.match(generatedCreate, /action: "CONFIRM"/);
  assert.match(generatedCreate, /reason_code\?: "OTHER";\s+reason_text: string;/);
  assert.doesNotMatch(generatedCreate, /& unknown/,
    'CreateAftersaleRequest must remain a generated discriminated union');
  const generatedInspectionStart = generatedContract.indexOf('        ReturnInspectionRequest:');
  const generatedInspectionEnd = generatedContract.indexOf('\n        ContinueRefundRequest:',
    generatedInspectionStart);
  assert.ok(generatedInspectionStart >= 0 && generatedInspectionEnd > generatedInspectionStart,
    'generated ReturnInspectionRequest block is missing');
  const generatedInspection = generatedContract.slice(generatedInspectionStart,
    generatedInspectionEnd);
  assert.doesNotMatch(generatedInspection, /& unknown/,
    'ReturnInspectionRequest must remain a generated discriminated union');
  assert.match(generatedInspection, /result: "PASS"/);
  assert.match(generatedInspection, /result: "ABNORMAL"[\s\S]+abnormal_reason: string/);

  process.stdout.write(JSON.stringify({
    status: 'passed',
    change: 'CH-026',
    version: document.info.version,
    b12_operations: B12_OPERATIONS.length,
    compensation_operations: COMPENSATION_OPERATIONS.length,
    paths: Object.keys(document.paths).length,
    operations: Object.values(document.paths).reduce((count, item) =>
      count + Object.keys(item).filter((key) =>
        ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'].includes(key)).length, 0),
    schemas: Object.keys(schemas).length,
    evidence_file_limit: 9,
    dangling_references: 0,
  }) + '\n');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
