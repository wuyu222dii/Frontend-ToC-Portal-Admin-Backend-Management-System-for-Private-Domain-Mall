import type {
  AdminAgent,
  AdminAgentCommissionResult,
  AdminAgentDetail,
  AdminAgentListResult,
  AdminAgentWalletLedgerResult,
  AdminCommandResult,
  AdminCustomer,
  AdminCustomerDetail,
  AdminCustomerListResult,
  AdminWithdrawal,
  AdminWithdrawalListResult,
  AgentCreateResult,
  AgentPasswordResetResult,
  AuditLogListResult,
  BusinessRules,
  CommissionRules,
  CommissionRuleSkuResult,
  CommissionRuleVersion,
  CommissionRuleVersionResult,
  HighRiskPreview,
  InviteRotationResult,
  OrderCommissionExplanation,
  PayoutAccountReveal,
  PayoutReauth,
  ProductAuthorization,
} from '../types/admin-b13';

type ObjectValue = Record<string, unknown>;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const NON_NEGATIVE_MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const SIGNED_MONEY = /^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const RATE = /^(?:100\.0000|(?:0|[1-9][0-9]?)\.[0-9]{4})$/;
const HASH = /^[a-f0-9]{64}$/;
const ETAG = /^"[1-9][0-9]*"$/;
const ETAG_WITH_ZERO = /^"(?:0|[1-9][0-9]*)"$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

function invalid(path: string): never {
  throw new TypeError(`Invalid B13 admin response at ${path}`);
}

function object(
  value: unknown,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path);
  const result = value as ObjectValue;
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !allowed.has(key))) return invalid(path);
  return result;
}

function text(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return invalid(path);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return invalid(path);
  return value;
}

function integer(value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return invalid(path);
  return Number(value);
}

function nullableInteger(value: unknown, path: string, minimum = 0): number | null {
  return value === null ? null : integer(value, path, minimum);
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) return invalid(path);
  return value as Values[number];
}

function nullableEnumeration<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] | null {
  return value === null ? null : enumeration(value, values, path);
}

function match(value: unknown, pattern: RegExp, path: string): string {
  const result = text(value, path);
  return pattern.test(result) ? result : invalid(path);
}

function ulid(value: unknown, path: string): string {
  return match(value, ULID, path);
}

function dateTime(value: unknown, path: string): string {
  const result = text(value, path);
  const parts = RFC3339.exec(result);
  if (parts === null) return invalid(path);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0) ||
    Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59 ||
    Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59 ||
    !Number.isFinite(Date.parse(result))) return invalid(path);
  return result;
}

function nullableDateTime(value: unknown, path: string): string | null {
  return value === null ? null : dateTime(value, path);
}

function list<T>(value: unknown, path: string, read: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(path);
  return value.map((item, index) => read(item, `${path}[${index}]`));
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path);
}

function envelope(value: unknown): unknown {
  const response = object(value, ['code', 'message', 'data', 'request_id'], 'response');
  if (response.code !== 'OK' || response.message !== 'success') invalid('response');
  text(response.request_id, 'response.request_id');
  return response.data;
}

function pagination(value: unknown, path: string): void {
  const result = object(value, ['page', 'page_size', 'total'], path);
  integer(result.page, `${path}.page`, 1);
  integer(result.page_size, `${path}.page_size`, 1, 100);
  integer(result.total, `${path}.total`);
}

function expectedId(actual: unknown, expected: string | undefined, path: string): void {
  const value = ulid(actual, path);
  if (expected !== undefined && value !== expected) invalid(path);
}

function binding(value: unknown, path: string): void {
  const result = object(value, ['binding_id', 'customer_id', 'agent_id', 'agent_name', 'started_at', 'customer_version'], path);
  ulid(result.binding_id, `${path}.binding_id`);
  ulid(result.customer_id, `${path}.customer_id`);
  ulid(result.agent_id, `${path}.agent_id`);
  text(result.agent_name, `${path}.agent_name`);
  dateTime(result.started_at, `${path}.started_at`);
  integer(result.customer_version, `${path}.customer_version`, 1);
}

function customer(value: unknown, path: string, expectedCustomerId?: string): void {
  const result = object(value, [
    'customer_id', 'customer_alias', 'account_status', 'nickname_masked', 'phone_masked',
    'consumption_amount', 'consumption_count', 'registered_at', 'last_product_name',
    'last_purchase_at', 'last_order_id', 'management_note_present', 'binding',
    'deletion_request_status', 'version',
  ], path, ['city']);
  expectedId(result.customer_id, expectedCustomerId, `${path}.customer_id`);
  text(result.customer_alias, `${path}.customer_alias`);
  enumeration(result.account_status, ['ACTIVE', 'DISABLED', 'DELETION_PENDING', 'ANONYMIZED'] as const, `${path}.account_status`);
  nullableText(result.nickname_masked, `${path}.nickname_masked`);
  nullableText(result.phone_masked, `${path}.phone_masked`);
  if (Object.hasOwn(result, 'city')) nullableText(result.city, `${path}.city`);
  match(result.consumption_amount, NON_NEGATIVE_MONEY, `${path}.consumption_amount`);
  integer(result.consumption_count, `${path}.consumption_count`);
  dateTime(result.registered_at, `${path}.registered_at`);
  nullableText(result.last_product_name, `${path}.last_product_name`);
  nullableDateTime(result.last_purchase_at, `${path}.last_purchase_at`);
  if (result.last_order_id !== null) ulid(result.last_order_id, `${path}.last_order_id`);
  boolean(result.management_note_present, `${path}.management_note_present`);
  if (result.binding !== null) binding(result.binding, `${path}.binding`);
  nullableEnumeration(
    result.deletion_request_status,
    ['SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED'] as const,
    `${path}.deletion_request_status`,
  );
  integer(result.version, `${path}.version`, 1);
}

function customerOrder(value: unknown, path: string): void {
  const result = object(value, ['order_id', 'order_no', 'display_status', 'payable_amount', 'paid_at'], path);
  ulid(result.order_id, `${path}.order_id`);
  text(result.order_no, `${path}.order_no`);
  text(result.display_status, `${path}.display_status`);
  match(result.payable_amount, NON_NEGATIVE_MONEY, `${path}.payable_amount`);
  nullableDateTime(result.paid_at, `${path}.paid_at`);
}

function bindingHistory(value: unknown, path: string): void {
  const result = object(value, [
    'binding_id', 'agent_id', 'agent_name', 'started_at', 'ended_at', 'end_reason', 'recorded_at',
  ], path, ['change_reason']);
  ulid(result.binding_id, `${path}.binding_id`);
  if (result.agent_id !== null) ulid(result.agent_id, `${path}.agent_id`);
  nullableText(result.agent_name, `${path}.agent_name`);
  dateTime(result.started_at, `${path}.started_at`);
  nullableDateTime(result.ended_at, `${path}.ended_at`);
  nullableEnumeration(result.end_reason, ['TRANSFERRED', 'DIRECTED', 'ACCOUNT_DELETED'] as const, `${path}.end_reason`);
  if (Object.hasOwn(result, 'change_reason')) nullableText(result.change_reason, `${path}.change_reason`);
  dateTime(result.recorded_at, `${path}.recorded_at`);
}

export function decodeAdminHighRiskPreviewResponse(value: unknown, allowZeroEtag = false): HighRiskPreview {
  const data = object(envelope(value), ['preview_token', 'confirmation_hash', 'resource_etag', 'expires_at', 'impact'], 'response.data');
  text(data.preview_token, 'response.data.preview_token');
  match(data.confirmation_hash, HASH, 'response.data.confirmation_hash');
  match(data.resource_etag, allowZeroEtag ? ETAG_WITH_ZERO : ETAG, 'response.data.resource_etag');
  dateTime(data.expires_at, 'response.data.expires_at');
  const impact = object(data.impact, ['affected_count', 'metrics', 'warnings'], 'response.data.impact');
  integer(impact.affected_count, 'response.data.impact.affected_count');
  list(impact.metrics, 'response.data.impact.metrics', (item, path) => {
    const metric = object(item, ['key', 'label', 'before', 'after'], path);
    text(metric.key, `${path}.key`);
    text(metric.label, `${path}.label`);
    nullableText(metric.before, `${path}.before`);
    nullableText(metric.after, `${path}.after`);
  });
  list(impact.warnings, 'response.data.impact.warnings', text);
  return data as HighRiskPreview;
}

export function decodeAdminCustomerListResponse(value: unknown): AdminCustomerListResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  list(data.items, 'response.data.items', customer);
  pagination(data.pagination, 'response.data.pagination');
  return data as AdminCustomerListResult;
}

export function decodeAdminCustomerDetailResponse(value: unknown, customerId?: string): AdminCustomerDetail {
  const data = object(envelope(value), ['customer', 'orders', 'binding_history'], 'response.data');
  customer(data.customer, 'response.data.customer', customerId);
  list(data.orders, 'response.data.orders', customerOrder);
  list(data.binding_history, 'response.data.binding_history', bindingHistory);
  return data as AdminCustomerDetail;
}

export function decodeAdminCustomerResponse(value: unknown, customerId?: string): AdminCustomer {
  const data = envelope(value);
  customer(data, 'response.data', customerId);
  return data as AdminCustomer;
}

function agent(value: unknown, path: string, agentId?: string): void {
  const result = object(value, [
    'agent_id', 'agent_no', 'name', 'contact_name', 'contact_phone_tail', 'status',
    'product_authorization_mode', 'version',
  ], path);
  expectedId(result.agent_id, agentId, `${path}.agent_id`);
  text(result.agent_no, `${path}.agent_no`);
  text(result.name, `${path}.name`);
  nullableText(result.contact_name, `${path}.contact_name`);
  nullableText(result.contact_phone_tail, `${path}.contact_phone_tail`);
  enumeration(result.status, ['ACTIVE', 'DISABLED'] as const, `${path}.status`);
  enumeration(
    result.product_authorization_mode,
    ['ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST'] as const,
    `${path}.product_authorization_mode`,
  );
  integer(result.version, `${path}.version`, 1);
}

function agentListItem(value: unknown, path: string): void {
  const result = object(value, [
    'agent_id', 'agent_no', 'name', 'status', 'product_authorization_mode', 'account_id',
    'account_alias', 'login_name', 'active_customer_count', 'net_sales_amount',
    'available_balance', 'created_at', 'version',
  ], path);
  ulid(result.agent_id, `${path}.agent_id`);
  text(result.agent_no, `${path}.agent_no`);
  text(result.name, `${path}.name`);
  enumeration(result.status, ['ACTIVE', 'DISABLED'] as const, `${path}.status`);
  enumeration(
    result.product_authorization_mode,
    ['ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST'] as const,
    `${path}.product_authorization_mode`,
  );
  ulid(result.account_id, `${path}.account_id`);
  text(result.account_alias, `${path}.account_alias`);
  text(result.login_name, `${path}.login_name`);
  integer(result.active_customer_count, `${path}.active_customer_count`);
  match(result.net_sales_amount, SIGNED_MONEY, `${path}.net_sales_amount`);
  match(result.available_balance, SIGNED_MONEY, `${path}.available_balance`);
  dateTime(result.created_at, `${path}.created_at`);
  integer(result.version, `${path}.version`, 1);
}

function issuedInvite(value: unknown, path: string): void {
  const result = object(value, ['invite_code_id', 'code', 'status', 'expires_at', 'version'], path);
  ulid(result.invite_code_id, `${path}.invite_code_id`);
  text(result.code, `${path}.code`);
  if (result.status !== 'ACTIVE') invalid(`${path}.status`);
  nullableDateTime(result.expires_at, `${path}.expires_at`);
  integer(result.version, `${path}.version`, 1);
}

function maskedInvite(value: unknown, path: string): void {
  const result = object(value, ['invite_code_id', 'code_masked', 'status', 'expires_at', 'version'], path);
  ulid(result.invite_code_id, `${path}.invite_code_id`);
  text(result.code_masked, `${path}.code_masked`);
  enumeration(result.status, ['ACTIVE', 'DISABLED', 'ROTATED', 'EXPIRED'] as const, `${path}.status`);
  nullableDateTime(result.expires_at, `${path}.expires_at`);
  integer(result.version, `${path}.version`, 1);
}

function disclosure(
  result: ObjectValue,
  path: string,
  inviteField: 'initial_invite_code' | null,
): void {
  if (result.must_change_password !== true) invalid(`${path}.must_change_password`);
  const state = enumeration(result.disclosure_state, ['FIRST_ISSUE', 'REPLAY_REDACTED'] as const, `${path}.disclosure_state`);
  if (state === 'FIRST_ISSUE') {
    text(result.temporary_password, `${path}.temporary_password`);
    dateTime(result.expires_at, `${path}.expires_at`);
    if (result.reissue_required !== false) invalid(`${path}.reissue_required`);
    if (inviteField !== null) issuedInvite(result[inviteField], `${path}.${inviteField}`);
    return;
  }
  if (result.temporary_password !== null) invalid(`${path}.temporary_password`);
  nullableDateTime(result.expires_at, `${path}.expires_at`);
  if (result.reissue_required !== true) invalid(`${path}.reissue_required`);
  if (inviteField !== null && result[inviteField] !== null) invalid(`${path}.${inviteField}`);
}

function agentCommission(value: unknown, path: string, agentId?: string): void {
  const result = object(value, [
    'ledger_id', 'commission_snapshot_id', 'agent_id', 'order_id', 'order_no', 'order_item_id',
    'product_id', 'product_name', 'sku_id', 'sku_name', 'category_id', 'category_name',
    'rule_version_id', 'rule_version_no', 'rule_source', 'effective_rate', 'commission_base',
    'original_commission', 'expected_remaining', 'reversal_total', 'position_state', 'ledger_type',
    'expected_change', 'available_change', 'refund_id', 'occurred_at',
  ], path);
  for (const field of ['ledger_id', 'commission_snapshot_id', 'order_id', 'order_item_id', 'product_id', 'sku_id', 'category_id', 'rule_version_id'] as const) {
    ulid(result[field], `${path}.${field}`);
  }
  expectedId(result.agent_id, agentId, `${path}.agent_id`);
  for (const field of ['order_no', 'product_name', 'sku_name', 'category_name'] as const) text(result[field], `${path}.${field}`);
  integer(result.rule_version_no, `${path}.rule_version_no`, 1);
  enumeration(result.rule_source, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${path}.rule_source`);
  match(result.effective_rate, RATE, `${path}.effective_rate`);
  for (const field of ['commission_base', 'original_commission', 'expected_remaining', 'reversal_total'] as const) {
    match(result[field], NON_NEGATIVE_MONEY, `${path}.${field}`);
  }
  enumeration(result.position_state, ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE'] as const, `${path}.position_state`);
  enumeration(
    result.ledger_type,
    ['EXPECTED_CREATED', 'EXPECTED_REDUCED', 'EXPECTED_CANCELLED', 'AVAILABLE_CREDIT', 'REFUND_DEBIT'] as const,
    `${path}.ledger_type`,
  );
  match(result.expected_change, SIGNED_MONEY, `${path}.expected_change`);
  match(result.available_change, SIGNED_MONEY, `${path}.available_change`);
  if (result.refund_id !== null) ulid(result.refund_id, `${path}.refund_id`);
  dateTime(result.occurred_at, `${path}.occurred_at`);
}

function walletLedger(value: unknown, path: string, agentId?: string): void {
  const result = object(value, [
    'wallet_ledger_id', 'agent_id', 'ledger_type', 'expected_change', 'available_change',
    'frozen_change', 'expected_balance_after', 'available_balance_after', 'frozen_balance_after',
    'reference_type', 'reference_id', 'refund_id', 'occurred_at',
  ], path);
  ulid(result.wallet_ledger_id, `${path}.wallet_ledger_id`);
  expectedId(result.agent_id, agentId, `${path}.agent_id`);
  enumeration(
    result.ledger_type,
    [
      'EXPECTED_CREATED', 'EXPECTED_REDUCED', 'EXPECTED_CANCELLED', 'AVAILABLE_CREDIT',
      'REFUND_DEBIT', 'WITHDRAWAL_FREEZE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_PAID',
    ] as const,
    `${path}.ledger_type`,
  );
  for (const field of ['expected_change', 'available_change', 'frozen_change', 'available_balance_after'] as const) {
    match(result[field], SIGNED_MONEY, `${path}.${field}`);
  }
  match(result.expected_balance_after, NON_NEGATIVE_MONEY, `${path}.expected_balance_after`);
  match(result.frozen_balance_after, NON_NEGATIVE_MONEY, `${path}.frozen_balance_after`);
  enumeration(result.reference_type, ['COMMISSION_LEDGER', 'WITHDRAWAL', 'REFUND'] as const, `${path}.reference_type`);
  ulid(result.reference_id, `${path}.reference_id`);
  if (result.refund_id !== null) ulid(result.refund_id, `${path}.refund_id`);
  dateTime(result.occurred_at, `${path}.occurred_at`);
}

export function decodeAdminAgentListResponse(value: unknown): AdminAgentListResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  list(data.items, 'response.data.items', agentListItem);
  pagination(data.pagination, 'response.data.pagination');
  return data as AdminAgentListResult;
}

export function decodeAdminAgentDetailResponse(value: unknown, agentId?: string): AdminAgentDetail {
  const data = object(
    envelope(value),
    ['agent', 'invite_code', 'operating_summary', 'wallet_summary', 'withdrawal_summary'],
    'response.data',
  );
  agent(data.agent, 'response.data.agent', agentId);
  if (data.invite_code !== null) maskedInvite(data.invite_code, 'response.data.invite_code');
  const operating = object(
    data.operating_summary,
    ['net_sales_amount', 'paid_order_count', 'active_customer_count', 'new_binding_count'],
    'response.data.operating_summary',
  );
  match(operating.net_sales_amount, SIGNED_MONEY, 'response.data.operating_summary.net_sales_amount');
  for (const field of ['paid_order_count', 'active_customer_count', 'new_binding_count'] as const) {
    integer(operating[field], `response.data.operating_summary.${field}`);
  }
  const wallet = object(
    data.wallet_summary,
    ['expected_commission', 'available_balance', 'frozen_balance', 'negative_balance', 'version'],
    'response.data.wallet_summary',
  );
  match(wallet.expected_commission, NON_NEGATIVE_MONEY, 'response.data.wallet_summary.expected_commission');
  match(wallet.available_balance, SIGNED_MONEY, 'response.data.wallet_summary.available_balance');
  match(wallet.frozen_balance, NON_NEGATIVE_MONEY, 'response.data.wallet_summary.frozen_balance');
  match(wallet.negative_balance, NON_NEGATIVE_MONEY, 'response.data.wallet_summary.negative_balance');
  integer(wallet.version, 'response.data.wallet_summary.version', 1);
  const withdrawal = object(
    data.withdrawal_summary,
    ['pending_count', 'approved_count', 'paid_count', 'total_paid_amount', 'latest_withdrawal_at'],
    'response.data.withdrawal_summary',
  );
  for (const field of ['pending_count', 'approved_count', 'paid_count'] as const) {
    integer(withdrawal[field], `response.data.withdrawal_summary.${field}`);
  }
  match(withdrawal.total_paid_amount, NON_NEGATIVE_MONEY, 'response.data.withdrawal_summary.total_paid_amount');
  nullableDateTime(withdrawal.latest_withdrawal_at, 'response.data.withdrawal_summary.latest_withdrawal_at');
  return data as AdminAgentDetail;
}

export function decodeAdminAgentResponse(value: unknown, agentId?: string): AdminAgent {
  const data = envelope(value);
  agent(data, 'response.data', agentId);
  return data as AdminAgent;
}

export function decodeAdminAgentCreateResponse(value: unknown): AgentCreateResult {
  const data = object(
    envelope(value),
    ['agent', 'temporary_password', 'expires_at', 'must_change_password', 'initial_invite_code', 'disclosure_state', 'reissue_required'],
    'response.data',
  );
  agent(data.agent, 'response.data.agent');
  disclosure(data, 'response.data', 'initial_invite_code');
  return data as AgentCreateResult;
}

export function decodeAdminAgentPasswordResetResponse(value: unknown, agentId?: string): AgentPasswordResetResult {
  const data = object(
    envelope(value),
    ['agent', 'temporary_password', 'expires_at', 'must_change_password', 'disclosure_state', 'reissue_required'],
    'response.data',
  );
  agent(data.agent, 'response.data.agent', agentId);
  disclosure(data, 'response.data', null);
  return data as AgentPasswordResetResult;
}

export function decodeAdminProductAuthorizationResponse(value: unknown, agentId?: string): ProductAuthorization {
  const data = object(envelope(value), ['agent_id', 'mode', 'product_ids', 'version'], 'response.data');
  expectedId(data.agent_id, agentId, 'response.data.agent_id');
  enumeration(data.mode, ['ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST'] as const, 'response.data.mode');
  const productIds = list(data.product_ids, 'response.data.product_ids', ulid);
  unique(productIds, 'response.data.product_ids');
  if (data.mode === 'ALL_ACTIVE_PRODUCTS' && productIds.length !== 0) invalid('response.data.product_ids');
  integer(data.version, 'response.data.version', 1);
  return data as ProductAuthorization;
}

export function decodeAdminInviteRotationResponse(value: unknown, agentId?: string): InviteRotationResult {
  const data = object(
    envelope(value),
    ['agent_id', 'new_invite_code', 'old_code_invalidated', 'disclosure_state', 'reissue_required'],
    'response.data',
  );
  expectedId(data.agent_id, agentId, 'response.data.agent_id');
  const old = object(
    data.old_code_invalidated,
    ['invite_code_id', 'code_masked', 'invalidated_at', 'existing_bindings_unchanged'],
    'response.data.old_code_invalidated',
  );
  ulid(old.invite_code_id, 'response.data.old_code_invalidated.invite_code_id');
  text(old.code_masked, 'response.data.old_code_invalidated.code_masked');
  dateTime(old.invalidated_at, 'response.data.old_code_invalidated.invalidated_at');
  if (old.existing_bindings_unchanged !== true) invalid('response.data.old_code_invalidated.existing_bindings_unchanged');
  const state = enumeration(data.disclosure_state, ['FIRST_ISSUE', 'REPLAY_REDACTED'] as const, 'response.data.disclosure_state');
  if (state === 'FIRST_ISSUE') {
    issuedInvite(data.new_invite_code, 'response.data.new_invite_code');
    if (data.reissue_required !== false) invalid('response.data.reissue_required');
  } else if (data.new_invite_code !== null || data.reissue_required !== true) {
    invalid('response.data');
  }
  return data as InviteRotationResult;
}

export function decodeAdminAgentCommissionResponse(value: unknown, agentId?: string): AdminAgentCommissionResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  list(data.items, 'response.data.items', (item, path) => agentCommission(item, path, agentId));
  pagination(data.pagination, 'response.data.pagination');
  return data as AdminAgentCommissionResult;
}

export function decodeAdminAgentWalletLedgerResponse(value: unknown, agentId?: string): AdminAgentWalletLedgerResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  list(data.items, 'response.data.items', (item, path) => walletLedger(item, path, agentId));
  pagination(data.pagination, 'response.data.pagination');
  return data as AdminAgentWalletLedgerResult;
}

export function decodeAdminCommandResponse(value: unknown, resourceId?: string): AdminCommandResult {
  const data = object(envelope(value), ['resource_type', 'resource_id', 'status', 'version', 'occurred_at'], 'response.data');
  text(data.resource_type, 'response.data.resource_type');
  expectedId(data.resource_id, resourceId, 'response.data.resource_id');
  text(data.status, 'response.data.status');
  integer(data.version, 'response.data.version', 1);
  dateTime(data.occurred_at, 'response.data.occurred_at');
  return data as AdminCommandResult;
}

function commissionSku(value: unknown, path: string): string {
  const result = object(
    value,
    ['sku_id', 'sku_code', 'product_name', 'category_id', 'configured_rate', 'effective_rate', 'source'],
    path,
  );
  const skuId = ulid(result.sku_id, `${path}.sku_id`);
  text(result.sku_code, `${path}.sku_code`);
  text(result.product_name, `${path}.product_name`);
  ulid(result.category_id, `${path}.category_id`);
  if (result.configured_rate !== null) match(result.configured_rate, RATE, `${path}.configured_rate`);
  match(result.effective_rate, RATE, `${path}.effective_rate`);
  enumeration(result.source, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${path}.source`);
  return skuId;
}

function commissionCategory(value: unknown, path: string): string {
  const result = object(
    value,
    ['category_id', 'category_name', 'configured_rate', 'effective_rate', 'source'],
    path,
  );
  const categoryId = ulid(result.category_id, `${path}.category_id`);
  text(result.category_name, `${path}.category_name`);
  if (result.configured_rate !== null) match(result.configured_rate, RATE, `${path}.configured_rate`);
  match(result.effective_rate, RATE, `${path}.effective_rate`);
  enumeration(result.source, ['PLATFORM', 'CATEGORY'] as const, `${path}.source`);
  return categoryId;
}

function commissionChange(value: unknown, path: string): void {
  const result = object(value, ['target_type', 'target_id', 'configured_rate'], path);
  const targetType = enumeration(result.target_type, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${path}.target_type`);
  if (targetType === 'PLATFORM') {
    if (result.target_id !== null) invalid(`${path}.target_id`);
  } else {
    ulid(result.target_id, `${path}.target_id`);
  }
  if (result.configured_rate !== null) match(result.configured_rate, RATE, `${path}.configured_rate`);
}

function commissionVersion(value: unknown, path: string, versionId?: string): void {
  const result = object(value, [
    'version_id', 'version_no', 'base_version_id', 'status', 'reason', 'created_by_account_id',
    'effective_at', 'created_at',
  ], path, ['changes']);
  expectedId(result.version_id, versionId, `${path}.version_id`);
  integer(result.version_no, `${path}.version_no`, 1);
  if (result.base_version_id !== null) ulid(result.base_version_id, `${path}.base_version_id`);
  enumeration(result.status, ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const, `${path}.status`);
  text(result.reason, `${path}.reason`);
  ulid(result.created_by_account_id, `${path}.created_by_account_id`);
  nullableDateTime(result.effective_at, `${path}.effective_at`);
  dateTime(result.created_at, `${path}.created_at`);
  if (Object.hasOwn(result, 'changes')) list(result.changes, `${path}.changes`, commissionChange);
}

function explanationLedger(value: unknown, path: string): void {
  const result = object(value, [
    'ledger_id', 'ledger_type', 'expected_change', 'available_change', 'frozen_change',
    'refund_id', 'reason', 'occurred_at',
  ], path);
  ulid(result.ledger_id, `${path}.ledger_id`);
  enumeration(
    result.ledger_type,
    ['EXPECTED_CREATED', 'EXPECTED_REDUCED', 'EXPECTED_CANCELLED', 'AVAILABLE_CREDIT', 'REFUND_DEBIT'] as const,
    `${path}.ledger_type`,
  );
  for (const field of ['expected_change', 'available_change', 'frozen_change'] as const) {
    match(result[field], SIGNED_MONEY, `${path}.${field}`);
  }
  if (result.refund_id !== null) ulid(result.refund_id, `${path}.refund_id`);
  text(result.reason, `${path}.reason`);
  dateTime(result.occurred_at, `${path}.occurred_at`);
}

function explanationItem(value: unknown, path: string): string {
  const result = object(value, [
    'commission_snapshot_id', 'order_item_id', 'product_id', 'product_name', 'sku_id', 'sku_name',
    'category_id', 'category_name', 'rule_version_id', 'rule_version_no', 'rule_source', 'hit_path',
    'effective_rate', 'commission_base', 'original_commission', 'expected_remaining', 'reversal_total',
    'rounding_mode', 'rounding_scale', 'position_state', 'ledger',
  ], path);
  const snapshotId = ulid(result.commission_snapshot_id, `${path}.commission_snapshot_id`);
  for (const field of ['order_item_id', 'product_id', 'sku_id', 'category_id', 'rule_version_id'] as const) {
    ulid(result[field], `${path}.${field}`);
  }
  for (const field of ['product_name', 'sku_name', 'category_name'] as const) text(result[field], `${path}.${field}`);
  integer(result.rule_version_no, `${path}.rule_version_no`, 1);
  enumeration(result.rule_source, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${path}.rule_source`);
  if (list(result.hit_path, `${path}.hit_path`, text).length === 0) invalid(`${path}.hit_path`);
  match(result.effective_rate, RATE, `${path}.effective_rate`);
  for (const field of ['commission_base', 'original_commission', 'expected_remaining', 'reversal_total'] as const) {
    match(result[field], NON_NEGATIVE_MONEY, `${path}.${field}`);
  }
  if (result.rounding_mode !== 'HALF_UP') invalid(`${path}.rounding_mode`);
  if (result.rounding_scale !== 2) invalid(`${path}.rounding_scale`);
  enumeration(result.position_state, ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE'] as const, `${path}.position_state`);
  list(result.ledger, `${path}.ledger`, explanationLedger);
  return snapshotId;
}

export function decodeAdminCommissionRulesResponse(value: unknown): CommissionRules {
  const data = object(
    envelope(value),
    ['version_id', 'version_no', 'platform_rate', 'categories', 'items', 'version'],
    'response.data',
  );
  ulid(data.version_id, 'response.data.version_id');
  integer(data.version_no, 'response.data.version_no', 1);
  match(data.platform_rate, RATE, 'response.data.platform_rate');
  const categoryIds = list(data.categories, 'response.data.categories', commissionCategory);
  const skuIds = list(data.items, 'response.data.items', commissionSku);
  unique(categoryIds, 'response.data.categories');
  unique(skuIds, 'response.data.items');
  integer(data.version, 'response.data.version', 1);
  return data as CommissionRules;
}

export function decodeAdminCommissionRuleSkuListResponse(value: unknown): CommissionRuleSkuResult {
  const data = object(envelope(value), ['version_id', 'version_no', 'items', 'pagination'], 'response.data');
  ulid(data.version_id, 'response.data.version_id');
  integer(data.version_no, 'response.data.version_no', 1);
  unique(list(data.items, 'response.data.items', commissionSku), 'response.data.items');
  pagination(data.pagination, 'response.data.pagination');
  return data as CommissionRuleSkuResult;
}

export function decodeAdminCommissionRuleVersionResponse(value: unknown, versionId?: string): CommissionRuleVersion {
  const data = envelope(value);
  commissionVersion(data, 'response.data', versionId);
  return data as CommissionRuleVersion;
}

export function decodeAdminCommissionRuleVersionListResponse(value: unknown): CommissionRuleVersionResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  const ids = list(data.items, 'response.data.items', (item, path) => {
    commissionVersion(item, path);
    return (item as ObjectValue).version_id as string;
  });
  unique(ids, 'response.data.items');
  pagination(data.pagination, 'response.data.pagination');
  return data as CommissionRuleVersionResult;
}

export function decodeAdminOrderCommissionExplanationResponse(
  value: unknown,
  orderId?: string,
): OrderCommissionExplanation {
  const data = object(envelope(value), ['order_id', 'order_no', 'items'], 'response.data');
  expectedId(data.order_id, orderId, 'response.data.order_id');
  text(data.order_no, 'response.data.order_no');
  unique(list(data.items, 'response.data.items', explanationItem), 'response.data.items');
  return data as OrderCommissionExplanation;
}

function withdrawal(value: unknown, path: string, withdrawalId?: string): void {
  const result = object(value, [
    'withdrawal_id', 'withdrawal_no', 'agent_id', 'agent_no', 'agent_name', 'status', 'amount',
    'request_balance_snapshot', 'payout_account_snapshot', 'review_reason', 'created_at',
    'reviewed_at', 'paid_at', 'proof_file_ids', 'version',
  ], path);
  expectedId(result.withdrawal_id, withdrawalId, `${path}.withdrawal_id`);
  text(result.withdrawal_no, `${path}.withdrawal_no`);
  ulid(result.agent_id, `${path}.agent_id`);
  text(result.agent_no, `${path}.agent_no`);
  text(result.agent_name, `${path}.agent_name`);
  const status = enumeration(result.status, ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const, `${path}.status`);
  match(result.amount, POSITIVE_MONEY, `${path}.amount`);
  const balance = object(
    result.request_balance_snapshot,
    ['available_before', 'available_after', 'frozen_before', 'frozen_after', 'captured_at'],
    `${path}.request_balance_snapshot`,
  );
  match(balance.available_before, SIGNED_MONEY, `${path}.request_balance_snapshot.available_before`);
  match(balance.available_after, SIGNED_MONEY, `${path}.request_balance_snapshot.available_after`);
  match(balance.frozen_before, NON_NEGATIVE_MONEY, `${path}.request_balance_snapshot.frozen_before`);
  match(balance.frozen_after, NON_NEGATIVE_MONEY, `${path}.request_balance_snapshot.frozen_after`);
  dateTime(balance.captured_at, `${path}.request_balance_snapshot.captured_at`);
  const account = object(
    result.payout_account_snapshot,
    ['account_holder_masked', 'bank_name', 'account_number_masked', 'account_no_last4', 'snapshot_at'],
    `${path}.payout_account_snapshot`,
  );
  text(account.account_holder_masked, `${path}.payout_account_snapshot.account_holder_masked`);
  text(account.bank_name, `${path}.payout_account_snapshot.bank_name`);
  text(account.account_number_masked, `${path}.payout_account_snapshot.account_number_masked`);
  match(account.account_no_last4, /^[0-9]{4}$/, `${path}.payout_account_snapshot.account_no_last4`);
  dateTime(account.snapshot_at, `${path}.payout_account_snapshot.snapshot_at`);
  const reviewReason = nullableText(result.review_reason, `${path}.review_reason`);
  dateTime(result.created_at, `${path}.created_at`);
  const reviewedAt = nullableDateTime(result.reviewed_at, `${path}.reviewed_at`);
  const paidAt = nullableDateTime(result.paid_at, `${path}.paid_at`);
  const proofIds = list(result.proof_file_ids, `${path}.proof_file_ids`, ulid);
  unique(proofIds, `${path}.proof_file_ids`);
  if (status === 'PENDING' && (reviewReason !== null || reviewedAt !== null || paidAt !== null)) invalid(path);
  if (status === 'APPROVED' && (reviewedAt === null || paidAt !== null)) invalid(path);
  if (status === 'REJECTED' && (reviewReason === null || reviewedAt === null || paidAt !== null)) invalid(path);
  if (status === 'PAID' && (reviewedAt === null || paidAt === null || proofIds.length === 0)) invalid(path);
  integer(result.version, `${path}.version`, 1);
}

export function decodeAdminWithdrawalListResponse(value: unknown): AdminWithdrawalListResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  list(data.items, 'response.data.items', withdrawal);
  pagination(data.pagination, 'response.data.pagination');
  return data as AdminWithdrawalListResult;
}

export function decodeAdminWithdrawalResponse(value: unknown, withdrawalId?: string): AdminWithdrawal {
  const data = envelope(value);
  withdrawal(data, 'response.data', withdrawalId);
  return data as AdminWithdrawal;
}

export function decodeAdminPayoutReauthResponse(value: unknown, withdrawalId?: string): PayoutReauth {
  const data = object(envelope(value), ['reauth_grant', 'expires_at', 'single_use', 'withdrawal_id'], 'response.data');
  text(data.reauth_grant, 'response.data.reauth_grant');
  dateTime(data.expires_at, 'response.data.expires_at');
  if (data.single_use !== true) invalid('response.data.single_use');
  expectedId(data.withdrawal_id, withdrawalId, 'response.data.withdrawal_id');
  return data as PayoutReauth;
}

export function decodeAdminPayoutAccountRevealResponse(value: unknown): PayoutAccountReveal {
  const data = object(envelope(value), ['account_holder', 'bank_name', 'account_number', 'expires_at'], 'response.data');
  text(data.account_holder, 'response.data.account_holder');
  text(data.bank_name, 'response.data.bank_name');
  match(data.account_number, /^[0-9]{6,32}$/, 'response.data.account_number');
  dateTime(data.expires_at, 'response.data.expires_at');
  return data as PayoutAccountReveal;
}

function auditSummary(value: unknown, path: string): void {
  const result = object(value, ['field', 'display_value', 'sensitive'], path);
  text(result.field, `${path}.field`);
  const displayValue = text(result.display_value, `${path}.display_value`, true);
  const sensitive = boolean(result.sensitive, `${path}.sensitive`);
  if (sensitive && displayValue !== '发生变化') invalid(`${path}.display_value`);
}

function auditLog(value: unknown, path: string): void {
  const result = object(value, [
    'audit_id', 'actor_account_id', 'actor_role', 'module', 'action', 'target_type', 'target_id',
    'result', 'result_code', 'request_id', 'idempotency_key', 'before_summary', 'after_summary',
    'before_version', 'after_version', 'ip_hash', 'created_at',
  ], path, ['reason']);
  ulid(result.audit_id, `${path}.audit_id`);
  const actorAccountId = text(result.actor_account_id, `${path}.actor_account_id`);
  if (actorAccountId !== 'SYSTEM' && !ULID.test(actorAccountId)) invalid(`${path}.actor_account_id`);
  for (const field of ['actor_role', 'module', 'action', 'target_type', 'result_code', 'request_id'] as const) {
    text(result[field], `${path}.${field}`);
  }
  nullableText(result.target_id, `${path}.target_id`);
  enumeration(result.result, ['SUCCESS', 'FAILURE'] as const, `${path}.result`);
  nullableText(result.idempotency_key, `${path}.idempotency_key`);
  if (Object.hasOwn(result, 'reason')) nullableText(result.reason, `${path}.reason`);
  list(result.before_summary, `${path}.before_summary`, auditSummary);
  list(result.after_summary, `${path}.after_summary`, auditSummary);
  nullableInteger(result.before_version, `${path}.before_version`, 1);
  nullableInteger(result.after_version, `${path}.after_version`, 1);
  if (result.ip_hash !== null) match(result.ip_hash, /^[A-Za-z0-9_-]{16,128}$/, `${path}.ip_hash`);
  dateTime(result.created_at, `${path}.created_at`);
}

export function decodeAdminAuditLogListResponse(value: unknown): AuditLogListResult {
  const data = object(envelope(value), ['items', 'pagination'], 'response.data');
  list(data.items, 'response.data.items', auditLog);
  pagination(data.pagination, 'response.data.pagination');
  return data as AuditLogListResult;
}

export function decodeAdminBusinessRulesResponse(value: unknown): BusinessRules {
  const data = object(
    envelope(value),
    [
      'version_id', 'version_no', 'minimum_withdrawal_amount', 'aftersale_window_days',
      'legal_record_retention_years', 'order_payment_timeout_minutes', 'effective_at', 'version',
    ],
    'response.data',
  );
  ulid(data.version_id, 'response.data.version_id');
  integer(data.version_no, 'response.data.version_no', 1);
  match(data.minimum_withdrawal_amount, POSITIVE_MONEY, 'response.data.minimum_withdrawal_amount');
  integer(data.aftersale_window_days, 'response.data.aftersale_window_days', 1, 365);
  integer(data.legal_record_retention_years, 'response.data.legal_record_retention_years', 1, 100);
  if (data.order_payment_timeout_minutes !== 30) invalid('response.data.order_payment_timeout_minutes');
  dateTime(data.effective_at, 'response.data.effective_at');
  integer(data.version, 'response.data.version', 1);
  return data as BusinessRules;
}
