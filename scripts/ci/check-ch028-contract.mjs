import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

process.env.QINGXU_CONTRACT_EXPECTED_VERSION = '2.4.11-ch028';
process.env.QINGXU_CONTRACT_EXPECTED_SCHEMA_COUNT = '330';
process.env.QINGXU_CONTRACT_EXPECTED_SCHEMA_REFERENCES = '725';
process.env.QINGXU_CONTRACT_EXPECTED_LOCAL_REFERENCES = '2754';

await import('./check-ch026-contract.mjs');

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const specificationPath = join(repositoryRoot, 'product-materials/docs/03-技术设计/openapi.yaml');
const generatedContractPath = join(repositoryRoot, 'packages/contracts/src/generated/openapi.ts');
const packagePath = join(repositoryRoot, 'package.json');
const ciWorkflowPath = join(repositoryRoot, '.github/workflows/ci.yml');
const smokeWorkflowPath = join(repositoryRoot, '.github/workflows/supabase-smoke.yml');
const b13RunnerPath = join(repositoryRoot, 'scripts/ci/test-b13-agent.mjs');
const redoclyCli = join(repositoryRoot, 'node_modules/@redocly/cli/bin/cli.js');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-ch028-contract-'));
const bundledPath = join(temporaryDirectory, 'openapi.json');
const HTTP_METHODS = new Set(['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']);
const EXPECTED_OPERATION_MANIFEST_SHA256 =
  '128509f76f2e62ebe78cd0465205a94236f87f70904bf614664dd1b02548dc80';
const AGENT_AUTH_OPERATIONS = [
  ['post', '/agent/auth/login', 'postAgentAuthLogin'],
  ['post', '/agent/auth/refresh', 'postAgentAuthRefresh'],
  ['post', '/agent/auth/logout', 'postAgentAuthLogout'],
  ['post', '/agent/auth/change-temporary-password', 'postAgentAuthChangeTemporaryPassword'],
  ['post', '/agent/auth/change-password', 'postAgentAuthChangePassword'],
  ['post', '/agent/auth/logout-all', 'postAgentAuthLogoutAll'],
  ['get', '/agent/auth/current', 'getAgentAuthCurrent'],
];
const AGENT_AUTH_RESPONSE_STATUSES = ['200', '400', '401', '403', '404', '409', '422', '429', '500'];
const B133_OPERATIONS = [
  ['get', '/agent/customers', 'getAgentCustomers', 'AgentCustomerListResponse', 'agentBearerAuth'],
  ['get', '/agent/customers/{customer_id}', 'getAgentCustomersByCustomerId',
    'AgentCustomerDetailResponse', 'agentBearerAuth'],
  ['get', '/agent/orders', 'getAgentOrders', 'AgentOrderListResponse', 'agentBearerAuth'],
  ['get', '/agent/orders/{order_id}', 'getAgentOrdersByOrderId', 'AgentOrderResponse', 'agentBearerAuth'],
  ['get', '/admin/customers', 'getAdminCustomers', 'AdminCustomerListResponse', 'bearerAuth'],
  ['get', '/admin/customers/{customer_id}', 'getAdminCustomersByCustomerId',
    'AdminCustomerDetailResponse', 'bearerAuth'],
  ['post', '/admin/customers/{customer_id}/attribution-transfer-preview',
    'postAdminCustomersByCustomerIdAttributionTransferPreview', 'HighRiskPreviewResponse', 'bearerAuth'],
  ['post', '/admin/customers/{customer_id}/attribution-transfers',
    'postAdminCustomersByCustomerIdAttributionTransfers', 'AdminCustomerResponse', 'bearerAuth'],
];
const B134_OPERATIONS = [
  ['get', '/agent/dashboard', 'getAgentDashboard', 'AgentDashboardResponse', 'agentBearerAuth'],
  ['get', '/agent/commissions', 'getAgentCommissions', 'CommissionListResponse', 'agentBearerAuth'],
  ['get', '/agent/commissions/{commission_snapshot_id}', 'getAgentCommissionsByCommissionSnapshotId',
    'AgentCommissionDetailResponse', 'agentBearerAuth'],
  ['get', '/agent/wallet', 'getAgentWallet', 'WalletResponse', 'agentBearerAuth'],
  ['get', '/admin/agents/{agent_id}/commissions', 'getAdminAgentsByAgentIdCommissions',
    'AdminAgentCommissionHistoryResponse', 'bearerAuth'],
  ['get', '/admin/agents/{agent_id}/wallet-ledger', 'getAdminAgentsByAgentIdWalletLedger',
    'AdminAgentWalletLedgerResponse', 'bearerAuth'],
  ['get', '/admin/commission-rules/current', 'getAdminCommissionRulesCurrent',
    'CommissionRulesResponse', 'bearerAuth'],
  ['get', '/admin/commission-rules/skus', 'getAdminCommissionRulesSkus',
    'CommissionRuleSkuListResponse', 'bearerAuth'],
  ['post', '/admin/commission-rule-versions/preview', 'postAdminCommissionRuleVersionsPreview',
    'CommissionRulePreviewResponse', 'bearerAuth'],
  ['post', '/admin/commission-rule-versions', 'postAdminCommissionRuleVersions',
    'CommissionRuleVersionResponse', 'bearerAuth'],
  ['get', '/admin/commission-rule-versions', 'getAdminCommissionRuleVersions',
    'CommissionRuleVersionListResponse', 'bearerAuth'],
  ['get', '/admin/commission-rule-versions/{version_id}', 'getAdminCommissionRuleVersionsByVersionId',
    'CommissionRuleVersionResponse', 'bearerAuth'],
  ['get', '/admin/orders/{order_id}/commission-explanation', 'getAdminOrdersByOrderIdCommissionExplanation',
    'OrderCommissionExplanationResponse', 'bearerAuth'],
];
const B135_OPERATIONS = [
  ['get', '/agent/bank-accounts', 'getAgentBankAccounts', 'BankAccountListResponse', '200'],
  ['post', '/agent/bank-accounts', 'postAgentBankAccounts', 'BankAccountResponse', '200'],
  ['get', '/agent/withdrawals', 'getAgentWithdrawals', 'WithdrawalListResponse', '200'],
  ['post', '/agent/withdrawals', 'postAgentWithdrawals', 'WithdrawalResponse', '201'],
  ['get', '/agent/withdrawals/{withdrawal_id}', 'getAgentWithdrawalsByWithdrawalId',
    'WithdrawalResponse', '200'],
];

function responseSchema(document, method, path, status = '200') {
  return document.paths[path][method].responses[status].content['application/json'].schema;
}

function assertClosedObject(schema, label, required, optional = []) {
  assert.equal(schema.type, 'object', `${label} must be an object`);
  assert.equal(schema.additionalProperties, false, `${label} must be closed`);
  assert.deepEqual(schema.required.slice().sort(), required.slice().sort(), `${label} required fields drifted`);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...required, ...optional].sort(),
    `${label} properties drifted`);
}

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow step is missing: ${name}`);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next === -1 ? undefined : next);
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
  const rootPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
  const ciWorkflow = readFileSync(ciWorkflowPath, 'utf8');
  const smokeWorkflow = readFileSync(smokeWorkflowPath, 'utf8');
  const b13Runner = readFileSync(b13RunnerPath, 'utf8');
  const schemas = document.components.schemas;
  const operationManifest = Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([method, operation]) =>
        `${method.toUpperCase()}\t${path}\t${operation.operationId}`))
    .sort();
  const operationManifestSha256 = createHash('sha256')
    .update(`${operationManifest.join('\n')}\n`)
    .digest('hex');
  const agentPaths = Object.entries(document.paths).filter(([path]) => path.startsWith('/agent/'));
  const agentOperations = agentPaths.flatMap(([, pathItem]) => Object.entries(pathItem)
    .filter(([method]) => HTTP_METHODS.has(method))
    .map(([, operation]) => operation));

  assert.equal(document.info.version, '2.4.11-ch028');
  assert.equal(operationManifest.length, 198, 'operation manifest count drifted');
  assert.equal(operationManifestSha256, EXPECTED_OPERATION_MANIFEST_SHA256,
    'method, path, or operationId manifest drifted');
  assert.equal(agentPaths.length, 21, 'Agent path count drifted');
  assert.equal(agentOperations.length, 23, 'Agent operation count drifted');
  assert.equal(new Set(agentOperations.map(({ operationId }) => operationId)).size, 23,
    'Agent operationId values must remain unique');

  assert.equal(rootPackage.scripts['db:test-b13-agent'], 'node scripts/ci/test-b13-agent.mjs',
    'B13 Agent database gate package alias drifted');
  const ciB13Step = workflowStep(
    ciWorkflow,
    'Test B13.1-B13.5 Agent authentication, commerce, operations and finance with PostgreSQL and Redis',
  );
  assert.match(ciB13Step, /B13_AGENT_AUTH_DATABASE_TEST_MODE: full/);
  assert.match(ciB13Step, /run: pnpm db:test-b13-agent/);
  const smokeB12Step = smokeWorkflow.indexOf('Run rollback-only B12 aftersales');
  const smokeB13StepIndex = smokeWorkflow.indexOf(
    'Run rollback-only B13.1-B13.5 Agent authentication, commerce, operations and finance smoke',
  );
  assert.ok(smokeB12Step >= 0 && smokeB13StepIndex > smokeB12Step,
    'B13 rollback smoke must run after B12');
  const smokeB13Step = workflowStep(
    smokeWorkflow,
    'Run rollback-only B13.1-B13.5 Agent authentication, commerce, operations and finance smoke',
  );
  assert.match(smokeB13Step, /B13_AGENT_AUTH_DATABASE_TEST_MODE: rollback/);
  assert.match(smokeB13Step, /DATABASE_URL: \$\{\{ secrets\.SUPABASE_RUNTIME_URL \}\}/);
  assert.match(smokeB13Step, /run: pnpm db:test-b13-agent/);
  assert.doesNotMatch(smokeB13Step, /REDIS_URL/,
    'B13 rollback smoke must not receive Redis configuration');
  assert.doesNotMatch(smokeWorkflow, /ALLOW_CI_EPHEMERAL_POSTGRES/,
    'protected rollback workflow must not receive the ephemeral PostgreSQL capability');
  assert.match(b13Runner, /if \(mode !== 'full' && mode !== 'rollback'\)/,
    'B13 runner must accept only strict full and rollback modes');
  assert.match(b13Runner,
    /if \(mode === 'full'\) \{[\s\S]+REDIS_URL is required for full mode[\s\S]+\} else \{/,
    'B13 runner must require Redis only inside its full branch');
  assert.match(b13Runner, /B132_AGENT_COMMERCE_DATABASE_TEST_MODE = mode/,
    'B13 runner must bind B13.2 commerce checks to the selected gate mode');
  assert.match(b13Runner, /src\/agent-commerce\.integration\.spec\.ts/,
    'B13 runner must execute the B13.2 commerce integration check');
  assert.match(b13Runner, /B133_AGENT_OPERATIONS_DATABASE_TEST_MODE = mode/,
    'B13 runner must bind B13.3 operations checks to the selected gate mode');
  assert.match(b13Runner, /src\/agent-operations\.integration\.spec\.ts/,
    'B13 runner must execute the B13.3 operations integration check');
  assert.match(b13Runner, /B134_AGENT_FINANCE_DATABASE_TEST_MODE = mode/,
    'B13 runner must bind B13.4 finance checks to the selected gate mode');
  assert.match(b13Runner, /B135_AGENT_FINANCE_DATABASE_TEST_MODE = mode/,
    'B13 runner must bind B13.5 finance checks to the selected gate mode');
  const b133RunnerIndex = b13Runner.indexOf('src/agent-operations.integration.spec.ts');
  const b134DatabaseRunnerIndex = b13Runner.indexOf('src/commission.integration.spec.ts');
  const b134ApiRunnerIndex = b13Runner.indexOf('src/admin-commissions/admin-commissions.integration.spec.ts');
  const b135DatabaseRunnerIndex = b13Runner.indexOf('src/agent-finance.integration.spec.ts');
  assert.ok(b133RunnerIndex >= 0 && b134DatabaseRunnerIndex > b133RunnerIndex &&
    b134ApiRunnerIndex > b134DatabaseRunnerIndex && b135DatabaseRunnerIndex > b134ApiRunnerIndex,
  'B13 runner must execute B13.4 then B13.5 checks in order after B13.3');
  const rollbackBranch = b13Runner.slice(b13Runner.indexOf('} else {', b13Runner.indexOf("if (mode === 'full')")));
  assert.doesNotMatch(rollbackBranch, /REDIS_URL/,
    'B13 rollback runner branch must remain independent of Redis');

  const agentBearer = document.components.securitySchemes.agentBearerAuth;
  assert.equal(agentBearer.type, 'http');
  assert.equal(agentBearer.scheme, 'bearer');
  assert.equal(agentBearer.bearerFormat, 'AgentJWT');
  assert.match(agentBearer.description,
    /aud=qingxu-agent-web.+role=AGENT_ADMIN.+assurance=PASSWORD/s);
  assert.match(agentBearer.description, /restriction=CHANGE_PASSWORD_ONLY.+无 refresh token/s);
  assert.match(agentBearer.description, /不得接受 Admin 或 Store token/);

  const publicAgentOperations = new Set(['postAgentAuthLogin', 'postAgentAuthRefresh']);
  for (const operation of agentOperations) {
    if (publicAgentOperations.has(operation.operationId)) {
      assert.deepEqual(operation.security, [], `${operation.operationId} must remain public`);
    } else {
      assert.deepEqual(operation.security, [{ agentBearerAuth: [] }],
        `${operation.operationId} must use only the Agent realm`);
    }
  }
  assert.equal(agentOperations.filter(({ security }) =>
    security?.some((requirement) => Object.hasOwn(requirement, 'agentBearerAuth'))).length, 21);
  const controlledAgentFileOperationId = 'getFilesByFileIdDownloadUrl';
  let controlledAgentFileOperationCount = 0;
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (path.startsWith('/agent/')) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const usesAgentRealm = operation.security?.some((requirement) =>
        Object.hasOwn(requirement, 'agentBearerAuth')) ?? false;
      if (operation.operationId === controlledAgentFileOperationId) {
        controlledAgentFileOperationCount += 1;
        assert.equal(method, 'get');
        assert.equal(path, '/files/{file_id}/download-url');
        assert.deepEqual(operation.security, [{ bearerAuth: [] }, { agentBearerAuth: [] }],
          'the QR download operation must expose the ordinary and Agent realms as alternatives');
      } else {
        assert.equal(usesAgentRealm, false,
          `${method.toUpperCase()} ${path} must not use the Agent realm`);
      }
    }
  }
  assert.equal(controlledAgentFileOperationCount, 1,
    'exactly one non-Agent operation may expose the Agent realm');

  for (const [method, path, operationId, responseName, securityScheme] of B133_OPERATIONS) {
    const operation = document.paths[path][method];
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.security, [{ [securityScheme]: [] }],
      `${operationId} must use only its declared realm`);
    assert.deepEqual(Object.keys(operation.responses).sort(), AGENT_AUTH_RESPONSE_STATUSES,
      `${operationId} response status set drifted`);
    assert.equal(responseSchema(document, method, path).$ref, `#/components/schemas/${responseName}`,
      `${operationId} success response schema drifted`);
  }
  for (const [method, path, operationId, responseName, securityScheme] of B134_OPERATIONS) {
    const operation = document.paths[path][method];
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.security, [{ [securityScheme]: [] }],
      `${operationId} must use only its declared realm`);
    assert.deepEqual(Object.keys(operation.responses).sort(), AGENT_AUTH_RESPONSE_STATUSES,
      `${operationId} response status set drifted`);
    assert.equal(responseSchema(document, method, path).$ref, `#/components/schemas/${responseName}`,
      `${operationId} success response schema drifted`);
  }
  for (const [method, path, operationId, responseName, successStatus] of B135_OPERATIONS) {
    const operation = document.paths[path][method];
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.security, [{ agentBearerAuth: [] }],
      `${operationId} must use only the Agent realm`);
    const expectedStatuses = AGENT_AUTH_RESPONSE_STATUSES.map((status) =>
      status === '200' ? successStatus : status).sort();
    assert.deepEqual(Object.keys(operation.responses).sort(), expectedStatuses,
      `${operationId} response status set drifted`);
    assert.equal(responseSchema(document, method, path, successStatus).$ref,
      `#/components/schemas/${responseName}`, `${operationId} success response schema drifted`);
  }

  const successEnvelopeFields = ['code', 'message', 'data', 'request_id'];
  for (const responseName of [
    'AgentCustomerListResponse',
    'AgentCustomerDetailResponse',
    'AgentOrderListResponse',
    'AgentOrderResponse',
    'AdminCustomerListResponse',
    'AdminCustomerDetailResponse',
    'AdminCustomerResponse',
    'HighRiskPreviewResponse',
  ]) assertClosedObject(schemas[responseName], responseName, successEnvelopeFields);

  const agentCustomerListData = schemas.AgentCustomerListResponse.properties.data;
  assertClosedObject(agentCustomerListData, 'AgentCustomerListResponse.data', ['items', 'pagination']);
  assertClosedObject(agentCustomerListData.properties.pagination,
    'AgentCustomerListResponse.data.pagination', ['page', 'page_size', 'total']);
  assert.equal(agentCustomerListData.properties.items.items.$ref,
    '#/components/schemas/AgentCustomerListItem');
  assertClosedObject(schemas.AgentCustomerListItem, 'AgentCustomerListItem', [
    'customer_id', 'customer_alias', 'nickname_masked', 'phone_tail', 'city', 'consumption_amount',
    'consumption_count', 'registered_at', 'last_product_name', 'account_status', 'binding_status',
    'binding_id', 'binding_started_at',
  ]);
  assert.deepEqual(schemas.AgentCustomerListItem.properties.account_status, { const: 'ACTIVE' });
  assert.deepEqual(schemas.AgentCustomerListItem.properties.binding_status, { const: 'BOUND' });
  assert.deepEqual(schemas.AgentCustomerListItem.properties.phone_tail.type, ['string', 'null']);
  assert.equal(schemas.AgentCustomerListItem.properties.phone_tail.pattern, '^[0-9]{4}$');
  assert.equal(schemas.AgentCustomerListItem.properties.consumption_amount.$ref,
    '#/components/schemas/NonNegativeMoney');

  const agentCustomerDetailData = schemas.AgentCustomerDetailResponse.properties.data;
  assertClosedObject(agentCustomerDetailData, 'AgentCustomerDetailResponse.data',
    ['customer', 'binding_period', 'orders', 'recent_products']);
  assert.equal(agentCustomerDetailData.properties.customer.$ref, '#/components/schemas/CustomerView');
  assertClosedObject(agentCustomerDetailData.properties.binding_period,
    'AgentCustomerDetailResponse.data.binding_period', ['binding_id', 'started_at', 'ended_at']);
  assert.equal(agentCustomerDetailData.properties.orders.items.$ref,
    '#/components/schemas/CustomerOrderSummaryView');
  assert.equal(agentCustomerDetailData.properties.recent_products.items.$ref,
    '#/components/schemas/RecentProductSummaryView');
  assertClosedObject(schemas.CustomerView, 'CustomerView', [
    'customer_id', 'customer_alias', 'nickname_masked', 'phone_tail', 'city', 'consumption_amount',
    'consumption_count', 'registered_at', 'last_product_name', 'binding', 'version',
  ]);
  assertClosedObject(schemas.AttributionBindingView, 'AttributionBindingView',
    ['binding_id', 'customer_id', 'agent_id', 'agent_name', 'started_at', 'customer_version']);
  assertClosedObject(schemas.CustomerOrderSummaryView, 'CustomerOrderSummaryView',
    ['order_id', 'order_no', 'display_status', 'payable_amount', 'paid_at']);
  assertClosedObject(schemas.RecentProductSummaryView, 'RecentProductSummaryView',
    ['product_id', 'product_name', 'sku_id', 'sku_name', 'last_purchased_at']);

  const agentOrderListData = schemas.AgentOrderListResponse.properties.data;
  assertClosedObject(agentOrderListData, 'AgentOrderListResponse.data', ['items', 'pagination']);
  assert.equal(agentOrderListData.properties.items.items.$ref, '#/components/schemas/AgentOrderListItem');
  assert.equal(agentOrderListData.properties.pagination.$ref, '#/components/schemas/PaginationView');
  const agentOrderListItem = schemas.AgentOrderListItem;
  assertClosedObject(agentOrderListItem, 'AgentOrderListItem', [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'final_agent_id', 'customer_alias', 'customer_city',
    'payable_amount', 'items', 'aftersale_summary', 'available_actions', 'created_at', 'paid_at',
  ]);
  assert.deepEqual(agentOrderListItem.properties.order_status.enum,
    ['PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED']);
  assert.deepEqual(agentOrderListItem.properties.payment_status, { const: 'PAID' });
  assert.deepEqual(agentOrderListItem.properties.close_reason.enum,
    ['FULL_REFUND_BEFORE_SHIPMENT', null]);
  assert.deepEqual(agentOrderListItem.properties.payment_resolution.enum,
    ['NORMAL', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED']);
  assert.equal(agentOrderListItem.properties.final_agent_id.type, 'string');
  assert.equal(agentOrderListItem.properties.payable_amount.$ref,
    '#/components/schemas/NonNegativeMoney');
  assert.equal(agentOrderListItem.properties.items.items.$ref,
    '#/components/schemas/AgentOrderCompactItem');
  assert.equal(agentOrderListItem.properties.aftersale_summary.$ref,
    '#/components/schemas/OrderAftersaleListSummary');
  assert.equal(agentOrderListItem.properties.available_actions.items.$ref,
    '#/components/schemas/AgentOrderAvailableAction');
  assert.deepEqual(schemas.AgentOrderAvailableAction.enum, ['VIEW_DETAIL', 'VIEW_COMMISSION']);
  assertClosedObject(schemas.AgentOrderCompactItem, 'AgentOrderCompactItem',
    ['order_item_id', 'product_id', 'sku_id', 'product_name', 'sku_name', 'quantity', 'line_amount']);
  assertClosedObject(schemas.OrderAftersaleListSummary, 'OrderAftersaleListSummary',
    ['active_count', 'latest_aftersale_id', 'latest_status', 'refunded_amount']);

  const agentOrderData = schemas.AgentOrderResponse.properties.data;
  assertClosedObject(agentOrderData, 'AgentOrderResponse.data', [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'final_agent_id', 'payable_amount', 'customer_snapshot',
    'items', 'commission_items', 'aftersales', 'available_actions', 'timeline', 'created_at', 'paid_at',
  ]);
  assert.deepEqual(agentOrderData.properties.order_status.enum,
    ['PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED']);
  assert.deepEqual(agentOrderData.properties.payment_status, { const: 'PAID' });
  assert.deepEqual(agentOrderData.properties.close_reason.enum,
    ['USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT', null]);
  assert.deepEqual(agentOrderData.properties.payment_resolution.enum,
    ['NORMAL', 'LATE_SUCCESS_REFUND_PENDING', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED']);
  for (const [label, orderSchema] of [
    ['AgentOrderListItem', agentOrderListItem],
    ['AgentOrderResponse.data', agentOrderData],
  ]) {
    assert.deepEqual(orderSchema.properties.refund_progress_status.enum,
      ['NONE', 'PARTIAL', 'FULL'], `${label} refund progress enum drifted`);
    assert.deepEqual(orderSchema.properties.refund_processing_status.enum,
      ['IDLE', 'REFUNDING', 'FAILED'], `${label} refund processing enum drifted`);
    assert.deepEqual(orderSchema.properties.fulfillment_status.enum,
      ['NOT_STARTED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
      `${label} fulfillment enum drifted`);
    assert.deepEqual(orderSchema.properties.completion_reason.enum,
      ['CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT', null],
      `${label} completion reason enum drifted`);
  }
  assert.equal(agentOrderData.properties.final_agent_id.type, 'string');
  assertClosedObject(agentOrderData.properties.customer_snapshot, 'AgentOrderResponse.data.customer_snapshot',
    ['customer_alias', 'nickname_masked', 'phone_tail', 'city', 'address_summary_masked']);
  assert.deepEqual(agentOrderData.properties.customer_snapshot.properties.phone_tail.type, ['string', 'null']);
  assert.equal(agentOrderData.properties.customer_snapshot.properties.phone_tail.pattern, '^[0-9]{4}$');
  assert.equal(agentOrderData.properties.items.items.$ref, '#/components/schemas/OrderItemView');
  assertClosedObject(schemas.OrderItemView, 'OrderItemView', [
    'order_item_id', 'product_id', 'sku_id', 'product_name', 'sku_name', 'unit_price', 'quantity',
    'line_amount', 'refunded_quantity', 'reserved_aftersale_quantity', 'shipped_quantity',
  ]);
  const commissionItem = agentOrderData.properties.commission_items.items;
  assertClosedObject(commissionItem, 'AgentOrderResponse.data.commission_items[]',
    ['commission_snapshot_id', 'order_item_id', 'effective_rate', 'rule_source', 'original_commission', 'state']);
  assert.equal(commissionItem.properties.commission_snapshot_id.pattern, '^[0-9A-HJKMNP-TV-Z]{26}$');
  assert.deepEqual(commissionItem.properties.rule_source.enum, ['PLATFORM', 'CATEGORY', 'SKU']);
  assert.deepEqual(commissionItem.properties.state.enum, ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE']);
  assert.equal(agentOrderData.properties.aftersales.items.$ref,
    '#/components/schemas/OrderAftersaleSummaryView');
  assertClosedObject(schemas.OrderAftersaleSummaryView, 'OrderAftersaleSummaryView',
    ['aftersale_id', 'aftersale_no', 'type', 'status', 'requested_amount', 'created_at']);
  assert.deepEqual(schemas.OrderAftersaleSummaryView.properties.type.enum,
    ['REFUND_ONLY', 'RETURN_REFUND']);
  assert.deepEqual(schemas.OrderAftersaleSummaryView.properties.status.enum, [
    'PENDING_REVIEW', 'REJECTED', 'REFUNDING', 'WAITING_RETURN', 'WAITING_RECEIPT',
    'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN', 'REJECTED_AFTER_RETURN', 'REFUND_FAILED',
    'COMPLETED', 'CANCELLED',
  ]);
  assert.equal(agentOrderData.properties.available_actions.items.$ref,
    '#/components/schemas/AgentOrderAvailableAction');
  assert.equal(agentOrderData.properties.timeline.items.$ref,
    '#/components/schemas/AgentOrderTimelineEventView');
  assertClosedObject(schemas.AgentOrderTimelineEventView, 'AgentOrderTimelineEventView',
    ['event_id', 'axis', 'event_code', 'from_status', 'to_status', 'occurred_at']);
  assert.deepEqual(schemas.AgentOrderTimelineEventView.properties.axis.enum,
    ['PAYMENT', 'REFUND', 'FULFILLMENT', 'AFTERSALE']);
  assert.deepEqual(schemas.AgentOrderTimelineEventView.properties.event_code.enum, [
    'PAYMENT_SUCCEEDED', 'REFUND_STARTED', 'REFUND_SUCCEEDED', 'REFUND_FAILED', 'READY_TO_SHIP',
    'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'AFTERSALE_CREATED', 'AFTERSALE_STATUS_CHANGED',
  ]);

  const adminCustomerListData = schemas.AdminCustomerListResponse.properties.data;
  assertClosedObject(adminCustomerListData, 'AdminCustomerListResponse.data', ['items', 'pagination']);
  assertClosedObject(adminCustomerListData.properties.pagination,
    'AdminCustomerListResponse.data.pagination', ['page', 'page_size', 'total']);
  assert.equal(adminCustomerListData.properties.items.items.$ref,
    '#/components/schemas/AdminCustomerView');
  assertClosedObject(schemas.AdminCustomerView, 'AdminCustomerView', [
    'customer_id', 'customer_alias', 'account_status', 'nickname_masked', 'phone_masked',
    'consumption_amount', 'consumption_count', 'registered_at', 'last_product_name', 'last_purchase_at',
    'last_order_id', 'management_note_present', 'binding', 'deletion_request_status', 'version',
  ], ['city']);
  assert.deepEqual(schemas.AdminCustomerView.properties.account_status.enum,
    ['ACTIVE', 'DISABLED', 'DELETION_PENDING', 'ANONYMIZED']);
  assert.deepEqual(schemas.AdminCustomerView.properties.phone_masked.type, ['string', 'null']);
  assert.deepEqual(schemas.AdminCustomerView.properties.deletion_request_status.enum,
    ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED', null]);
  assert.equal(schemas.AdminCustomerResponse.properties.data.$ref,
    '#/components/schemas/AdminCustomerView');

  const adminCustomerDetailData = schemas.AdminCustomerDetailResponse.properties.data;
  assertClosedObject(adminCustomerDetailData, 'AdminCustomerDetailResponse.data',
    ['customer', 'orders', 'binding_history']);
  assert.equal(adminCustomerDetailData.properties.customer.$ref,
    '#/components/schemas/AdminCustomerView');
  assert.equal(adminCustomerDetailData.properties.orders.items.$ref,
    '#/components/schemas/CustomerOrderSummaryView');
  assert.equal(adminCustomerDetailData.properties.binding_history.items.$ref,
    '#/components/schemas/BindingHistoryView');
  assertClosedObject(schemas.BindingHistoryView, 'BindingHistoryView', [
    'binding_id', 'agent_id', 'agent_name', 'started_at', 'ended_at', 'end_reason', 'recorded_at',
  ], ['change_reason']);
  assert.deepEqual(schemas.BindingHistoryView.properties.end_reason.enum,
    ['TRANSFERRED', 'DIRECTED', 'ACCOUNT_DELETED', null]);

  const highRiskPreviewData = schemas.HighRiskPreviewResponse.properties.data;
  assertClosedObject(highRiskPreviewData, 'HighRiskPreviewResponse.data',
    ['preview_token', 'confirmation_hash', 'resource_etag', 'expires_at', 'impact']);
  assertClosedObject(highRiskPreviewData.properties.impact, 'HighRiskPreviewResponse.data.impact',
    ['affected_count', 'metrics', 'warnings']);
  assert.equal(highRiskPreviewData.properties.impact.properties.metrics.items.$ref,
    '#/components/schemas/ImpactMetric');
  assertClosedObject(schemas.ImpactMetric, 'ImpactMetric', ['key', 'label', 'before', 'after']);
  assert.deepEqual(schemas.ImpactMetric.properties.before.type, ['string', 'null']);
  assert.deepEqual(schemas.ImpactMetric.properties.after.type, ['string', 'null']);

  for (const responseName of [
    'AgentDashboardResponse',
    'CommissionListResponse',
    'AgentCommissionDetailResponse',
    'WalletResponse',
    'AdminAgentCommissionHistoryResponse',
    'AdminAgentWalletLedgerResponse',
    'CommissionRulesResponse',
    'CommissionRuleSkuListResponse',
    'CommissionRulePreviewResponse',
    'CommissionRuleVersionResponse',
    'CommissionRuleVersionListResponse',
    'OrderCommissionExplanationResponse',
    'BankAccountResponse',
    'BankAccountListResponse',
    'WithdrawalResponse',
    'WithdrawalListResponse',
  ]) assertClosedObject(schemas[responseName], responseName, successEnvelopeFields);

  const commissionListData = schemas.CommissionListResponse.properties.data;
  assertClosedObject(commissionListData, 'CommissionListResponse.data', ['items', 'pagination']);
  assert.equal(commissionListData.properties.items.items.$ref,
    '#/components/schemas/AgentCommissionLedgerItem');
  assertClosedObject(commissionListData.properties.pagination, 'CommissionListResponse.data.pagination',
    ['page', 'page_size', 'total']);
  assertClosedObject(schemas.AgentCommissionLedgerItem, 'AgentCommissionLedgerItem', [
    'ledger_id', 'commission_snapshot_id', 'order_id', 'order_no', 'order_item_id', 'product_id',
    'product_name', 'sku_id', 'sku_name', 'effective_rate', 'commission_base', 'original_commission',
    'refund_id', 'ledger_type', 'position_state', 'expected_change', 'available_change', 'reason',
    'occurred_at',
  ]);
  assert.equal(schemas.AgentCommissionLedgerItem.properties.effective_rate.$ref,
    '#/components/schemas/RatePercentValue');
  assert.equal(schemas.AgentCommissionLedgerItem.properties.commission_base.$ref,
    '#/components/schemas/NonNegativeMoney');
  assert.equal(schemas.AgentCommissionLedgerItem.properties.original_commission.$ref,
    '#/components/schemas/NonNegativeMoney');
  assert.deepEqual(schemas.AgentCommissionLedgerItem.properties.refund_id.type, ['string', 'null']);
  assert.deepEqual(schemas.AgentCommissionLedgerItem.properties.ledger_type.enum,
    ['EXPECTED_CREATED', 'EXPECTED_REDUCED', 'EXPECTED_CANCELLED', 'AVAILABLE_CREDIT', 'REFUND_DEBIT']);
  assert.deepEqual(schemas.AgentCommissionLedgerItem.properties.position_state.enum,
    ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE']);

  const walletData = schemas.WalletResponse.properties.data;
  assertClosedObject(walletData, 'WalletResponse.data', [
    'available_balance', 'frozen_balance', 'is_negative', 'withdrawal_allowed', 'version',
  ], ['blocked_reason']);
  assert.equal(walletData.properties.available_balance.$ref, '#/components/schemas/SignedMoney');
  assert.equal(walletData.properties.frozen_balance.$ref, '#/components/schemas/NonNegativeMoney');
  assert.deepEqual(walletData.properties.blocked_reason.type, ['string', 'null']);

  const dashboardData = schemas.AgentDashboardResponse.properties.data;
  assertClosedObject(dashboardData, 'AgentDashboardResponse.data', [
    'timezone', 'as_of', 'agent_id', 'today_net_sales_amount', 'month_net_sales_amount',
    'today_paid_order_count', 'attributed_customer_count', 'expected_commission', 'available_balance',
    'frozen_balance', 'negative_balance', 'pending_withdrawal_count', 'todo', 'trend',
  ]);
  assert.deepEqual(dashboardData.properties.timezone, { const: 'Asia/Shanghai' });
  assertClosedObject(dashboardData.properties.todo, 'AgentDashboardResponse.data.todo',
    ['commission_exception_count', 'withdrawal_action_count']);
  assert.equal(dashboardData.properties.trend.items.$ref,
    '#/components/schemas/AgentDashboardTrendPoint');
  assertClosedObject(schemas.AgentDashboardTrendPoint, 'AgentDashboardTrendPoint',
    ['business_date', 'net_sales_amount', 'paid_order_count', 'commission_change']);

  const adminCommissionData = schemas.AdminAgentCommissionHistoryResponse.properties.data;
  assertClosedObject(adminCommissionData, 'AdminAgentCommissionHistoryResponse.data',
    ['items', 'pagination']);
  assert.equal(adminCommissionData.properties.items.items.$ref,
    '#/components/schemas/AdminAgentCommissionHistoryItem');
  assert.equal(adminCommissionData.properties.pagination.$ref, '#/components/schemas/PaginationView');
  assertClosedObject(schemas.AdminAgentCommissionHistoryItem, 'AdminAgentCommissionHistoryItem', [
    'ledger_id', 'commission_snapshot_id', 'agent_id', 'order_id', 'order_no', 'order_item_id',
    'product_id', 'product_name', 'sku_id', 'sku_name', 'category_id', 'category_name',
    'rule_version_id', 'rule_version_no', 'rule_source', 'effective_rate', 'commission_base',
    'original_commission', 'expected_remaining', 'reversal_total', 'position_state', 'ledger_type',
    'expected_change', 'available_change', 'refund_id', 'occurred_at',
  ]);

  const adminWalletData = schemas.AdminAgentWalletLedgerResponse.properties.data;
  assertClosedObject(adminWalletData, 'AdminAgentWalletLedgerResponse.data', ['items', 'pagination']);
  assert.equal(adminWalletData.properties.items.items.$ref,
    '#/components/schemas/AdminAgentWalletLedgerItem');
  assert.equal(adminWalletData.properties.pagination.$ref, '#/components/schemas/PaginationView');
  assertClosedObject(schemas.AdminAgentWalletLedgerItem, 'AdminAgentWalletLedgerItem', [
    'wallet_ledger_id', 'agent_id', 'ledger_type', 'expected_change', 'available_change', 'frozen_change',
    'expected_balance_after', 'available_balance_after', 'frozen_balance_after', 'reference_type',
    'reference_id', 'refund_id', 'occurred_at',
  ]);
  assert.deepEqual(schemas.AdminAgentWalletLedgerItem.properties.reference_type.enum,
    ['COMMISSION_LEDGER', 'WITHDRAWAL', 'REFUND']);

  assertClosedObject(schemas.CommissionRuleSkuView, 'CommissionRuleSkuView', [
    'sku_id', 'sku_code', 'product_name', 'category_id', 'configured_rate', 'effective_rate', 'source',
  ]);
  assert.deepEqual(schemas.CommissionRuleSkuView.properties.configured_rate.oneOf, [
    { $ref: '#/components/schemas/RatePercentValue' },
    { type: 'null' },
  ]);
  assert.deepEqual(schemas.CommissionRuleSkuView.properties.source.enum, ['PLATFORM', 'CATEGORY', 'SKU']);
  assertClosedObject(schemas.CommissionRuleCategoryView, 'CommissionRuleCategoryView', [
    'category_id', 'category_name', 'configured_rate', 'effective_rate', 'source',
  ]);
  assert.deepEqual(schemas.CommissionRuleCategoryView.properties.configured_rate.oneOf, [
    { $ref: '#/components/schemas/RatePercentValue' },
    { type: 'null' },
  ]);
  assert.equal(schemas.CommissionRuleCategoryView.properties.effective_rate.$ref,
    '#/components/schemas/RatePercentValue');
  assert.deepEqual(schemas.CommissionRuleCategoryView.properties.source.enum, ['PLATFORM', 'CATEGORY']);
  const currentRulesData = schemas.CommissionRulesResponse.properties.data;
  assertClosedObject(currentRulesData, 'CommissionRulesResponse.data',
    ['version_id', 'version_no', 'platform_rate', 'categories', 'items', 'version']);
  assert.equal(currentRulesData.properties.categories.items.$ref,
    '#/components/schemas/CommissionRuleCategoryView');
  assert.equal(currentRulesData.properties.items.items.$ref,
    '#/components/schemas/CommissionRuleSkuView');
  const ruleSkuListData = schemas.CommissionRuleSkuListResponse.properties.data;
  assertClosedObject(ruleSkuListData, 'CommissionRuleSkuListResponse.data',
    ['version_id', 'version_no', 'items', 'pagination']);
  assert.equal(ruleSkuListData.properties.items.items.$ref,
    '#/components/schemas/CommissionRuleSkuView');
  assert.equal(ruleSkuListData.properties.pagination.$ref, '#/components/schemas/PaginationView');

  assertClosedObject(schemas.CommissionRuleChange, 'CommissionRuleChange',
    ['target_type', 'target_id', 'configured_rate']);
  assert.deepEqual(schemas.CommissionRuleChange.properties.target_type.enum,
    ['PLATFORM', 'CATEGORY', 'SKU']);
  assert.deepEqual(schemas.CommissionRuleChange.properties.configured_rate.oneOf, [
    { $ref: '#/components/schemas/RatePercentValue' },
    { type: 'null' },
  ]);
  assert.deepEqual(schemas.CommissionRuleAction.required, ['base_version_id', 'reason', 'changes']);
  assert.deepEqual(Object.keys(schemas.CommissionRuleAction.properties).sort(),
    ['base_version_id', 'changes', 'reason']);
  assert.deepEqual(schemas.CommissionRuleAction.properties.base_version_id.type, ['string', 'null']);
  assert.equal(schemas.CommissionRuleAction.properties.changes.items.$ref,
    '#/components/schemas/CommissionRuleChange');
  assert.equal(schemas.RatePercentValue.pattern, '^(?:100\\.0000|(?:0|[1-9][0-9]?)\\.[0-9]{4})$');
  assert.match('0.0000', new RegExp(schemas.RatePercentValue.pattern));

  const previewRuleOperation = document.paths['/admin/commission-rule-versions/preview'].post;
  const publishRuleOperation = document.paths['/admin/commission-rule-versions'].post;
  assert.equal(previewRuleOperation.requestBody.content['application/json'].schema.unevaluatedProperties, false);
  assert.deepEqual(previewRuleOperation.requestBody.content['application/json'].schema.allOf,
    [{ $ref: '#/components/schemas/CommissionRuleAction' }]);
  assert.equal(publishRuleOperation.requestBody.content['application/json'].schema.unevaluatedProperties, false);
  assert.deepEqual(publishRuleOperation.requestBody.content['application/json'].schema.allOf, [
    { $ref: '#/components/schemas/CommissionRuleAction' },
    { $ref: '#/components/schemas/HighRiskConfirmationFields' },
  ]);
  const publishIfMatch = publishRuleOperation.parameters.find(({ name }) => name === 'If-Match');
  assert.ok(publishIfMatch, 'commission rule publish must declare its bootstrap-aware If-Match header');
  assert.equal(publishIfMatch.$ref, undefined);
  assert.equal(publishIfMatch.required, true);
  assert.equal(publishIfMatch.schema.pattern, '^\\"(?:0|[1-9][0-9]*)\\"$');
  assert.equal(document.components.parameters.IfMatch.schema.pattern, '^\\"[1-9][0-9]*\\"$',
    'the shared If-Match parameter must continue to reject bootstrap version zero');
  const commissionPreviewData = schemas.CommissionRulePreviewResponse.properties.data;
  assertClosedObject(commissionPreviewData, 'CommissionRulePreviewResponse.data',
    ['preview_token', 'confirmation_hash', 'resource_etag', 'expires_at', 'impact']);
  assert.equal(commissionPreviewData.properties.resource_etag.pattern,
    '^\\"(?:0|[1-9][0-9]*)\\"$');
  assertClosedObject(commissionPreviewData.properties.impact,
    'CommissionRulePreviewResponse.data.impact', ['affected_count', 'metrics', 'warnings']);
  assert.equal(commissionPreviewData.properties.impact.properties.metrics.items.$ref,
    '#/components/schemas/ImpactMetric');

  assertClosedObject(schemas.CommissionRuleVersionView, 'CommissionRuleVersionView', [
    'version_id', 'version_no', 'base_version_id', 'status', 'reason', 'created_by_account_id',
    'effective_at', 'created_at',
  ], ['changes']);
  assert.deepEqual(schemas.CommissionRuleVersionView.properties.base_version_id.type, ['string', 'null']);
  assert.deepEqual(schemas.CommissionRuleVersionView.properties.status.enum,
    ['DRAFT', 'PUBLISHED', 'ARCHIVED']);
  assert.equal(schemas.CommissionRuleVersionView.properties.changes.items.$ref,
    '#/components/schemas/CommissionRuleChange');
  assert.equal(schemas.CommissionRuleVersionResponse.properties.data.$ref,
    '#/components/schemas/CommissionRuleVersionView');
  const versionListData = schemas.CommissionRuleVersionListResponse.properties.data;
  assertClosedObject(versionListData, 'CommissionRuleVersionListResponse.data', ['items', 'pagination']);
  assert.equal(versionListData.properties.items.items.$ref,
    '#/components/schemas/CommissionRuleVersionView');

  assertClosedObject(schemas.CommissionExplanationLedgerView, 'CommissionExplanationLedgerView', [
    'ledger_id', 'ledger_type', 'expected_change', 'available_change', 'frozen_change', 'refund_id',
    'reason', 'occurred_at',
  ]);
  assertClosedObject(schemas.CommissionExplanationItem, 'CommissionExplanationItem', [
    'commission_snapshot_id', 'order_item_id', 'product_id', 'product_name', 'sku_id', 'sku_name',
    'category_id', 'category_name', 'rule_version_id', 'rule_version_no', 'rule_source', 'hit_path',
    'effective_rate', 'commission_base', 'original_commission', 'expected_remaining', 'reversal_total',
    'rounding_mode', 'rounding_scale', 'position_state', 'ledger',
  ]);
  assert.deepEqual(schemas.CommissionExplanationItem.properties.rounding_mode, { const: 'HALF_UP' });
  assert.deepEqual(schemas.CommissionExplanationItem.properties.rounding_scale, { const: 2 });
  assert.equal(schemas.CommissionExplanationItem.properties.ledger.items.$ref,
    '#/components/schemas/CommissionExplanationLedgerView');
  const agentCommissionDetailData = schemas.AgentCommissionDetailResponse.properties.data;
  assertClosedObject(agentCommissionDetailData, 'AgentCommissionDetailResponse.data',
    ['order_id', 'order_no', 'item']);
  assert.equal(agentCommissionDetailData.properties.item.$ref,
    '#/components/schemas/CommissionExplanationItem');
  const orderCommissionData = schemas.OrderCommissionExplanationResponse.properties.data;
  assertClosedObject(orderCommissionData, 'OrderCommissionExplanationResponse.data',
    ['order_id', 'order_no', 'items']);
  assert.equal(orderCommissionData.properties.items.items.$ref,
    '#/components/schemas/CommissionExplanationItem');

  assert.deepEqual(responseSchema(document, 'post', '/agent/auth/login').oneOf, [
    { $ref: '#/components/schemas/AgentSessionResponse' },
    { $ref: '#/components/schemas/RestrictedAgentSessionResponse' },
  ]);
  assert.equal(responseSchema(document, 'post', '/agent/auth/refresh').$ref,
    '#/components/schemas/AgentSessionResponse');
  assert.equal(responseSchema(document, 'post', '/agent/auth/change-temporary-password').$ref,
    '#/components/schemas/AgentSessionResponse');
  const temporaryPasswordChange =
    document.paths['/agent/auth/change-temporary-password'].post;
  assert.match(
    temporaryPasswordChange.description,
    /先验证 current_password.*new_password.*current_password 不同.*400 INVALID_ARGUMENT.*must_change_password.*受限 session.*普通 session.*access token.*refresh token.*副作用/s,
    'temporary Agent password change must freeze same-password rejection and its no-side-effect guarantee',
  );
  assert.equal(responseSchema(document, 'get', '/agent/auth/current').$ref,
    '#/components/schemas/AgentCurrentResponse');

  for (const [method, path, operationId] of AGENT_AUTH_OPERATIONS) {
    const operation = document.paths[path][method];
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(Object.keys(operation.responses).sort(), AGENT_AUTH_RESPONSE_STATUSES,
      `${operationId} response status set drifted`);
    const success = operation.responses['200'];
    assert.equal(success.headers?.['Cache-Control']?.$ref,
      '#/components/headers/CacheControlNoStore', `${method.toUpperCase()} ${path} must be no-store`);
    assert.equal(success.headers?.Pragma?.$ref,
      '#/components/headers/PragmaNoCache', `${method.toUpperCase()} ${path} must be no-cache`);
    for (const [status, response] of Object.entries(operation.responses)) {
      if (status === '200') continue;
      assert.equal(response.$ref, status === '429'
        ? '#/components/responses/AgentAuthRateLimited'
        : '#/components/responses/AgentAuthSensitiveError',
      `${operationId} ${status} must use its Agent authentication sensitive response`);
    }
  }

  const agentHeaders = document.components.headers;
  assert.equal(agentHeaders.AgentCacheControlNoStoreRequired.required, true);
  assert.deepEqual(agentHeaders.AgentCacheControlNoStoreRequired.schema, { const: 'no-store, private' });
  assert.equal(agentHeaders.AgentPragmaNoCacheRequired.required, true);
  assert.deepEqual(agentHeaders.AgentPragmaNoCacheRequired.schema, { const: 'no-cache' });
  const agentSensitiveError = document.components.responses.AgentAuthSensitiveError;
  const agentRateLimited = document.components.responses.AgentAuthRateLimited;
  for (const [name, response] of [
    ['AgentAuthSensitiveError', agentSensitiveError],
    ['AgentAuthRateLimited', agentRateLimited],
  ]) {
    assert.equal(response.headers?.['Cache-Control']?.$ref,
      '#/components/headers/AgentCacheControlNoStoreRequired', `${name} must require no-store`);
    assert.equal(response.headers?.Pragma?.$ref,
      '#/components/headers/AgentPragmaNoCacheRequired', `${name} must require no-cache`);
    assert.equal(response.content?.['application/json']?.schema?.$ref,
      '#/components/schemas/ErrorResponse', `${name} must use the closed error envelope`);
  }
  assert.deepEqual(Object.keys(agentSensitiveError.headers).sort(), ['Cache-Control', 'Pragma']);
  assert.deepEqual(Object.keys(agentRateLimited.headers).sort(), ['Cache-Control', 'Pragma', 'Retry-After']);
  assert.equal(agentRateLimited.headers['Retry-After'].required, true);
  assert.deepEqual(agentRateLimited.headers['Retry-After'].schema, {
    maximum: 900,
    minimum: 1,
    type: 'integer',
  });
  for (const name of [
    'BadRequest',
    'Unauthorized',
    'Forbidden',
    'NotFound',
    'StateConflict',
    'BusinessError',
    'RateLimited',
    'InternalError',
  ]) {
    assert.equal(document.components.responses[name].headers, undefined,
      `${name} must remain a non-sensitive global response without Agent-specific headers`);
  }

  assert.deepEqual(schemas.AgentSessionData.properties.role, { const: 'AGENT_ADMIN' });
  assert.deepEqual(schemas.AgentSessionData.properties.assurance, { const: 'PASSWORD' });
  assert.deepEqual(schemas.AgentSessionData.properties.restriction, { const: 'NONE' });
  assert.ok(schemas.AgentSessionData.required.includes('refresh_token'));
  assert.deepEqual(schemas.RestrictedAgentSessionData.properties.role, { const: 'AGENT_ADMIN' });
  assert.deepEqual(schemas.RestrictedAgentSessionData.properties.assurance, { const: 'PASSWORD' });
  assert.deepEqual(schemas.RestrictedAgentSessionData.properties.restriction,
    { const: 'CHANGE_PASSWORD_ONLY' });
  assert.ok(!Object.hasOwn(schemas.RestrictedAgentSessionData.properties, 'refresh_token'),
    'temporary Agent session must not contain a refresh token');

  assert.equal(schemas.PasswordLoginRequest.properties.login_name.maxLength, 80);
  assert.equal(schemas.PasswordLoginRequest.properties.password.maxLength, 128);
  assert.equal(schemas.PasswordLoginRequest.properties.password.writeOnly, true);
  assert.equal(schemas.RefreshTokenRequest.properties.refresh_token.maxLength, 512);
  assert.equal(schemas.RefreshTokenRequest.properties.refresh_token.writeOnly, true);
  for (const field of ['current_password', 'new_password']) {
    assert.equal(schemas.ChangePasswordRequest.properties[field].maxLength, 128);
    assert.equal(schemas.ChangePasswordRequest.properties[field].writeOnly, true);
  }

  assert.deepEqual(Object.keys(schemas.AgentCurrentView.properties).sort(), [
    'agent_id',
    'agent_no',
    'name',
    'product_authorization_mode',
    'status',
  ]);
  assert.deepEqual(schemas.AgentCurrentView.required.slice().sort(), [
    'agent_id',
    'agent_no',
    'name',
    'product_authorization_mode',
    'status',
  ]);

  const productParameters = document.paths['/agent/products'].get.parameters;
  assert.ok(!productParameters.some((parameter) => parameter.name === 'status'),
    '/agent/products must not accept a caller-selected status');
  assert.match(document.paths['/agent/products'].get.summary, /固定只返回 ACTIVE 商品/);

  const promotionOperation = document.paths['/agent/promotion-assets'].post;
  assert.match(promotionOperation.description,
    /服务端生成 QR.+READY\/PRIVATE\/PROMOTION_QR.+原子绑定.+不返回签名下载 URL.+重新鉴权/s);
  const promotionData = schemas.PromotionAssetResponse.properties.data;
  assert.ok(promotionData.required.includes('qr_file'));
  assert.ok(!Object.hasOwn(promotionData.properties, 'qr_download_url'),
    'promotion creation must not disclose a signed QR download URL');
  const promotionQrFile = promotionData.properties.qr_file;
  assert.equal(promotionQrFile.additionalProperties, false);
  assert.deepEqual(promotionQrFile.required, ['file_id', 'status', 'visibility', 'purpose']);
  assert.equal(promotionQrFile.properties.file_id.pattern, '^[0-9A-HJKMNP-TV-Z]{26}$');
  assert.deepEqual(promotionQrFile.properties.status, { const: 'READY' });
  assert.deepEqual(promotionQrFile.properties.visibility, { const: 'PRIVATE' });
  assert.deepEqual(promotionQrFile.properties.purpose, { const: 'PROMOTION_QR' });

  const externalUploadPurposes = [
    'PRODUCT_IMAGE',
    'BRAND_LOGO',
    'CATEGORY_ICON',
    'BANNER',
    'AFTERSALE_EVIDENCE',
    'WITHDRAWAL_PROOF',
  ];
  assert.deepEqual(schemas.UploadIntentRequest.properties.purpose.enum, externalUploadPurposes);
  assert.deepEqual(schemas.FileUploadIntentResponse.properties.data.properties.purpose.enum,
    externalUploadPurposes);
  assert.deepEqual(schemas.FileUploadCompleteResponse.properties.data.properties.purpose.enum,
    externalUploadPurposes);
  const uploadIntentOperation = document.paths['/files/upload-intents'].post;
  const uploadCompleteOperation = document.paths['/files/{file_id}/complete'].post;
  assert.deepEqual(uploadIntentOperation.security, [{ bearerAuth: [] }]);
  assert.deepEqual(uploadCompleteOperation.security, [{ bearerAuth: [] }]);
  assert.match(uploadIntentOperation.description, /六类外部上传.+PROMOTION_QR.+服务端生成/s);
  assert.match(uploadCompleteOperation.description,
    /PROMOTION_QR.+服务端直接生成.+不使用本客户端 complete operation/s);

  const fileDownloadOperation = document.paths['/files/{file_id}/download-url'].get;
  assert.match(fileDownloadOperation.description,
    /AGENT_ADMIN.+agentBearerAuth.+READY\/PRIVATE\/PROMOTION_QR.+qr_file_id.+当前 Agent 本人 promotion_asset/s);
  assert.match(fileDownloadOperation.description, /Agent token 不得下载其他 purpose 或其他 Agent 的 QR/);

  assert.deepEqual(schemas.OneTimeDisclosureState.enum, ['FIRST_ISSUE', 'REPLAY_REDACTED']);
  assert.equal(schemas.AgentCreateRequest.properties.login_name.pattern,
    '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$');
  assert.equal(schemas.AgentCreateRequest.properties.contact_phone.pattern, '^[0-9]{11}$');
  assert.equal(schemas.AgentUpdateRequest.properties.contact_phone.pattern, '^[0-9]{11}$');
  const adminAgentKeyword = document.paths['/admin/agents'].get.parameters
    .find(({ name }) => name === 'keyword');
  assert.equal(adminAgentKeyword.schema.minLength, 1);
  assert.equal(adminAgentKeyword.schema.maxLength, 120);
  assert.match(document.paths['/admin/agents/{agent_id}/status-change-preview'].post.description,
    /时点估算.+不构成确认身份.+共享锁序.+支付先提交或停用先提交/s);
  assert.match(document.paths['/admin/agents/{agent_id}/password-reset-preview'].post.description,
    /时点估算.+不构成确认身份.+账户与会话锁.+全部有效 PASSWORD 会话/s);
  for (const [schemaName, secretProperties] of [
    ['AgentCreateResponse', ['temporary_password', 'initial_invite_code']],
    ['AgentPasswordResetResponse', ['temporary_password']],
    ['InviteCodeRotateResponse', ['new_invite_code']],
  ]) {
    const data = schemas[schemaName].properties.data;
    assert.equal(data.oneOf.length, 2, `${schemaName} must have first-issue and redacted-replay branches`);
    const [firstIssue, replayRedacted] = data.oneOf;
    if (schemaName === 'AgentCreateResponse' || schemaName === 'AgentPasswordResetResponse') {
      assert.match(firstIssue.properties.expires_at.description,
        /一次性披露页面.+10 分钟.+不宣称临时密码服务端按时失效/s);
    }
    for (const branch of [firstIssue, replayRedacted]) {
      assert.equal(branch.additionalProperties, false);
      assert.ok(branch.required.includes('disclosure_state'), `${schemaName} must expose disclosure_state`);
      assert.ok(branch.required.includes('reissue_required'), `${schemaName} must expose reissue guidance`);
      assert.equal(branch.properties.disclosure_state.allOf[0].$ref,
        '#/components/schemas/OneTimeDisclosureState');
    }
    assert.equal(firstIssue.properties.disclosure_state.allOf[1].const, 'FIRST_ISSUE');
    assert.equal(firstIssue.properties.reissue_required.const, false);
    assert.equal(replayRedacted.properties.disclosure_state.allOf[1].const, 'REPLAY_REDACTED');
    assert.equal(replayRedacted.properties.reissue_required.const, true);
    for (const property of secretProperties) {
      assert.notEqual(firstIssue.properties[property].type, 'null',
        `${schemaName}.${property} must be present on first issue`);
      assert.deepEqual(replayRedacted.properties[property], { type: 'null' },
        `${schemaName}.${property} must be null on replay`);
    }
  }

  assert.equal(schemas.BankAccountWriteRequest.properties.account_number.pattern,
    '^(?=(?:[ -]*[0-9]){6,32}$)[0-9][0-9 -]*[0-9]$');
  assert.match(schemas.BankAccountWriteRequest.properties.account_number.description,
    /去除 ASCII 空格和连字符.+6-32 位数字/);
  const bankAccountPattern = new RegExp(schemas.BankAccountWriteRequest.properties.account_number.pattern);
  for (const accepted of ['123456', '12 34-56', '1234-5678-9012-3456', '1'.repeat(32)]) {
    assert.match(accepted, bankAccountPattern, `valid normalized bank account was rejected: ${accepted}`);
  }
  for (const rejected of ['12345', '1----2', '1'.repeat(33), '-123456', '123456-', '12345A']) {
    assert.doesNotMatch(rejected, bankAccountPattern, `invalid normalized bank account was accepted: ${rejected}`);
  }
  assertClosedObject(schemas.BankAccountWriteRequest, 'BankAccountWriteRequest',
    ['account_holder', 'bank_name', 'account_number']);
  assert.equal(schemas.BankAccountWriteRequest.properties.account_holder.minLength, 2);
  assert.equal(schemas.BankAccountWriteRequest.properties.bank_name.minLength, 2);
  assert.equal(schemas.BankAccountWriteRequest.properties.account_number.writeOnly, true);
  assertClosedObject(schemas.BankAccountView, 'BankAccountView', [
    'bank_account_id', 'account_holder_masked', 'bank_name', 'account_number_masked',
    'account_no_last4', 'is_active', 'version',
  ]);
  assert.equal(schemas.BankAccountView.properties.account_no_last4.pattern, '^[0-9]{4}$');
  assert.equal(schemas.BankAccountResponse.properties.data.$ref, '#/components/schemas/BankAccountView');
  assert.equal(schemas.BankAccountListResponse.properties.data.items.$ref,
    '#/components/schemas/BankAccountView');

  assertClosedObject(schemas.CreateWithdrawalRequest, 'CreateWithdrawalRequest',
    ['amount', 'bank_account_id']);
  assert.equal(schemas.CreateWithdrawalRequest.properties.amount.$ref,
    '#/components/schemas/PositiveMoney');
  assertClosedObject(schemas.WithdrawalView, 'WithdrawalView', [
    'withdrawal_id', 'withdrawal_no', 'status', 'amount', 'bank_account_masked', 'review_reason',
    'created_at', 'version',
  ], ['reviewed_at', 'paid_at', 'proof_file_ids']);
  assert.deepEqual(schemas.WithdrawalView.properties.status.enum,
    ['PENDING', 'APPROVED', 'REJECTED', 'PAID']);
  assert.equal(schemas.WithdrawalView.properties.amount.$ref, '#/components/schemas/PositiveMoney');
  assert.equal(schemas.WithdrawalResponse.properties.data.$ref, '#/components/schemas/WithdrawalView');
  const withdrawalListData = schemas.WithdrawalListResponse.properties.data;
  assertClosedObject(withdrawalListData, 'WithdrawalListResponse.data', ['items', 'pagination']);
  assert.equal(withdrawalListData.properties.items.items.$ref, '#/components/schemas/WithdrawalView');
  assertClosedObject(withdrawalListData.properties.pagination,
    'WithdrawalListResponse.data.pagination', ['page', 'page_size', 'total']);

  for (const generatedType of [
    'AgentSessionResponse',
    'RestrictedAgentSessionResponse',
    'AgentCurrentResponse',
    'OneTimeDisclosureState',
    'AgentCustomerListResponse',
    'AgentCustomerDetailResponse',
    'AgentOrderListResponse',
    'AgentOrderResponse',
    'AdminCustomerListResponse',
    'AdminCustomerDetailResponse',
    'AdminCustomerResponse',
    'AgentDashboardResponse',
    'AgentCommissionLedgerItem',
    'CommissionListResponse',
    'AgentCommissionDetailResponse',
    'WalletResponse',
    'AdminAgentCommissionHistoryResponse',
    'AdminAgentWalletLedgerResponse',
    'CommissionRulesResponse',
    'CommissionRuleCategoryView',
    'CommissionRuleSkuListResponse',
    'CommissionRulePreviewResponse',
    'CommissionRuleVersionResponse',
    'CommissionRuleVersionListResponse',
    'OrderCommissionExplanationResponse',
    'BankAccountWriteRequest',
    'BankAccountView',
    'BankAccountResponse',
    'BankAccountListResponse',
    'CreateWithdrawalRequest',
    'WithdrawalView',
    'WithdrawalResponse',
    'WithdrawalListResponse',
  ]) {
    assert.match(generatedContract, new RegExp(`\\b${generatedType}\\b`),
      `generated contract is missing ${generatedType}`);
  }
  assert.doesNotMatch(generatedContract, /\bAgentLoginResponse\b/,
    'generated contract must not retain the generic Agent login response');
  assert.doesNotMatch(generatedContract, /\bqr_download_url\b/,
    'generated promotion contract must not contain a signed QR download URL');

  process.stdout.write(JSON.stringify({
    status: 'passed',
    change: 'CH-028',
    version: document.info.version,
    paths: Object.keys(document.paths).length,
    operations: operationManifest.length,
    operation_manifest_sha256: operationManifestSha256,
    agent_paths: agentPaths.length,
    agent_operations: agentOperations.length,
    schemas: Object.keys(schemas).length,
    disclosure_replay_redacted: true,
    b13_gate_wiring: true,
    b133_operations: B133_OPERATIONS.length,
    b134_operations: B134_OPERATIONS.length,
    b135_operations: B135_OPERATIONS.length,
    dangling_references: 0,
  }) + '\n');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
