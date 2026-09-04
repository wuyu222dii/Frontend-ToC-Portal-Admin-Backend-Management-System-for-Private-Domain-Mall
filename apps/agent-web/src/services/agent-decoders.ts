import type {
  AgentBankAccount,
  AgentCommand,
  AgentCommissionDetail,
  AgentCommissionList,
  AgentCurrent,
  AgentCustomerDetail,
  AgentCustomerList,
  AgentDashboard,
  AgentErrorResponse,
  AgentFileDownload,
  AgentLoginResult,
  AgentOrderDetail,
  AgentOrderList,
  AgentProduct,
  AgentProductList,
  AgentPromotion,
  AgentSession,
  AgentWallet,
  AgentWithdrawal,
  AgentWithdrawalList,
  RestrictedAgentSession,
  StoreBrand,
  StoreBrandList,
  StoreCategory,
  StoreCategoryList,
} from '../types/agent';

export class AgentResponseFormatError extends Error {
  constructor(path: string, expectation: string) {
    super(`${path} must be ${expectation}`);
    this.name = 'AgentResponseFormatError';
  }
}

type JsonRecord = Record<string, unknown>;
type Decoder<T> = (value: unknown, path?: string) => T;

function record(value: unknown, path: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentResponseFormatError(path, 'an object');
  }
  return value as JsonRecord;
}

function exact(
  value: JsonRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new AgentResponseFormatError(`${path}.${key}`, 'present');
    }
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new AgentResponseFormatError(`${path}.${key}`, 'absent');
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentResponseFormatError(path, 'a non-empty string');
  }
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AgentResponseFormatError(path, 'a boolean');
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new AgentResponseFormatError(path, `an integer >= ${minimum}`);
  }
  return value as number;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new AgentResponseFormatError(path, `one of ${values.join(', ')}`);
  }
  return value as Values[number];
}

function nullableOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] | null {
  return value === null ? null : oneOf(value, values, path);
}

function list<T>(value: unknown, path: string, decode: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new AgentResponseFormatError(path, 'an array');
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

function dateTime(value: unknown, path: string): string {
  const result = text(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  ) {
    throw new AgentResponseFormatError(path, 'an RFC 3339 date-time');
  }
  return result;
}

function calendarDate(value: unknown, path: string): string {
  const result = text(value, path);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match) throw new AgentResponseFormatError(path, 'a calendar date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new AgentResponseFormatError(path, 'a calendar date');
  }
  return result;
}

function money(value: unknown, path: string, kind: 'positive' | 'nonnegative' | 'signed'): string {
  const result = text(value, path);
  const patterns = {
    positive: /^(?:0\.(?:0[1-9]|[1-9]\d)|[1-9]\d{0,15}\.\d{2})$/,
    nonnegative: /^(?:0|[1-9]\d{0,15})\.\d{2}$/,
    signed: /^-?(?:0|[1-9]\d{0,15})\.\d{2}$/,
  } as const;
  if (!patterns[kind].test(result)) {
    throw new AgentResponseFormatError(path, `${kind} two-decimal money`);
  }
  return result;
}

function rate(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^(?:100\.0000|(?:0|[1-9]\d?)\.\d{4})$/.test(result)) {
    throw new AgentResponseFormatError(path, 'a percentage with four decimals');
  }
  return result;
}

function uri(value: unknown, path: string): string {
  const result = text(value, path);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new AgentResponseFormatError(path, 'an absolute URL');
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new AgentResponseFormatError(path, 'an HTTPS URL');
  }
  return result;
}

function pagination(value: unknown, path: string): void {
  const data = record(value, path);
  exact(data, ['page', 'page_size', 'total'], [], path);
  integer(data.page, `${path}.page`, 1);
  integer(data.page_size, `${path}.page_size`, 1);
  integer(data.total, `${path}.total`);
}

function validateSuccessEnvelope(value: unknown, path: string): JsonRecord {
  const response = record(value, path);
  exact(response, ['code', 'message', 'data', 'request_id'], [], path);
  if (response.code !== 'OK') throw new AgentResponseFormatError(`${path}.code`, 'OK');
  if (response.message !== 'success') {
    throw new AgentResponseFormatError(`${path}.message`, 'success');
  }
  text(response.request_id, `${path}.request_id`);
  return response;
}

export function decodeSuccessEnvelope<T>(value: unknown, decode: Decoder<T>): T {
  const response = validateSuccessEnvelope(value, 'response');
  return decode(response.data, 'response.data');
}

export function decodeErrorResponse(value: unknown): AgentErrorResponse {
  const response = record(value, 'response');
  exact(response, ['code', 'message', 'request_id'], ['details'], 'response');
  text(response.code, 'response.code');
  text(response.message, 'response.message');
  text(response.request_id, 'response.request_id');
  if (Object.prototype.hasOwnProperty.call(response, 'details')) {
    list(response.details, 'response.details', (item, path) => {
      const detail = record(item, path);
      exact(detail, ['field', 'reason'], ['rejected_value'], path);
      const field = nullableText(detail.field, `${path}.field`);
      text(detail.reason, `${path}.reason`);
      if (Object.prototype.hasOwnProperty.call(detail, 'rejected_value')) {
        const rejectedValue = nullableText(detail.rejected_value, `${path}.rejected_value`);
        const fieldName = field?.split('.').at(-1)?.toLowerCase() ?? '';
        const sensitive =
          /(?:^|_)(?:password|token|credential)(?:_|$)/.test(fieldName) ||
          [
            'code',
            'account_number',
            'bank_account_number',
            'login_code',
            'verification_code',
            'invite_code',
            'totp_code',
            'recovery_code',
            'confirmation_hash',
            'reauth_grant',
          ].includes(fieldName);
        if (sensitive && rejectedValue !== null) {
          throw new AgentResponseFormatError(`${path}.rejected_value`, 'null or absent');
        }
      }
      return detail;
    });
  }
  return response as AgentErrorResponse;
}

function normalSession(value: unknown, path = 'session'): AgentSession {
  const data = record(value, path);
  exact(
    data,
    [
      'access_token',
      'refresh_token',
      'account_id',
      'session_id',
      'role',
      'mfa_required',
      'assurance',
      'restriction',
      'expires_at',
    ],
    [],
    path,
  );
  text(data.access_token, `${path}.access_token`);
  text(data.refresh_token, `${path}.refresh_token`);
  text(data.account_id, `${path}.account_id`);
  text(data.session_id, `${path}.session_id`);
  if (data.role !== 'AGENT_ADMIN') throw new AgentResponseFormatError(`${path}.role`, 'AGENT_ADMIN');
  if (data.mfa_required !== false) throw new AgentResponseFormatError(`${path}.mfa_required`, 'false');
  if (data.assurance !== 'PASSWORD') throw new AgentResponseFormatError(`${path}.assurance`, 'PASSWORD');
  if (data.restriction !== 'NONE') throw new AgentResponseFormatError(`${path}.restriction`, 'NONE');
  dateTime(data.expires_at, `${path}.expires_at`);
  return data as AgentSession;
}

function restrictedSession(value: unknown, path = 'session'): RestrictedAgentSession {
  const data = record(value, path);
  exact(
    data,
    [
      'access_token',
      'account_id',
      'session_id',
      'role',
      'mfa_required',
      'assurance',
      'restriction',
      'must_change_password',
      'next_action',
      'allowed_actions',
      'expires_at',
    ],
    [],
    path,
  );
  text(data.access_token, `${path}.access_token`);
  text(data.account_id, `${path}.account_id`);
  text(data.session_id, `${path}.session_id`);
  if (data.role !== 'AGENT_ADMIN') throw new AgentResponseFormatError(`${path}.role`, 'AGENT_ADMIN');
  if (data.mfa_required !== false) throw new AgentResponseFormatError(`${path}.mfa_required`, 'false');
  if (data.assurance !== 'PASSWORD') throw new AgentResponseFormatError(`${path}.assurance`, 'PASSWORD');
  if (data.restriction !== 'CHANGE_PASSWORD_ONLY') {
    throw new AgentResponseFormatError(`${path}.restriction`, 'CHANGE_PASSWORD_ONLY');
  }
  if (data.must_change_password !== true) {
    throw new AgentResponseFormatError(`${path}.must_change_password`, 'true');
  }
  if (data.next_action !== 'CHANGE_PASSWORD') {
    throw new AgentResponseFormatError(`${path}.next_action`, 'CHANGE_PASSWORD');
  }
  const actions = list(data.allowed_actions, `${path}.allowed_actions`, (item, itemPath) =>
    oneOf(item, ['CHANGE_TEMPORARY_PASSWORD', 'LOGOUT'] as const, itemPath),
  );
  if (
    actions.length !== 2 ||
    new Set(actions).size !== 2 ||
    !actions.includes('CHANGE_TEMPORARY_PASSWORD') ||
    !actions.includes('LOGOUT')
  ) {
    throw new AgentResponseFormatError(`${path}.allowed_actions`, 'the two restricted actions');
  }
  dateTime(data.expires_at, `${path}.expires_at`);
  return data as RestrictedAgentSession;
}

export const decodeAgentSession = normalSession;

export function decodeAgentLoginResult(value: unknown, path = 'response.data'): AgentLoginResult {
  const data = record(value, path);
  return data.restriction === 'CHANGE_PASSWORD_ONLY'
    ? restrictedSession(data, path)
    : normalSession(data, path);
}

export function decodeAgentCurrent(value: unknown, path = 'response.data'): AgentCurrent {
  const data = record(value, path);
  exact(data, ['agent_id', 'agent_no', 'name', 'status', 'product_authorization_mode'], [], path);
  text(data.agent_id, `${path}.agent_id`);
  text(data.agent_no, `${path}.agent_no`);
  text(data.name, `${path}.name`);
  oneOf(data.status, ['ACTIVE', 'DISABLED'] as const, `${path}.status`);
  oneOf(
    data.product_authorization_mode,
    ['ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST'] as const,
    `${path}.product_authorization_mode`,
  );
  return data as AgentCurrent;
}

export function decodeAgentCommand(value: unknown, path = 'response.data'): AgentCommand {
  const data = record(value, path);
  exact(data, ['resource_type', 'resource_id', 'status', 'version', 'occurred_at'], [], path);
  text(data.resource_type, `${path}.resource_type`);
  text(data.resource_id, `${path}.resource_id`);
  text(data.status, `${path}.status`);
  integer(data.version, `${path}.version`);
  dateTime(data.occurred_at, `${path}.occurred_at`);
  return data as AgentCommand;
}

export function decodeAgentDashboard(value: unknown, path = 'response.data'): AgentDashboard {
  const data = record(value, path);
  exact(
    data,
    [
      'timezone',
      'as_of',
      'agent_id',
      'today_net_sales_amount',
      'month_net_sales_amount',
      'today_paid_order_count',
      'attributed_customer_count',
      'expected_commission',
      'available_balance',
      'frozen_balance',
      'negative_balance',
      'pending_withdrawal_count',
      'todo',
      'trend',
    ],
    [],
    path,
  );
  if (data.timezone !== 'Asia/Shanghai') {
    throw new AgentResponseFormatError(`${path}.timezone`, 'Asia/Shanghai');
  }
  dateTime(data.as_of, `${path}.as_of`);
  text(data.agent_id, `${path}.agent_id`);
  money(data.today_net_sales_amount, `${path}.today_net_sales_amount`, 'signed');
  money(data.month_net_sales_amount, `${path}.month_net_sales_amount`, 'signed');
  integer(data.today_paid_order_count, `${path}.today_paid_order_count`);
  integer(data.attributed_customer_count, `${path}.attributed_customer_count`);
  money(data.expected_commission, `${path}.expected_commission`, 'nonnegative');
  money(data.available_balance, `${path}.available_balance`, 'signed');
  money(data.frozen_balance, `${path}.frozen_balance`, 'nonnegative');
  money(data.negative_balance, `${path}.negative_balance`, 'nonnegative');
  integer(data.pending_withdrawal_count, `${path}.pending_withdrawal_count`);
  const todo = record(data.todo, `${path}.todo`);
  exact(todo, ['commission_exception_count', 'withdrawal_action_count'], [], `${path}.todo`);
  integer(todo.commission_exception_count, `${path}.todo.commission_exception_count`);
  integer(todo.withdrawal_action_count, `${path}.todo.withdrawal_action_count`);
  list(data.trend, `${path}.trend`, (item, itemPath) => {
    const point = record(item, itemPath);
    exact(point, ['business_date', 'net_sales_amount', 'paid_order_count', 'commission_change'], [], itemPath);
    calendarDate(point.business_date, `${itemPath}.business_date`);
    money(point.net_sales_amount, `${itemPath}.net_sales_amount`, 'signed');
    integer(point.paid_order_count, `${itemPath}.paid_order_count`);
    money(point.commission_change, `${itemPath}.commission_change`, 'signed');
    return point;
  });
  return data as AgentDashboard;
}

function image(value: unknown, path: string): void {
  const data = record(value, path);
  exact(data, ['url', 'sort_order', 'is_primary'], [], path);
  uri(data.url, `${path}.url`);
  integer(data.sort_order, `${path}.sort_order`);
  bool(data.is_primary, `${path}.is_primary`);
}

function storeBrand(value: unknown, path: string): StoreBrand {
  const brand = record(value, path);
  exact(brand, ['brand_id', 'name', 'description', 'logo_url', 'sort_order'], [], path);
  text(brand.brand_id, `${path}.brand_id`);
  text(brand.name, `${path}.name`);
  nullableText(brand.description, `${path}.description`);
  if (brand.logo_url !== null) uri(brand.logo_url, `${path}.logo_url`);
  integer(brand.sort_order, `${path}.sort_order`);
  return brand as StoreBrand;
}

function storeCategory(value: unknown, path: string): StoreCategory {
  const category = record(value, path);
  exact(category, ['category_id', 'name', 'icon_url', 'sort_order'], [], path);
  text(category.category_id, `${path}.category_id`);
  text(category.name, `${path}.name`);
  if (category.icon_url !== null) uri(category.icon_url, `${path}.icon_url`);
  integer(category.sort_order, `${path}.sort_order`);
  return category as StoreCategory;
}

function product(value: unknown, path = 'response.data'): AgentProduct {
  const data = record(value, path);
  exact(
    data,
    ['product_id', 'spu_code', 'name', 'brand', 'category', 'primary_image', 'skus'],
    ['subtitle', 'images'],
    path,
  );
  text(data.product_id, `${path}.product_id`);
  text(data.spu_code, `${path}.spu_code`);
  text(data.name, `${path}.name`);
  if (Object.prototype.hasOwnProperty.call(data, 'subtitle')) nullableText(data.subtitle, `${path}.subtitle`);
  storeBrand(data.brand, `${path}.brand`);
  storeCategory(data.category, `${path}.category`);
  if (data.primary_image !== null) image(data.primary_image, `${path}.primary_image`);
  if (Object.prototype.hasOwnProperty.call(data, 'images')) {
    list(data.images, `${path}.images`, (item, itemPath) => image(item, itemPath));
  }
  list(data.skus, `${path}.skus`, (item, itemPath) => {
    const sku = record(item, itemPath);
    exact(
      sku,
      ['sku_id', 'code', 'name', 'retail_price', 'current_estimated_rate', 'rule_source', 'rule_version_id', 'estimated_commission_per_unit'],
      ['spec_json', 'commission_label'],
      itemPath,
    );
    text(sku.sku_id, `${itemPath}.sku_id`);
    text(sku.code, `${itemPath}.code`);
    text(sku.name, `${itemPath}.name`);
    if (Object.prototype.hasOwnProperty.call(sku, 'spec_json') && sku.spec_json !== null) {
      const spec = record(sku.spec_json, `${itemPath}.spec_json`);
      exact(spec, ['attributes'], [], `${itemPath}.spec_json`);
      list(spec.attributes, `${itemPath}.spec_json.attributes`, (attribute, attributePath) => {
        const entry = record(attribute, attributePath);
        exact(entry, ['name', 'value'], [], attributePath);
        text(entry.name, `${attributePath}.name`);
        text(entry.value, `${attributePath}.value`);
        return entry;
      });
    }
    money(sku.retail_price, `${itemPath}.retail_price`, 'positive');
    rate(sku.current_estimated_rate, `${itemPath}.current_estimated_rate`);
    oneOf(sku.rule_source, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${itemPath}.rule_source`);
    text(sku.rule_version_id, `${itemPath}.rule_version_id`);
    money(sku.estimated_commission_per_unit, `${itemPath}.estimated_commission_per_unit`, 'nonnegative');
    if (Object.prototype.hasOwnProperty.call(sku, 'commission_label')) {
      text(sku.commission_label, `${itemPath}.commission_label`);
    }
    return sku;
  });
  return data as AgentProduct;
}

export const decodeAgentProduct = product;

export function decodeAgentProductList(value: unknown, path = 'response.data'): AgentProductList {
  const data = record(value, path);
  exact(data, ['items', 'pagination'], [], path);
  list(data.items, `${path}.items`, product);
  pagination(data.pagination, `${path}.pagination`);
  return data as AgentProductList;
}

export function decodeStoreBrandList(value: unknown, path = 'response.data'): StoreBrandList {
  const data = record(value, path);
  exact(data, ['items'], [], path);
  list(data.items, `${path}.items`, storeBrand);
  return data as StoreBrandList;
}

export function decodeStoreCategoryList(value: unknown, path = 'response.data'): StoreCategoryList {
  const data = record(value, path);
  exact(data, ['items'], [], path);
  list(data.items, `${path}.items`, storeCategory);
  return data as StoreCategoryList;
}

export function decodeAgentPromotion(value: unknown, path = 'response.data'): AgentPromotion {
  const data = record(value, path);
  exact(
    data,
    ['promotion_asset_id', 'target_type', 'public_url', 'qr_file', 'attribution_eligible', 'expires_at'],
    ['target_id'],
    path,
  );
  text(data.promotion_asset_id, `${path}.promotion_asset_id`);
  oneOf(data.target_type, ['STOREFRONT', 'PRODUCT'] as const, `${path}.target_type`);
  if (Object.prototype.hasOwnProperty.call(data, 'target_id')) nullableText(data.target_id, `${path}.target_id`);
  uri(data.public_url, `${path}.public_url`);
  const qr = record(data.qr_file, `${path}.qr_file`);
  exact(qr, ['file_id', 'status', 'visibility', 'purpose'], [], `${path}.qr_file`);
  text(qr.file_id, `${path}.qr_file.file_id`);
  if (qr.status !== 'READY') throw new AgentResponseFormatError(`${path}.qr_file.status`, 'READY');
  if (qr.visibility !== 'PRIVATE') throw new AgentResponseFormatError(`${path}.qr_file.visibility`, 'PRIVATE');
  if (qr.purpose !== 'PROMOTION_QR') throw new AgentResponseFormatError(`${path}.qr_file.purpose`, 'PROMOTION_QR');
  bool(data.attribution_eligible, `${path}.attribution_eligible`);
  if (data.expires_at !== null) dateTime(data.expires_at, `${path}.expires_at`);
  return data as AgentPromotion;
}

export function decodeAgentFileDownload(value: unknown, path = 'response.data'): AgentFileDownload {
  const data = record(value, path);
  exact(data, ['file_id', 'download_url', 'expires_at'], [], path);
  text(data.file_id, `${path}.file_id`);
  uri(data.download_url, `${path}.download_url`);
  dateTime(data.expires_at, `${path}.expires_at`);
  return data as AgentFileDownload;
}

function customerListItem(value: unknown, path: string): void {
  const item = record(value, path);
  exact(
    item,
    [
      'customer_id',
      'customer_alias',
      'nickname_masked',
      'phone_tail',
      'city',
      'consumption_amount',
      'consumption_count',
      'registered_at',
      'last_product_name',
      'account_status',
      'binding_status',
      'binding_id',
      'binding_started_at',
    ],
    [],
    path,
  );
  text(item.customer_id, `${path}.customer_id`);
  text(item.customer_alias, `${path}.customer_alias`);
  nullableText(item.nickname_masked, `${path}.nickname_masked`);
  if (item.phone_tail !== null && (typeof item.phone_tail !== 'string' || !/^\d{4}$/.test(item.phone_tail))) {
    throw new AgentResponseFormatError(`${path}.phone_tail`, 'four digits or null');
  }
  nullableText(item.city, `${path}.city`);
  money(item.consumption_amount, `${path}.consumption_amount`, 'nonnegative');
  integer(item.consumption_count, `${path}.consumption_count`);
  dateTime(item.registered_at, `${path}.registered_at`);
  nullableText(item.last_product_name, `${path}.last_product_name`);
  if (item.account_status !== 'ACTIVE') {
    throw new AgentResponseFormatError(`${path}.account_status`, 'ACTIVE');
  }
  if (item.binding_status !== 'BOUND') {
    throw new AgentResponseFormatError(`${path}.binding_status`, 'BOUND');
  }
  text(item.binding_id, `${path}.binding_id`);
  dateTime(item.binding_started_at, `${path}.binding_started_at`);
}

export function decodeAgentCustomerList(value: unknown, path = 'response.data'): AgentCustomerList {
  const data = record(value, path);
  exact(data, ['items', 'pagination'], [], path);
  list(data.items, `${path}.items`, (item, itemPath) => customerListItem(item, itemPath));
  pagination(data.pagination, `${path}.pagination`);
  return data as AgentCustomerList;
}

export function decodeAgentCustomerDetail(value: unknown, path = 'response.data'): AgentCustomerDetail {
  const data = record(value, path);
  exact(data, ['customer', 'binding_period', 'orders', 'recent_products'], [], path);
  const customer = record(data.customer, `${path}.customer`);
  exact(
    customer,
    [
      'customer_id',
      'customer_alias',
      'nickname_masked',
      'phone_tail',
      'city',
      'consumption_amount',
      'consumption_count',
      'registered_at',
      'last_product_name',
      'binding',
      'version',
    ],
    [],
    `${path}.customer`,
  );
  text(customer.customer_id, `${path}.customer.customer_id`);
  text(customer.customer_alias, `${path}.customer.customer_alias`);
  nullableText(customer.nickname_masked, `${path}.customer.nickname_masked`);
  if (
    customer.phone_tail !== null &&
    (typeof customer.phone_tail !== 'string' || !/^\d{4}$/.test(customer.phone_tail))
  ) {
    throw new AgentResponseFormatError(`${path}.customer.phone_tail`, 'four digits or null');
  }
  nullableText(customer.city, `${path}.customer.city`);
  money(customer.consumption_amount, `${path}.customer.consumption_amount`, 'nonnegative');
  integer(customer.consumption_count, `${path}.customer.consumption_count`);
  dateTime(customer.registered_at, `${path}.customer.registered_at`);
  nullableText(customer.last_product_name, `${path}.customer.last_product_name`);
  if (customer.binding === null) {
    throw new AgentResponseFormatError(`${path}.customer.binding`, 'a current binding');
  }
  const binding = record(customer.binding, `${path}.customer.binding`);
  exact(
    binding,
    ['binding_id', 'customer_id', 'agent_id', 'agent_name', 'started_at', 'customer_version'],
    [],
    `${path}.customer.binding`,
  );
  text(binding.binding_id, `${path}.customer.binding.binding_id`);
  text(binding.customer_id, `${path}.customer.binding.customer_id`);
  text(binding.agent_id, `${path}.customer.binding.agent_id`);
  text(binding.agent_name, `${path}.customer.binding.agent_name`);
  dateTime(binding.started_at, `${path}.customer.binding.started_at`);
  integer(binding.customer_version, `${path}.customer.binding.customer_version`);
  integer(customer.version, `${path}.customer.version`);
  const period = record(data.binding_period, `${path}.binding_period`);
  exact(period, ['binding_id', 'started_at', 'ended_at'], [], `${path}.binding_period`);
  text(period.binding_id, `${path}.binding_period.binding_id`);
  dateTime(period.started_at, `${path}.binding_period.started_at`);
  if (period.ended_at !== null) dateTime(period.ended_at, `${path}.binding_period.ended_at`);
  list(data.orders, `${path}.orders`, (value, itemPath) => {
    const item = record(value, itemPath);
    exact(item, ['order_id', 'order_no', 'display_status', 'payable_amount', 'paid_at'], [], itemPath);
    text(item.order_id, `${itemPath}.order_id`);
    text(item.order_no, `${itemPath}.order_no`);
    text(item.display_status, `${itemPath}.display_status`);
    money(item.payable_amount, `${itemPath}.payable_amount`, 'nonnegative');
    if (item.paid_at !== null) dateTime(item.paid_at, `${itemPath}.paid_at`);
    return item;
  });
  list(data.recent_products, `${path}.recent_products`, (value, itemPath) => {
    const item = record(value, itemPath);
    exact(item, ['product_id', 'product_name', 'sku_id', 'sku_name', 'last_purchased_at'], [], itemPath);
    text(item.product_id, `${itemPath}.product_id`);
    text(item.product_name, `${itemPath}.product_name`);
    text(item.sku_id, `${itemPath}.sku_id`);
    text(item.sku_name, `${itemPath}.sku_name`);
    dateTime(item.last_purchased_at, `${itemPath}.last_purchased_at`);
    return item;
  });
  return data as AgentCustomerDetail;
}

const orderStatuses = ['PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED'] as const;
const refundProgressStatuses = ['NONE', 'PARTIAL', 'FULL'] as const;
const refundProcessingStatuses = ['IDLE', 'REFUNDING', 'FAILED'] as const;
const fulfillmentStatuses = [
  'NOT_STARTED',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
] as const;
const completionReasons = ['CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT'] as const;
const aftersaleStatuses = [
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
] as const;

function compactOrderItem(value: unknown, path: string): void {
  const item = record(value, path);
  exact(
    item,
    ['order_item_id', 'product_id', 'sku_id', 'product_name', 'sku_name', 'quantity', 'line_amount'],
    [],
    path,
  );
  text(item.order_item_id, `${path}.order_item_id`);
  text(item.product_id, `${path}.product_id`);
  text(item.sku_id, `${path}.sku_id`);
  text(item.product_name, `${path}.product_name`);
  text(item.sku_name, `${path}.sku_name`);
  integer(item.quantity, `${path}.quantity`, 1);
  money(item.line_amount, `${path}.line_amount`, 'nonnegative');
}

function orderAftersaleSummary(value: unknown, path: string): void {
  const summary = record(value, path);
  exact(summary, ['active_count', 'latest_aftersale_id', 'latest_status', 'refunded_amount'], [], path);
  integer(summary.active_count, `${path}.active_count`);
  nullableText(summary.latest_aftersale_id, `${path}.latest_aftersale_id`);
  nullableOneOf(summary.latest_status, aftersaleStatuses, `${path}.latest_status`);
  money(summary.refunded_amount, `${path}.refunded_amount`, 'nonnegative');
}

function readonlyActions(value: unknown, path: string): void {
  const actions = list(value, path, (action, actionPath) =>
    oneOf(action, ['VIEW_DETAIL', 'VIEW_COMMISSION'] as const, actionPath),
  );
  if (new Set(actions).size !== actions.length) {
    throw new AgentResponseFormatError(path, 'unique read-only actions');
  }
}

function orderListItem(value: unknown, path: string): void {
  const item = record(value, path);
  exact(
    item,
    [
      'order_id',
      'order_no',
      'order_status',
      'payment_status',
      'refund_progress_status',
      'refund_processing_status',
      'fulfillment_status',
      'close_reason',
      'completion_reason',
      'payment_resolution',
      'display_status',
      'final_agent_id',
      'customer_alias',
      'customer_city',
      'payable_amount',
      'items',
      'aftersale_summary',
      'available_actions',
      'created_at',
      'paid_at',
    ],
    [],
    path,
  );
  text(item.order_id, `${path}.order_id`);
  text(item.order_no, `${path}.order_no`);
  oneOf(item.order_status, orderStatuses, `${path}.order_status`);
  if (item.payment_status !== 'PAID') throw new AgentResponseFormatError(`${path}.payment_status`, 'PAID');
  oneOf(item.refund_progress_status, refundProgressStatuses, `${path}.refund_progress_status`);
  oneOf(item.refund_processing_status, refundProcessingStatuses, `${path}.refund_processing_status`);
  oneOf(item.fulfillment_status, fulfillmentStatuses, `${path}.fulfillment_status`);
  nullableOneOf(item.close_reason, ['FULL_REFUND_BEFORE_SHIPMENT'] as const, `${path}.close_reason`);
  nullableOneOf(item.completion_reason, completionReasons, `${path}.completion_reason`);
  oneOf(item.payment_resolution, ['NORMAL', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED'] as const, `${path}.payment_resolution`);
  text(item.display_status, `${path}.display_status`);
  text(item.final_agent_id, `${path}.final_agent_id`);
  text(item.customer_alias, `${path}.customer_alias`);
  nullableText(item.customer_city, `${path}.customer_city`);
  money(item.payable_amount, `${path}.payable_amount`, 'nonnegative');
  list(item.items, `${path}.items`, (entry, itemPath) => compactOrderItem(entry, itemPath));
  orderAftersaleSummary(item.aftersale_summary, `${path}.aftersale_summary`);
  readonlyActions(item.available_actions, `${path}.available_actions`);
  dateTime(item.created_at, `${path}.created_at`);
  dateTime(item.paid_at, `${path}.paid_at`);
}

export function decodeAgentOrderList(value: unknown, path = 'response.data'): AgentOrderList {
  const data = record(value, path);
  exact(data, ['items', 'pagination'], [], path);
  list(data.items, `${path}.items`, (item, itemPath) => orderListItem(item, itemPath));
  pagination(data.pagination, `${path}.pagination`);
  return data as AgentOrderList;
}

function fullOrderItem(value: unknown, path: string): void {
  const item = record(value, path);
  exact(
    item,
    [
      'order_item_id',
      'product_id',
      'sku_id',
      'product_name',
      'sku_name',
      'unit_price',
      'quantity',
      'line_amount',
      'refunded_quantity',
      'reserved_aftersale_quantity',
      'shipped_quantity',
    ],
    [],
    path,
  );
  text(item.order_item_id, `${path}.order_item_id`);
  text(item.product_id, `${path}.product_id`);
  text(item.sku_id, `${path}.sku_id`);
  text(item.product_name, `${path}.product_name`);
  text(item.sku_name, `${path}.sku_name`);
  money(item.unit_price, `${path}.unit_price`, 'nonnegative');
  integer(item.quantity, `${path}.quantity`, 1);
  money(item.line_amount, `${path}.line_amount`, 'nonnegative');
  integer(item.refunded_quantity, `${path}.refunded_quantity`);
  integer(item.reserved_aftersale_quantity, `${path}.reserved_aftersale_quantity`);
  integer(item.shipped_quantity, `${path}.shipped_quantity`);
}

export function decodeAgentOrderDetail(value: unknown, path = 'response.data'): AgentOrderDetail {
  const data = record(value, path);
  exact(
    data,
    [
      'order_id',
      'order_no',
      'order_status',
      'payment_status',
      'refund_progress_status',
      'refund_processing_status',
      'fulfillment_status',
      'close_reason',
      'completion_reason',
      'payment_resolution',
      'display_status',
      'final_agent_id',
      'payable_amount',
      'customer_snapshot',
      'items',
      'commission_items',
      'aftersales',
      'available_actions',
      'timeline',
      'created_at',
      'paid_at',
    ],
    [],
    path,
  );
  text(data.order_id, `${path}.order_id`);
  text(data.order_no, `${path}.order_no`);
  oneOf(data.order_status, orderStatuses, `${path}.order_status`);
  if (data.payment_status !== 'PAID') throw new AgentResponseFormatError(`${path}.payment_status`, 'PAID');
  oneOf(data.refund_progress_status, refundProgressStatuses, `${path}.refund_progress_status`);
  oneOf(data.refund_processing_status, refundProcessingStatuses, `${path}.refund_processing_status`);
  oneOf(data.fulfillment_status, fulfillmentStatuses, `${path}.fulfillment_status`);
  nullableOneOf(
    data.close_reason,
    ['USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT'] as const,
    `${path}.close_reason`,
  );
  nullableOneOf(data.completion_reason, completionReasons, `${path}.completion_reason`);
  oneOf(
    data.payment_resolution,
    ['NORMAL', 'LATE_SUCCESS_REFUND_PENDING', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED'] as const,
    `${path}.payment_resolution`,
  );
  text(data.display_status, `${path}.display_status`);
  text(data.final_agent_id, `${path}.final_agent_id`);
  money(data.payable_amount, `${path}.payable_amount`, 'nonnegative');
  const customer = record(data.customer_snapshot, `${path}.customer_snapshot`);
  exact(customer, ['customer_alias', 'nickname_masked', 'phone_tail', 'city', 'address_summary_masked'], [], `${path}.customer_snapshot`);
  text(customer.customer_alias, `${path}.customer_snapshot.customer_alias`);
  nullableText(customer.nickname_masked, `${path}.customer_snapshot.nickname_masked`);
  if (customer.phone_tail !== null && (typeof customer.phone_tail !== 'string' || !/^\d{4}$/.test(customer.phone_tail))) {
    throw new AgentResponseFormatError(`${path}.customer_snapshot.phone_tail`, 'four digits or null');
  }
  nullableText(customer.city, `${path}.customer_snapshot.city`);
  nullableText(customer.address_summary_masked, `${path}.customer_snapshot.address_summary_masked`);
  list(data.items, `${path}.items`, (item, itemPath) => fullOrderItem(item, itemPath));
  list(data.commission_items, `${path}.commission_items`, (value, itemPath) => {
    const item = record(value, itemPath);
    exact(item, ['commission_snapshot_id', 'order_item_id', 'effective_rate', 'rule_source', 'original_commission', 'state'], [], itemPath);
    text(item.commission_snapshot_id, `${itemPath}.commission_snapshot_id`);
    text(item.order_item_id, `${itemPath}.order_item_id`);
    rate(item.effective_rate, `${itemPath}.effective_rate`);
    oneOf(item.rule_source, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${itemPath}.rule_source`);
    money(item.original_commission, `${itemPath}.original_commission`, 'nonnegative');
    oneOf(item.state, ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE'] as const, `${itemPath}.state`);
    return item;
  });
  list(data.aftersales, `${path}.aftersales`, (value, itemPath) => {
    const item = record(value, itemPath);
    exact(item, ['aftersale_id', 'aftersale_no', 'type', 'status', 'requested_amount', 'created_at'], [], itemPath);
    text(item.aftersale_id, `${itemPath}.aftersale_id`);
    text(item.aftersale_no, `${itemPath}.aftersale_no`);
    oneOf(item.type, ['REFUND_ONLY', 'RETURN_REFUND'] as const, `${itemPath}.type`);
    oneOf(item.status, aftersaleStatuses, `${itemPath}.status`);
    money(item.requested_amount, `${itemPath}.requested_amount`, 'nonnegative');
    dateTime(item.created_at, `${itemPath}.created_at`);
    return item;
  });
  readonlyActions(data.available_actions, `${path}.available_actions`);
  list(data.timeline, `${path}.timeline`, (value, itemPath) => {
    const event = record(value, itemPath);
    exact(event, ['event_id', 'axis', 'event_code', 'from_status', 'to_status', 'occurred_at'], [], itemPath);
    text(event.event_id, `${itemPath}.event_id`);
    oneOf(event.axis, ['PAYMENT', 'REFUND', 'FULFILLMENT', 'AFTERSALE'] as const, `${itemPath}.axis`);
    oneOf(
      event.event_code,
      ['PAYMENT_SUCCEEDED', 'REFUND_STARTED', 'REFUND_SUCCEEDED', 'REFUND_FAILED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'AFTERSALE_CREATED', 'AFTERSALE_STATUS_CHANGED'] as const,
      `${itemPath}.event_code`,
    );
    nullableText(event.from_status, `${itemPath}.from_status`);
    text(event.to_status, `${itemPath}.to_status`);
    dateTime(event.occurred_at, `${itemPath}.occurred_at`);
    return event;
  });
  dateTime(data.created_at, `${path}.created_at`);
  dateTime(data.paid_at, `${path}.paid_at`);
  return data as AgentOrderDetail;
}

const ledgerTypes = [
  'EXPECTED_CREATED',
  'EXPECTED_REDUCED',
  'EXPECTED_CANCELLED',
  'AVAILABLE_CREDIT',
  'REFUND_DEBIT',
] as const;
const commissionStates = ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE'] as const;

function commissionLedgerItem(value: unknown, path: string): void {
  const item = record(value, path);
  exact(
    item,
    [
      'ledger_id',
      'commission_snapshot_id',
      'order_id',
      'order_no',
      'order_item_id',
      'product_id',
      'product_name',
      'sku_id',
      'sku_name',
      'effective_rate',
      'commission_base',
      'original_commission',
      'refund_id',
      'ledger_type',
      'position_state',
      'expected_change',
      'available_change',
      'reason',
      'occurred_at',
    ],
    [],
    path,
  );
  text(item.ledger_id, `${path}.ledger_id`);
  text(item.commission_snapshot_id, `${path}.commission_snapshot_id`);
  text(item.order_id, `${path}.order_id`);
  text(item.order_no, `${path}.order_no`);
  text(item.order_item_id, `${path}.order_item_id`);
  text(item.product_id, `${path}.product_id`);
  text(item.product_name, `${path}.product_name`);
  text(item.sku_id, `${path}.sku_id`);
  text(item.sku_name, `${path}.sku_name`);
  rate(item.effective_rate, `${path}.effective_rate`);
  money(item.commission_base, `${path}.commission_base`, 'nonnegative');
  money(item.original_commission, `${path}.original_commission`, 'nonnegative');
  nullableText(item.refund_id, `${path}.refund_id`);
  oneOf(item.ledger_type, ledgerTypes, `${path}.ledger_type`);
  oneOf(item.position_state, commissionStates, `${path}.position_state`);
  money(item.expected_change, `${path}.expected_change`, 'signed');
  money(item.available_change, `${path}.available_change`, 'signed');
  text(item.reason, `${path}.reason`);
  dateTime(item.occurred_at, `${path}.occurred_at`);
}

export function decodeAgentCommissionList(value: unknown, path = 'response.data'): AgentCommissionList {
  const data = record(value, path);
  exact(data, ['items', 'pagination'], [], path);
  list(data.items, `${path}.items`, (item, itemPath) => commissionLedgerItem(item, itemPath));
  pagination(data.pagination, `${path}.pagination`);
  return data as AgentCommissionList;
}

export function decodeAgentCommissionDetail(
  value: unknown,
  path = 'response.data',
): AgentCommissionDetail {
  const data = record(value, path);
  exact(data, ['order_id', 'order_no', 'item'], [], path);
  text(data.order_id, `${path}.order_id`);
  text(data.order_no, `${path}.order_no`);
  const item = record(data.item, `${path}.item`);
  exact(
    item,
    [
      'commission_snapshot_id',
      'order_item_id',
      'product_id',
      'product_name',
      'sku_id',
      'sku_name',
      'category_id',
      'category_name',
      'rule_version_id',
      'rule_version_no',
      'rule_source',
      'hit_path',
      'effective_rate',
      'commission_base',
      'original_commission',
      'expected_remaining',
      'reversal_total',
      'rounding_mode',
      'rounding_scale',
      'position_state',
      'ledger',
    ],
    [],
    `${path}.item`,
  );
  for (const key of [
    'commission_snapshot_id',
    'order_item_id',
    'product_id',
    'product_name',
    'sku_id',
    'sku_name',
    'category_id',
    'category_name',
    'rule_version_id',
  ] as const) {
    text(item[key], `${path}.item.${key}`);
  }
  integer(item.rule_version_no, `${path}.item.rule_version_no`, 1);
  oneOf(item.rule_source, ['PLATFORM', 'CATEGORY', 'SKU'] as const, `${path}.item.rule_source`);
  list(item.hit_path, `${path}.item.hit_path`, (entry, itemPath) => text(entry, itemPath));
  rate(item.effective_rate, `${path}.item.effective_rate`);
  money(item.commission_base, `${path}.item.commission_base`, 'nonnegative');
  money(item.original_commission, `${path}.item.original_commission`, 'nonnegative');
  money(item.expected_remaining, `${path}.item.expected_remaining`, 'nonnegative');
  money(item.reversal_total, `${path}.item.reversal_total`, 'nonnegative');
  if (item.rounding_mode !== 'HALF_UP') {
    throw new AgentResponseFormatError(`${path}.item.rounding_mode`, 'HALF_UP');
  }
  if (item.rounding_scale !== 2) {
    throw new AgentResponseFormatError(`${path}.item.rounding_scale`, '2');
  }
  oneOf(item.position_state, commissionStates, `${path}.item.position_state`);
  list(item.ledger, `${path}.item.ledger`, (value, itemPath) => {
    const entry = record(value, itemPath);
    exact(
      entry,
      ['ledger_id', 'ledger_type', 'expected_change', 'available_change', 'frozen_change', 'refund_id', 'reason', 'occurred_at'],
      [],
      itemPath,
    );
    text(entry.ledger_id, `${itemPath}.ledger_id`);
    oneOf(entry.ledger_type, ledgerTypes, `${itemPath}.ledger_type`);
    money(entry.expected_change, `${itemPath}.expected_change`, 'signed');
    money(entry.available_change, `${itemPath}.available_change`, 'signed');
    money(entry.frozen_change, `${itemPath}.frozen_change`, 'signed');
    nullableText(entry.refund_id, `${itemPath}.refund_id`);
    text(entry.reason, `${itemPath}.reason`);
    dateTime(entry.occurred_at, `${itemPath}.occurred_at`);
    return entry;
  });
  return data as AgentCommissionDetail;
}

export function decodeAgentWallet(value: unknown, path = 'response.data'): AgentWallet {
  const data = record(value, path);
  exact(
    data,
    ['available_balance', 'frozen_balance', 'is_negative', 'withdrawal_allowed', 'version'],
    ['blocked_reason'],
    path,
  );
  money(data.available_balance, `${path}.available_balance`, 'signed');
  money(data.frozen_balance, `${path}.frozen_balance`, 'nonnegative');
  bool(data.is_negative, `${path}.is_negative`);
  bool(data.withdrawal_allowed, `${path}.withdrawal_allowed`);
  if (Object.prototype.hasOwnProperty.call(data, 'blocked_reason')) {
    nullableText(data.blocked_reason, `${path}.blocked_reason`);
  }
  integer(data.version, `${path}.version`);
  return data as AgentWallet;
}

function bankAccount(value: unknown, path = 'response.data'): AgentBankAccount {
  const data = record(value, path);
  exact(
    data,
    ['bank_account_id', 'account_holder_masked', 'bank_name', 'account_number_masked', 'account_no_last4', 'is_active', 'version'],
    [],
    path,
  );
  text(data.bank_account_id, `${path}.bank_account_id`);
  text(data.account_holder_masked, `${path}.account_holder_masked`);
  text(data.bank_name, `${path}.bank_name`);
  text(data.account_number_masked, `${path}.account_number_masked`);
  if (typeof data.account_no_last4 !== 'string' || !/^\d{4}$/.test(data.account_no_last4)) {
    throw new AgentResponseFormatError(`${path}.account_no_last4`, 'four digits');
  }
  bool(data.is_active, `${path}.is_active`);
  integer(data.version, `${path}.version`);
  return data as AgentBankAccount;
}

export const decodeAgentBankAccount = bankAccount;

export function decodeAgentBankAccountList(value: unknown, path = 'response.data'): AgentBankAccount[] {
  return list(value, path, bankAccount);
}

function withdrawal(value: unknown, path = 'response.data'): AgentWithdrawal {
  const data = record(value, path);
  exact(
    data,
    ['withdrawal_id', 'withdrawal_no', 'status', 'amount', 'bank_account_masked', 'review_reason', 'created_at', 'version'],
    ['reviewed_at', 'paid_at', 'proof_file_ids'],
    path,
  );
  text(data.withdrawal_id, `${path}.withdrawal_id`);
  text(data.withdrawal_no, `${path}.withdrawal_no`);
  oneOf(data.status, ['PENDING', 'APPROVED', 'REJECTED', 'PAID'] as const, `${path}.status`);
  money(data.amount, `${path}.amount`, 'positive');
  text(data.bank_account_masked, `${path}.bank_account_masked`);
  nullableText(data.review_reason, `${path}.review_reason`);
  dateTime(data.created_at, `${path}.created_at`);
  if (Object.prototype.hasOwnProperty.call(data, 'reviewed_at') && data.reviewed_at !== null) {
    dateTime(data.reviewed_at, `${path}.reviewed_at`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'paid_at') && data.paid_at !== null) {
    dateTime(data.paid_at, `${path}.paid_at`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'proof_file_ids')) {
    list(data.proof_file_ids, `${path}.proof_file_ids`, (item, itemPath) => text(item, itemPath));
  }
  integer(data.version, `${path}.version`);
  return data as AgentWithdrawal;
}

export const decodeAgentWithdrawal = withdrawal;

export function decodeAgentWithdrawalList(value: unknown, path = 'response.data'): AgentWithdrawalList {
  const data = record(value, path);
  exact(data, ['items', 'pagination'], [], path);
  list(data.items, `${path}.items`, withdrawal);
  pagination(data.pagination, `${path}.pagination`);
  return data as AgentWithdrawalList;
}
